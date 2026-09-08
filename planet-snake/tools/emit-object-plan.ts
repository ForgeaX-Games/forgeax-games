// 把 Stage 3 的求解结果（tools/wc-stage3/<region>/objects.json）落成游戏直接消费的
// src/object-plan.ts。
//
// 为什么是"照解出来的位置摆"而不是丢回 Stage 1 去散布：Stage 3 的产物 O 本身就是
// 位置——那些坐标是构图图里每个物体的接触点经射线求交反解出来的，重新散布等于把
// 这一级的全部信息扔掉，只留下"有这么个东西"。地标就该在它被构图到的地方。
//
// label → prop 名是人工映射：重建走的是 text2gen，同一个 label 只生成一个原型，
// 而 prop 名要进 PROP_TABLE 的封闭词表，两边不是一一自动对应的关系。

import { readFile } from 'node:fs/promises';
import { writeFileEnsured } from './region-shot';

const LABEL_TO_PROP: Record<string, string> = {
  'giant glowing dandelion with snake-like roots': 'wc_dandelion',
  'leaning stone pillar with grass on top': 'wc_earthPillar',
  'red and white spotted mushroom': 'wc_mushroomCap',
  'circular stone border': 'wc_stoneRing',
};

const regions = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (regions.length === 0) regions.push('grassland');

interface Entry { prop: string; dir: [number, number, number]; size: number; label: string; region: string }
const entries: Entry[] = [];
const skipped: string[] = [];

for (const region of regions) {
  const raw = JSON.parse(await readFile(`tools/wc-stage3/${region}/objects.json`, 'utf8'));
  for (const p of raw.placements ?? []) {
    const prop = LABEL_TO_PROP[p.label];
    if (prop === undefined) { skipped.push(`${region}: ${p.label}`); continue; }
    entries.push({
      prop,
      dir: p.dir.map((v: number) => Number(v.toFixed(6))) as [number, number, number],
      size: Number(p.sizeWorld.toFixed(2)),
      label: p.label,
      region,
    });
  }
}

const body = entries.map((e) =>
  `  { prop: '${e.prop}', dir: [${e.dir.join(', ')}], size: ${e.size} },`
    + `  // ${e.region}: ${e.label}`,
).join('\n');

await writeFileEnsured('src/object-plan.ts', new TextEncoder().encode(
  `// 此文件由 \`bun tools/emit-object-plan.ts\` 从 WorldClaw Stage 3 的求解结果生成，\n`
  + `// 手改会被下次生成覆盖。每一项的 dir 是构图图里该物体接触点的射线与地形的交点。\n`
  + `// 生成自: ${regions.map((r) => `tools/wc-stage3/${r}/objects.json`).join(', ')}\n\n`
  + `export interface PlannedObject {\n`
  + `  prop: string;\n`
  + `  /** 球面方向（单位向量）。 */\n`
  + `  dir: [number, number, number];\n`
  + `  /** 世界单位的最大边长度。 */\n`
  + `  size: number;\n`
  + `}\n\n`
  + `export const OBJECT_PLAN: PlannedObject[] = [\n${body}\n];\n`,
));

console.log(`[stage3] 写入 src/object-plan.ts：${entries.length} 个地标`);
for (const [prop, n] of Object.entries(
  entries.reduce<Record<string, number>>((m, e) => ({ ...m, [e.prop]: (m[e.prop] ?? 0) + 1 }), {}),
)) console.log(`  ${prop} x${n}`);
if (skipped.length > 0) console.log(`  [skip] 无 prop 映射: ${skipped.join(' | ')}`);
