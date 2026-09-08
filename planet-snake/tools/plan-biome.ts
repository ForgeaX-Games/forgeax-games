import { readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { BIOME_PLAN } from '../src/biome-plan';
import { BASELINE_PLAN } from '../src/biome-plan.baseline';
import { PROP_DATA } from '../src/props-data';
import { argmaxRegionOrOcean, regionAt } from '../src/regions';
import {
  HEAD_RADIUS,
  HIT_SCALE,
  MIN_HIT_SIZE,
  MIN_HIT_WORLD,
  PLANET_R,
  PROP_TABLE,
  REGION_IDS,
  SURF_HS,
  SURF_WS,
  footRadiusWorld,
  makeGate,
  pickSpawn,
  makeSlopeAt,
  type ScatterPropName,
} from '../src/scatter-rules';
import { buildHeightLattice, type V3 } from '../src/surface';
import { auditPlacements, auditRegions } from '../src/worldgen/core/audit';
import { mulberry32 } from '../src/worldgen/core/rng';
import { scatterClusters } from '../src/worldgen/core/scatter';
import type { BiomePlan, Placement } from '../src/worldgen/core/types';
import { validateBiomePlan } from '../src/worldgen/core/validate';
import { sphereDomain } from '../src/worldgen/domains/sphere';

// 网关地址由环境变量提供，不写死在源码里。**在真正发起请求时才校验**——
// 放在模块顶层会把不需要网络的路径（例如 plan-biome 的 --current 纯校准）一并挡住。
const BASE_URL = process.env.FORGEAX_LLM_BASE_URL ?? '';
function gatewayBase(): string {
  if (!BASE_URL) {
    throw new Error('FORGEAX_LLM_BASE_URL 未设置 —— 这些离线工具需要一个 LLM 网关地址；游戏本体运行不需要。');
  }
  return BASE_URL;
}
const DEFAULT_MODEL = 'claude-opus-4-8';
const DEFAULT_PLAN_SEED = 7;
const DEFAULT_RUNTIME_SEED = 1;
const REGION_AUDIT_SAMPLES = 200_000;

const INTENT_SYSTEM = `你是意图分析 agent。你的唯一职责是从用户的一句话星球世界观描述里抽取并归一化明确陈述的约束。

铁律:
- 只记录 prompt 字面说了的东西。
- 绝不发明内容、绝不补全空缺、绝不“合理推断”。
- 用户没提的属性就是没提，不要给默认值。
- 归一化只允许同义词归类和量词标准化，例如“很多树”可记为 density: high；不允许扩写。
- 每一条都必须带 evidence，且 evidence 必须是 prompt 中逐字出现的连续原文片段。
- 抽不出原文片段的条目不许写入。

只输出 JSON，不要解释。schema:
{
  "stated_regions": [{"region": string, "evidence": string}],
  "stated_world_attributes": [{"attribute": string, "value": string, "evidence": string}],
  "stated_vegetation": [{"subject": string, "region": string|null, "density": string|null, "clustering": string|null, "evidence": string}],
  "stated_rocks": [{"subject": string, "region": string|null, "density": string|null, "clustering": string|null, "evidence": string}],
  "stated_absences": [{"subject": string, "evidence": string}],
  "stated_relations": [{"relation": string, "evidence": string}]
}`;

const PLAN_SYSTEM = `你是场景规划 agent。上游意图分析 agent 已经抽出了用户明确陈述的约束。你的职责是解析歧义，并补齐 planet-snake 下游 scatter 模块需要但用户没说的属性。

出处边界是硬要求:
- provenance.user_stated 必须逐项复制 intent 中的全部 evidence 原文，不能漏、不能改写、不能加入任何 intent 没抽到的事实。
- 你补齐、选择或推断的每一项都必须明确写进 provenance.defaulted，绝不混进 user_stated。
- defaulted 必须非空。即使描述很详细，数值预算、尺寸、阈值或未指定区域的处理也属于 defaulted。

词表是硬约束:
- region 和 prop 只能使用输入给出的词表，绝不发明名字。
- prop 的 cat 和尺寸范围用于语义选型，例如小碎石与大石板不可混为一谈。

scatter 语义:
- cluster count 表示簇数范围，perCluster 表示每簇尝试放置数，radiusWorld 是簇半径（世界单位）。
- strayBudget 是全星球独立散点的尝试预算；strayByRegion 内的数值只是该 region 内 prop 的相对权重，不要求与 strayBudget 求和。
- stray 的每个预算槽会先在整个陆地采样一次；采到的 region 若没有权重表，该槽直接作废，不会转投其他 region。因此稀有/定向区域（如仅海岸灌木）应该建 cluster，不要用 stray。
- 如果 strayBudget 为 0，所有 strayByRegion 权重表必须为空。
- strayBudget 大于 0 时，某个 region 若在语义上就不该长这些东西（例如冰盖上不该有灌木），可以把它的权重表留空；代价是按该 region 的陆地占比损失同比例的预算槽，用调高 strayBudget 来补即可。不要为了填满而把植被硬塞进不该有的区域。
- kind 数量要克制：总共 2 到 6 种实际 kind（strayBudget > 0 时 stray 也算一种）。上限存在的唯一理由是每个 kind 的实测 n 必须达到 15，否则 Clark-Evans 报 n/a；不要为了凑数把语义不同的东西合并，也不要拆出撑不到 15 的碎 kind。
- 每个 cluster kind 的保守预算 count[0] * perCluster[0] 至少为 20，给 gate/spacing 拒绝留余量，确保 dry-run 实际 n 至少 15。
- 若使用 stray，strayBudget 至少 22，以确保实际 stray n 至少 15。
- minSpacingFactor 必须 >= 1，避免审计出现 spacing violation。
- 用户消息里会给出“已调好的表现参数”。这些是游戏里已经调过的值，除非世界观描述明确要求改变，否则必须原样沿用，并在 defaulted 里注明是沿用既有值。不要自己另选数值。
- 用户消息会给出“密度与难度预算”，是双向硬约束：致命障碍要落在给定区间内（既不能超，也不能砍到下限以下），非致命道具要达到给定下限。世界观描述讲的是风景，不是难度。
- prop 词表里的 lethal 字段表示该道具是否会注册碰撞。lethal=false 的道具只增加视觉密度、不改变游戏难度，因此“到处点缀 / 不留空地”这类诉求应优先用它们来满足，而不是靠增加 lethal 道具。
- “没有/看不见成片的树”等否定约束必须真正去掉或显著压低树，不可用默认森林覆盖。

只输出完整 BiomePlan JSON，不要解释。version 和 seed 必须使用用户消息给出的固定值，不得自行选择。schema:
{
  "version": 1,
  "seed": integer,
  "strayBudget": integer,
  "clusters": [{
    "kind": string,
    "region": allowed-region,
    "regionMin": number,
    "count": [integer, integer],
    "radiusWorld": [number, number],
    "perCluster": [integer, integer],
    "props": {"allowed-prop": positive-weight}
  }],
  "strayByRegion": {"allowed-region": {"allowed-prop": nonnegative-weight}},
  "minSpacingFactor": number,
  "darkFraction": number,
  "provenance": {"user_stated": [verbatim-intent-evidence], "defaulted": [string]}
}`;

interface CliOptions {
  prompt?: string;
  seed: number;
  runtimeSeed: number;
  model: string;
  write: boolean;
  current: boolean;
}

interface DryRunResult {
  placements: Placement<V3>[];
  kindCounts: Record<string, number>;
  spacingViolations: number;
  solid: number;
  lines: [string, string, string];
}

function usage(): never {
  throw new Error(
    '用法: bun tools/plan-biome.ts "<一句话世界观描述>" [--seed N] [--model M] [--write]\n'
    + '校准: bun tools/plan-biome.ts --current [--runtime-seed N]',
  );
}

function uint32(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffff_ffff) {
    throw new TypeError(`${flag} 必须是 0..4294967295 的整数`);
  }
  return parsed;
}

