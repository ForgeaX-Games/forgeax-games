// On-screen UI overlay for the Cow-Level Survivor.
//
// AGENTS.md's "no HTML" rule targets building the GAME as raw HTML/canvas; a
// deliberate HUD overlay (HP / XP / weapon icons / score / view toggle / float
// text) is the established exception — apps/hello/fxaa uses a DOM HUD the same
// way. Gameplay/render stays pure ECS; this only paints absolutely-positioned
// elements over the engine canvas + forwards a toggle click.

export type ViewMode = 'topdown' | 'fps';

export interface FloatStyle {
  color: string;        // CSS color
  size: number;         // px
  weight: number;       // 700 / 900
  glow?: string;        // CSS color for shadow glow
  duration?: number;    // ms (default 900)
  rotate?: number;      // deg
}

export interface WeaponIconState {
  icon: string;         // emoji
  level: number;        // 1..5
  cooldownPct: number;  // 0..1 (0 = ready, 1 = full cd)
}

export interface HudHandle {
  setScore(n: number): void;
  setMode(mode: ViewMode): void;
  setLockStatus(text: string): void;
  setHp(cur: number, max: number): void;
  setLevel(level: number, xpCur: number, xpMax: number): void;
  setTimer(seconds: number): void;
  setKills(n: number): void;
  /** Stage chip in the stat row: (2, '暗 夜 墓 园') → 「第2关 暗夜墓园」. */
  setStage(n: number, name: string): void;
  setWeapons(states: WeaponIconState[]): void;
  setCombo(n: number): void;
  /** Float a brief popup at canvas-local screen pos (px). */
  floatScore(text: string, screenX: number, screenY: number, style?: Partial<FloatStyle>): void;
  /** Big centered banner that fades after `ms`. */
  banner(text: string, color: string, ms?: number): void;
  /** Brief red flash overlay (player damage). */
  damageFlash(): void;
  dispose(): void;
}

const HUD_ID = 'forgeax-game-hud';

