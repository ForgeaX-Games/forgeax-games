// 硬底线判据(PROMPT §3.2):可玩性巡检 + 性能读数。pass/fail,红了当轮修。
//
//   PREVIEW_URL=... node tools/patrol.mjs
//
// SwiftShader rAF 一帧要 ~9s,真实时间行走不可行;按住键后用 world.update(1/60)
// 手动推 tick(输入后端读的是 DOM 按键状态,手动 tick 一样生效)。
// §0-3 的「模拟时间达标」在这里是直接断言:走 N tick 位移就应 ≈ N/60×速度。
import fs from 'node:fs';

const PREVIEW_URL = process.env.PREVIEW_URL;
if (!PREVIEW_URL) { console.error('need PREVIEW_URL'); process.exit(1); }
const CHROME = process.env.CHROME ?? '/data/docker/lib/overlay2/101d057fe999d2908f1ba64b3467abc49ff61631f07286fbb7b611b9d22c343b/merged/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';
const PUPPETEER = process.env.PUPPETEER ?? '/tmp/shot/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
const puppeteer = (await import(PUPPETEER)).default;

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 600000,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    '--enable-unsafe-webgpu', '--enable-unsafe-swiftshader', '--use-vulkan=swiftshader',
    '--use-angle=swiftshader', '--enable-features=Vulkan', '--disable-vulkan-surface', '--window-size=320,180'],
});
const page = await browser.newPage();
await page.goto(PREVIEW_URL, { waitUntil: 'networkidle2', timeout: 120000 });
await page.waitForFunction(() => !!window.__forgeax?.app && !!window.__village, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 3000));
await page.mouse.click(160, 90);

let pass = 0, fail = 0;
const report = (ok, name, detail) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  ok ? pass++ : fail++;
};

/** 面向 (tx,tz) 从 (x,z) 出发按 w 直走;时长按距离/速度自动给,到达即停 */
async function walk(x, z, tx, tz) {
  const yaw = Math.atan2(tx - x, -(tz - z));
  await page.evaluate((a, b, c) => window.__village.teleport(a, b, c, 0), x, z, yaw);
  await page.keyboard.down('w');
  const dist = Math.hypot(tx - x, tz - z);
  const ticks = Math.ceil((dist / 4.2) * 60 * 1.6) + 30;
  const out = await page.evaluate((n, gx, gz) => {
    const { world } = window.__forgeax;
    let minY = 1e9, maxDrop = 0;
    for (let i = 0; i < n; i++) {
      world.update(1 / 60);
      if (i % 6 === 0) {
        const p = window.__village.pose();
        const g = window.__village.stats().ground;
        minY = Math.min(minY, p.y);
        maxDrop = Math.max(maxDrop, Math.abs(p.y - 0.8 - g));
        if (Math.hypot(p.x - gx, p.z - gz) < 2.2) break; // 到达
      }
    }
    return { pose: window.__village.pose(), minY, maxDrop };
  }, ticks, tx, tz);
  await page.keyboard.up('w');
  return out;
}

// ---- 必达锚点巡回(REFERENCE §2 锚点表) ----
const legs = [
  ['spawn→A5 路中段', 0, 0, -7, -14],
  ['A5→墙西端(A2)', -7, -14, -8, -28],
  ['墙西端→露台/告示牌(A3)', -6, -30, 0.5, -28.5],
  ['露台→桌椅→灯柱(A12)', 0.5, -28.5, 11.5, -38.5],
  ['露台→阶梯口(A4 上端)', 8, -32, 13.3, -41.5],
  ['阶梯下行(A4)', 13.3, -41.5, 18.5, -45],
  ['阶下→东岩壁(A9)', 19, -45, 24, -30],
  ['岩壁→回草甸(A1 墙根)', 22, -28, 5, -24],
];
for (const [name, x, z, tx, tz] of legs) {
  const r = await walk(x, z, tx, tz);
  const dist = Math.hypot(r.pose.x - tx, r.pose.z - tz);
  const ok = dist < 4.5 && r.minY > -3 && r.maxDrop < 1.2;
  report(ok, name, `end=(${r.pose.x.toFixed(1)},${r.pose.z.toFixed(1)}) 距目标${dist.toFixed(1)}m minY=${r.minY.toFixed(1)} drop=${r.maxDrop.toFixed(2)}`);
}

