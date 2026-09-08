// 建筑群:主楼(曲面塔+东翼+多级翘檐瓦顶)、露台、弧形围墙、石阶。
// 形态硬约束见 REFERENCE.md §4:塔身外凸收分、屋顶带弧外挑、围墙圆压顶。
import type { MeshAsset } from '@forgeax/engine-types';
import { MeshBuf, blob, lathe, mulberry, softBox } from './lib';
import { archFrame, hexBox, plank, quoinStack, stone as stoneBlock, tileStrip, tubeSeg } from './meshlib2';
import { tube } from './props';
import { TERRACE_CENTER, TERRACE_R, TERRACE_Y, RWALL_C, RWALL_R, RWALL_TOP, groundHeight } from './terrain';

export interface Piece { buf: MeshBuf; mat: string; }
export interface BoxCollider { pos: [number, number, number]; half: [number, number, number]; yaw: number; }

function piece(list: Piece[], mat: string): MeshBuf {
  const p = list.find((q) => q.mat === mat);
  if (p) return p.buf;
  const buf = new MeshBuf();
  list.push({ buf, mat });
  return buf;
}

// ---- 曲面收分塔身 / 翼楼(superellipse 截面 + 南面外凸) ----
function tower(buf: MeshBuf, cx: number, cz: number, w: number, d: number, h: number, bulge: number, taper: number): void {
  const seg = 22, lvls = [0, 0.34, 0.67, 1];
  const rows: number[][] = [];
  for (const lv of lvls) {
    const s = 1 - taper * lv;
    const row: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const c = Math.cos(a), sn = Math.sin(a);
      const k = 0.62; // superellipse 圆角
      let x = Math.sign(c) * Math.pow(Math.abs(c), k) * (w / 2);
      let z = Math.sign(sn) * Math.pow(Math.abs(sn), k) * (d / 2);
      z += bulge * Math.pow(Math.max(0, sn), 1.6); // 南面外凸
      row.push(buf.vert(cx + x * s, h * lv, cz + z * s, (i / seg) * 6, lv * 3));
    }
    rows.push(row);
  }
  for (let j = 0; j + 1 < rows.length; j++) {
    for (let i = 0; i < seg; i++) buf.quad(rows[j][i + 1], rows[j][i], rows[j + 1][i], rows[j + 1][i + 1]);
  }
  // 顶盖
  const top = rows[rows.length - 1];
  const c0 = buf.vert(cx, h, cz, 0.5, 0.5, [0, 1, 0]);
  for (let i = 0; i < seg; i++) buf.tri(top[i], c0, top[i + 1]);
}

// ---- 带弧坡 + 外挑翘檐的两坡瓦顶(脊沿 x) ----
function gableRoof(red: MeshBuf, ridge: MeshBuf, len: number, width: number, rise: number, over: number, kick: number): void {
  const nT = 5, nX = 2;
  for (const side of [1, -1]) {
    const rows: number[][] = [];
    for (let j = 0; j <= nT; j++) {
      const t = j / nT;
      const z = side * (t * (width / 2 + over));
      const A2 = 0.35;
      let y = rise * ((1 - A2) * (1 - t) + A2 * (1 - t) * (1 - t));
      if (t > 0.90) { const k2 = (t - 0.90) / 0.10; y += kick * k2 * k2; }
      const row: number[] = [];
      for (let i = 0; i <= nX; i++) {
        const u = i / nX;
        const x = (u - 0.5) * (len + over * 2);
        // 脊端起翘
        const endT = Math.max(0, Math.abs(u - 0.5) * 2 - 0.75) / 0.25;
        row.push(red.vert(x, y + (1 - t) * endT * kick * 1.6, z, (x + len / 2 + over) / 2, (t * (width / 2 + over)) / 2));
      }
      rows.push(row);
    }
    for (let j = 0; j < nT; j++) {
      for (let i = 0; i < nX; i++) {
        if (side > 0) red.quad(rows[j][i + 1], rows[j][i], rows[j + 1][i], rows[j + 1][i + 1]);
        else red.quad(rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]);
      }
    }
    // 檐口底板(遮住从下看穿帮)
    const ez = side * (width / 2 + over);
    const a = red.vert(-(len / 2 + over), -0.06, side * width * 0.3, 0, 0, [0, -1, 0]);
    const b = red.vert(len / 2 + over, -0.06, side * width * 0.3, 1, 0, [0, -1, 0]);
    const c = red.vert(len / 2 + over, kick - 0.02, ez, 1, 1, [0, -1, 0]);
    const d = red.vert(-(len / 2 + over), kick - 0.02, ez, 0, 1, [0, -1, 0]);
    if (side > 0) red.quad(a, b, c, d); else red.quad(b, a, d, c);
  }
  // 瓦面:贴合坡面的连续网格(锯齿叠瓦阶 + 瓦楞列 + 跟随脊端起翘),单面无缝
  {
    const ROWS = 7, COLS = Math.max(8, Math.round((len + over * 2) / 0.235)), SUBT = 2;
    const W2 = width / 2 + over;
    const A = 0.35; // 凹弧强度:0=直坡
    const yAt = (t: number): number => {
      let y = rise * ((1 - A) * (1 - t) + A * (1 - t) * (1 - t));
      if (t > 0.90) { const k = (t - 0.90) / 0.10; y += kick * k * k; }
      return y;
    };
    const rr = mulberry(911);
    const colJit: number[] = [];
    for (let i = 0; i <= COLS; i++) colJit.push((rr() - 0.5) * 0.008);
    for (const side of [1, -1]) {
      const grid: number[][] = [];
      // 每行发 SUBT+1 条纬线;相邻行在行界共 t 但 saw 不同 → 自动生成叠瓦台阶面
      const lines: [number, number][] = [];
      for (let r = 0; r < ROWS; r++) for (let s = 0; s <= SUBT; s++) lines.push([(r + s / SUBT) / ROWS, s / SUBT]);
      for (const [t, sawT] of lines) {
        const saw = sawT * 0.055;   // 行内向下坡增厚,行界回落成台阶
        const row: number[] = [];
        for (let i = 0; i <= COLS; i++) {
          const u = i / COLS;
          const x = (u - 0.5) * (len + over * 2);
          const wave = Math.sin(u * COLS * Math.PI) ** 2 * 0.05; // 瓦楞列(每列一楞)
          const endT = Math.max(0, Math.abs(u - 0.5) * 2 - 0.75) / 0.25;
          const lift = (1 - t) * endT * kick * 1.6;              // 跟随脊端起翘
          const y = yAt(t) + 0.03 + saw + wave + colJit[i] + lift;
          row.push(red.vert(x, y, side * t * W2, (x + len / 2 + over) / 1.9, t * (W2 / 1.9)));
        }
        grid.push(row);
      }
      for (let j = 0; j + 1 < grid.length; j++) {
        for (let i = 0; i < COLS; i++) {
          if (side > 0) red.quad(grid[j][i + 1], grid[j][i], grid[j + 1][i], grid[j + 1][i + 1]);
          else red.quad(grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]);
        }
      }
      // 檐缘垂边(最后一行往下 0.1 封口)
      const last = grid[grid.length - 1];
      for (let i = 0; i < COLS; i++) {
        const p0 = [red.pos[last[i] * 3], red.pos[last[i] * 3 + 1], red.pos[last[i] * 3 + 2]];
        const p1 = [red.pos[last[i + 1] * 3], red.pos[last[i + 1] * 3 + 1], red.pos[last[i + 1] * 3 + 2]];
        const b0 = red.vert(p0[0], p0[1] - 0.10, p0[2]);
        const b1 = red.vert(p1[0], p1[1] - 0.10, p1[2]);
        const t0v = red.vert(p0[0], p0[1], p0[2]);
        const t1v = red.vert(p1[0], p1[1], p1[2]);
        if (side > 0) red.quad(t0v, t1v, b1, b0); else red.quad(t1v, t0v, b0, b1);
      }
      // 山墙封檐板(barge board,沿坡两端)
      for (const e of [-1, 1]) {
        const ex = e * (len / 2 + over);
        let prevTop: number | null = null, prevBot: number | null = null;
        for (let j = 0; j < grid.length; j += SUBT) {
          const idx = grid[j][e > 0 ? COLS : 0];
          const py = red.pos[idx * 3 + 1], pz = red.pos[idx * 3 + 2];
          const tp = ridge.vert(ex + e * 0.02, py + 0.03, pz);
          const bt = ridge.vert(ex + e * 0.02, py - 0.16, pz);
          if (prevTop !== null && prevBot !== null) {
            if ((e > 0) === (side > 0)) ridge.quad(prevBot, bt, tp, prevTop);
            else ridge.quad(bt, prevBot, prevTop, tp);
          }
          prevTop = tp; prevBot = bt;
        }
      }
    }
  }
  // 檐口封板梁(两侧,深色)
  for (const side of [1, -1]) {
    const ez = side * (width / 2 + over);
    tube(ridge, [-(len / 2 + over), kick + 0.02, ez], [len / 2 + over, kick + 0.02, ez], 0.09, 0.09, 5);
  }
  // 脊梁(两端上翘)
  tube(ridge, [-(len / 2 + over * 1.15), rise + 0.10, 0], [-(len / 2 + over * 0.4), rise + 0.02, 0], 0.10, 0.13, 6);
  {
    const x0 = -(len / 2 + over * 0.4), x1 = len / 2 + over * 0.4;
    const n = Math.max(3, Math.round((x1 - x0) / 0.45));
    for (let i = 0; i < n; i++) {
      const xa = x0 + (i / n) * (x1 - x0), xb = x0 + ((i + 1) / n) * (x1 - x0) + 0.05;
      tube(ridge, [xa, rise + 0.10, 0], [xb, rise + 0.10, 0], i % 2 ? 0.16 : 0.19, i % 2 ? 0.19 : 0.16, 7);
    }
  }
  tube(ridge, [len / 2 + over * 0.4, rise + 0.02, 0], [len / 2 + over * 1.15, rise + 0.10, 0], 0.13, 0.10, 6);
  // 山墙封板
  const g0 = ridge.vert(-len / 2 - over * 0.2, rise, 0, 0, 0);
  const g1 = ridge.vert(-len / 2 - over * 0.2, 0, -width / 2, 0, 1);
  const g2 = ridge.vert(-len / 2 - over * 0.2, 0, width / 2, 1, 1);
  ridge.tri(g0, g1, g2);
  const h0 = ridge.vert(len / 2 + over * 0.2, rise, 0, 0, 0);
  const h1 = ridge.vert(len / 2 + over * 0.2, 0, -width / 2, 0, 1);
  const h2 = ridge.vert(len / 2 + over * 0.2, 0, width / 2, 1, 1);
  ridge.tri(h0, h2, h1);
}

