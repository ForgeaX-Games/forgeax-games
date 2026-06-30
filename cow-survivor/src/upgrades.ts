// Upgrade system: leveling, 3-choice picker pop-up, applying cards.

import type { WeaponKind } from './weapons';

export type UpgradeId =
  | 'weapon:pistol' | 'weapon:fire' | 'weapon:ice' | 'weapon:chain'
  | 'weapon:shotgun' | 'weapon:boomerang' | 'weapon:grenade'
  | 'stat:damage' | 'stat:cooldown' | 'stat:bullets' | 'stat:speed' | 'stat:heal';

export interface UpgradeCard {
  id: UpgradeId;
  title: string;
  desc: string;
  icon: string;
  tier: 'common' | 'rare' | 'epic';
}

export const ALL_CARDS: UpgradeCard[] = [
  { id: 'weapon:pistol',    title: '手枪 +1', desc: '基础单发武器，稳定可靠', icon: '🔫', tier: 'common' },
  { id: 'weapon:fire',      title: '火焰弹 +1', desc: '范围伤害，对群专家', icon: '🔥', tier: 'rare' },
  { id: 'weapon:ice',       title: '冰锥 +1', desc: '减速，控场必备', icon: '❄️', tier: 'rare' },
  { id: 'weapon:chain',     title: '闪电链 +1', desc: '命中后跳跃伤害', icon: '⚡', tier: 'epic' },
  { id: 'weapon:shotgun',   title: '散弹 +1', desc: '一次发射 5 发扇形', icon: '💢', tier: 'rare' },
  { id: 'weapon:boomerang', title: '回旋镖 +1', desc: '飞出去再飞回来', icon: '🌀', tier: 'epic' },
  { id: 'weapon:grenade',   title: '手雷 +1', desc: '抛物线大爆炸', icon: '💣', tier: 'epic' },
  { id: 'stat:damage',      title: '+20% 全武器伤害', desc: '更疼一点哦~', icon: '⚔️', tier: 'common' },
  { id: 'stat:cooldown',    title: '-15% 全武器冷却', desc: '射快一点哦~', icon: '⏱️', tier: 'common' },
  { id: 'stat:bullets',     title: '+1 弹数', desc: '散弹++ / 其他武器小幅+', icon: '🎯', tier: 'rare' },
  { id: 'stat:speed',       title: '+15% 移动速度', desc: '跑得比奶牛快~', icon: '👟', tier: 'common' },
  { id: 'stat:heal',        title: '回满 HP', desc: '深呼吸，重新出发~', icon: '💚', tier: 'common' },
];

export interface UpgradePicker {
  pickedCallback: ((card: UpgradeCard) => void) | null;
  show(level: number, options: UpgradeCard[]): void;
  hide(): void;
  isOpen(): boolean;
}

/** Roll 3 upgrade options. Bias to weapon cards if we have <4 weapons. */
export function rollUpgrades(ownedWeapons: Set<WeaponKind>): UpgradeCard[] {
  // pool: filter out heal if HP is full would be nice but we don't know here;
  // upgrades.ts is logic, hp check happens at apply site.
  const pool = ALL_CARDS.slice();
  // Weight: epic *1, rare *2, common *3 — then bias by ownership
  const weighted: UpgradeCard[] = [];
  for (const c of pool) {
    const tierWeight = c.tier === 'epic' ? 1 : c.tier === 'rare' ? 2 : 3;
    // If it's a new weapon and we have <4 weapons, boost it
    let weight = tierWeight;
    if (c.id.startsWith('weapon:')) {
      const k = c.id.split(':')[1] as WeaponKind;
      if (!ownedWeapons.has(k)) {
        if (ownedWeapons.size < 4) weight += 4;     // strongly favor new
      } else {
        weight += 1;   // small bonus to upgrade existing
      }
    }
    for (let i = 0; i < weight; i++) weighted.push(c);
  }
  // Pick 3 distinct
  const picked: UpgradeCard[] = [];
  const seen = new Set<UpgradeId>();
  let safety = 0;
  while (picked.length < 3 && safety++ < 200) {
    const c = weighted[Math.floor(Math.random() * weighted.length)]!;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    picked.push(c);
  }
  return picked;
}

/** XP table: each level costs more. Level N→N+1 needs `xpFor(N)` xp. */
export function xpForLevel(level: number): number {
  return Math.round(5 + level * level * 1.5 + level * 4);
}

