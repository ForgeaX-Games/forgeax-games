// 程序化贴图:albedo + 法线(高度场求导)。lit 材质贴图烘 albedo,unlit 烘显示值。
// uploadTexture 已验证;每张失败独立降级(undefined → 纯色/无法线)。
import type { TextureAsset } from '@forgeax/engine-types';
import { unwrapHandle } from '@forgeax/engine-types';
import type { World } from '@forgeax/engine-ecs';
import { mulberry } from './lib';
import { PATH_PTS, PATH_W, RWALL_C, RWALL_R, TERRACE_CENTER, TERRACE_R } from './terrain';

export interface TexSet {
  ground?: number; groundN?: number;
  stone?: number; stoneN?: number;
  roof?: number; roofN?: number;
  plaster?: number; plasterN?: number;
  bark?: number;
  mtn?: number;
  canopy?: number;
  grassCard?: number;
  fog?: number;
  failures: string[];
}

type Renderer = { store: { uploadTexture?: (h: unknown, pod: unknown, dec: unknown) => Promise<{ ok: boolean }> } };

// ---- 可平铺 value noise ----
function makeNoise(seed: number, grid: number): (x: number, y: number) => number {
  const rnd = mulberry(seed);
  const lat = new Float32Array(grid * grid);
  for (let i = 0; i < lat.length; i++) lat[i] = rnd();
  const at = (ix: number, iy: number): number => lat[((iy % grid + grid) % grid) * grid + ((ix % grid + grid) % grid)];
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
function fbm(seed: number, grid: number, octaves = 3): (x: number, y: number) => number {
  const fns = Array.from({ length: octaves }, (_, i) => makeNoise(seed + i * 131, grid << i));
  return (x, y) => {
    let v = 0, amp = 0.5, f = 1;
    for (const fn of fns) { v += fn(x * f, y * f) * amp; amp *= 0.5; f *= 2; }
    return v / (1 - Math.pow(0.5, octaves));
  };
}

const put = (data: Uint8Array, o: number, r: number, g: number, b: number, a = 255): void => {
  data[o] = Math.max(0, Math.min(255, Math.round(r)));
  data[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
  data[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
  data[o + 3] = a;
};
const mix = (a: readonly number[], b: readonly number[], t: number): number[] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const colorTex = (W: number, H: number, data: Uint8Array, mip: boolean): TextureAsset =>
  ({ kind: 'texture', width: W, height: H, format: 'rgba8unorm-srgb', data, colorSpace: 'srgb', mipmap: mip } as unknown as TextureAsset);

/** 高度场(环绕) → 切空间法线贴图(rgba8unorm linear) */
function heightToNormal(hgt: Float32Array, W: number, H: number, strength: number): TextureAsset {
  const data = new Uint8Array(W * H * 4);
  const at = (x: number, y: number): number => hgt[((y + H) % H) * W + ((x + W) % W)];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      put(data, (y * W + x) * 4, (-dx / l * 0.5 + 0.5) * 255, (-dy / l * 0.5 + 0.5) * 255, (1 / l * 0.5 + 0.5) * 255);
    }
  }
  return { kind: 'texture', width: W, height: H, format: 'rgba8unorm', data, colorSpace: 'linear', mipmap: true } as unknown as TextureAsset;
}

// ---- 地表(1024²,世界映射 x[-80,80] z[-100,40])----
function paintGroundPair(): [TextureAsset, TextureAsset] {
  const W = 1024, H = 1024;
  const data = new Uint8Array(W * H * 4);
  const hgt = new Float32Array(W * H);
  const nBig = fbm(11, 8, 3), nMid = fbm(23, 24, 3), nFine = makeNoise(37, 192), nDry = fbm(53, 12, 2);
  const gDark = [48, 96, 30], gBase = [74, 124, 42], gYell = [106, 136, 44];
  const dry = [156, 132, 70], sand = [174, 154, 114], rut = [132, 112, 78];
  for (let py = 0; py < H; py++) {
    const z = -100 + (py / H) * 140;
    for (let px = 0; px < W; px++) {
      const x = -80 + (px / W) * 160;
      const u = px / W, v = py / H;
      const t1 = nBig(u * 8, v * 8), t2 = nMid(u * 24, v * 24);
      let c = mix(gDark, gBase, Math.min(1, t1 * 1.15));
      c = mix(c, gYell, Math.max(0, t2 - 0.50) * 1.9);
      const d = nDry(u * 12, v * 12);
      if (d > 0.56) c = mix(c, dry, Math.min(1, (d - 0.56) * 4.0));
      const f = 0.90 + nFine(u * 192, v * 192) * 0.2;
      c = [c[0] * f, c[1] * f, c[2] * f];
      let hh = nFine(u * 192, v * 192) * 0.5 + nMid(u * 24, v * 24) * 0.5;
      let pd = 1e9;
      for (let i = 0; i + 1 < PATH_PTS.length; i++) {
        const [ax, az] = PATH_PTS[i], [bx, bz] = PATH_PTS[i + 1];
        const dx = bx - ax, dz = bz - az;
        const tt = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz)));
        pd = Math.min(pd, Math.hypot(ax + dx * tt - x, az + dz * tt - z));
      }
      const half = PATH_W / 2;
      if (pd < half + 1.6) {
        const edge = Math.max(0, Math.min(1, (half + 0.7 - pd) / 0.8 + (nFine(u * 160, v * 160) - 0.5) * 0.7));
        let sc: readonly number[] = sand;
        const rd = Math.abs(pd - half * 0.52);
        if (rd < 0.20) { sc = mix(sand, rut, 0.8); hh -= 0.35 * edge; }
        const sf = 0.92 + nFine(u * 220, v * 220) * 0.16;
        c = mix(c, [sc[0] * sf, sc[1] * sf, sc[2] * sf], edge);
        hh -= 0.15 * edge;
      }
      // 接地暗带(假 AO):墙根/台基/岩底/露台缘的接触阴影
      let ao = 1;
      const aoAdd = (d: number, reach: number, depth: number): void => {
        if (d < reach) ao = Math.min(ao, 1 - depth * (1 - Math.max(0, d) / reach));
      };
      {
        // 挡土墙弧(φ -18..42°,墙厚 0.6)
        const dxw = x - RWALL_C[0], dzw = z - RWALL_C[1];
        const phi = Math.atan2(-dxw, dzw) * 180 / Math.PI;
        if (phi > -22 && phi < 46) aoAdd(Math.abs(Math.hypot(dxw, dzw) - RWALL_R) - 0.35, 1.0, 0.42);
        // 露台缘(外侧一圈)
        const dter = Math.hypot(x - TERRACE_CENTER[0], z - TERRACE_CENTER[1]) - (TERRACE_R + 0.4);
        if (dter > 0) aoAdd(dter, 1.1, 0.38);
        // 台基矩形(房子,yaw 0.22)
        const hx = x - 7.5, hz = z + 45;
        const cy2 = Math.cos(0.22), sy2 = Math.sin(0.22);
        const lx = hx * cy2 - hz * sy2, lz = hx * sy2 + hz * cy2 - 1.0;
        const dRect = Math.max(Math.abs(lx) - 8.0, Math.abs(lz) - 7.1);
        if (dRect > 0) aoAdd(dRect, 1.2, 0.45);
        // 大岩石底
        for (const [rx, rz, rs] of [[27, -30, 3.2], [30, -34, 4.4], [26.5, -27, 2.2], [33, -39, 5.2], [29, -31.5, 2.6]] as const) {
          aoAdd(Math.hypot(x - rx, z - rz) - rs * 0.85, 0.9, 0.4);
        }
      }
      put(data, (py * W + px) * 4, c[0] * ao, c[1] * ao, c[2] * (ao * 0.94 + 0.06));
      hgt[py * W + px] = hh;
    }
  }
  return [colorTex(W, H, data, false), heightToNormal(hgt, W, H, 2.2)];
}

