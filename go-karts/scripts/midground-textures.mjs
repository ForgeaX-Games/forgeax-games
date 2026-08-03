/**
 * Offline midground textures (distilled from EuroStreet / CityStreet canvas draws).
 * No DOM canvas — pure RGBA buffers + pngjs. Used by bake-race-world + postprocess.
 */
import { PNG } from 'pngjs';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const MID_TEX_DIR = join(__dirname, '..', 'assets', 'mid_tex');

const SHOPS = {
  pizza: { name: 'PIZZA', board: [224, 85, 72], icon: 'pizza' },
  burger: { name: 'BURGER', board: [240, 161, 50], icon: 'burger' },
  gelato: { name: 'GELATO', board: [255, 158, 176], icon: 'gelato' },
  cake: { name: 'CAKE', board: [185, 138, 212], icon: 'cake' },
};

function fill(data, w, h, r, g, b, a = 255) {
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = a;
  }
}

function rect(data, w, h, x0, y0, rw, rh, r, g, b) {
  for (let y = y0; y < y0 + rh; y++) {
    for (let x = x0; x < x0 + rw; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const o = (y * w + x) * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
}

function circle(data, w, h, cx, cy, rad, r, g, b) {
  const r2 = rad * rad;
  for (let y = Math.floor(cy - rad); y <= cy + rad; y++) {
    for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const dx = x - cx,
        dy = y - cy;
      if (dx * dx + dy * dy <= r2) {
        const o = (y * w + x) * 4;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = 255;
      }
    }
  }
}

/** 5×7 block glyphs for shop names (readable at 256px). */
const GLYPHS = {
  P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  Z: ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
  R: ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  C: ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
  K: ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
  F: ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
  M: ['10001', '11011', '10101', '10001', '10001', '10001', '10001'],
  W: ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  D: ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  '!': ['00100', '00100', '00100', '00100', '00100', '00000', '00100'],
};

function drawText(data, w, h, text, x0, y0, scale, r, g, b) {
  let x = x0;
  for (const ch of text) {
    const g7 = GLYPHS[ch];
    if (!g7) {
      x += 4 * scale;
      continue;
    }
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (g7[row][col] !== '1') continue;
        rect(data, w, h, x + col * scale, y0 + row * scale, scale, scale, r, g, b);
      }
    }
    x += 6 * scale;
  }
}

function drawShopIcon(data, w, h, kind, cx, cy, rad) {
  if (kind === 'pizza') {
    circle(data, w, h, cx, cy, rad, 232, 165, 78);
    circle(data, w, h, cx, cy, rad * 0.72, 247, 208, 116);
    for (const [dx, dy] of [
      [-0.3, -0.2],
      [0.28, -0.25],
      [0.05, 0.2],
      [-0.25, 0.3],
    ]) {
      circle(data, w, h, cx + dx * rad, cy + dy * rad, rad * 0.12, 224, 85, 72);
    }
  } else if (kind === 'burger') {
    rect(data, w, h, cx - rad * 0.85, cy - rad * 0.15, rad * 1.7, rad * 0.2, 126, 203, 95);
    rect(data, w, h, cx - rad * 0.8, cy + rad * 0.05, rad * 1.6, rad * 0.28, 138, 80, 48);
    circle(data, w, h, cx, cy - rad * 0.35, rad * 0.75, 232, 165, 78);
  } else if (kind === 'gelato') {
    // cone
    for (let y = 0; y < rad; y++) {
      const half = ((rad - y) / rad) * rad * 0.4;
      rect(data, w, h, cx - half, cy + y * 0.1, half * 2, 2, 232, 165, 78);
    }
    circle(data, w, h, cx - rad * 0.15, cy - rad * 0.35, rad * 0.38, 255, 158, 176);
    circle(data, w, h, cx + rad * 0.2, cy - rad * 0.28, rad * 0.32, 255, 242, 221);
  } else {
    // cake
    rect(data, w, h, cx - rad * 0.5, cy, rad, rad * 0.7, 255, 138, 61);
    circle(data, w, h, cx - rad * 0.25, cy - rad * 0.1, rad * 0.22, 255, 242, 221);
    circle(data, w, h, cx + rad * 0.25, cy - rad * 0.1, rad * 0.22, 255, 242, 221);
    circle(data, w, h, cx, cy - rad * 0.35, rad * 0.28, 255, 242, 221);
  }
}

