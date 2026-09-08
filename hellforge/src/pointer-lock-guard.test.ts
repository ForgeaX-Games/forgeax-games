import { describe, expect, test } from 'bun:test';
import { installPointerLockGuard, releasePointerLock } from './pointer-lock-guard';

function fakeDoc(locked: { el: Element | null }): {
  doc: {
    pointerLockElement: Element | null;
    exitPointerLock: () => void;
    addEventListener: (type: string, listener: EventListener) => void;
    removeEventListener: (type: string, listener: EventListener) => void;
  };
  exits: number;
  listeners: EventListener[];
  dispatchLock(el: Element | null): void;
} {
  const listeners: EventListener[] = [];
  const state = {
    exits: 0,
    listeners,
    doc: {
      get pointerLockElement() { return locked.el; },
      exitPointerLock() { state.exits += 1; locked.el = null; },
      addEventListener(_type: string, listener: EventListener) { listeners.push(listener); },
      removeEventListener(_type: string, listener: EventListener) {
        const i = listeners.indexOf(listener);
        if (i >= 0) listeners.splice(i, 1);
      },
    },
    dispatchLock(el: Element | null) {
      locked.el = el;
      for (const fn of [...listeners]) fn(new Event('pointerlockchange'));
    },
  };
  return state;
}

describe('pointer-lock guard', () => {
  test('closes the engine gate and exits an already-held lock', () => {
    const locked = { el: {} as Element };
    const env = fakeDoc(locked);
    const posts: boolean[] = [];
    const gates: boolean[] = [];
    const dispose = installPointerLockGuard({
      ctx: { setPointerLockAllowed: (allowed) => gates.push(allowed) },
      doc: env.doc,
      postRelease: () => posts.push(true),
    });
    expect(gates).toEqual([false]);
    expect(env.exits).toBe(1);
    expect(locked.el).toBeNull();
    expect(posts).toEqual([true]);
    dispose();
  });

  test('pointerlockchange after a later lock immediately exits', () => {
    const locked = { el: null as Element | null };
    const env = fakeDoc(locked);
    installPointerLockGuard({
      doc: env.doc,
      postRelease: () => {},
    });
    expect(env.exits).toBe(0);
    env.dispatchLock({} as Element);
    expect(env.exits).toBe(1);
    expect(locked.el).toBeNull();
  });

  test('dispose drops the watcher so a later lock is not auto-exited', () => {
    const locked = { el: null as Element | null };
    const env = fakeDoc(locked);
    const dispose = installPointerLockGuard({
      doc: env.doc,
      postRelease: () => {},
    });
    dispose();
    env.dispatchLock({} as Element);
    expect(env.exits).toBe(0);
    expect(locked.el).not.toBeNull();
  });

  test('reinstall replaces the previous watcher', () => {
    const locked = { el: null as Element | null };
    const first = fakeDoc(locked);
    const second = fakeDoc(locked);
    installPointerLockGuard({ doc: first.doc, postRelease: () => {} });
    installPointerLockGuard({ doc: second.doc, postRelease: () => {} });
    first.dispatchLock({} as Element);
    expect(first.exits).toBe(0);
    second.dispatchLock({} as Element);
    expect(second.exits).toBe(1);
  });

  test('releasePointerLock is a no-op when unlocked', () => {
    const locked = { el: null as Element | null };
    const env = fakeDoc(locked);
    releasePointerLock(env.doc);
    expect(env.exits).toBe(0);
  });
});