// ---- 乱石墙(512²)----
function paintStonePair(): [TextureAsset, TextureAsset] {
  const W = 512, H = 512;
  const data = new Uint8Array(W * H * 4);
  const hgt = new Float32Array(W * H);
  const rnd = mulberry(71);
  const NS = 42;
  const seeds: [number, number, number][] = [];
  for (let i = 0; i < NS; i++) seeds.push([rnd(), rnd(), 0.75 + rnd() * 0.5]);
  const nFine = makeNoise(97, 96);
  const mortar = [80, 72, 60];
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const u = px / W, v = py / H;
      let d1 = 9, d2 = 9, s1 = 0;
      for (let i = 0; i < NS; i++) {
        const s = seeds[i];
        let du = Math.abs(u - s[0]); if (du > 0.5) du = 1 - du;
        let dv = Math.abs(v - s[1]); if (dv > 0.5) dv = 1 - dv;
        const d = Math.hypot(du, dv) / s[2];
        if (d < d1) { d2 = d1; d1 = d; s1 = i; }
        else if (d < d2) d2 = d;
      }
      const gap = d2 - d1;
      const sr = mulberry(s1 * 977 + 13);
      const tone = 0.80 + sr() * 0.40;
      const fam = sr();
      // 三色系:米黄 / 玫瑰灰 / 冷灰
      const famC = fam < 0.45 ? [156, 140, 106] : fam < 0.75 ? [158, 132, 120] : [138, 136, 128];
      let c = [famC[0] * tone, famC[1] * tone, famC[2] * tone];
      const bevel = Math.max(0, Math.min(1, gap * 14));
      c = mix(mortar, c, Math.min(1, bevel + 0.05));
      c = [c[0] * (0.94 + bevel * 0.12), c[1] * (0.94 + bevel * 0.12), c[2] * (0.94 + bevel * 0.12)];
      const f = 0.92 + nFine(u * 96, v * 96) * 0.16;
      put(data, (py * W + px) * 4, c[0] * f, c[1] * f, c[2] * f);
      hgt[py * W + px] = Math.min(1, gap * 7) + nFine(u * 96, v * 96) * 0.12;
    }
  }
  return [colorTex(W, H, data, true), heightToNormal(hgt, W, H, 5.5)];
}

