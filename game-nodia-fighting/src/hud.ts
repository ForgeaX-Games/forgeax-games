// On-screen UI overlay for the game template (DOM, not ECS).
//
// AGENTS.md's "no HTML" rule targets building the GAME as raw HTML/canvas; a
// deliberate HUD overlay (score + view-mode toggle + crosshair) is the
// established exception — apps/hello/fxaa uses a DOM HUD the same way. The
// gameplay/render stays pure ECS; this only paints a few absolutely-positioned
// elements over the engine canvas and forwards a toggle click.

export type ViewMode = 'topdown' | 'fps';

export interface HudHandle {
  setScore(n: number): void;
  setMode(mode: ViewMode): void;
  setLockStatus(text: string): void;   // diagnostic line: shows lock state / errors
  /**
   * Float a brief "+N" score popup at the given canvas-local screen position
   * (CSS pixels). Replaces the world-space GlyphText popup that the engine's
   * shadow caster pass projected as a visible ground shadow (bug-20260610-
   * glyph-mesh-cannot-opt-out-shadow-caster). DOM-only -> never enters the
   * 3D shadow pass.
   */
  floatScore(text: string, screenX: number, screenY: number): void;
  dispose(): void;
}

const HUD_ID = 'forgeax-game-hud';

/**
 * Mount the HUD overlay over the engine canvas. Returns handles to update the
 * score / current mode. Idempotent: a previous overlay (e.g. after HMR) is
 * removed first so HUDs never stack.
 */
