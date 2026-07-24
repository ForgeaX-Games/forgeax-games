// Hellforge HUD — D2-style DOM overlay (SHELL-AND-UI-PORT-SPEC.md §5.3).
//
// Mount contract (engine game-default AGENTS.md + uiRoot audit):
//   • Append to ctx.uiRoot (passed as `mount`), NEVER bare document.body when
//     a host uiRoot exists.
//   • mount !== body → position:absolute;inset:0 (viewport-local).
//   • mount === body → position:fixed (standalone preview fallback).
//   • Host #game-ui-root is pointer-events:none; interactive nodes opt into
//     pointer-events:auto (equipment chips only here).
//
// Data: prefer apply(HudViewModel); discrete setters remain for event-driven
// FX (banner / floatText / death) and stay incremental (no per-frame
// innerHTML rebuild of the skill bar — SPEC §5.3 CAUTION).

import type { HudViewModel, SkillSlotState, TargetViewModel } from './hud-view-model';
import { HudArt } from './hud-art';
import { FONT_DISPLAY, FONT_UI, FONT_MONO, Ui } from './ui-theme';
import { ensureUiStyles } from './ui-styles';
import { potionIconSvg, skillIconImg } from './ui-icons';
import type { UiTooltipHandle } from './ui-tooltip';

export type { HudViewModel, SkillSlotState, TargetViewModel } from './hud-view-model';

export interface HudHandle {
  /** Batch-apply the engine-agnostic snapshot (optional).
   *  Hot path in main.ts uses discrete setters with dirty checks — prefer those
   *  at 60 Hz; call apply() when assembling a full HudViewModel is cheaper than
   *  many one-off updates (e.g. character enter). */
  apply(vm: HudViewModel): void;
  setOrbs(hp: number, maxHp: number, mana: number, maxMana: number): void;
  setXp(level: number, cur: number, max: number): void;
  setGold(n: number): void;
  setKills(n: number): void;
  setSkills(slots: SkillSlotState[]): void;
  setQuest(text: string): void;
  setBoss(name: string | null, cur?: number, max?: number): void;
  setTarget(target: TargetViewModel | null): void;
  /** Camp showcase: hide/reduce combat chrome (Spec §6.2 / §11). */
  setShowcaseReduced(reduced: boolean): void;
  setAreaLabel(name: string): void;
  showArea(name: string, sub?: string): void;
  banner(text: string, color?: string, ms?: number): void;
  floatText(text: string, screenX: number, screenY: number, style?: { color?: string; size?: number }): void;
  damageFlash(): void;
  showDeath(show: boolean): void;
  /** Animated orb liquid (transform-only waves) on/off — perf escape hatch. */
  setOrbMotion(on: boolean): void;
  hide(): void;
  show(): void;
  dispose(): void;
}

const HUD_ID = 'hellforge-hud';
const GOLD = Ui.gold;
const GOLD_BRIGHT = Ui.goldBright;

