// Hellforge HUD — Diablo-style DOM overlay.
//
// Layout (all absolutely positioned over the engine canvas, pointer-events
// none except noted):
//   bottom-centre  HP orb ─ 4 skill slots ─ mana orb, with an XP strip
//                  and level/gold readout above the slots
//   top-centre     quest tracker; boss HP bar appears below it during the fight
//   top-right      view-toggle hint (the ONLY residual chrome — the old debug
//                  HUD with clip-preview keys and live px/pz is gone)
//   centre         area-name fade-in, banners, death overlay
//
// Same DOM-overlay exception cow-survivor uses: gameplay/render stays pure
// ECS; this file only paints UI and forwards zero game logic.

export interface SkillSlotState {
  icon: string;
  name: string;
  key: string;            // key hint ("1")
  manaCost: number;
  cooldownPct: number;    // 0 ready … 1 just cast
  locked: boolean;
  unlockLevel: number;
  affordable: boolean;    // enough mana right now
}

export interface EquipSlotState {
  icon: string;           // slot icon (🪄/🧥/📿)
  /** Rarity border colour; null = empty slot. */
  color: string | null;
  /** Native-tooltip text (name + affix lines); '' when empty. */
  tooltip: string;
}

export interface HudHandle {
  setOrbs(hp: number, maxHp: number, mana: number, maxMana: number): void;
  setXp(level: number, cur: number, max: number): void;
  setGold(n: number): void;
  setKills(n: number): void;
  setSkills(slots: SkillSlotState[]): void;
  setEquipment(slots: EquipSlotState[]): void;
  setQuest(text: string): void;
  setBoss(name: string | null, cur?: number, max?: number): void;
  /** Big centred area label that fades ("余烬哨站" / "灰烬荒原" / "熔渣深窟"). */
  showArea(name: string, sub?: string): void;
  banner(text: string, color?: string, ms?: number): void;
  floatText(text: string, screenX: number, screenY: number, style?: { color?: string; size?: number }): void;
  damageFlash(): void;
  showDeath(show: boolean): void;
  dispose(): void;
}

const HUD_ID = 'hellforge-hud';