export function installHud(opts: { initialMode: ViewMode; onToggle: () => void }): HudHandle {
  document.getElementById(HUD_ID)?.remove();

  const root = document.createElement('div');
  root.id = HUD_ID;
  Object.assign(root.style, {
    position: 'fixed', inset: '0', zIndex: '50', pointerEvents: 'none',
    font: "600 14px ui-sans-serif, system-ui, sans-serif", color: '#fff',
    userSelect: 'none',
  } as CSSStyleDeclaration);

  // Score (top-left)
  const score = document.createElement('div');
  Object.assign(score.style, {
    position: 'absolute', top: '12px', left: '14px', padding: '4px 10px',
    background: 'rgba(0,0,0,0.45)', borderRadius: '8px', letterSpacing: '0.5px',
    textShadow: '0 1px 2px rgba(0,0,0,0.6)',
  } as CSSStyleDeclaration);

  // View-mode toggle button (top-right)
  const btn = document.createElement('button');
  Object.assign(btn.style, {
    position: 'absolute', top: '12px', right: '14px', padding: '6px 12px',
    background: 'rgba(20,28,48,0.78)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: '8px', cursor: 'pointer', pointerEvents: 'auto', font: 'inherit',
    backdropFilter: 'blur(4px)',
  } as CSSStyleDeclaration);
  btn.addEventListener('click', (e) => { e.preventDefault(); opts.onToggle(); });
  btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(40,52,84,0.9)'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(20,28,48,0.78)'; });

  // Crosshair (center, FPS only)
  const cross = document.createElement('div');
  Object.assign(cross.style, {
    position: 'absolute', left: '50%', top: '50%', width: '18px', height: '18px',
    transform: 'translate(-50%,-50%)', display: 'none', pointerEvents: 'none',
  } as CSSStyleDeclaration);
  cross.innerHTML =
    '<div style="position:absolute;left:50%;top:0;width:2px;height:100%;transform:translateX(-50%);background:rgba(255,255,255,0.85)"></div>' +
    '<div style="position:absolute;top:50%;left:0;height:2px;width:100%;transform:translateY(-50%);background:rgba(255,255,255,0.85)"></div>';

  // Control hint (bottom-center)
  const hint = document.createElement('div');
  Object.assign(hint.style, {
    position: 'absolute', bottom: '12px', left: '50%', transform: 'translateX(-50%)',
    padding: '4px 12px', background: 'rgba(0,0,0,0.4)', borderRadius: '8px',
    font: '500 12px ui-sans-serif, system-ui, sans-serif', opacity: '0.85', whiteSpace: 'nowrap',
  } as CSSStyleDeclaration);

  // Lock-status diagnostic (top-left, below score). Visible only in FPS mode.
  // Shows current pointer-lock state + the latest error reason if any. Lets the
  // user see at a glance whether clicking the canvas engaged the lock.
  const lockStatus = document.createElement('div');
  Object.assign(lockStatus.style, {
    position: 'absolute', top: '46px', left: '14px', padding: '3px 10px',
    background: 'rgba(0,0,0,0.5)', borderRadius: '6px',
    font: '500 11px ui-sans-serif, system-ui, sans-serif',
    color: '#ffd', display: 'none', maxWidth: '60vw', whiteSpace: 'nowrap',
    overflow: 'hidden', textOverflow: 'ellipsis',
  } as CSSStyleDeclaration);

  // Popup container: holds short-lived "+N" score-pop divs anchored at the
  // canvas-projected screen coords of each hit. Positioned absolutely so its
  // children inherit (left, top) directly from caller-provided pixels.
  const popups = document.createElement('div');
  Object.assign(popups.style, {
    position: 'absolute', inset: '0', overflow: 'visible', pointerEvents: 'none',
  } as CSSStyleDeclaration);

  // CSS keyframes for the popup rise/fade. Singleton style tag so HMR remounts
  // don't accumulate duplicates (the HUD root remount above already handles
  // its own dedupe; this one survives across mounts because it's in <head>).
  if (!document.getElementById('forgeax-popup-style')) {
    const s = document.createElement('style');
    s.id = 'forgeax-popup-style';
    s.textContent = `@keyframes forgeax-popup-rise {
      0%   { opacity: 1; transform: translate(-50%, -100%) scale(1.1); }
      20%  { opacity: 1; transform: translate(-50%, -120%) scale(1.0); }
      100% { opacity: 0; transform: translate(-50%, -220%) scale(0.9); }
    }`;
    document.head.appendChild(s);
  }

  root.append(score, btn, cross, hint, lockStatus, popups);
  document.body.appendChild(root);

  const applyMode = (mode: ViewMode) => {
    btn.textContent = mode === 'fps' ? '视角: 第一人称 ▸ 切顶视角' : '视角: 顶视角 ▸ 切第一人称';
    cross.style.display = mode === 'fps' ? 'block' : 'none';
    lockStatus.style.display = mode === 'fps' ? 'block' : 'none';
    hint.textContent = mode === 'fps'
      ? '点击画面锁定鼠标 · WASD 移动 · 鼠标转视角 · F/点击 射击 · ESC 释放'
      : 'WASD 移动 · 点击射击 · 角色朝点击方向开炮';
  };

  const setScore = (n: number) => { score.textContent = `得分  ${n}`; };
  const setLockStatus = (text: string) => { lockStatus.textContent = text; };
  const floatScore = (text: string, sx: number, sy: number) => {
    const p = document.createElement('div');
    p.textContent = text;
    Object.assign(p.style, {
      position: 'absolute',
      left: `${sx}px`, top: `${sy}px`,
      transform: 'translate(-50%, -100%)',
      color: '#ffec80',
      font: '700 22px ui-sans-serif, system-ui, sans-serif',
      textShadow: '0 2px 4px rgba(0,0,0,0.85), 0 0 12px rgba(255,200,80,0.4)',
      whiteSpace: 'nowrap', pointerEvents: 'none',
      animation: 'forgeax-popup-rise 1s ease-out forwards',
    } as CSSStyleDeclaration);
    popups.appendChild(p);
    setTimeout(() => p.remove(), 1000);
  };
  setScore(0);
  applyMode(opts.initialMode);
  setLockStatus('🖱️ 点击画面锁定鼠标');

  return {
    setScore,
    setMode: applyMode,
    setLockStatus,
    floatScore,
    dispose: () => root.remove(),
  };
}