/** 环塔身一圈的裙檐:瓦楞截锥环带(径向楞 + 两级行唇 + 檐缘垂边) */
function skirtRoof(red: MeshBuf, cx: number, cz: number, y: number, rOut: number, rIn: number, drop: number): void {
  const seg = 84;
  const rows = [0, 0.55, 1.0];
  const shape = (a: number): [number, number] => {
    const c = Math.cos(a), s = Math.sin(a);
    const k = 0.7;
    return [Math.sign(c) * Math.pow(Math.abs(c), k), Math.sign(s) * Math.pow(Math.abs(s), k)];
  };
  const rowIdx: number[][] = [];
  for (let j = 0; j < rows.length; j++) {
    const t = rows[j];
    const row: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const [ux, uz] = shape(a);
      const rib = Math.sin((i / seg) * Math.PI * 2 * 26) * 0.032 + 0.032; // 径向瓦楞
      const lip = j === 2 ? 0.05 : 0;                                   // 仅外缘小唇
      const r = rIn + (rOut - rIn) * t;
      row.push(red.vert(cx + ux * r, y - drop * ((0.7) * t + 0.3 * t * t) + rib * t + lip, cz + uz * r, (i / seg) * 30, t));
    }
    rowIdx.push(row);
  }
  for (let j = 0; j + 1 < rows.length; j++) {
    for (let i = 0; i < seg; i++) red.quad(rowIdx[j][i], rowIdx[j][i + 1], rowIdx[j + 1][i + 1], rowIdx[j + 1][i]);
  }
  // 檐缘垂边(挡视线穿帮)
  for (let i = 0; i < seg; i++) {
    const a0 = rowIdx[2][i], a1 = rowIdx[2][i + 1];
    const p0 = [red.pos[a0 * 3], red.pos[a0 * 3 + 1], red.pos[a0 * 3 + 2]];
    const p1 = [red.pos[a1 * 3], red.pos[a1 * 3 + 1], red.pos[a1 * 3 + 2]];
    const b0 = red.vert(p0[0], p0[1] - 0.24, p0[2]);
    const b1 = red.vert(p1[0], p1[1] - 0.24, p1[2]);
    const t0 = red.vert(p0[0], p0[1], p0[2]);
    const t1 = red.vert(p1[0], p1[1], p1[2]);
    red.quad(t0, t1, b1, b0);
  }
}

