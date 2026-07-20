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

import type { EquipSlotState, HudViewModel, SkillSlotState, TargetViewModel } from './hud-view-model';
import { FONT_UI, FONT_MONO, Ui } from './ui-theme';

export type { EquipSlotState, HudViewModel, SkillSlotState, TargetViewModel } from './hud-view-model';

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
  setEquipment(slots: EquipSlotState[]): void;
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
  hide(): void;
  show(): void;
  dispose(): void;
}

const HUD_ID = 'hellforge-hud';
const GOLD = Ui.gold;
const GOLD_BRIGHT = Ui.goldBright;

export function installHud(mount: HTMLElement = document.body): HudHandle {
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

  // ── bottom D2 bar (fills mount width; height fixed — viewport-relative) ──
  const bar = document.createElement('div');
  bar.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:150px;' +
    'display:flex;align-items:flex-end;justify-content:center;gap:4px;padding:0 8px 6px;box-sizing:border-box;';

  const stoneStatue = (mirror: boolean): HTMLDivElement => {
    const wrap = document.createElement('div');
    wrap.style.cssText = `width:48px;height:120px;flex:none;display:flex;align-items:flex-end;justify-content:center;` +
      (mirror ? 'transform:scaleX(-1);' : '');
    wrap.innerHTML = `<svg viewBox="0 0 55 130" width="48" height="120">
      <rect x="5" y="110" width="45" height="20" rx="2" fill="#3a3632" stroke="#4a4640"/>
      <path d="M15 110 L12 70 L8 55 L14 30 L20 20 L27 15 L35 20 L40 30 L46 55 L42 70 L40 110Z" fill="#3a3632" stroke="#4a4640"/>
      <path d="M14 50 L2 30 L4 45 L8 55Z" fill="#3a3632"/><path d="M40 50 L52 30 L50 45 L46 55Z" fill="#3a3632"/>
      <ellipse cx="27" cy="15" rx="10" ry="12" fill="#3a3632" stroke="#4a4640"/>
      <ellipse cx="23" cy="13" rx="2" ry="1.5" fill="#1a1816"/><ellipse cx="31" cy="13" rx="2" ry="1.5" fill="#1a1816"/>
      <path d="M20 5 L17 -2 L22 8Z" fill="#4a4640"/><path d="M34 5 L37 -2 L32 8Z" fill="#4a4640"/>
    </svg>`;
    return wrap;
  };

  type OrbParts = {
    wrap: HTMLDivElement;
    fill: HTMLDivElement;
    txt: HTMLDivElement;
  };
  /**
   * Forged brass bezel + glass well. Kept STATIC on purpose: CSS filter +
   * infinite wave/glow animations under the previous drop-shadow forced the
   * browser to re-rasterize both orbs every frame and stole GPU from WebGPU.
   */
  const makeOrb = (kind: 'hp' | 'mp'): OrbParts => {
    const isHp = kind === 'hp';
    const accent = isHp ? '#c45a3a' : '#4a6ec8';
    const accentDeep = isHp ? '#6a2010' : '#1a2858';
    const liquid = isHp
      ? 'linear-gradient(0deg,#4a0606 0%,#8a1010 28%,#c42822 62%,#e85840 88%,#ffb090 100%)'
      : 'linear-gradient(0deg,#06062a 0%,#101868 28%,#2840c0 62%,#4a72e0 88%,#a0c8ff 100%)';
    const meniscus = isHp ? 'rgba(255,140,100,0.55)' : 'rgba(140,180,255,0.5)';
    const glow = isHp ? 'rgba(220,60,20,0.22)' : 'rgba(40,80,220,0.22)';

    const wrap = document.createElement('div');
    // Cheap box-shadow only — never filter:drop-shadow (invalidates every anim).
    wrap.style.cssText = 'position:relative;width:118px;height:118px;flex:none;' +
      'contain:layout paint;box-shadow:0 4px 10px rgba(0,0,0,0.55);';

    const rim = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    rim.setAttribute('viewBox', '0 0 118 118');
    rim.setAttribute('width', '118');
    rim.setAttribute('height', '118');
    rim.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:3;';
    rim.innerHTML = `
      <defs>
        <linearGradient id="hf-orb-brass-${kind}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="#f0d878"/>
          <stop offset="35%" stop-color="#a07830"/>
          <stop offset="70%" stop-color="#c8a84e"/>
          <stop offset="100%" stop-color="#3a2a12"/>
        </linearGradient>
        <linearGradient id="hf-orb-brass-hi-${kind}" x1="0.1" y1="0" x2="0.9" y2="1">
          <stop offset="0%" stop-color="#fff6d0" stop-opacity="0.9"/>
          <stop offset="45%" stop-color="#6a4e22" stop-opacity="0.12"/>
          <stop offset="100%" stop-color="#1a1008" stop-opacity="0.9"/>
        </linearGradient>
        <linearGradient id="hf-orb-accent-${kind}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${accent}"/>
          <stop offset="100%" stop-color="${accentDeep}"/>
        </linearGradient>
        <linearGradient id="hf-orb-iron-${kind}" x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0%" stop-color="#4a443c"/>
          <stop offset="100%" stop-color="#0c0a08"/>
        </linearGradient>
      </defs>
      <path fill="url(#hf-orb-iron-${kind})" fill-rule="evenodd"
        d="M59,0.5 A58.5,58.5 0 1,1 58.9,0.5 Z M59,16 A43,43 0 1,0 59.1,16 Z"/>
      <circle cx="59" cy="59" r="51" fill="none" stroke="url(#hf-orb-brass-${kind})" stroke-width="11"/>
      <circle cx="59" cy="59" r="51" fill="none" stroke="url(#hf-orb-brass-hi-${kind})" stroke-width="11"/>
      <circle cx="59" cy="59" r="56.8" fill="none" stroke="#0a0806" stroke-width="1.2"/>
      <circle cx="59" cy="59" r="45.4" fill="none" stroke="#120c06" stroke-width="1.6"/>
      <circle cx="59" cy="59" r="44.2" fill="none" stroke="rgba(240,216,120,0.35)" stroke-width="0.9"/>
      <circle cx="59" cy="59" r="42.8" fill="none" stroke="url(#hf-orb-accent-${kind})" stroke-width="2.8"/>
      ${[0, 90, 180, 270].map((deg) => {
        const rad = (deg * Math.PI) / 180;
        const x = 59 + Math.cos(rad) * 51;
        const y = 59 + Math.sin(rad) * 51;
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.6" fill="#e8c878" stroke="#3a2a12" stroke-width="0.8"/>`;
      }).join('')}
    `;

    const well = document.createElement('div');
    well.style.cssText = 'position:absolute;left:18px;top:18px;right:18px;bottom:18px;border-radius:50%;' +
      'overflow:hidden;z-index:1;' +
      `background:radial-gradient(circle at 40% 32%,${isHp ? '#2a0808' : '#08081a'} 0%,#050304 70%,#000 100%);` +
      'box-shadow:inset 0 0 16px rgba(0,0,0,0.9),inset 0 1px 0 rgba(232,200,120,0.15);';

    const fill = document.createElement('div');
    fill.style.cssText = 'position:absolute;left:0;bottom:0;width:100%;height:60%;transition:height 0.2s;overflow:hidden;';
    const liquidEl = document.createElement('div');
    liquidEl.style.cssText = `position:absolute;inset:0;background:${liquid};` +
      'box-shadow:inset 0 6px 12px rgba(255,255,255,0.1),inset 0 -10px 14px rgba(0,0,0,0.4);';
    // Static meniscus line (no CSS animation).
    const meniscusEl = document.createElement('div');
    meniscusEl.style.cssText = `position:absolute;left:-8%;right:-8%;top:-5px;height:10px;border-radius:50%;` +
      `background:${meniscus};opacity:0.85;`;
    fill.append(liquidEl, meniscusEl);

    const glowEl = document.createElement('div');
    glowEl.style.cssText = 'position:absolute;inset:0;border-radius:50%;pointer-events:none;z-index:2;' +
      `background:radial-gradient(circle at 50% 78%,${glow} 0%,transparent 55%);`;

    const glass = document.createElement('div');
    glass.style.cssText = 'position:absolute;inset:18px;border-radius:50%;pointer-events:none;z-index:4;' +
      'background:linear-gradient(145deg,rgba(255,255,255,0.38) 0%,rgba(255,255,255,0.08) 22%,' +
      'transparent 40%,transparent 62%,rgba(0,0,0,0.35) 100%);';
    const sheen = document.createElement('div');
    sheen.style.cssText = 'position:absolute;left:30px;top:24px;width:26px;height:16px;border-radius:50%;' +
      'pointer-events:none;z-index:5;' +
      'background:radial-gradient(ellipse at 40% 40%,rgba(255,255,255,0.7) 0%,rgba(255,255,255,0.12) 45%,transparent 70%);';

    const txt = document.createElement('div');
    txt.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      `font:700 17px ${FONT_MONO};color:#fff;z-index:6;pointer-events:none;` +
      'text-shadow:0 0 6px #000,0 1px 2px #000;';

    well.appendChild(fill);
    wrap.append(rim, well, glowEl, glass, sheen, txt);
    return { wrap, fill, txt };
  };

  const hp = makeOrb('hp');
  const mp = makeOrb('mp');

  // Centre metal plate
  const mid = document.createElement('div');
  mid.style.cssText = 'flex:0 1 420px;max-width:min(420px,52%);min-width:200px;height:132px;display:flex;flex-direction:column;' +
    'justify-content:flex-end;gap:5px;padding:8px 14px 10px;box-sizing:border-box;' +
    `background:linear-gradient(180deg,${Ui.inkPanelHi} 0%,${Ui.inkPanel} 100%);` +
    `border:2px solid ${GOLD};border-image:linear-gradient(180deg,${Ui.goldBright},${Ui.goldDeep} 40%,#3a2a12) 1;` +
    `box-shadow:inset 0 1px 0 ${Ui.goldLineSoft},0 0 0 1px ${Ui.goldDeep},0 4px 16px rgba(0,0,0,0.55);`;

  const xpBar = document.createElement('div');
  xpBar.style.cssText = 'width:100%;height:8px;border-radius:2px;overflow:hidden;' +
    `background:${Ui.inkWell};border:1px solid ${Ui.goldLineSoft};`;
  const xpFill = document.createElement('div');
  xpFill.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#5a2a8a,#b06ad4,#e8b0ff);transition:width 0.2s;';
  xpBar.appendChild(xpFill);

  const orbReadout = document.createElement('div');
  orbReadout.style.cssText = `display:flex;justify-content:space-between;font:700 11px ${FONT_MONO};` +
    `color:${GOLD};text-shadow:0 1px 2px #000;`;
  const hpRead = document.createElement('span');
  const mpRead = document.createElement('span');
  orbReadout.append(hpRead, mpRead);

  const slotsRow = document.createElement('div');
  slotsRow.style.cssText = 'display:flex;gap:7px;justify-content:center;';

  type SkillDom = {
    root: HTMLDivElement;
    icon: HTMLDivElement;
    key: HTMLDivElement;
    cost: HTMLDivElement;
    veil: HTMLDivElement;
  };
  const skillDom: SkillDom[] = [];
  const ensureSkillSlots = (n: number): void => {
    while (skillDom.length < n) {
      const root = document.createElement('div');
      root.style.cssText = 'position:relative;width:52px;height:52px;border-radius:4px;overflow:hidden;' +
        `background:rgba(12,8,6,0.95);border:2px solid ${GOLD};` +
        'display:flex;align-items:center;justify-content:center;';
      const icon = document.createElement('div');
      icon.style.cssText = 'font-size:22px;line-height:1;';
      const key = document.createElement('div');
      key.style.cssText = `position:absolute;bottom:1px;right:3px;font:700 10px ${FONT_MONO};color:${GOLD_BRIGHT};text-shadow:0 1px 2px #000;`;
      const cost = document.createElement('div');
      cost.style.cssText = `position:absolute;top:1px;left:3px;font:700 9px ${FONT_MONO};color:#7da2ff;text-shadow:0 1px 2px #000;`;
      const veil = document.createElement('div');
      veil.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:0%;background:rgba(0,0,0,0.62);pointer-events:none;';
      root.append(icon, key, cost, veil);
      slotsRow.appendChild(root);
      skillDom.push({ root, icon, key, cost, veil });
    }
    while (skillDom.length > n) {
      const last = skillDom.pop()!;
      last.root.remove();
    }
  };

  const metaRow = document.createElement('div');
  metaRow.style.cssText = `display:flex;gap:12px;justify-content:center;flex-wrap:wrap;font:700 11px ${FONT_MONO};` +
    `color:${GOLD};text-shadow:0 1px 2px #000;`;
  const lvlEl = document.createElement('span');
  const xpEl = document.createElement('span');
  const goldEl = document.createElement('span');
  const killsEl = document.createElement('span');
  const areaMeta = document.createElement('span');
  areaMeta.style.color = Ui.textMuted;
  metaRow.append(lvlEl, xpEl, goldEl, killsEl, areaMeta);

  mid.append(xpBar, orbReadout, slotsRow, metaRow);

  const equipCol = document.createElement('div');
  equipCol.style.cssText = 'display:grid;grid-template-columns:repeat(2,30px);gap:4px;margin-bottom:8px;flex:none;';

  const leftCluster = document.createElement('div');
  leftCluster.style.cssText = 'display:flex;align-items:flex-end;flex:none;';
  leftCluster.append(stoneStatue(false), hp.wrap);

  const rightCluster = document.createElement('div');
  rightCluster.style.cssText = 'display:flex;align-items:flex-end;flex:none;gap:6px;';
  rightCluster.append(mp.wrap, stoneStatue(true), equipCol);

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
    '<b>WASD</b> 移动 · <b>左键</b> 互动 · <b>右键</b> 施法 · <b>1-4</b> 选技<br>' +
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
    `<div style="font:600 15px ${FONT_UI};color:#daa">按 <b style="color:#fff">R</b> 在余烬哨站复活（损失少量经验）</div>`;

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
    hpRead.textContent = `HP ${hpN}/${Math.ceil(maxHp)}`;
    mpRead.textContent = `MP ${mpN}/${Math.floor(maxMana)}`;
  };

  const setXp = (level: number, cur: number, max: number) => {
    if (lastXp.level === level && lastXp.cur === cur && lastXp.max === max) return;
    lastXp = { level, cur, max };
    lvlEl.textContent = `Lv ${level}`;
    xpEl.textContent = `XP ${cur}/${max}`;
    xpFill.style.width = `${Math.max(0, Math.min(100, max > 0 ? (cur / max) * 100 : 0)).toFixed(1)}%`;
  };

  const setGold = (n: number) => {
    if (lastGold === n) return;
    lastGold = n;
    goldEl.textContent = `★ ${n}`;
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
    ensureSkillSlots(slots.length);
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i]!;
      const d = skillDom[i]!;
      d.icon.textContent = s.empty ? '·' : s.icon;
      d.key.textContent = s.key;
      d.root.title = s.name;
      const border = s.selected
        ? GOLD_BRIGHT
        : (s.locked || s.empty) ? 'rgba(90,80,70,0.5)' : GOLD;
      d.root.style.borderColor = border;
      d.root.style.boxShadow = s.selected ? `0 0 0 1px ${GOLD_BRIGHT}, 0 0 10px rgba(255,200,80,0.35)` : '';
      d.root.style.filter = (s.locked || s.empty) ? 'grayscale(0.9) brightness(0.55)' : '';
      d.root.style.opacity = (s.locked || s.empty) ? '0.75' : (!s.affordable ? '0.85' : '1');
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

  const setEquipment = (slots: EquipSlotState[]) => {
    // Cheap rebuild — ≤6 silhouette chips (matches inventory paper-doll slots).
    equipCol.innerHTML = '';
    for (const s of slots) {
      const empty = s.empty ?? !s.color;
      const el = document.createElement('div');
      el.style.cssText = 'position:relative;width:30px;height:30px;border-radius:5px;' +
        `background:${Ui.inkWell};border:2px solid ${s.color ?? Ui.goldLineSoft};` +
        'display:flex;align-items:center;justify-content:center;font-size:13px;pointer-events:auto;' +
        (empty ? 'filter:grayscale(0.9) brightness(0.55);opacity:0.75;' : '');
      el.textContent = s.icon;
      el.title = s.tooltip || s.slotLabel || '';
      equipCol.appendChild(el);
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
    // Combat chrome: skill bar + equip chips + kill meta + target/boss. Orbs/XP stay dim.
    slotsRow.style.display = reduced ? 'none' : 'flex';
    equipCol.style.display = reduced ? 'none' : 'grid';
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
    setEquipment(vm.equipment);
    setQuest(vm.quest);
    setAreaLabel(vm.areaName);
    if (vm.boss) setBoss(vm.boss.name, vm.boss.hp, vm.boss.maxHp);
    else setBoss(null);
    setTarget(vm.target);
  };

  let areaTimer: number | undefined;
  const showArea = (name: string, sub?: string) => {
    setAreaLabel(name);
    areaEl.innerHTML = `<div style="font:900 40px ui-serif,Georgia,serif;color:${Ui.goldBright};letter-spacing:8px;` +
      `text-shadow:0 0 22px rgba(230,180,90,0.55),0 4px 12px #000;">${name}</div>` +
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

  setOrbs(80, 80, 50, 50);
  setXp(1, 0, 60);
  setGold(0);
  setKills(0);

  return {
    apply, setOrbs, setXp, setGold, setKills, setSkills, setEquipment, setQuest, setBoss,
    setTarget, setShowcaseReduced,
    setAreaLabel, showArea, banner, floatText, damageFlash, showDeath,
    hide: () => { root.style.display = 'none'; },
    show: () => { root.style.display = ''; },
    dispose: () => {
      if (areaTimer) window.clearTimeout(areaTimer);
      if (bannerTimer) window.clearTimeout(bannerTimer);
      root.remove();
    },
  };
}
