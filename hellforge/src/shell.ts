// ShellManager + Title screen — DOM-overlay front-of-game flow (SPEC §3).
//
// aidiablo has two loosely-coupled state machines (AppState + SceneManager's
// SceneType) plus multiplayer sub-states (connecting/waiting/disconnected).
// hellforge is single-player (see PLAY_EXPERIENCE.md), so this collapses to
// ONE linear state machine, no engine scene-switching:
//
//   boot → title → (newGame → charSelect | continue → charList)
//        → charCreated/charPicked → inGame
//
// Screens are `install*(mount) -> Handle` factories (hud.ts/inventory-ui.ts
// convention) with `show()/hide()` — an IScene without update() or destroy(),
// per SPEC §3.2 ("hellforge 落地": no per-scene rAF, no engine scene-switch).
// All screens mount once into ShellManager's root and stay in the DOM;
// switching = hide old, show new.

import {
  FONT_DISPLAY,
  FONT_UI,
  Ui,
  Z,
  metalGoldTextStyle,
} from './ui-theme';
import { ShellArt } from './shell-art';

export type ShellState = 'title' | 'charSelect' | 'charList' | 'inGame';

export interface ShellCallbacks {
  /** Player picked "新游戏" — go create a character. */
  onNewGame: () => void;
  /** Player picked "继续" — go to the saved-character list. */
  onContinue: () => void;
  /** Whether any saved character exists (drives Title's button set). */
  hasSave: () => boolean;
  /** Open Title settings (light / render scale / FPS) — wired to render-settings panel. */
  onSettings: () => void;
}

export interface ShellHandle {
  state(): ShellState;
  /** Programmatic transition — screens call back into this via their own callbacks. */
  goTo(state: ShellState): void;
  /** Noninteractive cover while heavy runtime boots after character selection. */
  showLoading(message: string): void;
  /**
   * Drive the DETERMINATE loading bar (0..1). Wired to a LoadTracker by the
   * caller; monotonic by tracker contract. No-op value clamping applied here.
   */
  setLoadingProgress(fraction: number): void;
  /**
   * Hide the loading cover WITHOUT a shell state change. Used by the den
   * zone-transition (we are already 'inGame'); restores the hidden shell root
   * so gameplay HUD re-owns the viewport.
   */
  hideLoading(): void;
  /** Drive Title Canvas2D particles — call from ctx.registerUpdate (SPEC §3.2). */
  tick(dt: number): void;
  root: HTMLElement;
  dispose(): void;
}

const SHELL_ID = 'hellforge-shell';
/** Shell screens fully occlude gameplay UI while shown (ui-theme Z ladder). */
const SHELL_Z = Z.shell;

/**
 * Mounts the shell root (shown/hidden as a whole) and wires Title's two
 * buttons to the caller's onNewGame/onContinue. The caller (main.ts) owns
 * actually swapping in CharSelect/CharList/inGame content via goTo() —
 * this function only builds Title and the shared shell chrome.
 */