function parseArgs(argv: string[]): CliOptions {
  const positional: string[] = [];
  let seed = DEFAULT_PLAN_SEED;
  let runtimeSeed = DEFAULT_RUNTIME_SEED;
  let model = DEFAULT_MODEL;
  let write = false;
  let current = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--write') write = true;
    else if (arg === '--current') current = true;
    else if (arg === '--seed') seed = uint32(argv[++i] ?? usage(), '--seed');
    else if (arg === '--runtime-seed') runtimeSeed = uint32(argv[++i] ?? usage(), '--runtime-seed');
    else if (arg === '--model') model = argv[++i] ?? usage();
    else if (arg.startsWith('--')) throw new Error(`未知参数: ${arg}`);
    else positional.push(arg);
  }

  if (current) {
    if (positional.length > 0 || write) throw new Error('--current 不接受 prompt 或 --write');
    return { seed: BIOME_PLAN.seed, runtimeSeed, model, write: false, current: true };
  }
  if (positional.length !== 1 || positional[0]!.trim() === '') usage();
  return { prompt: positional[0]!, seed, runtimeSeed, model, write, current: false };
}

async function apiKey(): Promise<string> {
  if (process.env.FORGEAX_LLM_KEY) return process.env.FORGEAX_LLM_KEY;
  const wrapper = join(homedir(), '.local/bin/claude');
  const source = await readFile(wrapper, 'utf8');
  const match = source.match(/ANTHROPIC_API_KEY="([^"]*)"/);
  if (!match) throw new Error(`没能从 ${wrapper} 取到 key，且 FORGEAX_LLM_KEY 未设`);
  return match[1]!;
}

