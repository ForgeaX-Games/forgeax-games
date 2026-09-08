// 零依赖图像工具：PNG 解码 / 裁剪 / 缩放 / 统计 / 调色板 / 轮廓 / 两图比对。
// 这个容器没有 PIL / numpy / ffmpeg / ImageMagick，所以自带。
//
// 这是现成的基础设施，直接用，不要重写。两类用途：
//   1) 参考图定量拆解（地平线、明度结构、主色）—— 别靠肉眼估数字
//   2) 每轮截图与 view_01 的差距度量 —— 验收判据的像素读数来源
//
// 判据本身不在这里，要自己写（见 PROMPT.md §3）。这个文件只提供读像素的原语。
import fs from 'node:fs';
import zlib from 'node:zlib';

// ---------- 解码 ----------
export function readPng(path) {
  const buf = fs.readFileSync(path);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not png: ' + path);
  let off = 8, ihdr = null;
  const idat = [];
  let plte = null, trns = null;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        depth: data[8], colorType: data[9], interlace: data[12],
      };
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'PLTE') plte = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error('no IHDR');
  if (ihdr.interlace !== 0) throw new Error('interlaced png unsupported');
  if (ihdr.depth !== 8) throw new Error('bit depth ' + ihdr.depth + ' unsupported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.colorType];
  if (!channels) throw new Error('colorType ' + ihdr.colorType);

  const raw = zlib.inflateSync(Buffer.concat(idat));
  const { width: w, height: h } = ihdr;
  const bpp = channels;               // 8-bit => bytes per pixel == channels
  const stride = w * bpp;
  const out = Buffer.alloc(stride * h);
  let p = 0;
  for (let y = 0; y < h; y++) {
    const filter = raw[p++];
    const line = raw.subarray(p, p + stride); p += stride;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 255; break;
        case 2: v = (v + b) & 255; break;
        case 3: v = (v + ((a + b) >> 1)) & 255; break;
        case 4: {
          const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c);
          const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          v = (v + pr) & 255; break;
        }
        default: throw new Error('filter ' + filter);
      }
      cur[x] = v;
    }
  }
  // 统一转成 RGB
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    let r, g, b;
    if (ihdr.colorType === 0 || ihdr.colorType === 4) { r = g = b = out[i * bpp]; }
    else if (ihdr.colorType === 3) { const q = out[i] * 3; r = plte[q]; g = plte[q + 1]; b = plte[q + 2]; }
    else { r = out[i * bpp]; g = out[i * bpp + 1]; b = out[i * bpp + 2]; }
    rgb[i * 3] = r; rgb[i * 3 + 1] = g; rgb[i * 3 + 2] = b;
  }
  return { width: w, height: h, rgb };
}

// ---------- 编码 ----------
const CRC = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function writePng(path, w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  }
  fs.writeFileSync(path, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]));
}

// ---------- 几何操作 ----------
export function crop(img, x, y, w, h) {
  x = Math.max(0, x | 0); y = Math.max(0, y | 0);
  w = Math.min(w | 0, img.width - x); h = Math.min(h | 0, img.height - y);
  const rgb = Buffer.alloc(w * h * 3);
  for (let j = 0; j < h; j++)
    img.rgb.copy(rgb, j * w * 3, ((y + j) * img.width + x) * 3, ((y + j) * img.width + x + w) * 3);
  return { width: w, height: h, rgb };
}
/** box-filter 缩放，dw/dh 任意 */
export function resize(img, dw, dh) {
  const rgb = Buffer.alloc(dw * dh * 3);
  const sx = img.width / dw, sy = img.height / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let j = y0; j < y1 && j < img.height; j++)
        for (let i = x0; i < x1 && i < img.width; i++) {
          const q = (j * img.width + i) * 3; r += img.rgb[q]; g += img.rgb[q + 1]; b += img.rgb[q + 2]; n++;
        }
      const q = (y * dw + x) * 3;
      rgb[q] = r / n; rgb[q + 1] = g / n; rgb[q + 2] = b / n;
    }
  }
  return { width: dw, height: dh, rgb };
}

// ---------- 统计 ----------
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function stats(img) {
  const { width: w, height: h, rgb } = img;
  let r = 0, g = 0, b = 0, l = 0, n = w * h;
  const hist = new Array(16).fill(0);
  for (let i = 0; i < n; i++) {
    const R = rgb[i * 3], G = rgb[i * 3 + 1], B = rgb[i * 3 + 2];
    r += R; g += G; b += B;
    const L = lum(R, G, B); l += L;
    hist[Math.min(15, (L / 16) | 0)]++;
  }
  return {
    mean: [r / n, g / n, b / n].map(v => +v.toFixed(1)),
    meanLum: +(l / n).toFixed(1),
    lumHist: hist.map(v => +(v / n * 100).toFixed(1)),
  };
}

