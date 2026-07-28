/**
 * Sticker-style race HUD distilled from Fable5 HUD.ts (奶油底 + 暖黄描边).
 * Mounts on ctx.uiRoot only. Drift hold is exposed for gameplay merge;
 * keyboard drift still goes through InputSnapshot (`drift` action).
 */

export interface KartHud {
  setSpeed(kph: number): void;
  setLap(lap: number, total: number): void;
  setRank(rank: number, racers: number): void;
  setTime(seconds: number): void;
  setCoins(count: number): void;
  setPhase(phase: 'race' | 'over' | string): void;
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
#${HUD_ID} .pk-finish {
  position: absolute; left: 50%; top: 42%; transform: translate(-50%, -50%);
  background: #FFF6E8; color: #FF7043; border: 4px solid #FFB020; border-radius: 24px;
  padding: 18px 36px; font-weight: 900; font-size: clamp(28px, 6vmin, 48px);
  box-shadow: 0 0 0 4px #fff, 0 8px 0 rgba(200,140,20,.35);
  display: none; pointer-events: none;
}
@keyframes pk-rankpop { 0% { transform: scale(1); } 50% { transform: scale(1.22); } 100% { transform: scale(1); } }
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

  const hint = document.createElement('div');
  hint.className = 'pk-pill';
  hint.textContent = 'WASD 驾驶 · Shift/漂移键 · R 重置';
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

  root.append(topLeft, lapEl, speedEl, rankEl, driftBtn, hint, finish);
  mount.appendChild(root);

  let driftHeld = false;
  let lastRank = -1;
  const setHeld = (v: boolean) => (e: Event) => {
    e.preventDefault();
    driftHeld = v;
    driftBtn.classList.toggle('held', v);
  };
  driftBtn.addEventListener('pointerdown', setHeld(true));
  driftBtn.addEventListener('pointerup', setHeld(false));
  driftBtn.addEventListener('pointerleave', setHeld(false));
  driftBtn.addEventListener('pointercancel', setHeld(false));

  return {
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
    setPhase(phase: string) {
      finish.style.display = phase === 'over' ? 'block' : 'none';
      if (phase === 'over') hint.textContent = '比赛结束 · R 可重置车辆';
    },
    isDriftHeld: () => driftHeld,
    dispose: () => {
      driftHeld = false;
      root.remove();
    },
  };
}