// ---- 窗:石拱楔石框 + 拱形玻璃 + 木棂 ----
function window_(trim: MeshBuf, glass: MeshBuf, x: number, y: number, z: number, w: number, h: number, yaw: number, wood?: MeshBuf): void {
  const f = new MeshBuf();
  archFrame(f, w, h, 0.24, 0.15, Math.round(x * 31 + y * 57 + z * 13));
  trim.append(f, x, y, z, 1, yaw);
  // 玻璃贴墙面外 2cm(墙是实心盒,内退会被墙面盖住);进深感由外凸侧壁环营造
  const GD = 0.02;
  const g = new MeshBuf();
  const gv = [
    g.vert(-w / 2, -h / 2, GD, 0, 0, [0, 0, 1]), g.vert(w / 2, -h / 2, GD, 1, 0, [0, 0, 1]),
    g.vert(w / 2, h / 2, GD, 1, 1, [0, 0, 1]), g.vert(-w / 2, h / 2, GD, 0, 1, [0, 0, 1]),
  ];
  g.quad(gv[0], gv[1], gv[2], gv[3]);
  const fan: number[] = [g.vert(0, h / 2, GD, 0.5, 1, [0, 0, 1])];
  for (let i = 0; i <= 6; i++) {
    const a = Math.PI * (i / 6);
    fan.push(g.vert(Math.cos(a) * w / 2, h / 2 + Math.sin(a) * w / 2, GD, 0.5, 1, [0, 0, 1]));
  }
  for (let i = 1; i < fan.length - 1; i++) g.tri(fan[0], fan[i + 1], fan[i]);
  glass.append(g, x, y, z, 1, yaw);
  // 洞侧壁(reveal,深色)
  {
    const rv = new MeshBuf();
    const zF = 0.16;
    // 左右侧壁
    for (const sgn of [-1, 1]) {
      const a0 = rv.vert(sgn * w / 2, -h / 2, zF, 0, 0, [-sgn, 0, 0]);
      const a1 = rv.vert(sgn * w / 2, h / 2, zF, 1, 0, [-sgn, 0, 0]);
      const a2 = rv.vert(sgn * w / 2, h / 2, GD, 1, 1, [-sgn, 0, 0]);
      const a3 = rv.vert(sgn * w / 2, -h / 2, GD, 0, 1, [-sgn, 0, 0]);
      if (sgn > 0) rv.quad(a0, a1, a2, a3); else rv.quad(a1, a0, a3, a2);
    }
    // 底壁
    const b0 = rv.vert(-w / 2, -h / 2, zF, 0, 0, [0, 1, 0]);
    const b1 = rv.vert(w / 2, -h / 2, zF, 1, 0, [0, 1, 0]);
    const b2 = rv.vert(w / 2, -h / 2, GD, 1, 1, [0, 1, 0]);
    const b3 = rv.vert(-w / 2, -h / 2, GD, 0, 1, [0, 1, 0]);
    rv.quad(b1, b0, b3, b2);
    // 拱顶壁(近似:两段斜面)
    const t0a = rv.vert(-w / 2, h / 2, zF), t1a = rv.vert(0, h / 2 + w / 2, zF), t2a = rv.vert(w / 2, h / 2, zF);
    const t0b = rv.vert(-w / 2, h / 2, GD), t1b = rv.vert(0, h / 2 + w / 2, GD), t2b = rv.vert(w / 2, h / 2, GD);
    rv.quad(t0a, t1a, t1b, t0b); rv.quad(t1a, t2a, t2b, t1b);
    trim.append(rv, x, y, z, 1, yaw);
  }
  // 木棂随玻璃内退
  
  if (wood) {
    const m = new MeshBuf();
    plank(m, [0, -h / 2, 0.06], [0, h / 2 + w / 2 - 0.03, 0.06], 0.05, 0.04, [0, 0, 1], 5);
    plank(m, [-w / 2, 0.1, 0.06], [w / 2, 0.1, 0.06], 0.05, 0.04, [0, 0, 1], 7);
    wood.append(m, x, y, z, 1, yaw);
  }
}

// ---- 主楼(local:原点=台基顶面中心,front=+z;由 scene 摆到世界) ----
function addGable(out: Piece[], len: number, width: number, rise: number, over: number, kick: number, dx: number, dy: number, dz: number, yaw = 0): void {
  const red = new MeshBuf(), rg = new MeshBuf();
  gableRoof(red, rg, len, width, rise, over, kick);
  piece(out, 'roofRed').append(red, dx, dy, dz, 1, yaw);
  piece(out, 'roofRidge').append(rg, dx, dy, dz, 1, yaw);
}

