#!/usr/bin/env bun
// Stage 0 loading baseline: headed Chrome + CDP against a local production bake.
// Serves OUT_DIR as document root so website absolute `/games/hellforge/` URLs resolve.

import { spawn, type Subprocess } from 'bun';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const OUT_DIR = resolve(process.env.OUT_DIR || '/tmp/hellforge-perf-baseline');
const REPORT_DIR = resolve(
  process.env.REPORT_DIR
    || '/Users/you/dev/ForgeaX-Games/forgeax-studio/.worktrees/laurenceelu/feat-20260820-hellforge-loading-performance/hellforge/docs/evidence/loading-performance',
);
const PORT = Number(process.env.PORT || 8765);
const CDP_PORT = Number(process.env.CDP_PORT || 9333);
const GAME_PATH = '/games/hellforge/';
const CHROME = process.env.CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DOWNLOAD_BPS = Number(process.env.DOWNLOAD_MBPS || 20) * 1024 * 1024 / 8;
const UPLOAD_BPS = Number(process.env.UPLOAD_MBPS || 5) * 1024 * 1024 / 8;
const LATENCY_MS = Number(process.env.RTT_MS || 40);
const COLD_RUNS = Number(process.env.COLD_RUNS || 5);
const WARM_RUNS = Number(process.env.WARM_RUNS || 5);
const GATE_TIMEOUT_MS = Number(process.env.GATE_TIMEOUT_MS || 180_000);
const GZIP = process.env.GZIP === '1' || process.env.GZIP === 'true';
const REPORT_JSON = process.env.REPORT_JSON || 'stage0-baseline.json';

/** Text-like types GitHub Pages typically gzip/brotli. Not .bin (on-the-fly gzip of 4MiB bodies would add CPU stall this harness is not measuring). */
const GZIP_EXT = new Set([
  '.html', '.js', '.mjs', '.json', '.css', '.svg', '.wasm', '.txt', '.map', '.wgsl',
]);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.hdr': 'application/octet-stream',
  '.glb': 'model/gltf-binary',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

type CdpClient = {
  send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  on(method: string, fn: (params: unknown) => void): () => void;
  close(): void;
};

function classify(url: string): string {
  const path = url.split(/[?#]/, 1)[0]!.toLowerCase();
  if (path.endsWith('.wasm')) return 'wasm';
  if (path.endsWith('.js') || path.endsWith('.mjs')) return 'javascript';
  if (path.endsWith('.json')) return path.includes('pack-index') ? 'pack-index' : 'json';
  if (path.includes('-body.bin') || path.endsWith('.bin')) return 'pack-body';
  if (path.includes('.pack')) return 'pack-json';
  if (path.endsWith('.png') || path.endsWith('.jpg') || path.endsWith('.jpeg') || path.endsWith('.webp')) return 'image';
  if (path.endsWith('.hdr')) return 'hdr';
  if (path.endsWith('.mp4') || path.endsWith('.webm')) return 'media';
  if (path.endsWith('.mp3') || path.endsWith('.ogg') || path.endsWith('.wav')) return 'audio';
  if (path.endsWith('.glb') || path.endsWith('.gltf')) return 'glb';
  return 'other';
}

function wantsGzip(req: Request, ext: string): boolean {
  if (!GZIP) return false;
  if (!GZIP_EXT.has(ext)) return false;
  const accept = req.headers.get('accept-encoding') ?? '';
  return /\bgzip\b/i.test(accept);
}

async function startStaticServer(): Promise<{ stop(): void }> {
  const server = Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);
      let rel = decodeURIComponent(url.pathname);
      if (rel.endsWith('/')) rel += 'index.html';
      const filePath = resolve(OUT_DIR, '.' + rel);
      if (!filePath.startsWith(OUT_DIR)) return new Response('forbidden', { status: 403 });
      const file = Bun.file(filePath);
      if (!(await file.exists())) return new Response('not found', { status: 404 });
      const ext = extname(filePath).toLowerCase();
      const type = MIME[ext] || 'application/octet-stream';
      const headers: Record<string, string> = {
        'content-type': type,
        'cache-control': 'public, max-age=31536000, immutable',
      };
      if (!wantsGzip(req, ext)) {
        return new Response(file, { headers });
      }
      const raw = new Uint8Array(await file.arrayBuffer());
      const compressed = Bun.gzipSync(raw);
      headers['content-encoding'] = 'gzip';
      headers['vary'] = 'Accept-Encoding';
      return new Response(compressed, { headers });
    },
  });
  return { stop() { server.stop(true); } };
}

