import { HUMAN_PLAYER, PLAYER_COLORS, RESOURCE_KEYS, RESOURCE_NAMES } from '../core/constants';
import { playerTotalVp } from '../core/game-state';
import {
  bankReceiveHint,
  canHumanBuildRoad,
  canHumanBuildVillage,
  canHumanBuyDevCard,
  canHumanUpgradeTown,
  devCardLabel,
  formatMissingList,
  getHumanActionGaps,
  tradeRateForGive,
  updateAchievements,
} from '../core/rules';
import type { DevCardKind, GameState, HarvestGainEvent, PlayerState, ResourceKey } from '../core/types';
import { isHumanActive } from '../systems/phase-controller';
import { BOTTOM_BAR_FALLBACK_H, setBottomBarHeight, TOP_BAR_H } from './layout';

const HUD_ID = 'luo-sai-ya-hud';

function phaseLabel(phase: GameState['phase']): string {
  const map: Record<GameState['phase'], string> = {
    init: '初始化',
    map_ready: '地图就绪',
    setup_village: '开局·村庄',
    setup_road: '开局·道路',
    turn_roll: '掷骰',
    turn_harvest: '收割',
    turn_robber_discard: '弃牌',
    turn_robber_move: '移强盗',
    turn_robber_steal: '掠夺',
    turn_develop: '自由发展',
    game_over: '结束',
  };
  return map[phase] ?? phase;
}

export interface HudCallbacks {
  onNextPhase: () => void;
  onToggleSkipConfirm: () => void;
  onBuildRoad: () => void;
  onBuildVillage: () => void;
  onUpgradeTown: () => void;
  onTrade: () => void;
  onBuyDevCard: () => void;
  onPlayDevCard: (index: number) => void;
  onMonopolyPick: (resource: ResourceKey) => void;
  onCancelMode: () => void;
  onBankTrade: (give: ResourceKey, receive: ResourceKey) => void;
  onPlayerTrade: (toId: number, offer: Partial<Record<ResourceKey, number>>, request: Partial<Record<ResourceKey, number>>) => void;
  onSaveGame: () => void;
  onReturnMainMenu: () => void;
  onShowHelp: () => void;
}

export interface HudApi {
  bind(state: GameState): void;
  refresh(): void;
  playHarvestPops(gains: HarvestGainEvent[]): void;
  clearHarvestPops(): void;
  setCallbacks(cb: HudCallbacks): void;
  setVisible(visible: boolean): void;
  showPauseMenu(): void;
  hidePauseMenu(): void;
  flashToast(message: string): void;
  dispose(): void;
}

function btn(bg: string, compact = false): string {
  return (
    `padding:${compact ? '5px 8px' : '6px 10px'};border-radius:6px;border:none;` +
    `background:${bg};color:#fff;font-size:11px;font-weight:600;cursor:pointer;white-space:nowrap;`
  );
}

const RES_CHIP: Record<ResourceKey, string> = {
  wood: '#166534',
  brick: '#9a3412',
  ore: '#475569',
  wheat: '#a16207',
  sheep: '#3f6212',
};

function resourceChipsHtml(r: PlayerState['resources'], dimZero = false, large = false): string {
  const pad = large ? '3px 8px' : '2px 6px';
  const fs = large ? '11px' : '10px';
  const fw = large ? '700' : '600';
  return RESOURCE_KEYS.map((k) => {
    const n = r[k];
    if (dimZero && n === 0) {
      return `<span style="opacity:0.35;padding:2px 5px;font-size:10px;">${RESOURCE_NAMES[k]}0</span>`;
    }
    return `<span style="background:${RES_CHIP[k]};padding:${pad};border-radius:5px;font-size:${fs};font-weight:${fw};">` +
      `${RESOURCE_NAMES[k]}${n}</span>`;
  }).join('');
}

function compactPlayerResources(p: PlayerState): string {
  const parts = RESOURCE_KEYS.filter((k) => p.resources[k] > 0).map(
    (k) => `<span style="background:${RES_CHIP[k]};padding:1px 4px;border-radius:3px;font-size:9px;font-weight:700;">` +
      `${RESOURCE_NAMES[k]}${p.resources[k]}</span>`,
  );
  return parts.length ? parts.join('') : '<span style="opacity:0.35;font-size:9px;">空</span>';
}

const DEV_CARD_BG: Record<DevCardKind, string> = {
  knight: '#b91c1c',
  university: '#6d28d9',
  monopoly: '#b45309',
};