export function buildShopSignPng(kind) {
  const s = SHOPS[kind];
  const w = 256,
    h = 88;
  const data = Buffer.alloc(w * h * 4);
  fill(data, w, h, s.board[0], s.board[1], s.board[2]);
  // cream border
  rect(data, w, h, 6, 6, w - 12, 4, 255, 250, 236);
  rect(data, w, h, 6, h - 10, w - 12, 4, 255, 250, 236);
  rect(data, w, h, 6, 6, 4, h - 12, 255, 250, 236);
  rect(data, w, h, w - 10, 6, 4, h - 12, 255, 250, 236);
  drawShopIcon(data, w, h, s.icon, 46, 44, 26);
  drawText(data, w, h, s.name, 88, 28, 5, 255, 250, 236);
  const png = new PNG({ width: w, height: h });
  png.data = data;
  return PNG.sync.write(png);
}

export function buildAwningPng(boardRgb) {
  const w = 128,
    h = 32;
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < 8; i++) {
    const on = i % 2 === 0;
    const r = on ? boardRgb[0] : 253;
    const g = on ? boardRgb[1] : 250;
    const b = on ? boardRgb[2] : 240;
    rect(data, w, h, i * 16, 0, 16, 32, r, g, b);
  }
  const png = new PNG({ width: w, height: h });
  png.data = data;
  return PNG.sync.write(png);
}

/** City glass curtain — dark panes on pale frame. */
export function buildWindowGridPng() {
  const w = 128,
    h = 128;
  const data = Buffer.alloc(w * h * 4);
  fill(data, w, h, 180, 210, 230);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = x % 16;
      const gy = y % 20;
      if (gx < 2 || gy < 2) {
        // mullion
        const o = (y * w + x) * 4;
        data[o] = 230;
        data[o + 1] = 235;
        data[o + 2] = 240;
      } else if (gx > 3 && gx < 14 && gy > 3 && gy < 17) {
        const o = (y * w + x) * 4;
        data[o] = 74;
        data[o + 1] = 122;
        data[o + 2] = 160;
      }
    }
  }
  const png = new PNG({ width: w, height: h });
  png.data = data;
  return PNG.sync.write(png);
}

/** Generic label plaque (CHINATOWN / TOYS / PET MALL …). */
export function buildLabelPng(text, bg = [184, 72, 60], fg = [255, 250, 236], w = 256, h = 88) {
  const data = Buffer.alloc(w * h * 4);
  fill(data, w, h, bg[0], bg[1], bg[2]);
  rect(data, w, h, 6, 6, w - 12, 4, fg[0], fg[1], fg[2]);
  rect(data, w, h, 6, h - 10, w - 12, 4, fg[0], fg[1], fg[2]);
  rect(data, w, h, 6, 6, 4, h - 12, fg[0], fg[1], fg[2]);
  rect(data, w, h, w - 10, 6, 4, h - 12, fg[0], fg[1], fg[2]);
  const scale = text.length > 8 ? 3 : text.length > 5 ? 4 : 5;
  const glyphW = 5 * scale + scale;
  const totalW = text.length * glyphW;
  const x0 = Math.max(12, Math.floor((w - totalW) / 2));
  drawText(data, w, h, text, x0, Math.floor((h - 7 * scale) / 2), scale, fg[0], fg[1], fg[2]);
  const png = new PNG({ width: w, height: h });
  png.data = data;
  return PNG.sync.write(png);
}

function ellipse(data, w, h, cx, cy, rx, ry, r, g, b) {
  for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
    for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const dx = (x - cx) / rx,
        dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) {
        const o = (y * w + x) * 4;
        data[o] = r;
        data[o + 1] = g;
        data[o + 2] = b;
        data[o + 3] = 255;
      }
    }
  }
}

/** Yellow paw prints on red — city createPawBanner cloth. */
export function buildPawBannerPng(w = 512, h = 96) {
  const data = Buffer.alloc(w * h * 4);
  fill(data, w, h, 224, 72, 72);
  rect(data, w, h, 0, 0, w, 10, 199, 58, 58);
  rect(data, w, h, 0, h - 10, w, 10, 199, 58, 58);
  const paw = (cx, cy, rad) => {
    ellipse(data, w, h, cx, cy + rad * 0.35, rad * 0.75, rad * 0.6, 255, 210, 62);
    for (const [dx, dy] of [
      [-0.7, -0.55],
      [0, -0.8],
      [0.7, -0.55],
    ]) {
      circle(data, w, h, cx + dx * rad, cy + dy * rad, rad * 0.3, 255, 210, 62);
    }
  };
  for (let i = 0; i < 6; i++) paw(58 + i * 80, 48, 22);
  const png = new PNG({ width: w, height: h });
  png.data = data;
  return PNG.sync.write(png);
}

