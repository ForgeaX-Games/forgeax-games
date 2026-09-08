// 高密度程序化建模函数库(参数进、顶点出)。
// 所有 quad/tri 走 oriented 写入(法线朝 outward 提示方向),杜绝绕序事故。
import { MeshBuf, blob, mulberry } from './lib';

export type P3 = readonly [number, number, number];

const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: P3, b: P3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** 定向四边形:法线自动朝 outward 半空间 */
export function quadO(buf: MeshBuf, p: readonly P3[], out: P3, uv?: readonly (readonly [number, number])[]): void {
  const n = cross(sub(p[1], p[0]), sub(p[3], p[0]));
  const flip = dot(n, out) < 0;
  const idx = p.map((q, i) => buf.vert(q[0], q[1], q[2], uv?.[i]?.[0] ?? 0, uv?.[i]?.[1] ?? 0));
  if (flip) buf.quad(idx[3], idx[2], idx[1], idx[0]);
  else buf.quad(idx[0], idx[1], idx[2], idx[3]);
}

export function triO(buf: MeshBuf, p: readonly P3[], out: P3): void {
  const n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
  const flip = dot(n, out) < 0;
  const idx = p.map((q) => buf.vert(q[0], q[1], q[2]));
  if (flip) buf.tri(idx[2], idx[1], idx[0]);
  else buf.tri(idx[0], idx[1], idx[2]);
}

/** 通用棱柱盒(8 角点自定义),面法线定向;jitter 让石块不方 */
export function hexBox(buf: MeshBuf, corners: P3[], uvScale = 1): void {
  // corners: [下面 0-3 逆时针, 上面 4-7 对应]
  const c = corners;
  const ctr: P3 = [0, 0, 0].map((_, i) => c.reduce((s, q) => s + q[i], 0) / 8) as unknown as P3;
  const faces: [number, number, number, number][] = [
    [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7], [3, 2, 1, 0],
  ];
  for (const f of faces) {
    const pts = f.map((i) => c[i]);
    const fc: P3 = [0, 1, 2].map((i) => pts.reduce((s, q) => s + q[i], 0) / 4) as unknown as P3;
    const out = sub(fc, ctr);
    quadO(buf, pts, out, [[0, 0], [uvScale, 0], [uvScale, uvScale], [0, uvScale]]);
  }
}

/** 圆角石块:jitter 变形的低多边形团(≈80 tri) */
export function stone(buf: MeshBuf, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, seed: number, yaw = 0): void {
  const b = new MeshBuf();
  blob(b, 1, 1, 1, seed, 0.24, 8, 5);
  buf.append(b, cx, cy, cz, sx, yaw, sy, sz);
}

/** 木板(带微斜切与错位) */
export function plank(buf: MeshBuf, p0: P3, p1: P3, width: number, thick: number, up: P3, seed: number): void {
  const rnd = mulberry(seed);
  const ax = sub(p1, p0);
  const side = cross(ax, up);
  const sl = Math.hypot(side[0], side[1], side[2]) || 1;
  const s: P3 = [side[0] / sl * width / 2, side[1] / sl * width / 2, side[2] / sl * width / 2];
  const ul = Math.hypot(up[0], up[1], up[2]) || 1;
  const u: P3 = [up[0] / ul * thick / 2, up[1] / ul * thick / 2, up[2] / ul * thick / 2];
  const j = (): number => (rnd() - 0.5) * width * 0.12;
  const c: P3[] = [];
  for (const [end, ss, uu] of [[p0, -1, -1], [p1, -1, -1], [p1, 1, -1], [p0, 1, -1], [p0, -1, 1], [p1, -1, 1], [p1, 1, 1], [p0, 1, 1]] as const) {
    c.push([end[0] + s[0] * ss + u[0] * uu + j() * 0.3, end[1] + s[1] * ss + u[1] * uu, end[2] + s[2] * ss + u[2] * uu + j() * 0.3]);
  }
  hexBox(buf, c, 0.5);
}

