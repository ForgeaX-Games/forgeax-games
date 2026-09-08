// 公共:调色板 / 太阳 / 网格构建器。
// 颜色是 sRGB 浮点 albedo,由 REFERENCE.md §5 的显示色反解估得,首帧后校正。
import { meshFromInterleaved } from '@forgeax/engine-geometry';
import type { MeshAsset } from '@forgeax/engine-types';

// ---- 光照参数(由 REFERENCE.md §6 明暗观测反解;不是观测本身) ----
// 观测:西面最亮、南面(朝相机)次亮、东面暗、屋顶左坡亮右坡暗 → 太阳在西南偏南、
// 仰角 ~46°。方向 = 光线传播方向(指向东北偏北、向下)。
const SL = Math.hypot(0.42, 0.78, 0.42);
export const SUN_DIR: [number, number, number] = [0.42 / SL, -0.78 / SL, -0.42 / SL];
export const SUN_COLOR: [number, number, number] = [1.0, 0.95, 0.83];
export const SUN_INTENSITY = 3.1;
export const SKY_COLOR: [number, number, number] = [0.48, 0.64, 0.92];
export const SKY_INTENSITY = 0.78;

// ---- albedo 调色板(sRGB) ----
export const C = {
  grass: [0.27, 0.49, 0.19, 1],
  grassDry: [0.62, 0.55, 0.32, 1],
  pathSand: [0.70, 0.63, 0.46, 1],
  terraceStone: [0.68, 0.58, 0.50, 1],
  houseWall: [0.74, 0.61, 0.45, 1],
  houseTrim: [0.52, 0.47, 0.40, 1],
  masonry: [0.66, 0.58, 0.46, 1],
  roofRed: [0.66, 0.40, 0.33, 1],
  roofRidge: [0.50, 0.25, 0.20, 1],
  woodDark: [0.42, 0.29, 0.18, 1],
  woodLight: [0.63, 0.46, 0.29, 1],
  wallStone: [0.46, 0.42, 0.31, 1],
  wallRock: [0.55, 0.50, 0.39, 1],
  pathRut: [0.52, 0.45, 0.32, 1],
  wallFrame: [0.68, 0.58, 0.42, 1],
  rock: [0.46, 0.51, 0.44, 1],
  canopyDark: [0.14, 0.30, 0.13, 1],
  canopyMid: [0.20, 0.40, 0.17, 1],
  canopyLight: [0.26, 0.48, 0.20, 1],
  trunk: [0.50, 0.37, 0.24, 1],
  flowerPurple: [0.74, 0.58, 0.94, 1],
  flowerBlue: [0.36, 0.52, 0.92, 1],
  flowerOrange: [0.95, 0.63, 0.24, 1],
  flowerWhite: [0.95, 0.95, 0.90, 1],
  pot: [0.68, 0.41, 0.26, 1],
  hay: [0.80, 0.66, 0.36, 1],
  soil: [0.30, 0.22, 0.15, 1],
  cabbage: [0.42, 0.62, 0.28, 1],
  glass: [0.35, 0.55, 0.68, 1],
  shutter: [0.26, 0.38, 0.30, 1],
  paper: [0.84, 0.78, 0.62, 1],
  // 远景直接用被大气洗过的观测显示色(配 unlit)
  mtnLit: [0.55, 0.67, 0.81, 1],
  mtnShade: [0.37, 0.50, 0.68, 1],
  snowLit: [0.88, 0.93, 0.98, 1],
  snowShade: [0.64, 0.78, 0.90, 1],
  farTrees: [0.34, 0.49, 0.48, 1],
  farMeadow: [0.45, 0.62, 0.42, 1],
} as const;

export type RGBA = readonly [number, number, number, number];

// ---- 网格构建器 ----
// 收集三角形,最后算平滑法线 + interleave 成 8 floats/vert 交给 meshFromInterleaved。
export let TRI_COUNT = 0;

export class MeshBuf {
  pos: number[] = [];
  idx: number[] = [];
  uv: number[] = [];
  /** 顶点独立法线覆盖(硬边用);null = 参与平滑 */
  nrmOverride: (readonly [number, number, number] | null)[] = [];

  vert(x: number, y: number, z: number, u = 0, v = 0, n: readonly [number, number, number] | null = null): number {
    const i = this.pos.length / 3;
    this.pos.push(x, y, z);
    this.uv.push(u, v);
    this.nrmOverride.push(n);
    return i;
  }
  tri(a: number, b: number, c: number): void { this.idx.push(a, b, c); }
  quad(a: number, b: number, c: number, d: number): void { this.tri(a, b, c); this.tri(a, c, d); }