function playerScoreRow(p: PlayerState, isActive: boolean): string {
  const shortName = p.name.replace('（你）', '').replace('玩家 ', 'P');
  const vp = playerTotalVp(p);
  return (
    `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;min-width:120px;">` +
    `<span style="display:flex;align-items:center;gap:4px;">` +
    `<span style="width:7px;height:7px;border-radius:50%;background:${PLAYER_COLORS[p.id]};` +
    `${isActive ? 'box-shadow:0 0 6px ' + PLAYER_COLORS[p.id] + ';' : ''}"></span>` +
    `<span style="font-size:10px;font-weight:700;color:${PLAYER_COLORS[p.id]}">${shortName}</span>` +
    `</span>` +
    `<span style="font-size:12px;font-weight:800;color:${vp >= 10 ? '#fbbf24' : '#f1f5f9'}">${vp}分</span>` +
    `</div>`
  );
}
function playerOverviewRow(p: PlayerState, isActive: boolean): string {
  const shortName = p.name.replace('（你）', '').replace('玩家 ', 'P');
  return (
    `<div style="display:flex;align-items:center;gap:4px;${isActive ? 'opacity:1;' : 'opacity:0.88;'}">` +
    `<span style="width:7px;height:7px;border-radius:50%;background:${PLAYER_COLORS[p.id]};flex-shrink:0;` +
    `${isActive ? 'box-shadow:0 0 6px ' + PLAYER_COLORS[p.id] + ';' : ''}"></span>` +
    `<span style="font-size:9px;font-weight:700;color:${PLAYER_COLORS[p.id]};min-width:36px;flex-shrink:0;">${shortName}</span>` +
    `<span style="display:flex;gap:2px;flex-wrap:wrap;">${compactPlayerResources(p)}</span>` +
    `</div>`
  );
}

function harvestPopChipsHtml(playerId: number, gains: HarvestGainEvent[]): string {
  const totals = new Map<ResourceKey, number>();
  for (const g of gains) {
    if (g.playerId !== playerId) continue;
    totals.set(g.resource, (totals.get(g.resource) ?? 0) + g.amount);
  }
  if (!totals.size) return '';
  return [...totals.entries()]
    .map(([resource, amount]) => {
      const border = PLAYER_COLORS[playerId];
      const bg = RES_CHIP[resource];
      return (
        `<span class="luo-harvest-pop" style="background:${bg};border-color:${border};">` +
        `+${amount} ${RESOURCE_NAMES[resource]}</span>`
      );
    })
    .join('');
}

function playerOverviewBlock(p: PlayerState, isActive: boolean, gains: HarvestGainEvent[]): string {
  const popHtml = harvestPopChipsHtml(p.id, gains);
  return (
    `<div data-player-row="${p.id}" style="display:flex;flex-direction:column;gap:3px;">` +
    playerOverviewRow(p, isActive) +
    (popHtml
      ? `<div style="display:flex;flex-wrap:wrap;gap:3px;padding-left:15px;min-height:18px;">${popHtml}</div>`
      : '') +
    `</div>`
  );
}
function partnerInventoryText(p: PlayerState): string {
  const parts = RESOURCE_KEYS.filter((k) => p.resources[k] > 0).map(
    (k) => `${RESOURCE_NAMES[k]}×${p.resources[k]}`,
  );
  return parts.length ? parts.join('、') : '（空）';
}