async function chatJson(system: string, prompt: string, model: string): Promise<unknown> {
  const response = await fetch(`${gatewayBase()}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${await apiKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      max_tokens: 8192,
    }),
    signal: AbortSignal.timeout(600_000),
  });
  const payload = await response.json() as {
    error?: unknown;
    choices?: { message?: { content?: string } }[];
  };
  if (!response.ok || payload.error) {
    throw new Error(`LiteLLM 调用失败 (${response.status}): ${JSON.stringify(payload.error ?? payload)}`);
  }
  const raw = payload.choices?.[0]?.message?.content ?? '';
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```\s*$/, '');
  }
  try {
    return JSON.parse(text);
  } catch {
    const fallback = text.match(/[\[{][\s\S]*[\]}]/)?.[0];
    if (!fallback) throw new Error(`模型没回 JSON，前 400 字:\n${text.slice(0, 400)}`);
    try {
      return JSON.parse(fallback);
    } catch (error) {
      throw new Error(`模型返回的 JSON 无法解析，前 400 字:\n${text.slice(0, 400)}`, { cause: error });
    }
  }
}

function collectIntentEvidence(value: unknown, prompt: string): string[] {
  const evidence: string[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, child] of Object.entries(node)) {
      if (key === 'evidence') {
        if (typeof child !== 'string' || child.length === 0 || !prompt.includes(child)) {
          throw new TypeError(`intent evidence 不是 prompt 的逐字原文: ${JSON.stringify(child)}`);
        }
        evidence.push(child);
      } else {
        visit(child);
      }
    }
  };
  visit(value);
  return [...new Set(evidence)];
}

function vocabulary(): {
  regions: readonly string[];
  props: { name: string; cat: string; size: readonly [number, number]; lethal: boolean }[];
} {
  return {
    regions: REGION_IDS,
    props: Object.entries(PROP_TABLE).map(([name, spec]) => ({
      name,
      cat: spec.cat,
      size: [spec.lo, spec.hi] as const,
      // 尺寸上限低于 MIN_HIT_SIZE 的道具永远不注册碰撞（main.ts 的 spawnProp
      // 里 `if (size < MIN_HIT_SIZE) return;`）。规划 agent 需要知道这件事：
      // 加这类道具只增加视觉密度，不改变游戏难度。
      lethal: spec.hi >= MIN_HIT_SIZE,
    })),
  };
}

// 这些不是模型该自由发挥的东西：它们是已经在游戏里调过的表现参数，改动会直接
// 影响观感。除非世界观描述明确要求改变，否则沿用。作为 defaulted 输入交给规划
// agent，而不是事后手改生成结果——生成文件的头注释写明手改会被覆盖。
const TUNED_DEFAULTS = {
  minSpacingFactor: BIOME_PLAN.minSpacingFactor,
  darkFraction: BIOME_PLAN.darkFraction,
} as const;

