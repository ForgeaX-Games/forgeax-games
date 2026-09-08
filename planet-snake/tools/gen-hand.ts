// 天门事件那只手的候选生成。三个 prompt 并行跑 —— gen3d 是任务队列，串行等
// 三次 6 分钟纯属浪费。
//
// 这只手在游戏里是**逆光剪影**（背后是金色日冕），所以唯一重要的是轮廓：正面、
// 五指张开、袖口要宽。表面细节一概看不见，别在 prompt 里浪费预算描述材质。

import { GEN3D_MODEL, download, gen3d, pickFormat } from './wc-gateway';

const OUT = '<资产缓存目录>/hands';

const CANDIDATES: { name: string; prompt: string }[] = [
  {
    name: 'xian_palm_front',
    prompt: 'a colossal immortal cultivator hand reaching down from the sky, seen from the front, '
      + 'palm facing the viewer, five long fingers spread wide apart, billowing wide robe sleeve '
      + 'flaring at the wrist, Chinese xianxia fantasy, imposing and menacing, strong readable '
      + 'silhouette, stylised low-poly game asset, flat shaded, no base plate, no ground',
  },
  {
    name: 'xian_claw_grasp',
    prompt: 'a giant clawed hand of a celestial immortal grasping downward, fingers curled like '
      + 'talons with long nails, ornate flowing wide sleeve at the wrist, Chinese xianxia fantasy, '
      + 'dramatic menacing silhouette seen from the front, stylised low-poly game asset, flat '
      + 'shaded, no base plate, no ground',
  },
  {
    name: 'xian_press_down',
    prompt: 'an enormous open palm of a sky deity pressing straight down toward the viewer, '
      + 'fingers splayed and slightly bent, heavy draped robe cuff around the wrist, Chinese '
      + 'xianxia immortal, seen head on, powerful dominating silhouette, stylised low-poly game '
      + 'asset, flat shaded, no base plate, no ground',
  },
];

const results = await Promise.allSettled(CANDIDATES.map(async ({ name, prompt }) => {
  console.log(`[hand] 起任务 ${name}`);
  const task = await gen3d({ prompt });
  const url = pickFormat(task, 'glb');
  if (!url) throw new Error(`${name} 没返回 glb`);
  const dest = await download(url, `${OUT}/${name}.glb`);
  console.log(`[hand] 完成 ${name} -> ${dest}`);
  return dest;
}));

for (let i = 0; i < results.length; i++) {
  const r = results[i]!;
  console.log(r.status === 'fulfilled'
    ? `  ok    ${CANDIDATES[i]!.name}`
    : `  FAIL  ${CANDIDATES[i]!.name}: ${r.reason}`);
}
console.log(`[hand] 模型: ${GEN3D_MODEL}，输出在 ${OUT}`);