async function connectCdp(wsUrl: string): Promise<CdpClient> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolveWs, reject) => {
    ws.addEventListener('open', () => resolveWs());
    ws.addEventListener('error', () => reject(new Error(`cdp websocket failed: ${wsUrl}`)));
  });
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const listeners = new Map<string, Set<(params: unknown) => void>>();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data)) as {
      id?: number;
      result?: unknown;
      error?: { message?: string };
      method?: string;
      params?: unknown;
    };
    if (msg.id !== undefined) {
      const waiter = pending.get(msg.id);
      if (!waiter) return;
      pending.delete(msg.id);
      if (msg.error) waiter.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      else waiter.resolve(msg.result);
      return;
    }
    if (msg.method) {
      for (const fn of listeners.get(msg.method) ?? []) fn(msg.params);
    }
  });
  return {
    send(method, params) {
      const id = nextId++;
      return new Promise((resolveSend, reject) => {
        pending.set(id, { resolve: resolveSend, reject });
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          reject(new Error(`cdp timeout: ${method}`));
        }, 20_000);
      });
    },
    on(method, fn) {
      const set = listeners.get(method) ?? new Set();
      set.add(fn);
      listeners.set(method, set);
      return () => set.delete(fn);
    },
    close() { ws.close(); },
  };
}

async function launchChrome(userDir: string): Promise<{ proc: Subprocess; wsUrl: string }> {
  mkdirSync(userDir, { recursive: true });
  const proc = spawn([
    CHROME,
    `--user-data-dir=${userDir}`,
    `--remote-debugging-port=${CDP_PORT}`,
    '--window-size=1920,1080',
    '--force-device-scale-factor=1',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdout: 'ignore', stderr: 'ignore' });
  const deadline = Date.now() + 20_000;
  let wsUrl = '';
  while (Date.now() < deadline) {
    try {
      const version = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.json()) as {
        webSocketDebuggerUrl?: string;
      };
      if (version.webSocketDebuggerUrl) {
        wsUrl = version.webSocketDebuggerUrl;
        break;
      }
    } catch { /* chrome still starting */ }
    await Bun.sleep(150);
  }
  if (!wsUrl) {
    proc.kill();
    throw new Error('Chrome DevTools endpoint did not come up');
  }
  return { proc, wsUrl };
}

async function waitForClickGate(
  cdp: CdpClient,
  timeoutMs: number,
): Promise<{ ok: boolean; wallMs: number; pageNow: number; text: string }> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const result = await cdp.send<{ result: { value?: { ok?: boolean; text?: string; now?: number } } }>(
      'Runtime.evaluate',
      {
        expression: `(() => {
          const buttons = [...document.querySelectorAll('button')];
          const gate = buttons.find((b) => (b.textContent || '').includes('点击进入'));
          if (!gate) return { ok: false, text: '', now: performance.now() };
          const style = getComputedStyle(gate);
          const rect = gate.getBoundingClientRect();
          const visible = style.display !== 'none' && style.visibility !== 'hidden'
            && Number(style.opacity || '1') > 0.05 && rect.width > 8 && rect.height > 8;
          return { ok: visible, text: gate.textContent || '', now: performance.now() };
        })()`,
        returnByValue: true,
        awaitPromise: false,
      },
    );
    const value = result.result.value;
    if (value?.ok) {
      return {
        ok: true,
        wallMs: Date.now() - started,
        pageNow: Number(value.now) || Date.now() - started,
        text: value.text || '点击进入',
      };
    }
    await Bun.sleep(100);
  }
  return { ok: false, wallMs: timeoutMs, pageNow: timeoutMs, text: '' };
}

