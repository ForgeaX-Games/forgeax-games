// On-screen UI overlay for 星球贪吃蛇 (DOM, not ECS).
//
// The "no raw HTML" rule targets building the GAME as HTML/canvas; a thin HUD
// overlay (score / length / best + a game-over card) is the established
// exception — gameplay + rendering stay pure ECS, this only paints a few
// absolutely-positioned elements over the engine canvas.

export interface SnakeHud {
  setScore(n: number): void;
  setBest(n: number): void;
  setLength(n: number): void;
  /** Update the boost stamina bar (0..1). `cooling` dims/tints it during the post-drain lockout. */
  setBoost(ratio: number, cooling?: boolean): void;
  /**
   * Skill availability.
   *
   * This exists because two of the three skills can legitimately refuse to
   * fire — Slough needs a body worth shedding, Maelstrom needs water — and in
   * normal play both refusals were SILENT. The player pressed the key, nothing
   * happened, and there was nothing on screen to say why. Posed captures never
   * showed it because every capture set the conditions up first.
   */
  setSkills(s: { shed: boolean; coil: number; swirl: boolean; bloom: boolean; sweep: boolean }): void;
  /** Frame-time readout, toggled with P. Off by default. */
  setPerf(on: boolean, fps: number, frameMs: number, updateMs: number): void;
  /** Show the game-over card. `onRestart` fires when the button is clicked. `title` overrides the death message. */
  showGameOver(score: number, best: number, onRestart: () => void, title?: string): void;
  announce(text: string, seconds?: number): void;
  hideGameOver(): void;
  dispose(): void;
}

const HUD_ID = 'planet-snake-hud';

/**
 * Mount the HUD overlay over the engine canvas. `host` MUST be the canvas's own
 * positioned offset parent so the overlay aligns + clips to the canvas rect.
 * Idempotent: a previous overlay (e.g. after HMR) is removed first.
 */