export function installHud(opts: { initialMode: ViewMode; onToggle: () => void; mount?: HTMLElement }): HudHandle {
  // Mount into the host-controlled UI container (removed wholesale on ■ Stop)
  // when provided; fall back to <body> for standalone/legacy callers.
  const mount = opts.mount ?? document.body;
  document.getElementById(HUD_ID)?.remove();

  const root = document.createElement('div');
  root.id = HUD_ID;
  Object.assign(root.style, {
    position: 'fixed', inset: '0', zIndex: '50', pointerEvents: 'none',
    font: "600 14px ui-sans-serif, system-ui, sans-serif", color: '#fff',
    userSelect: 'none',
  } as CSSStyleDeclaration);

  // ── single-shot CSS keyframes (idempotent across HMR) ─────────────────────
  if (!document.getElementById('forgeax-popup-style')) {
    const s = document.createElement('style');
    s.id = 'forgeax-popup-style';
    s.textContent = `
      @keyframes forgeax-popup-rise {
        0%   { opacity: 1; transform: translate(-50%, -100%) scale(1.15); }
        15%  { opacity: 1; transform: translate(-50%, -130%) scale(1.0); }
        100% { opacity: 0; transform: translate(-50%, -260%) scale(0.85); }
      }
      @keyframes forgeax-popup-shake {
        0%,100% { transform: translate(-50%,-100%) scale(1) rotate(0deg); opacity:1; }
        20%     { transform: translate(-50%,-130%) scale(1.3) rotate(-5deg); opacity:1; }
        40%     { transform: translate(-50%,-150%) scale(1.1) rotate(4deg); opacity:1; }
        60%     { transform: translate(-50%,-180%) scale(1.05) rotate(-2deg); opacity:0.9; }
        100%    { transform: translate(-50%,-260%) scale(0.9) rotate(0deg); opacity:0; }
      }
      @keyframes forgeax-banner-in {
        0%   { opacity:0; transform: translate(-50%,-50%) scale(0.6); }
        20%  { opacity:1; transform: translate(-50%,-50%) scale(1.15); }
        40%  { opacity:1; transform: translate(-50%,-50%) scale(0.95); }
        60%  { opacity:1; transform: translate(-50%,-50%) scale(1.0); }
        100% { opacity:0; transform: translate(-50%,-50%) scale(1.1); }
      }
      @keyframes forgeax-damage-flash {
        0%   { opacity:0; }
        20%  { opacity:0.65; }
        100% { opacity:0; }
      }
      @keyframes forgeax-combo-pulse {
        0% { transform: scale(0.7); opacity: 0; }
        30% { transform: scale(1.2); opacity: 1; }
        100% { transform: scale(1.0); opacity: 1; }
      }
    `;
    document.head.appendChild(s);
  }

  // ── top-left: HP bar + XP bar + level + score + kills/timer ───────────────
  const tl = document.createElement('div');
  Object.assign(tl.style, {
    position: 'absolute', top: '12px', left: '14px',
    minWidth: '240px',
    padding: '10px 14px', borderRadius: '10px',
    background: 'linear-gradient(180deg, rgba(20,15,30,0.78), rgba(10,5,18,0.78))',
    border: '1px solid rgba(180,140,220,0.3)',
    boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
  } as CSSStyleDeclaration);

  const hpRow = document.createElement('div');
  hpRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
  const hpLbl = document.createElement('span');
  hpLbl.textContent = 'HP';
  hpLbl.style.cssText = 'font-size:11px;color:#ff8888;letter-spacing:1px;width:24px;';
  const hpBar = document.createElement('div');
  hpBar.style.cssText = 'flex:1;height:14px;background:rgba(60,20,30,0.7);border-radius:7px;overflow:hidden;border:1px solid rgba(255,80,80,0.4);';
  const hpFill = document.createElement('div');
  hpFill.style.cssText = 'height:100%;width:100%;background:linear-gradient(90deg,#ff5050,#ff9070);transition:width 0.15s;';
  hpBar.appendChild(hpFill);
  const hpTxt = document.createElement('span');
  hpTxt.style.cssText = 'font-size:12px;color:#ffd0d0;min-width:54px;text-align:right;font-variant-numeric:tabular-nums;';
  hpRow.append(hpLbl, hpBar, hpTxt);

  const xpRow = document.createElement('div');
  xpRow.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:6px;';
  const lvLbl = document.createElement('span');
  lvLbl.style.cssText = 'font-size:11px;color:#ffdd66;letter-spacing:1px;width:24px;';
  lvLbl.textContent = 'L1';
  const xpBar = document.createElement('div');
  xpBar.style.cssText = 'flex:1;height:8px;background:rgba(40,30,10,0.6);border-radius:4px;overflow:hidden;border:1px solid rgba(255,200,80,0.35);';
  const xpFill = document.createElement('div');
  xpFill.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#ffcc40,#fff080);transition:width 0.2s;';
  xpBar.appendChild(xpFill);
  const xpTxt = document.createElement('span');
  xpTxt.style.cssText = 'font-size:11px;color:#ffe098;min-width:54px;text-align:right;font-variant-numeric:tabular-nums;';
  xpRow.append(lvLbl, xpBar, xpTxt);

  const statRow = document.createElement('div');
  statRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#ddd;gap:10px;';
  const stageEl = document.createElement('span');
  stageEl.style.cssText = 'color:#c8a8ff;font-weight:700;white-space:nowrap;';
  const scoreEl = document.createElement('span');
  scoreEl.style.cssText = 'color:#ffec80;font-weight:700;';
  const killsEl = document.createElement('span');
  killsEl.style.cssText = 'color:#ff9090;';
  const timerEl = document.createElement('span');
  timerEl.style.cssText = 'color:#bbf;font-variant-numeric:tabular-nums;';
  statRow.append(stageEl, scoreEl, killsEl, timerEl);

  tl.append(hpRow, xpRow, statRow);

  // ── top-right: view-mode toggle + weapon bar ───────────────────────────────
  const tr = document.createElement('div');
  Object.assign(tr.style, {
    position: 'absolute', top: '12px', right: '14px',
    display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end',
  } as CSSStyleDeclaration);

  const btn = document.createElement('button');
  Object.assign(btn.style, {
    padding: '6px 12px',
    background: 'rgba(20,28,48,0.78)', color: '#fff', border: '1px solid rgba(255,255,255,0.25)',
    borderRadius: '8px', cursor: 'pointer', pointerEvents: 'auto', font: 'inherit',
    backdropFilter: 'blur(4px)',
  } as CSSStyleDeclaration);
  btn.addEventListener('click', (e) => { e.preventDefault(); opts.onToggle(); });
  btn.addEventListener('mouseenter', () => { btn.style.background = 'rgba(40,52,84,0.9)'; });
  btn.addEventListener('mouseleave', () => { btn.style.background = 'rgba(20,28,48,0.78)'; });

  const weaponBar = document.createElement('div');
  weaponBar.style.cssText = 'display:flex;gap:6px;';

  tr.append(btn, weaponBar);

  // ── center: combo counter (right side) + banner (center) ──────────────────
  const combo = document.createElement('div');
  Object.assign(combo.style, {
    position: 'absolute', top: '40%', right: '18px',
    color: '#ff8050', font: '900 36px ui-sans-serif, system-ui',
    textShadow: '0 0 16px rgba(255,120,40,0.7), 0 4px 10px rgba(0,0,0,0.5)',
    letterSpacing: '2px', display: 'none',
    transition: 'opacity 0.4s',
  } as CSSStyleDeclaration);

  const banner = document.createElement('div');
  Object.assign(banner.style, {
    position: 'absolute', left: '50%', top: '50%',
    transform: 'translate(-50%,-50%)',
    color: '#ffd066', font: '900 64px ui-sans-serif, system-ui',
    textShadow: '0 0 28px rgba(255,180,60,0.9), 0 4px 12px rgba(0,0,0,0.6)',
    letterSpacing: '4px', pointerEvents: 'none',
    display: 'none',
  } as CSSStyleDeclaration);

  // ── center: crosshair (FPS only) ──────────────────────────────────────────
  const cross = document.createElement('div');
  Object.assign(cross.style, {
    position: 'absolute', left: '50%', top: '50%', width: '18px', height: '18px',
    transform: 'translate(-50%,-50%)', display: 'none',
  } as CSSStyleDeclaration);
  cross.innerHTML =
    '<div style="position:absolute;left:50%;top:0;width:2px;height:100%;transform:translateX(-50%);background:rgba(255,255,255,0.85)"></div>' +
    '<div style="position:absolute;top:50%;left:0;height:2px;width:100%;transform:translateY(-50%);background:rgba(255,255,255,0.85)"></div>';

  // ── bottom-center: control hint ───────────────────────────────────────────
  const hint = document.createElement('div');
  Object.assign(hint.style, {
    position: 'absolute', bottom: '12px', left: '50%', transform: 'translateX(-50%)',
    padding: '4px 12px', background: 'rgba(0,0,0,0.4)', borderRadius: '8px',
    font: '500 12px ui-sans-serif, system-ui, sans-serif', opacity: '0.85', whiteSpace: 'nowrap',
  } as CSSStyleDeclaration);

  // ── lock status (FPS only) ────────────────────────────────────────────────
  const lockStatus = document.createElement('div');
  Object.assign(lockStatus.style, {
    position: 'absolute', bottom: '40px', left: '50%', transform: 'translateX(-50%)',
    padding: '3px 10px', background: 'rgba(0,0,0,0.5)', borderRadius: '6px',
    font: '500 11px ui-sans-serif, system-ui, sans-serif',
    color: '#ffd', display: 'none', whiteSpace: 'nowrap',
  } as CSSStyleDeclaration);

  // ── damage flash overlay (full-screen red) ────────────────────────────────
  const dmgFlash = document.createElement('div');
  Object.assign(dmgFlash.style, {
    position: 'absolute', inset: '0',
    background: 'radial-gradient(circle at center, transparent 40%, rgba(255,30,30,0.7) 100%)',
    opacity: '0', pointerEvents: 'none',
  } as CSSStyleDeclaration);

  // ── popup container ───────────────────────────────────────────────────────
  const popups = document.createElement('div');
  Object.assign(popups.style, {
    position: 'absolute', inset: '0', overflow: 'visible',
  } as CSSStyleDeclaration);

  root.append(tl, tr, combo, banner, cross, lockStatus, hint, dmgFlash, popups);
  mount.appendChild(root);

  // ── state + setters ───────────────────────────────────────────────────────
  let curMode: ViewMode = opts.initialMode;
  const applyMode = (mode: ViewMode) => {
    curMode = mode;
    btn.textContent = mode === 'fps' ? '视角: 第一人称 ▸ 顶视角' : '视角: 顶视角 ▸ 第一人称';
    cross.style.display = mode === 'fps' ? 'block' : 'none';
    lockStatus.style.display = mode === 'fps' ? 'block' : 'none';
    hint.textContent = mode === 'fps'
      ? '点击锁定鼠标 · WASD 移动 · 自动开火 · ESC 释放'
      : 'WASD 移动 · 自动锁敌开火 · 1/2/3 选升级';
  };

  const setHp = (cur: number, max: number) => {
    const p = Math.max(0, Math.min(1, max > 0 ? cur / max : 0));
    hpFill.style.width = `${(p * 100).toFixed(1)}%`;
    if (p < 0.3) hpFill.style.background = 'linear-gradient(90deg,#ff2020,#ff5050)';
    else if (p < 0.6) hpFill.style.background = 'linear-gradient(90deg,#ff7030,#ffaa50)';
    else hpFill.style.background = 'linear-gradient(90deg,#50ff70,#a0ffa0)';
    hpTxt.textContent = `${Math.max(0, Math.ceil(cur))}/${Math.ceil(max)}`;
  };
  const setLevel = (level: number, xpCur: number, xpMax: number) => {
    lvLbl.textContent = `L${level}`;
    const p = Math.max(0, Math.min(1, xpMax > 0 ? xpCur / xpMax : 0));
    xpFill.style.width = `${(p * 100).toFixed(1)}%`;
    xpTxt.textContent = `${Math.floor(xpCur)}/${xpMax}`;
  };
  const setScore = (n: number) => { scoreEl.textContent = `★ ${n}`; };
  const setKills = (n: number) => { killsEl.textContent = `🐄 ${n}`; };
  const setStage = (n: number, name: string) => {
    stageEl.textContent = `第${n}关 ${name.replace(/\s+/g, '')}`;
  };
  const setTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    timerEl.textContent = `${m}:${s.toString().padStart(2, '0')}`;
  };
  const setLockStatus = (text: string) => { lockStatus.textContent = text; };
  const setWeapons = (states: WeaponIconState[]) => {
    weaponBar.innerHTML = '';
    for (const w of states) {
      const slot = document.createElement('div');
      slot.style.cssText = `
        position:relative;width:42px;height:42px;border-radius:8px;
        background:rgba(20,15,30,0.85);border:2px solid rgba(180,140,220,0.5);
        display:flex;align-items:center;justify-content:center;
        font-size:22px;overflow:hidden;
      `;
      slot.textContent = w.icon;
      const lvBadge = document.createElement('div');
      lvBadge.style.cssText = `
        position:absolute;bottom:-2px;right:-2px;background:#ffcc40;color:#222;
        font:700 9px ui-sans-serif,system-ui;padding:1px 4px;border-radius:6px;
      `;
      lvBadge.textContent = `L${w.level}`;
      slot.appendChild(lvBadge);
      // cooldown veil (vertical fill from top)
      if (w.cooldownPct > 0.02) {
        const veil = document.createElement('div');
        const h = (w.cooldownPct * 100).toFixed(0);
        veil.style.cssText = `position:absolute;left:0;top:0;width:100%;height:${h}%;background:rgba(0,0,0,0.55);`;
        slot.appendChild(veil);
      }
      weaponBar.appendChild(slot);
    }
  };
  const setCombo = (n: number) => {
    if (n < 3) {
      combo.style.display = 'none';
      return;
    }
    combo.style.display = 'block';
    combo.textContent = `x${n} COMBO!`;
    combo.style.animation = 'none';
    void combo.offsetWidth;     // restart anim
    combo.style.animation = 'forgeax-combo-pulse 0.4s ease-out';
    if (n >= 20) combo.style.color = '#ff40ff';
    else if (n >= 10) combo.style.color = '#ffd040';
    else combo.style.color = '#ff8050';
  };

  const floatScore = (text: string, sx: number, sy: number, style?: Partial<FloatStyle>) => {
    const s: FloatStyle = {
      color: '#ffec80', size: 22, weight: 700,
      glow: 'rgba(255,200,80,0.5)', duration: 900, rotate: 0,
      ...style,
    };
    const p = document.createElement('div');
    p.textContent = text;
    Object.assign(p.style, {
      position: 'absolute',
      left: `${sx}px`, top: `${sy}px`,
      transform: `translate(-50%, -100%) rotate(${s.rotate}deg)`,
      color: s.color,
      font: `${s.weight} ${s.size}px ui-sans-serif, system-ui, sans-serif`,
      textShadow: `0 2px 4px rgba(0,0,0,0.85), 0 0 14px ${s.glow}`,
      whiteSpace: 'nowrap', pointerEvents: 'none',
      animation: `${(style?.size ?? 22) >= 32 ? 'forgeax-popup-shake' : 'forgeax-popup-rise'} ${(s.duration ?? 900) / 1000}s ease-out forwards`,
    } as CSSStyleDeclaration);
    popups.appendChild(p);
    setTimeout(() => p.remove(), s.duration ?? 900);
  };

  let bannerTimer: number | undefined;
  const showBanner = (text: string, color: string, ms: number = 1400) => {
    banner.textContent = text;
    banner.style.color = color;
    banner.style.display = 'block';
    banner.style.animation = 'none';
    void banner.offsetWidth;
    banner.style.animation = `forgeax-banner-in ${ms / 1000}s ease-out forwards`;
    if (bannerTimer) window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => { banner.style.display = 'none'; }, ms);
  };

  const damageFlash = () => {
    dmgFlash.style.animation = 'none';
    void dmgFlash.offsetWidth;
    dmgFlash.style.animation = 'forgeax-damage-flash 0.5s ease-out';
  };

  setHp(100, 100);
  setLevel(1, 0, 10);
  setScore(0);
  setKills(0);
  setStage(1, '');
  setTimer(0);
  setWeapons([]);
  applyMode(opts.initialMode);
  setLockStatus('🖱️ 点击画面锁定鼠标');

  return {
    setScore, setMode: applyMode, setLockStatus,
    setHp, setLevel, setTimer, setKills, setStage, setWeapons, setCombo,
    floatScore, banner: showBanner, damageFlash,
    dispose: () => root.remove(),
  };
}