/** 瓦楞条:一排筒瓦(正弦楞 + 行唇口),沿 +x,坡向 +z 下坡 dy */
export function tileStrip(buf: MeshBuf, len: number, depth: number, drop: number, period: number, amp: number, seed: number): void {
  const rnd = mulberry(seed);
  const nP = Math.max(3, Math.round(len / period));
  const segPerP = 4, nx = nP * segPerP;
  const rows = 3;
  const grid: number[][] = [];
  const colJit: number[] = [];
  for (let i = 0; i <= nP; i++) colJit.push((rnd() - 0.5) * amp * 0.5);
  for (let j = 0; j <= rows; j++) {
    const t = j / rows;
    const row: number[] = [];
    for (let i = 0; i <= nx; i++) {
      const u = i / nx;
      const ph = (i % segPerP) / segPerP;
      const wave = Math.sin(ph * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5; // 0..1 每瓦一楞
      const pIdx = Math.floor(i / segPerP);
      const h = amp * (0.35 + wave * 0.65) + (colJit[Math.min(pIdx, nP)] ?? 0) * t;
      // 行唇:前缘(t=1)抬高一点造叠瓦口
      const lip = t > 0.85 ? amp * 0.5 : 0;
      row.push(buf.vert(u * len, h + lip - t * drop, t * depth, u * (len / 0.9), t * 0.5));
    }
    grid.push(row);
  }
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < nx; i++) {
      quadO(buf, [
        [buf.pos[grid[j][i] * 3], buf.pos[grid[j][i] * 3 + 1], buf.pos[grid[j][i] * 3 + 2]],
        [buf.pos[grid[j][i + 1] * 3], buf.pos[grid[j][i + 1] * 3 + 1], buf.pos[grid[j][i + 1] * 3 + 2]],
        [buf.pos[grid[j + 1][i + 1] * 3], buf.pos[grid[j + 1][i + 1] * 3 + 1], buf.pos[grid[j + 1][i + 1] * 3 + 2]],
        [buf.pos[grid[j + 1][i] * 3], buf.pos[grid[j + 1][i] * 3 + 1], buf.pos[grid[j + 1][i] * 3 + 2]],
      ], [0, 1, 0.3]);
    }
  }
  // 行前缘立面(挡住行间穿视)
  for (let i = 0; i < nx; i++) {
    const a = grid[rows][i], b2 = grid[rows][i + 1];
    const pA: P3 = [buf.pos[a * 3], buf.pos[a * 3 + 1], buf.pos[a * 3 + 2]];
    const pB: P3 = [buf.pos[b2 * 3], buf.pos[b2 * 3 + 1], buf.pos[b2 * 3 + 2]];
    quadO(buf, [pA, pB, [pB[0], pB[1] - amp * 1.6, pB[2]], [pA[0], pA[1] - amp * 1.6, pA[2]]], [0, 0, 1]);
  }
}

