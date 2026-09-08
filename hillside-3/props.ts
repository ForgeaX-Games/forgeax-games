// 物件网格:树/石/栅栏/草簇/花/灯柱/陶罐/木箱/木桶/告示牌。
// 形态按 REFERENCE.md §4:树冠=团簇椭球,石=圆钝分层,栅栏=歪斜圆木。
import type { MeshAsset } from '@forgeax/engine-types';
import { MeshBuf, blob, lathe, mulberry, softBox } from './lib';
import { plank } from './meshlib2';

/** 任意两点间圆管(局部小工具,栏杆/歪柱都靠它) */
export function tube(buf: MeshBuf, p0: readonly [number, number, number], p1: readonly [number, number, number], r0: number, r1: number, seg = 6): void {
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1], az = p1[2] - p0[2];
  const len = Math.hypot(ax, ay, az) || 1;
  const ux = ax / len, uy = ay / len, uz = az / len;
  // 正交基
  let bx = 0, by = 1, bz = 0;
  if (Math.abs(uy) > 0.9) { bx = 1; by = 0; }
  let sx = uy * bz - uz * by, sy = uz * bx - ux * bz, sz = ux * by - uy * bx;
  const sl = Math.hypot(sx, sy, sz) || 1; sx /= sl; sy /= sl; sz /= sl;
  const tx = uy * sz - uz * sy, ty = uz * sx - ux * sz, tz = ux * sy - uy * sx;
  const rows: number[][] = [];
  for (const [p, r] of [[p0, r0], [p1, r1]] as const) {
    const row: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const c = Math.cos(a) * r, s = Math.sin(a) * r;
      const vy = p[1] + sy * c + ty * s;
      // v 沿轴向走(按顶点高度),否则整根管子采样贴图同一行,纹理丢失
      row.push(buf.vert(p[0] + sx * c + tx * s, vy, p[2] + sz * c + tz * s, i / seg, vy * 0.45));
    }
    rows.push(row);
  }
  for (let i = 0; i < seg; i++) buf.quad(rows[0][i], rows[0][i + 1], rows[1][i + 1], rows[1][i]);
}

// ---- 树:弯干 + 团簇冠(两个网格,共用一套实例变换) ----
export function treeTrunkBuf(seed: number, height: number): MeshBuf {
  const buf = new MeshBuf();
  const rnd = mulberry(seed);
  const bendX = (rnd() - 0.5) * 0.9, bendZ = (rnd() - 0.5) * 0.9;
  const segs = 4;
  let px = 0, pz = 0;
  let prev: [number, number, number] = [0, 0, 0];
  for (let i = 1; i <= segs; i++) {
    const t = i / segs;
    px += bendX * (0.25 + 0.5 * rnd()) * t; pz += bendZ * (0.25 + 0.5 * rnd()) * t;
    const cur: [number, number, number] = [px, height * t, pz];
    tube(buf, prev, cur, 0.16 * (1.15 - t * 0.7) * (height / 3), 0.16 * (1.15 - (t + 1 / segs) * 0.7) * (height / 3), 7);
    prev = cur;
  }
  // 一根侧枝
  tube(buf, [prev[0] * 0.6, height * 0.62, prev[2] * 0.6], [prev[0] + 1.1, height * 0.85, prev[2] + 0.7], 0.10, 0.05, 5);
  return buf;
}
export function treeTrunk(seed: number, height: number): MeshAsset { return treeTrunkBuf(seed, height).build(); }

export function treeCanopyBuf(seed: number, r: number): MeshBuf {
  const buf = new MeshBuf();
  const rnd = mulberry(seed * 7 + 3);
  const n = 3 + Math.floor(rnd() * 3);
  blob(buf, r, r * 0.78, r, seed, 0.24);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, d = r * (0.5 + rnd() * 0.55);
    const sub = new MeshBuf();
    blob(sub, r * 0.55, r * 0.45, r * 0.55, seed + i * 13, 0.28, 8, 6);
    buf.append(sub, Math.cos(a) * d, (rnd() - 0.25) * r * 0.55, Math.sin(a) * d);
  }
  return buf;
}
export function treeCanopy(seed: number, r: number): MeshAsset { return treeCanopyBuf(seed, r).build(); }

