// C character / combat-stat sheet — left-dock painted frame (C).
// Frame as overlay img; content well keeps title/power/footer pinned and only
// the stat list scrolls (forged .hf-scroll chrome — never native white bars).

import type { CombatStats } from './combat-stats';
import { HudArt } from './hud-art';
import {
  FONT_DISPLAY, FONT_UI, Z, goldDividerHtml, titleBandCss,
} from './ui-theme';
import { ensureUiStyles } from './ui-styles';

export interface CharacterPanelViewModel {
  readonly playerName: string;
  readonly className: string;
  readonly level: number;
  readonly unspentSkillPoints: number;
  /** Σ equipped item scores (items.ts Item.score) — honest equipment power. */
  readonly equipScore: number;
  /** Invested skill points (Σ skillRanks) — honest skill contribution. */
  readonly skillInvested: number;
  readonly stats: CombatStats;
}

export interface CharacterStatRow {
  readonly label: string;
  readonly value: string;
}

export interface CharacterStatGroup {
  readonly title: string;
  readonly rows: readonly CharacterStatRow[];
}

export interface CharacterPanelHandle {
  update(vm: CharacterPanelViewModel): void;
  show(): void;
  hide(): void;
  isOpen(): boolean;
  dispose(): void;
}

const PANEL_ID = 'hellforge-character-panel';

/**
 * Display-only combat power heuristic (NOT gameplay authority): a dps proxy
 * (global dmg × crit expectation × 10) + an EHP proxy (hp / (1-DR) × 0.3)
 * + equipment score. Level/skill contributions are flat rates for context.
 */
export function computeCombatPower(
  stats: CombatStats,
  equipScore: number,
  level: number,
  skillInvested: number,
): { total: number; equip: number; level: number; skill: number } {
  const dpsProxy = stats.globalDamageMul * (1 + stats.critChance * (stats.critMultiplier - 1)) * 10;
  const ehpProxy = (stats.maxHp / Math.max(0.05, 1 - stats.damageReduction)) * 0.3;
  const equip = Math.round(equipScore);
  const lv = level * 8;
  const skill = skillInvested * 12;
  return { total: Math.round(dpsProxy + ehpProxy) + equip + lv + skill, equip, level: lv, skill };
}

/** Grouped stat sections (aidiablo 攻击/防御/其他 layout). */
export function buildCharacterStatGroups(stats: CombatStats): readonly CharacterStatGroup[] {
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
  return [
    {
      title: '攻击',
      rows: [
        { label: '全局伤害', value: pct(stats.globalDamageMul) },
        { label: '火焰伤害', value: pct(stats.fireDamageMul) },
        { label: '冰霜伤害', value: pct(stats.frostDamageMul) },
        { label: '奥术伤害', value: pct(stats.arcDamageMul) },
        { label: '暴击率', value: pct(stats.critChance) },
        { label: '暴击倍率', value: `${stats.critMultiplier.toFixed(2)}×` },
        { label: '冷却倍率', value: pct(stats.cooldownMul) },
      ],
    },
    {
      title: '防御',
      rows: [
        { label: '生命上限', value: String(Math.round(stats.maxHp)) },
        { label: '法力上限', value: String(Math.round(stats.maxMana)) },
        { label: '生命回复', value: `${stats.hpRegen.toFixed(1)}/s` },
        { label: '法力回复', value: `${stats.manaRegen.toFixed(1)}/s` },
        { label: '伤害减免', value: pct(stats.damageReduction) },
        { label: '移动速度', value: pct(stats.moveSpeed) },
      ],
    },
    {
      title: '其他',
      rows: [
        { label: '金币发现', value: pct(1 + stats.goldFind) },
        { label: '魔法发现', value: pct(1 + stats.magicFind) },
        { label: '经验加成', value: pct(1 + stats.xpGain) },
        { label: '击杀吸血', value: String(Math.round(stats.lifeOnKill)) },
      ],
    },
  ];
}

