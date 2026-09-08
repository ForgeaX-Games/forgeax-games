// 天空穹顶(程序化渐变+云贴图,内面朝观察者)、雪山、远树带。
// 引擎无雾/大气(render 笔记 ❌ 已复核):远景全部用被大气洗过的观测色 + unlit。
import type { MeshAsset, TextureAsset } from '@forgeax/engine-types';
import { MeshBuf, mulberry } from './lib';

// ---- 穹顶网格(半球多一点,内面) ----
export function domeMesh(radius: number): MeshAsset {
  const buf = new MeshBuf();
  const segU = 48, segV = 16;
  const rows: number[][] = [];
  for (let j = 0; j <= segV; j++) {
    const t = (j / segV) * Math.PI * 0.62; // 到地平线下一点
    const row: number[] = [];
    for (let i = 0; i <= segU; i++) {
      const a = (i / segU) * Math.PI * 2;
      const x = Math.sin(t) * Math.cos(a) * radius;
      const y = Math.cos(t) * radius - radius * 0.06;
      const z = Math.sin(t) * Math.sin(a) * radius;
      row.push(buf.vert(x, y, z, i / segU, j / segV));
    }
    rows.push(row);
  }
  for (let j = 0; j < segV; j++) {
    for (let i = 0; i < segU; i++) {
      if (j > 0) buf.tri(rows[j][i], rows[j + 1][i + 1], rows[j][i + 1]);
      else buf.tri(rows[j][i], rows[j + 1][i + 1], rows[j + 1][i]);
      if (j > 0) buf.tri(rows[j][i], rows[j + 1][i], rows[j + 1][i + 1]);
    }
  }
  return buf.build();
}

// ---- 天空贴图:垂直渐变 + 积云(REFERENCE §5:顶 #46a8fb → 地平 #9fd9f2;云白底青) ----
export function skyTexture(): TextureAsset {
  const W = 512, H = 256;
  const data = new Uint8Array(W * H * 4);
  const rnd = mulberry(20260821);
  // 云团:中心 u/v、半径、扁率;集中在 v 0.35..0.75(贴图 v=0 是天顶)
  interface Puff { u: number; v: number; r: number; f: number; }
  const clouds: Puff[][] = [];
  // 显式簇位(u, v, 尺度):离散积云,彼此留出蓝天
  // v_tex:穹顶 t=v*0.62π;屏幕可见云带(仰角 5-30°)≈ v_tex 0.60-0.78
  const seats: [number, number, number][] = [
    [0.10, 0.66, 0.9], [0.30, 0.62, 1.1], [0.55, 0.70, 0.65],
    [0.72, 0.63, 1.15], [0.92, 0.68, 0.8],
  ];
  for (const [cu, cv, cs] of seats) {
    const cr = 0.06 * cs;
    const puffs: Puff[] = [];
    const n = 5 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      puffs.push({
        u: cu + (rnd() - 0.5) * cr * 2.2,
        v: cv - rnd() * cr * 1.3 + (i === 0 ? cr * 0.4 : 0),
        r: cr * (0.6 + rnd() * 0.7),
        f: 0.6 + rnd() * 0.3,
      });
    }
    clouds.push(puffs);
  }
  const top = [0x46, 0xa8, 0xfb], mid = [0x69, 0xc4, 0xfb], low = [0x9f, 0xd9, 0xf2];
  for (let y = 0; y < H; y++) {
    const v = y / H;
    // 渐变(非线性,地平线附近快速变白)
    const t = Math.min(1, v / 0.86);
    const c0 = t < 0.80 ? top : mid, c1 = t < 0.80 ? mid : low;
    const k = t < 0.80 ? t / 0.80 : (t - 0.80) / 0.20;
    let r = c0[0] + (c1[0] - c0[0]) * k, g = c0[1] + (c1[1] - c0[1]) * k, b = c0[2] + (c1[2] - c0[2]) * k;
    for (let x = 0; x < W; x++) {
      let cr = r, cg = g, cb = b;
      // 云:软边指数衰减;受光偏白、底部偏青灰
      let cov = 0, shade = 0;
      for (const puffs of clouds) {
        for (const p of puffs) {
          let du = Math.abs(x / W - p.u); if (du > 0.5) du = 1 - du;
          const dv = (v - p.v) / p.f;
          const d = Math.hypot(du * 2.2, dv) / p.r;
          if (d < 1.8) {
            const a = Math.exp(-d * d * 1.4);
            // 硬边:smoothstep 阈值,轮廓成团不糊
            const t2 = Math.max(0, Math.min(1, (a * 1.5 - 0.38) / 0.34));
            cov = Math.max(cov, t2 * t2 * (3 - 2 * t2));
            if (v > p.v) shade = Math.max(shade, Math.min(1, a * (v - p.v) / (p.r * p.f)));
          }
        }
      }
      if (cov > 0.02) {
        const cw = 252 - shade * 82, cwB = 254 - shade * 34;
        cr = cr + (cw - cr) * cov; cg = cg + (cw + 1 - cg) * cov; cb = cb + (cwB - cb) * cov;
      }
      const o = (y * W + x) * 4;
      data[o] = cr; data[o + 1] = cg; data[o + 2] = cb; data[o + 3] = 255;
    }
  }
  return { kind: 'texture', width: W, height: H, format: 'rgba8unorm-srgb', data, colorSpace: 'srgb', mipmap: false } as unknown as TextureAsset;
}