// ---- 穿模:正面撞挡土墙,不得穿到墙后 ----
{
  const r = await walk(0, -8, 0, -24);
  const behind = r.pose.z < -16.5;
  report(!behind, '挡土墙阻挡(不穿模)', `end z=${r.pose.z.toFixed(1)}(墙线≈-15.5)`);
}
// ---- 穿模:撞房子台基 ----
{
  const r = await walk(4, -30, 7.5, -45);
  // L 形别墅足迹(局部坐标,yaw 0.22,scale 1.28):主体 box / 翼 box / 塔圆
  const dx = r.pose.x - 7.5, dz = r.pose.z + 45;
  const cy = Math.cos(0.22), sy = Math.sin(0.22);
  const lx = (dx * cy - dz * sy) / 1.28, lz = (dx * sy + dz * cy) / 1.28;
  const inMain = Math.abs(lx) < 5.5 && Math.abs(lz) < 3.3;
  const inWing = lx > -5.4 && lx < -0.8 && lz > -0.8 && lz < 4.8;
  const inTur = Math.hypot(lx - 4.2, lz - 2.3) < 1.7;
  report(!(inMain || inWing || inTur), '房子体量阻挡(不穿模)', `end=(${r.pose.x.toFixed(1)},${r.pose.z.toFixed(1)}) local=(${lx.toFixed(1)},${lz.toFixed(1)})`);
}
// ---- 边界:四个方向走出去,不坠落、被收边 ----
for (const [name, x, z, tx, tz] of [
  ['西界', -45, 0, -60, 0], ['东界', 40, -20, 55, -20], ['南界', 0, 20, 0, 35], ['北界', -20, -55, -20, -75],
]) {
  const r = await walk(x, z, tx, tz);
  const ok = r.minY > -3 && r.pose.x >= -52.5 && r.pose.x <= 46.5 && r.pose.z >= -64.5 && r.pose.z <= 26.5;
  report(ok, `边界收边:${name}`, `end=(${r.pose.x.toFixed(1)},${r.pose.z.toFixed(1)}) minY=${r.minY.toFixed(1)}`);
}

// ---- 模拟时间断言(§0-3):tick 推进 = 位移可信 ----
{
  const t0 = await page.evaluate(() => window.__village.stats().simTime);
  await page.evaluate(() => { for (let i = 0; i < 300; i++) window.__forgeax.world.update(1 / 60); });
  const t1 = await page.evaluate(() => window.__village.stats().simTime);
  const dt = t1 - t0;
  report(Math.abs(dt - 5) < 1, '模拟时间达标(300 tick ≈ 5s)', `Δt=${dt.toFixed(1)}s`);
}

// ---- 性能底线 ----
{
  const s = await page.evaluate(() => window.__village.stats());
  const d = await page.evaluate(() => {
    const t = performance.now();
    window.__forgeax.renderer.draw([window.__forgeax.world], { cameraOwner: 0, resourceOwner: 0 });
    return performance.now() - t;
  });
  const totalTris = s.meshTris + s.instancedTris;
  report(totalTris < 350000, `三角形预算 ${totalTris} < 350k`);
  report(s.entities < 300, `实体数 ${s.entities} < 300`);
  report(d < 5000, `draw 提交 ${d.toFixed(0)}ms < 5000ms(SwiftShader CPU 光栅)`);
}

console.log(`\n硬底线:${pass} PASS / ${fail} FAIL`);
fs.writeFileSync('docs/analysis/patrol-last.json', JSON.stringify({ time: new Date().toISOString(), pass, fail }, null, 1));
await browser.close();
process.exit(fail ? 1 : 0);