// ---- 石头(圆钝,可分层叠置由实例摆) ----
export function rockBuf(seed: number): MeshBuf {
  const smooth = new MeshBuf();
  const rnd = mulberry(seed);
  const layers = 2 + Math.floor(rnd() * 2);
  let yy = 0;
  for (let i = 0; i < layers; i++) {
    const t = i / layers;
    const sc = 1 - t * 0.32;
    const ly = 0.42 * sc;
    const sub = new MeshBuf();
    blob(sub, sc, ly, 0.85 * sc, seed + i * 31, 0.24 + rnd() * 0.12, 8, 5);
    smooth.append(sub, (rnd() - 0.5) * 0.28, yy + ly * 0.55, (rnd() - 0.5) * 0.24, 1, rnd() * 6.28);
    yy += ly * 0.95;
  }
  // 硬面化:逐三角独立顶点 → flat shading 的岩石棱面
  const buf = new MeshBuf();
  for (let ti = 0; ti < smooth.idx.length; ti += 3) {
    const ids: number[] = [];
    for (let k = 0; k < 3; k++) {
      const vi = smooth.idx[ti + k];
      ids.push(buf.vert(smooth.pos[vi * 3], smooth.pos[vi * 3 + 1], smooth.pos[vi * 3 + 2], smooth.uv[vi * 2], smooth.uv[vi * 2 + 1]));
    }
    buf.tri(ids[0], ids[1], ids[2]);
  }
  return buf;
}
export function rockMesh(seed: number): MeshAsset { return rockBuf(seed).build(); }

// ---- 歪栅栏一段(≈2.2m,2 柱 2 横杆) ----
export function fenceMesh(seed: number): MeshAsset {
  const buf = new MeshBuf();
  const rnd = mulberry(seed);
  const lean = () => (rnd() - 0.5) * 0.22;
  const h = 0.85;
  tube(buf, [-1.05, 0, 0], [-1.05 + lean(), h + (rnd() - 0.5) * 0.1, lean()], 0.055, 0.045, 6);
  tube(buf, [1.05, 0, 0], [1.05 + lean(), h + (rnd() - 0.5) * 0.1, lean()], 0.055, 0.045, 6);
  // 两根下垂横杆
  for (const hy of [h * 0.55, h * 0.9]) {
    const sag = 0.06 + rnd() * 0.06;
    tube(buf, [-1.1, hy, 0.02], [0, hy - sag, 0.03], 0.035, 0.04, 5);
    tube(buf, [0, hy - sag, 0.03], [1.1, hy + (rnd() - 0.5) * 0.08, 0.02], 0.04, 0.035, 5);
  }
  return buf.build();
}

// ---- 草簇(5 片弯叶,双面材质) ----
export function grassTuftMesh(): MeshAsset {
  const buf = new MeshBuf();
  const rnd = mulberry(77);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + rnd() * 0.8;
    const dx = Math.cos(a), dz = Math.sin(a);
    const lean = 0.10 + rnd() * 0.14, hh = 0.24 + rnd() * 0.18;
    const b0 = buf.vert(dx * 0.03 - dz * 0.025, 0, dz * 0.03 + dx * 0.025);
    const b1 = buf.vert(dx * 0.03 + dz * 0.025, 0, dz * 0.03 - dx * 0.025);
    const tp = buf.vert(dx * lean, hh, dz * lean);
    buf.tri(b0, b1, tp);
  }
  return buf.build();
}

