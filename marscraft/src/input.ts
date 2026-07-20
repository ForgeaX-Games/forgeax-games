// MarsCraft input-state module — ported from the Three.js
// `web/engine/InputManager.ts` + the input half of `web/engine/CameraController.ts`
// (`_onKeyDown/_onKeyUp/_onMouseMove/_onMouseDown/_onMouseUp/_onWheel/_onResize/
//  _onContextMenu/_onMouseLeave/_onMouseEnter`) to a framework-free, renderer-
// agnostic plain mutable `InputState`.
//
// ── Why a plain state object (not THREE-coupled callbacks) ───────────────────
// The source InputManager fires EventBus command events and the CameraController
// holds its own private `_keys/_mouseX/_zoomDelta`. In the forgeax port those two
// concerns split: this module owns ALL raw DOM input (keys / pointer / wheel /
// buttons / edge flags) as one mutable record, and ECS systems (the RTS camera
// in src/world/camera.ts, later selection/command systems) read it each frame.
// No engine import, no THREE — just listeners writing fields.
//
// ── Coordinate fields (match the source's usage) ────────────────────────────
//   x / y                : pointer position in CANVAS pixel space (clientX/Y - rect)
//   ndcX / ndcY          : normalized device coords [-1,1], y-up (THREE convention)
//   wheelDelta           : accumulator of -sign(deltaY) (source `_zoomDelta`),
//                          drained by consumeWheel() once per frame
//   edgeLeft/Right/Up/Down : true while the cursor sits in the edge-scroll band
//   buttons              : which mouse buttons are held (left/middle/right)
//   mouseInWindow        : false once the cursor leaves the viewport (widens the
//                          edge band so a fast exit still keeps scrolling — source
//                          `_mouseInWindow` + `_onMouseLeave`)
//   middleDrag{X,Y}      : per-frame middle-button drag delta (px), drained by
//                          consumeMiddleDrag() — source `_onMouseMove` middle path
//
// Guarded so a headless/non-DOM load can't crash bootstrap.

export interface InputButtons {
  left: boolean;
  middle: boolean;
  right: boolean;
}

export interface InputState {
  /** Currently-held key codes (KeyboardEvent.code), e.g. 'ArrowUp', 'KeyW'. */
  readonly keys: Set<string>;
  /** Key codes that transitioned down THIS frame; drained by consumeJustPressed(). */
  readonly justPressed: Set<string>;

  /** Pointer position in canvas pixel space. */
  x: number;
  y: number;
  /** Normalized device coords (THREE convention: x∈[-1,1], y∈[-1,1] up). */
  ndcX: number;
  ndcY: number;

  /** Canvas size in CSS px (kept in sync via resize + per-event rect read). */
  canvasWidth: number;
  canvasHeight: number;

  /** Mouse buttons currently held. */
  readonly buttons: InputButtons;

  /** Accumulated wheel ticks (sum of -sign(deltaY)); drain via consumeWheel(). */
  wheelDelta: number;

  /** Accumulated middle-drag delta in px; drain via consumeMiddleDrag(). */
  middleDragX: number;
  middleDragY: number;

  /** Edge-scroll band flags (recomputed on every pointer move + on leave). */
  edgeLeft: boolean;
  edgeRight: boolean;
  edgeUp: boolean;
  edgeDown: boolean;

  /** Whether the cursor is inside the viewport. */
  mouseInWindow: boolean;

  /** Settings toggle: when false, edge-scroll bands are suppressed (SettingsPanel). */
  edgeScrollEnabled: boolean;

  // ── frame-drain accessors (mirror source single-frame semantics) ──
  /** Read + reset the accumulated wheel ticks (source `_zoomDelta` consume). */
  consumeWheel(): number;
  /** Read + reset the accumulated middle-button drag delta. */
  consumeMiddleDrag(): { dx: number; dy: number };
  /** True if a key went down this frame; pass true to also clear it. */
  wasJustPressed(code: string, clear?: boolean): boolean;
  /** Clear all single-frame state (justPressed). Call at end of frame if used. */
  endFrame(): void;
  /** Detach all DOM listeners (idempotent). */
  dispose(): void;
}

/** Edge-scroll trigger band width in px (source CameraController DEFAULT edgeScrollWidth). */
const EDGE_BAND = 20;

/**
 * Attach DOM listeners to the canvas / window and return a live mutable
 * `InputState`. Safe to call in a non-DOM environment — it returns an inert
 * state whose fields never change (no listeners attached).
 */