function validateGamePlan(
  plan: unknown,
  intentEvidence: readonly string[],
  enforceGenerationConstraints = true,
): asserts plan is BiomePlan {
  validateBiomePlan(plan, REGION_IDS);
  const allowed = new Set(Object.keys(PROP_TABLE));
  const invalid = new Set<string>();
  for (const cluster of plan.clusters) {
    for (const prop of Object.keys(cluster.props)) if (!allowed.has(prop)) invalid.add(prop);
  }
  for (const table of Object.values(plan.strayByRegion)) {
    for (const prop of Object.keys(table)) if (!allowed.has(prop)) invalid.add(prop);
  }
  if (invalid.size > 0) {
    throw new TypeError(`plan 使用了非法 prop: ${[...invalid].sort().join(', ')}`);
  }

  const strayWeight = Object.values(plan.strayByRegion)
    .flatMap((table) => Object.values(table))
    .reduce((sum, weight) => sum + weight, 0);
  if (plan.strayBudget === 0 && strayWeight !== 0) {
    throw new TypeError('strayBudget=0 时 strayByRegion 必须全部为空或零权重');
  }
  if (plan.strayBudget > 0 && strayWeight <= 0) {
    throw new TypeError('strayBudget>0 时 strayByRegion 至少要有一个正权重');
  }
  if (plan.minSpacingFactor < 1) {
    throw new TypeError('minSpacingFactor 必须 >= 1，才能保证 spacing audit 自洽');
  }

  if (enforceGenerationConstraints) {
    if (plan.clusters.some((cluster) => cluster.kind === 'stray')) {
      throw new TypeError('cluster kind "stray" 是 scatter 的保留名');
    }
    const actualKinds = new Set(plan.clusters.map((cluster) => cluster.kind));
    if (plan.strayBudget > 0) actualKinds.add('stray');
    if (actualKinds.size < 2 || actualKinds.size > 6) {
      throw new TypeError(`实际 kind 数必须在 2..6，收到 ${actualKinds.size}: ${[...actualKinds].join(', ')}`);
    }
    for (const cluster of plan.clusters) {
      if (cluster.count[0] * cluster.perCluster[0] < 20) {
        throw new TypeError(`cluster ${cluster.kind} 的保守预算不足 20`);
      }
    }
    if (plan.strayBudget > 0 && plan.strayBudget < 22) {
      throw new TypeError('启用 stray 时 strayBudget 必须至少为 22');
    }
    if (plan.strayBudget > 0) {
      // 一个 region 的 stray 表为空时，抽到它的那个预算槽会被 scatter.ts:106 的
      // `break` 直接作废（不是重抽）。但这不该是硬错误：现有手写 plan 就故意让
      // iceCap 为空——冰盖上不该长灌木——代价只是按该 region 的陆地占比损失几个
      // 槽位。真正会伤到结果的是 stray 总数塌掉，而那个由 assertDryRunQuality 的
      // n>=15 在**实测**上拦截，比这里的先验规则准。所以只警告，并提示补预算。
      const emptyRegions = REGION_IDS.filter((region) => {
        const table = plan.strayByRegion[region];
        return table === undefined || Object.values(table).reduce((sum, weight) => sum + weight, 0) <= 0;
      });
      if (emptyRegions.length > 0) {
        console.warn(
          `[worldclaw] 警告: stray 表为空的 region: ${emptyRegions.join(', ')}。`
          + '抽到它们的预算槽会作废，实际 stray 数会低于 strayBudget；'
          + '若下面 dry-run 的 stray n 偏低，把 strayBudget 调高来补。',
        );
      }
    }
  }

  // 出处边界只在**生成**时校验得了：它比对的是本次 intent agent 抽出的 evidence。
  // --current 读的是磁盘上已经生成好的方案，手里没有对应的 intent，拿空集合去比
  // 只会把每一条 user_stated 都判成"无法追溯"。（这条是实测踩出来的：方案还是
  // 手写、user_stated 为空时空集合恰好蒙对，一旦换成生成的方案就炸。）
  if (enforceGenerationConstraints) {
    const evidence = new Set(intentEvidence);
    const untraceable = plan.provenance.user_stated.filter((claim) => !evidence.has(claim));
    if (untraceable.length > 0) {
      throw new TypeError(`provenance.user_stated 含无法追溯到 intent evidence 的项: ${untraceable.join(' | ')}`);
    }
    if (intentEvidence.length > 0 && plan.provenance.user_stated.length === 0) {
      throw new TypeError('intent 有明确 evidence，但 provenance.user_stated 为空');
    }
    const stated = new Set(plan.provenance.user_stated);
    const omitted = intentEvidence.filter((claim) => !stated.has(claim));
    if (omitted.length > 0) {
      throw new TypeError(`provenance.user_stated 漏掉 intent evidence: ${omitted.join(' | ')}`);
    }
    if (plan.provenance.defaulted.length === 0) {
      throw new TypeError('provenance.defaulted 不能为空');
    }
  }
}