/** Yellow chevron bend warning (3 white arrows). */
export function buildChevronPng(w = 256, h = 128) {
  const data = Buffer.alloc(w * h * 4);
  fill(data, w, h, 255, 210, 62);
  rect(data, w, h, 6, 6, w - 12, 4, 232, 165, 29);
  rect(data, w, h, 6, h - 10, w - 12, 4, 232, 165, 29);
  rect(data, w, h, 6, 6, 4, h - 12, 232, 165, 29);
  rect(data, w, h, w - 10, 6, 4, h - 12, 232, 165, 29);
  const arrow = (cx) => {
    // filled chevron pointing right: two triangles via circles approximation — use block fill
    for (let y = 20; y < h - 20; y++) {
      const dy = Math.abs(y - h / 2);
      const tip = 28 - dy * 0.55;
      for (let x = Math.floor(cx - 18); x < Math.floor(cx + tip); x++) {
        if (x < 0 || x >= w) continue;
        const o = (y * w + x) * 4;
        data[o] = 255;
        data[o + 1] = 255;
        data[o + 2] = 255;
        data[o + 3] = 255;
      }
    }
  };
  arrow(70);
  arrow(128);
  arrow(186);
  const png = new PNG({ width: w, height: h });
  png.data = data;
  return PNG.sync.write(png);
}

/**
 * Seamless cartoon lawn tile: mottled greens + tiny flower confetti.
 * Reference kart games read grass as patterned, not a flat lime slab.
 */
export function buildGrassTilePng(size = 512) {
  const w = size;
  const h = size;
  const data = Buffer.alloc(w * h * 4);
  // Soft base mottling (tileable via wrap-around samples).
  const hash = (x, y) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  const sample = (x, y) => {
    const xi = ((x % w) + w) % w;
    const yi = ((y % h) + h) % h;
    return hash(xi, yi);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n0 = sample(x, y);
      const n1 = sample(x * 0.37 + 20, y * 0.37 + 11);
      const n2 = sample(x * 0.13 + 3, y * 0.13 + 7);
      const blade = sample(x * 2.1, y * 2.1);
      const tone = 0.55 + n0 * 0.22 + n1 * 0.12 + n2 * 0.08;
      let r = 72 + tone * 48 + blade * 18;
      let g = 150 + tone * 55 + blade * 22;
      let b = 48 + tone * 28;
      // Occasional darker soil / shadow flecks.
      if (n0 > 0.92 && n1 > 0.55) {
        r *= 0.78;
        g *= 0.82;
        b *= 0.7;
      }
      // Lighter sun patches.
      if (n2 > 0.88) {
        r = Math.min(255, r + 18);
        g = Math.min(255, g + 22);
        b = Math.min(255, b + 10);
      }
      const o = (y * w + x) * 4;
      data[o] = Math.min(255, Math.max(0, r));
      data[o + 1] = Math.min(255, Math.max(0, g));
      data[o + 2] = Math.min(255, Math.max(0, b));
      data[o + 3] = 255;
    }
  }
  // Flower confetti (small clusters, wrapped for seamless tiling).
  const flowers = [
    [255, 120, 150],
    [255, 220, 70],
    [255, 160, 70],
    [240, 100, 210],
    [255, 255, 245],
    [255, 90, 110],
  ];
  const stampFlower = (cx, cy, rad, rgb) => {
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dy * dy > rad * rad) continue;
        const x = ((cx + dx) % w + w) % w;
        const y = ((cy + dy) % h + h) % h;
        const o = (y * w + x) * 4;
        const edge = Math.sqrt(dx * dx + dy * dy) / rad;
        const k = edge > 0.7 ? 0.65 : 1;
        data[o] = Math.round(rgb[0] * k + data[o] * (1 - k));
        data[o + 1] = Math.round(rgb[1] * k + data[o + 1] * (1 - k));
        data[o + 2] = Math.round(rgb[2] * k + data[o + 2] * (1 - k));
      }
    }
    // Tiny yellow center.
    const o = ((((cy % h) + h) % h) * w + (((cx % w) + w) % w)) * 4;
    data[o] = 255;
    data[o + 1] = 230;
    data[o + 2] = 90;
  };
  for (let i = 0; i < 90; i++) {
    const fx = Math.floor(hash(i, 1.3) * w);
    const fy = Math.floor(hash(i, 2.7) * h);
    const rad = 2 + Math.floor(hash(i, 4.1) * 3);
    stampFlower(fx, fy, rad, flowers[i % flowers.length]);
  }
  // Soft clover / leaf dots (darker green blobs).
  for (let i = 0; i < 40; i++) {
    const fx = Math.floor(hash(i, 8.2) * w);
    const fy = Math.floor(hash(i, 9.5) * h);
    const rad = 3 + Math.floor(hash(i, 3.3) * 4);
    stampFlower(fx, fy, rad, [90, 170, 70]);
  }
  const png = new PNG({ width: w, height: h });
  png.data = data;
  return PNG.sync.write(png);
}

