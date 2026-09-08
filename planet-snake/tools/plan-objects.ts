// WorldClaw Stage 3 —— O = F_region(P, T)
//
// 论文 §2.3 的链条：区域规划 agent 选区 → 从**记录的相机**渲染该区 → 地形条件化
// 构图 → 实例分割 → 逐实例重建 mesh → 由射线对应反解摆放 → refinement agent 复核。
//
// 参考实现：stage3_region.py（只读）。
// 它记在案的两处替换在本机同样成立，一并沿用：
//   1) 分割用 gemini 的 grounded detection（归一化 box）替代 SAM3 —— 网关没有任何
//      分割模型。代价：拿到的是 box 不是像素级 mask，实例边界更糙。
//   2) 重建用 hunyuan-3d-text（文生 3D）替代 SAM3D（单视图重建）—— 不是没有图生
//      3D，而是 hunyuan-3d-image 要求 image_url 公网可达，本机没有图床。代价：
//      重建的不再"长得像构图图里那一个"，只是同类物体。所以 detect 必须给出带
//      风格的具体 label（见 DETECT_PROMPT），风格信息全靠它传下去。
// 第三处替换（球面渲染，见 tools/region-shot.ts 文件头）。
//
// 摆放这一环比论文简单且更准：论文靠双相机射线对应逆解位置，我们持有解析高度场，
// 直接把 box 底边中心的视线打到地形上求交，是正问题的解。

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { BIOME_PLAN } from '../src/biome-plan';
import { PLANET_R, PROP_TABLE } from '../src/scatter-rules';
import { argmaxRegionOrOcean } from '../src/regions';
import type { V3 } from '../src/surface';
import {
  GEN3D_MODEL, TEXT_MODEL, VISION_MODEL,
  chatJson, download, gen3d, imageEdit, pickFormat, savePng,
} from './wc-gateway';
import { SphereCamera, groundRadius, writeFileEnsured } from './region-shot';

const REGION_PLAN_SYSTEM = `你是区域规划 agent。给你一个已生成的星球场景规格和一个区域，
请挑选**该区地形能够支撑**的物体来放置。

这是一个卡通低多边形的贪吃蛇星球游戏，物体是散布在地表的景物，玩家的蛇在它们之间穿行。
不要选水生物、不要选会动的生物、不要选建筑内部。

⚠️ 最重要的一条：**不要提任何游戏已经有的东西**。用户消息里会给出现有道具词表
（松树、阔叶树、灌木丛、各种石块……）。这一级存在的意义是给这颗星球加**它独有的、
词表里没有的**景物——地标、构筑物、奇异地质、遗迹一类。再要一批树和灌木等于白跑。

只输出 JSON:
{"objects": [{"category": str, "count": int, "note": str}], "style": str, "reason": str}
category 要具体（"倾斜的巨型石拱" 而不是 "岩石"）。style 一句话描述整体美术风格，
必须和"卡通低多边形、硬折面、饱和色"这套语言一致。
挑 2-3 类、总数 3-6 个就够——它们是地标，不是铺满地面的填充物。`;

const DETECT_PROMPT = `Detect the individual placeable objects that were added ON the terrain.
Decompose composite scenes: if you see a cluster of several distinct structures, return each
one SEPARATELY rather than one box for the whole group.
Ignore the ground, sky, water, distant hills and the horizon.
Give each a SPECIFIC label describing what it is and its visual style
(e.g. "leaning weathered stone arch", "cluster of tall crystalline spires"),
not a generic word like "object" or "structure".
Return ONLY JSON: [{"label": str, "box_2d": [ymin, xmin, ymax, xmax]}]
with coordinates normalised to 0-1000, at most 16 items, largest first.
Return [] if there are none.`;

const REFINE_SYSTEM = `你是摆放 refinement agent。给你一组从检测框反解出来的物体摆放，
请指出其中**明显不合理**的项并给出修正后的 size（世界单位）。

参照尺度：这颗星球半径 52 个世界单位，蛇身约 1 个单位宽，最高的松树约 9 个单位，
最大的巨石约 6 个单位。一个地标级构筑物 10-20 个单位是合理的，超过 25 就会
遮住半个屏幕。

⚠️ size 是该物体的**最大边**。按它实际是什么来判，不要一律套同一个尺寸。
拿不准就不要改 —— 漏修比错修便宜。

只输出 JSON: {"fixes": [{"index": int, "new_size": float, "reason": str}]}
没有问题就返回 {"fixes": []}。`;

