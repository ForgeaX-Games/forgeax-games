export type ViewMode = 'topdown' | 'fps';
export type PopupKind = 'dmg' | 'crit' | 'burn' | 'heal' | 'xp' | 'info' | 'hurt';

export interface UpgradeChoice {
  id: string;
  icon: string;
  title: string;
  desc: string;
}

export interface GameOverStats {
  time: number;
  kills: number;
  score: number;
  level: number;
}

export interface HudHandle {
  setMode(mode: ViewMode): void;
  setLockStatus(text: string): void;
  setHp(cur: number, max: number): void;
  setXp(cur: number, next: number, level: number): void;
  setStats(s: { time: number; kills: number; score: number; enemies: number }): void;
  setWeapons(ws: { icon: string; level: number }[]): void;
  popup(text: string, sx: number, sy: number, kind: PopupKind): void;
  banner(title: string, sub?: string): void;
  showLevelUp(choices: UpgradeChoice[]): void;
  hideLevelUp(): void;
  showGameOver(s: GameOverStats): void;
  flashHurt(): void;
  dispose(): void;
}

const HUD_ID = 'cowhell-hud';

export function installHud(opts: {
  initialMode: ViewMode;
  onToggle: () => void;
  onChoose: (id: string) => void;
  onRestart: () => void;
}): HudHandle {
  document.getElementById(HUD_ID)?.remove();
  injectStyles();

  const root = div({
    position: 'fixed', inset: '0', zIndex: '50', pointerEvents: 'none',
    color: '#fff', font: '600 14px ui-sans-serif, system-ui, sans-serif', userSelect: 'none',
  });
  root.id = HUD_ID;

  const top = div({
    position: 'absolute', left: '50%', top: '10px', transform: 'translateX(-50%)',
    width: 'min(620px, 88vw)', display: 'flex', flexDirection: 'column', gap: '5px',
  });
  const hp = bar('linear-gradient(90deg,#b81122,#ff5438)', 16);
  const xp = bar('linear-gradient(90deg,#2cff76,#31d7ff)', 9);
  top.append(hp.root, xp.root);

  const stats = div({
    position: 'absolute', left: '12px', top: '10px', minWidth: '132px',
    padding: '7px 11px', border: '1px solid rgba(255,100,80,0.22)',
    background: 'rgba(8,2,4,0.62)', borderRadius: '8px',
    font: '700 13px ui-monospace, SFMono-Regular, Menlo, monospace',
    lineHeight: '1.55', textShadow: '0 1px 2px #000',
  });

  const weapons = div({
    position: 'absolute', left: '12px', bottom: '12px', display: 'flex', gap: '7px',
  });

  const button = document.createElement('button');
  Object.assign(button.style, {
    position: 'absolute', right: '12px', top: '10px', pointerEvents: 'auto',
    padding: '8px 13px', borderRadius: '8px', cursor: 'pointer',
    color: '#ffe1d4', background: 'rgba(38,8,14,0.82)',
    border: '1px solid rgba(255,118,76,0.42)', font: '800 13px ui-sans-serif, system-ui',
    boxShadow: '0 4px 20px rgba(0,0,0,0.35)',
  } as CSSStyleDeclaration);
  button.addEventListener('click', (e) => { e.preventDefault(); opts.onToggle(); });

  const lock = div({
    position: 'absolute', right: '12px', top: '48px', display: 'none',
    padding: '4px 10px', maxWidth: '62vw', whiteSpace: 'nowrap',
    color: '#ffe9be', background: 'rgba(8,2,4,0.58)', borderRadius: '6px',
    font: '600 11px ui-sans-serif, system-ui', textAlign: 'right',
  });

  const cross = div({
    position: 'absolute', left: '50%', top: '50%', width: '22px', height: '22px',
    transform: 'translate(-50%,-50%)', display: 'none',
  });
  cross.innerHTML =
    '<i style="position:absolute;left:10px;top:0;width:2px;height:22px;background:#ff4040;box-shadow:0 0 10px #ff3030"></i>' +
    '<i style="position:absolute;left:0;top:10px;width:22px;height:2px;background:#ff4040;box-shadow:0 0 10px #ff3030"></i>';

  const hint = div({
    position: 'absolute', left: '50%', bottom: '13px', transform: 'translateX(-50%)',
    padding: '5px 12px', borderRadius: '7px', whiteSpace: 'nowrap',
    color: '#ffe8cf', background: 'rgba(8,2,4,0.5)',
    font: '600 12px ui-sans-serif, system-ui',
  });

  const popups = div({ position: 'absolute', inset: '0', overflow: 'hidden' });
  const vignette = div({
    position: 'absolute', inset: '0', opacity: '0', transition: 'opacity 0.16s ease-out',
    boxShadow: 'inset 0 0 150px 44px rgba(220,0,0,0.72)',
  });
  const banner = div({
    position: 'absolute', left: '50%', top: '25%', transform: 'translate(-50%,-50%)',
    textAlign: 'center', opacity: '0',
  });
  const modal = div({
    position: 'absolute', inset: '0', display: 'none', alignItems: 'center',
    justifyContent: 'center', background: 'rgba(5,0,2,0.75)', pointerEvents: 'auto',
    backdropFilter: 'blur(3px)',
  });
  const over = div({
    position: 'absolute', inset: '0', display: 'none', alignItems: 'center',
    justifyContent: 'center', flexDirection: 'column', gap: '14px',
    background: 'rgba(5,0,2,0.88)', pointerEvents: 'auto', textAlign: 'center',
  });

  root.append(top, stats, weapons, button, lock, cross, hint, popups, vignette, banner, modal, over);
  document.body.appendChild(root);

  let popupCount = 0;
  let bannerTimer: ReturnType<typeof setTimeout> | undefined;
  let hurtTimer: ReturnType<typeof setTimeout> | undefined;

  const applyMode = (mode: ViewMode) => {
    button.textContent = mode === 'fps' ? '第一人称 -> 顶视角' : '顶视角 -> 第一人称';
    cross.style.display = mode === 'fps' ? 'block' : 'none';
    lock.style.display = mode === 'fps' ? 'block' : 'none';
    hint.textContent = mode === 'fps'
      ? 'WASD 移动 · 鼠标瞄准 · 自动开火 · ESC 释放鼠标'
      : 'WASD/方向键移动 · 武器自动瞄准 · 升级三选一';
  };

  const setHp = (cur: number, max: number) => {
    const pct = Math.max(0, Math.min(1, cur / Math.max(1, max)));
    hp.fill.style.width = `${pct * 100}%`;
    hp.label.textContent = `HP ${Math.max(0, Math.ceil(cur))} / ${Math.round(max)}`;
  };

  const setXp = (cur: number, next: number, level: number) => {
    xp.fill.style.width = `${Math.max(0, Math.min(1, cur / Math.max(1, next))) * 100}%`;
    xp.label.textContent = `LV ${level}`;
  };

  const setStats = (s: { time: number; kills: number; score: number; enemies: number }) => {
    const m = Math.floor(s.time / 60);
    const sec = Math.floor(s.time % 60);
    stats.innerHTML =
      `TIME ${m}:${String(sec).padStart(2, '0')}<br>` +
      `KILLS ${s.kills}<br>` +
      `SCORE ${s.score}<br>` +
      `COWS ${s.enemies}`;
  };

  const setWeapons = (ws: { icon: string; level: number }[]) => {
    weapons.innerHTML = '';
    for (const w of ws) {
      const slot = div({
        width: '42px', height: '42px', borderRadius: '8px', position: 'relative',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#fff1d8', font: '900 19px ui-sans-serif, system-ui',
        background: 'rgba(20,5,8,0.72)', border: '1px solid rgba(255,120,70,0.42)',
        boxShadow: '0 4px 18px rgba(0,0,0,0.35)',
      });
      slot.textContent = w.icon;
      const lv = div({
        position: 'absolute', right: '-5px', bottom: '-5px', minWidth: '18px', height: '18px',
        borderRadius: '9px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: '#230606', background: '#ffb23b', font: '900 11px ui-sans-serif, system-ui',
      });
      lv.textContent = String(w.level);
      slot.appendChild(lv);
      weapons.appendChild(slot);
    }
  };

  const popup = (text: string, sx: number, sy: number, kind: PopupKind) => {
    if (popupCount > 70) return;
    const styles: Record<PopupKind, { c: string; size: number; shadow: string }> = {
      dmg: { c: '#ffffff', size: 18, shadow: '0 2px 3px #000' },
      crit: { c: '#ffd23b', size: 30, shadow: '0 0 14px rgba(255,160,0,0.9),0 2px 4px #000' },
      burn: { c: '#ff7022', size: 15, shadow: '0 0 9px rgba(255,80,0,0.8),0 1px 2px #000' },
      heal: { c: '#62ff91', size: 18, shadow: '0 1px 3px #000' },
      xp: { c: '#76ff92', size: 15, shadow: '0 1px 2px #000' },
      info: { c: '#ffe58a', size: 21, shadow: '0 2px 4px #000' },
      hurt: { c: '#ff4c4c', size: 22, shadow: '0 0 12px rgba(255,0,0,0.8),0 2px 3px #000' },
    };
    const st = styles[kind];
    const p = document.createElement('div');
    p.textContent = text;
    Object.assign(p.style, {
      position: 'absolute', left: `${sx}px`, top: `${sy}px`,
      transform: 'translate(-50%,-100%)', color: st.c,
      font: `900 ${st.size}px ui-sans-serif, system-ui, sans-serif`,
      textShadow: st.shadow, whiteSpace: 'nowrap', pointerEvents: 'none',
      animation: kind === 'crit' ? 'cowhell-crit 0.95s ease-out forwards' : 'cowhell-pop 0.8s ease-out forwards',
    } as CSSStyleDeclaration);
    popups.appendChild(p);
    popupCount++;
    setTimeout(() => { p.remove(); popupCount--; }, 960);
  };

  const showBanner = (title: string, sub?: string) => {
    banner.innerHTML =
      `<div style="font:900 42px ui-sans-serif,system-ui;color:#ffd45e;text-shadow:0 0 24px rgba(255,80,30,0.9),0 4px 8px #000">${title}</div>` +
      (sub ? `<div style="margin-top:5px;font:700 16px ui-sans-serif,system-ui;color:#ffe6cf;text-shadow:0 2px 4px #000">${sub}</div>` : '');
    banner.style.animation = 'none';
    void banner.offsetWidth;
    banner.style.animation = 'cowhell-banner 1.75s ease-out forwards';
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { banner.style.opacity = '0'; }, 1700);
  };

  const showLevelUp = (choices: UpgradeChoice[]) => {
    modal.innerHTML = '';
    const panel = div({
      width: 'min(620px, 92vw)', padding: '22px', borderRadius: '14px',
      background: 'linear-gradient(180deg,rgba(28,6,10,0.98),rgba(10,2,4,0.98))',
      border: '1px solid rgba(255,132,74,0.42)', textAlign: 'center',
      boxShadow: '0 16px 60px rgba(0,0,0,0.68)',
    });
    const title = div({ color: '#ffd45e', font: '900 27px ui-sans-serif, system-ui', marginBottom: '4px' });
    title.textContent = '升级强化';
    const sub = div({ color: '#ffcab7', font: '600 13px ui-sans-serif, system-ui', marginBottom: '16px' });
    sub.textContent = '选择一项继续屠牛';
    const row = div({ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' });
    for (const c of choices) {
      const card = document.createElement('button');
      Object.assign(card.style, {
        width: '166px', minHeight: '148px', padding: '15px 12px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px',
        borderRadius: '10px', border: '1px solid rgba(255,136,78,0.34)',
        background: 'rgba(36,10,14,0.96)', color: '#fff', cursor: 'pointer',
        pointerEvents: 'auto', font: 'inherit', transition: 'transform 0.12s, border-color 0.12s',
      } as CSSStyleDeclaration);
      card.innerHTML =
        `<div style="font:900 34px ui-sans-serif,system-ui;line-height:1">${c.icon}</div>` +
        `<div style="font:900 15px ui-sans-serif,system-ui;color:#ffe08a">${c.title}</div>` +
        `<div style="font:600 12px ui-sans-serif,system-ui;color:#e8cec2;line-height:1.45">${c.desc}</div>`;
      card.addEventListener('mouseenter', () => { card.style.transform = 'translateY(-4px)'; card.style.borderColor = '#ffc078'; });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; card.style.borderColor = 'rgba(255,136,78,0.34)'; });
      card.addEventListener('click', () => opts.onChoose(c.id));
      row.appendChild(card);
    }
    panel.append(title, sub, row);
    modal.appendChild(panel);
    modal.style.display = 'flex';
  };

  const showGameOver = (s: GameOverStats) => {
    const m = Math.floor(s.time / 60);
    const sec = Math.floor(s.time % 60);
    over.innerHTML =
      `<div style="font:900 54px ui-sans-serif,system-ui;color:#ff3434;text-shadow:0 0 26px rgba(255,0,0,0.72),0 4px 8px #000">你倒下了</div>` +
      `<div style="font:700 18px ui-sans-serif,system-ui;color:#ffe6cf;line-height:1.75">存活 ${m}:${String(sec).padStart(2, '0')} · 击杀 ${s.kills} · LV ${s.level}<br>最终得分 <b style="color:#ffd45e">${s.score}</b></div>`;
    const b = document.createElement('button');
    Object.assign(b.style, {
      padding: '12px 30px', borderRadius: '10px', pointerEvents: 'auto',
      border: '0', cursor: 'pointer', color: '#fff',
      background: 'linear-gradient(90deg,#b81122,#ff6d38)',
      font: '900 17px ui-sans-serif, system-ui', boxShadow: '0 8px 24px rgba(255,30,20,0.36)',
    } as CSSStyleDeclaration);
    b.textContent = '再来一次';
    b.addEventListener('click', opts.onRestart);
    over.appendChild(b);
    over.style.display = 'flex';
  };

  const flashHurt = () => {
    vignette.style.opacity = '1';
    clearTimeout(hurtTimer);
    hurtTimer = setTimeout(() => { vignette.style.opacity = '0'; }, 95);
  };

  applyMode(opts.initialMode);
  setHp(100, 100);
  setXp(0, 12, 1);
  setStats({ time: 0, kills: 0, score: 0, enemies: 0 });
  return {
    setMode: applyMode,
    setLockStatus: (text: string) => { lock.textContent = text; },
    setHp,
    setXp,
    setStats,
    setWeapons,
    popup,
    banner: showBanner,
    showLevelUp,
    hideLevelUp: () => { modal.style.display = 'none'; },
    showGameOver,
    flashHurt,
    dispose: () => root.remove(),
  };
}