// ---- 瓦顶(256²)----
function paintRoofPair(): [TextureAsset, TextureAsset] {
  const W = 256, H = 256;
  const data = new Uint8Array(W * H * 4);
  const hgt = new Float32Array(W * H);
  const nFine = makeNoise(59, 64);
  const RIDGES = 8, ROWS = 4;
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const u = px / W, v = py / H;
      const row = Math.floor(v * ROWS);
      const rr = mulberry(row * 613 + 7)();
      const colJit = mulberry((row * 31 + Math.floor(((u + row * 0.13) % 1) * RIDGES)) * 389)();
      const ph = ((u + row * 0.13) * RIDGES) % 1;
      const crest = Math.sin(ph * Math.PI);
      const rv = (v * ROWS) % 1;
      const lap = rv > 0.88 ? 0.68 + (rv - 0.88) * 1.6 : rv < 0.10 ? 1.08 : 1.0;
      const base = [201, 108, 86];
      let tone = (0.70 + crest * 0.36) * lap * (0.90 + rr * 0.18) * (0.88 + colJit * 0.22);
      tone *= 0.93 + nFine(u * 64, v * 64) * 0.14;
      put(data, (py * W + px) * 4, base[0] * tone, base[1] * tone, base[2] * tone);
      hgt[py * W + px] = crest * 0.8 + (rv > 0.88 ? -0.5 : 0);
    }
  }
  return [colorTex(W, H, data, true), heightToNormal(hgt, W, H, 3.5)];
}