/** Flat rows (kept for the existing test surface). */
export function buildCharacterStatRows(stats: CombatStats): readonly CharacterStatRow[] {
  const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
  return [
    { label: '生命上限', value: String(Math.round(stats.maxHp)) },
    { label: '法力上限', value: String(Math.round(stats.maxMana)) },
    { label: '生命回复', value: `${stats.hpRegen.toFixed(1)}/s` },
    { label: '法力回复', value: `${stats.manaRegen.toFixed(1)}/s` },
    { label: '移动速度', value: pct(stats.moveSpeed) },
    { label: '伤害减免', value: pct(stats.damageReduction) },
    { label: '全局伤害', value: pct(stats.globalDamageMul) },
    { label: '火焰伤害', value: pct(stats.fireDamageMul) },
    { label: '冰霜伤害', value: pct(stats.frostDamageMul) },
    { label: '奥术伤害', value: pct(stats.arcDamageMul) },
    { label: '暴击率', value: pct(stats.critChance) },
    { label: '暴击倍率', value: `${stats.critMultiplier.toFixed(2)}×` },
    { label: '冷却倍率', value: pct(stats.cooldownMul) },
    { label: '金币发现', value: pct(1 + stats.goldFind) },
    { label: '魔法发现', value: pct(1 + stats.magicFind) },
    { label: '经验加成', value: pct(1 + stats.xpGain) },
    { label: '击杀吸血', value: String(Math.round(stats.lifeOnKill)) },
  ];
}

