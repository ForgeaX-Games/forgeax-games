// 判据(PROMPT §3):回归哨兵 + 判据自检。硬底线(可玩/性能)在 tools/patrol.mjs。
//
//   node tools/judge.mjs shots/r7.png            # 比对 goal/view_01,与上一轮比趋势
//   node tools/judge.mjs shots/r7.png --save     # 同上并把本轮读数存入历史
//   node tools/judge.mjs --selftest              # 判据自检(参考图全过 + 反例必败)
//
// 定位:哨兵不设目标门槛,只报「本轮是否朝远离参考图方向移动超过上轮差距的一成」。
// 方向盘是并排目视,不是这些数字。
import fs from 'node:fs';
import path from 'node:path';
import { readPng, resize, crop, stats, silhouetteRange } from './imgtool.mjs';

const REF_PATH = '/root/pro/20260817/20260819/goal/view_01.png';
const HIST = path.join(process.cwd(), 'docs/analysis/judge-history.json');
const W = 480; // 统一工作分辨率(两图都缩到这个宽再量)

// ---- 基础量 ----
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function zoneStats(img, u0, v0, u1, v1) {
  const c = crop(img, Math.round(u0 * img.width), Math.round(v0 * img.height),
    Math.round((u1 - u0) * img.width), Math.round((v1 - v0) * img.height));
  const s = stats(c);
  return {
    lum: s.meanLum,
    green: +(s.mean[1] - (s.mean[0] + s.mean[2]) / 2).toFixed(1),
    warm: +(s.mean[0] - s.mean[2]).toFixed(1),
  };
}

/** 梯度方向能量:总能量 + 轴对齐(水平/垂直)占比(方盒感直读) */
function edgeEnergy(img) {
  const { width: w, height: h, rgb } = img;
  const L = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) L[i] = lum(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
  let total = 0, axis = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const gx = L[y * w + x + 1] - L[y * w + x - 1];
      const gy = L[(y + 1) * w + x] - L[(y - 1) * w + x];
      const m = Math.hypot(gx, gy);
      if (m < 8) continue;
      total += m;
      const ang = Math.abs(Math.atan2(gy, gx)) % (Math.PI / 2); // 0..90°
      const d = Math.min(ang, Math.PI / 2 - ang);               // 距最近轴
      if (d < 0.12) axis += m;
    }
  }
  return { total: Math.round(total / 1000), axisPct: +((axis / Math.max(1, total)) * 100).toFixed(1) };
}

/** 细节尺度谱:逐级 2×2 降采样后的相邻差分均值(1/2/4/8/16 px) */
function detailSpectrum(img) {
  const out = [];
  let cur = img;
  for (let k = 0; k < 5; k++) {
    const { width: w, height: h, rgb } = cur;
    let sum = 0, n = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x + 1 < w; x++) {
        const a = (y * w + x) * 3, b = a + 3;
        sum += (Math.abs(rgb[a] - rgb[b]) + Math.abs(rgb[a + 1] - rgb[b + 1]) + Math.abs(rgb[a + 2] - rgb[b + 2])) / 3;
        n++;
      }
    }
    out.push(+(sum / n).toFixed(2));
    cur = resize(cur, Math.max(8, w >> 1), Math.max(8, h >> 1));
  }
  return out;
}

function colorCounts(img) {
  const set = new Set();
  const { width: w, height: h, rgb } = img;
  for (let i = 0; i < w * h; i++) {
    set.add((rgb[i * 3] >> 3 << 10) | (rgb[i * 3 + 1] >> 3 << 5) | (rgb[i * 3 + 2] >> 3));
  }
  // 分块(8×5)颜色数中位数
  const per = [];
  const bw = Math.floor(w / 8), bh = Math.floor(h / 5);
  for (let by = 0; by < 5; by++) {
    for (let bx = 0; bx < 8; bx++) {
      const s = new Set();
      for (let y = by * bh; y < (by + 1) * bh; y++) {
        for (let x = bx * bw; x < (bx + 1) * bw; x++) {
          const i = y * w + x;
          s.add((rgb[i * 3] >> 3 << 10) | (rgb[i * 3 + 1] >> 3 << 5) | (rgb[i * 3 + 2] >> 3));
        }
      }
      per.push(s.size);
    }
  }
  per.sort((a, b) => a - b);
  return { full: set.size, blockMedian: per[Math.floor(per.length / 2)] };
}