/** 拱窗石框:半圆拱楔石 + 侧柱石 + 窗台;返回洞口内框尺寸由调用方放玻璃 */
export function archFrame(buf: MeshBuf, w: number, h: number, depth: number, blockT: number, seed: number): void {
  const rnd = mulberry(seed);
  const r = w / 2 + blockT / 2;
  const nV = 6; // 楔石数
  for (let i = 0; i < nV; i++) {
    const a0 = Math.PI * (i / nV), a1 = Math.PI * ((i + 1) / nV);
    const mid = (a0 + a1) / 2;
    const jr = 1 + (rnd() - 0.5) * 0.06;
    const c: P3[] = [];
    for (const [aa, rr, dd] of [
      [a0, w / 2 - 0.01, 1], [a1, w / 2 - 0.01, 1], [a1, r + blockT / 2 * jr, 1], [a0, r + blockT / 2 * jr, 1],
      [a0, w / 2 - 0.01, -1], [a1, w / 2 - 0.01, -1], [a1, r + blockT / 2 * jr, -1], [a0, r + blockT / 2 * jr, -1],
    ] as const) {
      c.push([Math.cos(aa) * rr, h / 2 + Math.sin(aa) * rr, dd * depth / 2]);
    }
    hexBox(buf, [c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]], 0.3);
  }
  // 侧柱石(左右各 3 块)
  const nJ = 3;
  for (const sgn of [-1, 1]) {
    for (let i = 0; i < nJ; i++) {
      const y0 = -h / 2 + (i / nJ) * h, y1 = -h / 2 + ((i + 1) / nJ) * h;
      const jw = blockT * (0.85 + rnd() * 0.35);
      const x0 = sgn * (w / 2 - 0.01), x1 = sgn * (w / 2 + jw);
      const c: P3[] = [
        [x0, y0, depth / 2], [x1, y0, depth / 2], [x1, y1 - 0.015, depth / 2], [x0, y1 - 0.015, depth / 2],
        [x0, y0, -depth / 2], [x1, y0, -depth / 2], [x1, y1 - 0.015, -depth / 2], [x0, y1 - 0.015, -depth / 2],
      ];
      hexBox(buf, c, 0.3);
    }
  }
  // 窗台(下沿外挑板)
  const c: P3[] = [
    [-w / 2 - blockT, -h / 2 - 0.10, depth * 0.75], [w / 2 + blockT, -h / 2 - 0.10, depth * 0.75],
    [w / 2 + blockT * 0.8, -h / 2 - 0.02, depth * 0.75], [-w / 2 - blockT * 0.8, -h / 2 - 0.02, depth * 0.75],
    [-w / 2 - blockT, -h / 2 - 0.10, -depth / 2], [w / 2 + blockT, -h / 2 - 0.10, -depth / 2],
    [w / 2 + blockT * 0.8, -h / 2 - 0.02, -depth / 2], [-w / 2 - blockT * 0.8, -h / 2 - 0.02, -depth / 2],
  ];
  hexBox(buf, [c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]], 0.4);
}

/** 角石(quoin)柱:交错长短石块沿竖直角线 */
export function quoinStack(buf: MeshBuf, x: number, z: number, y0: number, y1: number, size: number, yaw: number, seed: number): void {
  const rnd = mulberry(seed);
  const n = Math.max(2, Math.floor((y1 - y0) / (size * 0.55)));
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  for (let i = 0; i < n; i++) {
    const yy0 = y0 + (i / n) * (y1 - y0), yy1 = y0 + ((i + 1) / n) * (y1 - y0) - 0.02;
    const long = i % 2 === 0;
    const lx = (long ? size * 1.5 : size * 0.9) / 2, lz = (long ? size * 0.9 : size * 1.5) / 2;
    const d = size * 0.12;
    const pts: P3[] = [];
    for (const [ux, uz, uy] of [[-lx, -lz, 0], [lx, -lz, 0], [lx, lz, 0], [-lx, lz, 0], [-lx, -lz, 1], [lx, -lz, 1], [lx, lz, 1], [-lx, lz, 1]] as const) {
      const jx = ux + (rnd() - 0.5) * d, jz = uz + (rnd() - 0.5) * d;
      pts.push([x + jx * cy + jz * sy, uy ? yy1 : yy0, z - jx * sy + jz * cy]);
    }
    hexBox(buf, pts, 0.35);
  }
}