  /** 追加另一个 buf(拼合静态装饰);sy2/sz2 缺省 = 均匀缩放 */
  append(o: MeshBuf, dx = 0, dy = 0, dz = 0, s = 1, yaw = 0, sy2?: number, sz2?: number): void {
    const base = this.pos.length / 3;
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const ky = sy2 ?? s, kz = sz2 ?? s;
    for (let i = 0; i < o.pos.length; i += 3) {
      const x = o.pos[i] * s, y = o.pos[i + 1] * ky, z = o.pos[i + 2] * kz;
      this.pos.push(x * cy + z * sy + dx, y + dy, -x * sy + z * cy + dz);
    }
    for (let i = 0; i < o.uv.length; i++) this.uv.push(o.uv[i]);
    for (const n of o.nrmOverride) {
      this.nrmOverride.push(n ? [n[0] * cy + n[2] * sy, n[1], -n[0] * sy + n[2] * cy] : null);
    }
    for (const i of o.idx) this.idx.push(base + i);
  }

  build(): MeshAsset {
    const nv = this.pos.length / 3;
    const nrm = new Float32Array(nv * 3);
    const p = this.pos, ix = this.idx;
    for (let t = 0; t < ix.length; t += 3) {
      const a = ix[t] * 3, b = ix[t + 1] * 3, c = ix[t + 2] * 3;
      const abx = p[b] - p[a], aby = p[b + 1] - p[a + 1], abz = p[b + 2] - p[a + 2];
      const acx = p[c] - p[a], acy = p[c + 1] - p[a + 1], acz = p[c + 2] - p[a + 2];
      const nx = aby * acz - abz * acy, ny = abz * acx - abx * acz, nz = abx * acy - aby * acx;
      for (const v of [ix[t], ix[t + 1], ix[t + 2]]) {
        nrm[v * 3] += nx; nrm[v * 3 + 1] += ny; nrm[v * 3 + 2] += nz;
      }
    }
    const verts = new Float32Array(nv * 8);
    for (let i = 0; i < nv; i++) {
      const o = this.nrmOverride[i];
      let nx = nrm[i * 3], ny = nrm[i * 3 + 1], nz = nrm[i * 3 + 2];
      if (o) { nx = o[0]; ny = o[1]; nz = o[2]; }
      const l = Math.hypot(nx, ny, nz) || 1;
      verts[i * 8] = p[i * 3]; verts[i * 8 + 1] = p[i * 3 + 1]; verts[i * 8 + 2] = p[i * 3 + 2];
      verts[i * 8 + 3] = nx / l; verts[i * 8 + 4] = ny / l; verts[i * 8 + 5] = nz / l;
      verts[i * 8 + 6] = this.uv[i * 2]; verts[i * 8 + 7] = this.uv[i * 2 + 1];
    }
    TRI_COUNT += ix.length / 3;
    const res = meshFromInterleaved(verts, new Uint32Array(ix)) as unknown as
      MeshAsset | { ok: boolean; value: MeshAsset; error?: unknown };
    if ('ok' in res) {
      if (!res.ok) throw new Error('meshFromInterleaved failed: ' + String((res as { error?: unknown }).error));
      return res.value;
    }
    return res;
  }
}

// 确定性伪随机(可复现)
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 列主序 TRS mat4 写入 instances 数组(只带 yaw + 各轴缩放) */
export function composeYaw(out: Float32Array, off: number, x: number, y: number, z: number, yaw: number, sx: number, sy: number, sz: number): void {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  out[off] = c * sx; out[off + 1] = 0; out[off + 2] = -s * sx; out[off + 3] = 0;
  out[off + 4] = 0; out[off + 5] = sy; out[off + 6] = 0; out[off + 7] = 0;
  out[off + 8] = s * sz; out[off + 9] = 0; out[off + 10] = c * sz; out[off + 11] = 0;
  out[off + 12] = x; out[off + 13] = y; out[off + 14] = z; out[off + 15] = 1;
}

// ---- 参数化基础形 ----