export function installInput(canvas?: HTMLCanvasElement | null): InputState {
  const state: InputState = {
    keys: new Set<string>(),
    justPressed: new Set<string>(),
    x: 0,
    y: 0,
    ndcX: 0,
    ndcY: 0,
    canvasWidth: 1,
    canvasHeight: 1,
    buttons: { left: false, middle: false, right: false },
    wheelDelta: 0,
    middleDragX: 0,
    middleDragY: 0,
    edgeLeft: false,
    edgeRight: false,
    edgeUp: false,
    edgeDown: false,
    mouseInWindow: true,
    edgeScrollEnabled: true,
    consumeWheel() {
      const w = this.wheelDelta;
      this.wheelDelta = 0;
      return w;
    },
    consumeMiddleDrag() {
      const dx = this.middleDragX;
      const dy = this.middleDragY;
      this.middleDragX = 0;
      this.middleDragY = 0;
      return { dx, dy };
    },
    wasJustPressed(code: string, clear = false): boolean {
      const hit = this.justPressed.has(code);
      if (hit && clear) this.justPressed.delete(code);
      return hit;
    },
    endFrame() {
      this.justPressed.clear();
    },
    dispose() { /* replaced below when listeners attach */ },
  };

  // Headless / SSR guard — no DOM, return inert state.
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return state;
  }

  // Resolve the canvas/event target. Pointer-position math needs the canvas rect;
  // keys/wheel listen on window so they fire regardless of focus (matches source,
  // which bound keydown/wheel to window).
  const target: HTMLElement = canvas ?? document.querySelector<HTMLCanvasElement>('#app') ?? document.body;

  const syncCanvasSize = () => {
    const w = (canvas?.clientWidth ?? target.clientWidth) || window.innerWidth;
    const h = (canvas?.clientHeight ?? target.clientHeight) || window.innerHeight;
    state.canvasWidth = Math.max(1, w);
    state.canvasHeight = Math.max(1, h);
  };
  syncCanvasSize();

  // Recompute pointer canvas-space coords + NDC + edge flags from a pointer event.
  const updatePointer = (e: { clientX: number; clientY: number }) => {
    const el = canvas ?? target;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    state.x = px;
    state.y = py;
    const w = rect.width || state.canvasWidth;
    const h = rect.height || state.canvasHeight;
    state.canvasWidth = Math.max(1, w);
    state.canvasHeight = Math.max(1, h);
    // THREE NDC: x right, y up.
    state.ndcX = (px / w) * 2 - 1;
    state.ndcY = -((py / h) * 2) + 1;
    recomputeEdges();
  };

  // Edge-scroll band. When the cursor has left the window, widen the band so a
  // fast exit still latches scrolling (source: activeEW = max(ew*4, 80)).
  const recomputeEdges = () => {
    if (!state.edgeScrollEnabled) { state.edgeLeft = state.edgeRight = state.edgeUp = state.edgeDown = false; return; }
    const band = state.mouseInWindow ? EDGE_BAND : Math.max(EDGE_BAND * 4, 80);
    state.edgeLeft = state.x < band;
    state.edgeRight = state.x > state.canvasWidth - band;
    state.edgeUp = state.y < band;
    state.edgeDown = state.y > state.canvasHeight - band;
  };

  // ── handlers ──────────────────────────────────────────────────────────────
  let lastMoveX = 0;
  let lastMoveY = 0;

  const onKeyDown = (e: KeyboardEvent) => {
    if (!state.keys.has(e.code)) state.justPressed.add(e.code);
    state.keys.add(e.code);
  };
  const onKeyUp = (e: KeyboardEvent) => {
    state.keys.delete(e.code);
  };

  const onPointerMove = (e: PointerEvent | MouseEvent) => {
    // Middle-button drag delta (source `_onMouseMove` middle path → focus pan).
    if (state.buttons.middle) {
      state.middleDragX += e.clientX - lastMoveX;
      state.middleDragY += e.clientY - lastMoveY;
    }
    lastMoveX = e.clientX;
    lastMoveY = e.clientY;
    updatePointer(e);
  };

  const onPointerDown = (e: PointerEvent | MouseEvent) => {
    if (e.button === 0) state.buttons.left = true;
    else if (e.button === 1) { state.buttons.middle = true; e.preventDefault(); }
    else if (e.button === 2) state.buttons.right = true;
    lastMoveX = e.clientX;
    lastMoveY = e.clientY;
    updatePointer(e);
  };

  const onPointerUp = (e: PointerEvent | MouseEvent) => {
    if (e.button === 0) state.buttons.left = false;
    else if (e.button === 1) state.buttons.middle = false;
    else if (e.button === 2) state.buttons.right = false;
    updatePointer(e);
  };

  const onWheel = (e: WheelEvent) => {
    // Source: `_zoomDelta -= Math.sign(e.deltaY)` (wheel up → positive zoom-in).
    state.wheelDelta -= Math.sign(e.deltaY);
    e.preventDefault();
  };

  const onContextMenu = (e: Event) => {
    e.preventDefault(); // disable the right-click menu (source `_onContextMenu`)
  };

  const onResize = () => { syncCanvasSize(); recomputeEdges(); };

  const onMouseLeave = (e: MouseEvent) => {
    state.mouseInWindow = false;
    // Pin the pointer to the side it exited so edge-scroll keeps latching
    // (source `_onMouseLeave`, loose threshold).
    const threshold = Math.max(EDGE_BAND * 3, 60);
    const w = state.canvasWidth;
    const h = state.canvasHeight;
    if (e.clientY < threshold) state.y = 0;
    else if (e.clientY > h - threshold) state.y = h;
    if (e.clientX < threshold) state.x = 0;
    else if (e.clientX > w - threshold) state.x = w;
    recomputeEdges();
  };
  const onMouseEnter = () => { state.mouseInWindow = true; recomputeEdges(); };

  // ── bind (mirror source bind targets) ───────────────────────────────────────
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerdown', onPointerDown);
  // capture-phase up so a release over an overlaying UI panel still clears state.
  window.addEventListener('pointerup', onPointerUp, true);
  target.addEventListener('wheel', onWheel, { passive: false });
  target.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('resize', onResize);
  document.documentElement.addEventListener('mouseleave', onMouseLeave);
  document.documentElement.addEventListener('mouseenter', onMouseEnter);

  let disposed = false;
  state.dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerdown', onPointerDown);
    window.removeEventListener('pointerup', onPointerUp, true);
    target.removeEventListener('wheel', onWheel);
    target.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('resize', onResize);
    document.documentElement.removeEventListener('mouseleave', onMouseLeave);
    document.documentElement.removeEventListener('mouseenter', onMouseEnter);
  };

  return state;
}
