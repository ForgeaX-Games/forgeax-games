// 无头抓帧器。现成的基础设施，直接用，不要重写——下面每条都是实测踩出来的，
// 重写一遍只会把同样的坑再踩一次。
//
//   PREVIEW_URL=<forgeax_run_current_game 返回的 URL> node tools/shoot.mjs
//   W=1920 H=1080 LABEL=r1 node tools/shoot.mjs        # 验收分辨率
//   KEYS='w:2600,ArrowLeft+w:1500' node tools/shoot.mjs  # 走动/转向测试
//
// 三条硬约束：
//
//  1. protocolTimeout: 600000。默认 180s 在 1920×1080 + 多级 2048² CSM +
//     SwiftShader 软光栅下必然超时——诊断读数全绿、frustumStats 正常，
//     然后 page.evaluate(__grab) 抛 ProtocolError。不是渲染坏了，是 CDP 等不及。
//  2. 默认 960×540。迭代期用它，验收期才上 1920×1080（构图判据只看归一化
//     坐标 u/v，低分辨率不影响构图比对的结论，但省下的是几十分钟）。
//     实际耗时自己测一遍再定策略，见 PROMPT.md §0 第 2 条。
//  3. 抓帧前把相机钉到参考位姿。手动走过去再截图是不可重复的，构图判据会随机漂。
//
// 游戏侧必须暴露这个全局，否则位姿钉不住、诊断也读不到：
//
//   window.__village = {
//     referencePose(): 把相机钉到 view_01 解算出的位姿，返回位姿对象
//     pose():          { x, y, z, yaw, pitch, grounded }
//     stats():         自定义诊断读数（三角形数、实体数、判据要用的计数等）
//   }
//
// tonemap 耦合点：下面 __grab 里的 encode() 写死了 reinhard-extended / whitePoint 4。
// 附件是 tonemap 之前的 linear HDR，所以这里的算子必须和场景里 Camera.tonemap
// 的设置一致，否则抓出来的图不是浏览器里那张，判据读数全部无效。改了相机就改这里。
import fs from 'node:fs';
import path from 'node:path';
import { writePng } from './imgtool.mjs';

const PREVIEW_URL = process.env.PREVIEW_URL;
if (!PREVIEW_URL) {
  console.error('[shoot] 需要 PREVIEW_URL。用 forgeax_run_current_game 拿预览 URL，别猜端口。');
  process.exit(1);
}
const OUT_DIR = process.env.OUT_DIR ?? path.join(process.cwd(), 'shots');
const W = Number(process.env.W ?? 960);
const H = Number(process.env.H ?? 540);
const WARMUP_MS = Number(process.env.WARMUP_MS ?? 9000);
const LABEL = process.env.LABEL ?? 'latest';
// 空 = 只截参考位姿。形如 "w:2600,ArrowLeft+w:1500" —— 按住键 / 等毫秒 / 出一张图。
// 键名用 '+' 分隔，必须写 puppeteer 的完整键名（ArrowLeft 不是 4 个字符）。
const KEYS = (process.env.KEYS ?? '').trim();
// 抓帧前是否钉到 view_01 位姿（走动测试时设 0）
const POSE = process.env.POSE !== '0';

const CHROME =
  process.env.CHROME ??
  '/data/docker/lib/overlay2/101d057fe999d2908f1ba64b3467abc49ff61631f07286fbb7b611b9d22c343b/merged/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const PUPPETEER =
  process.env.PUPPETEER ??
  '/tmp/shot/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

for (const [p, hint] of [[CHROME, 'CHROME'], [PUPPETEER, 'PUPPETEER']]) {
  if (!fs.existsSync(p)) {
    console.error(`[shoot] 找不到 ${hint}: ${p}`);
    process.exit(1);
  }
}

const puppeteer = (await import(PUPPETEER)).default;
fs.mkdirSync(OUT_DIR, { recursive: true });