/** 旋转体:profile 为 [r, y] 折线,绕 Y 轴 seg 段 */
export function lathe(buf: MeshBuf, profile: readonly (readonly [number, number])[], seg = 12, capTop = false, capBottom = false): void {
  const rows: number[][] = [];
  for (const [r, y] of profile) {
    const row: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      row.push(buf.vert(Math.cos(a) * r, y, Math.sin(a) * r, i / seg, y));
    }
    rows.push(row);
  }
  for (let j = 0; j + 1 < rows.length; j++) {
    for (let i = 0; i < seg; i++) {
      buf.quad(rows[j][i + 1], rows[j][i], rows[j + 1][i], rows[j + 1][i + 1]);
    }
  }
  if (capTop) {
    const last = profile[profile.length - 1];
    const c = buf.vert(0, last[1], 0, 0.5, 0.5, [0, 1, 0]);
    const row = rows[rows.length - 1];
    for (let i = 0; i < seg; i++) buf.tri(row[i], c, row[i + 1]);
  }
  if (capBottom) {
    const c = buf.vert(0, profile[0][1], 0, 0.5, 0.5, [0, -1, 0]);
    for (let i = 0; i < seg; i++) buf.tri(rows[0][i + 1], c, rows[0][i]);
  }
}

/** 不规则凸团(变形球):树冠/石头/云/灌木 */
export function blob(buf: MeshBuf, rx: number, ry: number, rz: number, seed: number, rough = 0.22, segU = 10, segV = 7): void {
  const rnd = mulberry(seed);
  const f1 = 1.5 + rnd() * 2, f2 = 1.5 + rnd() * 2, p1 = rnd() * 6.28, p2 = rnd() * 6.28, p3 = rnd() * 6.28;
  const rows: number[][] = [];
  for (let j = 0; j <= segV; j++) {
    const t = (j / segV) * Math.PI;
    const row: number[] = [];
    for (let i = 0; i <= segU; i++) {
      const a = (i / segU) * Math.PI * 2;
      let sx = Math.sin(t) * Math.cos(a), sy = Math.cos(t), sz = Math.sin(t) * Math.sin(a);
      const d = 1 + rough * (Math.sin(f1 * a + p1) * Math.sin(f2 * t + p2) + 0.6 * Math.sin((f1 + f2) * (a - t) + p3)) * Math.sin(t);
      row.push(buf.vert(sx * rx * d, sy * ry * d, sz * rz * d, i / segU, j / segV));
    }
    rows.push(row);
  }
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      if (j > 0) buf.tri(rows[j][i], rows[j][i + 1], rows[j + 1][i + 1]);
      if (j < segV - 1) buf.tri(rows[j][i], rows[j + 1][i + 1], rows[j + 1][i]);
    }
  }
}

/** 圆角盒(棱上略收的 box,避免纯直棱):w/h/d 全尺寸,bevel 比例 */
export function softBox(buf: MeshBuf, w: number, h: number, d: number, bevel = 0.08): void {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const bx = hw * bevel * 2, by = hh * bevel * 2, bz = hd * bevel * 2;
  // 6 面各自独立顶点(硬边),面内缩出 bevel 由 8 角点 offset 造出微斜面
  const faces: [number[], number[], [number, number, number]][] = [
    [[-1, 1], [-1, 1], [0, 0, 1]], [[-1, 1], [-1, 1], [0, 0, -1]],
    [[-1, 1], [-1, 1], [1, 0, 0]], [[-1, 1], [-1, 1], [-1, 0, 0]],
    [[-1, 1], [-1, 1], [0, 1, 0]], [[-1, 1], [-1, 1], [0, -1, 0]],
  ];
  for (const [, , n] of faces) {
    const vs: number[] = [];
    for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      let x: number, y: number, z: number;
      if (n[0] !== 0) { x = n[0] * hw; y = sv * (hh - by); z = -n[0] * su * (hd - bz); }
      else if (n[1] !== 0) { x = su * (hw - bx); y = n[1] * hh; z = -n[1] * sv * (hd - bz); }
      else { x = n[2] * su * (hw - bx); y = sv * (hh - by); z = n[2] * hd; }
      vs.push(buf.vert(x, y, z, (su + 1) / 2, (sv + 1) / 2, n));
    }
    buf.quad(vs[0], vs[1], vs[2], vs[3]);
  }
  // 斜角环带略去(视觉上圆角由法线朝向即可);为形态加 4 条竖向斜面
  const corners: [number, number][] = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [cx, cz] of corners) {
    const a = buf.vert(cx * (hw - bx), -hh + by, cz * hd, 0, 0);
    const b = buf.vert(cx * hw, -hh + by, cz * (hd - bz), 1, 0);
    const c2 = buf.vert(cx * hw, hh - by, cz * (hd - bz), 1, 1);
    const d2 = buf.vert(cx * (hw - bx), hh - by, cz * hd, 0, 1);
    if (cx * cz > 0) buf.quad(a, b, c2, d2); else buf.quad(b, a, d2, c2);
  }
}