// 游戏的分类器是 ocean/biome 归属的唯一权威：把它的答案转成 one-hot 权重，而不是
// 在这里复制一份它的 ocean 判定和 tie-break 规则。与 main.ts 的 auditedRegionAt 同形。
function oneHotRegionAt(p: V3): Record<string, number> {
  const selected = argmaxRegionOrOcean(p);
  return {
    ocean: selected === 'ocean' ? 1 : 0,
    grassland: selected === 'grassland' ? 1 : 0,
    dry: selected === 'dry' ? 1 : 0,
    highland: selected === 'highland' ? 1 : 0,
    beach: selected === 'beach' ? 1 : 0,
    iceCap: selected === 'iceCap' ? 1 : 0,
  };
}

function solidCount(placements: Placement<V3>[]): number {
  let solid = 0;
  for (const placement of placements) {
    const spec = PROP_TABLE[placement.prop as ScatterPropName];
    if (spec === undefined) throw new Error(`[planet-snake] unknown scatter prop: ${placement.prop}`);
    if (spec.lo + placement.sizeU * (spec.hi - spec.lo) >= MIN_HIT_SIZE) solid++;
  }
  return solid;
}

function propBootSummary(placements: Placement<V3>[]): string {
  let solid = 0;
  let surfaceRadians = 0;
  for (const placement of placements) {
    const name = placement.prop as ScatterPropName;
    const spec = PROP_TABLE[name];
    if (spec === undefined) throw new Error(`[planet-snake] unknown scatter prop: ${placement.prop}`);
    const size = spec.lo + placement.sizeU * (spec.hi - spec.lo);
    if (size < MIN_HIT_SIZE) continue;
    solid++;
    const worldRadius = PROP_DATA[name].footLow * size * spec.wide * HIT_SCALE;
    const angle = Math.max(MIN_HIT_WORLD, worldRadius + HEAD_RADIUS * 0.6) / PLANET_R;
    surfaceRadians += 2 * Math.PI * (1 - Math.cos(angle));
  }
  return `[planet-snake] props: ${placements.length} placed, ${solid} solid, `
    + `hitboxes cover ${(100 * surfaceRadians / (4 * Math.PI)).toFixed(1)}% of the sphere`;
}

function dryRun(plan: BiomePlan, runtimeSeed: number): DryRunResult {
  const effectiveSeed = (runtimeSeed >>> 0) ^ plan.seed;
  const lattice = buildHeightLattice(SURF_WS, SURF_HS);
  const slopeAt = makeSlopeAt(lattice, () => 0);
  const domain = sphereDomain(PLANET_R);
  const placements = scatterClusters(
    domain,
    regionAt,
    plan,
    makeGate(slopeAt, pickSpawn(slopeAt, mulberry32(effectiveSeed ^ 0x5aed))),
    footRadiusWorld,
    mulberry32(effectiveSeed),
  );
  const regionAudit = auditRegions(
    domain,
    oneHotRegionAt,
    REGION_AUDIT_SAMPLES,
    mulberry32(effectiveSeed ^ 0xa11d17),
  );
  const placementAudit = auditPlacements(domain, placements, footRadiusWorld);
  const kindCounts: Record<string, number> = Object.fromEntries(
    plan.clusters.map((cluster) => [cluster.kind, 0]),
  );
  if (plan.strayBudget > 0) kindCounts.stray ??= 0;
  for (const placement of placements) {
    kindCounts[placement.kind] = (kindCounts[placement.kind] ?? 0) + 1;
  }
  const pct = (region: string): string => (
    100 * (regionAudit.areaFraction[region] ?? 0)
  ).toFixed(3);
  const kinds = Object.keys(placementAudit.clarkEvans).sort();
  const clusterStats = kinds.map((kind) => {
    const value = placementAudit.clarkEvans[kind];
    const ce = typeof value === 'number' ? value.toFixed(3) : (value ?? 'n/a');
    return `${kind} CE=${ce} (n=${kindCounts[kind] ?? 0})`;
  }).join('  ');
  return {
    placements,
    kindCounts,
    spacingViolations: placementAudit.spacingViolations,
    solid: solidCount(placements),
    lines: [
      propBootSummary(placements),
      `[planet-snake] regions: ocean ${pct('ocean')}%  grassland ${pct('grassland')}%  `
        + `dry ${pct('dry')}%  highland ${pct('highland')}%  beach ${pct('beach')}%  `
        + `iceCap ${pct('iceCap')}%  (n=${regionAudit.n}, argmax)`,
      `[planet-snake] clusters: ${clusterStats}  `
        + `spacingViolations=${placementAudit.spacingViolations}`,
    ],
  };
}