export function installShell(mount: HTMLElement, cb: ShellCallbacks): ShellHandle {
  document.getElementById(SHELL_ID)?.remove();
  const scoped = mount !== document.body;

  // Host `#game-ui-root` is pointer-events:none (play-assemble). Never mutate
  // the host mount's inline styles — reclaim hits on this shell root +
  // interactive descendants via pointer-events:auto (child can opt back in).
  const root = document.createElement('div');
  root.id = SHELL_ID;
  root.style.cssText = `position:${scoped ? 'absolute' : 'fixed'};inset:0;z-index:${SHELL_Z};` +
    'overflow:hidden;pointer-events:auto;';
  mount.appendChild(root);

  let state: ShellState = 'title';
  const title = installTitle(root, {
    onNewGame: () => { cb.onNewGame(); },
    onContinue: () => { cb.onContinue(); },
    onSettings: () => { cb.onSettings(); },
    hasSave: cb.hasSave,
  });

  // Loading cover — D2 loading-screen language: gold Cinzel message, quiet tip
  // line, and a DETERMINATE bar (PR11 T2) whose width is driven by real load
  // completions via setLoadingProgress — no fake indeterminate sweep.
  const loading = document.createElement('div');
  loading.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;' +
    `justify-content:center;background:${Ui.ink};color:${Ui.text};pointer-events:auto;`;
  const loadingCol = document.createElement('div');
  loadingCol.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:16px;';
  const loadingMessage = document.createElement('div');
  loadingMessage.style.cssText =
    `font:700 17px ${FONT_DISPLAY};color:${Ui.goldBright};letter-spacing:6px;` +
    'text-shadow:0 0 18px rgba(230,180,90,0.45),0 2px 6px #000;';
  const loadingBar = document.createElement('div');
  loadingBar.style.cssText =
    `width:240px;height:6px;border-radius:2px;overflow:hidden;` +
    `background:${Ui.inkWell};border:1px solid ${Ui.goldLineSoft};`;
  const loadingFill = document.createElement('div');
  loadingFill.style.cssText =
    `width:0%;height:100%;border-radius:2px;` +
    `background:linear-gradient(90deg,${Ui.gold},${Ui.goldBright});` +
    'box-shadow:0 0 8px rgba(230,180,90,0.45);transition:width 160ms ease-out;';
  loadingBar.appendChild(loadingFill);
  const loadingTip = document.createElement('div');
  loadingTip.style.cssText = `font:500 12px ${FONT_UI};color:${Ui.textDim};letter-spacing:2px;`;
  loadingTip.textContent = '余烬正在重燃……';
  loadingCol.append(loadingMessage, loadingBar, loadingTip);
  loading.appendChild(loadingCol);
  root.appendChild(loading);

  function goTo(next: ShellState): void {
    loading.style.display = 'none';
    state = next;
    // inGame: drop the whole shell chrome so gameplay HUD owns the viewport.
    // charSelect/charList: keep shell.root mounted (children live here) but
    // hide Title — main.ts shows the matching screen on top.
    if (next === 'inGame') {
      title.hide();
      root.style.display = 'none';
      return;
    }
    root.style.display = '';
    if (next === 'title') { title.show(); refreshTitleButtons(); }
    else { title.hide(); }
  }

  function refreshTitleButtons(): void { title.refresh(); }

  /** Determinate fill writer — clamps to [0,1] and quantises to 0.1%. */
  const setFill = (fraction: number): void => {
    const clamped = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));
    loadingFill.style.width = `${Math.round(clamped * 1000) / 10}%`;
  };

  return {
    state: () => state,
    goTo,
    showLoading: (message) => {
      title.hide();
      root.style.display = '';
      loadingMessage.textContent = message;
      setFill(0); // fresh cover starts empty; tracker drives it up
      loading.style.display = 'flex';
    },
    setLoadingProgress: setFill,
    hideLoading: () => {
      loading.style.display = 'none';
      // In-game the shell root is display:none (goTo('inGame')) so the HUD owns
      // the viewport — restore that after a mid-game transition cover.
      if (state === 'inGame') root.style.display = 'none';
    },
    tick: (dt) => { if (state === 'title') title.tick(dt); },
    root,
    dispose: () => {
      title.dispose();
      root.remove();
    },
  };
}

// ── Title screen ────────────────────────────────────────────────────────
// Direct DOM/Canvas2D port of aidiablo's scenes/TitleScene.ts (845 lines):
// background + vignette + top/bottom fade + twin torch glows + metallic-
// gradient logo + Canvas2D ember/snow/smoke/spark particles + stone-carved
// buttons. Zero THREE.js in the source file — ports verbatim as DOM+Canvas2D.
//
// Deviations from source:
// - Background image: aidiablo's `ui/title_bg.jpg` (user-owned AI art) now
//   ported to assets/ui/title_bg.jpg and rendered with the same
//   brightness(0.55)/saturate(0.8) treatment; vignette/fades/torch-glow/
//   particles/logo/buttons unchanged.
// - Scene BGM is owned by bgm.ts (HTMLAudio phase player); shell does not
//   drive music. Button hover/click still has no dedicated click SFX here
//   (combat/UI pings live in sfx.ts's synthesized WebAudio kit).
// - No i18n `t()` — hellforge is Chinese-only (AGENTS.md language policy);
//   strings are inlined directly instead of key-lookup.
// - Settings button opens the shared render-settings panel (same LS + F10
//   panel in-game): light knobs, render scale, and FPS cap.
// - Title layout: brand block + buttons flow as ONE centered vertical flex
//   column (was absolute top:50% / calc(50%+128px)); atmosphere deepened with
//   a molten wash + ember bloom under a heavier cinematic vignette, so the
//   1280×720 / 1920×1080 first paint can neither clip buttons nor overlap
//   the subtitle (visual-polish #11; the button dock + wings now ride HudArt art).
// - No footer changelog/version row — no changelog content exists to show.
// - `resetTransition()`/`showLimitToast()` dropped: the former undoes a
//   transition-lock this port has no reason to ever get stuck in (only one
//   button triggers navigation, not several racing handlers); the latter
//   guards aidiablo's MAX_CHARACTERS cap, which is CharList's concern (§4.2),
//   not Title's.