/** 每行平均色 + 明度，用来找地平线和明度带 */
export function rowProfile(img, step = 1) {
  const out = [];
  for (let y = 0; y < img.height; y += step) {
    let r = 0, g = 0, b = 0;
    for (let x = 0; x < img.width; x++) {
      const q = (y * img.width + x) * 3; r += img.rgb[q]; g += img.rgb[q + 1]; b += img.rgb[q + 2];
    }
    const n = img.width;
    out.push({ y, r: +(r / n).toFixed(1), g: +(g / n).toFixed(1), b: +(b / n).toFixed(1), L: +lum(r / n, g / n, b / n).toFixed(1) });
  }
  return out;
}

export function colProfile(img, step = 1) {
  const out = [];
  for (let x = 0; x < img.width; x += step) {
    let r = 0, g = 0, b = 0;
    for (let y = 0; y < img.height; y++) {
      const q = (y * img.width + x) * 3; r += img.rgb[q]; g += img.rgb[q + 1]; b += img.rgb[q + 2];
    }
    const n = img.height;
    out.push({ x, r: +(r / n).toFixed(1), g: +(g / n).toFixed(1), b: +(b / n).toFixed(1), L: +lum(r / n, g / n, b / n).toFixed(1) });
  }
  return out;
}

/** 量化调色板：4bit/通道 桶，返回占比最高的 k 个 */
export function palette(img, k = 12) {
  const m = new Map();
  const n = img.width * img.height;
  for (let i = 0; i < n; i++) {
    const R = img.rgb[i * 3] >> 4, G = img.rgb[i * 3 + 1] >> 4, B = img.rgb[i * 3 + 2] >> 4;
    const key = (R << 8) | (G << 4) | B;
    const e = m.get(key);
    if (e) { e.n++; e.r += img.rgb[i * 3]; e.g += img.rgb[i * 3 + 1]; e.b += img.rgb[i * 3 + 2]; }
    else m.set(key, { n: 1, r: img.rgb[i * 3], g: img.rgb[i * 3 + 1], b: img.rgb[i * 3 + 2] });
  }
  return [...m.values()].sort((a, b) => b.n - a.n).slice(0, k).map(e => ({
    pct: +(e.n / n * 100).toFixed(2),
    rgb: [Math.round(e.r / e.n), Math.round(e.g / e.n), Math.round(e.b / e.n)],
    hex: '#' + [e.r, e.g, e.b].map(v => Math.round(v / e.n).toString(16).padStart(2, '0')).join(''),
  }));
}

/** 一张图的 sky/ground 分界：从上往下找 B-R 差值由正转负、且明度显著下降的行 */
export function horizon(img) {
  const p = rowProfile(resize(img, 160, img.height));
  let best = -1, bestScore = -1e9;
  for (let i = 4; i < p.length - 4; i++) {
    const above = p.slice(Math.max(0, i - 20), i);
    const below = p.slice(i, Math.min(p.length, i + 20));
    const aL = above.reduce((s, v) => s + v.L, 0) / above.length;
    const bL = below.reduce((s, v) => s + v.L, 0) / below.length;
    const aBR = above.reduce((s, v) => s + (v.b - v.r), 0) / above.length;
    const bBR = below.reduce((s, v) => s + (v.b - v.r), 0) / below.length;
    const score = (aL - bL) + (aBR - bBR) * 1.5;
    if (score > bestScore) { bestScore = score; best = p[i].y; }
  }
  return { y: best, yNorm: +(best / img.height).toFixed(3), score: +bestScore.toFixed(1) };
}

/**
 * 每列从上往下的轮廓线：非天空首行（B−R 掉到 skyDelta 以下）与明确实体首行
 * （掉到 opaqueDelta 以下）。天际线类的结构判据都从这里取数。
 */
export function silhouette(img, cols = 64, skyDelta = 100, opaqueDelta = 30) {
  const out = [];
  for (let k = 0; k < cols; k++) {
    const x = Math.min(img.width - 1, Math.round((k + 0.5) * img.width / cols));
    let ySky = -1, yOp = -1;
    for (let y = 0; y < img.height; y++) {
      const q = (y * img.width + x) * 3;
      const d = img.rgb[q + 2] - img.rgb[q];          // 天空是青蓝：B 远高于 R
      if (ySky < 0 && d < skyDelta) ySky = y;
      if (d < opaqueDelta) { yOp = y; break; }
    }
    out.push({
      u: +((x + 0.5) / img.width).toFixed(3),
      vSky: ySky < 0 ? null : +(ySky / img.height).toFixed(3),
      vOpaque: yOp < 0 ? null : +(yOp / img.height).toFixed(3),
    });
  }
  return out;
}

