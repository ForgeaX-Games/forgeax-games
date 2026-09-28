import { afterEach, describe, expect, test } from 'bun:test';
import type { GameHost } from '@forgeax/engine/app';
import { requireBrowserCanvas, requireGameRenderer } from './game-host';

const originalCanvas = Object.getOwnPropertyDescriptor(globalThis, 'HTMLCanvasElement');
afterEach(() => {
  if (originalCanvas) Object.defineProperty(globalThis, 'HTMLCanvasElement', originalCanvas);
  else Reflect.deleteProperty(globalThis, 'HTMLCanvasElement');
});

describe('Hellforge presentation host', () => {
  test('rejects a worker host before game side effects are installed', () => {
    Reflect.deleteProperty(globalThis, 'HTMLCanvasElement');
    expect(() => requireBrowserCanvas(undefined)).toThrow('main-thread HTML canvas');
    expect(() => requireGameRenderer(undefined)).toThrow('presentation host renderer');
  });

  test('uses the host canvas and refuses non-HTML canvases', () => {
    class TestCanvas {}
    Object.defineProperty(globalThis, 'HTMLCanvasElement', { value: TestCanvas, configurable: true });
    const canvas = new TestCanvas() as HTMLCanvasElement;
    expect(requireBrowserCanvas(canvas)).toBe(canvas);
    expect(() => requireBrowserCanvas({} as GameHost['canvas'])).toThrow('main-thread HTML canvas');
  });
});
