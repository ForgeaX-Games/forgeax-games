// Sfx lifecycle + audibility: gesture arming, suspended-context resume,
// dispose() teardown (listeners + AudioContext.close), and the new
// monster-aggro / monster-attack entries.
//
// No engine imports — sfx.ts is pure WebAudio; AudioContext + window are
// stubbed on globalThis (same fake-target pattern as save-schema.test.ts).

import { afterEach, describe, expect, test } from 'bun:test';

import { Sfx } from './sfx';

type Listener = () => void;

class FakeGainParam {
  value = 0;
  setValueAtTime(_v: number, _t: number) {}
  exponentialRampToValueAtTime(_v: number, _t: number) {}
}

class FakeNode {
  connect(target: unknown) { return target; }
}

class FakeOscillator extends FakeNode {
  type = '';
  frequency = new FakeGainParam();
  start(_t?: number) {}
  stop(_t?: number) {}
}

class FakeBufferSource extends FakeNode {
  buffer: unknown = null;
  start(_t?: number) {}
}

class FakeBiquad extends FakeNode {
  type = '';
  frequency = new FakeGainParam();
  Q = new FakeGainParam();
}

class FakeGain extends FakeNode {
  gain = new FakeGainParam();
}

class FakeAudioContext {
  state: 'running' | 'suspended' | 'closed' = 'running';
  currentTime = 0;
  sampleRate = 48000;
  destination = {};
  resumeCalls = 0;
  closeCalls = 0;
  oscillators = 0;
  buffers = 0;
  createGain() { return new FakeGain(); }
  createOscillator() { this.oscillators += 1; return new FakeOscillator(); }
  createBuffer(_ch: number, len: number, _rate: number) {
    this.buffers += 1;
    return { getChannelData: () => new Float32Array(Math.max(1, len)) };
  }
  createBufferSource() { return new FakeBufferSource(); }
  createBiquadFilter() { return new FakeBiquad(); }
  resume() { this.resumeCalls += 1; this.state = 'running'; return Promise.resolve(); }
  close() { this.closeCalls += 1; this.state = 'closed'; return Promise.resolve(); }
}

interface FakeWindow {
  listeners: Map<string, Set<Listener>>;
  removed: Array<{ type: string; fn: Listener }>;
  addEventListener(type: string, fn: Listener): void;
  removeEventListener(type: string, fn: Listener): void;
  dispatch(type: string): void;
}

const g = globalThis as {
  window?: FakeWindow;
  AudioContext?: unknown;
};
const prevWindow = g.window;
const prevAudioContext = g.AudioContext;
let win: FakeWindow;
let lastCtx: FakeAudioContext | null = null;

function installFakes(): void {
  const listeners = new Map<string, Set<Listener>>();
  const removed: Array<{ type: string; fn: Listener }> = [];
  win = {
    listeners,
    removed,
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
      removed.push({ type, fn });
    },
    dispatch(type) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn();
    },
  };
  g.window = win;
  g.AudioContext = class extends FakeAudioContext {
    constructor() {
      super();
      lastCtx = this;
    }
  };
}

afterEach(() => {
  if (prevWindow === undefined) delete g.window;
  else g.window = prevWindow;
  if (prevAudioContext === undefined) delete g.AudioContext;
  else g.AudioContext = prevAudioContext;
  lastCtx = null;
});

describe('Sfx lifecycle', () => {
  test('install() arms on the first gesture; play() before that is dropped silently', () => {
    installFakes();
    const sfx = new Sfx();
    sfx.play('hit'); // no context yet — must not throw
    expect(lastCtx).toBeNull();

    sfx.install();
    expect(win.listeners.get('pointerdown')?.size).toBe(1);
    expect(win.listeners.get('keydown')?.size).toBe(1);

    win.dispatch('pointerdown');
    expect(lastCtx).not.toBeNull();
    // Arming removed its own listeners.
    expect(win.listeners.get('pointerdown')?.size ?? 0).toBe(0);
    expect(win.listeners.get('keydown')?.size ?? 0).toBe(0);
  });

  test('play() resumes a suspended context before queueing nodes', () => {
    installFakes();
    const sfx = new Sfx();
    sfx.install();
    win.dispatch('pointerdown');
    const ctx = lastCtx!;
    ctx.state = 'suspended';

    sfx.play('hit');
    expect(ctx.resumeCalls).toBe(1);
    expect(ctx.oscillators).toBeGreaterThan(0); // the hit still plays
  });

  test('play() does not resume a running context', () => {
    installFakes();
    const sfx = new Sfx();
    sfx.install();
    win.dispatch('pointerdown');
    const ctx = lastCtx!;
    expect(ctx.state).toBe('running');
    sfx.play('hit');
    expect(ctx.resumeCalls).toBe(0);
  });

  test('dispose() before any gesture unarms the listeners', () => {
    installFakes();
    const sfx = new Sfx();
    sfx.install();
    sfx.dispose();
    expect(win.listeners.get('pointerdown')?.size ?? 0).toBe(0);
    expect(win.listeners.get('keydown')?.size ?? 0).toBe(0);
    // A later gesture must not create a context anymore.
    win.dispatch('pointerdown');
    expect(lastCtx).toBeNull();
  });

  test('dispose() after arming closes the context; play() becomes a no-op; idempotent', () => {
    installFakes();
    const sfx = new Sfx();
    sfx.install();
    win.dispatch('pointerdown');
    const ctx = lastCtx!;

    sfx.dispose();
    expect(ctx.closeCalls).toBe(1);
    sfx.dispose();
    expect(ctx.closeCalls).toBe(1); // idempotent

    const oscBefore = ctx.oscillators;
    sfx.play('hit'); // silently dropped — no context
    expect(ctx.oscillators).toBe(oscBefore);
  });
});

describe('Sfx monster entries', () => {
  test('monster-aggro and monster-attack synthesize without throwing', () => {
    installFakes();
    const sfx = new Sfx();
    sfx.install();
    win.dispatch('pointerdown');
    const ctx = lastCtx!;

    sfx.play('monster-aggro');
    expect(ctx.oscillators).toBeGreaterThan(0); // growl tone
    expect(ctx.buffers).toBeGreaterThan(0);     // rumble noise

    ctx.currentTime += 0.1; // clear the 45 ms rate limiter
    sfx.play('monster-attack');
    expect(ctx.buffers).toBeGreaterThan(1);     // whoosh noise
  });
});
