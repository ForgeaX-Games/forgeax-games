import { get } from "./localization";
//  localized comment
//
// Pure presentation layer: gameplay stays in ECS (main.ts). The HUD holds NO
//  localized comment
// Mounted into the host-provided controlled UI root (ctx.uiRoot) so the Play
// host removes it WHOLE on ■ Stop. pointer-events: none throughout.
//
//  localized comment
//   top bar   : 💧 avail/cap · 🔥 fire · 👟 speed(dimmed 60%) | SCORE | 👾 ×n
//   bottom    : onboarding hint strip (state machine driven by main.ts)
//   center    : win / lose banner with staged reveal + delayed pulsing R hint
//   fullscreen: endgame red vignette (soft blocks <30%)

export interface HudStats {
  bubblesAvail: number;   // cap - own bubbles in flight
  bubbleCap: number;
  fire: number;           // blast range in tiles
  speed: number;          // tiles/s
  score: number;
  enemies: number;
}

export interface HudHandle {
  setStats(s: HudStats): void;
  /** Onboarding strip: text to show, or null to fade it out for good. */
  hint(text: string | null): void;
  /** town = hide the arena stat bar; match = show it. */
  setMode(mode: 'town' | 'match'): void;
  /** League announcement banner (top-center, slides in and fades). */
  announce(text: string, holdMs?: number): void;
  /** Rolling town chat feed (bottom-left, above the speech bubble). */
  chat(name: string, text: string): void;
  /*  localized comment */
  prompt(text: string | null): void;
  /** Talk question menu (numbered rows above the prompt), or null to hide. */
  menu(items: readonly string[] | null): void;
  showLose(retryText?: string): void;
  showWin(finalScore: number, retryText?: string): void;
  clearBanner(): void;
  setEndgame(on: boolean): void;
  toast(text: string): void;
  /*  localized comment */
  say(who: 'player' | 'enemy', name: string, text: string, holdMs?: number): void;
  clearSay(): void;
  /*  localized comment */
  retryAllowed(): boolean;
  dispose(): void;
}

//  localized comment
const DEATH_FREEZE_MS = 600;   // see how you died before anything moves
const DIM_MS = 300;            // screen dim after the freeze
const RETRY_DELAY_MS = 500;    // R hint appears AFTER the banner settles
const WIN_BANNER_DELAY_MS = 800;
const WIN_RETRY_DELAY_MS = 1000;
const FIRE_FLASH_MS = 1000;
const SPEED_FLASH_MS = 1500;
const CAP_FLASH_MS = 300;
const SPEED_IDLE_OPACITY = '0.6'; // 👟 is low-frequency info — keep it quiet
const SAY_HOLD_MS = 2600;      // default speech-bubble lifetime
const ANNOUNCE_HOLD_MS = 3600; // league announcement banner lifetime
const CHAT_LIFE_MS = 7000;     // town chat feed entry lifetime
const CHAT_MAX = 5;            // max simultaneous chat feed entries

const PANEL_CSS =
  'padding:7px 14px;border-radius:14px;background:rgba(30,16,40,0.55);' +
  'color:#fff;font-size:14px;backdrop-filter:blur(4px);';