const t0 = Date.now();
const el = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  protocolTimeout: 600000, // ← 见文件头 (1)
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    // 这一整组是经验证的最小可用集，别精简（见 render/02-headless-capture.md）
    '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader',
    '--use-vulkan=swiftshader', '--use-angle=swiftshader',
    '--enable-features=Vulkan', '--disable-vulkan-surface',
    `--window-size=${W},${H}`,
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: W, height: H });
page.on('pageerror', (e) => console.log('[pageerror] ' + e.message));
page.on('console', (m) => {
  const t = m.text();
  if (/village|error|Error|fail/.test(t)) console.log('[console] ' + t.slice(0, 300));
});
page.on('response', (r) => {
  if (r.url().includes('forge.json')) console.log(`[forge.json] HTTP ${r.status()}`);
});

console.log(`[shoot ${el()}] → ${PREVIEW_URL}  ${W}x${H}`);
await page.goto(PREVIEW_URL, { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => !!window.__forgeax?.app, { timeout: 60000 });
await page.evaluate(() => {
  window.__errs = [];
  window.__forgeax.app.onError?.((e) => window.__errs.push(String(e?.code ?? e)));
});

console.log(`[shoot ${el()}] 预热 ${WARMUP_MS}ms…`);
await new Promise((r) => setTimeout(r, WARMUP_MS));

const diag = await page.evaluate(() => {
  const { app, renderer, world } = window.__forgeax;
  const j = (v) => { try { return JSON.parse(JSON.stringify(v)); } catch { return String(v); } };
  return {
    hasPhysics: app?.physics !== undefined,
    frustumTotal: j(renderer.frustumStats)?.total ?? null,
    passCount: j(renderer.perFramePassNames)?.length ?? null,
    entities: (() => { const s = j(world.inspect?.()); return s?.entityCount ?? s?.entities?.length ?? null; })(),
    village: typeof window.__village === 'object' ? Object.keys(window.__village) : null,
    stats: window.__village?.stats ? j(window.__village.stats()) : null,
    errs: window.__errs,
  };
});
console.log('[diag] ' + JSON.stringify(diag));
if (diag.hasPhysics === false) {
  console.log('[!] app.physics === undefined —— 极可能是 forge.json 404，重做补丁再来。');
}

await page.evaluate(() => {
  const un = (r) => (r && typeof r === 'object' && 'ok' in r ? (r.ok ? r.value : null) : r);
  window.__grab = async () => {
    const t = performance.now();
    const { renderer, world } = window.__forgeax;
    const dev = renderer.device;
    renderer.draw([world], { cameraOwner: 0, resourceOwner: 0 });
    const tDraw = performance.now() - t;

    const obs = await renderer.observeCurrentFrame({
      semantic: 'linear-hdr',
      readback: async (lease) => {
        try {
          const src = un(lease.beginReadback());
          if (src == null) return { ok: false, error: new Error('beginReadback failed') };
          const d = src.descriptor;
          const bpp = d.format?.includes('16float') ? 8 : d.format?.includes('32float') ? 16 : 4;
          const bpr = Math.ceil((d.size.width * bpp) / 256) * 256; // 必须 256 对齐
          const buf = un(dev.createBuffer({
            size: bpr * d.size.height,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
          }));
          if (buf == null) return { ok: false, error: new Error('createBuffer failed') };
          const enc = un(dev.createCommandEncoder());
          if (enc == null) return { ok: false, error: new Error('createCommandEncoder failed') };
          enc.copyTextureToBuffer(
            { texture: src.texture },
            { buffer: buf, bytesPerRow: bpr, rowsPerImage: d.size.height },
            [d.size.width, d.size.height, 1],
          );
          un(dev.queue.submit([un(enc.finish())]));
          await dev.queue.onSubmittedWorkDone();
          const mapped = un(await buf.mapAsync(GPUMapMode.READ));
          if (mapped == null) return { ok: false, error: new Error('mapAsync failed') };
          const ab = un(mapped.getMappedRange());
          if (ab == null) return { ok: false, error: new Error('getMappedRange failed') };
          const bytes = new Uint8Array(ab.slice(0));
          mapped.unmap();
          window.__lastBpr = bpr;
          return { ok: true, value: bytes };
        } catch (e) {
          return { ok: false, error: new Error('readback threw: ' + String(e).slice(0, 250)) };
        }
      },
    });
    if (!obs?.ok) return { ok: false, err: JSON.stringify(obs?.error ?? null).slice(0, 400) };

    const { bytes, metadata } = obs.value;
    const w = metadata.size.width, h = metadata.size.height;
    const bpr = window.__lastBpr;
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const half = (u) => {
      const s = (u & 0x8000) ? -1 : 1, e = (u >> 10) & 0x1f, f = u & 0x3ff;
      if (e === 0) return s * Math.pow(2, -14) * (f / 1024);
      if (e === 31) return f === 0 ? s * Infinity : NaN;
      return s * Math.pow(2, e - 15) * (1 + f / 1024);
    };
    // 附件是 tonemap 之前的 linear HDR。算子必须和 Camera.tonemap 对齐：
    // reinhard-extended, whitePoint 4，否则出的图不是浏览器里那张。
    // 现在场景用 Khronos PBR neutral(engine source/shader/src/tonemap.wgsl)+ exposure 1.0。
    const EXPOSURE = 1.0;
    const oetf = (c) => {
      c = Math.max(0, Math.min(1, c));
      return Math.round((c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
    };
    const acesTriple = (r, g, b) => { // 名字沿用,免得改调用点;实现是 neutral
      if (!Number.isFinite(r) || r < 0) r = 0;
      if (!Number.isFinite(g) || g < 0) g = 0;
      if (!Number.isFinite(b) || b < 0) b = 0;
      r *= EXPOSURE; g *= EXPOSURE; b *= EXPOSURE;
      const sc = 0.8 - 0.04, desat = 0.15;
      const x = Math.min(r, Math.min(g, b));
      const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
      r -= offset; g -= offset; b -= offset;
      const peak = Math.max(r, Math.max(g, b));
      if (peak >= sc) {
        const d = 1 - sc;
        const newPeak = 1 - d * d / (peak + d - sc);
        const s = newPeak / peak;
        r *= s; g *= s; b *= s;
        const gmix = 1 - 1 / (desat * (peak - newPeak) + 1);
        r = r + (newPeak - r) * gmix; g = g + (newPeak - g) * gmix; b = b + (newPeak - b) * gmix;
      }
      return [oetf(r), oetf(g), oetf(b)];
    };
    const out = new Uint8Array(w * h * 3);
    let nonBlack = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const o = y * bpr + x * 8;
        const [r, g, b] = acesTriple(
          half(dv.getUint16(o, true)), half(dv.getUint16(o + 2, true)), half(dv.getUint16(o + 4, true)));
        const i = (y * w + x) * 3;
        out[i] = r; out[i + 1] = g; out[i + 2] = b;
        if (r + g + b > 12) nonBlack++;
      }
    }
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < out.length; i += CH) bin += String.fromCharCode(...out.subarray(i, i + CH));
    return {
      ok: true, w, h, format: metadata.format, drawMs: Math.round(tDraw),
      totalMs: Math.round(performance.now() - t),
      nonBlackPct: +((nonBlack / (w * h)) * 100).toFixed(1),
      b64: btoa(bin),
    };
  };
});