function buildHouseReal(): Piece[] {
  const out: Piece[] = [];
  const wall = piece(out, 'houseWall');     // 上层灰泥
  const base = piece(out, 'masonry');       // 一层石裙/烟囱/塔基
  const trim = piece(out, 'houseTrim');     // 石框/窗台
  const wood = piece(out, 'woodDark');
  const woodL = piece(out, 'woodLight');
  const glass = piece(out, 'glass');
  const shut = piece(out, 'shutter');
  const vine = piece(out, 'canopyMid');

  // ============ 体量 ============
  // 主体:11.5 × 7.0,两层(0..6.4),石裙 0..1.15
  const MW = 5.75, MD = 3.5, H1 = 1.15, H2 = 6.4;
  const boxWalls = (b: MeshBuf, x0: number, x1: number, z0: number, z1: number, y0: number, y1: number, K = 1 / 1.6): void => {
    const c: [number, number, number][] = [
      [x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0],
      [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0],
    ];
    hexBox(b, c, (y1 - y0) * K);
  };
  boxWalls(base, -MW, MW, -MD, MD, 0, H1);              // 主体石裙
  boxWalls(wall, -MW + 0.03, MW - 0.03, -MD + 0.03, MD - 0.03, H1, H2, 1 / 2.2); // 主体上身
  // 横翼:x -5.6..-0.6,南伸至 z 5.0;二层悬挑 0.25(jetty)
  boxWalls(base, -5.6, -0.6, -1.0, 5.0, 0, H1);
  boxWalls(wall, -5.57, -0.63, -1.0, 5.0, H1, 3.2, 1 / 2.2);
  boxWalls(wall, -5.57, -0.63, -1.0, 5.25, 3.2, H2, 1 / 2.2);   // 二层前挑
  // 挑梁头(悬挑之下)
  for (let i = 0; i < 5; i++) {
    const bx = -5.1 + i * 1.0;
    plank(wood, [bx, 3.06, 4.55], [bx, 3.06, 5.22], 0.13, 0.13, [0, 1, 0], 120 + i);
  }
  // 楼梯圆塔:r1.9 @ (4.2, 2.3),高 9.6,嵌主体东南角
  {
    const seg = 18, r = 1.9, cx = 4.2, cz = 2.3;
    const rows: number[][] = [];
    for (const [yy, buf, rr] of [[0, base, r + 0.06], [1.3, base, r + 0.06], [1.3, wall, r], [9.6, wall, r]] as const) {
      const row: number[] = [];
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        buf.vert; // noop for ts
        row.push((buf as MeshBuf).vert(cx + Math.cos(a) * rr, yy, cz + Math.sin(a) * rr, (i / seg) * 5, yy / 2.2));
      }
      rows.push(row);
    }
    for (let i = 0; i < seg; i++) {
      base.quad(rows[0][i + 1], rows[0][i], rows[1][i], rows[1][i + 1]);
      wall.quad(rows[2][i + 1], rows[2][i], rows[3][i], rows[3][i + 1]);
    }
    const c0 = wall.vert(cx, 9.6, cz, 0.5, 0.5, [0, 1, 0]);
    for (let i = 0; i < seg; i++) wall.tri(rows[3][i], c0, rows[3][i + 1]);
    // 层线石带 ×2(打破圆筒平面感)
    for (const by of [3.25, 6.45]) {
      const band = new MeshBuf();
      lathe(band, [[r + 0.015, -0.07], [r + 0.055, -0.015], [r + 0.055, 0.04], [r + 0.015, 0.09]], 18);
      wall.append(band, cx, by, cz);
    }
  }

  // 塔-主体角部填充(消黑腔)
  boxWalls(wall, 2.2, 4.4, 3.3, 4.15, H1, H2, 1 / 2.2);
  boxWalls(base, 2.2, 4.4, 3.3, 4.15, 0, H1);

  // ============ 屋顶 ============
  addGable(out, 11.9, 7.0, 3.4, 0.75, 0.14, 0, H2, 0);               // 主体,脊沿 x
  addGable(out, 6.6, 6.1, 2.9, 0.7, 0.12, -3.1, H2, 2.0, Math.PI / 2); // 横翼,脊沿 z,山墙朝南
  coneRoof(piece(out, 'roofRed'), piece(out, 'roofRidge'), 4.2, 2.3, 9.5, 2.65, 2.5); // 塔锥顶
  // 塔顶饰 + 风向标
  {
    const fin = new MeshBuf();
    lathe(fin, [[0.10, 0], [0.13, 0.10], [0.05, 0.22], [0.11, 0.34], [0.02, 0.5]], 8, true);
    woodL.append(fin, 4.2, 11.95, 2.3);
    tube(woodL, [4.2, 12.4, 2.3], [4.2, 13.1, 2.3], 0.028, 0.024, 5);
    const arr = new MeshBuf();
    const a = arr.vert(-0.42, 0, 0), b2 = arr.vert(0.36, 0.10, 0), c2 = arr.vert(0.36, -0.10, 0);
    arr.tri(a, b2, c2); arr.tri(b2, a, c2);
    woodL.append(arr, 4.2, 12.85, 2.3, 1, 0.6);
  }
  // 天沟压边板(主坡 × 翼坡交线,左右各一条)
  {
    const yMain = (z: number): number => {
      const t = Math.max(0, Math.min(1, z / 4.25));
      return H2 + 3.4 * (0.65 * (1 - t) + 0.35 * (1 - t) * (1 - t));
    };
    for (const sgn of [-1, 1]) {
      // 翼坡:脊 x=-3.1 高 9.3,檐 x=-3.1±3.75 高 6.55(近似线性)
      let prev: [number, number, number] | null = null;
      for (let k = 0; k <= 12; k++) {
        const dx = (k / 12) * 3.75;
        const yW = 9.3 - (2.75 / 3.75) * dx;
        // 求主坡上等高点 z(数值反解)
        let lo = 0, hi = 4.25;
        for (let it = 0; it < 24; it++) {
          const mid = (lo + hi) / 2;
          if (yMain(mid) > yW) lo = mid; else hi = mid;
        }
        const pt: [number, number, number] = [-3.1 + sgn * dx, yW + 0.10, (lo + hi) / 2];
        if (prev) tubeSeg(piece(out, 'roofRidge'), prev, pt, 0.075, 0.075, 5);
        prev = pt;
      }
    }
  }

  // 老虎窗(主体南坡,塔左侧)
  dormer(out, 1.6, H2 + 1.15, 2.55, 0);
  dormer(out, -0.2, H2 + 1.15, -2.55, Math.PI); // 北坡一个(view_02)

  // ============ 烟囱(落地石砌,主体西端墙外) ============
  {
    const ch = new MeshBuf();
    boxWalls(ch, -0.62, 0.62, -0.5, 0.5, 0, 10.6, 1 / 1.6);
    boxWalls(ch, -0.78, 0.78, -0.65, 0.65, 10.6, 11.15, 1 / 1.6); // 压顶
    base.append(ch, -6.25, 0, -0.6);
    for (const px of [-0.28, 0.28]) {
      const pot = new MeshBuf();
      lathe(pot, [[0.14, 0], [0.17, 0.22], [0.13, 0.5], [0.16, 0.62]], 8);
      trim.append(pot, -6.25 + px, 11.15, -0.6);
    }
  }

  // ============ 木构架山墙(横翼南立面二层 + 山墙三角) ============
  {
    const zF = 5.31; // 悬挑面外
    const y0 = 3.3, y1 = H2 - 0.1;
    // 横梁
    plank(wood, [-5.5, y0, zF], [-0.7, y0, zF], 0.16, 0.07, [0, 0, 1], 130);
    plank(wood, [-5.5, y1, zF], [-0.7, y1, zF], 0.16, 0.07, [0, 0, 1], 131);
    plank(wood, [-5.5, (y0 + y1) / 2, zF], [-0.7, (y0 + y1) / 2, zF], 0.12, 0.06, [0, 0, 1], 132);
    // 竖柱
    for (const vx of [-5.4, -4.2, -2.0, -0.8]) {
      plank(wood, [vx, y0, zF], [vx, y1, zF], 0.15, 0.07, [0, 0, 1], 133 + Math.round(vx * 3));
    }
    // 斜撑
    plank(wood, [-4.2, y0, zF], [-3.1, (y0 + y1) / 2, zF], 0.11, 0.06, [0, 0, 1], 140);
    plank(wood, [-2.0, (y0 + y1) / 2, zF], [-3.1, y0, zF], 0.11, 0.06, [0, 0, 1], 141);
    // 山墙三角(翼顶 gable 内)+ 边斜梁
    const gy0 = H2, apex = H2 + 2.9;
    const gz = 5.02;
    const tri3 = new MeshBuf();
    const t0 = tri3.vert(-5.55, gy0, gz, 0, 0, [0, 0, 1]);
    const t1 = tri3.vert(-0.65, gy0, gz, 3, 0, [0, 0, 1]);
    const t2 = tri3.vert(-3.1, apex, gz, 1.5, 1.8, [0, 0, 1]);
    tri3.tri(t0, t1, t2);
    wall.append(tri3, 0, 0, 0);
    plank(wood, [-5.5, gy0 + 0.05, gz + 0.06], [-3.1, apex, gz + 0.06], 0.14, 0.07, [0, 0, 1], 143);
    plank(wood, [-0.7, gy0 + 0.05, gz + 0.06], [-3.1, apex, gz + 0.06], 0.14, 0.07, [0, 0, 1], 144);
    plank(wood, [-3.1, gy0, gz + 0.06], [-3.1, apex - 0.15, gz + 0.06], 0.13, 0.07, [0, 0, 1], 145);
    plank(wood, [-4.9, gy0 + 0.03, gz + 0.06], [-1.3, gy0 + 0.03, gz + 0.06], 0.13, 0.06, [0, 0, 1], 146);
  }

  // ============ 门廊(翼山墙前) ============
  {
    addGable(out, 3.2, 2.2, 1.1, 0.35, 0.08, -3.1, 3.0, 6.0, 0);
    tube(wood, [-4.55, 2.4, 5.15], [-4.75, 2.95, 5.9], 0.05, 0.045, 5); // 左端托木
    tube(wood, [-1.65, 2.4, 5.15], [-1.45, 2.95, 5.9], 0.05, 0.045, 5); // 右端托木
    tube(wood, [-4.6, 0, 6.8], [-4.6, 3.0, 6.7], 0.13, 0.11, 7);
    tube(wood, [-1.6, 0, 6.8], [-1.6, 3.0, 6.7], 0.13, 0.11, 7);
    // 门(板拱门)+ 石拱框
    const door = new MeshBuf();
    for (let i = 0; i < 5; i++) {
      const px = -0.52 + i * 0.26;
      const hTop = 1.9 + Math.sqrt(Math.max(0, 0.42 - px * px)) * 0.5;
      plank(door, [px, 0.02, 0], [px, hTop, 0], 0.24, 0.06, [0, 0, 1], 150 + i);
    }
    plank(door, [-0.58, 0.6, 0.055], [0.58, 0.6, 0.055], 0.15, 0.05, [0, 0, 1], 156);
    plank(door, [-0.58, 1.5, 0.055], [0.58, 1.5, 0.055], 0.15, 0.05, [0, 0, 1], 157);
    woodL.append(door, -3.1, 0, 5.02);
    const af = new MeshBuf();
    archFrame(af, 1.4, 1.95, 0.26, 0.16, 95);
    trim.append(af, -3.1, 0.975, 5.0);
    // 长凳
    plank(woodL, [-1.35, 0.45, 5.6], [-0.25, 0.45, 5.6], 0.34, 0.06, [0, 1, 0], 160);
    for (const bx of [-1.2, -0.4]) {
      plank(wood, [bx, 0, 5.6], [bx, 0.44, 5.6], 0.3, 0.06, [0, 0, 1], 161 + Math.round(bx * 3));
    }
    // 挂灯(门边)
    tube(wood, [-1.75, 2.35, 5.05], [-1.75, 2.35, 5.45], 0.03, 0.03, 4);
    // 门廊台阶(下露台,5 级)
    const st = piece(out, 'terraceStone');
    for (let i = 0; i < 5; i++) {
      const sb = new MeshBuf();
      const w2 = 1.6 - i * 0.04, y1 = -i * 0.36, y0 = y1 - 0.38;
      const zz0 = 6.9 + i * 0.42, zz1 = zz0 + 0.50;
      const cc: [number, number, number][] = [
        [-3.1 - w2, y0, zz1], [-3.1 + w2, y0, zz1], [-3.1 + w2, y0, zz0], [-3.1 - w2, y0, zz0],
        [-3.1 - w2, y1, zz1], [-3.1 + w2, y1, zz1], [-3.1 + w2, y1, zz0], [-3.1 - w2, y1, zz0],
      ];
      hexBox(sb, cc, 0.5);
      st.append(sb, 0, 0, 0);
    }
  }

  // ============ 窗(石拱框 + 玻璃 + 木棂;部分带百叶板/花箱) ============
  const shutters = (x: number, y: number, z: number, w: number, h: number, yaw: number): void => {
    for (const sgn of [-1, 1]) {
      const off = sgn * (w / 2 + 0.32);
      const sb = new MeshBuf();
      plank(sb, [0, -h / 2, 0], [0, h / 2, 0], 0.30, 0.05, [0, 0, 1], 170 + Math.round(x + sgn));
      plank(sb, [-0.13, -h * 0.28, 0.05], [0.13, -h * 0.28, 0.05], 0.08, 0.03, [0, 0, 1], 172);
      plank(sb, [-0.13, h * 0.28, 0.05], [0.13, h * 0.28, 0.05], 0.08, 0.03, [0, 0, 1], 173);
      const cy = Math.cos(yaw), sy = Math.sin(yaw);
      shut.append(sb, x + off * cy, y, z - off * sy, 1, yaw);
    }
  };
  const flowerBox = (x: number, y: number, z: number, yaw: number): void => {
    const fb = new MeshBuf();
    plank(fb, [-0.45, 0, 0], [0.45, 0, 0], 0.24, 0.2, [0, 0, 1], 180 + Math.round(x));
    wood.append(fb, x, y, z + 0.1, 1, yaw);
  };
  // 主体南(一层 x+1.3 带百叶+花箱;二层阳台门在 x+1.3)
  window_(trim, glass, 1.3, 1.9, MD, 1.0, 1.3, 0, wood);
  shutters(1.3, 1.9, MD + 0.02, 1.0, 1.3, 0);
  flowerBox(1.3, 1.12, MD, 0);
  // 二层阳台(主体南 x+1.3)
  {
    const slab = new MeshBuf();
    boxWalls(slab, -1.1, 1.1, 0, 0.95, -0.12, 0.02, 1);
    trim.append(slab, 1.3, 4.35, MD);
    for (let i = 0; i <= 6; i++) {
      const bx = 1.3 - 1.0 + (i / 6) * 2.0;
      const bal = new MeshBuf();
      lathe(bal, [[0.045, 0], [0.05, 0.08], [0.026, 0.2], [0.05, 0.38], [0.03, 0.5], [0.045, 0.58]], 7);
      wood.append(bal, bx, 4.37, MD + 0.82);
    }
    tube(wood, [0.28, 5.0, MD + 0.86], [2.32, 5.0, MD + 0.86], 0.05, 0.05, 5);
    tube(wood, [1.3, 4.35, MD + 0.02], [1.3, 4.0, MD + 0.55], 0.05, 0.04, 4);
    // 阳台门(亮木)+ 门上气窗暖光片
    const bd = new MeshBuf();
    for (let i = 0; i < 4; i++) plank(bd, [-0.42 + i * 0.28, 0, 0], [-0.42 + i * 0.28, 1.8, 0], 0.26, 0.05, [0, 0, 1], 190 + i);
    woodL.append(bd, 1.3, 4.4, MD - 0.02);
    {
      const gl = piece(out, 'glow');
      const q = [
        gl.vert(0.85, 6.3, MD + 0.01, 0, 0, [0, 0, 1]), gl.vert(1.75, 6.3, MD + 0.01, 1, 0, [0, 0, 1]),
        gl.vert(1.75, 6.75, MD + 0.01, 1, 1, [0, 0, 1]), gl.vert(0.85, 6.75, MD + 0.01, 0, 1, [0, 0, 1]),
      ];
      gl.quad(q[0], q[1], q[2], q[3]);
    }
  }
  // 翼一层窗(带百叶+花箱)
  window_(trim, glass, -4.4, 1.9, 5.02, 0.9, 1.2, 0, wood);
  shutters(-4.4, 1.9, 5.04, 0.9, 1.2, 0);
  flowerBox(-4.4, 1.18, 5.02, 0);
  // 翼二层窗(木构架间)
  window_(trim, glass, -3.1, 4.7, 5.30, 0.9, 1.15, 0, wood);
  // 塔小拱窗 ×2(朝南偏西)+ 滴水线脚
  window_(trim, glass, 3.35, 3.4, 3.98, 0.55, 0.95, 0.45, wood);
  window_(trim, glass, 3.35, 6.4, 3.98, 0.55, 0.95, 0.45, wood);
  for (const wy of [4.35, 7.35]) {
    const drip = new MeshBuf();
    const dc: [number, number, number][] = [
      [-0.55, 0, 0.16], [0.55, 0, 0.16], [0.55, 0, -0.05], [-0.55, 0, -0.05],
      [-0.55, 0.10, 0.10], [0.55, 0.10, 0.10], [0.55, 0.10, -0.05], [-0.55, 0.10, -0.05],
    ];
    hexBox(drip, dc, 0.3);
    trim.append(drip, 3.35, wy, 3.95, 1, 0.45);
  }
  // 东端墙、西端墙、北墙(view_02)
  window_(trim, glass, MW, 2.1, 0.3, 0.9, 1.25, -Math.PI / 2, wood);
  window_(trim, glass, MW, 4.9, -1.2, 0.85, 1.15, -Math.PI / 2, wood);
  window_(trim, glass, -MW, 4.8, -1.6, 0.85, 1.15, Math.PI / 2, wood);
  window_(trim, glass, -1.0, 4.8, -MD, 0.9, 1.2, Math.PI, wood);
  window_(trim, glass, 3.4, 2.0, -MD, 0.9, 1.2, Math.PI, wood);

  // ============ 角石(主体+翼外角) ============
  quoinStack(trim, -MW, MD, H1, H2 - 0.15, 0.34, 0, 201);
  quoinStack(trim, MW, -MD, H1, H2 - 0.15, 0.34, 0, 202);
  quoinStack(trim, -MW, -MD, H1, H2 - 0.15, 0.34, 0, 203);
  quoinStack(trim, -5.6, 5.0, H1, 3.15, 0.38, 0, 204);
  quoinStack(trim, -0.62, 5.0, H1, 3.15, 0.38, 0, 205);

  // ============ 椽尾(主体南檐 + 翼山墙檐) ============
  for (let i = 0; i < 12; i++) {
    const rx = -5.3 + i * 1.0;
    if (rx > -0.9 && rx < 0.6) continue; // 翼相交区跳过
    plank(wood, [rx, H2 - 0.12, MD + 0.1], [rx, H2 + 0.02, MD + 0.62], 0.09, 0.08, [0, 1, 0], 210 + i);
  }

  // ============ 叙事散件:柴垛 / 雨水桶位(桶在 scene)/ 藤蔓 / 彩旗 ============
  {
    // 柴垛(北墙外)
    const lg = new MeshBuf();
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < 7 - r; i++) {
        tubeSeg(lg, [0.6 + i * 0.29 + r * 0.14, 0.14 + r * 0.26, -0.35], [0.6 + i * 0.29 + r * 0.14, 0.14 + r * 0.26, 0.42], 0.13, 0.13, 6);
      }
    }
    wood.append(lg, -2.2, 0, -MD - 0.55);
    // 藤蔓(塔身 + 主体东南角)
    const leaf = new MeshBuf();
    blob(leaf, 0.30, 0.22, 0.16, 43, 0.34, 7, 5);
    for (const [vx, vy0, vh, amp, ph, vz] of [[5.0, 0.5, 4.6, 0.4, 1.7, 3.4], [5.72, 0.4, 3.6, 0.3, 0.6, 2.2]] as const) {
      const n = Math.round(vh / 0.4);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const sway = Math.sin(t * 5.2 + ph) * amp * (0.4 + t * 0.6) + Math.sin(t * 13 + ph * 3) * 0.15;
        vine.append(leaf, vx + sway * 0.4, vy0 + vh * t, vz + sway * 0.5, 0.7 + Math.sin(t * 9 + ph) * 0.22 + (1 - t) * 0.3, i * 0.9);
      }
    }
    // 彩旗(塔顶 → 烟囱顶)
    const flags = piece(out, 'flowerBlue');
    const flags2 = piece(out, 'paper');
    const p0: [number, number, number] = [4.1, 11.5, 2.35], p1: [number, number, number] = [-2.9, 9.4, 4.9];
    {
      let prevP: [number, number, number] = p0;
      for (let k = 1; k <= 6; k++) {
        const t = k / 6;
        const pt: [number, number, number] = [
          p0[0] + (p1[0] - p0[0]) * t,
          p0[1] + (p1[1] - p0[1]) * t - Math.sin(t * Math.PI) * 0.7,
          p0[2] + (p1[2] - p0[2]) * t,
        ];
        tube(wood, prevP, pt, 0.02, 0.02, 4);
        prevP = pt;
      }
    }
    for (let i = 1; i <= 6; i++) {
      const t = i / 7;
      const x = p0[0] + (p1[0] - p0[0]) * t, y = p0[1] + (p1[1] - p0[1]) * t - Math.sin(t * Math.PI) * 0.7;
      const z = p0[2] + (p1[2] - p0[2]) * t;
      const f = i % 2 ? flags : flags2;
      const a = f.vert(x - 0.20, y, z, 0, 0, [0.5, 0, 0.85]);
      const bq = f.vert(x + 0.20, y, z + 0.08, 1, 0, [0.5, 0, 0.85]);
      const c = f.vert(x, y - 0.44, z + 0.04, 0.5, 1, [0.5, 0, 0.85]);
      f.tri(a, bq, c); f.tri(bq, a, c);
    }
    // 招牌(门廊柱侧挑出)
    const sign = new MeshBuf();
    plank(sign, [0, 0.02, -0.44], [0, 0.02, 0.44], 0.30, 0.06, [1, 0, 0], 220);
    plank(sign, [0, -0.26, -0.40], [0, -0.26, 0.40], 0.26, 0.06, [1, 0, 0], 221);
    woodL.append(sign, -1.45, 2.35, 5.9);
    tube(wood, [-1.6, 2.75, 5.55], [-1.6, 2.75, 6.3], 0.04, 0.035, 4);
    tube(wood, [-1.58, 2.72, 5.75], [-1.47, 2.5, 5.75], 0.02, 0.02, 4);
    tube(wood, [-1.58, 2.72, 6.15], [-1.47, 2.5, 6.15], 0.02, 0.02, 4);
  }
  return out;
}