// 密度与难度的双向基准，全部**实测**自 tools/baseline-plan.ts（生成器上线前的
// 手调方案），不是写死的数字，也不读会被覆盖的 src/biome-plan.ts。
//
// 两个方向都要管住：
//   上限——世界观描述讲的是风景，不该顺手把游戏改难；
//   下限——只设上限时，模型会用"把什么都砍掉"来满足它（实测踩过：致命障碍被砍到
//         68、highland 整簇消失，星球比原来还空）。
const LETHAL_MIN = 0.85;
const LETHAL_MAX = 1.20;
const DECOR_MIN = 2.5;   // 非致命道具至少要到基准的 2.5 倍 —— 这次改动的目的本身

interface Baseline { lethal: number; decor: number }

function baseline(runtimeSeed: number): Baseline {
  const result = dryRun(BASELINE_PLAN, runtimeSeed);
  return { lethal: result.solid, decor: result.placements.length - result.solid };
}

function budgetBrief(base: Baseline): string {
  return `致命障碍(lethal=true)须落在 ${Math.round(base.lethal * LETHAL_MIN)}..`
    + `${Math.round(base.lethal * LETHAL_MAX)} 个之间（基准 ${base.lethal}）；`
    + `非致命道具(lethal=false)至少 ${Math.ceil(base.decor * DECOR_MIN)} 个（基准 ${base.decor}）。`
    + '视觉密度靠非致命道具堆，不要靠加树和大石头，也不要为了压致命数把整个星球砍空。';
}

function assertBudget(result: DryRunResult, base: Baseline): void {
  const decor = result.placements.length - result.solid;
  const lo = Math.round(base.lethal * LETHAL_MIN);
  const hi = Math.round(base.lethal * LETHAL_MAX);
  const decorFloor = Math.ceil(base.decor * DECOR_MIN);
  if (result.solid < lo || result.solid > hi) {
    throw new Error(
      `dry-run 难度门失败: 致命障碍 ${result.solid} 个，须落在 ${lo}..${hi}（基准 ${base.lethal}）。`
      + (result.solid > hi
        ? '把视觉密度改用 lethal=false 的道具来补，别加树和大石头。'
        : '砍得太狠了——障碍是玩法本身，别为了压数字把成簇的树和石阵删掉。'),
    );
  }
  if (decor < decorFloor) {
    throw new Error(
      `dry-run 密度门失败: 非致命道具 ${decor} 个，至少要 ${decorFloor}（基准 ${base.decor}）。`
      + '用灌木和小碎石把空地填起来。',
    );
  }
}

function assertDryRunQuality(result: DryRunResult): void {
  if (result.spacingViolations !== 0) {
    throw new Error(`dry-run spacing gate 失败: ${result.lines[2]}`);
  }
  const sparse = Object.entries(result.kindCounts).filter(([, count]) => count < 15);
  if (sparse.length > 0) {
    throw new Error(`dry-run kind 样本不足 15: ${sparse.map(([kind, count]) => `${kind}=${count}`).join(', ')}`);
  }
}