let n = 0;
const shoot = async (label) => {
  const s = Date.now();
  // 位姿必须在抓帧「之前」读，而且要打印出来：否则事后只能从像素反推
  // 「刚才那下方向键到底转了多少度」，已经浪费过一轮。
  const pose = await page.evaluate(() => window.__village?.pose?.() ?? null);
  if (pose) {
    console.log(
      `[${label}] pose x=${pose.x.toFixed(2)} y=${pose.y.toFixed(2)} z=${pose.z.toFixed(2)} ` +
      `yaw=${((pose.yaw * 180) / Math.PI).toFixed(1)}° pitch=${((pose.pitch * 180) / Math.PI).toFixed(1)}° ` +
      `grounded=${pose.grounded}`,
    );
  }
  const g = await page.evaluate(() => window.__grab());
  if (!g.ok) { console.log(`[${label}] FAIL ${g.err}`); return null; }
  const file = path.join(OUT_DIR, `${label}.png`);
  n++;
  writePng(file, g.w, g.h, Buffer.from(g.b64, 'base64'));
  console.log(
    `[${label}] ${g.w}x${g.h} nonBlack=${g.nonBlackPct}% draw=${g.drawMs}ms grab=${g.totalMs}ms ` +
    `wall=${((Date.now() - s) / 1000).toFixed(1)}s → ${file}`,
  );
  return g;
};

