// CDP driver for verifying planet-snake in a real browser.
//
// Two traps this bakes in, both cost a previous session its conclusions:
//   1. The compositor stops producing frames when the tab is backgrounded or the
//      window is occluded. Every capture then returns the same stale frame, and
//      "three repeat screenshots" come back byte-identical. Page.bringToFront on
//      every connect; if captures still repeat, the OS window is occluded —
//      activate Chrome before trusting anything.
//   2. Page.captureScreenshot polls; it misses short-lived frames. Use `cast`
//      (Page.startScreencast) when hunting a transient.
//
// Usage: CDP_PORT=9444 bun cdp.mjs <cmd> [args]
//   shot <out> [delayMs]
//   cast <outDir> <ms>            reload, then record EVERY composited frame
//   eval <expr>
//   key  <KeyCode> <holdMs>
//   moves <ms>                    decide whether the scene is actually animating
import { writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const HOST = `127.0.0.1:${process.env.CDP_PORT ?? '9444'}`;
const MATCH = process.env.CDP_MATCH ?? 'planet-snake';

class Cdp {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.events = []; this.handlers = [];
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id !== undefined) {
        const p = this.pending.get(m.id);
        if (p) { this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
      } else { this.events.push(m); for (const h of this.handlers) h(m); }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { resolve: res, reject: rej }));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect() {
  const list = await (await fetch(`http://${HOST}/json`)).json();
  const t = list.find((x) => x.type === 'page' && x.url.includes(MATCH));
  if (!t) throw new Error(`no page matching "${MATCH}": ${JSON.stringify(list.map((x) => x.url))}`);
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  const c = new Cdp(ws);
  await c.send('Runtime.enable'); await c.send('Log.enable'); await c.send('Page.enable');
  await c.send('Page.bringToFront');
  return c;
}

const fmt = (evs) => evs.flatMap((e) => {
  if (e.method === 'Runtime.consoleAPICalled')
    return [`[${e.params.type}] ${e.params.args.map((a) => a.value ?? a.description ?? a.type).join(' ')}`];
  if (e.method === 'Runtime.exceptionThrown')
    return [`[EXCEPTION] ${e.params.exceptionDetails.text} ${e.params.exceptionDetails.exception?.description ?? ''}`];
  if (e.method === 'Log.entryAdded') return [`[log:${e.params.entry.level}] ${e.params.entry.text}`];
  return [];
});

const [cmd, ...args] = process.argv.slice(2);
const cdp = await connect();

if (cmd === 'shot') {
  const [out, delay = '0'] = args;
  await sleep(Number(delay));
  const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(out, Buffer.from(s.data, 'base64'));
  console.log('shot', out);
} else if (cmd === 'cast') {
  const [dir, ms = '6000'] = args;
  mkdirSync(dir, { recursive: true });
  let n = 0; const t0 = Date.now();
  cdp.handlers.push((m) => {
    if (m.method !== 'Page.screencastFrame') return;
    writeFileSync(`${dir}/f${String(n++).padStart(4, '0')}-t${String(Date.now() - t0).padStart(6, '0')}.png`,
      Buffer.from(m.params.data, 'base64'));
    cdp.send('Page.screencastFrameAck', { sessionId: m.params.sessionId }).catch(() => {});
  });
  await cdp.send('Page.reload', { ignoreCache: true });
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: 1600, maxHeight: 900 });
  await sleep(Number(ms));
  await cdp.send('Page.stopScreencast');
  console.log(`captured ${n} frames / ${Date.now() - t0}ms`);
  console.log('--- console ---\n' + (fmt(cdp.events).join('\n') || '(empty)'));
} else if (cmd === 'eval') {
  const r = await cdp.send('Runtime.evaluate', { expression: args.join(' '), awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(r.result?.value ?? r.result, null, 2));
  if (r.exceptionDetails) console.log('EXC:', JSON.stringify(r.exceptionDetails).slice(0, 600));
} else if (cmd === 'key') {
  const [code, hold = '1200'] = args;
  const vk = { KeyA: 65, KeyD: 68, KeyR: 82, ShiftLeft: 16 }[code] ?? 65;
  const base = { windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, code, key: code.replace('Key', '').toLowerCase() };
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...base });
  await sleep(Number(hold));
  await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  console.log('pressed', code, hold + 'ms');
} else if (cmd === 'moves') {
  // The decisive "is the game actually running" probe: N screenshots spaced out,
  // hashed. A dead update loop renders a byte-identical frame every time even
  // though rAF is firing at 60Hz — that is exactly how a broken loop hid before.
  const ms = Number(args[0] ?? 4000), N = 4;
  const hashes = [];
  for (let i = 0; i < N; i++) {
    const s = await cdp.send('Page.captureScreenshot', { format: 'png' });
    hashes.push(createHash('md5').update(s.data).digest('hex').slice(0, 12));
    if (i < N - 1) await sleep(ms / (N - 1));
  }
  const uniq = new Set(hashes).size;
  console.log('frame hashes:', hashes.join(' '));
  console.log(uniq === 1 ? '❌ STATIC — every frame identical; the update loop is not running'
    : `✓ ANIMATING — ${uniq}/${N} distinct frames`);
} else console.log('unknown cmd');

process.exit(0);