// ---- 灰泥(256²)----
function paintPlasterPair(): [TextureAsset, TextureAsset] {
  const W = 256, H = 256;
  const data = new Uint8Array(W * H * 4);
  const hgt = new Float32Array(W * H);
  const nBig = fbm(83, 6, 3), nFine = makeNoise(89, 96), nPeel = fbm(101, 4, 2), nEdge = makeNoise(107, 48);
  const base = [196, 160, 118], brick = [172, 118, 86];
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const u = px / W, v = py / H;
      let tone = 0.92 + nBig(u * 6, v * 6) * 0.18 + (nFine(u * 96, v * 96) - 0.5) * 0.05;
      let c = [base[0] * tone, base[1] * tone, base[2] * tone * 1.02];
      // 低频剥落斑:大块、边缘碎,露出暖砖底
      const peel = nPeel(u * 4, v * 4) + (nEdge(u * 48, v * 48) - 0.5) * 0.14;
      let hh = nBig(u * 6, v * 6) * 0.5 + nFine(u * 96, v * 96) * 0.30;
      if (peel > 0.68) {
        const k = Math.min(1, (peel - 0.68) * 8);
        c = mix(c, [brick[0] * (0.9 + nFine(u * 96, v * 96) * 0.2), brick[1], brick[2]], k * 0.55);
        hh -= 0.5 * k;
      }
      put(data, (py * W + px) * 4, c[0], c[1], c[2]);
      hgt[py * W + px] = hh;
    }
  }
  return [colorTex(W, H, data, true), heightToNormal(hgt, W, H, 1.6)];
}

// ---- 树皮(128²,竖向纤维)----
function paintBark(): TextureAsset {
  const W = 256, H = 256;
  const data = new Uint8Array(W * H * 4);
  const nV = makeNoise(163, 24), nF = makeNoise(167, 64), nW = makeNoise(179, 16);
  const base = [116, 86, 56];
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const u0 = px / W, v = py / H;
      const u = u0 < 0.5 ? u0 : 1 - u0; // 镜像 u:圆周环绕无接缝
      // 竖向裂纹:u 高频 + v 低频(拉长)+ 轻微蛇形摆动
      const wob = (nW(u * 6, v * 3) - 0.5) * 0.10;
      const s = nV((u + wob) * 26, v * 2.4);
      const ridge = Math.abs(s - 0.5) * 2;
      const groove = ridge < 0.30 ? 0.52 + ridge * 1.5 : 0.97 + ridge * 0.06;
      const tone = (0.80 + (nF(u * 72, v * 72) - 0.5) * 0.26) * groove * (0.86 + s * 0.28);
      // 沟底偏冷褐,凸脊偏暖
      const warm = groove > 0.9 ? 1.0 : 0.9;
      put(data, (py * W + px) * 4, base[0] * tone, base[1] * tone * warm, base[2] * tone * warm);
    }
  }
  return colorTex(W, H, data, true);
}

// ---- 山岩层(256²,近白乘色:横向层带 + 碎噪)----
function paintMtn(): TextureAsset {
  const W = 256, H = 256;
  const data = new Uint8Array(W * H * 4);
  const nB = makeNoise(171, 12), nF = makeNoise(173, 64);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const u = px / W, v = py / H;
      // 层带:v 向条带,带宽不均
      const band = Math.sin(v * 22 + nB(u * 12, v * 12) * 9.0);
      let tone = 1 - Math.max(0, band - 0.66) * 0.10 - (nF(u * 64, v * 64) - 0.5) * 0.09;
      tone = Math.min(1, tone * 0.97 + 0.03);
      const g = 244 * tone;
      put(data, (py * W + px) * 4, g, g * 1.005, g * 1.01);
    }
  }
  return colorTex(W, H, data, true);
}

// ---- 树冠(256²)----
function paintCanopy(): TextureAsset {
  const W = 256, H = 256;
  const data = new Uint8Array(W * H * 4);
  const nClump = fbm(113, 16, 3), nFine = makeNoise(127, 128);
  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const u = px / W, v = py / H;
      const cl = nClump(u * 16, v * 16);
      let tone = cl < 0.40 ? 0.52 : cl < 0.62 ? 0.95 : 1.35;
      tone *= 0.9 + (nFine(u * 128, v * 128) - 0.5) * 0.3;
      const g = 128 * tone;
      put(data, (py * W + px) * 4, g * 0.92, g * 1.04, g * 0.88);
    }
  }
  return { kind: 'texture', width: W, height: H, format: 'rgba8unorm', data, colorSpace: 'linear', mipmap: true } as unknown as TextureAsset;
}