export function installHud(mount: HTMLElement = document.body): HudHandle {
  document.getElementById(HUD_ID)?.remove();
  const root = document.createElement('div');
  root.id = HUD_ID;
  // The HUD fills + clips to `mount`. When the host threads in a scoped container
  // (the in-process editor's viewport panel — position:relative + overflow:hidden),
  // use position:absolute so the overlay stays INSIDE the viewport rect and its
  // children's coords are mount-local (matching floatText's canvas-local pixels).
  // Only when mounted straight on document.body (headless / older host, where
  // window == canvas) does position:fixed still mean "fill the play surface".
  const rootAbsolute = mount !== document.body;
  root.style.cssText = `position:${rootAbsolute ? 'absolute' : 'fixed'};inset:0;z-index:50;overflow:hidden;pointer-events:none;user-select:none;` +
    "font:600 14px ui-sans-serif,system-ui,sans-serif;color:#e8dcc8;";

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

  // ── bottom bar ────────────────────────────────────────────────────────
  const bar = document.createElement('div');
  bar.style.cssText = 'position:absolute;left:50%;bottom:10px;transform:translateX(-50%);' +
    'display:flex;align-items:flex-end;gap:14px;';

  const orb = (grad: string, border: string): [HTMLDivElement, HTMLDivElement, HTMLDivElement] => {
    const wrap = document.createElement('div');
    wrap.style.cssText = `position:relative;width:86px;height:86px;border-radius:50%;overflow:hidden;` +
      `background:rgba(8,6,10,0.9);border:3px solid ${border};box-shadow:0 0 18px rgba(0,0,0,0.7),inset 0 0 16px rgba(0,0,0,0.85);`;
    const fill = document.createElement('div');
    fill.style.cssText = `position:absolute;left:0;bottom:0;width:100%;height:60%;background:${grad};transition:height 0.18s;`;
    const txt = document.createElement('div');
    txt.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;' +
      'font:700 13px ui-monospace,Menlo,monospace;color:#fff;text-shadow:0 1px 3px #000;';
    wrap.append(fill, txt);
    return [wrap, fill, txt];
  };
  const [hpOrb, hpFill, hpTxt] = orb('linear-gradient(180deg,#ff5b45,#a00d0d 70%,#5e0505)', 'rgba(160,60,40,0.9)');
  const [mpOrb, mpFill, mpTxt] = orb('linear-gradient(180deg,#4f7dff,#1428a0 70%,#0a1258)', 'rgba(60,80,170,0.9)');

  // centre column: level/gold row + xp strip + skill slots
  const mid = document.createElement('div');
  mid.style.cssText = 'display:flex;flex-direction:column;gap:5px;align-items:center;';
  const statRow = document.createElement('div');
  statRow.style.cssText = 'display:flex;gap:16px;font:700 12px ui-sans-serif,system-ui;' +
    'text-shadow:0 1px 3px #000;align-items:center;';
  const lvlEl = document.createElement('span');
  lvlEl.style.cssText = 'color:#ffd66e;';
  const goldEl = document.createElement('span');
  goldEl.style.cssText = 'color:#ffcf40;';
  const killsEl = document.createElement('span');
  killsEl.style.cssText = 'color:#ff8f7a;';
  statRow.append(lvlEl, goldEl, killsEl);

  const xpBar = document.createElement('div');
  xpBar.style.cssText = 'width:280px;height:7px;border-radius:4px;overflow:hidden;' +
    'background:rgba(30,22,14,0.85);border:1px solid rgba(200,160,90,0.45);';
  const xpFill = document.createElement('div');
  xpFill.style.cssText = 'height:100%;width:0%;background:linear-gradient(90deg,#c89b3c,#ffe28a);transition:width 0.2s;';
  xpBar.appendChild(xpFill);

  const slotsRow = document.createElement('div');
  slotsRow.style.cssText = 'display:flex;gap:8px;';

  mid.append(statRow, xpBar, slotsRow);

  // equipment column: 3 mini slots to the right of the mana orb. These are
  // the ONLY pointer-enabled HUD nodes (native title tooltips on hover).
  const equipCol = document.createElement('div');
  equipCol.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

  bar.append(hpOrb, mid, mpOrb, equipCol);

  // ── top-centre: quest + boss bar ──────────────────────────────────────
  const questEl = document.createElement('div');
  questEl.style.cssText = 'position:absolute;top:12px;left:50%;transform:translateX(-50%);' +
    'padding:5px 16px;border-radius:8px;background:rgba(12,8,6,0.68);border:1px solid rgba(200,160,90,0.35);' +
    'font:600 13px ui-sans-serif,system-ui;color:#e8cf9a;text-shadow:0 1px 2px #000;white-space:nowrap;';

  const bossWrap = document.createElement('div');
  bossWrap.style.cssText = 'position:absolute;top:52px;left:50%;transform:translateX(-50%);width:420px;display:none;';
  const bossName = document.createElement('div');
  bossName.style.cssText = 'text-align:center;font:800 15px ui-sans-serif,system-ui;color:#ff6a52;' +
    'text-shadow:0 0 10px rgba(255,60,30,0.6),0 1px 3px #000;letter-spacing:3px;margin-bottom:3px;';
  const bossBar = document.createElement('div');
  bossBar.style.cssText = 'height:12px;border-radius:6px;overflow:hidden;background:rgba(20,6,6,0.85);' +
    'border:1px solid rgba(255,90,60,0.55);';
  const bossFill = document.createElement('div');
  bossFill.style.cssText = 'height:100%;width:100%;background:linear-gradient(90deg,#a00d0d,#ff4a2a);transition:width 0.15s;';
  bossBar.appendChild(bossFill);
  bossWrap.append(bossName, bossBar);

  // ── top-right: minimal控制提示 ─────────────────────────────────────────
  const hint = document.createElement('div');
  hint.style.cssText = 'position:absolute;top:12px;right:14px;padding:5px 12px;border-radius:8px;' +
    'background:rgba(12,8,6,0.55);font:500 11px ui-sans-serif,system-ui;color:#cbb;opacity:0.9;text-align:right;line-height:1.6;';
  hint.innerHTML = '<b>WASD</b> 移动 · <b>左键/1-4</b> 朝光标施法<br><b>B</b> 背包 · <b>V</b> 切视角 · <b>右键拖拽</b> 转镜头';

  // ── centre overlays ───────────────────────────────────────────────────
  const areaEl = document.createElement('div');
  areaEl.style.cssText = 'position:absolute;left:50%;top:26%;transform:translate(-50%,-50%);display:none;text-align:center;';

  const bannerEl = document.createElement('div');
  bannerEl.style.cssText = 'position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);display:none;' +
    'font:900 46px ui-sans-serif,system-ui;letter-spacing:6px;white-space:nowrap;' +
    'text-shadow:0 0 24px rgba(255,150,50,0.8),0 4px 12px rgba(0,0,0,0.7);';

  const deathEl = document.createElement('div');
  deathEl.style.cssText = 'position:absolute;inset:0;display:none;align-items:center;justify-content:center;' +
    'flex-direction:column;gap:14px;background:radial-gradient(circle at center,rgba(40,0,0,0.55),rgba(10,0,0,0.85));';
  deathEl.innerHTML = '<div style="font:900 58px ui-serif,Georgia,serif;color:#c22;letter-spacing:10px;' +
    'text-shadow:0 0 30px rgba(255,0,0,0.5)">你已死亡</div>' +
    '<div style="font:600 16px ui-sans-serif,system-ui;color:#daa">按 <b style="color:#fff">R</b> 在余烬哨站复活（损失少量经验）</div>';

  const dmgFlash = document.createElement('div');
  dmgFlash.style.cssText = 'position:absolute;inset:0;opacity:0;pointer-events:none;' +
    'background:radial-gradient(circle at center,transparent 35%,rgba(200,20,20,0.65) 100%);';

  const popups = document.createElement('div');
  popups.style.cssText = 'position:absolute;inset:0;overflow:visible;';

  root.append(bar, questEl, bossWrap, hint, areaEl, bannerEl, dmgFlash, deathEl, popups);
  mount.appendChild(root);

  // ── setters ───────────────────────────────────────────────────────────
  const setOrbs = (hp: number, maxHp: number, mana: number, maxMana: number) => {
    const hpP = Math.max(0, Math.min(1, maxHp > 0 ? hp / maxHp : 0));
    const mpP = Math.max(0, Math.min(1, maxMana > 0 ? mana / maxMana : 0));
    hpFill.style.height = `${(hpP * 100).toFixed(1)}%`;
    mpFill.style.height = `${(mpP * 100).toFixed(1)}%`;
    hpTxt.textContent = `${Math.max(0, Math.ceil(hp))}`;
    mpTxt.textContent = `${Math.floor(mana)}`;
  };
  const setXp = (level: number, cur: number, max: number) => {
    lvlEl.textContent = `等级 ${level}`;
    xpFill.style.width = `${Math.max(0, Math.min(100, max > 0 ? (cur / max) * 100 : 0)).toFixed(1)}%`;
  };
  const setGold = (n: number) => { goldEl.textContent = `💰 ${n}`; };
  const setKills = (n: number) => { killsEl.textContent = `☠ ${n}`; };

  const setSkills = (slots: SkillSlotState[]) => {
    slotsRow.innerHTML = '';
    for (const s of slots) {
      const slot = document.createElement('div');
      slot.style.cssText = 'position:relative;width:52px;height:52px;border-radius:8px;overflow:hidden;' +
        `background:rgba(16,10,8,0.92);border:2px solid ${s.locked ? 'rgba(90,80,70,0.5)' : 'rgba(200,150,80,0.65)'};` +
        'display:flex;align-items:center;justify-content:center;font-size:24px;' +
        (s.locked ? 'filter:grayscale(0.9) brightness(0.6);' : '');
      slot.textContent = s.icon;
      const key = document.createElement('div');
      key.style.cssText = 'position:absolute;top:1px;left:4px;font:700 10px ui-monospace,Menlo,monospace;color:#e8cf9a;text-shadow:0 1px 2px #000;';
      key.textContent = s.key;
      slot.appendChild(key);
      if (s.locked) {
        const lk = document.createElement('div');
        lk.style.cssText = 'position:absolute;bottom:1px;right:4px;font:700 9px ui-sans-serif;color:#caa;';
        lk.textContent = `L${s.unlockLevel}`;
        slot.appendChild(lk);
      } else {
        const cost = document.createElement('div');
        cost.style.cssText = `position:absolute;bottom:1px;right:4px;font:700 9px ui-sans-serif;color:${s.affordable ? '#7da2ff' : '#ff6a6a'};text-shadow:0 1px 2px #000;`;
        cost.textContent = `${s.manaCost}`;
        slot.appendChild(cost);
        if (s.cooldownPct > 0.02) {
          const veil = document.createElement('div');
          veil.style.cssText = `position:absolute;left:0;top:0;width:100%;height:${(s.cooldownPct * 100).toFixed(0)}%;background:rgba(0,0,0,0.62);`;
          slot.appendChild(veil);
        }
      }
      slotsRow.appendChild(slot);
    }
  };

  const setEquipment = (slots: EquipSlotState[]) => {
    equipCol.innerHTML = '';
    for (const s of slots) {
      const el = document.createElement('div');
      el.style.cssText = 'position:relative;width:26px;height:26px;border-radius:6px;' +
        `background:rgba(16,10,8,0.92);border:2px solid ${s.color ?? 'rgba(90,80,70,0.4)'};` +
        'display:flex;align-items:center;justify-content:center;font-size:13px;pointer-events:auto;' +
        (s.color ? '' : 'filter:grayscale(0.9) brightness(0.55);');
      el.textContent = s.icon;
      if (s.tooltip) el.title = s.tooltip;
      equipCol.appendChild(el);
    }
  };

  const setQuest = (text: string) => { questEl.textContent = text; };
  const setBoss = (name: string | null, cur = 0, max = 1) => {
    if (!name) { bossWrap.style.display = 'none'; return; }
    bossWrap.style.display = 'block';
    bossName.textContent = name;
    bossFill.style.width = `${Math.max(0, Math.min(100, (cur / max) * 100)).toFixed(1)}%`;
  };

  let areaTimer: number | undefined;
  const showArea = (name: string, sub?: string) => {
    areaEl.innerHTML = `<div style="font:900 42px ui-serif,Georgia,serif;color:#e8cf9a;letter-spacing:8px;` +
      `text-shadow:0 0 22px rgba(230,180,90,0.55),0 4px 12px #000;">${name}</div>` +
      (sub ? `<div style="margin-top:6px;font:600 14px ui-sans-serif;color:#b9a888;letter-spacing:3px;">${sub}</div>` : '');
    areaEl.style.display = 'block';
    areaEl.style.animation = 'none';
    void areaEl.offsetWidth;
    areaEl.style.animation = 'hf-area 2.6s ease-out forwards';
    if (areaTimer) window.clearTimeout(areaTimer);
    areaTimer = window.setTimeout(() => { areaEl.style.display = 'none'; }, 2600);
  };

  let bannerTimer: number | undefined;
  const banner = (text: string, color = '#ffd066', ms = 1600) => {
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
    const p = document.createElement('div');
    p.textContent = text;
    p.style.cssText = `position:absolute;left:${sx}px;top:${sy}px;transform:translate(-50%,-100%);` +
      `color:${style?.color ?? '#ffe28a'};font:800 ${style?.size ?? 18}px ui-sans-serif,system-ui;` +
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

  const showDeath = (show: boolean) => {
    deathEl.style.display = show ? 'flex' : 'none';
  };

  setOrbs(80, 80, 50, 50);
  setXp(1, 0, 60);
  setGold(0);
  setKills(0);

  return {
    setOrbs, setXp, setGold, setKills, setSkills, setEquipment, setQuest, setBoss,
    showArea, banner, floatText, damageFlash, showDeath,
    dispose: () => root.remove(),
  };
}