// ---- 花(茎 + 头) ----
export function flowerBuf(kind: 'round' | 'spike', seed: number): MeshBuf {
  const buf = new MeshBuf();
  if (kind === 'round') {
    tube(buf, [0, 0, 0], [0.02, 0.17, 0.015], 0.010, 0.008, 4);
    const head = new MeshBuf();
    blob(head, 0.042, 0.028, 0.042, seed, 0.4, 6, 4);
    buf.append(head, 0.02, 0.19, 0.015);
    // 小簇:两朵伴花
    buf.append(head, 0.07, 0.13, 0.05, 0.7);
    buf.append(head, -0.05, 0.11, -0.04, 0.6);
    tube(buf, [0.05, 0, 0.03], [0.07, 0.12, 0.05], 0.008, 0.007, 3);
    tube(buf, [-0.04, 0, -0.03], [-0.05, 0.10, -0.04], 0.008, 0.007, 3);
  } else {
    // 羽状穗(lupine):锥形穗
    tube(buf, [0, 0, 0], [0.02, 0.35, 0.02], 0.014, 0.012, 4);
    const head = new MeshBuf();
    lathe(head, [[0.005, 0], [0.075, 0.08], [0.06, 0.28], [0.008, 0.42]], 7, true);
    buf.append(head, 0.02, 0.32, 0.02);
  }
  return buf;
}
export function flowerMesh(kind: 'round' | 'spike', seed: number): MeshAsset { return flowerBuf(kind, seed).build(); }

// ---- 薰衣草株(3 穗:细茎 + 叠苞,总高 ~0.5m) ----
export function lupineBuf(seed: number): MeshBuf {
  const buf = new MeshBuf();
  const rnd = mulberry(seed);
  const spikes = 3;
  for (let s = 0; s < spikes; s++) {
    const bx = (rnd() - 0.5) * 0.14, bz = (rnd() - 0.5) * 0.14;
    const lean = (rnd() - 0.5) * 0.16;
    const h = 0.34 + rnd() * 0.16;
    tube(buf, [bx, 0, bz], [bx + lean, h * 0.55, bz + lean * 0.5], 0.012, 0.010, 4);
    const buds = 6;
    for (let k = 0; k < buds; k++) {
      const t = k / (buds - 1);
      const r = 0.042 * (1 - t * 0.55);
      const bud = new MeshBuf();
      blob(bud, r, r * 1.25, r, seed + s * 17 + k, 0.3, 5, 4);
      buf.append(bud, bx + lean * (0.55 + t * 0.45), h * (0.5 + t * 0.5), bz + lean * 0.5, 1, rnd() * 6.28);
    }
  }
  return buf;
}
export function lupineMesh(seed: number): MeshAsset { return lupineBuf(seed).build(); }

// ---- 灌木团 ----
export function bushBuf(seed: number): MeshBuf {
  const buf = new MeshBuf();
  blob(buf, 1, 0.7, 1, seed, 0.3, 9, 6);
  const sub = new MeshBuf();
  blob(sub, 0.6, 0.45, 0.6, seed + 5, 0.32, 7, 5);
  buf.append(sub, 0.7, 0.1, 0.3);
  buf.append(sub, -0.6, 0.05, -0.4, 0.9, 1.3);
  return buf;
}
export function bushMesh(seed: number): MeshAsset { return bushBuf(seed).build(); }

