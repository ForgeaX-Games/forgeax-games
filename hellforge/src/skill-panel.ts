// Skill sheet — SPEC §5.2 / §6 SkillTree *information architecture* only.
//
// aidiablo's SkillTreeRenderer needs synergies / prerequisites / auraEffects /
// spendable skill points — hellforge has a flat 4-skill kit with unlockLevel
// gates (skills.ts). Porting the Canvas tree would invent a schema we don't
// have. This panel keeps the valuable IA: name, current unlock state, next
// unlock preview, mana/cooldown readout — mounted on ctx.uiRoot.

import type { SkillDef } from './skills';
import { FONT_UI, Ui, panelChrome, panelTitleStyle } from './ui-theme';

export interface SkillPanelCallbacks {
  getSkills: () => SkillDef[];
  getLevel: () => number;
  getMana: () => number;
}

export interface SkillPanelHandle {
  toggle(): void;
  setOpen(open: boolean): void;
  isOpen(): boolean;
  refresh(): void;
  dispose(): void;
}

const PANEL_ID = 'hellforge-skill-panel';

export function installSkillPanel(mount: HTMLElement, cb: SkillPanelCallbacks): SkillPanelHandle {
  document.getElementById(PANEL_ID)?.remove();
  const scoped = mount !== document.body;

  const root = document.createElement('div');
  root.id = PANEL_ID;
  root.style.cssText = `position:${scoped ? 'absolute' : 'fixed'};inset:0;z-index:120;display:none;` +
    `pointer-events:none;overflow:hidden;background:rgba(4,3,2,0.55);`;

  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
    'width:min(440px,92%);max-height:min(70%,520px);overflow:auto;pointer-events:auto;' +
    'padding:18px 20px 16px;box-sizing:border-box;border-radius:10px;' +
    panelChrome(`font:600 13px ${FONT_UI};`);

  const title = document.createElement('div');
  title.style.cssText = 'display:flex;justify-content:space-between;align-items:baseline;margin-bottom:14px;';
  const titleLeft = document.createElement('span');
  titleLeft.textContent = '技能';
  titleLeft.style.cssText = panelTitleStyle();
  const titleRight = document.createElement('span');
  titleRight.textContent = 'K 关闭';
  titleRight.style.cssText = `font:600 11px inherit;color:${Ui.textDim};`;
  title.append(titleLeft, titleRight);

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

  panel.append(title, list);
  root.appendChild(panel);
  mount.appendChild(root);

  let open = false;

  const refresh = (): void => {
    const level = cb.getLevel();
    const mana = cb.getMana();
    const skills = cb.getSkills();
    list.innerHTML = '';
    skills.forEach((def, i) => {
      const unlocked = level >= def.unlockLevel;
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:12px;padding:10px 12px;border-radius:4px;' +
        `border:1px solid ${unlocked ? Ui.goldDim : '#3a3020'};` +
        `background:${unlocked ? Ui.goldFill : Ui.inkWell};` +
        (unlocked ? '' : 'opacity:0.72;');

      const icon = document.createElement('div');
      icon.textContent = def.icon;
      icon.style.cssText = 'width:44px;height:44px;flex:none;display:flex;align-items:center;justify-content:center;' +
        `font-size:24px;border-radius:4px;background:${Ui.ink};border:1px solid ${Ui.goldLineSoft};`;

      const body = document.createElement('div');
      body.style.cssText = 'flex:1;min-width:0;';
      const head = document.createElement('div');
      head.style.cssText = 'display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;';
      head.innerHTML = `<span style="color:${Ui.goldBright};letter-spacing:1px;">${i + 1}. ${def.name}</span>` +
        `<span style="color:${unlocked ? '#7da2ff' : Ui.textDim};font-size:11px;">` +
        (unlocked ? `蓝耗 ${def.manaCost} · CD ${def.cooldown.toFixed(1)}s` : `等级 ${def.unlockLevel} 解锁`) +
        `</span>`;
      const desc = document.createElement('div');
      desc.textContent = def.desc;
      desc.style.cssText = `font:500 12px ${FONT_UI};color:${Ui.textMuted};line-height:1.45;`;
      const status = document.createElement('div');
      status.style.cssText = 'margin-top:5px;font-size:11px;letter-spacing:1px;';
      if (unlocked) {
        const ok = mana >= def.manaCost;
        status.style.color = ok ? Ui.ok : Ui.danger;
        status.textContent = ok ? '● 就绪' : '○ 法力不足';
      } else {
        status.style.color = Ui.textDim;
        status.textContent = `○ 下一解锁预览 · 还需 ${def.unlockLevel - level} 级`;
      }
      body.append(head, desc, status);
      row.append(icon, body);
      list.appendChild(row);
    });
  };

  return {
    toggle() { this.setOpen(!open); },
    setOpen(next: boolean) {
      open = next;
      root.style.display = open ? 'block' : 'none';
      if (open) refresh();
    },
    isOpen: () => open,
    refresh,
    dispose: () => root.remove(),
  };
}
