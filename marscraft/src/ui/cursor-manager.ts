/**
 * MarsCraft -> forgeax-engine — CursorManager (Milestone M12)
 * =============================================================================
 * Faithful port of the Three.js source `web/ui/CursorManager.ts`. SC2-style mouse
 * cursor: a two-layer state machine (a MODE cursor set by the active interaction
 * mode — build / attack-move / rally / ability / land — over a HOVER cursor set
 * per-frame by what the pointer is over). The mode layer wins. Each cursor is
 * drawn on a small offscreen canvas -> a data URL -> swapped via
 * `document.body.style.cursor = url(...)`.
 *
 * ── Adaptations vs source ─────────────────────────────────────────────────────
 *   - Comments translated to English / ASCII (studio source-text rule).
 *   - ALL DOM is guarded (`typeof document === 'undefined'`): the canvas drawing,
 *     the body-style write and the constructor's overlay-hide all no-op headless,
 *     so the HUD's `installHud` can construct a CursorManager in any environment.
 *   - The drawing routines + cursor catalogue are otherwise 1:1 with the source.
 */

export type CursorState =
  | 'normal'
  | 'attack'
  | 'attack_move'
  | 'attack_move_enemy'
  | 'attack_move_ally'
  | 'build'
  | 'harvest'
  | 'harvest_gas'
  | 'rally'
  | 'patrol'
  | 'repair'
  | 'ability'
  | 'ability_enemy'
  | 'ability_ally'
  | 'land'
  | 'forbidden'
  | 'ally'
  | 'neutral';

const CURSOR_SIZE = 32;
const CURSOR_HALF = CURSOR_SIZE / 2;

const _cursorCache = new Map<CursorState, string>();

function _hasDom(): boolean {
  return typeof document !== 'undefined';
}

function _createCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  if (!_hasDom()) return null;
  const canvas = document.createElement('canvas');
  canvas.width = CURSOR_SIZE;
  canvas.height = CURSOR_SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return [canvas, ctx];
}

/** Default arrow cursor (hotspot top-left). */
function _drawArrow(ctx: CanvasRenderingContext2D, color: string, outlineColor = '#000'): void {
  ctx.save();
  ctx.translate(2, 1);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 20);
  ctx.lineTo(5, 16);
  ctx.lineTo(9, 24);
  ctx.lineTo(13, 22);
  ctx.lineTo(9, 14);
  ctx.lineTo(14, 12);
  ctx.closePath();
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** Crosshair cursor (hotspot center). */
function _drawCrosshair(ctx: CanvasRenderingContext2D, color: string): void {
  const cx = CURSOR_HALF;
  const cy = CURSOR_HALF;
  const r = 10;
  const gap = 3;
  const lineW = 2;

  ctx.strokeStyle = '#000';
  ctx.lineWidth = lineW + 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r, cy); ctx.lineTo(cx - gap, cy);
  ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy - gap);
  ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + r);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = lineW;
  ctx.beginPath();
  ctx.moveTo(cx - r, cy); ctx.lineTo(cx - gap, cy);
  ctx.moveTo(cx + gap, cy); ctx.lineTo(cx + r, cy);
  ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy - gap);
  ctx.moveTo(cx, cy + gap); ctx.lineTo(cx, cy + r);
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, 1.5, 0, Math.PI * 2);
  ctx.fill();
}

