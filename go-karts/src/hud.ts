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
import type { RacerResult } from './race-session';

export interface KartHud {
  setSpeed(kph: number): void;
  setLap(lap: number, total: number): void;
  setRank(rank: number, racers: number): void;
  setTime(seconds: number): void;
  setCoins(count: number): void;
  coinPickup(amount: number): void;
  setItem(item: ItemKind | null): void;
  showItemUsed(result: ItemUseResult): void;
  showRivalItemUsed(racer: string, result: ItemUseResult, hitPlayer: boolean): void;
  /** One-shot pointer request from the on-screen item button. */
  consumeItemUse(): boolean;
  setBoostActive(active: boolean): void;
  setStarActive(active: boolean): void;
  setHornActive(active: boolean): void;
  setPhase(phase: 'race' | 'waiting' | 'results' | string): void;
  showPersonalFinish(result: RacerResult, racers: number): void;
  showResults(results: readonly RacerResult[]): void;
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
  padding: 18px 36px; font-weight: 900; text-align: center;
  box-shadow: 0 0 0 4px #fff, 0 8px 0 rgba(200,140,20,.35);
  display: none; pointer-events: none;
}
#${HUD_ID} .pk-finish-title {
  font-size: clamp(28px, 6vmin, 48px); line-height: 1;
}
#${HUD_ID} .pk-finish-score {
  margin-top: 12px; color: #5b4636; font-size: clamp(16px, 3vmin, 24px);
}
#${HUD_ID} .pk-finish-wait {
  margin-top: 7px; color: #9a7256; font-size: clamp(11px, 1.8vmin, 14px);
}
#${HUD_ID} .pk-results {
  position: absolute; inset: 0; display: none; place-items: center;
  padding: 20px; box-sizing: border-box; pointer-events: auto;
  background: rgba(29, 46, 68, .66); backdrop-filter: blur(7px);
}
#${HUD_ID} .pk-results-card {
  width: min(520px, calc(100vw - 40px)); max-height: calc(100vh - 40px);
  overflow: auto; box-sizing: border-box; text-align: center;
  padding: clamp(20px, 4vmin, 36px); border-radius: 30px;
  background: #FFF6E8; border: 5px solid #FFB020;
  box-shadow: 0 0 0 5px #fff, 0 14px 40px rgba(20,35,55,.42);
}
#${HUD_ID} .pk-results-kicker {
  color: #E08A00; font-size: clamp(12px, 2vmin, 16px); font-weight: 900;
  letter-spacing: 3px;
}
#${HUD_ID} .pk-results-title {
  margin: 5px 0 18px; color: #FF7043; font-size: clamp(28px, 6vmin, 48px);
  font-weight: 900; line-height: 1.1;
}
#${HUD_ID} .pk-result-row {
  display: grid; grid-template-columns: 64px 1fr auto; align-items: center;
  gap: 12px; margin: 9px 0; padding: 10px 14px;
  border-radius: 16px; background: #fff; color: #5b4636;
  border: 2px solid #f0d8b7; font-weight: 900; text-align: left;
}
#${HUD_ID} .pk-result-row.champion {
  background: linear-gradient(90deg, #fff0a8, #fff9df);
  border-color: #FFB020; transform: scale(1.02);
}
#${HUD_ID} .pk-result-rank { color: #E08A00; font-size: 20px; }
#${HUD_ID} .pk-result-time { color: #806652; font-variant-numeric: tabular-nums; }
#${HUD_ID} .pk-retry {
  margin-top: 16px; padding: 10px 24px; border: 3px solid #fff;
  border-radius: 999px; background: linear-gradient(#7DD4FF, #36AEEA);
  box-shadow: 0 0 0 3px #2E9BD6, 0 5px 0 #1B7FB0;
  color: #fff; font: inherit; font-weight: 900; cursor: pointer;
}
#${HUD_ID} .pk-retry:active { transform: translateY(4px); box-shadow: 0 0 0 3px #2E9BD6, 0 1px 0 #1B7FB0; }
@keyframes pk-rankpop { 0% { transform: scale(1); } 50% { transform: scale(1.22); } 100% { transform: scale(1); } }
@keyframes pk-slotflash { 0% { transform: scale(.7) rotate(-8deg); } 55% { transform: scale(1.18) rotate(5deg); } 100% { transform: scale(1); } }
@keyframes pk-coinpop { 0% { transform: scale(1); } 45% { transform: scale(1.4); color: #ff9f1c; } 100% { transform: scale(1); } }
@keyframes pk-hornflash { from { box-shadow: inset 0 0 18px rgba(255,120,20,.2); } to { box-shadow: inset 0 0 70px rgba(255,120,20,.58); } }
`;

const ORD = ['1ST', '2ND', '3RD', '4TH', '5TH', '6TH'] as const;

function rankLabel(rank: number): string {
  return ORD[rank - 1] ?? `${rank}TH`;
}

function racerName(id: string): string {
  if (id === 'player') return '你';
  if (id === 'KartDuck') return '小鸭';
  if (id === 'KartPanda') return '熊猫';
  return id;
}

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
  const finishTitle = document.createElement('div');
  finishTitle.className = 'pk-finish-title';
  finishTitle.textContent = 'FINISH!';
  const finishScore = document.createElement('div');
  finishScore.className = 'pk-finish-score';
  const finishWait = document.createElement('div');
  finishWait.className = 'pk-finish-wait';
  finishWait.textContent = '其他选手仍在冲线…';
  finish.append(finishTitle, finishScore, finishWait);

  const results = document.createElement('div');
  results.className = 'pk-results';
  const resultsCard = document.createElement('div');
  resultsCard.className = 'pk-results-card';
  results.appendChild(resultsCard);

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
    results,
  );
  mount.appendChild(root);

  let driftHeld = false;
  let itemUseQueued = false;
  let currentItem: ItemKind | null = null;
  let lastRank = -1;
  let finishKey = '';
  let resultsKey = '';
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
      if (rank !== lastRank) {
        rankEl.style.animation = 'none';
        void rankEl.offsetWidth;
        rankEl.style.animation = 'pk-rankpop .35s ease-out';
        lastRank = rank;
      }
      rankEl.textContent = rankLabel(rank);
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
    showRivalItemUsed(racer, result, hitPlayer) {
      const present = ITEM_PRESENTATION[result.item];
      const suffix = hitPlayer
        ? ' · 你被命中！'
        : result.affected > 0
          ? ` · 命中 ${result.affected} 名对手`
          : '';
      showToast(`${present.icon} ${racerName(racer)}使用了${present.label}${suffix}`, 1800);
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
      if (phase === 'race') {
        finish.style.display = 'none';
        results.style.display = 'none';
        hint.textContent = 'WASD 驾驶 · Shift 漂移 · Space 使用道具 · R 重置';
      } else if (phase === 'results') {
        finish.style.display = 'none';
        hint.textContent = '';
      } else if (phase === 'waiting') {
        results.style.display = 'none';
        hint.textContent = '成绩已锁定 · 等待其他选手冲线';
      }
    },
    showPersonalFinish(result: RacerResult, racers: number) {
      const key = `${result.rank}:${result.finishTime}:${racers}`;
      if (key !== finishKey) {
        finishKey = key;
        finishScore.textContent =
          `${rankLabel(result.rank)} · 第 ${result.rank}/${racers} 名 · ${fmtTime(result.finishTime)}`;
      }
      finish.style.display = 'block';
    },
    showResults(finalResults: readonly RacerResult[]) {
      const key = finalResults
        .map((result) => `${result.id}:${result.rank}:${result.finishTime}`)
        .join('|');
      if (key !== resultsKey) {
        resultsKey = key;
        resultsCard.replaceChildren();

        const kicker = document.createElement('div');
        kicker.className = 'pk-results-kicker';
        kicker.textContent = 'RACE COMPLETE';
        const title = document.createElement('div');
        title.className = 'pk-results-title';
        title.textContent = `🏆 冠军 · ${racerName(finalResults[0]?.id ?? '')}`;
        resultsCard.append(kicker, title);

        for (const result of finalResults) {
          const row = document.createElement('div');
          row.className = `pk-result-row${result.rank === 1 ? ' champion' : ''}`;
          const place = document.createElement('span');
          place.className = 'pk-result-rank';
          place.textContent = rankLabel(result.rank);
          const name = document.createElement('span');
          name.textContent = racerName(result.id);
          const time = document.createElement('span');
          time.className = 'pk-result-time';
          time.textContent = fmtTime(result.finishTime);
          row.append(place, name, time);
          resultsCard.appendChild(row);
        }

        const retry = document.createElement('button');
        retry.className = 'pk-retry';
        retry.type = 'button';
        retry.textContent = '再来一局';
        retry.addEventListener('click', () => window.location.reload());
        resultsCard.appendChild(retry);
      }
      results.style.display = 'grid';
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