function renderBiomePlan(plan: BiomePlan, prompt: string, model: string): string {
  const date = new Date().toISOString();
  return `// 此文件由 tools/plan-biome.ts 生成，手改会被下次生成覆盖。\n`
    + `// 世界观 prompt: ${JSON.stringify(prompt)}\n`
    + `// 模型: ${model}\n`
    + `// 生成日期: ${date}\n\n`
    + `import type { BiomePlan } from './worldgen/core/types';\n\n`
    + `export const BIOME_PLAN: BiomePlan = ${JSON.stringify(plan, null, 2)};\n`;
}

async function writePlan(plan: BiomePlan, prompt: string, model: string): Promise<void> {
  const target = join(import.meta.dir, '..', 'src', 'biome-plan.ts');
  const temporary = `${target}.tmp`;
  await writeFile(temporary, renderBiomePlan(plan, prompt, model), 'utf8');
  await rename(temporary, target);
  console.log(`[worldclaw] 已写入 ${target}`);
}

const MAX_ATTEMPTS = 4;

async function generatePlan(
  options: CliOptions & { base: Baseline },
): Promise<{ intent: unknown; plan: BiomePlan; result: DryRunResult }> {
  const prompt = options.prompt!;
  console.log(`[worldclaw] intent agent: ${options.model}`);
  const intent = await chatJson(INTENT_SYSTEM, `用户的场景描述:\n\n${prompt}`, options.model);
  const intentEvidence = collectIntentEvidence(intent, prompt);
  console.log('[worldclaw] intent:');
  console.log(JSON.stringify(intent, null, 2));

  const brief = `原始 prompt:\n${prompt}\n\n`
    + `意图分析 agent 抽出的明确约束:\n${JSON.stringify(intent, null, 2)}\n\n`
    + `代码导出的硬词表:\n${JSON.stringify(vocabulary(), null, 2)}\n\n`
    + `游戏里已调好的表现参数（除非描述明确要求改变，否则原样沿用）:\n`
    + `${JSON.stringify(TUNED_DEFAULTS, null, 2)}\n\n`
    + `密度与难度预算: ${budgetBrief(options.base)}\n\n`
    + `固定字段: {"version":1,"seed":${options.seed}}\n\n`;

  // 生成是非确定性的，而校验门是确定性的：与其让人反复手动重跑，不如把失败原因
  // 回喂给规划 agent 自己修。实测两类失败都会发生——保守预算不足 20、致命障碍
  // 超预算——而两者模型都能在被告知后改对。
  let feedback = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`[worldclaw] planning agent: ${options.model} (第 ${attempt}/${MAX_ATTEMPTS} 次)`);
    const raw = await chatJson(PLAN_SYSTEM, brief + feedback + '请产出完整的 BiomePlan。', options.model);
    try {
      if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new TypeError('planning agent 没有返回 JSON object');
      }
      const plan = { ...(raw as Record<string, unknown>), version: 1, seed: options.seed };
      validateGamePlan(plan, intentEvidence);
      const result = dryRun(plan, options.runtimeSeed);
      assertDryRunQuality(result);
      assertBudget(result, options.base);
      return { intent, plan, result };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.log(`[worldclaw] 第 ${attempt} 次被门拒绝: ${reason}`);
      if (attempt === MAX_ATTEMPTS) throw error;
      feedback = `上一次你产出的方案被拒绝了，原因:\n${reason}\n\n`
        + '请针对这条原因修正后重新产出完整方案，其余约束不变。\n\n';
    }
  }
  throw new Error('unreachable');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.current) {
    validateGamePlan(BIOME_PLAN, [], false);
    const result = dryRun(BIOME_PLAN, options.runtimeSeed);
    for (const line of result.lines) console.log(line);
    return;
  }

  const base = baseline(options.runtimeSeed);
  console.log(`[worldclaw] 基准(冻结): 致命 ${base.lethal} / 非致命 ${base.decor}`);
  console.log(`[worldclaw] 目标: ${budgetBrief(base)}`);
  const { plan, result } = await generatePlan({ ...options, base });
  console.log('[worldclaw] plan:');
  console.log(JSON.stringify(plan, null, 2));
  for (const line of result.lines) console.log(line);
  console.log('[worldclaw] dry-run gate: PASS');
  if (options.write) await writePlan(plan, options.prompt!, options.model);
  else console.log('[worldclaw] 未写盘；加 --write 才会覆盖 src/biome-plan.ts');
}

await main();