export interface HudDeps {
  /** Global tooltip (ui-tooltip.ts); skill slots / belt cells bind to it. */
  tooltip?: UiTooltipHandle;
  /** Quick-button row actions ('character'|'skills'|'inventory'|'quests'|'map'). */
  onQuickAction?: (action: string) => void;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Plain multi-line tooltip text (main.ts joins lines with \n) → tip HTML. */
function tipTextToHtml(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

export function installHud(mount: HTMLElement = document.body, deps?: HudDeps): HudHandle {
  // Injects .hf-orb-wave* / .hf-orb-glow — required for liquid motion.
  ensureUiStyles();
  document.getElementById(HUD_ID)?.remove();
  const root = document.createElement('div');
  root.id = HUD_ID;
  // Viewport-local when host passes #game-ui-root; fixed only on body fallback.
  const rootAbsolute = mount !== document.body;
  root.style.cssText = `position:${rootAbsolute ? 'absolute' : 'fixed'};inset:0;z-index:50;overflow:hidden;pointer-events:none;user-select:none;` +
    `font:600 13px ${FONT_MONO};color:${Ui.text};`;

  // Rev id so HMR picks up orb/banner CSS after art iterations.
  document.getElementById('hellforge-hud-style')?.remove();
  document.getElementById('hellforge-hud-style-v4')?.remove();
  document.getElementById('hellforge-hud-style-v5')?.remove();
  if (!document.getElementById('hellforge-hud-style-v5')) {
    const s = document.createElement('style');
    s.id = 'hellforge-hud-style-v5';
    s.textContent = `
      @keyframes hf-float-rise {
        0% { opacity:1; transform:translate(-50%,-100%) scale(1.1); }
        100% { opacity:0; transform:translate(-50%,-100%) translateY(-46px) scale(0.9); }
      }
      @keyframes hf-banner {
        0% { opacity:0; transform:translate(-50%,-50%) scale(0.92); }
        14% { opacity:1; transform:translate(-50%,-50%) scale(1.02); }
        78% { opacity:1; }
        100% { opacity:0; transform:translate(-50%,-50%) scale(1); }
      }
      @keyframes hf-area {
        0% { opacity:0; letter-spacing:14px; }
        20% { opacity:1; letter-spacing:8px; }
        80% { opacity:1; }
        100% { opacity:0; }
      }
      @keyframes hf-dmg {
        0% { opacity:0; } 20% { opacity:0.6; } 100% { opacity:0; }
      }
      @keyframes hf-orb-drain {
        0% { filter:brightness(1.15); }
        40% { filter:brightness(1.55); }
        100% { filter:brightness(1); }
      }
      @keyframes hf-metal-sheen {
        0% { background-position: -80% 0; }
        100% { background-position: 180% 0; }
      }
      @keyframes hf-bubble {
        0% { transform:translateY(0) scale(0.6); opacity:0; }
        15% { opacity:0.7; }
        100% { transform:translateY(-52px) scale(1.1); opacity:0; }
      }
      @keyframes hf-caustic {
        0% { transform:translateX(-8%) rotate(0deg); opacity:0.35; }
        50% { transform:translateX(6%) rotate(3deg); opacity:0.55; }
        100% { transform:translateX(-8%) rotate(0deg); opacity:0.35; }
      }
      .hf-orb-drain .hf-orb-wave1,.hf-orb-drain .hf-orb-wave2{
        animation-duration:0.55s !important;
      }
      .hf-metal-sheen{
        position:absolute;inset:0;pointer-events:none;z-index:6;
        background:linear-gradient(105deg,
          transparent 38%,rgba(255,230,160,0.0) 42%,
          rgba(255,240,200,0.22) 49%,rgba(255,255,255,0.35) 50.5%,
          rgba(255,220,140,0.18) 52%,transparent 58%);
        background-size:220% 100%;
        animation:hf-metal-sheen 6.5s ease-in-out infinite;
        mix-blend-mode:soft-light;border-radius:inherit;
      }
      .hf-orb-bubble{
        position:absolute;border-radius:50%;pointer-events:none;z-index:3;
        animation:hf-bubble 2.8s ease-in infinite;
        box-shadow:inset 0 0 2px rgba(255,255,255,0.6);
      }
      .hf-orb-caustic{
        position:absolute;inset:0;pointer-events:none;z-index:2;
        animation:hf-caustic 3.6s ease-in-out infinite;
        mix-blend-mode:screen;
      }
    `;
    document.head.appendChild(s);
  }

  // ── bottom D2 bar ──
  // Layer stack (back→front): continuous plate → wings → orb liquid → orb frames → chrome.
  // Orbs sit ON the plate ends so no grey rectangle can cut through sphere art.
  const bar = document.createElement('div');
  bar.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:172px;' +
    'overflow:visible;pointer-events:none;';

  type OrbParts = {
    shell: HTMLDivElement;
    wrap: HTMLDivElement;
    fill: HTMLDivElement;
    txt: HTMLDivElement;
    waves: HTMLDivElement[];
    glow: HTMLDivElement;
    surface: SVGSVGElement;
    read: HTMLDivElement;
  };
  /**
   * Life/mana orb — glass sphere + volumetric liquid (sphere shading, caustics,
   * bubbles) + SVG meniscus. Frame PNG sits above liquid. Labels ride the shell
   * (not the mid plate) so plate art never occludes the readout.
   */
  const makeOrb = (kind: 'hp' | 'mp'): OrbParts => {
    const isHp = kind === 'hp';
    const gid = isHp ? 'hf-liq-hp' : 'hf-liq-mp';
    const shadowCol = isHp ? 'rgba(90,10,5,0.65)' : 'rgba(5,10,90,0.65)';
    const glowCol = isHp ? 'rgba(255,60,20,0.4)' : 'rgba(40,100,255,0.4)';
    // Volumetric fluid (sphere volume shading — not a flat fill):
    // key light + subsurface bloom + dense core + rim absorption + particulate.
    const liquid = isHp
      ? 'radial-gradient(circle at 28% 22%,rgba(255,245,220,0.95) 0%,rgba(255,170,120,0.45) 14%,transparent 36%),' +
        'radial-gradient(circle at 48% 40%,rgba(255,90,50,0.35) 0%,transparent 42%),' +
        'radial-gradient(ellipse 90% 70% at 50% 108%,#ff6040 0%,#d02018 34%,#6a0808 62%,#120000 88%),' +
        'radial-gradient(circle at 78% 58%,rgba(20,0,0,0.72) 0%,transparent 48%),' +
        'radial-gradient(circle at 18% 70%,rgba(255,80,40,0.22) 0%,transparent 38%),' +
        'repeating-radial-gradient(circle at 45% 55%,rgba(255,160,100,0.07) 0 2px,transparent 2px 7px),' +
        'linear-gradient(185deg,#ffd0b0 0%,#ff7a48 12%,#e03020 38%,#8a100c 68%,#2a0202 100%)'
      : 'radial-gradient(circle at 28% 22%,rgba(235,248,255,0.95) 0%,rgba(140,190,255,0.45) 14%,transparent 36%),' +
        'radial-gradient(circle at 48% 40%,rgba(80,140,255,0.35) 0%,transparent 42%),' +
        'radial-gradient(ellipse 90% 70% at 50% 108%,#6090ff 0%,#2048d0 34%,#081868 62%,#000012 88%),' +
        'radial-gradient(circle at 78% 58%,rgba(0,0,30,0.72) 0%,transparent 48%),' +
        'radial-gradient(circle at 18% 70%,rgba(60,120,255,0.22) 0%,transparent 38%),' +
        'repeating-radial-gradient(circle at 45% 55%,rgba(140,190,255,0.07) 0 2px,transparent 2px 7px),' +
        'linear-gradient(185deg,#d0e8ff 0%,#6090ff 12%,#2850d8 38%,#0c1c70 68%,#020218 100%)';
    const cHi = isHp ? '#ffe8d0' : '#e8f4ff';
    const cMid = isHp ? '#ff6040' : '#5090ff';
    const cDeep = isHp ? '#5a0606' : '#061040';
    const causticCol = isHp
      ? 'radial-gradient(ellipse at 38% 36%,rgba(255,220,160,0.55) 0%,transparent 38%),' +
        'radial-gradient(ellipse at 62% 58%,rgba(255,90,40,0.38) 0%,transparent 32%),' +
        'radial-gradient(ellipse at 50% 70%,rgba(255,140,80,0.2) 0%,transparent 45%)'
      : 'radial-gradient(ellipse at 38% 36%,rgba(200,235,255,0.55) 0%,transparent 38%),' +
        'radial-gradient(ellipse at 62% 58%,rgba(70,130,255,0.38) 0%,transparent 32%),' +
        'radial-gradient(ellipse at 50% 70%,rgba(100,160,255,0.2) 0%,transparent 45%)';

    const shell = document.createElement('div');
    shell.style.cssText = 'position:relative;width:150px;height:150px;flex:none;' +
      'display:flex;align-items:center;justify-content:center;overflow:visible;';

    // Readout above the orb — never sits on the mid plate (avoids grey occlusion).
    const read = document.createElement('div');
    read.style.cssText = 'position:absolute;left:50%;bottom:100%;transform:translate(-50%,-2px);' +
      `font:700 11px ${FONT_UI};white-space:nowrap;padding:2px 9px;z-index:8;` +
      `color:${isHp ? '#f08070' : '#80a8ff'};` +
      `background:linear-gradient(180deg,rgba(28,18,12,0.92),rgba(10,8,6,0.92));` +
      `border:1px solid ${isHp ? 'rgba(200,70,40,0.45)' : 'rgba(70,110,200,0.45)'};` +
      'box-shadow:0 2px 8px rgba(0,0,0,0.55),inset 0 1px 0 rgba(255,220,160,0.12);' +
      'text-shadow:0 1px 2px #000;';

    // Liquid vessel must match the punched inner hole of globe-frame-*.png.
    // Frame is 512² with hole radius ≈151 → at 150px shell ≈ 88px; inset 2px under rim.
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
      'width:86px;height:86px;border-radius:50%;overflow:hidden;z-index:1;' +
      'isolation:isolate;contain:paint;' +
      `background:${isHp ? '#080101' : '#010108'};box-sizing:border-box;` +
      `box-shadow:inset 0 0 28px rgba(0,0,0,0.96),inset 0 -12px 18px ${shadowCol},` +
      `inset 6px 8px 14px ${isHp ? 'rgba(60,10,5,0.55)' : 'rgba(5,15,60,0.55)'},` +
      `inset 0 0 0 1px ${isHp ? 'rgba(80,20,10,0.6)' : 'rgba(10,20,80,0.6)'};`;

    const fill = document.createElement('div');
    fill.style.cssText = 'position:absolute;left:0;bottom:0;width:100%;height:60%;' +
      'transition:height 0.4s cubic-bezier(.2,.8,.2,1);overflow:hidden;border-radius:0;';

    const liquidEl = document.createElement('div');
    liquidEl.className = 'hf-orb-liquid';
    liquidEl.style.cssText = `position:absolute;left:0;right:0;top:6px;bottom:0;background:${liquid};`;

    const caustic = document.createElement('div');
    caustic.className = 'hf-orb-caustic';
    caustic.style.cssText = `inset:0;background:${causticCol};`;

    // Inner wall refraction ring (glass/liquid interface).
    const meniscusLit = document.createElement('div');
    meniscusLit.style.cssText = 'position:absolute;left:6%;right:6%;top:0;height:11px;z-index:4;pointer-events:none;' +
      `background:linear-gradient(180deg,${isHp ? 'rgba(255,230,200,0.55)' : 'rgba(220,240,255,0.55)'} 0%,` +
      `${isHp ? 'rgba(255,100,60,0.2)' : 'rgba(80,140,255,0.2)'} 45%,transparent 100%);` +
      'border-radius:50%;';

    // Bubbles rising through fluid volume.
    const bubbles: HTMLDivElement[] = [];
    for (let i = 0; i < 4; i++) {
      const b = document.createElement('div');
      b.className = 'hf-orb-bubble';
      const size = 2 + (i % 3);
      b.style.cssText =
        `left:${16 + i * 18}%;bottom:${6 + (i % 2) * 5}px;width:${size}px;height:${size}px;` +
        `background:${isHp ? 'rgba(255,220,180,0.65)' : 'rgba(200,225,255,0.65)'};` +
        `animation-delay:${(i * 0.48).toFixed(2)}s;animation-duration:${(2.2 + i * 0.32).toFixed(2)}s;`;
      bubbles.push(b);
    }

    // Meniscus SVG — kept inside the vessel (no horizontal overflow).
    const surface = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    surface.setAttribute('class', 'hf-orb-surface');
    surface.setAttribute('viewBox', '0 0 200 28');
    surface.setAttribute('preserveAspectRatio', 'none');
    surface.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:16px;z-index:4;overflow:hidden;';
    const dA = 'M0 16 C25 6, 50 24, 75 14 S125 4, 150 16 S185 24, 200 14 V28 H0 Z';
    const dB = 'M0 14 C25 22, 50 6, 75 18 S125 24, 150 10 S185 6, 200 16 V28 H0 Z';
    const dC = 'M0 18 C25 8, 50 20, 75 10 S125 22, 150 16 S185 8, 200 18 V28 H0 Z';
    surface.innerHTML =
      `<defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="${cHi}"/><stop offset="40%" stop-color="${cMid}"/>` +
      `<stop offset="100%" stop-color="${cDeep}"/></linearGradient>` +
      `<linearGradient id="${gid}-foam" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0%" stop-color="rgba(255,255,255,0.55)"/><stop offset="100%" stop-color="rgba(255,255,255,0)"/>` +
      `</linearGradient></defs>` +
      `<path fill="url(#${gid})" d="${dA}">` +
      `<animate attributeName="d" dur="2.4s" repeatCount="indefinite" values="${dA};${dB};${dC};${dA}"/>` +
      `</path>` +
      `<path fill="url(#${gid}-foam)" opacity="0.55" d="${dA}">` +
      `<animate attributeName="d" dur="1.8s" repeatCount="indefinite" values="${dB};${dA};${dC};${dB}"/>` +
      `</path>`;

    const wave1 = document.createElement('div');
    wave1.className = 'hf-orb-wave1';
    wave1.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:9px;z-index:5;' +
      `background:radial-gradient(ellipse at center,${isHp ? 'rgba(255,220,180,0.35)' : 'rgba(200,230,255,0.35)'} 0%,transparent 70%);`;
    const wave2 = document.createElement('div');
    wave2.className = 'hf-orb-wave2';
    wave2.style.cssText = 'position:absolute;top:3px;left:0;width:100%;height:6px;z-index:5;opacity:0.5;' +
      `background:radial-gradient(ellipse at center,${isHp ? 'rgba(255,120,80,0.28)' : 'rgba(80,140,255,0.28)'} 0%,transparent 70%);`;

    fill.append(liquidEl, caustic, ...bubbles, meniscusLit, surface, wave1, wave2);

    const glow = document.createElement('div');
    glow.className = 'hf-orb-glow';
    glow.style.cssText = 'position:absolute;inset:0;border-radius:50%;pointer-events:none;z-index:1;' +
      `background:radial-gradient(circle at 50% 78%,${glowCol} 0%,transparent 52%);`;

    // Glass sphere: fresnel rim + dual specular + bottom absorption.
    const glass = document.createElement('div');
    glass.style.cssText = 'position:absolute;inset:0;border-radius:50%;pointer-events:none;z-index:6;' +
      'background:radial-gradient(circle at 50% 50%,transparent 38%,rgba(0,0,0,0.28) 68%,rgba(0,0,0,0.62) 100%),' +
      'radial-gradient(ellipse at 28% 20%,rgba(255,255,255,0.55) 0%,rgba(255,255,255,0.12) 22%,transparent 42%),' +
      'radial-gradient(ellipse at 72% 30%,rgba(255,255,255,0.18) 0%,transparent 28%),' +
      'radial-gradient(ellipse at 70% 78%,rgba(0,0,0,0.4) 0%,transparent 38%),' +
      'linear-gradient(160deg,rgba(255,255,255,0.2) 0%,transparent 36%,rgba(0,0,0,0.25) 100%);';

    const txt = document.createElement('div');
    txt.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'font-size:16px;font-weight:bold;color:#fff;pointer-events:none;z-index:7;' +
      'text-shadow:0 0 6px #000,0 0 12px #000,0 1px 2px #000;';

    wrap.append(fill, glow, glass, txt);

    // Frame ABOVE liquid so metal rim always occludes any residual wave bleed.
    const frame = document.createElement('img');
    frame.src = isHp ? HudArt.globeHp() : HudArt.globeMp();
    frame.alt = '';
    frame.draggable = false;
    frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;' +
      'pointer-events:none;z-index:5;filter:drop-shadow(0 0 6px rgba(255,200,120,0.15));';

    const sheen = document.createElement('div');
    sheen.className = 'hf-metal-sheen';
    sheen.style.cssText += 'border-radius:50%;z-index:6;' +
      'mask-image:radial-gradient(circle,#000 42%,transparent 68%);' +
      '-webkit-mask-image:radial-gradient(circle,#000 42%,transparent 68%);';

    shell.append(read, wrap, frame, sheen);
    return { shell, wrap, fill, txt, waves: [wave1, wave2], glow, surface, read };
  };

  const hp = makeOrb('hp');
  const mp = makeOrb('mp');

  // Continuous forged plate under the whole chrome — tall/wide enough to cover slots+quick+meta.
  const mid = document.createElement('div');
  mid.style.cssText = 'position:absolute;left:50%;bottom:0;transform:translateX(-50%);' +
    'width:min(700px,72%);height:158px;z-index:1;box-sizing:border-box;' +
    'display:flex;flex-direction:column;justify-content:flex-end;gap:5px;' +
    'padding:22px 88px 12px;overflow:hidden;' +
    `background:url('${HudArt.hotbarBackplate()}') center bottom/100% 100% no-repeat,` +
    'linear-gradient(180deg,rgba(28,20,12,0.72) 0%,rgba(16,12,8,0.96) 18%,rgba(8,6,5,0.99) 100%);' +
    'box-shadow:0 -10px 26px rgba(0,0,0,0.65),inset 0 1px 0 rgba(224,184,74,0.22),' +
    'inset 0 -1px 0 rgba(255,180,80,0.1),inset 0 0 40px rgba(0,0,0,0.35);' +
    // Soft side falloff so plate ends don't read as a grey rectangle over the orbs.
    'mask-image:linear-gradient(90deg,transparent 0%,#000 7%,#000 93%,transparent 100%);' +
    '-webkit-mask-image:linear-gradient(90deg,transparent 0%,#000 7%,#000 93%,transparent 100%);';
  const xpBar = document.createElement('div');
  xpBar.style.cssText = 'position:absolute;top:8px;left:14%;right:14%;height:4px;z-index:2;' +
    'background:rgba(0,0,0,0.55);border:1px solid rgba(120,90,40,0.5);border-radius:1px;' +
    'box-shadow:0 0 6px rgba(200,160,60,0.15);';
  const xpFill = document.createElement('div');
  xpFill.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#6633aa,#c8a040,#9955ee);transition:width 0.3s;';
  xpBar.appendChild(xpFill);

  // Skill tray — recessed gold-rim well fully inside the plate.
  const slotsRow = document.createElement('div');
  slotsRow.style.cssText = 'position:relative;z-index:2;display:flex;gap:8px;justify-content:center;align-items:flex-end;' +
    'padding:7px 12px 5px;margin:0 8px;' +
    'background:linear-gradient(180deg,rgba(20,14,8,0.7) 0%,rgba(4,3,2,0.9) 100%);' +
    'border:1px solid rgba(224,184,74,0.32);' +
    'box-shadow:inset 0 2px 12px rgba(0,0,0,0.7),inset 0 1px 0 rgba(255,220,160,0.1),' +
    '0 0 10px rgba(200,140,40,0.08);';

  type SkillDom = {
    root: HTMLDivElement;
    icon: HTMLDivElement;
    key: HTMLDivElement;
    cost: HTMLDivElement;
    veil: HTMLDivElement;
    badge: HTMLDivElement;
    /** Last applied slot state — tooltip handlers read this on hover. */
    last?: SkillSlotState;
  };
  const skillDom: SkillDom[] = [];
  const ensureSkillSlots = (slots: SkillSlotState[]): void => {
    while (skillDom.length < slots.length) {
      const i = skillDom.length;
      const isPotion = !!slots[i]?.potion;
      const root = document.createElement('div');
      const emptySlotBg = HudArt.hotbarSlotEmpty();
      root.style.cssText = isPotion
        ? 'position:relative;width:40px;height:40px;border-radius:3px;overflow:hidden;' +
          `background-image:url('${emptySlotBg}');background-size:100% 100%;background-repeat:no-repeat;` +
          `background-color:${slots[i]!.potion === 'life' ? 'rgba(60,10,10,0.7)' : 'rgba(10,10,60,0.7)'};` +
          'border:0;display:flex;align-items:center;justify-content:center;pointer-events:auto;' +
          'box-shadow:inset 0 0 6px rgba(0,0,0,0.5);margin-bottom:6px;'
        : 'position:relative;width:52px;height:52px;border-radius:4px;overflow:hidden;' +
          `background-image:url('${emptySlotBg}');background-size:100% 100%;background-repeat:no-repeat;` +
          'background-color:rgba(18,12,6,0.85);border:0;' +
          'display:flex;align-items:center;justify-content:center;pointer-events:auto;';
      const d: SkillDom = {
        root,
        icon: document.createElement('div'),
        key: document.createElement('div'),
        cost: document.createElement('div'),
        veil: document.createElement('div'),
        badge: document.createElement('div'),
      };
      d.icon.style.cssText = 'display:flex;align-items:center;justify-content:center;width:100%;height:100%;' +
        `font-size:${isPotion ? '14px' : '22px'};color:${Ui.textDim};`;
      d.key.style.cssText = isPotion
        ? 'position:absolute;top:0;left:2px;font-size:8px;color:#886644;text-shadow:0 1px 1px #000;'
        : 'position:absolute;bottom:1px;right:2px;font-size:9px;color:#8a7a5a;text-shadow:0 1px 1px #000;';
      d.cost.style.cssText = 'position:absolute;top:1px;left:3px;font-size:9px;font-weight:bold;color:#7da2ff;text-shadow:0 1px 2px #000;';
      d.veil.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:0%;background:rgba(0,0,0,0.62);pointer-events:none;';
      d.badge.style.cssText = 'position:absolute;bottom:0;right:1px;font-size:8px;color:#c8a84e;text-shadow:0 1px 1px #000;display:none;';
      root.append(d.icon, d.key, d.cost, d.veil, d.badge);
      // Global tooltip (native title never fires under pointer-events:none HUD).
      root.addEventListener('mousemove', (e) => {
        const s = d.last;
        if (!s || !deps?.tooltip) return;
        if (s.potion) {
          deps.tooltip.show(
            `<div style="font-weight:800;color:${s.potion === 'life' ? '#ff6666' : '#66aaff'};">${escapeHtml(s.name)}</div>` +
            `<div style="color:#c0c0c0;">瞬间恢复 ${s.potion === 'life' ? '30 生命' : '20 法力'}</div>` +
            `<div style="color:#8a7a5a;font-size:10px;margin-top:2px;">库存 ${s.count ?? 0} · 按 ${escapeHtml(s.key)} 使用</div>`,
            e.clientX, e.clientY,
          );
          return;
        }
        if (s.empty) return;
        // Damage-type colors (aidiablo skill tooltip recipe).
        const typeCol = s.icon === 'magma' || s.icon === 'inferno-nova' ? '#ff8844'
          : s.icon === 'frost' ? '#44aaff'
          : s.icon === 'arc' ? '#ffee44' : '#cccccc';
        const state = s.locked ? `<div style="color:${Ui.textDim};">未学</div>`
          : `<div style="color:#7da2ff;">法力 ${s.manaCost}</div>`;
        deps.tooltip.show(
          `<div style="font-weight:800;font-size:15px;color:${typeCol};">${escapeHtml(s.name)}</div>${state}` +
          `<div style="color:${Ui.textDim};font-size:10px;letter-spacing:1px;margin-top:2px;">${escapeHtml(s.key)} 选择 · 右键施放</div>`,
          e.clientX, e.clientY,
        );
      });
      root.addEventListener('mouseleave', () => deps?.tooltip?.hide());
      slotsRow.appendChild(root);
      skillDom.push(d);
    }
    while (skillDom.length > slots.length) {
      const last = skillDom.pop()!;
      last.root.remove();
    }
  };

  // Quick panel buttons (aidiablo mkBtn recipe) — click maps to panel hotkeys.
  const quickRow = document.createElement('div');
  quickRow.style.cssText = 'display:flex;gap:5px;justify-content:center;pointer-events:auto;';
  const QUICK: Array<{ action: string; key: string; name: string; color: string }> = [
    { action: 'character', key: 'C', name: '角色', color: '#c8a84e' },
    { action: 'skills', key: 'K', name: '技能', color: '#88cc88' },
    { action: 'inventory', key: 'B', name: '背包', color: '#c8a84e' },
    { action: 'quests', key: 'Q', name: '任务', color: '#ffd700' },
    { action: 'map', key: 'Tab', name: '地图', color: '#88aacc' },
  ];
  for (const q of QUICK) {
    const b = document.createElement('button');
    b.type = 'button';
    b.style.cssText = 'padding:2px 7px;min-width:36px;' +
      'background:linear-gradient(180deg,rgba(36,26,14,0.95) 0%,rgba(14,10,6,0.95) 100%);' +
      'border:1px solid rgba(224,184,74,0.35);border-radius:2px;' +
      'display:flex;flex-direction:column;align-items:center;gap:0;white-space:nowrap;line-height:1.15;cursor:pointer;' +
      'box-shadow:inset 0 1px 0 rgba(224,184,74,0.12),0 1px 3px rgba(0,0,0,0.5);';
    b.innerHTML = `<span style="font-size:10px;color:#c8b070;font-weight:800;letter-spacing:0.5px;">${q.key}</span>` +
      `<span style="font-size:9px;color:${q.color};font-weight:700;">${q.name}</span>`;
    b.addEventListener('mouseenter', () => {
      b.style.borderColor = '#e0b84a';
      b.style.background = 'linear-gradient(180deg,rgba(55,40,18,0.98) 0%,rgba(28,20,10,0.98) 100%)';
    });
    b.addEventListener('mouseleave', () => {
      b.style.borderColor = 'rgba(224,184,74,0.35)';
      b.style.background = 'linear-gradient(180deg,rgba(36,26,14,0.95) 0%,rgba(14,10,6,0.95) 100%)';
    });
    b.addEventListener('click', () => deps?.onQuickAction?.(q.action));
    quickRow.appendChild(b);
  }

  const metaRow = document.createElement('div');
  metaRow.style.cssText = 'position:relative;z-index:2;display:flex;gap:12px;justify-content:center;' +
    'flex-wrap:wrap;font-size:10px;color:#c8b890;text-shadow:0 1px 2px #000;';
  const lvlEl = document.createElement('span');
  const xpEl = document.createElement('span');
  const goldEl = document.createElement('span');
  goldEl.style.color = '#e0b84a';
  const killsEl = document.createElement('span');
  const areaMeta = document.createElement('span');
  areaMeta.style.color = '#8a7a60';
  metaRow.append(lvlEl, xpEl, goldEl, killsEl, areaMeta);

  quickRow.style.cssText += 'position:relative;z-index:2;';
  mid.append(xpBar, slotsRow, quickRow, metaRow);

  // Ornament wings — medallion only (bar stubs cropped). Sit behind orbs, above plate.
  const wing = (side: 'left' | 'right'): HTMLImageElement => {
    const img = document.createElement('img');
    img.src = side === 'left' ? HudArt.barWingLeft() : HudArt.barWingRight();
    img.alt = '';
    img.draggable = false;
    img.style.cssText = 'width:78px;height:110px;object-fit:contain;object-position:bottom;' +
      'flex:none;pointer-events:none;position:relative;z-index:1;' +
      `margin-${side === 'left' ? 'right' : 'left'}:-36px;` +
      'filter:drop-shadow(0 0 8px rgba(255,180,80,0.18)) drop-shadow(2px 2px 4px rgba(0,0,0,0.8));';
    return img;
  };

  // Orbs overhang the plate ends — HP further left, MP further right (wing stays with orb).
  const leftCluster = document.createElement('div');
  leftCluster.style.cssText = 'position:absolute;left:max(2px,calc(50% - 455px));bottom:2px;' +
    'display:flex;align-items:flex-end;z-index:4;';
  leftCluster.append(wing('left'), hp.shell);

  const rightCluster = document.createElement('div');
  rightCluster.style.cssText = 'position:absolute;right:max(2px,calc(50% - 455px));bottom:2px;' +
    'display:flex;align-items:flex-end;z-index:4;';
  rightCluster.append(mp.shell, wing('right'));

  // Plate first (back), then orb clusters on top of plate ends.
  bar.append(mid, leftCluster, rightCluster);

  // ── top chrome ────────────────────────────────────────────────────────
  const questEl = document.createElement('div');
  questEl.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);max-width:min(520px,90%);' +
    'padding:10px 28px 12px;border-radius:0;border:0;' +
    `background:url('${HudArt.automapParchment()}') center/cover no-repeat,${Ui.inkPanel};` +
    `box-shadow:0 0 0 1px ${Ui.goldDeep},0 4px 16px rgba(0,0,0,0.65);` +
    `font:600 12px ${FONT_MONO};color:${Ui.text};text-shadow:0 1px 2px #000;` +
    'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';

  // Current monster target (name / level / HP) — Spec §11.1.
  const targetWrap = document.createElement('div');
  targetWrap.style.cssText =
    'position:absolute;top:44px;left:50%;transform:translateX(-50%);width:min(360px,80%);display:none;' +
    `padding:6px 12px 8px;border-radius:4px;background:${Ui.inkPanel};` +
    `border:1px solid ${Ui.goldLineSoft};box-shadow:0 0 0 1px ${Ui.goldDeep};`;
  const targetTitle = document.createElement('div');
  targetTitle.style.cssText =
    `text-align:center;font:800 13px ${FONT_MONO};color:${Ui.goldBright};` +
    'text-shadow:0 1px 2px #000;letter-spacing:1px;margin-bottom:4px;';
  const targetBar = document.createElement('div');
  targetBar.style.cssText =
    'height:10px;border-radius:2px;overflow:hidden;background:rgba(20,6,6,0.85);' +
    'border:1px solid rgba(224,184,74,0.45);';
  const targetFill = document.createElement('div');
  targetFill.style.cssText =
    'height:100%;width:100%;background:linear-gradient(90deg,#8a2010,#e05030);transition:width 0.12s;';
  targetBar.appendChild(targetFill);
  targetWrap.append(targetTitle, targetBar);

  const bossWrap = document.createElement('div');
  bossWrap.style.cssText = 'position:absolute;top:96px;left:50%;transform:translateX(-50%);width:min(420px,86%);display:none;';
  const bossName = document.createElement('div');
  bossName.style.cssText = `text-align:center;font:800 14px ${FONT_MONO};color:#ff6a52;` +
    'text-shadow:0 0 10px rgba(255,60,30,0.6),0 1px 3px #000;letter-spacing:2px;margin-bottom:3px;';
  const bossBar = document.createElement('div');
  bossBar.style.cssText = 'height:12px;border-radius:3px;overflow:hidden;background:rgba(20,6,6,0.85);' +
    'border:1px solid rgba(255,90,60,0.55);';
  const bossFill = document.createElement('div');
  bossFill.style.cssText = 'height:100%;width:100%;background:linear-gradient(90deg,#a00d0d,#ff4a2a);transition:width 0.15s;';
  bossBar.appendChild(bossFill);
  bossWrap.append(bossName, bossBar);

  const hint = document.createElement('div');
  hint.style.cssText = 'position:absolute;top:12px;right:14px;padding:5px 12px;border-radius:4px;' +
    `background:rgba(12,8,6,0.55);font:500 11px ${FONT_UI};color:#cbb;opacity:0.9;text-align:right;line-height:1.6;` +
    'max-width:min(280px,42%);';
  hint.innerHTML =
    '<b>WASD</b> 移动 · <b>左键</b> 互动 · <b>右键</b> 施法 · <b>1-4</b> 选技 · <b>5/6</b> 药水<br>' +
    '<b>B</b> 背包 · <b>K</b> 技能 · <b>C</b> 角色 · <b>Q</b> 任务 · <b>Tab</b> 地图 · <b>V</b> 展示';

  const areaEl = document.createElement('div');
  areaEl.style.cssText = 'position:absolute;left:50%;top:26%;transform:translate(-50%,-50%);display:none;text-align:center;';

  const bannerEl = document.createElement('div');
  bannerEl.style.cssText = 'position:absolute;left:50%;top:42%;transform:translate(-50%,-50%);display:none;' +
    'padding:14px 36px 16px;border-radius:2px;pointer-events:none;max-width:min(720px,90%);' +
    `background:url('${HudArt.automapParchment()}') center/cover no-repeat,rgba(12,8,4,0.94);` +
    `border:1px solid ${Ui.goldLine};box-shadow:0 0 0 1px ${Ui.goldDeep},0 12px 36px rgba(0,0,0,0.75),` +
    'inset 0 0 28px rgba(0,0,0,0.45);' +
    `font:800 28px ${FONT_DISPLAY};letter-spacing:3px;white-space:nowrap;text-align:center;` +
    'text-shadow:0 2px 4px #000,0 0 18px rgba(255,150,50,0.45);';

  const deathEl = document.createElement('div');
  deathEl.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;' +
    'flex-direction:column;gap:14px;background:radial-gradient(circle at center,rgba(40,0,0,0.55),rgba(10,0,0,0.85));';
  deathEl.innerHTML =
    `<div style="font:900 52px ${FONT_UI};color:#c22;letter-spacing:8px;` +
    `text-shadow:0 0 30px rgba(255,0,0,0.5)">你已死亡</div>` +
    `<div style="font:600 15px ${FONT_UI};color:#daa">按 <b style="color:#fff">R</b> 在余烬哨站复活（无经验惩罚）</div>`;

  const dmgFlash = document.createElement('div');
  dmgFlash.style.cssText = 'position:absolute;inset:0;opacity:0;pointer-events:none;' +
    'background:radial-gradient(circle at center,transparent 35%,rgba(200,20,20,0.65) 100%);';

  const popups = document.createElement('div');
  popups.style.cssText = 'position:absolute;inset:0;overflow:visible;';

  root.append(bar, questEl, targetWrap, bossWrap, hint, areaEl, bannerEl, dmgFlash, deathEl, popups);
  mount.appendChild(root);

  // ── setters (incremental) ─────────────────────────────────────────────
  let lastXp = { level: -1, cur: -1, max: -1 };
  let lastGold = -1;
  let lastKills = -1;
  let lastAreaMeta = '';

  let lastHpV = -1;
  let lastMpV = -1;
  const pulseOrbDrain = (parts: OrbParts): void => {
    parts.wrap.classList.remove('hf-orb-drain');
    void parts.wrap.offsetWidth;
    parts.wrap.classList.add('hf-orb-drain');
    window.setTimeout(() => parts.wrap.classList.remove('hf-orb-drain'), 650);
  };
  const setOrbs = (hpV: number, maxHp: number, mana: number, maxMana: number) => {
    const hpP = Math.max(0, Math.min(1, maxHp > 0 ? hpV / maxHp : 0));
    const mpP = Math.max(0, Math.min(1, maxMana > 0 ? mana / maxMana : 0));
    if (lastHpV >= 0 && hpV < lastHpV - 0.05) pulseOrbDrain(hp);
    if (lastMpV >= 0 && mana < lastMpV - 0.05) pulseOrbDrain(mp);
    lastHpV = hpV;
    lastMpV = mana;
    hp.fill.style.height = `${(hpP * 100).toFixed(1)}%`;
    mp.fill.style.height = `${(mpP * 100).toFixed(1)}%`;
    const hpN = Math.max(0, Math.ceil(hpV));
    const mpN = Math.floor(mana);
    hp.txt.textContent = `${hpN}`;
    mp.txt.textContent = `${mpN}`;
    hp.read.textContent = `生命 ${hpN}/${Math.ceil(maxHp)}`;
    mp.read.textContent = `法力 ${mpN}/${Math.floor(maxMana)}`;
  };

  const setXp = (level: number, cur: number, max: number) => {
    if (lastXp.level === level && lastXp.cur === cur && lastXp.max === max) return;
    lastXp = { level, cur, max };
    lvlEl.textContent = `Lv${level}`;
    xpEl.textContent = `XP ${cur}/${max}`;
    xpFill.style.width = `${Math.max(0, Math.min(100, max > 0 ? (cur / max) * 100 : 0)).toFixed(1)}%`;
  };

  const setGold = (n: number) => {
    if (lastGold === n) return;
    lastGold = n;
    goldEl.textContent = `★${n}`;
  };

  const setKills = (n: number) => {
    if (lastKills === n) return;
    lastKills = n;
    killsEl.textContent = `☠ ${n}`;
  };

  const setAreaLabel = (name: string) => {
    if (lastAreaMeta === name) return;
    lastAreaMeta = name;
    areaMeta.textContent = name ? `· ${name}` : '';
  };

  const setSkills = (slots: SkillSlotState[]) => {
    ensureSkillSlots(slots);
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]!;
      const d = skillDom[i]!;
      d.last = s;
      if (s.potion) {
        // Belt cell: flask + count badge (+ "—" when dry); border by kind.
        const iconKey = s.potion;
        if (d.icon.dataset.k !== iconKey) {
          d.icon.dataset.k = iconKey;
          d.icon.innerHTML = potionIconSvg(s.potion, 22);
        }
        d.icon.style.opacity = s.empty ? '0.35' : '1';
        d.key.textContent = s.key;
        d.cost.textContent = '';
        d.veil.style.height = '0%';
        d.badge.style.display = '';
        d.badge.textContent = s.empty ? '—' : `${s.count ?? 0}`;
        d.badge.style.color = s.empty ? '#5a4a3a' : (s.potion === 'life' ? '#c8a84e' : '#88aadd');
        continue;
      }
      // Icon art is keyed (skill id); only rebuild the <img> when the key changes.
      const iconKey = s.empty ? '' : s.icon;
      if (d.icon.dataset.k !== iconKey) {
        d.icon.dataset.k = iconKey;
        d.icon.replaceChildren();
        if (!iconKey) {
          d.icon.textContent = '+';
          d.icon.style.color = '#3a2518';
        } else {
          const img = skillIconImg(iconKey, 48, { alt: s.name });
          if (img) {
            img.style.imageRendering = 'pixelated';
            d.icon.appendChild(img);
          } else {
            d.icon.textContent = '+';
            d.icon.style.color = '#3a2518';
          }
        }
      }
      d.key.textContent = s.key;
      d.badge.style.display = 'none';
      // PR6 painted rim: empty vs selected/active plate; keep opacity for lock/afford.
      d.root.style.backgroundImage = `url('${s.selected ? HudArt.hotbarSlotActive() : HudArt.hotbarSlotEmpty()}')`;
      d.root.style.boxShadow = s.selected ? `0 0 10px rgba(255,80,30,0.35)` : '';
      d.root.style.filter = (s.locked || s.empty) ? 'grayscale(0.9) brightness(0.55)' : '';
      d.root.style.opacity = (s.locked || s.empty) ? '0.3' : (!s.affordable ? '0.5' : '1');
      if (s.empty) {
        d.cost.textContent = '';
        d.veil.style.height = '0%';
      } else if (s.locked) {
        d.cost.textContent = '未学';
        d.cost.style.color = '#caa';
        d.veil.style.height = '0%';
      } else {
        d.cost.textContent = `${s.manaCost}`;
        d.cost.style.color = s.affordable ? '#7da2ff' : '#ff6a6a';
        d.veil.style.height = s.cooldownPct > 0.02 ? `${(s.cooldownPct * 100).toFixed(0)}%` : '0%';
      }
    }
  };

  const setQuest = (text: string) => { questEl.textContent = text; };
  let showcaseReduced = false;
  let lastBossKey = '';
  let lastTargetKey = '';
  const setBoss = (name: string | null, cur = 0, max = 1) => {
    if (!name) {
      lastBossKey = '';
      bossWrap.style.display = 'none';
      return;
    }
    if (showcaseReduced) {
      bossWrap.style.display = 'none';
      return;
    }
    bossWrap.style.display = 'block';
    const key = `${name}|${cur}|${max}`;
    if (key === lastBossKey) return;
    lastBossKey = key;
    bossName.textContent = name;
    bossFill.style.width = `${Math.max(0, Math.min(100, (cur / Math.max(1, max)) * 100)).toFixed(1)}%`;
  };

  const setTarget = (target: TargetViewModel | null) => {
    if (!target || showcaseReduced) {
      lastTargetKey = '';
      targetWrap.style.display = 'none';
      return;
    }
    const key = `${target.name}|${target.level}|${target.hp}|${target.maxHp}`;
    if (key === lastTargetKey) return;
    lastTargetKey = key;
    targetWrap.style.display = 'block';
    targetTitle.textContent = `${target.name}  ·  Lv ${target.level}  ·  ${Math.ceil(target.hp)}/${Math.ceil(target.maxHp)}`;
    targetFill.style.width =
      `${Math.max(0, Math.min(100, (target.hp / Math.max(1, target.maxHp)) * 100)).toFixed(1)}%`;
  };

  const setShowcaseReduced = (reduced: boolean) => {
    showcaseReduced = reduced;
    // Combat chrome: skill/belt bar + kill meta + target/boss. Orbs/XP stay dim.
    slotsRow.style.display = reduced ? 'none' : 'flex';
    quickRow.style.display = reduced ? 'none' : 'flex';
    killsEl.style.display = reduced ? 'none' : '';
    questEl.style.opacity = reduced ? '0.35' : '1';
    hint.style.opacity = reduced ? '0.45' : '0.9';
    bar.style.opacity = reduced ? '0.55' : '1';
    if (reduced) {
      targetWrap.style.display = 'none';
      bossWrap.style.display = 'none';
    }
  };

  const apply = (vm: HudViewModel) => {
    setOrbs(vm.hp, vm.maxHp, vm.mp, vm.maxMp);
    setXp(vm.level, vm.xp, vm.xpToNext);
    setGold(vm.gold);
    setKills(vm.kills);
    setSkills(vm.skills);
    setQuest(vm.quest);
    setAreaLabel(vm.areaName);
    if (vm.boss) setBoss(vm.boss.name, vm.boss.hp, vm.boss.maxHp);
    else setBoss(null);
    setTarget(vm.target);
  };

  let areaTimer: number | undefined;
  const showArea = (name: string, sub?: string) => {
    setAreaLabel(name);
    areaEl.innerHTML = `<div style="font:700 36px ${FONT_DISPLAY};color:#c8a84e;letter-spacing:8px;` +
      `text-shadow:0 0 14px rgba(200,168,78,0.5),0 0 28px rgba(200,168,78,0.2),0 2px 8px rgba(0,0,0,0.9);">${name}</div>` +
      (sub ? `<div style="margin-top:6px;font:600 13px ${FONT_MONO};color:#b9a888;letter-spacing:2px;">${sub}</div>` : '');
    areaEl.style.display = 'block';
    areaEl.style.animation = 'none';
    void areaEl.offsetWidth;
    areaEl.style.animation = 'hf-area 2.6s ease-out forwards';
    if (areaTimer) window.clearTimeout(areaTimer);
    areaTimer = window.setTimeout(() => { areaEl.style.display = 'none'; }, 2600);
  };

  let bannerTimer: number | undefined;
  const banner = (text: string, color = GOLD_BRIGHT, ms = 1600) => {
    bannerEl.textContent = text;
    bannerEl.style.color = color;
    bannerEl.style.display = 'block';
    bannerEl.style.animation = 'none';
    void bannerEl.offsetWidth;
    bannerEl.style.animation = `hf-banner ${ms / 1000}s ease-out forwards`;
    if (bannerTimer) window.clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => { bannerEl.style.display = 'none'; }, ms);
  };

  const floatText = (text: string, sx: number, sy: number, style?: { color?: string; size?: number }) => {
    // screenX/Y are canvas-local (== mount-local when uiRoot matches viewport).
    const p = document.createElement('div');
    p.textContent = text;
    p.style.cssText = `position:absolute;left:${sx}px;top:${sy}px;transform:translate(-50%,-100%);` +
      `color:${style?.color ?? '#ffe28a'};font:800 ${style?.size ?? 18}px ${FONT_UI};` +
      'text-shadow:0 1px 3px #000;white-space:nowrap;pointer-events:none;' +
      'animation:hf-float-rise 0.85s ease-out forwards;';
    popups.appendChild(p);
    setTimeout(() => p.remove(), 900);
  };

  const damageFlash = () => {
    dmgFlash.style.animation = 'none';
    void dmgFlash.offsetWidth;
    dmgFlash.style.animation = 'hf-dmg 0.5s ease-out';
  };

  const showDeath = (deathShow: boolean) => {
    deathEl.style.display = deathShow ? 'flex' : 'none';
  };

  const setOrbMotion = (on: boolean) => {
    for (const w of [...hp.waves, ...mp.waves]) w.style.animation = on ? '' : 'none';
    hp.glow.style.animation = on ? '' : 'none';
    mp.glow.style.animation = on ? '' : 'none';
    for (const s of [hp.surface, mp.surface]) {
      for (const anim of s.querySelectorAll('animate')) {
        (anim as SVGAnimateElement).setAttribute('repeatCount', on ? 'indefinite' : '0');
      }
    }
  };

  setOrbs(80, 80, 50, 50);
  setXp(1, 0, 60);
  setGold(0);
  setKills(0);

  return {
    apply, setOrbs, setXp, setGold, setKills, setSkills, setQuest, setBoss,
    setTarget, setShowcaseReduced,
    setAreaLabel, showArea, banner, floatText, damageFlash, showDeath, setOrbMotion,
    hide: () => { root.style.display = 'none'; },
    show: () => { root.style.display = ''; },
    dispose: () => {
      if (areaTimer) window.clearTimeout(areaTimer);
      if (bannerTimer) window.clearTimeout(bannerTimer);
      root.remove();
    },
  };
}