/** Mount the upgrade-picker modal. Returns a controller used by main.ts. */
export function installUpgradeUI(): UpgradePicker {
  const ID = 'forgeax-upgrade-ui';
  document.getElementById(ID)?.remove();

  const root = document.createElement('div');
  root.id = ID;
  Object.assign(root.style, {
    position: 'fixed', inset: '0', zIndex: '200',
    display: 'none', alignItems: 'center', justifyContent: 'center',
    background: 'radial-gradient(circle at center, rgba(40,10,50,0.55), rgba(10,5,20,0.85))',
    backdropFilter: 'blur(6px)',
    pointerEvents: 'auto',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  } as CSSStyleDeclaration);

  // CSS keyframes for card entry + level-up banner
  if (!document.getElementById('forgeax-upgrade-style')) {
    const s = document.createElement('style');
    s.id = 'forgeax-upgrade-style';
    s.textContent = `
      @keyframes forgeax-card-in {
        0% { opacity: 0; transform: translateY(40px) scale(0.85); }
        100% { opacity: 1; transform: translateY(0) scale(1); }
      }
      @keyframes forgeax-banner-pulse {
        0%, 100% { transform: translateX(-50%) scale(1); }
        50% { transform: translateX(-50%) scale(1.06); }
      }
      .forgeax-card {
        width: 200px; height: 280px;
        border-radius: 16px; padding: 20px; cursor: pointer;
        background: linear-gradient(180deg, rgba(40,30,60,0.95), rgba(20,15,35,0.95));
        color: #fff; text-align: center;
        border: 2px solid rgba(180,140,220,0.5);
        box-shadow: 0 10px 40px rgba(120,60,180,0.4), inset 0 1px 0 rgba(255,255,255,0.1);
        transition: transform 0.15s, border-color 0.15s, box-shadow 0.15s;
        display: flex; flex-direction: column; align-items: center; justify-content: space-between;
        animation: forgeax-card-in 0.3s ease-out backwards;
      }
      .forgeax-card.tier-rare  { border-color: rgba(80,180,255,0.7); box-shadow: 0 10px 40px rgba(60,120,255,0.5); }
      .forgeax-card.tier-epic  { border-color: rgba(255,180,80,0.85); box-shadow: 0 10px 40px rgba(255,140,40,0.55); }
      .forgeax-card:hover { transform: translateY(-8px); border-color: #fff; }
      .forgeax-card .ic { font-size: 60px; line-height: 1; }
      .forgeax-card .tt { font-size: 18px; font-weight: 700; margin-top: 6px; }
      .forgeax-card .ds { font-size: 13px; opacity: 0.85; }
      .forgeax-card .kb { font-size: 11px; opacity: 0.65; }
    `;
    document.head.appendChild(s);
  }

  const banner = document.createElement('div');
  Object.assign(banner.style, {
    position: 'absolute', top: '18%', left: '50%', transform: 'translateX(-50%)',
    color: '#ffdd66', font: '900 56px ui-sans-serif, system-ui',
    textShadow: '0 0 24px rgba(255,180,60,0.8), 0 4px 12px rgba(0,0,0,0.6)',
    letterSpacing: '4px',
    animation: 'forgeax-banner-pulse 1.4s ease-in-out infinite',
  } as CSSStyleDeclaration);
  banner.textContent = 'LEVEL UP!';

  const sub = document.createElement('div');
  Object.assign(sub.style, {
    position: 'absolute', top: 'calc(18% + 70px)', left: '50%', transform: 'translateX(-50%)',
    color: 'rgba(255,255,255,0.85)', font: '500 16px ui-sans-serif, system-ui',
    letterSpacing: '2px',
  } as CSSStyleDeclaration);
  sub.textContent = '选择一个升级（1/2/3 或点击）';

  const cards = document.createElement('div');
  Object.assign(cards.style, {
    display: 'flex', gap: '20px', marginTop: '60px',
  } as CSSStyleDeclaration);

  root.append(banner, sub, cards);
  document.body.appendChild(root);

  const controller: UpgradePicker = {
    pickedCallback: null,
    show(level, options) {
      cards.innerHTML = '';
      banner.textContent = `LEVEL ${level}!`;
      options.forEach((opt, i) => {
        const card = document.createElement('div');
        card.className = `forgeax-card tier-${opt.tier}`;
        card.style.animationDelay = `${i * 0.08}s`;
        card.innerHTML = `
          <div class="ic">${opt.icon}</div>
          <div>
            <div class="tt">${opt.title}</div>
            <div class="ds">${opt.desc}</div>
          </div>
          <div class="kb">按 ${i + 1} 或点击</div>
        `;
        card.addEventListener('click', () => {
          if (controller.pickedCallback) controller.pickedCallback(opt);
        });
        cards.appendChild(card);
      });
      root.style.display = 'flex';
    },
    hide() { root.style.display = 'none'; },
    isOpen() { return root.style.display !== 'none'; },
  };
  return controller;
}