/** silhouette 在 u∈[u0,u1] 上的 min/max 摘要，直接对应判据的容差区间。 */
export function silhouetteRange(img, u0, u1, cols = 128) {
  const sel = silhouette(img, cols).filter((s) => s.u >= u0 && s.u <= u1);
  const pick = (key) => sel.map((s) => s[key]).filter((v) => v !== null);
  const sum = (a) => (a.length ? { min: Math.min(...a), max: Math.max(...a), n: a.length } : null);
  return { u: [u0, u1], sky: sum(pick('vSky')), opaque: sum(pick('vOpaque')) };
}

/** 两图比对：先缩到同尺寸，再报 mean/lum 差、直方图差、分块明度差 */
export function compare(a, b, gw = 8, gh = 6) {
  const W = 320, H = Math.round(W * a.height / a.width);
  const A = resize(a, W, H), B = resize(b, W, H);
  const sa = stats(A), sb = stats(B);
  const gridA = [], gridB = [], gridD = [];
  for (let gy = 0; gy < gh; gy++) {
    const ra = [], rb = [], rd = [];
    for (let gx = 0; gx < gw; gx++) {
      const cw = Math.floor(W / gw), ch = Math.floor(H / gh);
      const ca = crop(A, gx * cw, gy * ch, cw, ch), cb = crop(B, gx * cw, gy * ch, cw, ch);
      const la = stats(ca).meanLum, lb = stats(cb).meanLum;
      ra.push(la); rb.push(lb); rd.push(+(lb - la).toFixed(1));
    }
    gridA.push(ra); gridB.push(rb); gridD.push(rd);
  }
  return {
    a: sa, b: sb,
    dMean: sa.mean.map((v, i) => +(sb.mean[i] - v).toFixed(1)),
    dLum: +(sb.meanLum - sa.meanLum).toFixed(1),
    horizonA: horizon(a), horizonB: horizon(b),
    gridLumA: gridA, gridLumB: gridB, gridLumDelta: gridD,
  };
}

// ---------- CLI ----------
if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...rest] = process.argv.slice(2);
  const J = (o) => console.log(JSON.stringify(o, null, 1));
  if (cmd === 'info') {
    for (const f of rest) { const im = readPng(f); J({ f, w: im.width, h: im.height, ...stats(im), horizon: horizon(im) }); }
  } else if (cmd === 'palette') {
    for (const f of rest) { console.log('==', f); J(palette(readPng(f), Number(process.env.K || 14))); }
  } else if (cmd === 'rows') {
    const im = readPng(rest[0]); J(rowProfile(im, Number(process.env.STEP || 30)));
  } else if (cmd === 'cols') {
    const im = readPng(rest[0]); J(colProfile(im, Number(process.env.STEP || 60)));
  } else if (cmd === 'crop') {
    // crop in.png out.png x y w h [scaleW]
    const [i, o, x, y, w, h, sw] = rest;
    let c = crop(readPng(i), +x, +y, +w, +h);
    if (sw) c = resize(c, +sw, Math.round(+sw * c.height / c.width));
    writePng(o, c.width, c.height, c.rgb); console.log('→', o, c.width + 'x' + c.height);
  } else if (cmd === 'scale') {
    const [i, o, w] = rest; const im = readPng(i);
    const r = resize(im, +w, Math.round(+w * im.height / im.width));
    writePng(o, r.width, r.height, r.rgb); console.log('→', o, r.width + 'x' + r.height);
  } else if (cmd === 'region') {
    // region in.png x y w h  -> 该区域统计+调色板
    const [i, x, y, w, h] = rest; const c = crop(readPng(i), +x, +y, +w, +h);
    J({ region: [+x, +y, +w, +h], ...stats(c), palette: palette(c, 8) });
  } else if (cmd === 'compare') {
    J(compare(readPng(rest[0]), readPng(rest[1])));
  } else if (cmd === 'sky') {
    // sky in.png [u0 u1 ...] —— 无 u 参数时列出全部列，有则只报区间摘要
    const im = readPng(rest[0]);
    if (rest.length < 3) J(silhouette(im, Number(process.env.COLS || 40)));
    else for (let i = 1; i + 1 < rest.length; i += 2) J(silhouetteRange(im, +rest[i], +rest[i + 1]));
  } else {
    console.log('usage: imgtool.mjs <info|palette|rows|cols|crop|scale|region|compare|sky> …');
  }
}