// ---- 弯钩灯柱(A12) ----
export function lampMesh(): MeshAsset {
  const buf = new MeshBuf();
  const pts: [number, number, number][] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    // 竖直 2.4m 后向 -x 弯钩
    const bend = Math.max(0, t - 0.62) / 0.38;
    pts.push([-Math.sin(bend * 1.5) * 0.75, 2.4 * Math.min(1, t / 0.92) + bend * 0.45, 0]);
  }
  for (let i = 0; i + 1 < pts.length; i++) tube(buf, pts[i], pts[i + 1], 0.06, 0.05, 6);
  // 挂灯:四柱框 + 顶盖 + 环钩
  const tip = pts[pts.length - 1];
  const ly = tip[1] - 0.42;
  for (const [cx, cz] of [[-0.09, -0.09], [0.09, -0.09], [0.09, 0.09], [-0.09, 0.09]] as const) {
    const post = new MeshBuf();
    softBox(post, 0.03, 0.30, 0.03, 0.1);
    buf.append(post, tip[0] + cx, ly + 0.15, tip[2] + cz);
  }
  const capT = new MeshBuf(); softBox(capT, 0.30, 0.05, 0.30, 0.1);
  buf.append(capT, tip[0], ly + 0.32, tip[2]);
  const capB = new MeshBuf(); softBox(capB, 0.26, 0.04, 0.26, 0.1);
  buf.append(capB, tip[0], ly, tip[2]);
  const peak = new MeshBuf();
  lathe(peak, [[0.13, 0], [0.02, 0.10]], 8, true);
  buf.append(peak, tip[0], ly + 0.345, tip[2]);
  tube(buf, [tip[0], tip[1], tip[2]], [tip[0], ly + 0.40, tip[2]], 0.015, 0.015, 4);
  return buf.build();
}
/** 灯笼玻璃芯(独立材质发光用) */
export function lampGlassMesh(): MeshAsset {
  const buf = new MeshBuf();
  softBox(buf, 0.15, 0.24, 0.15, 0.1);
  return buf.build();
}

// ---- 陶罐(lathe 圆鼓) ----
export function potMesh(): MeshAsset {
  const buf = new MeshBuf();
  lathe(buf, [[0.16, 0], [0.28, 0.10], [0.34, 0.34], [0.25, 0.56]], 14, false, true);
  // 口沿(外翻圆箍)
  lathe(buf, [[0.25, 0.56], [0.30, 0.585], [0.315, 0.635], [0.285, 0.675], [0.235, 0.66]], 14);
  // 盆土
  lathe(buf, [[0.02, 0.60], [0.22, 0.60]], 10, true);
  return buf.build();
}

// ---- 木箱(圆角) ----
export function crateMesh(): MeshAsset {
  const buf = new MeshBuf();
  // 四角柱
  for (const [cx, cz] of [[-0.46, -0.46], [0.46, -0.46], [0.46, 0.46], [-0.46, 0.46]] as const) {
    const post = new MeshBuf();
    softBox(post, 0.1, 1.0, 0.1, 0.1);
    buf.append(post, cx, 0, cz);
  }
  // 四面横板(每面 3 条,微错位)
  const rnd = mulberry(17);
  for (const face of [0, 1, 2, 3]) {
    const yawF = face * Math.PI / 2;
    for (let i = 0; i < 3; i++) {
      const py = -0.32 + i * 0.32 + (rnd() - 0.5) * 0.03;
      const b = new MeshBuf();
      softBox(b, 0.98, 0.26, 0.06, 0.08);
      buf.append(b, Math.sin(yawF) * 0.47, py, Math.cos(yawF) * 0.47, 1, yawF);
    }
  }
  // 顶板两条
  for (const off of [-0.24, 0.24]) {
    const b = new MeshBuf();
    softBox(b, 0.98, 0.06, 0.42, 0.08);
    buf.append(b, 0, 0.5, off);
  }
  return buf.build();
}

// ---- 木桶 ----
export function barrelMesh(): MeshAsset {
  const buf = new MeshBuf();
  // 板条(16 片,鼓形)
  const NS = 16;
  const prof: (readonly [number, number])[] = [[0.26, 0], [0.33, 0.22], [0.35, 0.42], [0.33, 0.62], [0.26, 0.82]];
  for (let i = 0; i < NS; i++) {
    const a0 = (i / NS) * Math.PI * 2 + 0.008, a1 = ((i + 1) / NS) * Math.PI * 2 - 0.008;
    const rows: number[][] = [];
    for (const [r, y] of prof) {
      rows.push([
        buf.vert(Math.cos(a0) * r, y, Math.sin(a0) * r, 0, y),
        buf.vert(Math.cos(a1) * r, y, Math.sin(a1) * r, 0.2, y),
      ]);
    }
    for (let j = 0; j + 1 < rows.length; j++) buf.quad(rows[j][1], rows[j][0], rows[j + 1][0], rows[j + 1][1]);
  }
  // 三道箍
  for (const [hy, hr] of [[0.14, 0.315], [0.42, 0.362], [0.70, 0.315]] as const) {
    lathe(buf, [[hr, hy - 0.025], [hr + 0.012, hy], [hr, hy + 0.025]], 16);
  }
  // 顶盖
  lathe(buf, [[0.005, 0.82], [0.25, 0.82]], 12, true);
  return buf.build();
}