// ---- 指标集(全部绑定分区;分区来自 REFERENCE.md 锚点表) ----
function measure(img) {
  const m = {};
  // 结构:天际线(分 u 带) + 天空占比
  const bandHouse = silhouetteRange(img, 0.50, 0.70);
  const bandTreeR = silhouetteRange(img, 0.75, 0.98);
  const bandMtn = silhouetteRange(img, 0.06, 0.34);
  m['结构/主体带天际线v'] = bandHouse.sky ? +((bandHouse.sky.min + bandHouse.sky.max) / 2).toFixed(3) : null;
  m['结构/右树带天际线v'] = bandTreeR.sky ? +((bandTreeR.sky.min + bandTreeR.sky.max) / 2).toFixed(3) : null;
  m['结构/山带不透明v'] = bandMtn.opaque ? +bandMtn.opaque.min.toFixed(3) : null;
  {
    const { width: w, height: h, rgb } = img;
    let sky = 0;
    for (let i = 0; i < w * h; i++) if (rgb[i * 3 + 2] - rgb[i * 3] > 60 && rgb[i * 3 + 2] > 150) sky++;
    m['结构/天空占比%'] = +((sky / (w * h)) * 100).toFixed(1);
  }
  // 色调:逐分区绿度/暖度/亮度
  const zones = {
    前景草: [0.08, 0.80, 0.92, 0.99],
    中景草: [0.02, 0.60, 0.26, 0.72],
    墙带: [0.32, 0.62, 0.60, 0.72],
    楼墙: [0.50, 0.32, 0.62, 0.50],
    屋顶带: [0.50, 0.19, 0.68, 0.29],
    天顶: [0.30, 0.03, 0.70, 0.18],
    山带: [0.08, 0.32, 0.30, 0.50],
  };
  for (const [name, [u0, v0, u1, v1]] of Object.entries(zones)) {
    const z = zoneStats(img, u0, v0, u1, v1);
    m[`色调/${name}绿度`] = z.green;
    m[`色调/${name}暖度`] = z.warm;
    m[`色调/${name}亮度`] = z.lum;
  }
  // 形态
  const e = edgeEnergy(img);
  m['形态/轴对齐边缘%'] = e.axisPct;
  m['形态/边缘总能量k'] = e.total;
  // 密度
  const c = colorCounts(img);
  m['密度/全幅色数'] = c.full;
  m['密度/分块色数中位'] = c.blockMedian;
  const spec = detailSpectrum(img);
  spec.forEach((v, i) => { m[`密度/尺度谱${1 << i}px`] = v; });
  return m;
}

function loadScaled(p) {
  const img = readPng(p);
  return resize(img, W, Math.round((W * img.height) / img.width));
}

function compareRun(curPath, save) {
  const ref = measure(loadScaled(REF_PATH));
  const cur = measure(loadScaled(curPath));
  const hist = fs.existsSync(HIST) ? JSON.parse(fs.readFileSync(HIST, 'utf8')) : [];
  const prev = hist.length ? hist[hist.length - 1].metrics : null;
  let alerts = 0;
  console.log('指标'.padEnd(20) + '参考'.padStart(10) + '上一轮'.padStart(10) + '本轮'.padStart(10) + '  判定');
  for (const k of Object.keys(ref)) {
    const r = ref[k], c = cur[k], p = prev?.[k];
    if (r === null || c === null) { console.log(k.padEnd(22) + 'n/a'); continue; }
    let verdict = '';
    if (p !== null && p !== undefined) {
      const gPrev = Math.abs(p - r), gCur = Math.abs(c - r);
      if (gCur < gPrev - 1e-9) verdict = '↑ 接近';
      else if (gCur > gPrev + Math.max(0.1 * gPrev, 1e-6)) { verdict = '⚠ 退步'; alerts++; }
      else verdict = '≈';
    }
    console.log(
      k.padEnd(22 - Math.max(0, k.replace(/[^一-鿿]/g, '').length))
      + String(r).padStart(10) + String(p ?? '—').padStart(10) + String(c).padStart(10) + '  ' + verdict);
  }
  if (save) {
    hist.push({ label: path.basename(curPath), time: new Date().toISOString(), metrics: cur });
    fs.mkdirSync(path.dirname(HIST), { recursive: true });
    fs.writeFileSync(HIST, JSON.stringify(hist, null, 1));
    console.log(`[saved] → ${HIST} (${hist.length} runs)`);
  }
  console.log(alerts ? `\n⚠ ${alerts} 项朝远离参考图方向移动超一成——查清楚这轮改坏了什么再继续。` : '\n哨兵无退步警报。');
  return alerts;
}

function selftest() {
  // 1) 参考图对自己:所有 gap 必须为 0
  const ref = measure(loadScaled(REF_PATH));
  const ref2 = measure(loadScaled(REF_PATH));
  for (const k of Object.keys(ref)) {
    if (ref[k] !== ref2[k]) { console.error(`FAIL 参考图自比不稳定: ${k}`); process.exit(1); }
  }
  console.log('PASS 参考图自比全零。');
  // 2) 反例必须显著更差:r2(白地事故帧)vs r7 在前景绿度/密度上必须离参考更远
  const bad = measure(loadScaled('shots/r2.png'));
  const good = measure(loadScaled('shots/r7.png'));
  const checks = ['色调/前景草绿度', '密度/全幅色数', '色调/中景草绿度'];
  for (const k of checks) {
    const gBad = Math.abs(bad[k] - ref[k]), gGood = Math.abs(good[k] - ref[k]);
    if (!(gBad > gGood)) { console.error(`FAIL 反例未被识别: ${k} bad=${bad[k]} good=${good[k]} ref=${ref[k]}`); process.exit(1); }
    console.log(`PASS 反例更差: ${k}  |bad-ref|=${gBad.toFixed(1)} > |good-ref|=${gGood.toFixed(1)}`);
  }
}

const args = process.argv.slice(2);
if (args.includes('--selftest')) selftest();
else if (args[0]) compareRun(args[0], args.includes('--save'));
else console.log('usage: judge.mjs <frame.png> [--save] | --selftest');