// ---- 草叶卡(128²,RGBA)----
function paintGrassCard(): TextureAsset {
  const W = 128, H = 128;
  const data = new Uint8Array(W * H * 4);
  const rnd = mulberry(139);
  for (let b = 0; b < 9; b++) {
    const rootX = 0.5 + (rnd() - 0.5) * 0.5;
    const lean = (rnd() - 0.5) * 0.9;
    const hgt2 = 0.55 + rnd() * 0.42;
    const wid = 0.030 + rnd() * 0.028;
    const dryish = rnd() < 0.22;
    const bow = lean * (0.5 + rnd() * 0.8);
    for (let s = 0; s < 60; s++) {
      const t = s / 59;
      const cx = rootX + lean * t * t * 0.55 + bow * t * 0.12;
      const cyv = 1 - hgt2 * t;
      const w = wid * (1 - t * 0.85);
      const x0 = Math.max(0, Math.floor((cx - w) * W)), x1 = Math.min(W - 1, Math.ceil((cx + w) * W));
      const py = Math.max(0, Math.min(H - 1, Math.round(cyv * H)));
      for (let px = x0; px <= x1; px++) {
        const o = (py * W + px) * 4;
        const shade = 0.55 + t * 0.55;
        const c = dryish ? [160 * shade, 142 * shade, 76 * shade] : [72 * shade, 132 * shade, 48 * shade];
        put(data, o, c[0], c[1], c[2], 255);
        if (py + 1 < H) put(data, ((py + 1) * W + px) * 4, c[0] * 0.92, c[1] * 0.92, c[2] * 0.92, 255);
      }
    }
  }
  return colorTex(W, H, data, true);
}

// ---- 雾幕(64×128,预乘)----
function paintFog(): TextureAsset {
  const W = 64, H = 128;
  const data = new Uint8Array(W * H * 4);
  const n = makeNoise(151, 16);
  const fogC = [178, 214, 234];
  for (let py = 0; py < H; py++) {
    const v = py / (H - 1);
    const prof = Math.pow(v, 1.6);
    for (let px = 0; px < W; px++) {
      // 顶部两行强制全透明:repeat 采样在 v=0 边会绕到底行,出一条亮线
      const fadeTop = Math.max(0, Math.min(1, (v - 0.04) / 0.16));
      const a = (py < 3 || py > H - 4) ? 0 : Math.max(0, Math.min(1, prof * fadeTop * fadeTop * (0.85 + n(px / W * 16, v * 6) * 0.3)));
      put(data, (py * W + px) * 4, fogC[0] * a, fogC[1] * a, fogC[2] * a, Math.round(a * 255));
    }
  }
  return colorTex(W, H, data, false);
}

export async function buildTextures(world: World, renderer: Renderer): Promise<TexSet> {
  const out: TexSet = { failures: [] };
  const upload = async (name: keyof Omit<TexSet, 'failures'>, tex: TextureAsset): Promise<void> => {
    try {
      const h = world.allocSharedRef('TextureAsset', tex);
      const pod = tex as unknown as { data: Uint8Array; width: number; height: number; colorSpace: string; mipmap: boolean };
      const up = await renderer.store.uploadTexture?.(h, tex, {
        bytes: pod.data, width: pod.width, height: pod.height,
        mime: 'image/png', colorSpace: pod.colorSpace, mipmap: pod.mipmap,
      });
      if (up?.ok === true) out[name] = unwrapHandle(h as never);
      else out.failures.push(name);
    } catch (e) {
      out.failures.push(`${name}:${String(e).slice(0, 60)}`);
    }
  };
  const [gC, gN] = paintGroundPair();
  await upload('ground', gC); await upload('groundN', gN);
  const [sC, sN] = paintStonePair();
  await upload('stone', sC); await upload('stoneN', sN);
  const [rC, rN] = paintRoofPair();
  await upload('roof', rC); await upload('roofN', rN);
  const [pC, pN] = paintPlasterPair();
  await upload('plaster', pC); await upload('plasterN', pN);
  await upload('bark', paintBark());
  await upload('mtn', paintMtn());
  await upload('canopy', paintCanopy());
  await upload('grassCard', paintGrassCard());
  await upload('fog', paintFog());
  return out;
}