// ---- 告示牌(A3:弧顶木框 + 板面) ----
export function boardMesh(): MeshAsset {
  const buf = new MeshBuf();
  // 两根柱
  tube(buf, [-0.95, 0, 0], [-0.95, 2.1, 0], 0.09, 0.08, 6);
  tube(buf, [0.95, 0, 0], [0.95, 2.1, 0], 0.09, 0.08, 6);
  // 板面 = 5 条横板(微错位)
  {
    const rnd2 = mulberry(9);
    for (let i = 0; i < 5; i++) {
      const b = new MeshBuf();
      softBox(b, 2.3 + (rnd2() - 0.5) * 0.06, 0.24, 0.08, 0.06);
      buf.append(b, (rnd2() - 0.5) * 0.03, 0.87 + i * 0.25, (rnd2() - 0.5) * 0.012);
    }
    // 背面斜撑横档
    const r1 = new MeshBuf();
    softBox(r1, 2.1, 0.1, 0.05, 0.1);
    buf.append(r1, 0, 1.0, -0.07);
    buf.append(r1, 0, 1.75, -0.07);
  }
  // 三联弧顶(REFERENCE §3):三个半圆片
  for (const [ox, r] of [[-0.72, 0.34], [0, 0.46], [0.72, 0.34]] as const) {
    const arc = new MeshBuf();
    const c: number[] = [];
    const n = 8;
    const f = arc.vert(0, 0, 0.045), bk = arc.vert(0, 0, -0.045);
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI;
      c.push(arc.vert(Math.cos(a) * r, Math.sin(a) * r, 0.045), arc.vert(Math.cos(a) * r, Math.sin(a) * r, -0.045));
    }
    for (let i = 0; i + 2 < c.length; i += 2) {
      arc.tri(f, c[i], c[i + 2]);
      arc.tri(bk, c[i + 3], c[i + 1]);
      arc.quad(c[i], c[i + 1], c[i + 3], c[i + 2]);
    }
    buf.append(arc, ox, 2.0, 0);
  }
  return buf.build();
}

// ---- 白纸片(贴告示牌) ----
export function paperMesh(rot = 0, w = 0.14, h = 0.18): MeshAsset {
  const buf = new MeshBuf();
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const pts: [number, number][] = [[-w, -h], [w, -h], [w, h], [-w, h]];
  const ids = pts.map(([x, y]) => buf.vert(x * cs - y * sn, x * sn + y * cs, 0, 0, 0, [0, 0, 1]));
  buf.quad(ids[0], ids[1], ids[2], ids[3]);
  return buf.build();
}
/** 绳圈(螺旋叠环) */
export function ropeCoilMesh(): MeshAsset {
  const buf = new MeshBuf();
  const turns = 3, seg = 14;
  let prev: [number, number, number] | null = null;
  for (let i = 0; i <= turns * seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const r = 0.16 - (i / (turns * seg)) * 0.03;
    const pt: [number, number, number] = [Math.cos(a) * r, 0.02 + (i / (turns * seg)) * 0.075, Math.sin(a) * r];
    if (prev) tube(buf, prev, pt, 0.021, 0.021, 4);
    prev = pt;
  }
  return buf.build();
}
/** 玻璃瓶(lathe) */
export function bottleMesh(seed: number): MeshAsset {
  const buf = new MeshBuf();
  const rnd = mulberry(seed);
  const h = 0.22 + rnd() * 0.12;
  lathe(buf, [[0.045, 0], [0.055, h * 0.15], [0.05, h * 0.55], [0.018, h * 0.72], [0.016, h * 0.95], [0.02, h]], 9, true, true);
  return buf.build();
}

