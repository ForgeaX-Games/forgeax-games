// WorldClaw Stage 3 的「记录的相机」+ 球面地形渲染。
//
// 论文强调 "rendered from a recorded camera"：构图图上的像素坐标，只有配上产生
// 它的那个相机才有意义。参考实现 wc/stage3_region.py 把相机做成一个对象，好让
// 「渲染 / 构图 / 反解摆放三处用同一个」由构造保证，而不是靠三处各写一遍还记得对齐。
// 这里照做。
//
// 相对论文的**第三处记录在案的替换**（前两处见 stage3_region.py 的 docstring）：
// 渲染不截游戏画面，而是用同一份 surface.ts 高度场在 CPU 上光线步进。原因是
// 摆放要用的射线必须和产生像素的射线严格同源；截游戏画面就得再复刻一遍引擎的
// 投影矩阵和相机跟随逻辑，那是第二份拷贝，正是这个仓反复踩过的坑。代价是构图图
// 的底图不带游戏的着色器观感（草叶、雾、泛光都没有），但论文本来就说 I_comp 是
// "an explicit 2D layout prior"，约束的是物体外观与排布，不是最终几何。

import { deflateSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { PLANET_R, SURF_HS, SURF_WS } from '../src/scatter-rules';
import { argmaxRegionOrOcean } from '../src/regions';
import { buildHeightLattice, latticeHeight, warpedField, type V3 } from '../src/surface';

const lattice = buildHeightLattice(SURF_WS, SURF_HS);

/** 地表半径。与 main.ts 的 gr(d, 0) 同式：PLANET_R + 0.05 + 地形高度。 */
export function groundRadius(d: V3): number {
  return PLANET_R + 0.05 + latticeHeight(lattice, d);
}

const norm = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export interface CameraSpec {
  target: V3;        // 看向的球面方向（单位向量）
  height: number;    // 相机离地高度（世界单位）
  back: number;      // 沿 heading 反方向后退多少
  headingDeg: number;
  fovDeg: number;
  width: number;
  height_px: number;
}

export class SphereCamera {
  readonly pos: V3;
  readonly forward: V3;
  readonly right: V3;
  readonly up: V3;
  readonly spec: CameraSpec;

  constructor(spec: CameraSpec) {
    this.spec = spec;
    const t = norm(spec.target);
    // 切平面上的一组基，heading 在其中转
    const ref: V3 = Math.abs(t[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const east = norm(cross(ref, t));
    const north = cross(t, east);
    const a = (spec.headingDeg * Math.PI) / 180;
    const heading = norm(add(
      [east[0] * Math.cos(a), east[1] * Math.cos(a), east[2] * Math.cos(a)],
      north, Math.sin(a),
    ));
    const groundPoint: V3 = [
      t[0] * groundRadius(t), t[1] * groundRadius(t), t[2] * groundRadius(t),
    ];
    // 抬高 + 沿 heading 反向后退，和游戏里 __ps.cam(h, back, look) 是一个意思
    this.pos = add(add(groundPoint, t, spec.height), heading, -spec.back);
    // 看向目标点前方一点，避免正对脚下
    const lookAt = add(groundPoint, heading, spec.back * 0.35);
    this.forward = norm([lookAt[0] - this.pos[0], lookAt[1] - this.pos[1], lookAt[2] - this.pos[2]]);
    this.right = norm(cross(this.forward, t));
    this.up = cross(this.right, this.forward);
  }

  /** 归一化图像坐标 (u,v ∈ [0,1]，v 向下) → 世界空间射线方向。 */
  ray(u: number, v: number): V3 {
    const { width, height_px, fovDeg } = this.spec;
    const aspect = width / height_px;
    const tanHalf = Math.tan((fovDeg * Math.PI) / 360);
    const px = (u * 2 - 1) * tanHalf * aspect;
    const py = (1 - v * 2) * tanHalf;
    return norm(add(add(this.forward, this.right, px), this.up, py));
  }

  /**
   * 视线打到地形上求交。
   *
   * stage3_region.py 那条注释说得对：持有解析高度场时这是**正问题**，不需要像
   * 论文那样靠双相机射线对应去逆解。这里是球面版：沿射线步进，找 |p| 从高于
   * 地表半径穿到低于的那一步，再线性插值回交点。
   */
  raycastTerrain(u: number, v: number, steps = 3000): V3 | null {
    const o = this.pos;
    const d = this.ray(u, v);
    const far = PLANET_R * 2.2;
    const step = far / steps;
    let t = 0;
    let prev = Math.hypot(o[0], o[1], o[2]) - groundRadius(norm(o));
    for (let i = 0; i < steps; i++) {
      t += step;
      const p = add(o, d, t);
      const dir = norm(p);
      const cur = Math.hypot(p[0], p[1], p[2]) - groundRadius(dir);
      if (prev > 0 && cur <= 0) {
        const a = prev / (prev - cur + 1e-12);
        return add(o, d, t - step * (1 - a));
      }
      prev = cur;
    }
    return null;
  }

  toJSON(): Record<string, unknown> {
    return {
      ...this.spec,
      pos: this.pos, forward: this.forward, right: this.right, up: this.up,
      planetR: PLANET_R,
    };
  }
}

// ── 着色 ────────────────────────────────────────────────────────────────────
// 底图只要"地形读得懂"就够（见文件头对第三处替换的说明），所以用区域色 + 朗伯
// 光照，不复刻游戏着色器。

const REGION_RGB: Record<string, [number, number, number]> = {
  ocean: [38, 116, 148],
  beach: [214, 198, 152],
  grassland: [126, 158, 74],
  dry: [186, 166, 116],
  highland: [140, 138, 128],
  iceCap: [236, 240, 244],
};

const SUN: V3 = norm([0.45, 0.72, 0.53]);

function normalAt(d: V3): V3 {
  const e = 0.004;
  const ref: V3 = Math.abs(d[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const t1 = norm(cross(ref, d));
  const t2 = cross(d, t1);
  const r0 = groundRadius(d);
  const ra = groundRadius(norm(add(d, t1, e)));
  const rb = groundRadius(norm(add(d, t2, e)));
  // 切平面上的高度梯度 → 扰动法线
  const g1 = (ra - r0) / (e * PLANET_R);
  const g2 = (rb - r0) / (e * PLANET_R);
  return norm(add(add(d, t1, -g1), t2, -g2));
}

export function render(cam: SphereCamera): Uint8Array {
  const { width, height_px } = cam.spec;
  const rgb = new Uint8Array(width * height_px * 3);
  for (let y = 0; y < height_px; y++) {
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const v = (y + 0.5) / height_px;
      const hit = cam.raycastTerrain(u, v);
      let r: number; let g: number; let b: number;
      if (hit === null) {
        // 天空：上深下浅，和游戏里的星空底色同族
        const k = 1 - v;
        r = 24 + 46 * k; g = 34 + 60 * k; b = 58 + 78 * k;
      } else {
        const dir = norm(hit);
        const isOcean = warpedField(dir) <= 0;
        const key = isOcean ? 'ocean' : argmaxRegionOrOcean(dir);
        const base = REGION_RGB[key] ?? REGION_RGB.grassland!;
        const n = isOcean ? dir : normalAt(dir);
        const lambert = Math.max(0.12, dot(n, SUN));
        const shade = 0.35 + 0.75 * lambert;
        r = base[0] * shade; g = base[1] * shade; b = base[2] * shade;
      }
      const i = (y * width + x) * 3;
      rgb[i] = Math.min(255, Math.max(0, Math.round(r)));
      rgb[i + 1] = Math.min(255, Math.max(0, Math.round(g)));
      rgb[i + 2] = Math.min(255, Math.max(0, Math.round(b)));
    }
  }
  return encodePng(rgb, width, height_px);
}

// ── 最小 PNG 编码器 ─────────────────────────────────────────────────────────
// 只为了不给这个游戏加一个图像库依赖。RGB8 + 每行 filter 0，deflate 走 node:zlib。

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const body = out.subarray(4, 8 + data.length);
  view.setUint32(8 + data.length, crc32(body));
  return out;
}

export function encodePng(rgb: Uint8Array, width: number, height: number): Uint8Array {
  const raw = new Uint8Array(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', new Uint8Array(deflateSync(raw))),
    chunk('IEND', new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { png.set(p, off); off += p.length; }
  return png;
}

export async function writeFileEnsured(dest: string, bytes: Uint8Array): Promise<string> {
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, bytes);
  return dest;
}

// ── CLI：渲染一个区域的一张图，并把相机记录下来 ──────────────────────────────

if (import.meta.main) {
  const args = process.argv.slice(2);
  const flag = (name: string, fallback: number): number => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
  };
  const regionArg = (() => {
    const i = args.indexOf('--region');
    return i >= 0 ? args[i + 1]! : 'grassland';
  })();
  const outArg = (() => {
    const i = args.indexOf('--out');
    return i >= 0 ? args[i + 1]! : `tools/wc-stage3/${regionArg}`;
  })();
  const seed = flag('seed', 20260810);

  // 在目标区域里找一个既在陆地上、坡度又不极端的点
  let rng = seed >>> 0;
  const rand = (): number => {
    rng = (rng + 0x6D2B79F5) >>> 0;
    let t = Math.imul(rng ^ (rng >>> 15), 1 | rng);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let target: V3 | null = null;
  for (let i = 0; i < 400_000 && target === null; i++) {
    const z = 2 * rand() - 1;
    const phi = 2 * Math.PI * rand();
    const r = Math.sqrt(Math.max(0, 1 - z * z));
    const p: V3 = [r * Math.cos(phi), z, r * Math.sin(phi)];
    if (warpedField(p) <= 0) continue;
    if (argmaxRegionOrOcean(p) !== regionArg) continue;
    target = p;
  }
  if (target === null) throw new Error(`采样 400k 点没找到属于 '${regionArg}' 的陆地点`);

  const cam = new SphereCamera({
    target,
    height: flag('camheight', 9),
    back: flag('back', 16),
    headingDeg: flag('heading', 35),
    fovDeg: flag('fov', 55),
    width: flag('w', 1280),
    height_px: flag('h', 720),
  });
  const png = render(cam);
  await writeFileEnsured(`${outArg}/render.png`, png);
  await writeFileEnsured(
    `${outArg}/camera.json`,
    new TextEncoder().encode(JSON.stringify({ region: regionArg, seed, camera: cam.toJSON() }, null, 2)),
  );
  console.log(`[wc-stage3] ${regionArg}: ${outArg}/render.png (${cam.spec.width}x${cam.spec.height_px})`);
  console.log(`[wc-stage3] target=${target.map((v) => v.toFixed(4)).join(',')} camera 已记录`);
}
