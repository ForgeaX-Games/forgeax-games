// C character / combat-stat sheet — sourced only from CombatStats (Spec §11.2).
// Exclusive major surface via UiLayerManager; never mutates domain state.

import type { CombatStats } from './combat-stats';
import { FONT_UI, Ui, panelChrome, panelScrollShellCss, panelTitleStyle } from './ui-theme';

export interface CharacterPanelViewModel {
  readonly playerName: string;
  readonly className: string;
  readonly level: number;
  readonly unspentSkillPoints: number;
  readonly stats: CombatStats;
}

export interface CharacterStatRow {
  readonly label: string;
  readonly value: string;
}

export interface CharacterPanelHandle {
  update(vm: CharacterPanelViewModel): void;
  show(): void;
  hide(): void;
  isOpen(): boolean;
  dispose(): void;
}

const PANEL_ID = 'hellforge-character-panel';

/** Pure rows for tests + DOM — CombatStats only (plus identity chrome). */
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
  document.getElementById(PANEL_ID)?.remove();
  const scoped = mount !== document.body;
  const posKind = scoped ? 'absolute' : 'fixed';

  const root = document.createElement('div');
  root.id = PANEL_ID;
  root.style.cssText =
    `position:${posKind};left:14px;top:50%;transform:translateY(-50%);z-index:125;display:none;` +
    `font:600 13px ${FONT_UI};color:${Ui.text};user-select:none;pointer-events:auto;` +
    panelScrollShellCss(560, 40);

  const panel = document.createElement('div');
  panel.style.cssText =
    'width:min(320px,92vw);padding:14px 16px 16px;border-radius:10px;box-sizing:border-box;' +
    panelChrome();

  const header = document.createElement('div');
  header.style.cssText =
    'display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:10px;' +
    'border-bottom:1px solid rgba(224,184,74,0.35);padding-bottom:8px;';
  const title = document.createElement('div');
  title.textContent = '角色';
  title.style.cssText = panelTitleStyle();
  const closeHint = document.createElement('div');
  closeHint.textContent = 'C 关闭';
  closeHint.style.cssText = `font:600 11px ${FONT_UI};color:${Ui.textDim};`;
  header.append(title, closeHint);

  const identity = document.createElement('div');
  identity.style.cssText =
    `font:700 13px ${FONT_UI};color:${Ui.goldBright};margin-bottom:10px;line-height:1.45;`;

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

  panel.append(header, identity, list);
  root.appendChild(panel);
  mount.appendChild(root);

  let open = false;
  let last: CharacterPanelViewModel | null = null;

  const paint = (vm: CharacterPanelViewModel): void => {
    identity.textContent =
      `${vm.playerName} · ${vm.className} · Lv ${vm.level}` +
      (vm.unspentSkillPoints > 0 ? ` · 未分配技能点 ${vm.unspentSkillPoints}` : '');
    list.replaceChildren();
    for (const row of buildCharacterStatRows(vm.stats)) {
      const el = document.createElement('div');
      el.style.cssText =
        'display:flex;justify-content:space-between;gap:12px;padding:4px 6px;' +
        `background:${Ui.inkWell};border:1px solid ${Ui.goldLineSoft};border-radius:3px;`;
      const lab = document.createElement('span');
      lab.textContent = row.label;
      lab.style.cssText = `color:${Ui.textMuted};`;
      const val = document.createElement('span');
      val.textContent = row.value;
      val.style.cssText = `color:${Ui.text};font-variant-numeric:tabular-nums;`;
      el.append(lab, val);
      list.appendChild(el);
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