/** 塔锥形瓦顶:径向瓦楞 + 檐缘唇 + 滴水边 */
function coneRoof(red: MeshBuf, ridge: MeshBuf, cx: number, cz: number, yBase: number, rOut: number, height: number): void {
  const seg = 40;
  const rows = [0, 0.35, 0.7, 1.0];
  const grid: number[][] = [];
  for (const t of rows) {
    const row: number[] = [];
    const r = 0.12 + (rOut - 0.12) * t;
    const y = yBase + height * (1 - ((1 - 0.3) * t + 0.3 * t * t));
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const rib = Math.sin(a * 18) * 0.03 * t;
      row.push(red.vert(cx + Math.cos(a) * r, y + rib + (t === 1 ? 0.04 : 0), cz + Math.sin(a) * r, (i / seg) * 18, t * 2));
    }
    grid.push(row);
  }
  for (let j = 0; j + 1 < grid.length; j++) {
    for (let i = 0; i < seg; i++) red.quad(grid[j][i + 1], grid[j][i], grid[j + 1][i], grid[j + 1][i + 1]);
  }
  // 滴水边
  const last = grid[grid.length - 1];
  for (let i = 0; i < seg; i++) {
    const p0i = last[i], p1i = last[i + 1];
    const p0 = [red.pos[p0i * 3], red.pos[p0i * 3 + 1], red.pos[p0i * 3 + 2]];
    const p1 = [red.pos[p1i * 3], red.pos[p1i * 3 + 1], red.pos[p1i * 3 + 2]];
    const b0 = red.vert(p0[0], p0[1] - 0.18, p0[2]);
    const b1 = red.vert(p1[0], p1[1] - 0.18, p1[2]);
    const t0 = red.vert(p0[0], p0[1], p0[2]);
    const t1 = red.vert(p1[0], p1[1], p1[2]);
    red.quad(t1, t0, b0, b1);
  }
  void ridge;
}