// 重建出来的原始高模每个 55-65MB（150 万面 + 4K 贴图），**不能放在游戏目录里**：
// 4 个就把游戏目录从 11MB 撑到 251MB，而这个游戏是要打成几 MB 的试玩包分发的。
// 它们又必须留着——论文的"可复用原型"就是指这个，重生成一个要 6 分钟。所以缓存
// 在游戏目录外面，只有降过面的成品进 tools/models/。
const ASSET_CACHE = process.env.FORGEAX_WC_ASSET_CACHE
  ?? join(homedir(), '.cache', 'forgeax-wc-assets');

// 从代码导出，不手抄 —— 词表变了这里跟着变。Stage 3 靠它避开重复造已有的东西。
const EXISTING_VOCABULARY = Object.keys(PROP_TABLE);

interface Detection { label: string; box_2d: [number, number, number, number] }

export interface Placement {
  label: string;
  dir: V3;          // 球面方向（游戏就用这个摆）
  sizeWorld: number;
  distance: number;
  box: [number, number, number, number];
  sizeBeforeRefine?: number;
  refineReason?: string;
}

/**
 * box → 球面方向 + 世界尺度。
 *
 * 位置取 box **底边中心**的视线与地形的交点 —— 底边中心是物体与地面的接触点，
 * 用 box 中心会让所有东西悬空半个身高（stage3_region.py 记的教训）。
 * 尺度由角高度换算：图上像素高 ↔ 该距离上的真实高度。
 */
export function place(detections: Detection[], cam: SphereCamera): Placement[] {
  const { width, height_px, fovDeg } = cam.spec;
  // 垂直方向的像素焦距。参考实现用 lens/sensor*w（水平），这里相机是按 fov 定义的，
  // 所以走垂直等价式，别混用，混了尺度会差一个 aspect。
  const fy = (height_px / 2) / Math.tan((fovDeg * Math.PI) / 360);
  const out: Placement[] = [];
  for (const d of detections) {
    const box = d.box_2d;
    if (!Array.isArray(box) || box.length !== 4) continue;
    const [ymin, xmin, ymax, xmax] = box.map((v) => Number(v) / 1000) as [number, number, number, number];
    if (![ymin, xmin, ymax, xmax].every(Number.isFinite)) continue;
    const u = (xmin + xmax) / 2;
    const hit = cam.raycastTerrain(u, ymax);
    if (hit === null) continue;
    const dx = hit[0] - cam.pos[0], dy = hit[1] - cam.pos[1], dz = hit[2] - cam.pos[2];
    const distance = Math.hypot(dx, dy, dz);
    const pxH = Math.max((ymax - ymin) * height_px, 1);
    const sizeWorld = (pxH * distance) / fy;
    const len = Math.hypot(hit[0], hit[1], hit[2]) || 1;
    out.push({
      label: d.label ?? 'object',
      dir: [hit[0] / len, hit[1] / len, hit[2] / len],
      sizeWorld,
      distance,
      box: [xmin, ymin, xmax, ymax],
    });
  }
  return out;
}

