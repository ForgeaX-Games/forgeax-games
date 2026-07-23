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
import { FONT_DISPLAY, FONT_UI, FONT_MONO, Ui } from './ui-theme';
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
  document.getElementById(HUD_ID)?.remove();
  const root = document.createElement('div');
  root.id = HUD_ID;
  // Viewport-local when host passes #game-ui-root; fixed only on body fallback.
  const rootAbsolute = mount !== document.body;
  root.style.cssText = `position:${rootAbsolute ? 'absolute' : 'fixed'};inset:0;z-index:50;overflow:hidden;pointer-events:none;user-select:none;` +
    `font:600 13px ${FONT_MONO};color:${Ui.text};`;

  if (!document.getElementById('hellforge-hud-style')) {
    const s = document.createElement('style');
    s.id = 'hellforge-hud-style';
    s.textContent = `
      @keyframes hf-float-rise {
        0% { opacity:1; transform:translate(-50%,-100%) scale(1.1); }
        100% { opacity:0; transform:translate(-50%,-100%) translateY(-46px) scale(0.9); }
      }
      @keyframes hf-banner {
        0% { opacity:0; transform:translate(-50%,-50%) scale(0.7); }
        18% { opacity:1; transform:translate(-50%,-50%) scale(1.08); }
        32% { opacity:1; transform:translate(-50%,-50%) scale(1); }
        82% { opacity:1; }
        100% { opacity:0; transform:translate(-50%,-50%) scale(1.04); }
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
    `;
    document.head.appendChild(s);
  }

  // ── bottom D2 bar — 1:1 aidiablo replica (extracted recipe, see plan §R1) ──
  const bar = document.createElement('div');
  bar.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:150px;' +
    'display:flex;align-items:flex-end;justify-content:center;overflow:visible;';

  /** aidiablo gargoyle — 55×130 SVG with stoneGrad torso + horns + wings. */
  const gargoyle = (mirror: boolean): HTMLDivElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = `width:55px;height:130px;flex:none;` +
      (mirror ? 'transform:scaleX(-1);' : '') +
      'filter:drop-shadow(2px 2px 4px rgba(0,0,0,0.7));';
    wrap.innerHTML = `<svg viewBox="0 0 55 130" width="55" height="130">
      <defs>
        <linearGradient id="hf-garg-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#4a4640"/><stop offset="50%" stop-color="#3a3632"/><stop offset="100%" stop-color="#2e2a28"/>
        </linearGradient>
      </defs>
      <rect x="5" y="110" width="45" height="20" rx="2" fill="#3a3632" stroke="#4a4640"/>
      <rect x="9" y="114" width="37" height="12" rx="1" fill="#2e2a28"/>
      <path d="M15 110 L12 70 L8 55 L14 30 L20 20 L27 15 L35 20 L40 30 L46 55 L42 70 L40 110Z" fill="url(#hf-garg-grad)" stroke="#4a4640"/>
      <path d="M14 50 L2 30 L4 45 L8 55Z" fill="#3a3632" stroke="#2e2a28"/>
      <path d="M40 50 L52 30 L50 45 L46 55Z" fill="#3a3632" stroke="#2e2a28"/>
      <ellipse cx="27" cy="15" rx="10" ry="12" fill="url(#hf-garg-grad)" stroke="#4a4640"/>
      <ellipse cx="23" cy="13" rx="2" ry="1.5" fill="#1a1816"/><ellipse cx="31" cy="13" rx="2" ry="1.5" fill="#1a1816"/>
      <path d="M20 5 L17 -2 L22 8Z" fill="#4a4640"/><path d="M34 5 L37 -2 L32 8Z" fill="#4a4640"/>
    </svg>`;
    return wrap;
  };

  type OrbParts = {
    wrap: HTMLDivElement;
    fill: HTMLDivElement;
    txt: HTMLDivElement;
    waves: HTMLDivElement[];
    glow: HTMLDivElement;
  };
  /**
   * 130px life/mana orb — aidiablo recipe: 5px rim, liquid + TWO transform-only
   * waves (compositor-cheap, no filter animations), glass + pulsing inner glow.
   * setOrbMotion(false) freezes waves+glow for perf triage.
   */
  const makeOrb = (kind: 'hp' | 'mp'): OrbParts => {
    const isHp = kind === 'hp';
    const rimColor = isHp ? '#5a2a1a' : '#1a2a5a';
    const shadowCol = isHp ? 'rgba(120,20,10,0.4)' : 'rgba(10,20,120,0.4)';
    const liquid = isHp
      ? 'linear-gradient(0deg,#7a0a0a 0%,#aa1515 30%,#cc2222 60%,#dd3333 100%)'
      : 'linear-gradient(0deg,#0a0a6a 0%,#1525aa 30%,#2238cc 60%,#3350dd 100%)';
    const wave1Col = isHp ? 'rgba(220,50,50,0.6)' : 'rgba(50,80,220,0.6)';
    const wave2Col = isHp ? 'rgba(180,30,30,0.35)' : 'rgba(30,50,180,0.35)';
    const glowCol = isHp ? 'rgba(180,30,10,0.15)' : 'rgba(10,30,180,0.15)';

    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:relative;width:130px;height:130px;flex:none;border-radius:50%;overflow:hidden;' +
      `border:5px solid ${rimColor};background:${isHp ? '#0a0202' : '#02020a'};box-sizing:border-box;` +
      `box-shadow:inset 0 0 30px rgba(0,0,0,0.9),inset 0 -10px 20px ${shadowCol},` +
      `0 0 15px rgba(0,0,0,0.7),0 0 4px ${shadowCol},` +
      `inset 3px 3px 0 rgba(80,65,40,0.15),inset -3px -3px 0 rgba(0,0,0,0.5);`;

    const fill = document.createElement('div');
    fill.style.cssText = 'position:absolute;left:0;bottom:0;width:100%;height:60%;transition:height 0.3s;overflow:hidden;';
    const liquidEl = document.createElement('div');
    liquidEl.style.cssText = `position:absolute;inset:0;background:${liquid};border-radius:0 0 50% 50%;`;
    const wave1 = document.createElement('div');
    wave1.className = 'hf-orb-wave1';
    wave1.style.cssText = `position:absolute;top:-8px;left:-15%;width:130%;height:18px;border-radius:45% 40% 50% 42%;background:${wave1Col};`;
    const wave2 = document.createElement('div');
    wave2.className = 'hf-orb-wave2';
    wave2.style.cssText = `position:absolute;top:-5px;left:-10%;width:120%;height:14px;border-radius:42% 48% 40% 45%;opacity:0.5;background:${wave2Col};`;
    fill.append(liquidEl, wave1, wave2);

    const glow = document.createElement('div');
    glow.className = 'hf-orb-glow';
    glow.style.cssText = 'position:absolute;inset:0;border-radius:50%;pointer-events:none;' +
      `background:radial-gradient(circle at 50% 80%,${glowCol} 0%,transparent 60%);`;

    const glass = document.createElement('div');
    glass.style.cssText = 'position:absolute;inset:0;border-radius:50%;pointer-events:none;' +
      'background:radial-gradient(ellipse at 35% 25%,rgba(255,255,255,0.12) 0%,transparent 50%),' +
      'radial-gradient(ellipse at 65% 75%,rgba(0,0,0,0.3) 0%,transparent 50%);';

    const txt = document.createElement('div');
    txt.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'font-size:18px;font-weight:bold;color:#fff;pointer-events:none;' +
      'text-shadow:0 0 6px #000,0 0 12px #000,0 1px 2px #000;';

    wrap.append(fill, glow, glass, txt);
    return { wrap, fill, txt, waves: [wave1, wave2], glow };
  };

  const hp = makeOrb('hp');
  const mp = makeOrb('mp');

  // Centre stone plate — aidiablo recipe (grain + top border-image + top XP strip)
  const mid = document.createElement('div');
  mid.style.cssText = 'position:relative;flex:0 1 600px;max-width:min(600px,56%);min-width:280px;height:132px;' +
    'display:flex;flex-direction:column;justify-content:flex-end;gap:4px;padding:10px 12px 6px;box-sizing:border-box;' +
    'background:repeating-linear-gradient(90deg,transparent,transparent 3px,rgba(40,32,22,0.05) 3px,rgba(40,32,22,0.05) 6px),' +
    'linear-gradient(0deg,#2e2a26 0%,#383430 40%,#322e2a 70%,rgba(38,34,28,0.95) 90%,transparent 100%);' +
    'border-top:4px solid;' +
    'border-image:linear-gradient(90deg,transparent 0%,#5a4e42 10%,#4a4038 30%,#5a4e42 50%,#4a4038 70%,#5a4e42 90%,transparent 100%) 1;' +
    'box-shadow:inset 0 4px 8px rgba(80,65,45,0.15),inset 0 -2px 0 rgba(0,0,0,0.3),0 -4px 15px rgba(0,0,0,0.4);';

  const xpBar = document.createElement('div');
  xpBar.style.cssText = 'position:absolute;top:0;left:0;right:0;height:5px;background:rgba(0,0,0,0.5);border-bottom:1px solid #4a3a2a;';
  const xpFill = document.createElement('div');
  xpFill.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#6633aa,#9955ee);transition:width 0.3s;';
  xpBar.appendChild(xpFill);

  const orbReadout = document.createElement('div');
  orbReadout.style.cssText = 'display:flex;justify-content:space-between;padding:0 12px;margin-top:8px;font-size:11px;font-weight:bold;';
  const hpRead = document.createElement('span');
  hpRead.style.cssText = 'color:#cc6666;text-shadow:0 0 4px rgba(200,50,50,0.3);';
  const mpRead = document.createElement('span');
  mpRead.style.cssText = 'color:#6666cc;text-shadow:0 0 4px rgba(50,50,200,0.3);';
  orbReadout.append(hpRead, mpRead);

  const slotsRow = document.createElement('div');
  slotsRow.style.cssText = 'display:flex;gap:7px;justify-content:center;align-items:flex-end;';

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
      root.style.cssText = isPotion
        ? 'position:relative;width:40px;height:40px;border-radius:3px;overflow:hidden;' +
          `background:${slots[i]!.potion === 'life' ? 'rgba(60,10,10,0.7)' : 'rgba(10,10,60,0.7)'};` +
          `border:2px solid ${slots[i]!.potion === 'life' ? '#5a2a1a' : '#1a3a6a'};` +
          'display:flex;align-items:center;justify-content:center;pointer-events:auto;' +
          'box-shadow:inset 0 0 6px rgba(0,0,0,0.5);margin-bottom:6px;'
        : 'position:relative;width:52px;height:52px;border-radius:4px;overflow:hidden;' +
          'background:rgba(18,12,6,0.85);border:2px solid #c8a84e;' +
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
        const typeCol = s.icon === 'magma' ? '#ff8844' : s.icon === 'frost' ? '#44aaff'
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
    b.style.cssText = 'padding:1px 5px;background:rgba(18,12,6,0.85);border:1px solid #3a2518;border-radius:3px;' +
      'display:flex;flex-direction:column;align-items:center;gap:0;white-space:nowrap;line-height:1.1;cursor:pointer;';
    b.innerHTML = `<span style="font-size:10px;color:#8a7a5a;font-weight:bold;">${q.key}</span>` +
      `<span style="font-size:9px;color:${q.color};">${q.name}</span>`;
    b.addEventListener('mouseenter', () => {
      b.style.borderColor = '#c8a84e';
      b.style.background = 'rgba(40,30,16,0.9)';
    });
    b.addEventListener('mouseleave', () => {
      b.style.borderColor = '#3a2518';
      b.style.background = 'rgba(18,12,6,0.85)';
    });
    b.addEventListener('click', () => deps?.onQuickAction?.(q.action));
    quickRow.appendChild(b);
  }

  const metaRow = document.createElement('div');
  metaRow.style.cssText = 'display:flex;gap:12px;justify-content:center;flex-wrap:wrap;font-size:10px;color:#8a7a5a;';
  const lvlEl = document.createElement('span');
  const xpEl = document.createElement('span');
  const goldEl = document.createElement('span');
  goldEl.style.color = '#c8a84e';
  const killsEl = document.createElement('span');
  const areaMeta = document.createElement('span');
  areaMeta.style.color = '#5a4a3a';
  metaRow.append(lvlEl, xpEl, goldEl, killsEl, areaMeta);

  mid.append(xpBar, orbReadout, slotsRow, quickRow, metaRow);

  const leftCluster = document.createElement('div');
  leftCluster.style.cssText = 'display:flex;align-items:flex-end;flex:none;';
  leftCluster.append(gargoyle(false), hp.wrap);

  const rightCluster = document.createElement('div');
  rightCluster.style.cssText = 'display:flex;align-items:flex-end;flex:none;';
  rightCluster.append(mp.wrap, gargoyle(true));

  bar.append(leftCluster, mid, rightCluster);

  // ── top chrome ────────────────────────────────────────────────────────
  const questEl = document.createElement('div');
  questEl.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);max-width:min(520px,90%);' +
    `padding:5px 16px;border-radius:4px;background:${Ui.inkPanel};` +
    `border:1px solid ${GOLD};box-shadow:0 0 0 1px ${Ui.goldDeep};` +
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
  bannerEl.style.cssText = 'position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);display:none;' +
    `font:900 42px ${FONT_MONO};letter-spacing:4px;white-space:nowrap;` +
    'text-shadow:0 0 24px rgba(255,150,50,0.8),0 4px 12px rgba(0,0,0,0.7);';

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

  const setOrbs = (hpV: number, maxHp: number, mana: number, maxMana: number) => {
    const hpP = Math.max(0, Math.min(1, maxHp > 0 ? hpV / maxHp : 0));
    const mpP = Math.max(0, Math.min(1, maxMana > 0 ? mana / maxMana : 0));
    hp.fill.style.height = `${(hpP * 100).toFixed(1)}%`;
    mp.fill.style.height = `${(mpP * 100).toFixed(1)}%`;
    const hpN = Math.max(0, Math.ceil(hpV));
    const mpN = Math.floor(mana);
    hp.txt.textContent = `${hpN}`;
    mp.txt.textContent = `${mpN}`;
    hpRead.textContent = `生命: ${hpN} / ${Math.ceil(maxHp)}`;
    mpRead.textContent = `法力: ${mpN} / ${Math.floor(maxMana)}`;
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
      // aidiablo border states: ready #c8a84e / not-ready #5a3a1a / unlearned #4a3a2a
      const border = s.selected
        ? GOLD_BRIGHT
        : (s.locked || s.empty) ? '#4a3a2a' : (!s.affordable ? '#5a3a1a' : GOLD);
      d.root.style.borderColor = border;
      d.root.style.boxShadow = s.selected ? `0 0 0 1px ${GOLD_BRIGHT}, 0 0 10px rgba(255,200,80,0.35)` : '';
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
