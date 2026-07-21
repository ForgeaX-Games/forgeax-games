// C character / combat-stat sheet — 1:1 aidiablo left-dock stone slab (C).
// 420px full-height: pillar at the free (right) edge, amber-gem corners,
// combat-power block (装备/等级/技能 contributions), grouped stat sections.
// Exclusive major surface via UiLayerManager; never mutates domain state.

import type { CombatStats } from './combat-stats';
import {
  FONT_UI, Ui, Z, cornerOrnamentsHtml, d2PillarCss, d2StonePanelCss,
  goldDividerHtml, pillarRivetsHtml, titleBandCss,
} from './ui-theme';

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
  // Preserve the historical order (defense-first flat list) for compat.
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
  document.getElementById(PANEL_ID)?.remove();
  const scoped = mount !== document.body;
  const posKind = scoped ? 'absolute' : 'fixed';

  const root = document.createElement('div');
  root.id = PANEL_ID;
  root.style.cssText =
    `position:${posKind};left:0;top:0;width:min(420px,92vw);height:calc(100% - 150px);` +
    `z-index:${Z.characterPanel};display:none;pointer-events:auto;user-select:none;` +
    `font:600 13px ${FONT_UI};color:#e0d8cc;` +
    d2StonePanelCss() +
    'border-right:8px solid;border-image:linear-gradient(180deg,#5e5245 0%,#4e443a 15%,#3a3228 50%,#4e443a 85%,#5e5245 100%) 1;' +
    'box-shadow:inset 0 0 80px rgba(0,0,0,0.3),inset 3px 3px 0 rgba(90,75,50,0.2),inset -2px -2px 0 rgba(0,0,0,0.35),' +
    'inset 8px 0 16px rgba(0,0,0,0.15),inset 0 0 120px rgba(60,48,30,0.08),10px 0 30px rgba(0,0,0,0.7);' +
    'overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;';

  root.insertAdjacentHTML('beforeend', cornerOrnamentsHtml(6, 24));
  const pillar = document.createElement('div');
  pillar.style.cssText = 'position:absolute;right:-56px;top:0;width:56px;height:100%;pointer-events:none;' +
    d2PillarCss('right');
  pillar.insertAdjacentHTML('beforeend', pillarRivetsHtml());
  root.appendChild(pillar);

  const body = document.createElement('div');
  body.style.cssText = 'display:flex;flex-direction:column;gap:10px;padding:14px 22px 16px 18px;box-sizing:border-box;';

  const title = document.createElement('div');
  title.textContent = '角色属性';
  title.style.cssText = titleBandCss() + 'padding:4px 0;';
  const identity = document.createElement('div');
  identity.style.cssText = 'text-align:center;font-size:14px;color:#8a8580;margin-top:2px;';
  const divider = document.createElement('div');
  divider.innerHTML = goldDividerHtml(4);
  body.append(title, identity, divider);

  // combat-power block
  const power = document.createElement('div');
  power.style.cssText =
    'margin:0 8px;padding:10px 14px;text-align:center;' +
    'background:linear-gradient(135deg,rgba(30,22,10,0.7) 0%,rgba(45,33,15,0.6) 50%,rgba(30,22,10,0.7) 100%);' +
    'border:1px solid rgba(212,176,90,0.25);border-radius:4px;' +
    'box-shadow:inset 0 0 20px rgba(0,0,0,0.4),0 0 8px rgba(212,176,90,0.08);';
  body.appendChild(power);

  const sections = document.createElement('div');
  sections.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  body.appendChild(sections);

  const footer = document.createElement('div');
  footer.style.cssText = 'text-align:center;font-size:12px;color:#6a6058;margin-top:4px;';
  footer.innerHTML = goldDividerHtml(6) + '<div style="margin-top:6px;"><span style="color:#d4b05a;">[C]</span> 关闭</div>';
  body.appendChild(footer);

  root.appendChild(body);
  mount.appendChild(root);

  let open = false;
  let last: CharacterPanelViewModel | null = null;

  const paint = (vm: CharacterPanelViewModel): void => {
    identity.innerHTML =
      `${escapeHtml(vm.playerName)} — <span style="color:#d4b05a;">Lv ${vm.level} · ${escapeHtml(vm.className)}</span>` +
      (vm.unspentSkillPoints > 0 ? ` · <span style="color:#44ff88;">未分配 ${vm.unspentSkillPoints} 点</span>` : '');

    const p = computeCombatPower(vm.stats, vm.equipScore, vm.level, vm.skillInvested);
    const contrib = (label: string, value: number, color: string): string =>
      `<div style="background:rgba(0,0,0,0.3);border-radius:3px;padding:4px 2px;">` +
      `<div style="font-size:10px;color:#8a7860;">${label}</div>` +
      `<div style="font-size:13px;font-weight:bold;color:${color};">${value}</div></div>`;
    power.innerHTML =
      `<div style="font-size:12px;color:#a09070;letter-spacing:2px;">综合战力</div>` +
      `<div style="font-size:28px;font-weight:bold;color:#d4b05a;text-shadow:0 0 12px rgba(212,176,90,0.4),0 2px 4px rgba(0,0,0,0.8);">${p.total}</div>` +
      `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;margin-top:8px;">` +
      contrib('装备贡献', p.equip, '#d4b05a') +
      contrib('等级贡献', p.level, '#88aacc') +
      contrib('技能贡献', p.skill, '#aa88cc') +
      `</div>`;

    sections.replaceChildren();
    for (const g of buildCharacterStatGroups(vm.stats)) {
      const sec = document.createElement('div');
      sec.innerHTML =
        `<div style="color:#d4b05a;font-size:13px;font-weight:bold;padding:4px 8px;letter-spacing:1px;` +
        `background:linear-gradient(90deg,rgba(55,42,25,0.4) 0%,rgba(40,30,18,0.15) 100%);` +
        `border-bottom:1px solid;border-image:linear-gradient(90deg,#6a5430,#4a3a20,transparent) 1;">${g.title}</div>`;
      const rows = document.createElement('div');
      rows.style.cssText = 'display:flex;flex-direction:column;padding:2px 4px;';
      for (const row of g.rows) {
        const el = document.createElement('div');
        el.style.cssText = 'display:flex;justify-content:space-between;padding:3px 5px;font-size:13px;';
        const lab = document.createElement('span');
        lab.textContent = row.label;
        lab.style.color = '#999';
        const val = document.createElement('span');
        val.textContent = row.value;
        val.style.cssText = 'font-weight:bold;color:#e0d8cc;font-variant-numeric:tabular-nums;';
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