export function installCharacterPanel(mount: HTMLElement = document.body): CharacterPanelHandle {
  ensureUiStyles();
  document.getElementById(PANEL_ID)?.remove();
  const scoped = mount !== document.body;
  const posKind = scoped ? 'absolute' : 'fixed';

  const root = document.createElement('div');
  root.id = PANEL_ID;
  root.style.cssText =
    `position:${posKind};left:0;top:0;width:min(400px,90vw);height:calc(100% - 168px);` +
    `z-index:${Z.characterPanel};display:none;pointer-events:auto;user-select:none;` +
    `font:600 13px ${FONT_UI};color:#e0d8cc;` +
    'border:0;box-shadow:10px 0 30px rgba(0,0,0,0.7);overflow:hidden;background:rgba(10,7,5,0.96);';

  const frame = document.createElement('img');
  frame.src = HudArt.panelCharacter();
  frame.alt = '';
  frame.draggable = false;
  frame.style.cssText =
    'position:absolute;inset:0;width:100%;height:100%;object-fit:fill;pointer-events:none;z-index:0;';

  // Content well inset clears anvil ornaments — no title/footer clipping.
  const well = document.createElement('div');
  well.style.cssText =
    'position:absolute;inset:44px 30px 46px 28px;z-index:1;display:flex;flex-direction:column;' +
    'background:rgba(8,6,4,0.9);border:1px solid rgba(224,184,74,0.14);' +
    'box-shadow:inset 0 0 28px rgba(0,0,0,0.5);min-height:0;';

  const header = document.createElement('div');
  header.style.cssText = 'flex:none;padding:12px 14px 8px;box-sizing:border-box;';

  const title = document.createElement('div');
  title.textContent = '角色属性';
  title.style.cssText = titleBandCss() + 'padding:4px 0;';
  const identity = document.createElement('div');
  identity.style.cssText = `text-align:center;font:500 12px ${FONT_UI};color:#8a8580;margin-top:4px;`;
  const divider = document.createElement('div');
  divider.innerHTML = goldDividerHtml(6);

  const power = document.createElement('div');
  power.style.cssText =
    'margin:6px 0 0;padding:8px 12px;text-align:center;' +
    'background:linear-gradient(135deg,rgba(30,22,10,0.7) 0%,rgba(45,33,15,0.6) 50%,rgba(30,22,10,0.7) 100%);' +
    'border:1px solid rgba(212,176,90,0.25);border-radius:3px;' +
    'box-shadow:inset 0 0 16px rgba(0,0,0,0.4);';
  header.append(title, identity, divider, power);

  const scroll = document.createElement('div');
  scroll.className = 'hf-scroll';
  scroll.style.cssText =
    'flex:1 1 auto;min-height:0;overflow-x:hidden;overflow-y:auto;' +
    'overscroll-behavior:contain;padding:4px 12px 8px;';

  const sections = document.createElement('div');
  sections.style.cssText = 'display:flex;flex-direction:column;gap:10px;';
  scroll.appendChild(sections);

  const footer = document.createElement('div');
  footer.style.cssText =
    'flex:none;text-align:center;font-size:11px;color:#6a6058;padding:8px 12px 10px;' +
    'border-top:1px solid rgba(224,184,74,0.2);';
  footer.innerHTML =
    '<span style="color:#d4b05a;font-weight:800;letter-spacing:1px;">[C]</span> 关闭';

  well.append(header, scroll, footer);
  root.append(frame, well);
  mount.appendChild(root);

  let open = false;
  let last: CharacterPanelViewModel | null = null;

  const paint = (vm: CharacterPanelViewModel): void => {
    identity.innerHTML =
      `${escapeHtml(vm.playerName)} — <span style="color:#d4b05a;">Lv ${vm.level} · ${escapeHtml(vm.className)}</span>` +
      (vm.unspentSkillPoints > 0 ? ` · <span style="color:#44ff88;">未分配 ${vm.unspentSkillPoints} 点</span>` : '');

    const p = computeCombatPower(vm.stats, vm.equipScore, vm.level, vm.skillInvested);
    const contrib = (label: string, value: number, color: string): string =>
      `<div style="background:rgba(0,0,0,0.3);border-radius:3px;padding:3px 2px;">` +
      `<div style="font-size:9px;color:#8a7860;">${label}</div>` +
      `<div style="font-size:12px;font-weight:bold;color:${color};">${value}</div></div>`;
    power.innerHTML =
      `<div style="font-size:11px;color:#a09070;letter-spacing:2px;">综合战力</div>` +
      `<div style="font-size:26px;font-weight:bold;color:#d4b05a;text-shadow:0 0 12px rgba(212,176,90,0.4),0 2px 4px rgba(0,0,0,0.8);">${p.total}</div>` +
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:6px;">` +
      contrib('装备贡献', p.equip, '#d4b05a') +
      contrib('等级贡献', p.level, '#88aacc') +
      contrib('技能贡献', p.skill, '#aa88cc') +
      `</div>`;

    sections.replaceChildren();
    for (const g of buildCharacterStatGroups(vm.stats)) {
      const sec = document.createElement('div');
      sec.innerHTML =
        `<div style="color:#f0c840;font:800 11px ${FONT_DISPLAY};padding:5px 8px;letter-spacing:2px;` +
        `background:linear-gradient(90deg,rgba(70,50,22,0.55) 0%,rgba(40,30,18,0.2) 70%,transparent 100%);` +
        `border-left:3px solid #d4b05a;text-shadow:0 1px 2px #000;">${g.title}</div>`;
      const rows = document.createElement('div');
      rows.style.cssText = 'display:flex;flex-direction:column;padding:2px 4px;';
      for (const row of g.rows) {
        const el = document.createElement('div');
        el.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;' +
          'padding:3px 5px;gap:10px;border-bottom:1px solid rgba(255,255,255,0.03);';
        const lab = document.createElement('span');
        lab.textContent = row.label;
        lab.style.cssText = `font:500 12px ${FONT_UI};color:#8a8070;`;
        const val = document.createElement('span');
        val.textContent = row.value;
        val.style.cssText = `font:700 12px ${FONT_UI};color:#f0e2c4;` +
          'font-variant-numeric:tabular-nums;text-shadow:0 1px 1px #000;';
        el.append(lab, val);
        rows.appendChild(el);
      }
      sec.appendChild(rows);
      sections.appendChild(sec);
    }
  };

  return {
    update(vm) {
      last = vm;
      if (open) paint(vm);
    },
    show() {
      open = true;
      root.style.display = 'block';
      if (last) paint(last);
    },
    hide() {
      open = false;
      root.style.display = 'none';
    },
    isOpen: () => open,
    dispose() {
      root.remove();
      open = false;
      last = null;
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