export function installHud(): HudApi {
  document.getElementById(HUD_ID)?.remove();

  const style = document.createElement('style');
  style.textContent = `
    html, body { margin:0; padding:0; width:100%; height:100%; overflow:hidden; background:#0c1220; }
    #${HUD_ID} * { box-sizing:border-box; }
    #${HUD_ID} select, #${HUD_ID} input { font-size:11px; }
    @keyframes luoHarvestPopIn {
      0% { opacity:0; transform:translateY(12px) scale(0.75); }
      100% { opacity:1; transform:translateY(0) scale(1); }
    }
    .luo-harvest-pop {
      display:inline-block;
      padding:2px 7px;
      border-radius:6px;
      font-size:10px;
      font-weight:800;
      color:#fff;
      border:2px solid;
      box-shadow:0 2px 8px rgba(0,0,0,0.45);
      animation:luoHarvestPopIn 0.35s ease-out forwards;
      pointer-events:none;
      white-space:nowrap;
      text-shadow:0 1px 2px rgba(0,0,0,0.6);
      line-height:1.2;
    }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = HUD_ID;
  root.style.cssText =
    'position:fixed;inset:0;z-index:9999;pointer-events:none;font-family:system-ui,sans-serif;color:#f1f5f9;';

  const topBar = document.createElement('div');
  topBar.style.cssText =
    `position:absolute;top:0;left:0;right:0;height:${TOP_BAR_H}px;pointer-events:auto;` +
    'display:flex;align-items:center;gap:8px;padding:0 10px;' +
    'background:rgba(8,12,22,0.92);border-bottom:1px solid rgba(255,255,255,0.08);';
  root.appendChild(topBar);

  const title = document.createElement('span');
  title.textContent = '洛塞娅';
  title.style.cssText = 'font-weight:800;color:#fbbf24;font-size:14px;margin-right:4px;';
  topBar.appendChild(title);

  const menuBtn = document.createElement('button');
  menuBtn.textContent = '菜单';
  menuBtn.title = '保存 / 返回主菜单 / 玩法说明';
  menuBtn.style.cssText = btn('#475569', true);
  topBar.appendChild(menuBtn);

  const statusEl = document.createElement('span');
  statusEl.style.cssText = 'font-size:11px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  topBar.appendChild(statusEl);

  const actionWrap = document.createElement('div');
  actionWrap.style.cssText = 'display:none;gap:4px;align-items:center;';
  const roadBtn = document.createElement('button');
  roadBtn.textContent = '路';
  roadBtn.style.cssText = btn('#1d4ed8', true);
  const villageBtn = document.createElement('button');
  villageBtn.textContent = '村';
  villageBtn.style.cssText = btn('#15803d', true);
  const townBtn = document.createElement('button');
  townBtn.textContent = '城';
  townBtn.style.cssText = btn('#7e22ce', true);
  const devBtn = document.createElement('button');
  devBtn.textContent = '卡';
  devBtn.style.cssText = btn('#7c3aed', true);
  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = '取消';
  cancelBtn.style.cssText = btn('#475569', true);
  actionWrap.append(roadBtn, villageBtn, townBtn, devBtn, cancelBtn);
  topBar.appendChild(actionWrap);

  const rightWrap = document.createElement('div');
  rightWrap.style.cssText = 'display:flex;gap:6px;align-items:center;margin-left:auto;flex-shrink:0;';

  const skipBtn = document.createElement('button');
  skipBtn.textContent = '跳过确认';
  skipBtn.title = '默认开启：选点即放置，各步骤分步自动推进（可点击关闭）';
  skipBtn.style.cssText = btn('#334155', true);

  const nextBtn = document.createElement('button');
  nextBtn.style.cssText = btn('linear-gradient(135deg,#d97706,#b45309)') + 'min-width:88px;';
  rightWrap.append(skipBtn, nextBtn);
  topBar.appendChild(rightWrap);

  const overviewWrap = document.createElement('div');
  overviewWrap.style.cssText =
    `position:absolute;top:${TOP_BAR_H + 6}px;left:8px;pointer-events:none;` +
    'display:none;align-items:flex-start;gap:6px;z-index:10000;max-width:min(52vw,420px);';
  root.appendChild(overviewWrap);

  const leftCol = document.createElement('div');
  leftCol.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
  overviewWrap.appendChild(leftCol);

  const scorePanel = document.createElement('div');
  scorePanel.style.cssText =
    'background:rgba(8,12,22,0.9);border-radius:8px;padding:6px 8px;' +
    'border:1px solid rgba(251,191,36,0.25);display:flex;flex-direction:column;gap:4px;' +
    'box-shadow:0 4px 16px rgba(0,0,0,0.35);';
  const scoreTitle = document.createElement('div');
  scoreTitle.textContent = '积分榜';
  scoreTitle.style.cssText = 'font-size:9px;font-weight:700;color:#fbbf24;margin-bottom:2px;';
  scorePanel.appendChild(scoreTitle);
  const scoreBody = document.createElement('div');
  scoreBody.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
  scorePanel.appendChild(scoreBody);
  leftCol.appendChild(scorePanel);

  const playersOverview = document.createElement('div');
  playersOverview.style.cssText =
    'background:rgba(8,12,22,0.9);border-radius:8px;padding:6px 8px;' +
    'border:1px solid rgba(255,255,255,0.1);display:flex;flex-direction:column;gap:4px;' +
    'box-shadow:0 4px 16px rgba(0,0,0,0.35);';
  const overviewTitle = document.createElement('div');
  overviewTitle.textContent = '资源总览';
  overviewTitle.style.cssText = 'font-size:9px;font-weight:700;color:#94a3b8;margin-bottom:2px;';
  playersOverview.appendChild(overviewTitle);
  const playersOverviewBody = document.createElement('div');
  playersOverviewBody.style.cssText = 'display:flex;flex-direction:column;gap:3px;';
  playersOverview.appendChild(playersOverviewBody);
  leftCol.appendChild(playersOverview);

  const devPanel = document.createElement('div');
  devPanel.style.cssText =
    `position:absolute;top:${TOP_BAR_H + 6}px;right:8px;pointer-events:auto;z-index:10000;` +
    'background:rgba(8,12,22,0.92);border-radius:8px;padding:6px 8px;max-width:min(42vw,280px);' +
    'border:1px solid rgba(167,139,250,0.25);box-shadow:0 4px 16px rgba(0,0,0,0.35);';
  const devTitle = document.createElement('div');
  devTitle.textContent = '我的发展卡';
  devTitle.style.cssText = 'font-size:9px;font-weight:700;color:#c4b5fd;margin-bottom:4px;';
  devPanel.appendChild(devTitle);
  const devHand = document.createElement('div');
  devHand.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;min-height:24px;';
  devPanel.appendChild(devHand);
  const monopolyPick = document.createElement('div');
  monopolyPick.style.cssText = 'display:none;flex-wrap:wrap;gap:4px;margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.08);';
  const monopolyLabel = document.createElement('div');
  monopolyLabel.textContent = '选择垄断资源：';
  monopolyLabel.style.cssText = 'width:100%;font-size:9px;color:#fcd34d;margin-bottom:2px;';
  monopolyPick.appendChild(monopolyLabel);
  for (const k of RESOURCE_KEYS) {
    const mb = document.createElement('button');
    mb.textContent = RESOURCE_NAMES[k];
    mb.style.cssText = btn(RES_CHIP[k], true);
    mb.dataset.resource = k;
    monopolyPick.appendChild(mb);
  }
  devPanel.appendChild(monopolyPick);
  root.appendChild(devPanel);

  const pauseOverlay = document.createElement('div');
  pauseOverlay.style.cssText =
    'display:none;position:absolute;inset:0;pointer-events:auto;z-index:10020;' +
    'background:rgba(0,0,0,0.65);align-items:center;justify-content:center;flex-direction:row;';
  const pauseCard = document.createElement('div');
  pauseCard.style.cssText =
    'background:#0f172a;border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:18px 20px;' +
    'min-width:240px;box-shadow:0 16px 40px rgba(0,0,0,0.5);';
  pauseCard.innerHTML = '<div style="font-weight:800;font-size:15px;margin-bottom:12px;color:#fbbf24;text-align:center">游戏菜单</div>';
  const pauseSaveBtn = document.createElement('button');
  pauseSaveBtn.textContent = '保存游戏';
  pauseSaveBtn.style.cssText = menuBtnStyle('linear-gradient(135deg,#059669,#047857)');
  const pauseSaveExitBtn = document.createElement('button');
  pauseSaveExitBtn.textContent = '保存并返回主菜单';
  pauseSaveExitBtn.style.cssText = menuBtnStyle('linear-gradient(135deg,#2563eb,#1d4ed8)');
  const pauseHelpBtn = document.createElement('button');
  pauseHelpBtn.textContent = '玩法说明';
  pauseHelpBtn.style.cssText = menuBtnStyle('#334155');
  const pauseResumeBtn = document.createElement('button');
  pauseResumeBtn.textContent = '继续游戏';
  pauseResumeBtn.style.cssText = menuBtnStyle('linear-gradient(135deg,#d97706,#b45309)');
  pauseCard.append(pauseSaveBtn, pauseSaveExitBtn, pauseHelpBtn, pauseResumeBtn);
  pauseOverlay.appendChild(pauseCard);
  root.appendChild(pauseOverlay);

  const toastEl = document.createElement('div');
  toastEl.style.cssText =
    'display:none;position:absolute;top:52px;left:50%;transform:translateX(-50%);z-index:10030;' +
    'padding:8px 14px;border-radius:8px;background:rgba(5,150,105,0.95);color:#fff;' +
    'font-size:12px;font-weight:700;pointer-events:none;box-shadow:0 4px 12px rgba(0,0,0,0.35);';
  root.appendChild(toastEl);

  function menuBtnStyle(bg: string): string {
    return `display:block;width:100%;margin-bottom:8px;padding:10px;border:none;border-radius:8px;color:#fff;font-weight:700;cursor:pointer;background:${bg};`;
  }

  const bottomBar = document.createElement('div');
  bottomBar.id = 'luo-sai-ya-bottom-bar';
  bottomBar.style.cssText =
    'position:absolute;bottom:0;left:0;right:0;pointer-events:auto;' +
    'display:flex;flex-direction:column;padding:6px 10px 10px;gap:4px;' +
    'max-height:min(42vh,320px);overflow-x:hidden;overflow-y:auto;' +
    'background:rgba(8,12,22,0.98);border-top:1px solid rgba(255,255,255,0.12);' +
    'box-shadow:0 -4px 24px rgba(0,0,0,0.35);';
  root.appendChild(bottomBar);

  function syncBottomBarHeight(): void {
    const h = Math.ceil(bottomBar.getBoundingClientRect().height);
    setBottomBarHeight(Math.max(h, 100));
  }

  const barObserver = new ResizeObserver(() => syncBottomBarHeight());
  barObserver.observe(bottomBar);
  setBottomBarHeight(BOTTOM_BAR_FALLBACK_H);

  const resRow = document.createElement('div');
  resRow.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
  const resLabel = document.createElement('span');
  resLabel.textContent = '我的资源';
  resLabel.style.cssText = 'font-size:11px;font-weight:700;color:#94a3b8;margin-right:2px;';
  resRow.appendChild(resLabel);
  const resChips = document.createElement('div');
  resChips.style.cssText = 'display:flex;gap:5px;flex-wrap:wrap;';
  resRow.appendChild(resChips);
  bottomBar.appendChild(resRow);

  const othersRow = document.createElement('div');
  othersRow.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;align-items:flex-start;';
  bottomBar.appendChild(othersRow);

  const gapRow = document.createElement('div');
  gapRow.style.cssText = 'font-size:10px;line-height:1.4;color:#cbd5e1;flex-shrink:0;';
  bottomBar.appendChild(gapRow);

  const tradeRow = document.createElement('div');
  tradeRow.style.cssText =
    'display:flex;align-items:flex-start;gap:10px;flex-shrink:0;font-size:11px;padding-top:2px;';
  bottomBar.appendChild(tradeRow);

  const tradeLeft = document.createElement('div');
  tradeLeft.style.cssText = 'flex:1;min-width:0;';
  tradeLeft.innerHTML = '<div style="font-weight:700;color:#67e8f9;margin-bottom:4px">银行交易</div>';
  const bankLine = document.createElement('div');
  bankLine.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;';
  const bankGive = document.createElement('select');
  const bankRecv = document.createElement('select');
  for (const k of RESOURCE_KEYS) {
    bankGive.add(new Option(RESOURCE_NAMES[k], k));
    bankRecv.add(new Option(RESOURCE_NAMES[k], k));
  }
  bankRecv.value = 'brick';
  const bankRate = document.createElement('span');
  bankRate.style.cssText = 'color:#a5f3fc;font-size:10px;';
  const bankHint = document.createElement('div');
  bankHint.style.cssText = 'margin-top:3px;font-size:10px;color:#fcd34d;line-height:1.35;';
  const bankConfirm = document.createElement('button');
  bankConfirm.textContent = '确认';
  bankConfirm.style.cssText = btn('#0891b2', true);
  bankLine.append('付', bankGive, '→', bankRecv, bankRate, bankConfirm);
  tradeLeft.append(bankLine, bankHint);
  tradeRow.appendChild(tradeLeft);

  const tradeRight = document.createElement('div');
  tradeRight.style.cssText = 'flex:1;min-width:0;border-left:1px solid rgba(255,255,255,0.08);padding-left:8px;';
  tradeRight.innerHTML = '<div style="font-weight:700;color:#67e8f9;margin-bottom:4px">玩家交易</div>';
  const partnerSel = document.createElement('select');
  for (let i = 1; i < 4; i++) partnerSel.add(new Option(`玩家${i + 1}`, String(i)));
  partnerSel.style.marginRight = '6px';
  const playerLine = document.createElement('div');
  playerLine.style.cssText =
    'display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:3px;margin-bottom:4px;';
  const offerInputs: Partial<Record<ResourceKey, HTMLInputElement>> = {};
  const requestInputs: Partial<Record<ResourceKey, HTMLInputElement>> = {};
  for (const k of RESOURCE_KEYS) {
    const cell = document.createElement('div');
    cell.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;font-size:9px;';
    const lab = document.createElement('span');
    lab.textContent = RESOURCE_NAMES[k];
    lab.style.fontWeight = '700';
    const o = document.createElement('input');
    o.type = 'number';
    o.min = '0';
    o.max = '19';
    o.value = '0';
    o.title = `给出${RESOURCE_NAMES[k]}`;
    o.style.cssText = 'width:100%;max-width:40px;padding:2px;border-radius:4px;border:none;text-align:center;';
    offerInputs[k] = o;
    const r = document.createElement('input');
    r.type = 'number';
    r.min = '0';
    r.max = '19';
    r.value = '0';
    r.title = `要${RESOURCE_NAMES[k]}`;
    r.style.cssText = 'width:100%;max-width:40px;padding:2px;border-radius:4px;border:none;text-align:center;';
    requestInputs[k] = r;
    const outL = document.createElement('span');
    outL.textContent = '出';
    outL.style.opacity = '0.65';
    const inL = document.createElement('span');
    inL.textContent = '要';
    inL.style.opacity = '0.65';
    cell.append(lab, outL, o, inL, r);
    playerLine.appendChild(cell);
  }
  const playerConfirm = document.createElement('button');
  playerConfirm.textContent = '提出交易';
  playerConfirm.style.cssText = btn('#0891b2', true);
  const partnerInv = document.createElement('div');
  partnerInv.style.cssText = 'font-size:10px;color:#e2e8f0;margin-bottom:4px;line-height:1.35;';
  const playerHint = document.createElement('div');
  playerHint.style.cssText = 'font-size:10px;color:#fcd34d;line-height:1.35;';
  tradeRight.append(partnerSel, partnerInv, playerLine, playerConfirm, playerHint);
  tradeRow.appendChild(tradeRight);

  document.body.appendChild(root);

  let stateRef: GameState | null = null;
  let cb: HudCallbacks | null = null;
  let toastTimer = 0;
  let harvestPopGains: HarvestGainEvent[] = [];

  function flashToast(message: string): void {
    toastEl.textContent = message;
    toastEl.style.display = 'block';
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toastEl.style.display = 'none';
    }, 2200);
  }

  function updateBankUi(): void {
    if (!stateRef) return;
    const pid = HUMAN_PLAYER;
    const give = bankGive.value as ResourceKey;
    const recv = bankRecv.value as ResourceKey;
    const rate = tradeRateForGive(stateRef, pid, give);
    bankRate.textContent = `${rate}:1`;
    bankHint.textContent = bankReceiveHint(stateRef, pid, recv);
    if (give !== recv && rate <= stateRef.players[pid]!.resources[give]) {
      bankHint.textContent += ` · 本次付出${RESOURCE_NAMES[give]}×${rate}换${RESOURCE_NAMES[recv]}×1`;
    } else if (give !== recv && stateRef.players[pid]!.resources[give] < rate) {
      bankHint.textContent += ` · 还需${RESOURCE_NAMES[give]}×${rate - stateRef.players[pid]!.resources[give]}`;
    }
  }

  function updatePlayerTradeHint(): void {
    if (!stateRef) return;
    const request: Partial<Record<ResourceKey, number>> = {};
    for (const k of RESOURCE_KEYS) {
      const v = parseInt(requestInputs[k]!.value, 10) || 0;
      if (v > 0) request[k] = v;
    }
    const missingParts: string[] = [];
    const pid = HUMAN_PLAYER;
    const partner = stateRef.players[parseInt(partnerSel.value, 10)]!;
    for (const k of RESOURCE_KEYS) {
      const want = request[k] ?? 0;
      if (want <= 0) continue;
      const have = partner.resources[k];
      if (have < want) missingParts.push(`${partner.name}缺${RESOURCE_NAMES[k]}×${want - have}`);
    }
    const myGive: string[] = [];
    for (const k of RESOURCE_KEYS) {
      const g = parseInt(offerInputs[k]!.value, 10) || 0;
      if (g > 0 && stateRef.players[pid]!.resources[k] < g) {
        myGive.push(`你缺${RESOURCE_NAMES[k]}×${g - stateRef.players[pid]!.resources[k]}`);
      }
    }
    playerHint.textContent = [...myGive, ...missingParts].join('；') || '填写出/要数量后提出交易';
    partnerInv.innerHTML =
      `<span style="color:${PLAYER_COLORS[partner.id]};font-weight:700">${partner.name} 持有：</span>` +
      partnerInventoryText(partner);
  }

  bankGive.onchange = updateBankUi;
  bankRecv.onchange = updateBankUi;
  for (const k of RESOURCE_KEYS) {
    offerInputs[k]!.oninput = updatePlayerTradeHint;
    requestInputs[k]!.oninput = updatePlayerTradeHint;
  }
  partnerSel.onchange = updatePlayerTradeHint;

  function clearHarvestPops(): void {
    harvestPopGains = [];
    if (stateRef) refresh();
  }

  function playHarvestPops(gains: HarvestGainEvent[]): void {
    if (!gains.length) return;
    harvestPopGains = [...gains];
    refresh();
  }

  function refresh(): void {
    if (!stateRef) return;
    const s = stateRef;
    const human = s.players[HUMAN_PLAYER]!;
    const cur = s.players[s.currentPlayer];
    const humanTurn = isHumanActive(s);
    const develop = humanTurn && s.phase === 'turn_develop';

    statusEl.innerHTML =
      (s.round > 0 ? `R${s.round} ` : '') +
      `<b>${phaseLabel(s.phase)}</b>` +
      (cur ? ` · <span style="color:${PLAYER_COLORS[cur.id]}">${cur.name}</span>` : '') +
      (humanTurn ? ' <span style="color:#fbbf24">★你</span>' : '') +
      (s.lastDice ? ` · 🎲${s.lastDice[0]}+${s.lastDice[1]}=${s.diceSum}` : '');

    const showOverview = s.placements.villages.size > 0;
    overviewWrap.style.display = showOverview ? 'flex' : 'none';
    devPanel.style.display = showOverview ? 'block' : 'none';
    if (showOverview) {
      updateAchievements(s);
      scoreBody.innerHTML = s.players
        .map((p) => playerScoreRow(p, p.id === s.currentPlayer))
        .join('');
      playersOverviewBody.innerHTML = s.players
        .map((p) => playerOverviewBlock(p, p.id === s.currentPlayer, harvestPopGains))
        .join('');
    }

    const humanDev = s.players[HUMAN_PLAYER]!;
    const canPlayDev =
      s.phase === 'turn_develop' &&
      s.currentPlayer === HUMAN_PLAYER &&
      s.humanDevelopMode === 'idle';
    devHand.innerHTML = '';
    if (humanDev.devCards.length === 0) {
      const empty = document.createElement('span');
      empty.textContent = '（暂无）';
      empty.style.cssText = 'font-size:10px;color:#64748b;';
      devHand.appendChild(empty);
    } else {
      humanDev.devCards.forEach((card, i) => {
        const b = document.createElement('button');
        b.textContent = card.played ? `${devCardLabel(card.kind)}·已用` : devCardLabel(card.kind);
        b.title = card.played ? '本局已打出' : '点击打出';
        b.style.cssText = btn(DEV_CARD_BG[card.kind], true) + (card.played ? 'opacity:0.4;cursor:default;' : '');
        b.disabled = card.played || !canPlayDev;
        if (!card.played && canPlayDev) {
          b.onclick = () => cb?.onPlayDevCard(i);
        }
        devHand.appendChild(b);
      });
    }
    monopolyPick.style.display = s.humanDevelopMode === 'monopoly' ? 'flex' : 'none';
    for (const mb of monopolyPick.querySelectorAll('button[data-resource]')) {
      const el = mb as HTMLButtonElement;
      el.disabled = s.humanDevelopMode !== 'monopoly';
      el.onclick = () => cb?.onMonopolyPick(el.dataset.resource as ResourceKey);
    }
    if (s.humanDevelopMode === 'knight') {
      devTitle.textContent = '骑士：点击地图移强盗';
    } else if (s.humanDevelopMode === 'monopoly') {
      devTitle.textContent = '资源控制：选资源';
    } else {
      devTitle.textContent = '我的发展卡';
    }

    resChips.innerHTML = resourceChipsHtml(human.resources, false, true);

    const selectedPartner = parseInt(partnerSel.value, 10);
    othersRow.innerHTML =
      '<span style="font-size:10px;font-weight:700;color:#94a3b8;width:100%;margin-bottom:2px">其他玩家</span>' +
      s.players
        .filter((p) => p.id !== HUMAN_PLAYER)
        .map((p) => {
          const active = p.id === selectedPartner;
          return (
            `<div style="flex:1;min-width:140px;padding:4px 6px;border-radius:6px;` +
            `background:rgba(255,255,255,0.04);${active ? 'outline:1px solid #fbbf24;' : ''}">` +
            `<div style="color:${PLAYER_COLORS[p.id]};font-size:10px;font-weight:700;margin-bottom:3px">${p.name}</div>` +
            `<div style="display:flex;flex-wrap:wrap;gap:3px;">${resourceChipsHtml(p.resources, true)}</div>` +
            `</div>`
          );
        })
        .join('');

    const gaps = getHumanActionGaps(s, HUMAN_PLAYER);
    gapRow.innerHTML =
      '<span style="color:#94a3b8;font-weight:700;margin-right:6px">建造缺口</span>' +
      gaps
        .map((g) => {
          if (g.canBuild) {
            return `<span style="color:#4ade80;margin-right:10px">${g.label}✓</span>`;
          }
          if (g.resourcesReady) {
            const hint = g.blocker ?? '条件不足';
            return `<span style="margin-right:10px">${g.label}<span style="color:#86efac">资源✓</span> ` +
              `<span style="color:#fcd34d;font-size:10px">${hint}</span></span>`;
          }
          const miss = formatMissingList(g.missing);
          return `<span style="margin-right:10px">${g.label}缺 <b style="color:#fca5a5">${miss}</b></span>`;
        })
        .join('');

    actionWrap.style.display = develop ? 'flex' : 'none';
    tradeRow.style.opacity = develop || s.phase === 'turn_develop' && humanTurn ? '1' : '0.55';

    nextBtn.textContent = s.nextButtonLabel;

    skipBtn.textContent = s.skipConfirm ? '跳过确认 ✓' : '跳过确认';
    skipBtn.style.background = s.skipConfirm
      ? 'linear-gradient(135deg,#059669,#047857)'
      : '#334155';
    skipBtn.style.outline = s.skipConfirm ? '2px solid #6ee7b7' : 'none';

    if (develop) {
      const pid = s.currentPlayer;
      roadBtn.disabled = !canHumanBuildRoad(s, pid);
      villageBtn.disabled = !canHumanBuildVillage(s, pid);
      townBtn.disabled = !canHumanUpgradeTown(s, pid);
      devBtn.disabled = !canHumanBuyDevCard(s, pid);
      for (const b of [roadBtn, villageBtn, townBtn, devBtn]) {
        b.style.opacity = b.disabled ? '0.4' : '1';
      }
      roadBtn.style.outline = s.humanDevelopMode === 'road' ? '2px solid #fbbf24' : 'none';
      villageBtn.style.outline = s.humanDevelopMode === 'village' ? '2px solid #fbbf24' : 'none';
      townBtn.style.outline = s.humanDevelopMode === 'upgrade' ? '2px solid #fbbf24' : 'none';
      cancelBtn.style.display = s.humanDevelopMode !== 'idle' ? 'inline-block' : 'none';
    } else {
      cancelBtn.style.display = 'none';
    }

    updateBankUi();
    updatePlayerTradeHint();
    requestAnimationFrame(() => syncBottomBarHeight());
  }

  menuBtn.onclick = () => pauseOverlay.style.display = 'flex';
  pauseSaveBtn.onclick = () => cb?.onSaveGame();
  pauseSaveExitBtn.onclick = () => cb?.onReturnMainMenu();
  pauseHelpBtn.onclick = () => cb?.onShowHelp();
  pauseResumeBtn.onclick = () => {
    pauseOverlay.style.display = 'none';
  };

  nextBtn.onclick = () => cb?.onNextPhase();
  skipBtn.onclick = () => cb?.onToggleSkipConfirm();
  roadBtn.onclick = () => cb?.onBuildRoad();
  villageBtn.onclick = () => cb?.onBuildVillage();
  townBtn.onclick = () => cb?.onUpgradeTown();
  devBtn.onclick = () => cb?.onBuyDevCard();
  cancelBtn.onclick = () => cb?.onCancelMode();

  bankConfirm.onclick = () => {
    cb?.onBankTrade(bankGive.value as ResourceKey, bankRecv.value as ResourceKey);
  };

  playerConfirm.onclick = () => {
    const offer: Partial<Record<ResourceKey, number>> = {};
    const request: Partial<Record<ResourceKey, number>> = {};
    for (const k of RESOURCE_KEYS) {
      const o = parseInt(offerInputs[k]!.value, 10) || 0;
      const r = parseInt(requestInputs[k]!.value, 10) || 0;
      if (o > 0) offer[k] = o;
      if (r > 0) request[k] = r;
    }
    cb?.onPlayerTrade(parseInt(partnerSel.value, 10), offer, request);
  };

  return {
    bind(state) {
      stateRef = state;
    },
    refresh,
    playHarvestPops,
    clearHarvestPops,
    setCallbacks(callbacks) {
      cb = callbacks;
    },
    setVisible(visible) {
      root.style.display = visible ? 'block' : 'none';
      if (!visible) pauseOverlay.style.display = 'none';
    },
    showPauseMenu() {
      pauseOverlay.style.display = 'flex';
    },
    hidePauseMenu() {
      pauseOverlay.style.display = 'none';
    },
    flashToast,
    dispose() {
      barObserver.disconnect();
      root.remove();
      style.remove();
    },
  };
}
