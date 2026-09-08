// 地形:解析高度场(渲染网格与行走用同一函数),可探索收边,路径中线。
// 布局坐标系:x 东(view_01 右),z 南(朝相机);相机在原点看 -z。见 REFERENCE.md §2b。
//
// 中景分三层(r5 并排比对后修正):挡土墙(~16m,矮)→ 花园坡 → 上层露台(y1.6)
// → 楼台基(y3.4)。参考图 u0.30-0.62 的石墙是低处挡土墙,不是露台圈。

export const TERRACE_CENTER: [number, number] = [5, -36];
export const TERRACE_R = 10.0;
export const TERRACE_Y = 1.6;    // 上层露台铺装面
export const HOUSE_BASE_Y = 3.4; // 楼台基(高于露台,楼顶≈17m → view_01 v≈0.19)

// 挡土墙(view_01 主中景):弧心/半径/角域(φ 从 +z 轴向西为正)
export const RWALL_C: [number, number] = [0, -24];
export const RWALL_R = 8.5;
export const RWALL_TOP = 1.0;

function plateauMask(x: number, z: number): number {
  const d = Math.hypot(x - TERRACE_CENTER[0], z - TERRACE_CENTER[1]);
  if (d <= TERRACE_R) return 1;
  const t = (d - TERRACE_R) / 7;
  if (t >= 1) return 0;
  return 1 - t * t * (3 - 2 * t);
}

export function groundHeight(x: number, z: number): number {
  // 起伏草甸
  let h = 0.45 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.05)
    + 0.30 * Math.sin(x * 0.11 + z * 0.07)
    + 0.18 * Math.sin(x * 0.021 - z * 0.033 + 2.0);
  // 出生点小丘(相机站位比洼地高)
  h += 1.0 * Math.exp(-((x - 1) * (x - 1) + (z - 2) * (z - 2)) / 140);
  // 挡土墙前洼地(REFERENCE §2b:墙顶低于眼线)
  h += -1.3 * Math.exp(-((z + 14) * (z + 14)) / 90) * Math.exp(-((x - 2) * (x - 2)) / 900);
  // 花园坡(挡土墙后爬升,接上层露台)
  h += 1.2 * Math.exp(-((z + 27) * (z + 27)) / 120) * Math.exp(-((x - 0) * (x - 0)) / 200);
  // 阶梯下方东北洼地
  h += -2.2 * Math.exp(-((x - 21) * (x - 21) + (z + 46) * (z + 46)) / 260);
  // 北坡(楼后树墙)
  if (z < -50) { const t = Math.min(1, (-50 - z) / 28); h += 9 * Math.pow(t, 1.7); }
  // 东坡 + 岩壁基座
  if (x > 24) { const t = Math.min(1, (x - 24) / 22); h += 6.5 * Math.pow(t, 1.8); }
  // 西缘缓升
  if (x < -36) { const t = Math.min(1, (-36 - x) / 24); h += 4 * t * t; }
  // 南缘缓升(推断补全:相机身后)
  if (z > 16) { const t = Math.min(1, (z - 16) / 16); h += 3.5 * t * t; }
  // 上层露台整平
  const k = plateauMask(x, z);
  return h * (1 - k) + TERRACE_Y * k;
}

// 可探索边界(与视觉收边一致;超界的移动被 clamp)
export function clampToBounds(x: number, z: number): [number, number] {
  const cx = Math.max(-52, Math.min(46, x));
  const cz = Math.max(-64, Math.min(26, z));
  return [cx, cz];
}

// 土路中线(A5):折线 + 宽度;绕挡土墙西端上花园坡到露台西侧
export const PATH_PTS: [number, number][] = [
  [3, 12], [0.5, 5], [-1.5, -2], [-3.5, -8], [-6, -14], [-8.5, -20], [-9, -26], [-7, -30.5], [-3.5, -33.5], [0.5, -35],
];
export const PATH_W = 3.4;

export function pathDistance(x: number, z: number): number {
  let best = 1e9;
  for (let i = 0; i + 1 < PATH_PTS.length; i++) {
    const [ax, az] = PATH_PTS[i], [bx, bz] = PATH_PTS[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
    const px = ax + dx * t, pz = az + dz * t;
    best = Math.min(best, Math.hypot(x - px, z - pz));
  }
  return best;
}