await page.mouse.click(W / 2, H / 2);
const TELEPORT = (process.env.TELEPORT ?? '').trim(); // "x,z,yaw,pitch" 拍非参考位姿
const FLYTO = (process.env.FLYTO ?? '').trim();       // "x,y,z,yaw,pitch" 自由相机(资产评审)
if (FLYTO) {
  const [fx, fy, fz, fyaw, fpitch] = FLYTO.split(',').map(Number);
  await page.evaluate((a, b, c, d, e) => {
    window.__village?.flyTo?.(a, b, c, d, e);
    for (let i = 0; i < 3; i++) window.__forgeax.world.update(1 / 60);
  }, fx, fy, fz, fyaw, fpitch);
} else if (TELEPORT) {
  const [tx, tz, tyaw, tpitch] = TELEPORT.split(',').map(Number);
  await page.evaluate((a, b, c, d) => {
    window.__village?.teleport?.(a, b, c, d);
    // rAF 一帧要好几秒,等不起;手动推 3 个 tick 让相机系统落位
    for (let i = 0; i < 3; i++) window.__forgeax.world.update(1 / 60);
  }, tx, tz, tyaw, tpitch);
} else if (POSE) {
  const pose = await page.evaluate(() => {
    const p = window.__village?.referencePose?.() ?? null;
    for (let i = 0; i < 3; i++) window.__forgeax.world.update(1 / 60);
    return p;
  });
  console.log('[pose] ' + JSON.stringify(pose));
}
await shoot(LABEL);

for (const seg of KEYS ? KEYS.split(',') : []) {
  const [keys, msRaw] = seg.split(':');
  const ms = Number(msRaw ?? 1500);
  const quiet = (keys ?? '').startsWith('-'); // 前缀 '-' = 只按键不抓帧（640×360 一帧要 200s，多段路线抓不起）
  const list = (keys ?? '').replace(/^-/, '').split('+').filter(Boolean);
  for (const k of list) await page.keyboard.down(k);
  await new Promise((r) => setTimeout(r, ms));
  for (const k of list) await page.keyboard.up(k); // 先松手再抓帧：抓帧要 100s，不能一直按着
  if (quiet) {
    const p = await page.evaluate(() => window.__village?.pose?.() ?? null);
    console.log(`[${LABEL}-${list.join('_')}] 未抓帧 pose x=${p?.x.toFixed(2)} z=${p?.z.toFixed(2)}`
      + ` y=${p?.y.toFixed(2)} grounded=${p?.grounded}`);
  } else await shoot(`${LABEL}-${list.join('_') || 'none'}`);
}

const errs = await page.evaluate(() => window.__errs);
if (errs?.length) console.log(`[errors] ${JSON.stringify(errs.slice(0, 20))}`);
const stats = await page.evaluate(() => window.__village?.stats?.() ?? null);
console.log('[stats] ' + JSON.stringify(stats));

await browser.close();
console.log(`[shoot ${el()}] 完成，${n} 张 → ${OUT_DIR}`);