export function installHud(opts: { host?: HTMLElement }): SnakeHud {
  document.getElementById(HUD_ID)?.remove();
  const host = opts.host ?? document.body;
  const rootAbsolute = host !== document.body;

  const root = document.createElement('div');
  root.id = HUD_ID;
  Object.assign(root.style, {
    position: rootAbsolute ? 'absolute' : 'fixed', inset: '0', zIndex: '50',
    pointerEvents: 'none',
    font: "600 15px ui-sans-serif, system-ui, sans-serif", color: '#fff',
    userSelect: 'none', overflow: 'hidden',
  } as CSSStyleDeclaration);

  // Score + length (top-left)
  const scorePanel = document.createElement('div');
  Object.assign(scorePanel.style, {
    position: 'absolute', top: '12px', left: '14px', padding: '6px 12px',
    background: 'rgba(6,12,24,0.5)', borderRadius: '10px', letterSpacing: '0.5px',
    textShadow: '0 1px 2px rgba(0,0,0,0.6)', lineHeight: '1.5',
    border: '1px solid rgba(120,220,160,0.25)',
  } as CSSStyleDeclaration);

  const scoreLine = document.createElement('div');
  const lengthLine = document.createElement('div');
  Object.assign(lengthLine.style, { font: '500 12px ui-sans-serif, system-ui, sans-serif', opacity: '0.85' } as CSSStyleDeclaration);
  scorePanel.append(scoreLine, lengthLine);

  // Best (top-right)
  const bestPanel = document.createElement('div');
  Object.assign(bestPanel.style, {
    position: 'absolute', top: '12px', right: '14px', padding: '6px 12px',
    background: 'rgba(6,12,24,0.5)', borderRadius: '10px', letterSpacing: '0.5px',
    textShadow: '0 1px 2px rgba(0,0,0,0.6)',
    border: '1px solid rgba(255,200,120,0.25)', color: '#ffe9b0',
  } as CSSStyleDeclaration);

  // Control hint (bottom-center)
  const hint = document.createElement('div');
  Object.assign(hint.style, {
    position: 'absolute', bottom: '12px', left: '50%', transform: 'translateX(-50%)',
    padding: '5px 14px', background: 'rgba(6,12,24,0.45)', borderRadius: '10px',
    font: '500 12px ui-sans-serif, system-ui, sans-serif', opacity: '0.9', whiteSpace: 'nowrap',
  } as CSSStyleDeclaration);
  hint.textContent = 'A / D 转向 · Shift 加速 · Q 蛇蜕 · 空格 突刺 · E 蛇灵 · F 涌泉(限水面) · C 裂地 · P 帧率';

  // ── skill chips (bottom-centre, above the bar) ──────────────────────────
  // Five chips, one per skill. Dim = the skill would refuse right now, and the
  // chip says on what condition, so a refusal is never a mystery.
  const chips = document.createElement('div');
  Object.assign(chips.style, {
    position: 'absolute', left: '50%', bottom: '74px', transform: 'translateX(-50%)',
    display: 'flex', gap: '8px', pointerEvents: 'none',
  } as CSSStyleDeclaration);
  const mkChip = (key: string, name: string) => {
    const c = document.createElement('div');
    Object.assign(c.style, {
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '3px 10px', borderRadius: '999px',
      background: 'rgba(10,16,28,.55)', border: '1px solid rgba(255,255,255,.14)',
      font: "600 12px ui-sans-serif, system-ui, sans-serif",
      transition: 'opacity .18s, border-color .18s',
    } as CSSStyleDeclaration);
    const k = document.createElement('span');
    k.textContent = key;
    Object.assign(k.style, { opacity: '.75', letterSpacing: '.02em' } as CSSStyleDeclaration);
    const n = document.createElement('span');
    n.textContent = name;
    const fill = document.createElement('span');
    Object.assign(fill.style, {
      width: '0%', height: '3px', borderRadius: '2px', background: '#7fe3c0',
      transition: 'width .06s linear', alignSelf: 'center',
    } as CSSStyleDeclaration);
    c.append(k, n, fill);
    chips.append(c);
    return { c, fill };
  };
  const chipShed = mkChip('Q', '蛇蜕');
  const chipCoil = mkChip('␣', '突刺');
  const chipSwirl = mkChip('E', '蛇灵');
  const chipBloom = mkChip('F', '涌泉');
  const chipSweep = mkChip('C', '裂地');

  // ── perf readout (P) ────────────────────────────────────────────────────
  // Exists because the frame rate CANNOT be measured from outside this window.
  // A Chrome window that is not frontmost gets its rAF throttled — the other
  // page open in this browser measured 0.3 fps while reporting hidden:false —
  // and every capture this project takes is driven from a background tab. The
  // number that matters is the one on screen while someone is actually playing,
  // so it has to be shown there.
  const perf = document.createElement('div');
  Object.assign(perf.style, {
    position: 'absolute', top: '10px', left: '50%', transform: 'translateX(-50%)',
    padding: '4px 10px', borderRadius: '7px', display: 'none',
    background: 'rgba(6,12,24,0.72)', border: '1px solid rgba(120,200,255,0.28)',
    color: '#cfe8ff', font: '600 12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
    letterSpacing: '.02em', whiteSpace: 'pre', pointerEvents: 'none',
  } as CSSStyleDeclaration);
  root.append(perf);
  const setPerf = (on: boolean, fps: number, frameMs: number, updateMs: number) => {
    perf.style.display = on ? 'block' : 'none';
    if (!on) return;
    // Both halves, because they answer different questions: the frame time says
    // what the player gets, and the update time says how much of it is ours.
    perf.textContent = `${fps.toFixed(0)} fps   frame ${frameMs.toFixed(1)}ms   game ${updateMs.toFixed(1)}ms`;
  };

  const setSkills = (st: { shed: boolean; coil: number; swirl: boolean; bloom: boolean; sweep: boolean }) => {
    for (const [chip, ok] of [[chipShed, st.shed], [chipSwirl, st.swirl], [chipBloom, st.bloom], [chipSweep, st.sweep]] as const) {
      chip.c.style.opacity = ok ? '1' : '.34';
      chip.c.style.borderColor = ok ? 'rgba(127,227,192,.55)' : 'rgba(255,255,255,.10)';
    }
    // The coil chip fills as the charge builds, so the wind-up is legible before
    // the body has visibly wound.
    chipCoil.c.style.opacity = st.coil > 0 ? '1' : '.7';
    chipCoil.c.style.borderColor = st.coil > 0 ? 'rgba(127,227,192,.55)' : 'rgba(255,255,255,.14)';
    chipCoil.fill.style.width = `${Math.round(st.coil * 34)}px`;
  };

  // Boost stamina bar (bottom-center, just above the hint)
  const boostWrap = document.createElement('div');
  Object.assign(boostWrap.style, {
    position: 'absolute', bottom: '40px', left: '50%', transform: 'translateX(-50%)',
    width: '170px', height: '7px', borderRadius: '5px',
    background: 'rgba(6,12,24,0.5)', border: '1px solid rgba(120,200,255,0.3)',
    overflow: 'hidden',
  } as CSSStyleDeclaration);
  const boostFill = document.createElement('div');
  Object.assign(boostFill.style, {
    width: '100%', height: '100%', transformOrigin: 'left center',
    background: 'linear-gradient(90deg,#5ad0ff,#7affd0)',
  } as CSSStyleDeclaration);
  boostWrap.appendChild(boostFill);

  // Game-over card (center, hidden by default)
  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'absolute', inset: '0', display: 'none',
    alignItems: 'center', justifyContent: 'center',
    background: 'rgba(4,8,18,0.55)', pointerEvents: 'auto',
  } as CSSStyleDeclaration);

  const card = document.createElement('div');
  Object.assign(card.style, {
    minWidth: '260px', padding: '26px 30px', textAlign: 'center',
    background: 'rgba(14,22,40,0.94)', borderRadius: '18px',
    border: '1px solid rgba(120,220,160,0.35)',
    boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
  } as CSSStyleDeclaration);

  const overTitle = document.createElement('div');
  overTitle.textContent = '🐍 撞到自己啦~';
  Object.assign(overTitle.style, { font: '700 22px ui-sans-serif, system-ui, sans-serif', marginBottom: '10px' } as CSSStyleDeclaration);

  const overScore = document.createElement('div');
  Object.assign(overScore.style, { font: '500 15px ui-sans-serif, system-ui, sans-serif', opacity: '0.9', lineHeight: '1.7', marginBottom: '18px' } as CSSStyleDeclaration);

  const btn = document.createElement('button');
  btn.textContent = '再来一次 ▸ (R)';
  Object.assign(btn.style, {
    padding: '10px 22px', font: '600 15px ui-sans-serif, system-ui, sans-serif',
    color: '#04220f', background: 'linear-gradient(180deg,#8fe6a8,#54c878)',
    border: 'none', borderRadius: '12px', cursor: 'pointer',
    boxShadow: '0 4px 14px rgba(84,200,120,0.4)',
  } as CSSStyleDeclaration);
  card.append(overTitle, overScore, btn);
  overlay.appendChild(card);

  root.append(scorePanel, bestPanel, hint, chips, boostWrap, overlay);
  host.appendChild(root);

  const setScore = (n: number) => { scoreLine.textContent = `得分  ${n}`; };
  const setBest = (n: number) => { bestPanel.textContent = `最高  ${n}`; };
  const setLength = (n: number) => { lengthLine.textContent = `长度  ${n}`; };
  const setBoost = (ratio: number, cooling = false) => {
    const r = Math.max(0, Math.min(1, ratio));
    boostFill.style.transform = `scaleX(${r})`;
    // During the cooldown lockout paint it amber so the player knows why Shift
    // stopped working; otherwise the usual cyan gradient.
    boostFill.style.background = cooling
      ? 'linear-gradient(90deg,#ff9a3c,#ffcf6b)'
      : 'linear-gradient(90deg,#5ad0ff,#7affd0)';
    boostFill.style.opacity = cooling ? '0.75' : r < 0.15 ? '0.4' : '1';
  };

  let restartHandler: (() => void) | null = null;
  const onClick = () => { restartHandler?.(); };
  btn.addEventListener('click', (e) => { e.preventDefault(); onClick(); btn.blur(); });

  const showGameOver = (score: number, best: number, onRestart: () => void, title?: string) => {
    restartHandler = onRestart;
    if (title) overTitle.textContent = title;
    overScore.innerHTML = `本局得分 <b style="color:#8fe6a8">${score}</b><br/>历史最高 <b style="color:#ffe9b0">${best}</b>`;
    overlay.style.display = 'flex';
  };
  const hideGameOver = () => { overlay.style.display = 'none'; };

  setScore(0);
  setBest(0);
  setLength(4);

  const announce = (text: string, seconds = 3) => {
    const banner = document.createElement('div');
    banner.textContent = text;
    Object.assign(banner.style, {
      position: 'absolute',
      left: '50%',
      top: '28%',
      transform: 'translate(-50%, -50%) scale(0.94)',
      maxWidth: '90%',
      color: '#c02020',
      fontSize: '34px',
      fontWeight: '900',
      letterSpacing: '0.08em',
      textAlign: 'center',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      zIndex: '100',
      opacity: '0',
      textShadow: [
        '-2px -2px 0 #180606',
        '2px -2px 0 #180606',
        '-2px 2px 0 #180606',
        '2px 2px 0 #180606',
        '0 4px 12px rgba(0,0,0,0.95)',
        '0 0 24px rgba(192,32,32,0.65)',
      ].join(','),
      transition: 'opacity 320ms ease, transform 420ms ease',
    });
    root.appendChild(banner);

    requestAnimationFrame(() => {
      banner.style.opacity = '1';
      banner.style.transform = 'translate(-50%, -50%) scale(1)';
    });

    const durationMs = Math.max(600, seconds * 1000);
    const fadeMs = Math.min(500, durationMs * 0.2);
    window.setTimeout(() => {
      banner.style.opacity = '0';
      banner.style.transform = 'translate(-50%, -50%) scale(1.04)';
    }, durationMs - fadeMs);
    window.setTimeout(() => banner.remove(), durationMs);
  };

  return {
    setScore, setBest, setLength, setBoost, setSkills, setPerf, showGameOver, hideGameOver,
    announce,
    dispose: () => root.remove(),
  };
}