async function collectSnapshot(cdp: CdpClient, extra: Record<string, unknown>) {
  const timing = await cdp.send<{ result: { value?: unknown } }>('Runtime.evaluate', {
    expression: `(() => {
      const nav = performance.getEntriesByType('navigation')[0] || {};
      const paint = Object.fromEntries(performance.getEntriesByType('paint').map((p) => [p.name, p.startTime]));
      const resources = performance.getEntriesByType('resource').map((r) => ({
        name: r.name,
        initiatorType: r.initiatorType,
        duration: r.duration,
        transferSize: r.transferSize,
        encodedBodySize: r.encodedBodySize,
        decodedBodySize: r.decodedBodySize,
        startTime: r.startTime,
        responseEnd: r.responseEnd,
      }));
      const consoles = window.__hfLoadingConsole || [];
      return {
        href: location.href,
        now: performance.now(),
        timeOrigin: performance.timeOrigin,
        navigation: {
          type: nav.type,
          startTime: nav.startTime,
          fetchStart: nav.fetchStart,
          requestStart: nav.requestStart,
          responseEnd: nav.responseEnd,
          domContentLoadedEventEnd: nav.domContentLoadedEventEnd,
          loadEventEnd: nav.loadEventEnd,
          transferSize: nav.transferSize,
          encodedBodySize: nav.encodedBodySize,
          decodedBodySize: nav.decodedBodySize,
        },
        paint,
        resources,
        consoles,
      };
    })()`,
    returnByValue: true,
  });
  let gpuValue: unknown = { webgpu: 'unqueried' };
  try {
    const gpu = await cdp.send<{ result: { value?: unknown } }>('Runtime.evaluate', {
      expression: `(async () => {
        if (!navigator.gpu) return { webgpu: false };
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) return { webgpu: false };
        const info = adapter.info || {};
        return {
          webgpu: true,
          vendor: info.vendor,
          architecture: info.architecture,
          device: info.device,
          description: info.description,
          isFallbackAdapter: Boolean(adapter.isFallbackAdapter),
        };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    gpuValue = gpu.result.value;
  } catch (error) {
    gpuValue = { webgpu: 'cdp-timeout', error: error instanceof Error ? error.message : String(error) };
  }
  return {
    ...extra,
    gpu: gpuValue,
    page: timing.result.value,
  };
}

function summarize(page: {
  resources?: Array<{
    name: string;
    transferSize: number;
    encodedBodySize: number;
    decodedBodySize: number;
    duration: number;
    initiatorType: string;
    startTime: number;
  }>;
  navigation?: { fetchStart?: number };
}, gateVisibleAt: number) {
  const resources = page.resources ?? [];
  const beforeGate = resources.filter((r) => r.startTime <= gateVisibleAt);
  const sum = (rows: typeof resources, key: 'transferSize' | 'encodedBodySize' | 'decodedBodySize') =>
    rows.reduce((n, r) => n + (Number(r[key]) || 0), 0);
  const cats: Record<string, { count: number; transferSize: number; decodedBodySize: number }> = {};
  for (const r of beforeGate) {
    const cat = classify(r.name);
    const slot = cats[cat] ?? (cats[cat] = { count: 0, transferSize: 0, decodedBodySize: 0 });
    slot.count += 1;
    slot.transferSize += Number(r.transferSize) || 0;
    slot.decodedBodySize += Number(r.decodedBodySize) || 0;
  }
  const top = [...beforeGate]
    .sort((a, b) => (b.transferSize || 0) - (a.transferSize || 0))
    .slice(0, 30)
    .map((r) => ({
      name: r.name.replace(/^http:\/\/127\.0\.0\.1:\d+/, ''),
      category: classify(r.name),
      transferSize: r.transferSize,
      encodedBodySize: r.encodedBodySize,
      decodedBodySize: r.decodedBodySize,
      duration: r.duration,
      initiatorType: r.initiatorType,
      startTime: r.startTime,
    }));
  return {
    beforeGate: {
      count: beforeGate.length,
      transferSize: sum(beforeGate, 'transferSize'),
      encodedBodySize: sum(beforeGate, 'encodedBodySize'),
      decodedBodySize: sum(beforeGate, 'decodedBodySize'),
      categories: cats,
      top30: top,
      bodyBinCount: beforeGate.filter((r) => classify(r.name) === 'pack-body').length,
    },
    all: {
      count: resources.length,
      transferSize: sum(resources, 'transferSize'),
      decodedBodySize: sum(resources, 'decodedBodySize'),
    },
  };
}

async function runOnce(cdp: CdpClient, opts: {
  cacheDisabled: boolean;
  runId: string;
  label: string;
}): Promise<Record<string, unknown>> {
  const consoles: Array<{ type: string; text: string }> = [];
  const offLog = cdp.on('Log.entryAdded', (params) => {
    const entry = params as { entry?: { level?: string; text?: string } };
    consoles.push({ type: entry.entry?.level || 'log', text: entry.entry?.text || '' });
  });
  const offConsole = cdp.on('Runtime.consoleAPICalled', (params) => {
    const ev = params as { type?: string; args?: Array<{ value?: unknown; description?: string }> };
    consoles.push({
      type: ev.type || 'log',
      text: (ev.args ?? []).map((a) => String(a.value ?? a.description ?? '')).join(' '),
    });
  });
  const contentEncoding: Array<{ url: string; encoding: string; mime: string; status: number }> = [];
  const offNet = cdp.on('Network.responseReceived', (params) => {
    const ev = params as {
      response?: { url?: string; mimeType?: string; status?: number; headers?: Record<string, string> };
    };
    const resp = ev.response;
    if (!resp?.url) return;
    const headers = resp.headers ?? {};
    const encoding = String(
      headers['content-encoding']
      || headers['Content-Encoding']
      || Object.entries(headers).find(([k]) => k.toLowerCase() === 'content-encoding')?.[1]
      || '',
    );
    contentEncoding.push({
      url: resp.url,
      encoding,
      mime: resp.mimeType || '',
      status: Number(resp.status) || 0,
    });
  });
  await cdp.send('Network.enable');
  await cdp.send('Log.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Page.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: opts.cacheDisabled });
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: LATENCY_MS,
    downloadThroughput: DOWNLOAD_BPS,
    uploadThroughput: UPLOAD_BPS,
    connectionType: 'wifi',
  });
  const url = `http://127.0.0.1:${PORT}${GAME_PATH}?perfRun=${encodeURIComponent(opts.runId)}`;
  const navStart = Date.now();
  await cdp.send('Page.navigate', { url });
  const gate = await waitForClickGate(cdp, GATE_TIMEOUT_MS);
  if (gate.ok) {
    try {
      const shot = await cdp.send<{ data: string }>('Page.captureScreenshot', {
        format: 'png',
        fromSurface: true,
      });
      writeFileSync(join(REPORT_DIR, `${opts.label}.png`), Buffer.from(shot.data, 'base64'));
    } catch { /* screenshot is best-effort */ }
  }
  const snapshot = await collectSnapshot(cdp, {
    label: opts.label,
    runId: opts.runId,
    cacheDisabled: opts.cacheDisabled,
    wallMsToGate: Date.now() - navStart,
    gate,
  }) as {
    page?: Parameters<typeof summarize>[0] & { now?: number };
    gpu?: unknown;
  };
  offLog();
  offConsole();
  offNet();
  const page = snapshot.page ?? {};
  const gateAt = gate.ok ? gate.pageNow : Number.POSITIVE_INFINITY;
  const summary = summarize(page, Number.isFinite(gateAt) ? gateAt : 1e12);
  const jsRes = summary.beforeGate.top30.find((r) => r.category === 'javascript');
  const jsEnc = contentEncoding.find((e) => {
    const path = e.url.split(/[?#]/, 1)[0] ?? '';
    return path.endsWith('.js') && e.status === 200;
  });
  return {
    ...snapshot,
    gzip: GZIP,
    gzipProof: {
      jsContentEncoding: jsEnc?.encoding || '',
      jsMime: jsEnc?.mime || '',
      jsTransferSize: jsRes?.transferSize ?? null,
      jsEncodedBodySize: jsRes?.encodedBodySize ?? null,
      jsDecodedBodySize: jsRes?.decodedBodySize ?? null,
    },
    contentEncoding: contentEncoding.filter((e) => e.encoding).slice(0, 40),
    consoles: consoles.filter((c) => /error|warn|404|WebGPU|pipeline|shader|camera/i.test(c.text + c.type)).slice(0, 80),
    summary,
  };
}

function median(values: number[]): number | null {
  const xs = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (xs.length === 0) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 === 0 ? (xs[mid - 1]! + xs[mid]!) / 2 : xs[mid]!;
}

async function probeJsGzip(): Promise<{ path: string; headers: string; gzip: boolean }> {
  const html = await Bun.file(join(OUT_DIR, 'games/hellforge/index.html')).text();
  const m = html.match(/src="([^"]+\.js)"/) ?? html.match(/(assets\/[^"'?]+\.js)/);
  const rel = m?.[1] ?? GAME_PATH;
  const path = rel.startsWith('/') ? rel : `${GAME_PATH}${rel}`;
  const proc = Bun.spawn(
    ['curl', '-sI', '-H', 'Accept-Encoding: gzip', `http://127.0.0.1:${PORT}${path}`],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  const headers = await new Response(proc.stdout).text();
  await proc.exited;
  return {
    path,
    headers,
    gzip: /content-encoding:\s*gzip/i.test(headers),
  };
}

async function main() {
  if (!existsSync(join(OUT_DIR, 'games/hellforge/index.html'))) {
    throw new Error(`missing bake at ${OUT_DIR}/games/hellforge/index.html`);
  }
  mkdirSync(REPORT_DIR, { recursive: true });
  const server = await startStaticServer();
  const gzipProbe = await probeJsGzip();
  console.log('gzipProbe', gzipProbe);
  const userDir = '/tmp/hellforge-perf-chrome-profile';
  const chrome = await launchChrome(userDir);
  const tabs = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json()) as Array<{
    type: string;
    webSocketDebuggerUrl?: string;
  }>;
  const pageTab = tabs.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  if (!pageTab?.webSocketDebuggerUrl) throw new Error('no Chrome page target');
  const cdp = await connectCdp(pageTab.webSocketDebuggerUrl);
  const cold: Array<Record<string, unknown>> = [];
  const warm: Array<Record<string, unknown>> = [];
  try {
    for (let i = 1; i <= COLD_RUNS; i += 1) {
      console.log(`cold ${i}/${COLD_RUNS}`);
      await cdp.send('Network.clearBrowserCache').catch(() => undefined);
      cold.push(await runOnce(cdp, {
        cacheDisabled: true,
        runId: `cold-${Date.now()}-${i}`,
        label: `cold-${i}`,
      }));
    }
    console.log('warm primer');
    await runOnce(cdp, {
      cacheDisabled: false,
      runId: `primer-${Date.now()}`,
      label: 'warm-primer',
    });
    for (let i = 1; i <= WARM_RUNS; i += 1) {
      console.log(`warm ${i}/${WARM_RUNS}`);
      warm.push(await runOnce(cdp, {
        cacheDisabled: false,
        runId: `warm-${Date.now()}-${i}`,
        label: `warm-${i}`,
      }));
    }
    const coldGate = cold.map((r) => Number((r as { wallMsToGate?: number }).wallMsToGate));
    const warmGate = warm.map((r) => Number((r as { wallMsToGate?: number }).wallMsToGate));
    const report = {
      generatedAt: new Date().toISOString(),
      gzip: GZIP,
      gzipExt: GZIP ? [...GZIP_EXT] : [],
      gzipProbe,
      network: { downloadMbps: Number(process.env.DOWNLOAD_MBPS || 20), uploadMbps: Number(process.env.UPLOAD_MBPS || 5), rttMs: LATENCY_MS },
      viewport: '1920x1080',
      bake: OUT_DIR,
      cold: {
        runs: cold,
        wallMsToGateMedian: median(coldGate),
        wallMsToGateWorst: Math.max(...coldGate),
      },
      warm: {
        runs: warm,
        wallMsToGateMedian: median(warmGate),
        wallMsToGateWorst: Math.max(...warmGate),
      },
    };
    const outPath = join(REPORT_DIR, REPORT_JSON);
    writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({
      wrote: outPath,
      coldMedianMs: report.cold.wallMsToGateMedian,
      coldWorstMs: report.cold.wallMsToGateWorst,
      warmMedianMs: report.warm.wallMsToGateMedian,
      warmWorstMs: report.warm.wallMsToGateWorst,
      firstGpu: (cold[0] as { gpu?: unknown } | undefined)?.gpu,
      firstGzipProof: (cold[0] as { gzipProof?: unknown } | undefined)?.gzipProof,
      firstBeforeGate: (cold[0] as { summary?: { beforeGate?: unknown } } | undefined)?.summary?.beforeGate,
    }, null, 2));
  } finally {
    cdp.close();
    chrome.proc.kill();
    server.stop();
  }
}

await main();