/** 分枝树干:递归 3 级,返回末梢点供挂冠 */
export function branchedTrunk(buf: MeshBuf, seed: number, height: number, r0: number): P3[] {
  const rnd = mulberry(seed);
  const tips: P3[] = [];
  const grow = (p: P3, dir: P3, len: number, r: number, level: number): void => {
    const segs = level === 0 ? 4 : 2;
    let cur = p, d = dir;
    for (let i = 0; i < segs; i++) {
      const t = (i + 1) / segs;
      const bend: P3 = [
        d[0] + (rnd() - 0.5) * 0.5 * (level + 1) * 0.4,
        Math.max(0.25, d[1] + (rnd() - 0.4) * 0.25),
        d[2] + (rnd() - 0.5) * 0.5 * (level + 1) * 0.4,
      ];
      const bl = Math.hypot(bend[0], bend[1], bend[2]) || 1;
      d = [bend[0] / bl, bend[1] / bl, bend[2] / bl];
      const next: P3 = [cur[0] + d[0] * len / segs, cur[1] + d[1] * len / segs, cur[2] + d[2] * len / segs];
      const rr0 = r * (1 - (i / segs) * 0.4), rr1 = r * (1 - t * 0.4);
      tubeSeg(buf, cur, next, rr0, rr1, level === 0 ? 8 : 5);
      cur = next;
    }
    if (level >= 2) { tips.push(cur); return; }
    const nB = level === 0 ? 3 + Math.floor(rnd() * 2) : 2;
    for (let k = 0; k < nB; k++) {
      const az = rnd() * Math.PI * 2;
      const spread = 0.55 + rnd() * 0.4;
      const nd: P3 = [
        d[0] * (1 - spread) + Math.cos(az) * spread,
        Math.max(0.3, d[1] * 0.8),
        d[2] * (1 - spread) + Math.sin(az) * spread,
      ];
      const nl = Math.hypot(nd[0], nd[1], nd[2]) || 1;
      grow(cur, [nd[0] / nl, nd[1] / nl, nd[2] / nl], len * (0.44 + rnd() * 0.12), r * 0.55, level + 1);
    }
    tips.push(cur);
  };
  grow([0, 0, 0], [(rnd() - 0.5) * 0.2, 1, (rnd() - 0.5) * 0.2], height, r0, 0);
  return tips;
}

/** 两点圆管(带正交基,树枝/杆件用) */
export function tubeSeg(buf: MeshBuf, p0: P3, p1: P3, r0: number, r1: number, seg: number): void {
  const ax = sub(p1, p0);
  const len = Math.hypot(ax[0], ax[1], ax[2]) || 1;
  const u: P3 = [ax[0] / len, ax[1] / len, ax[2] / len];
  let b: P3 = Math.abs(u[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const s0 = cross(u, b); const sl = Math.hypot(s0[0], s0[1], s0[2]) || 1;
  const s: P3 = [s0[0] / sl, s0[1] / sl, s0[2] / sl];
  const t = cross(u, s);
  const ring = (p: P3, r: number): P3[] => {
    const out: P3[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const cx = Math.cos(a) * r, sx = Math.sin(a) * r;
      out.push([p[0] + s[0] * cx + t[0] * sx, p[1] + s[1] * cx + t[1] * sx, p[2] + s[2] * cx + t[2] * sx]);
    }
    return out;
  };
  const A = ring(p0, r0), B = ring(p1, r1);
  for (let i = 0; i < seg; i++) {
    const pa = A[i], pb = A[i + 1], pc = B[i + 1], pd = B[i];
    const mid: P3 = [(pa[0] + pc[0]) / 2 - (p0[0] + p1[0]) / 2, (pa[1] + pc[1]) / 2 - (p0[1] + p1[1]) / 2, (pa[2] + pc[2]) / 2 - (p0[2] + p1[2]) / 2];
    // UV 必须显式传给 quadO:它自建顶点,缺省 uv=(0,0) 会让整管采样单 texel
    // (树干"没纹理"的事故根因)。u 沿圆周,v 按顶点高度走。
    quadO(buf, [pa, pb, pc, pd], mid, [
      [i / seg, pa[1] * 0.45], [(i + 1) / seg, pb[1] * 0.45],
      [(i + 1) / seg, pc[1] * 0.45], [i / seg, pd[1] * 0.45],
    ]);
  }
}