/** Harvest cursor (arrow + small pick). */
function _drawHarvest(ctx: CanvasRenderingContext2D, color: string): void {
  _drawArrow(ctx, '#ffffff');
  ctx.save();
  ctx.translate(16, 16);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(2, 12); ctx.lineTo(10, 4);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(2, 12); ctx.lineTo(10, 4);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(8, 2); ctx.lineTo(14, 2); ctx.lineTo(12, 8); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** Repair cursor (arrow + small wrench). */
function _drawRepair(ctx: CanvasRenderingContext2D): void {
  _drawArrow(ctx, '#ffffff');
  ctx.save();
  ctx.translate(17, 17);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 10); ctx.lineTo(8, 2);
  ctx.stroke();
  ctx.strokeStyle = '#ffcc00';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 10); ctx.lineTo(8, 2);
  ctx.stroke();
  ctx.fillStyle = '#ffcc00';
  ctx.beginPath();
  ctx.arc(9, 1, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

/** Forbidden cursor (red circle + slash). */
function _drawForbidden(ctx: CanvasRenderingContext2D): void {
  const cx = CURSOR_HALF;
  const cy = CURSOR_HALF;
  const r = 10;

  ctx.strokeStyle = '#000';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#ff4444';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();

  const cos45 = r * 0.707;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(cx - cos45, cy - cos45);
  ctx.lineTo(cx + cos45, cy + cos45);
  ctx.stroke();
  ctx.strokeStyle = '#ff4444';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(cx - cos45, cy - cos45);
  ctx.lineTo(cx + cos45, cy + cos45);
  ctx.stroke();
}

/** Rally cursor (arrow + small flag). */
function _drawRally(ctx: CanvasRenderingContext2D): void {
  _drawArrow(ctx, '#ffffff');
  ctx.save();
  ctx.translate(18, 14);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(0, 14);
  ctx.stroke();
  ctx.strokeStyle = '#ffcc44';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(0, 14);
  ctx.stroke();
  ctx.fillStyle = '#ffcc44';
  ctx.beginPath();
  ctx.moveTo(1, 0); ctx.lineTo(10, 3); ctx.lineTo(1, 6); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function _generateCursorDataUrl(state: CursorState): string | null {
  const made = _createCanvas();
  if (!made) return null;
  const [canvas, ctx] = made;

  switch (state) {
    case 'normal':
      return null;
    case 'attack':
      _drawArrow(ctx, '#ff4444');
      return canvas.toDataURL();
    case 'attack_move':
      _drawCrosshair(ctx, '#ffcc00');
      return canvas.toDataURL();
    case 'attack_move_enemy':
      _drawCrosshair(ctx, '#ff4444');
      return canvas.toDataURL();
    case 'attack_move_ally':
      _drawCrosshair(ctx, '#00ff88');
      return canvas.toDataURL();
    case 'ability':
      _drawCrosshair(ctx, '#8888ff');
      return canvas.toDataURL();
    case 'ability_enemy':
      _drawCrosshair(ctx, '#ff4444');
      return canvas.toDataURL();
    case 'ability_ally':
      _drawCrosshair(ctx, '#00ff88');
      return canvas.toDataURL();
    case 'harvest':
      _drawHarvest(ctx, '#66ccff');
      return canvas.toDataURL();
    case 'harvest_gas':
      _drawHarvest(ctx, '#66ff88');
      return canvas.toDataURL();
    case 'rally':
      _drawRally(ctx);
      return canvas.toDataURL();
    case 'repair':
      _drawRepair(ctx);
      return canvas.toDataURL();
    case 'forbidden':
      _drawForbidden(ctx);
      return canvas.toDataURL();
    case 'patrol':
      _drawArrow(ctx, '#88ccff');
      return canvas.toDataURL();
    case 'ally':
      _drawArrow(ctx, '#00ff88');
      return canvas.toDataURL();
    case 'neutral':
      _drawArrow(ctx, '#ffcc00');
      return canvas.toDataURL();
    case 'build':
    case 'land':
      return null; // hide system cursor (a ground ghost is shown instead)
    default:
      return null;
  }
}

function _getCssCursor(state: CursorState): string {
  if (state === 'build' || state === 'land') return 'none';
  if (state === 'normal') return 'default';

  let dataUrl = _cursorCache.get(state);
  if (!dataUrl) {
    const url = _generateCursorDataUrl(state);
    if (!url) return 'default';
    dataUrl = url;
    _cursorCache.set(state, dataUrl);
  }

  const isCentered =
    state === 'attack_move' || state === 'attack_move_enemy' || state === 'attack_move_ally' ||
    state === 'ability' || state === 'ability_enemy' || state === 'ability_ally' ||
    state === 'forbidden';
  const hotX = isCentered ? CURSOR_HALF : 2;
  const hotY = isCentered ? CURSOR_HALF : 1;

  return `url(${dataUrl}) ${hotX} ${hotY}, auto`;
}

/**
 * SC2-style cursor manager. Mode cursor (set by the active interaction mode)
 * overrides the per-frame hover cursor. DOM-guarded throughout.
 */
export class CursorManager {
  private _modeState: CursorState | null = null;
  private _hoverState: CursorState = 'normal';
  private _renderedState: CursorState = 'normal';

  constructor() {
    if (!_hasDom()) return;
    const overlay = document.getElementById('cursor-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  /** Enter an interaction mode (build / attack-move / rally / ability / land / repair). */
  setMode(state: CursorState): void {
    this._modeState = state;
    this._apply();
  }

  /** Leave the interaction mode; cursor reverts to hover-driven. */
  clearMode(): void {
    this._modeState = null;
    this._apply();
  }

  get mode(): CursorState | null {
    return this._modeState;
  }

  /** Set the per-frame hover cursor (driven by what the pointer is over). */
  setHover(state: CursorState): void {
    this._hoverState = state;
    this._apply();
  }

  get state(): CursorState {
    return this._renderedState;
  }

  reset(): void {
    this._modeState = null;
    this._hoverState = 'normal';
    this._apply();
  }

  dispose(): void {
    this.reset();
  }

  private _apply(): void {
    const finalState = this._modeState ?? this._hoverState;
    if (this._renderedState === finalState) return;
    this._renderedState = finalState;
    if (!_hasDom()) return;
    document.body.style.cursor = _getCssCursor(finalState);
  }
}
