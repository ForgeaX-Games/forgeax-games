/**
 * Hellforge is click-to-move ARPG: the gauntlet cursor must stay free.
 * Engine input defaults gameGate=true and requestPointerLock() on canvas
 * click. Standalone website builds have no lockProvider, so that hides the
 * OS + CSS cursor. This guard closes the engine gate and exits any lock
 * that still sneaks through (createApp attaches input before bootstrap).
 */

export type PointerLockGate = {
  setPointerLockAllowed?: (allowed: boolean) => void;
};

export type PointerLockDoc = {
  pointerLockElement: Element | null;
  exitPointerLock?: () => void;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
};

export function defaultHostCaptureRelease(): void {
  try {
    window.parent.postMessage({ type: 'fx-pointer-capture', capture: false }, '*');
  } catch {
    /* not embedded / parent gone */
  }
}

export function releasePointerLock(doc: PointerLockDoc, postRelease?: () => void): void {
  if (doc.pointerLockElement && typeof doc.exitPointerLock === 'function') {
    try { doc.exitPointerLock(); } catch { /* ignore */ }
  }
  postRelease?.();
}

let uninstallActive: (() => void) | null = null;

export function installPointerLockGuard(opts: {
  ctx?: PointerLockGate | null;
  doc?: PointerLockDoc | null;
  postRelease?: () => void;
} = {}): () => void {
  uninstallActive?.();
  uninstallActive = null;

  opts.ctx?.setPointerLockAllowed?.(false);
  const doc = opts.doc ?? (typeof document !== 'undefined' ? document : null);
  if (!doc) return () => {};

  const postRelease = opts.postRelease
    ?? (typeof window !== 'undefined' ? defaultHostCaptureRelease : undefined);
  const release = (): void => releasePointerLock(doc, postRelease);
  release();

  const onChange: EventListener = () => {
    if (doc.pointerLockElement) release();
  };
  doc.addEventListener('pointerlockchange', onChange);
  const dispose = (): void => {
    doc.removeEventListener('pointerlockchange', onChange);
    if (uninstallActive === dispose) uninstallActive = null;
  };
  uninstallActive = dispose;
  return dispose;
}
