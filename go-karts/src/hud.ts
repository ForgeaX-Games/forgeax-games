/**
 * Sticker-style race HUD distilled from Fable5 HUD.ts (奶油底 + 暖黄描边).
 * Mounts on ctx.uiRoot only. Drift hold is exposed for gameplay merge;
 * keyboard drift still goes through InputSnapshot (`drift` action).
 */
import {
  ITEM_PRESENTATION,
  type ItemKind,
  type ItemUseResult,
} from './item-system';

export interface KartHud {
  setSpeed(kph: number): void;
  setLap(lap: number, total: number): void;
  setRank(rank: number, racers: number): void;
  setTime(seconds: number): void;
  setCoins(count: number): void;
  coinPickup(amount: number): void;
  setItem(item: ItemKind | null): void;
  showItemUsed(result: ItemUseResult): void;
  /** One-shot pointer request from the on-screen item button. */
  consumeItemUse(): boolean;
  setBoostActive(active: boolean): void;
  setStarActive(active: boolean): void;
  setHornActive(active: boolean): void;
  setPhase(phase: 'race' | 'over' | string): void;
  setVisible(visible: boolean): void;
  /** True while on-screen 漂移 button is held. */
  isDriftHeld(): boolean;
  dispose(): void;
}

const HUD_ID = 'forgeax-kart-hud';
const STYLE_ID = 'forgeax-kart-hud-style';

const STYLE = `
#${HUD_ID} {
  font-family: 'Comic Sans MS', 'Yuanti SC', 'Microsoft YaHei', sans-serif;
}
#${HUD_ID} .pk-pill {
  background: #FFF6E8; color: #5b4636;
  border: 3px solid #FFB020; border-radius: 999px;
  padding: 5px clamp(8px, 1.6vmin, 16px); font-weight: 800;
  font-size: clamp(11px, 2.4vmin, 15px);
  box-shadow: 0 0 0 3px #fff, 0 3px 0 rgba(200,140,20,.28), 0 5px 8px rgba(80,50,10,.18);
  white-space: nowrap;
}
#${HUD_ID} .pk-rank {
  font-weight: 900; font-size: clamp(30px, 7.5vmin, 54px); color: #fff;
  letter-spacing: 1px; line-height: 1;
  -webkit-text-stroke: 2px #E08A00;
  text-shadow: 0 3px 0 #E08A00, 0 6px 12px rgba(80,50,10,.4);
}
#${HUD_ID} .pk-speed {
  background: #FFF6E8; color: #5b4636;
  border: 3px solid #FFB020; border-radius: 16px;
  padding: 8px 14px; font-weight: 900; font-size: clamp(18px, 3.6vmin, 26px);
  box-shadow: 0 0 0 3px #fff, 0 4px 0 rgba(200,140,20,.28);
  min-width: 108px; text-align: right;
}
#${HUD_ID} .pk-act {
  width: clamp(64px, 10vmin, 84px); height: clamp(64px, 10vmin, 84px);
  border-radius: 50%; pointer-events: auto; touch-action: none; cursor: pointer;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 2px; font-weight: 900; font-size: clamp(10px, 1.8vmin, 13px); color: #fff;
  border: 3px solid #fff;
  box-shadow: 0 0 0 3px #2E9BD6, 0 5px 0 #1B7FB0, 0 8px 14px rgba(20,60,90,.3);
  background: linear-gradient(#7DD4FF, #4FC3F7);
  user-select: none;
}
#${HUD_ID} .pk-act:active, #${HUD_ID} .pk-act.held {
  transform: translateY(4px);
  box-shadow: 0 0 0 3px #2E9BD6, 0 1px 0 #1B7FB0;
}
#${HUD_ID} .pk-item-slot {
  position: absolute; right: 16px; top: 16px;
  width: clamp(66px, 10vmin, 88px); height: clamp(66px, 10vmin, 88px);
  border-radius: 50%; display: grid; place-items: center;
  background: radial-gradient(circle at 35% 30%, #fff, #d7dde6 66%, #8994a6);
  border: 4px solid #fff; box-shadow: 0 0 0 3px #697386, 0 6px 16px rgba(20,30,50,.35);
  opacity: .62; color: #6b7280; font-size: clamp(28px, 5vmin, 44px); font-weight: 900;
  pointer-events: auto; cursor: pointer; user-select: none;
}
#${HUD_ID} .pk-item-slot.ready {
  opacity: 1; box-shadow: 0 0 0 4px #ffbd2e, 0 0 28px rgba(255,181,42,.78);
  animation: pk-slotflash .72s ease-out;
}
#${HUD_ID} .pk-item-btn {
  position: absolute; right: clamp(92px, 13vmin, 118px); bottom: 88px;
  background: linear-gradient(#ffd95b, #ff9f1c);
  box-shadow: 0 0 0 3px #d47b00, 0 5px 0 #a85d00, 0 8px 14px rgba(90,50,10,.3);
  opacity: .6;
}
#${HUD_ID} .pk-item-btn.ready { opacity: 1; }
#${HUD_ID} .pk-item-btn:active {
  box-shadow: 0 0 0 3px #d47b00, 0 1px 0 #a85d00;
}
#${HUD_ID} .pk-toast {
  position: absolute; left: 50%; bottom: 76px; transform: translateX(-50%);
  background: rgba(32,30,38,.86); color: #fff; border: 2px solid #ffd45a;
  border-radius: 999px; padding: 8px 18px; font-weight: 900;
  font-size: clamp(12px, 2.2vmin, 16px); opacity: 0;
  transition: opacity .18s, transform .18s; white-space: nowrap;
}
#${HUD_ID} .pk-toast.show { opacity: 1; transform: translate(-50%, -6px); }
#${HUD_ID}.star-active { box-shadow: inset 0 0 48px 12px rgba(255,220,65,.42); }
#${HUD_ID}.horn-active { animation: pk-hornflash .22s ease-out alternate infinite; }
#${HUD_ID} .pk-finish {
  position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%);
  background: #FFF6E8; color: #FF7043; border: 4px solid #FFB020; border-radius: 24px;
  padding: 18px 36px; font-weight: 900; font-size: clamp(28px, 6vmin, 48px);
  box-shadow: 0 0 0 4px #fff, 0 8px 0 rgba(200,140,20,.35);
  display: none; pointer-events: none;
}
@keyframes pk-rankpop { 0% { transform: scale(1); } 50% { transform: scale(1.22); } 100% { transform: scale(1); } }
@keyframes pk-slotflash { 0% { transform: scale(.7) rotate(-8deg); } 55% { transform: scale(1.18) rotate(5deg); } 100% { transform: scale(1); } }
@keyframes pk-coinpop { 0% { transform: scale(1); } 45% { transform: scale(1.4); color: #ff9f1c; } 100% { transform: scale(1); } }
@keyframes pk-hornflash { from { box-shadow: inset 0 0 18px rgba(255,120,20,.2); } to { box-shadow: inset 0 0 70px rgba(255,120,20,.58); } }
`;