export function installHud(opts: { host?: HTMLElement } = {}): HudHandle {
  const host = opts.host ?? document.body;
  const root = document.createElement('div');
  root.style.cssText =
    'position:absolute;inset:0;pointer-events:none;font-family:ui-rounded,"Segoe UI",system-ui,sans-serif;z-index:10;';

  const style = document.createElement('style');
  style.textContent =
    '@keyframes ppt-pulse{0%,100%{opacity:.9}50%{opacity:1}}' +
    '@keyframes ppt-vignette{0%,100%{opacity:.3}50%{opacity:.65}}' +
    '@keyframes ppt-last-enemy{0%,100%{transform:scale(1)}50%{transform:scale(1.14)}}';
  root.appendChild(style);

  // ── top status bar ────────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.style.cssText =
    'position:absolute;top:10px;left:10px;right:10px;display:flex;' +
    'align-items:center;justify-content:space-between;gap:8px;';
  root.appendChild(bar);

  const mkSpan = (parent: HTMLElement): HTMLSpanElement => {
    const s = document.createElement('span');
    s.style.cssText = 'transition:color .25s,opacity .25s,transform .25s;display:inline-block;font-weight:700;';
    parent.appendChild(s);
    return s;
  };

  const resPanel = document.createElement('div');
  resPanel.style.cssText = PANEL_CSS + 'display:flex;gap:14px;transition:background .3s;';
  const bubbleEl = mkSpan(resPanel);
  const fireEl = mkSpan(resPanel);
  const speedEl = mkSpan(resPanel);
  speedEl.style.opacity = SPEED_IDLE_OPACITY;
  bar.appendChild(resPanel);

  const scorePanel = document.createElement('div');
  scorePanel.style.cssText = PANEL_CSS + 'font-weight:800;letter-spacing:1px;';
  bar.appendChild(scorePanel);

  const enemyPanel = document.createElement('div');
  enemyPanel.style.cssText = PANEL_CSS + 'color:#ffd6ec;font-weight:800;';
  const enemyEl = mkSpan(enemyPanel);
  bar.appendChild(enemyPanel);

  // ── onboarding hint strip (bottom center, first-minutes only) ─────────────
  const hintEl = document.createElement('div');
  hintEl.style.cssText =
    'position:absolute;left:50%;bottom:16px;transform:translateX(-50%);' +
    'padding:6px 18px;border-radius:999px;background:rgba(30,16,40,0.5);' +
    'color:rgba(255,255,255,0.9);font-size:13px;transition:opacity .5s;opacity:0;';
  root.appendChild(hintEl);

  // ── endgame vignette (soft blocks <30% — feel, not words) ─────────────────
  const vignette = document.createElement('div');
  vignette.style.cssText =
    'position:absolute;inset:0;display:none;' +
    'box-shadow:inset 0 0 130px 44px rgba(255,44,70,0.55);' +
    'animation:ppt-vignette 1.5s ease-in-out infinite;';
  root.appendChild(vignette);

  // ── dim + banner (staged reveal) ──────────────────────────────────────────
  const dim = document.createElement('div');
  dim.style.cssText =
    'position:absolute;inset:0;background:rgba(18,8,26,0);transition:background .3s;';
  root.appendChild(dim);

  const bannerBox = document.createElement('div');
  bannerBox.style.cssText =
    'position:absolute;left:50%;top:40%;transform:translate(-50%,-50%) translateY(-26px);' +
    'text-align:center;display:none;opacity:0;padding:20px 38px;border-radius:22px;' +
    'background:rgba(30,16,40,0.78);color:#fff;backdrop-filter:blur(6px);' +
    'transition:opacity .3s,transform .35s cubic-bezier(.34,1.4,.5,1);';
  const bannerTitle = document.createElement('div');
  bannerTitle.style.cssText = 'font-size:30px;font-weight:800;';
  const bannerScore = document.createElement('div');
  bannerScore.style.cssText = 'font-size:16px;color:#ffe28a;margin-top:8px;font-weight:700;display:none;';
  const retryEl = document.createElement('div');
  retryEl.style.cssText =
    'font-size:15px;color:#ffd6ec;margin-top:12px;opacity:0;transition:opacity .4s;';
  bannerBox.appendChild(bannerTitle);
  bannerBox.appendChild(bannerScore);
  bannerBox.appendChild(retryEl);
  root.appendChild(bannerBox);

  // ── toast (power-up pickups) ──────────────────────────────────────────────
  const toastBox = document.createElement('div');
  toastBox.style.cssText =
    'position:absolute;left:50%;bottom:12%;transform:translateX(-50%);' +
    'display:none;padding:6px 18px;border-radius:999px;background:rgba(255,120,190,0.85);' +
    'color:#fff;font-size:14px;font-weight:700;transition:opacity 0.3s;';
  root.appendChild(toastBox);

  //  localized comment
  const mkSay = (css: string): { box: HTMLDivElement; who: HTMLDivElement; msg: HTMLDivElement } => {
    const box = document.createElement('div');
    box.style.cssText =
      'position:absolute;max-width:38%;padding:8px 14px;border-radius:16px;color:#fff;' +
      'font-size:14px;font-weight:700;line-height:1.45;opacity:0;' +
      'box-shadow:0 4px 14px rgba(20,8,30,0.35);' +
      'transform:translateY(10px) scale(.88);transition:opacity .22s,transform .25s cubic-bezier(.34,1.5,.5,1);' +
      css;
    const who = document.createElement('div');
    who.style.cssText = 'font-size:11px;opacity:.85;font-weight:800;margin-bottom:2px;letter-spacing:1px;';
    const msg = document.createElement('div');
    box.appendChild(who);
    box.appendChild(msg);
    root.appendChild(box);
    return { box, who, msg };
  };
  const playerSay = mkSay('left:16px;bottom:64px;background:rgba(255,100,170,0.92);border-bottom-left-radius:4px;');
  const enemySay = mkSay('right:16px;top:56px;background:rgba(140,90,225,0.92);border-top-right-radius:4px;');

  // ── league announcement banner (top-center, below the stat bar) ───────────
  const announceBox = document.createElement('div');
  announceBox.style.cssText =
    'position:absolute;left:50%;top:54px;transform:translateX(-50%) translateY(-14px);' +
    'padding:8px 22px;border-radius:999px;background:rgba(255,170,60,0.92);color:#3a1c08;' +
    'font-size:15px;font-weight:800;letter-spacing:0.5px;opacity:0;' +
    'box-shadow:0 4px 16px rgba(60,20,0,0.3);' +
    'transition:opacity .3s,transform .35s cubic-bezier(.34,1.4,.5,1);';
  root.appendChild(announceBox);

  // ── town chat feed (bottom-left column, above the player speech bubble) ───
  const chatBox = document.createElement('div');
  chatBox.style.cssText =
    'position:absolute;left:16px;bottom:132px;display:flex;flex-direction:column;' +
    'gap:5px;max-width:36%;align-items:flex-start;';
  root.appendChild(chatBox);

  // ── talk question menu (numbered rows, sits above the prompt pill) ────────
  const menuBox = document.createElement('div');
  menuBox.style.cssText =
    'position:absolute;left:50%;bottom:96px;transform:translateX(-50%);' +
    'display:none;flex-direction:column;gap:6px;align-items:stretch;' +
    'padding:10px 14px;border-radius:16px;background:rgba(30,16,40,0.72);' +
    'backdrop-filter:blur(5px);box-shadow:0 6px 18px rgba(20,8,30,0.4);';
  root.appendChild(menuBox);

  //  localized comment
  const promptEl = document.createElement('div');
  promptEl.style.cssText =
    'position:absolute;left:50%;bottom:52px;transform:translateX(-50%);' +
    'padding:7px 20px;border-radius:999px;background:rgba(255,255,255,0.92);color:#5a2a48;' +
    'font-size:14px;font-weight:800;display:none;box-shadow:0 4px 14px rgba(20,8,30,0.3);';
  root.appendChild(promptEl);

  host.appendChild(root);

  // ── timer bookkeeping (banner timers cancel as a group on clearBanner) ────
  const fxTimers = new Set<ReturnType<typeof setTimeout>>();
  const bannerTimers = new Set<ReturnType<typeof setTimeout>>();
  const later = (bag: Set<ReturnType<typeof setTimeout>>, fn: () => void, ms: number): void => {
    const id = setTimeout(() => { bag.delete(id); fn(); }, ms);
    bag.add(id);
  };
  const clearBag = (bag: Set<ReturnType<typeof setTimeout>>): void => {
    for (const id of bag) clearTimeout(id);
    bag.clear();
  };

  let prev: HudStats | null = null;
  let retryOk = false;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  let announceTimer: ReturnType<typeof setTimeout> | null = null;
  const sayTimers: Record<'player' | 'enemy', ReturnType<typeof setTimeout> | null> = { player: null, enemy: null };
  const hideSay = (who: 'player' | 'enemy'): void => {
    const t = who === 'player' ? playerSay : enemySay;
    t.box.style.opacity = '0';
    t.box.style.transform = 'translateY(10px) scale(.88)';
  };

  const showBanner = (): void => {
    bannerBox.style.display = 'block';
    // next frame: transition to settled position
    requestAnimationFrame(() => {
      bannerBox.style.opacity = '1';
      bannerBox.style.transform = 'translate(-50%,-50%) translateY(0)';
    });
  };
  const revealRetry = (text: string): void => {
    retryEl.textContent = text;
    retryEl.style.opacity = '1';
    retryEl.style.animation = 'ppt-pulse 1.2s ease-in-out infinite';
    retryOk = true;
  };

  return {
    setStats(s: HudStats): void {
      bubbleEl.textContent = `💧 ${s.bubblesAvail}/${s.bubbleCap}`;
      fireEl.textContent = `🔥 ${s.fire}`;
      speedEl.textContent = `👟 ${s.speed.toFixed(1)}`;
      scorePanel.textContent = `SCORE ${s.score}`;
      enemyEl.textContent = `👾 ×${s.enemies}`;
      // spent / restored bubble feedback
      bubbleEl.style.color = s.bubblesAvail === 0 ? '#9a92a8' : '#fff';
      if (prev) {
        if (s.bubbleCap > prev.bubbleCap) {            // cap up → white flash
          resPanel.style.background = 'rgba(255,255,255,0.65)';
          later(fxTimers, () => { resPanel.style.background = 'rgba(30,16,40,0.55)'; }, CAP_FLASH_MS);
        }
        if (s.bubblesAvail > prev.bubblesAvail) {      // bubble back → pop
          bubbleEl.style.transform = 'scale(1.2)';
          later(fxTimers, () => { bubbleEl.style.transform = 'scale(1)'; }, 200);
        }
        if (s.fire > prev.fire) {                      // fire up → gold jump
          fireEl.style.color = '#ffe066';
          fireEl.style.transform = 'translateY(-4px)';
          later(fxTimers, () => { fireEl.style.color = '#fff'; fireEl.style.transform = 'none'; }, FIRE_FLASH_MS);
        }
        if (s.speed !== prev.speed) {                  // boots → brighten, then fade back
          speedEl.style.opacity = '1';
          speedEl.style.color = '#ffe066';
          later(fxTimers, () => { speedEl.style.opacity = SPEED_IDLE_OPACITY; speedEl.style.color = '#fff'; }, SPEED_FLASH_MS);
        }
        if (s.enemies < prev.enemies) {                // kill confirm → red blink
          enemyEl.style.color = '#ff7a7a';
          enemyEl.style.transform = 'scale(1.25)';
          later(fxTimers, () => { enemyEl.style.color = '#ffd6ec'; enemyEl.style.transform = 'scale(1)'; }, 400);
        }
      }
      // last enemy → persistent micro-pulse ("almost there!")
      enemyEl.style.animation = s.enemies === 1 ? 'ppt-last-enemy 1s ease-in-out infinite' : 'none';
      prev = { ...s };
    },

    hint(text: string | null): void {
      if (text === null) {
        hintEl.style.opacity = '0';
        later(fxTimers, () => { hintEl.style.display = 'none'; }, 600);
        return;
      }
      hintEl.style.display = 'block';
      hintEl.textContent = text;
      hintEl.style.opacity = '1';
    },

    setMode(mode: 'town' | 'match'): void {
      bar.style.display = mode === 'match' ? 'flex' : 'none';
      if (mode === 'town') {
        promptEl.style.display = 'none';
        vignette.style.display = 'none';
      }
    },

    announce(text: string, holdMs: number = ANNOUNCE_HOLD_MS): void {
      announceBox.textContent = text;
      announceBox.style.opacity = '1';
      announceBox.style.transform = 'translateX(-50%) translateY(0)';
      if (announceTimer) clearTimeout(announceTimer);
      announceTimer = setTimeout(() => {
        announceBox.style.opacity = '0';
        announceBox.style.transform = 'translateX(-50%) translateY(-14px)';
        announceTimer = null;
      }, holdMs);
    },

    chat(name: string, text: string): void {
      const entry = document.createElement('div');
      entry.style.cssText =
        'padding:5px 12px;border-radius:12px;border-bottom-left-radius:3px;' +
        'background:rgba(30,16,40,0.62);color:#fff;font-size:12.5px;line-height:1.4;' +
        'opacity:0;transition:opacity .25s;backdrop-filter:blur(3px);';
      const nm = document.createElement('span');
      nm.style.cssText = 'color:#ffd27a;font-weight:800;margin-right:6px;';
      nm.textContent = name;
      entry.appendChild(nm);
      entry.appendChild(document.createTextNode(text));
      chatBox.appendChild(entry);
      while (chatBox.children.length > CHAT_MAX) chatBox.removeChild(chatBox.firstChild!);
      requestAnimationFrame(() => { entry.style.opacity = '1'; });
      later(fxTimers, () => {
        entry.style.opacity = '0';
        later(fxTimers, () => { entry.remove(); }, 300);
      }, CHAT_LIFE_MS);
    },

    prompt(text: string | null): void {
      if (text === null) { promptEl.style.display = 'none'; return; }
      promptEl.textContent = text;
      promptEl.style.display = 'block';
    },

    menu(items: readonly string[] | null): void {
      if (items === null) { menuBox.style.display = 'none'; return; }
      menuBox.textContent = '';
      for (const item of items) {
        const row = document.createElement('div');
        row.style.cssText =
          'padding:5px 14px;border-radius:10px;background:rgba(255,255,255,0.12);' +
          'color:#fff;font-size:13.5px;font-weight:700;white-space:nowrap;';
        row.textContent = item;
        menuBox.appendChild(row);
      }
      menuBox.style.display = 'flex';
    },

    showLose(retryText?: string): void {
      // freeze (nothing shown) → dim → banner drops in → retry pulses in late
      clearBag(bannerTimers);
      retryOk = false;
      retryEl.style.opacity = '0';
      bannerScore.style.display = 'none';
      bannerTitle.textContent = get("paopaotang.src/hud.ts:16946:237700a6da");
      later(bannerTimers, () => { dim.style.background = 'rgba(18,8,26,0.55)'; }, DEATH_FREEZE_MS);
      later(bannerTimers, showBanner, DEATH_FREEZE_MS + DIM_MS);
      later(bannerTimers, () => revealRetry(retryText ?? get("paopaotang.src/hud.ts:17181:ca9184f28e")), DEATH_FREEZE_MS + DIM_MS + RETRY_DELAY_MS);
    },

    showWin(finalScore: number, retryText?: string): void {
      clearBag(bannerTimers);
      retryOk = false;
      retryEl.style.opacity = '0';
      bannerTitle.textContent = get("paopaotang.src/hud.ts:17430:06db658863");
      bannerScore.textContent = `SCORE ${finalScore}`;
      bannerScore.style.display = 'block';
      later(bannerTimers, showBanner, WIN_BANNER_DELAY_MS);
      later(bannerTimers, () => revealRetry(retryText ?? get("paopaotang.src/hud.ts:17657:891984e42e")), WIN_BANNER_DELAY_MS + WIN_RETRY_DELAY_MS);
    },

    clearBanner(): void {
      clearBag(bannerTimers);
      retryOk = false;
      dim.style.background = 'rgba(18,8,26,0)';
      bannerBox.style.display = 'none';
      bannerBox.style.opacity = '0';
      bannerBox.style.transform = 'translate(-50%,-50%) translateY(-26px)';
      retryEl.style.opacity = '0';
      retryEl.style.animation = 'none';
    },

    setEndgame(on: boolean): void {
      vignette.style.display = on ? 'block' : 'none';
    },

    toast(text: string): void {
      toastBox.textContent = text;
      toastBox.style.display = 'block';
      toastBox.style.opacity = '1';
      if (toastTimer) clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        toastBox.style.opacity = '0';
        toastTimer = setTimeout(() => { toastBox.style.display = 'none'; toastTimer = null; }, 320);
      }, 1400);
    },

    say(who: 'player' | 'enemy', name: string, text: string, holdMs: number = SAY_HOLD_MS): void {
      const t = who === 'player' ? playerSay : enemySay;
      t.who.textContent = who === 'player' ? `🫧 ${name}` : `👾 ${name}`;
      t.msg.textContent = text;
      t.box.style.opacity = '1';
      t.box.style.transform = 'translateY(0) scale(1)';
      const old = sayTimers[who];
      if (old) clearTimeout(old);
      sayTimers[who] = setTimeout(() => { hideSay(who); sayTimers[who] = null; }, holdMs);
    },

    clearSay(): void {
      for (const who of ['player', 'enemy'] as const) {
        hideSay(who);
        const id = sayTimers[who];
        if (id) { clearTimeout(id); sayTimers[who] = null; }
      }
    },

    retryAllowed(): boolean {
      return retryOk;
    },

    dispose(): void {
      clearBag(fxTimers);
      clearBag(bannerTimers);
      if (toastTimer) clearTimeout(toastTimer);
      if (announceTimer) clearTimeout(announceTimer);
      for (const id of Object.values(sayTimers)) if (id) clearTimeout(id);
      root.remove();
    },
  };
}