export function writeAllMidTextures() {
  if (!existsSync(MID_TEX_DIR)) mkdirSync(MID_TEX_DIR, { recursive: true });
  const out = {};
  const grass = buildGrassTilePng(512);
  writeFileSync(join(MID_TEX_DIR, 'grass_tile.png'), grass);
  out.grass_tile = grass;
  for (const kind of Object.keys(SHOPS)) {
    const sign = buildShopSignPng(kind);
    const awn = buildAwningPng(SHOPS[kind].board);
    writeFileSync(join(MID_TEX_DIR, `sign_${kind}.png`), sign);
    writeFileSync(join(MID_TEX_DIR, `awning_${kind}.png`), awn);
    out[`sign_${kind}`] = sign;
    out[`awning_${kind}`] = awn;
  }
  const win = buildWindowGridPng();
  writeFileSync(join(MID_TEX_DIR, 'window_grid.png'), win);
  out.window_grid = win;

  const paw = buildPawBannerPng();
  writeFileSync(join(MID_TEX_DIR, 'banner_paw.png'), paw);
  out.banner_paw = paw;

  const chev = buildChevronPng();
  writeFileSync(join(MID_TEX_DIR, 'sign_chevron.png'), chev);
  out.sign_chevron = chev;

  const labels = {
    sign_chinatown: ['CHINATOWN', [232, 178, 58], [90, 40, 20], 320, 96],
    sign_toys: ['TOYS', [255, 248, 236], [122, 74, 38]],
    sign_cafe: ['CAFE', [255, 248, 236], [122, 74, 38]],
    sign_gifts: ['GIFTS', [255, 248, 236], [122, 74, 38]],
    sign_petmall: ['PET MALL', [255, 138, 77], [255, 255, 255]],
    sign_seeyou: ['SEE YOU!', [255, 138, 77], [255, 255, 255]],
    sign_go: ['GO', [63, 169, 245], [255, 255, 255]],
    sign_noodle: ['NOODLE', [226, 87, 76], [255, 247, 232]],
    sign_teahouse: ['TEA', [63, 157, 107], [255, 247, 232]],
    sign_baobao: ['BAO', [229, 154, 47], [255, 247, 232]],
    sign_goldenwok: ['GOLDEN', [232, 178, 58], [90, 40, 20]],
    sign_luckydragon: ['DRAGON', [232, 178, 58], [90, 40, 20]],
    sign_dimsum: ['DIM SUM', [232, 178, 58], [90, 40, 20]],
    sign_jadepalace: ['JADE', [232, 178, 58], [90, 40, 20]],
    sign_teagarden: ['TEA', [232, 178, 58], [90, 40, 20]],
    sign_baohouse: ['BAO', [232, 178, 58], [90, 40, 20]],
  };
  for (const [file, [text, bg, fg, ww, hh]] of Object.entries(labels)) {
    const buf = buildLabelPng(text, bg, fg, ww || 256, hh || 88);
    writeFileSync(join(MID_TEX_DIR, `${file}.png`), buf);
    out[file] = buf;
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeAllMidTextures();
  console.log('Wrote mid textures to', MID_TEX_DIR);
}