async function refine(placements: Placement[], context: string): Promise<Placement[]> {
  if (placements.length === 0) return placements;
  const brief = placements.map((p, i) => ({
    index: i, label: p.label, size: Number(p.sizeWorld.toFixed(2)),
    distance: Number(p.distance.toFixed(1)),
  }));
  let out: any;
  try {
    out = await chatJson(
      `场景背景: ${context}\n\n摆放列表:\n${JSON.stringify(brief, null, 2)}`,
      { system: REFINE_SYSTEM, model: TEXT_MODEL },
    );
  } catch (error) {
    console.warn(`  [warn] refine 失败，保留原摆放: ${error}`);
    return placements;
  }
  for (const fix of out?.fixes ?? []) {
    const i = fix?.index;
    if (typeof i === 'number' && i >= 0 && i < placements.length && Number(fix.new_size) > 0) {
      placements[i]!.sizeBeforeRefine = placements[i]!.sizeWorld;
      placements[i]!.sizeWorld = Number(fix.new_size);
      placements[i]!.refineReason = String(fix.reason ?? '');
    }
  }
  return placements;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const arg = (name: string, fallback: string): string => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
  };
  const region = arg('region', 'grassland');
  const dir = arg('dir', `tools/wc-stage3/${region}`);
  const skipGen = args.includes('--no-3d');

  const camMeta = JSON.parse(await readFile(`${dir}/camera.json`, 'utf8'));
  const cam = new SphereCamera(camMeta.camera);
  const render = new Uint8Array(await readFile(`${dir}/render.png`));

  // 1. 区域规划 agent
  console.log(`[stage3] 区域规划 agent: ${TEXT_MODEL}`);
  const planned = await chatJson(
    `星球世界观与分区（Stage 1 产物）:\n${JSON.stringify({
      user_stated: BIOME_PLAN.provenance.user_stated,
      clusters: BIOME_PLAN.clusters.map((c) => ({ kind: c.kind, region: c.region })),
    }, null, 2)}\n\n`
    + `游戏**已有**的道具词表（这些一律不要再提）:\n${EXISTING_VOCABULARY.join('、')}\n\n`
    + `本次要放置的区域: ${region}\n\n`
    + '请给出该区应放置的、词表里没有的独有景物。',
    { system: REGION_PLAN_SYSTEM, model: TEXT_MODEL },
  );
  console.log(JSON.stringify(planned, null, 2));
  const style = String(planned.style ?? '');
  const objects: { category: string; count: number; note?: string }[] = planned.objects ?? [];
  if (objects.length === 0) throw new Error('区域规划 agent 没给出任何物体');

  // 2. 地形条件化构图 —— 关键是**不许重画地形和视角**
  console.log(`[stage3] 构图 (image edit)`);
  const want = objects.map((o) => `${o.count}x ${o.category}${o.note ? ` (${o.note})` : ''}`).join('; ');
  const comp = await imageEdit(
    `Add objects onto this existing 3D terrain render of a game planet's ${region} region. `
    + `Place: ${want}. Art style: ${style || 'stylised low-poly, flat-shaded, saturated colours'}. `
    + 'Keep the terrain, the camera viewpoint, the lighting and the horizon EXACTLY as they are — '
    + 'do not redraw or restyle the ground. The added objects must sit ON the ground surface with '
    + 'correct perspective and contact shadows, and must not overlap each other.',
    render,
  );
  await savePng(comp, `${dir}/composed.png`);
  console.log(`[stage3] 构图图 -> ${dir}/composed.png`);

  // 3. 检测
  console.log(`[stage3] 检测: ${VISION_MODEL}`);
  const detected = await chatJson(DETECT_PROMPT, { model: VISION_MODEL, images: [comp] });
  const detections: Detection[] = Array.isArray(detected) ? detected : (detected?.objects ?? []);
  console.log(`[stage3] 检出 ${detections.length} 个实例`);

  // 4. 摆放（射线求交）+ 5. refine
  let placements = place(detections, cam);
  console.log(`[stage3] 求交成功 ${placements.length}/${detections.length}`);
  placements = await refine(placements, `卡通低多边形贪吃蛇星球，半径 ${PLANET_R} 世界单位，${region} 区域`);

  for (const p of placements) {
    const landed = argmaxRegionOrOcean(p.dir);
    const radius = groundRadius(p.dir);
    console.log(
      `  ${p.label}  size=${p.sizeWorld.toFixed(1)}`
      + `${p.sizeBeforeRefine ? ` (refine: ${p.sizeBeforeRefine.toFixed(1)}→${p.sizeWorld.toFixed(1)})` : ''}`
      + `  落在 ${landed}  r=${radius.toFixed(2)}`,
    );
  }

  // 6. 重建 —— 同 label 只生成一次（论文的"可复用原型"），一次约 6 分钟
  const assets: Record<string, string> = {};
  if (!skipGen) {
    const labels = [...new Set(placements.map((p) => p.label))];
    console.log(`[stage3] 重建 ${labels.length} 个原型: ${GEN3D_MODEL}（每个约 6 分钟）`);
    for (const label of labels) {
      const safe = label.replace(/[^a-zA-Z0-9]+/g, '_').slice(0, 48);
      const dest = `${ASSET_CACHE}/${region}/${safe}.glb`;
      if (existsSync(dest)) { assets[label] = dest; console.log(`  [cache] ${label}`); continue; }
      try {
        const result = await gen3d({
          prompt: `a single ${label}, ${style}, game asset, neutral pose, full object, no base plate`,
        });
        const url = pickFormat(result, 'glb');
        if (!url) { console.warn(`  [warn] ${label} 没返回 glb`); continue; }
        assets[label] = await download(url, dest);
        console.log(`  [ok] ${label} -> ${dest}`);
      } catch (error) {
        // 单个资产失败不该中断整条链（参考实现同样的处理）
        console.warn(`  [warn] '${label}' 生成失败: ${error}`);
      }
    }
  }

  await writeFileEnsured(`${dir}/objects.json`, new TextEncoder().encode(JSON.stringify({
    region, style, planned, detections, placements, assets,
  }, null, 2)));
  console.log(`[stage3] -> ${dir}/objects.json`);
}
