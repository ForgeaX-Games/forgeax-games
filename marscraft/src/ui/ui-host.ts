// Shared DOM-UI mount resolution for marscraft's overlays.
//
// Single-realm Play (engine 02ad4bd HUD/uiRoot contract): the studio host builds
// a disposable `#game-ui-root` (position:absolute; inset:0; overflow:hidden)
// INSIDE the viewport panel and removes it WHOLE on ■ Stop. Every DOM overlay
// must mount into that container — otherwise it (a) mounts to the canvas parent
// `.ep-viewport-root` (or worse, document.body) and is STRANDED after Stop
// (the ECS-surgical undo can't reach DOM), and (b) a `position:fixed` overlay
// pins to the whole window and spills onto the History/CLI/Inspector panels.
//
// resolveUiHost() returns, in priority order:
//   1. `#game-ui-root`      — the host's disposable container (Stop removes it)
//   2. the `#app` canvas's offset parent (`.ep-viewport-root`) — legacy/standalone
//   3. `document.body`      — headless / no canvas
// and ensures the chosen host is a positioned ancestor so `position:absolute`
// children anchor to it (the host root is already relative/absolute; a bare
// canvas parent may be `static`).

/** Resolve the DOM container marscraft overlays should mount into. */
export function resolveUiHost(): HTMLElement {
  const uiRoot = document.getElementById('game-ui-root');
  if (uiRoot) return uiRoot;
  const appCanvas = document.querySelector<HTMLCanvasElement>('#app');
  const parent = appCanvas?.parentElement ?? document.body;
  if (parent !== document.body && getComputedStyle(parent).position === 'static') {
    parent.style.position = 'relative';
  }
  return parent;
}

/**
 * True when `host` is the disposable `#game-ui-root` (or any non-body positioned
 * container). Callers use it to pick `position:absolute` (fill+clip the viewport)
 * vs the `position:fixed` document.body fallback (window == viewport there).
 */
export function isScopedHost(host: HTMLElement): boolean {
  return host !== document.body;
}