const ORD = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH'] as const;

function fmtTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
}

/** Viewport-local sticker HUD. Gameplay keys still via InputSnapshot. */
export function installKartHud(host?: HTMLElement): KartHud {
  document.getElementById(HUD_ID)?.remove();
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document.head.appendChild(style);
  }

  const mount = host ?? document.body;
  const rootAbsolute = mount !== document.body;
  const root = document.createElement('div');
  root.id = HUD_ID;
  Object.assign(root.style, {
    position: rootAbsolute ? 'absolute' : 'fixed',
    inset: '0',
    overflow: 'hidden',
    pointerEvents: 'none',
    zIndex: '50',
  } as CSSStyleDeclaration);

  const topLeft = document.createElement('div');
  topLeft.className = 'pk-pill';
  Object.assign(topLeft.style, {
    position: 'absolute',
    left: '14px',
    top: '14px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  } as CSSStyleDeclaration);
  const timeEl = document.createElement('span');
  timeEl.textContent = '0:00.0';
  topLeft.appendChild(timeEl);
  const coinEl = document.createElement('span');
  coinEl.textContent = '× 0';
  coinEl.style.marginLeft = '6px';
  topLeft.appendChild(coinEl);

  const lapEl = document.createElement('div');
  lapEl.className = 'pk-pill';
  Object.assign(lapEl.style, {
    position: 'absolute',
    left: '14px',
    bottom: '14px',
  } as CSSStyleDeclaration);
  lapEl.textContent = '🏁 LAP 1/3';

  const speedEl = document.createElement('div');
  speedEl.className = 'pk-speed';
  Object.assign(speedEl.style, {
    position: 'absolute',
    left: '14px',
    bottom: '56px',
  } as CSSStyleDeclaration);
  speedEl.textContent = '000 km/h';

  const rankEl = document.createElement('div');
  rankEl.className = 'pk-rank';
  Object.assign(rankEl.style, {
    position: 'absolute',
    right: '14px',
    bottom: '14px',
    pointerEvents: 'none',
  } as CSSStyleDeclaration);
  rankEl.textContent = '4TH';

  const driftBtn = document.createElement('div');
  driftBtn.className = 'pk-act';
  driftBtn.innerHTML = `<span style="font-size:22px;line-height:1">🔥</span><span>漂移</span>`;
  Object.assign(driftBtn.style, {
    position: 'absolute',
    right: '14px',
    bottom: '88px',
  } as CSSStyleDeclaration);

  const itemSlot = document.createElement('div');
  itemSlot.className = 'pk-item-slot';
  itemSlot.textContent = '?';

  const itemBtn = document.createElement('div');
  itemBtn.className = 'pk-act pk-item-btn';
  itemBtn.innerHTML = `<span style="font-size:26px;line-height:1">?</span><span>道具</span>`;

  const toast = document.createElement('div');
  toast.className = 'pk-toast';

  const hint = document.createElement('div');
  hint.className = 'pk-pill';
  hint.textContent = 'WASD 驾驶 · Shift 漂移 · Space 使用道具 · R 重置';
  Object.assign(hint.style, {
    position: 'absolute',
    left: '50%',
    bottom: '14px',
    transform: 'translateX(-50%)',
    opacity: '0.92',
  } as CSSStyleDeclaration);

  const finish = document.createElement('div');
  finish.className = 'pk-finish';
  finish.textContent = 'FINISH!';

  root.append(
    topLeft,
    lapEl,
    speedEl,
    rankEl,
    itemSlot,
    itemBtn,
    driftBtn,
    toast,
    hint,
    finish,
  );
  mount.appendChild(root);

  let driftHeld = false;
  let itemUseQueued = false;
  let currentItem: ItemKind | null = null;
  let lastRank = -1;
  let toastTimer = 0;
  const showToast = (message: string, duration = 1800) => {
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), duration);
  };
  const setHeld = (v: boolean) => (e: Event) => {
    e.preventDefault();
    driftHeld = v;
    driftBtn.classList.toggle('held', v);
  };
  driftBtn.addEventListener('pointerdown', setHeld(true));
  driftBtn.addEventListener('pointerup', setHeld(false));
  driftBtn.addEventListener('pointerleave', setHeld(false));
  driftBtn.addEventListener('pointercancel', setHeld(false));
  itemBtn.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (currentItem) itemUseQueued = true;
  });
  itemSlot.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    if (currentItem) itemUseQueued = true;
  });

  return {
    setVisible(visible: boolean) {
      root.style.display = visible ? '' : 'none';
    },
    setSpeed(kph: number) {
      speedEl.textContent = `${Math.round(kph).toString().padStart(3, '0')} km/h`;
    },
    setLap(lap: number, total: number) {
      lapEl.textContent = `🏁 LAP ${lap}/${total}`;
    },
    setRank(rank: number, _racers: number) {
      const i = Math.max(1, Math.min(rank, ORD.length)) - 1;
      const label = ORD[i] ?? `${rank}TH`;
      if (rank !== lastRank) {
        rankEl.style.animation = 'none';
        void rankEl.offsetWidth;
        rankEl.style.animation = 'pk-rankpop .35s ease-out';
        lastRank = rank;
      }
      rankEl.textContent = label;
    },
    setTime(seconds: number) {
      timeEl.textContent = fmtTime(seconds);
    },
    setCoins(count: number) {
      coinEl.textContent = `🪙 × ${count}`;
    },
    coinPickup(amount: number) {
      coinEl.style.animation = 'none';
      void coinEl.offsetWidth;
      coinEl.style.animation = 'pk-coinpop .42s ease-out';
      if (amount > 0) showToast(`🪙 金币 +${amount}`, 900);
    },
    setItem(item: ItemKind | null) {
      if (item === currentItem) return;
      currentItem = item;
      itemUseQueued = false;
      itemSlot.classList.toggle('ready', Boolean(item));
      itemBtn.classList.toggle('ready', Boolean(item));
      if (!item) {
        itemSlot.textContent = '?';
        itemSlot.title = '撞击问号道具盒获得随机道具';
        itemBtn.innerHTML = `<span style="font-size:26px;line-height:1">?</span><span>道具</span>`;
        return;
      }
      const present = ITEM_PRESENTATION[item];
      itemSlot.textContent = present.icon;
      itemSlot.title = `${present.label}：${present.help}`;
      itemBtn.innerHTML = `<span style="font-size:26px;line-height:1">${present.icon}</span><span>使用</span>`;
      showToast(`${present.icon} 获得 ${present.label} · 按 Space 使用`, 2500);
    },
    showItemUsed(result: ItemUseResult) {
      const present = ITEM_PRESENTATION[result.item];
      const suffix =
        result.affected > 0 ? ` · 命中 ${result.affected} 名对手` : '';
      showToast(`${present.icon} 使用 ${present.label}${suffix}`, 1600);
    },
    consumeItemUse() {
      const queued = itemUseQueued;
      itemUseQueued = false;
      return queued;
    },
    setBoostActive(_active: boolean) {
      // Speed-line overlay removed — boost feedback stays on kart VFX / pads.
    },
    setStarActive(active: boolean) {
      root.classList.toggle('star-active', active);
    },
    setHornActive(active: boolean) {
      root.classList.toggle('horn-active', active);
    },
    setPhase(phase: string) {
      finish.style.display = phase === 'over' ? 'block' : 'none';
      if (phase === 'over') hint.textContent = '比赛结束 · R 可重置车辆';
    },
    isDriftHeld: () => driftHeld,
    dispose: () => {
      driftHeld = false;
      itemUseQueued = false;
      window.clearTimeout(toastTimer);
      root.remove();
    },
  };
}