// ---- 露台家具 ----
export function tableMesh(): MeshAsset {
  const buf = new MeshBuf();
  // 厚圆桌面 + 沿板
  lathe(buf, [[0.52, 0.70], [0.55, 0.72], [0.55, 0.775], [0.50, 0.775]], 12, true);
  lathe(buf, [[0.0, 0.70], [0.52, 0.70]], 12);
  // 四条外斜腿 + 十字撑
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    tube(buf, [Math.cos(a) * 0.42, 0, Math.sin(a) * 0.42], [Math.cos(a) * 0.30, 0.70, Math.sin(a) * 0.30], 0.032, 0.028, 5);
  }
  tube(buf, [-0.36, 0.28, 0], [0.36, 0.28, 0], 0.022, 0.022, 4);
  tube(buf, [0, 0.28, -0.36], [0, 0.28, 0.36], 0.022, 0.022, 4);
  return buf.build();
}
export function chairMesh(): MeshAsset {
  const buf = new MeshBuf();
  // 折叠椅:两侧 X 交叉腿
  for (const sx of [-0.20, 0.20]) {
    tube(buf, [sx, 0, 0.22], [sx, 0.44, -0.20], 0.022, 0.02, 5);
    tube(buf, [sx, 0, -0.22], [sx, 0.44, 0.20], 0.022, 0.02, 5);
    tube(buf, [sx, 0.44, -0.20], [sx, 0.90, -0.26], 0.02, 0.018, 5); // 靠背立柱
  }
  // 座面板条 ×4
  const rnd = mulberry(21);
  for (let i = 0; i < 4; i++) {
    const z = -0.16 + i * 0.11;
    plank(buf, [-0.23, 0.46, z], [0.23, 0.46, z], 0.09, 0.03, [0, 1, 0], 30 + i);
  }
  // 靠背板条 ×2
  plank(buf, [-0.21, 0.68, -0.225], [0.21, 0.68, -0.225], 0.09, 0.03, [0, 0, 1], 35);
  plank(buf, [-0.21, 0.84, -0.25], [0.21, 0.84, -0.25], 0.09, 0.03, [0, 0, 1], 36);
  void rnd;
  return buf.build();
}

// ---- 草叶卡(两片交叉 quad,贴 grassCard 贴图 + alphaCutoff;法线朝上随地面受光) ----
export function grassCardMesh(): MeshAsset {
  const buf = new MeshBuf();
  const w = 0.34, h = 0.48;
  for (const a of [0, Math.PI / 2]) {
    const dx = Math.cos(a) * w, dz = Math.sin(a) * w;
    const v0 = buf.vert(-dx, 0, -dz, 0, 1, [0, 1, 0]);
    const v1 = buf.vert(dx, 0, dz, 1, 1, [0, 1, 0]);
    const v2 = buf.vert(dx, h, dz, 1, 0, [0, 1, 0]);
    const v3 = buf.vert(-dx, h, -dz, 0, 0, [0, 1, 0]);
    buf.quad(v0, v1, v2, v3);
  }
  // 包围盒哨兵:引擎按"实体位姿×基础网格包围盒"给 Instances 做视锥剔除,
  // 草片基础网格只有半米——锚点一出画面整批草被剔。埋两个地下微三角撑大 AABB。
  for (const [gx, gz] of [[-75, -75], [75, 55]] as const) {
    const g0 = buf.vert(gx, -25, gz, 0, 0, [0, 1, 0]);
    const g1 = buf.vert(gx + 0.01, -25, gz, 0, 0, [0, 1, 0]);
    const g2 = buf.vert(gx, -25, gz + 0.01, 0, 0, [0, 1, 0]);
    buf.tri(g0, g1, g2);
  }
  return buf.build();
}