// ---- 雪山群 v3:连续脊线山脉(分形脊线 + 侧沟壑 + 海拔/坡向分面雪线) ----
export function mountainRange(
  seed: number,
  spanX: number,
  baseY: number,
  depth: number,
  peaks: readonly (readonly [number, number, number])[], // [x, 高, 半宽]
): { lit: MeshAsset; shade: MeshAsset; snowLit: MeshAsset; snowShade: MeshAsset } {
  const rnd = mulberry(seed);
  const lit = new MeshBuf(), shade = new MeshBuf(), snowLit = new MeshBuf(), snowShade = new MeshBuf();
  const NX = 88;
  // 分形细节(3 octave,可复现)
  const noiseTab: number[] = [];
  for (let i = 0; i <= NX * 4; i++) noiseTab.push(rnd());
  const fno = (x: number): number => {
    const i = Math.max(0, Math.min(noiseTab.length - 2, Math.floor(x)));
    const f = x - i;
    return noiseTab[i] * (1 - f) + noiseTab[i + 1] * f;
  };
  // 脊线高度:峰包络(尖峰) × 分形调制
  const crestAt = (u: number): number => {
    const x = -spanX / 2 + u * spanX;
    let env = 0;
    for (const [px, h, w] of peaks) {
      env = Math.max(env, h * Math.pow(Math.max(0, 1 - Math.abs(x - px) / w), 1.35));
    }
    const det = 0.80 + fno(u * NX * 0.5) * 0.28 + fno(u * NX * 1.7) * 0.14;
    return env * det;
  };
  // 网格:crest → base,4 带;侧沟壑用高频噪声沿 x 调制
  const rowsT = [0, 0.09, 0.2, 0.34, 0.5, 0.68, 0.85, 1.0];
  const grid: { x: number; y: number; z: number; h: number }[][] = [];
  for (const t of rowsT) {
    const row: { x: number; y: number; z: number; h: number }[] = [];
    for (let i = 0; i <= NX; i++) {
      const u = i / NX;
      const x = -spanX / 2 + u * spanX;
      const crest = crestAt(u);
      // 沟壑:随 t 增强的横向起伏
      const gully = (fno(u * NX * 2.3 + 7) - 0.5) * crest * 0.35 * t * (1.3 - t);
      const y = baseY + Math.max(0.5, crest * Math.pow(1 - t, 1.25) + gully);
      const z = (fno(u * NX * 0.8 + 31) - 0.5) * 90 + t * depth + crest * 0.10;
      row.push({ x, y: t === 1 ? baseY : y, z, h: crest });
    }
    grid.push(row);
  }
  for (let j = 0; j + 1 < grid.length; j++) {
    for (let i = 0; i < NX; i++) {
      const q = [grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]];
      const crest = Math.max(q[0].h, q[1].h, 1);
      // 雪线:海拔比 + 低频起伏(高频逐列抖动会出竖条纹)
      const snowLine = 0.50 + (fno(i * 0.32 + 53) - 0.5) * 0.13;
      // 坡向:西向面受光(dy/dx 为负 → 面朝西)
      const ddx = (q[1].y - q[0].y) + (q[2].y - q[3].y);
      const isLit = ddx < 0;
      // 按三角形指派 + 微抖动:边缘半粒度、锯齿有机,不再是整块方形补丁
      const tris: [number, number, number][] = [[3, 2, 1], [3, 1, 0]];
      for (let k = 0; k < 2; k++) {
        const pts = tris[k].map((ci) => q[ci]);
        const frac = (pts[0].y + pts[1].y + pts[2].y) / 3 / crest - baseY / crest;
        const jit = (fno(i * 2.7 + j * 5.3 + k * 11 + 17) - 0.5) * 0.07;
        const isSnow = frac + jit > snowLine && crest > 60;
        const buf = isSnow ? (isLit ? snowLit : snowShade) : (isLit ? lit : shade);
        const ids = pts.map((p) => buf.vert(p.x, p.y, p.z, p.x / 48, p.y / 48));
        buf.tri(ids[0], ids[1], ids[2]);
      }
    }
  }
  return { lit: lit.build(), shade: shade.build(), snowLit: snowLit.build(), snowShade: snowShade.build() };
}

// ---- 远树带(起伏轮廓长条,unlit) ----
export function farTreeBand(seed: number, spanX: number, height: number): MeshAsset {
  const buf = new MeshBuf();
  const rnd = mulberry(seed);
  const n = 42;
  let prevTop = -1, prevBase = -1;
  for (let i = 0; i <= n; i++) {
    const x = -spanX / 2 + (i / n) * spanX;
    const h = height * (0.5 + 0.5 * Math.abs(Math.sin(i * 1.7 + seed))) * (0.7 + rnd() * 0.5);
    const z = (rnd() - 0.5) * 12;
    const top = buf.vert(x, h, z, i / n, 0);
    const base = buf.vert(x, -6, z + 3, i / n, 1);
    if (i > 0) buf.quad(prevBase, base, top, prevTop);
    prevTop = top; prevBase = base;
  }
  return buf.build();
}

// ---- 雾幕圆柱(v=0 顶透明,v=1 底浓;配预乘 alpha 贴图) ----
export function fogCylinder(radius: number, y0: number, y1: number, seg = 36): MeshAsset {
  const buf = new MeshBuf();
  const bot: number[] = [], top: number[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = Math.cos(a) * radius, z = Math.sin(a) * radius;
    bot.push(buf.vert(x, y0, z, (i / seg) * 6, 1));
    top.push(buf.vert(x, y1, z, (i / seg) * 6, 0));
  }
  for (let i = 0; i < seg; i++) buf.quad(bot[i], bot[i + 1], top[i + 1], top[i]);
  return buf.build();
}