/** 老虎窗:小盒 + 迷你双坡 + 窗 */
function dormer(out: Piece[], x: number, y: number, z: number, yaw: number): void {
  const wall = piece(out, 'houseWall');
  const trim = piece(out, 'houseTrim');
  const glass = piece(out, 'glass');
  const wood = piece(out, 'woodDark');
  const b = new MeshBuf();
  const c: [number, number, number][] = [
    [-0.65, -1.3, 0.55], [0.65, -1.3, 0.55], [0.65, -1.3, -0.7], [-0.65, -1.3, -0.7],
    [-0.65, 1.15, 0.55], [0.65, 1.15, 0.55], [0.65, 1.15, -0.7], [-0.65, 1.15, -0.7],
  ];
  hexBox(b, c, 0.6);
  wall.append(b, x, y, z, 1, yaw);
  const red = new MeshBuf(), rg = new MeshBuf();
  gableRoof(red, rg, 1.5, 1.5, 0.75, 0.22, 0.04);
  piece(out, 'roofRed').append(red, x, y + 1.15, z - 0.07, 1, yaw + Math.PI / 2);
  piece(out, 'roofRidge').append(rg, x, y + 1.15, z - 0.07, 1, yaw + Math.PI / 2);
  const g = new MeshBuf();
  const gv = [
    g.vert(-0.32, 0.15, 0.56, 0, 0, [0, 0, 1]), g.vert(0.32, 0.15, 0.56, 1, 0, [0, 0, 1]),
    g.vert(0.32, 0.95, 0.56, 1, 1, [0, 0, 1]), g.vert(-0.32, 0.95, 0.56, 0, 1, [0, 0, 1]),
  ];
  g.quad(gv[0], gv[1], gv[2], gv[3]);
  glass.append(g, x, y, z, 1, yaw);
  plank(wood, [-0.36, 0.12, 0.58], [-0.36, 0.98, 0.58], 0.07, 0.05, [0, 0, 1], 230);
  const m2 = new MeshBuf();
  plank(m2, [0.36, 0.12, 0.58], [0.36, 0.98, 0.58], 0.07, 0.05, [0, 0, 1], 231);
  plank(m2, [0, 0.12, 0.58], [0, 0.98, 0.58], 0.05, 0.04, [0, 0, 1], 232);
  plank(m2, [-0.36, 0.55, 0.58], [0.36, 0.55, 0.58], 0.05, 0.04, [0, 0, 1], 233);
  wood.append(m2, x, y, z, 1, yaw);
  trim.append((() => { const s2 = new MeshBuf(); plank(s2, [-0.42, 0.08, 0.60], [0.42, 0.08, 0.60], 0.10, 0.08, [0, 0, 1], 234); return s2; })(), x, y, z, 1, yaw);
}