interface TitleHandle {
  show(): void;
  hide(): void;
  /** Advance Canvas2D particles — driven by ShellHandle.tick ← registerUpdate. */
  tick(dt: number): void;
  /** Re-run the has-save check and rebuild the button row (call after returning from CharList/CharSelect). */
  refresh(): void;
  dispose(): void;
}

interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number;
  type: 'ember' | 'snow' | 'smoke' | 'spark';
  opacity: number;
}

function installTitle(
  mount: HTMLElement,
  cb: {
    onNewGame: () => void;
    onContinue: () => void;
    onSettings: () => void;
    hasSave: () => boolean;
  },
): TitleHandle {
  if (!document.getElementById('hellforge-title-style')) {
    const s = document.createElement('style');
    s.id = 'hellforge-title-style';
    s.textContent = `
      @keyframes hf-title-fade-in {
        from { opacity:0; transform:translateY(20px); }
        to   { opacity:1; transform:translateY(0); }
      }
    `;
    document.head.appendChild(s);
  }

  const root = document.createElement('div');
  root.id = 'hellforge-title';
  root.style.cssText = `
    position:absolute; inset:0; pointer-events:auto;
    background:#050404;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    font-family:${FONT_DISPLAY};
    overflow:hidden; cursor:default; animation:hf-title-fade-in 1s ease-out;
  `;

  // A2: frame-f5-3 (2048×1152, no baked UI) — brand + buttons ride DOM chrome.
  // Cache-bust rev, mirroring HudArt's HUD_ART_REV pattern: bump ?titlebg-*
  // whenever title_bg.jpg is re-exported so browsers drop the stale frame.
  const titleBgUrl = `${new URL('../assets/ui/title_bg.jpg', import.meta.url).href}?titlebg-f5-3`;
  const bgImg = document.createElement('div');
  bgImg.style.cssText = `
    position:absolute; inset:0; pointer-events:none;
    background:url('${titleBgUrl}') center/cover no-repeat;
    filter:brightness(0.88) saturate(0.95);
  `;
  root.appendChild(bgImg);

  const moltenWash = document.createElement('div');
  moltenWash.style.cssText = `
    position:absolute; inset:0; pointer-events:none;
    background:
      radial-gradient(ellipse 90% 45% at 50% 100%, rgba(196,64,20,0.18) 0%, transparent 64%),
      linear-gradient(0deg, rgba(20,8,4,0.35) 0%, transparent 30%);
  `;
  root.appendChild(moltenWash);

  const vignette = document.createElement('div');
  vignette.style.cssText = `
    position:absolute; inset:0; pointer-events:none;
    background:radial-gradient(ellipse 78% 70% at 50% 40%, transparent 0%, rgba(0,0,0,0.22) 62%, rgba(0,0,0,0.62) 100%);
  `;
  root.appendChild(vignette);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:2;';
  root.appendChild(canvas);
  const pctx = canvas.getContext('2d')!;

  // Brand mid-upper / buttons low — leave the silhouette open.
  const content = document.createElement('div');
  content.style.cssText = `
    position:absolute; inset:0; z-index:10; display:flex; flex-direction:column;
    align-items:center; justify-content:space-between;
    padding:clamp(96px,16vh,160px) 16px clamp(56px,10vh,96px);
    pointer-events:none; text-align:center;
  `;
  root.appendChild(content);

  const brand = document.createElement('div');
  brand.style.cssText = 'position:relative;display:flex;flex-direction:column;align-items:center;';
  const wordmarkWrap = document.createElement('div');
  wordmarkWrap.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:center;';
  const logoTitle = document.createElement('div');
  // metalGoldTextStyle uses background-clip:text — do NOT add text-shadow here
  // (it paints a dark slab and kills the gold fill).
  logoTitle.style.cssText = metalGoldTextStyle('clamp(46px,7vw,80px)') + 'position:relative;z-index:1;';
  logoTitle.textContent = 'HELLFORGE';
  wordmarkWrap.appendChild(logoTitle);
  brand.appendChild(wordmarkWrap);
  const logoLine = document.createElement('div');
  logoLine.style.cssText = `
    width:280px; height:1px; margin:12px auto 10px; position:relative; z-index:1;
    background:linear-gradient(90deg,transparent,${Ui.goldDeep} 18%,${Ui.goldBright} 50%,${Ui.goldDeep} 82%,transparent);
  `;
  brand.appendChild(logoLine);
  const logoSub = document.createElement('div');
  logoSub.style.cssText = `
    font-size:clamp(14px,1.8vw,17px); color:#e8d2a0; letter-spacing:6px;
    text-shadow:0 2px 6px rgba(0,0,0,0.95); font-weight:500; position:relative; z-index:1;
  `;
  logoSub.textContent = '大熔炉的余烬，正在侵蚀这片土地';
  brand.appendChild(logoSub);
  content.appendChild(brand);

  // Button column only — no S5 plaque underlay (owner: 底板去掉).
  const buttonsWrap = document.createElement('div');
  buttonsWrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:12px;' +
    'pointer-events:auto;flex:none;';
  content.appendChild(buttonsWrap);

  // S1–S3 plates are 640×225 — lock the hit box to that ratio so the art
  // never stretches (center/100% 100% is safe once aspect matches).
  const BTN_INK = '#1a1208';
  const BTN_INK_MUTED = '#2e2214';
  function ornateButton(text: string, primary: boolean, onClick: () => void): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = text;
    const face = primary ? BTN_INK : BTN_INK_MUTED;
    const plate = (state: 'idle' | 'hover' | 'pressed') =>
      state === 'hover' ? ShellArt.btnHover()
        : state === 'pressed' ? ShellArt.btnPressed()
          : ShellArt.btnIdle();
    btn.style.cssText = `
      position:relative; width:min(320px,72vw); aspect-ratio:640/225; height:auto; flex:none;
      box-sizing:border-box; padding:0; font-family:inherit;
      font-size:clamp(18px,2.1vw,22px); font-weight:${primary ? '800' : '700'};
      letter-spacing:${primary ? '8px' : '6px'}; cursor:pointer;
      pointer-events:auto; color:${face}; border:none;
      text-shadow:0 1px 0 rgba(255,244,210,0.55),0 0 1px rgba(255,244,210,0.35);
      background:url('${plate('idle')}') center/100% 100% no-repeat; background-color:transparent;
      transition:color 0.15s ease, filter 0.15s ease;
      filter:${primary ? 'none' : 'brightness(0.94) saturate(0.92)'};
    `;
    btn.addEventListener('mouseenter', () => {
      btn.style.color = BTN_INK;
      btn.style.backgroundImage = `url('${plate('hover')}')`;
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.color = face;
      btn.style.backgroundImage = `url('${plate('idle')}')`;
      btn.style.transform = '';
    });
    btn.addEventListener('mousedown', () => {
      btn.style.backgroundImage = `url('${plate('pressed')}')`;
      btn.style.transform = 'scale(0.985)';
    });
    btn.addEventListener('mouseup', () => {
      btn.style.backgroundImage = `url('${plate('hover')}')`;
      btn.style.transform = '';
    });
    btn.addEventListener('click', () => { onClick(); });
    return btn;
  }

  function rebuildButtons(): void {
    buttonsWrap.innerHTML = '';
    const hasSave = cb.hasSave();
    if (hasSave) {
      buttonsWrap.appendChild(ornateButton('继续', true, cb.onContinue));
      buttonsWrap.appendChild(ornateButton('新游戏', false, cb.onNewGame));
    } else {
      buttonsWrap.appendChild(ornateButton('开始游戏', true, cb.onNewGame));
    }
    buttonsWrap.appendChild(ornateButton('设置', false, cb.onSettings));
  }
  rebuildButtons();

  mount.appendChild(root);

  // ── particles (Canvas2D, direct port of TitleScene spawn/update/draw) ──
  // SPEC §3.2: no per-scene rAF — main.ts drives tick() via registerUpdate.
  let particles: Particle[] = [];
  let visible = false;

  function resizeCanvas(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = root.clientWidth || window.innerWidth;
    const h = root.clientHeight || window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function spawnParticles(): void {
    const w = root.clientWidth || window.innerWidth;
    const h = root.clientHeight || window.innerHeight;

    if (Math.random() < 0.35) {
      particles.push({
        x: Math.random() * w * 1.2 - w * 0.1, y: -10,
        vx: (Math.random() - 0.6) * 0.8, vy: 0.4 + Math.random() * 0.8,
        life: 0, maxLife: 300 + Math.random() * 400,
        size: 1 + Math.random() * 2.5, type: 'snow', opacity: 0.15 + Math.random() * 0.35,
      });
    }
    if (Math.random() < 0.24) {
      const side = Math.random() < 0.5;
      const baseX = side ? w * 0.18 : w * 0.82;
      particles.push({
        x: baseX + (Math.random() - 0.5) * 96, y: h * 0.35 + Math.random() * 40,
        vx: (Math.random() - 0.5) * 1.5, vy: -(1 + Math.random() * 2.5),
        life: 0, maxLife: 80 + Math.random() * 100,
        size: 1.5 + Math.random() * 3, type: 'ember', opacity: 0.6 + Math.random() * 0.4,
      });
    }
    if (Math.random() < 0.12) {
      particles.push({
        x: w / 2 + (Math.random() - 0.5) * 320, y: h * 0.28 + (Math.random() - 0.5) * 30,
        vx: (Math.random() - 0.5) * 2, vy: -(0.5 + Math.random() * 2),
        life: 0, maxLife: 50 + Math.random() * 50,
        size: 1 + Math.random() * 2, type: 'spark', opacity: 0.5 + Math.random() * 0.5,
      });
    }
    if (Math.random() < 0.03) {
      particles.push({
        x: Math.random() * w, y: h * 0.5 + Math.random() * h * 0.3,
        vx: (Math.random() - 0.5) * 0.3, vy: (Math.random() - 0.5) * 0.1,
        life: 0, maxLife: 500 + Math.random() * 500,
        size: 60 + Math.random() * 100, type: 'smoke', opacity: 0.02 + Math.random() * 0.04,
      });
    }
  }

  function updateParticles(): void {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]!;
      p.x += p.vx;
      p.y += p.vy;
      p.life++;
      if (p.type === 'ember' || p.type === 'spark') {
        p.vy *= 0.995;
        p.vx += (Math.random() - 0.5) * 0.15;
      }
      if (p.life > p.maxLife) particles.splice(i, 1);
    }
    if (particles.length > 500) particles = particles.slice(particles.length - 500);
  }

  function drawFrame(): void {
    const w = root.clientWidth || window.innerWidth;
    const h = root.clientHeight || window.innerHeight;
    pctx.clearRect(0, 0, w, h);

    for (const p of particles) {
      const progress = p.life / p.maxLife;
      const fadeIn = Math.min(p.life / 20, 1);
      const fadeOut = 1 - progress * progress;
      const alpha = p.opacity * fadeIn * fadeOut;
      if (alpha <= 0.001) continue;
      pctx.globalAlpha = alpha;

      if (p.type === 'snow') {
        pctx.fillStyle = '#d8d0c8';
        pctx.beginPath();
        pctx.arc(p.x, p.y, p.size * (1 - progress * 0.3), 0, Math.PI * 2);
        pctx.fill();
      } else if (p.type === 'ember') {
        const r = Math.round(255 - progress * 100);
        const g = Math.round(120 - progress * 100);
        pctx.fillStyle = `rgb(${r},${g},20)`;
        pctx.shadowColor = `rgba(255,100,0,${alpha * 0.5})`;
        pctx.shadowBlur = 8;
        pctx.beginPath();
        pctx.arc(p.x, p.y, p.size * (1 - progress * 0.5), 0, Math.PI * 2);
        pctx.fill();
        pctx.shadowBlur = 0;
      } else if (p.type === 'spark') {
        const grad = pctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 2);
        grad.addColorStop(0, `rgba(255,220,100,${alpha})`);
        grad.addColorStop(0.5, `rgba(255,140,30,${alpha * 0.5})`);
        grad.addColorStop(1, 'transparent');
        pctx.fillStyle = grad;
        pctx.fillRect(p.x - p.size * 2, p.y - p.size * 2, p.size * 4, p.size * 4);
      } else if (p.type === 'smoke') {
        const grad = pctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        grad.addColorStop(0, `rgba(40,30,20,${alpha})`);
        grad.addColorStop(1, 'transparent');
        pctx.fillStyle = grad;
        pctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
      }
    }
    pctx.globalAlpha = 1;
    pctx.shadowBlur = 0;
  }

  function tick(_dt: number): void {
    if (!visible) return;
    spawnParticles();
    updateParticles();
    drawFrame();
  }

  function show(): void {
    root.style.display = '';
    rebuildButtons();
    resizeCanvas();
    visible = true;
    window.addEventListener('resize', resizeCanvas);
  }
  function hide(): void {
    root.style.display = 'none';
    visible = false;
    window.removeEventListener('resize', resizeCanvas);
  }

  show();

  return {
    show,
    hide,
    tick,
    refresh: rebuildButtons,
    dispose: () => { hide(); root.remove(); },
  };
}