function div(style: Partial<CSSStyleDeclaration> | Record<string, string>): HTMLDivElement {
  const d = document.createElement('div');
  Object.assign(d.style, style as CSSStyleDeclaration);
  return d;
}

function bar(fill: string, h: number): { root: HTMLDivElement; fill: HTMLDivElement; label: HTMLDivElement } {
  const root = div({
    position: 'relative', width: '100%', height: `${h}px`, overflow: 'hidden',
    borderRadius: `${Math.ceil(h / 2)}px`, background: 'rgba(8,2,4,0.7)',
    border: '1px solid rgba(255,255,255,0.16)',
  });
  const fillEl = div({
    position: 'absolute', left: '0', top: '0', bottom: '0', width: '100%',
    background: fill, transition: 'width 0.12s linear',
  });
  const label = div({
    position: 'absolute', inset: '0', display: 'flex', alignItems: 'center',
    justifyContent: 'center', color: '#fff', textShadow: '0 1px 2px #000',
    font: `900 ${Math.max(9, h - 4)}px ui-sans-serif, system-ui`,
  });
  root.append(fillEl, label);
  return { root, fill: fillEl, label };
}

function injectStyles(): void {
  if (document.getElementById('cowhell-style')) return;
  const s = document.createElement('style');
  s.id = 'cowhell-style';
  s.textContent = `
    @keyframes cowhell-pop {
      0% { opacity: 1; transform: translate(-50%,-100%) scale(1.25); }
      18% { opacity: 1; transform: translate(-50%,-120%) scale(1); }
      100% { opacity: 0; transform: translate(-50%,-215%) scale(0.86); }
    }
    @keyframes cowhell-crit {
      0% { opacity: 1; transform: translate(-50%,-100%) scale(1.65) rotate(-5deg); }
      22% { opacity: 1; transform: translate(-50%,-130%) scale(1) rotate(3deg); }
      100% { opacity: 0; transform: translate(-50%,-240%) scale(0.9) rotate(0deg); }
    }
    @keyframes cowhell-banner {
      0% { opacity: 0; transform: translate(-50%,-50%) scale(0.72); }
      14% { opacity: 1; transform: translate(-50%,-50%) scale(1.05); }
      28% { opacity: 1; transform: translate(-50%,-50%) scale(1); }
      82% { opacity: 1; }
      100% { opacity: 0; transform: translate(-50%,-61%) scale(1); }
    }`;
  document.head.appendChild(s);
}