export { buildHouseReal as houseGeometry };

// ---- 围墙(弧线分段) + 台基 + 露台面 + 石阶 ----
export interface WallResult { pieces: Piece[]; colliders: BoxCollider[]; postTops: [number, number, number][]; }

export function buildWallAndTerrace(): WallResult {
  const out: Piece[] = [];
  const colliders: BoxCollider[] = [];
  const postTops: [number, number, number][] = [];
  const stone = piece(out, 'wallStone');
  const frame = piece(out, 'wallFrame');
  const wood = piece(out, 'woodDark');
  const floor = piece(out, 'terraceStone');
  const [CX, CZ] = TERRACE_CENTER;
  const R = TERRACE_R;
  const deg = Math.PI / 180;

  // ---- 上层露台铺装面(圆盘) + 边缘裙 ----
  {
    const seg = 28;
    const uvP = (x: number, z: number): [number, number] => [(x - CX) / 2.6, (z - CZ) / 2.6]; // 平面世界映射
    const c = floor.vert(CX, TERRACE_Y + 0.04, CZ, 0, 0, [0, 1, 0]);
    const rim: number[] = [], rim2: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const rx = CX - Math.sin(a) * (R + 0.3), rz = CZ + Math.cos(a) * (R + 0.3);
      const [uu, vv] = uvP(rx, rz);
      rim.push(floor.vert(rx, TERRACE_Y + 0.04, rz, uu, vv, [0, 1, 0]));
      rim2.push(floor.vert(CX - Math.sin(a) * (R + 0.5), TERRACE_Y - 2.4, CZ + Math.cos(a) * (R + 0.5), uu, vv + 1.8));
    }
    for (let i = 0; i < seg; i++) { floor.tri(rim[i], c, rim[i + 1]); floor.quad(rim[i], rim[i + 1], rim2[i + 1], rim2[i]); }
  }

  // ---- 挡土墙(view_01 主中景):矮弧墙,西端方形高段 + 木斜撑 ----
  {
    const phi0 = -18 * deg, phi1 = 42 * deg, step = 10 * deg;
    for (let phi = phi0; phi < phi1 - 1e-6; phi += step) {
      const pa = phi, pb = Math.min(phi + step, phi1);
      const mid = (pa + pb) / 2;
      const ax = RWALL_C[0] - Math.sin(pa) * RWALL_R, az = RWALL_C[1] + Math.cos(pa) * RWALL_R;
      const bx = RWALL_C[0] - Math.sin(pb) * RWALL_R, bz = RWALL_C[1] + Math.cos(pb) * RWALL_R;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const segLen = Math.hypot(bx - ax, bz - az);
      const tall = mid > 26 * deg;
      const topY = RWALL_TOP + (tall ? 0.55 : 0);
      const gOut = Math.min(groundHeight(mx, mz + 2.5), groundHeight(ax, az), groundHeight(bx, bz));
      const baseY = gOut - 0.5;
      const yaw = -Math.atan2(bz - az, bx - ax);
      {
        const b = new MeshBuf();
        const hw = segLen / 2 + 0.06, hh = (topY - baseY) / 2, hd = 0.30;
        const K = 1 / 1.4; // 石纹 1.4m 平铺
        const v = [
          b.vert(-hw, -hh, hd, 0, 2 * hh * K), b.vert(hw, -hh, hd, 2 * hw * K, 2 * hh * K),
          b.vert(hw, hh, hd, 2 * hw * K, 0), b.vert(-hw, hh, hd, 0, 0),
          b.vert(-hw, -hh, -hd, 0, 2 * hh * K), b.vert(hw, -hh, -hd, 2 * hw * K, 2 * hh * K),
          b.vert(hw, hh, -hd, 2 * hw * K, 0), b.vert(-hw, hh, -hd, 0, 0),
        ];
        b.quad(v[0], v[1], v[2], v[3]); b.quad(v[5], v[4], v[7], v[6]);
        b.quad(v[4], v[0], v[3], v[7]); b.quad(v[1], v[5], v[6], v[2]);
        stone.append(b, mx, (topY + baseY) / 2, mz, 1, yaw);
        colliders.push({ pos: [mx, (topY + baseY) / 2, mz], half: [hw, hh, 0.38], yaw });
      }
      // 压顶:逐块圆石
      {
        const nCap = Math.max(3, Math.round(segLen / 0.40));
        const capR = mulberry(Math.round(mx * 17 + mz * 7));
        for (let ci = 0; ci < nCap; ci++) {
          const t = (ci + 0.5) / nCap;
          const cxp = ax + (bx - ax) * t, czp = az + (bz - az) * t;
          stoneBlock(frame, cxp + (capR() - 0.5) * 0.08, topY + 0.10 + (capR() - 0.5) * 0.05, czp + (capR() - 0.5) * 0.08,
            0.40 + capR() * 0.10, 0.17 + capR() * 0.06, 0.34 + capR() * 0.08, 300 + ci * 7 + Math.round(mx), capR() * 3);
        }
      }
      // 高方段木斜撑
      if (tall) {
        tube(wood, [ax, baseY + 0.9, az], [bx, topY - 0.1, bz], 0.07, 0.07, 5);
        tube(wood, [ax, topY - 0.1, az], [bx, baseY + 0.9, bz], 0.07, 0.07, 5);
      }
      // 石柱(隔段)+ 柱顶(放盆栽)
      const idx = Math.round((phi - phi0) / step);
      if (idx % 2 === 0 || tall) {
        const p = new MeshBuf();
        const hw2 = 0.36, hh2 = (topY + 0.3 - baseY) / 2, hd2 = 0.36;
        const v = [
          p.vert(-hw2, -hh2, hd2), p.vert(hw2, -hh2, hd2), p.vert(hw2, hh2, hd2), p.vert(-hw2, hh2, hd2),
          p.vert(-hw2, -hh2, -hd2), p.vert(hw2, -hh2, -hd2), p.vert(hw2, hh2, -hd2), p.vert(-hw2, hh2, -hd2),
        ];
        p.quad(v[0], v[1], v[2], v[3]); p.quad(v[5], v[4], v[7], v[6]);
        p.quad(v[4], v[0], v[3], v[7]); p.quad(v[1], v[5], v[6], v[2]);
        p.quad(v[3], v[2], v[6], v[7]);
        frame.append(p, ax, (topY + 0.3 + baseY) / 2, az, 1, yaw);
        postTops.push([ax, topY + 0.55, az]);
      }
    }
  }

  // ---- 上层露台矮护栏(东北弧,view_02/03 可见;南面敞开对花园坡) ----
  {
    const phi0 = -128 * deg, phi1 = -30 * deg, step = 14 * deg;
    for (let phi = phi0; phi < phi1 - 1e-6; phi += step) {
      const pa = phi, pb = Math.min(phi + step, phi1);
      // 阶梯开口
      const midDeg = ((pa + pb) / 2) / deg;
      if (midDeg > -125 && midDeg < -100) continue;
      const ax = CX - Math.sin(pa) * R, az = CZ + Math.cos(pa) * R;
      const bx = CX - Math.sin(pb) * R, bz = CZ + Math.cos(pb) * R;
      const mx = (ax + bx) / 2, mz = (az + bz) / 2;
      const segLen = Math.hypot(bx - ax, bz - az);
      const topY = TERRACE_Y + 1.0;
      const baseY = TERRACE_Y - 1.6;
      const yaw = -Math.atan2(bz - az, bx - ax);
      const b = new MeshBuf();
      const hw = segLen / 2 + 0.05, hh = (topY - baseY) / 2, hd = 0.22;
      const K = 1 / 1.4;
      const v = [
        b.vert(-hw, -hh, hd, 0, 2 * hh * K), b.vert(hw, -hh, hd, 2 * hw * K, 2 * hh * K),
        b.vert(hw, hh, hd, 2 * hw * K, 0), b.vert(-hw, hh, hd, 0, 0),
        b.vert(-hw, -hh, -hd, 0, 2 * hh * K), b.vert(hw, -hh, -hd, 2 * hw * K, 2 * hh * K),
        b.vert(hw, hh, -hd, 2 * hw * K, 0), b.vert(-hw, hh, -hd, 0, 0),
      ];
      b.quad(v[0], v[1], v[2], v[3]); b.quad(v[5], v[4], v[7], v[6]);
      b.quad(v[4], v[0], v[3], v[7]); b.quad(v[1], v[5], v[6], v[2]);
      stone.append(b, mx, (topY + baseY) / 2, mz, 1, yaw);
      colliders.push({ pos: [mx, (topY + baseY) / 2, mz], half: [hw, hh, 0.28], yaw });
      {
        const nCap = Math.max(2, Math.round(segLen / 0.5));
        const capR = mulberry(Math.round(mx * 13 + mz * 5));
        for (let ci = 0; ci < nCap; ci++) {
          const t = (ci + 0.5) / nCap;
          stoneBlock(frame, ax + (bx - ax) * t, topY + 0.08, az + (bz - az) * t,
            0.28 + capR() * 0.08, 0.13 + capR() * 0.05, 0.24 + capR() * 0.06, 500 + ci * 3 + Math.round(mx), capR() * 3);
        }
      }
    }
  }

  // ---- 石阶(A4):露台东北缘向外下到洼地 ----
  {
    const dirX = 0.83, dirZ = -0.55;
    const sx = CX + dirX * R, sz = CZ + dirZ * R;
    const steps = 15, rise = 0.22, run = 0.34, width = 2.3;
    const px = -dirZ, pz = dirX;
    const st = piece(out, 'terraceStone');
    for (let i = 0; i < steps; i++) {
      const t0 = i * run;
      const y1 = TERRACE_Y - i * rise, y0 = y1 - rise - 0.06;
      const x0 = sx + dirX * t0, z0 = sz + dirZ * t0;
      const x1 = sx + dirX * (t0 + run + 0.06), z1 = sz + dirZ * (t0 + run + 0.06);
      const uvw = (xx: number, zz: number): [number, number] => [xx / 1.4, zz / 1.4];
      const v = [
        st.vert(x0 - px * width / 2, y1, z0 - pz * width / 2, ...uvw(x0 - px * width / 2, z0 - pz * width / 2)),
        st.vert(x0 + px * width / 2, y1, z0 + pz * width / 2, ...uvw(x0 + px * width / 2, z0 + pz * width / 2)),
        st.vert(x1 + px * width / 2, y1, z1 + pz * width / 2, ...uvw(x1 + px * width / 2, z1 + pz * width / 2)),
        st.vert(x1 - px * width / 2, y1, z1 - pz * width / 2, ...uvw(x1 - px * width / 2, z1 - pz * width / 2)),
        st.vert(x1 + px * width / 2, y0, z1 + pz * width / 2, ...uvw(x1 + px * width / 2, z1 + pz * width / 2)),
        st.vert(x1 - px * width / 2, y0, z1 - pz * width / 2, ...uvw(x1 - px * width / 2, z1 - pz * width / 2)),
      ];
      st.quad(v[0], v[1], v[2], v[3]);
      st.quad(v[3], v[2], v[4], v[5]);
    }
    for (const s of [-1, 1]) {
      tube(frame,
        [sx + px * s * (width / 2 + 0.15), TERRACE_Y + 0.5, sz + pz * s * (width / 2 + 0.15)],
        [sx + dirX * (steps * run) + px * s * (width / 2 + 0.15), TERRACE_Y - steps * rise + 0.5, sz + dirZ * (steps * run) + pz * s * (width / 2 + 0.15)],
        0.16, 0.16, 6);
    }
  }
  return { pieces: out, colliders, postTops };
}

/** 阶梯行走坡道(与 buildWallAndTerrace 的石阶同参数;terrain 行走用) */
export function stairsRampHeight(x: number, z: number): number | null {
  const [CX, CZ] = TERRACE_CENTER;
  const dirX = 0.83, dirZ = -0.55;
  const sx = CX + dirX * TERRACE_R, sz = CZ + dirZ * TERRACE_R;
  const dx = x - sx, dz = z - sz;
  const t = dx * dirX + dz * dirZ;
  const lat = Math.abs(-dx * dirZ + dz * dirX);
  if (t < -0.5 || t > 15 * 0.34 + 0.6 || lat > 1.4) return null;
  return TERRACE_Y - Math.max(0, t / 0.34) * 0.22 + 0.06;
}
