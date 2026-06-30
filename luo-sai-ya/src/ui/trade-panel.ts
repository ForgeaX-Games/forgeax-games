import { HUMAN_PLAYER, RESOURCE_NAMES } from '../core/constants';
import { tradeRateForGive, tryBankTrade, tryPlayerTrade } from '../core/rules';
import type { GameState, ResourceBag, ResourceKey } from '../core/types';
import { aiAcceptsTrade } from '../systems/ai';
import { appendLog } from '../core/game-state';

const RES_KEYS: ResourceKey[] = ['wood', 'brick', 'ore', 'wheat', 'sheep'];
const PANEL_ID = 'luo-sai-ya-trade';

export interface TradePanelApi {
  open(state: GameState, onClose: () => void): void;
  close(): void;
  isOpen(): boolean;
}

export function installTradePanel(): TradePanelApi {
  let root: HTMLDivElement | null = null;
  let closeFn: (() => void) | null = null;

  function close(): void {
    root?.remove();
    root = null;
    closeFn?.();
    closeFn = null;
  }

  function mkResRow(
    label: string,
    counts: Record<ResourceKey, number>,
    onChange: (k: ResourceKey, delta: number) => void,
    maxFrom?: ResourceBag,
  ): HTMLDivElement {
    const row = document.createElement('div');
    row.style.cssText = 'margin-bottom:8px;';
    const lbl = document.createElement('div');
    lbl.textContent = label;
    lbl.style.cssText = 'font-size:11px;opacity:0.8;margin-bottom:4px;';
    row.appendChild(lbl);
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(5,1fr);gap:4px;';
    for (const k of RES_KEYS) {
      const cell = document.createElement('div');
      cell.style.cssText =
        'background:rgba(255,255,255,0.06);border-radius:6px;padding:4px;text-align:center;font-size:10px;';
      cell.innerHTML = `${RESOURCE_NAMES[k]}<br/><b id="tc-${label}-${k}">${counts[k]}</b>`;
      const btns = document.createElement('div');
      btns.style.cssText = 'display:flex;gap:2px;justify-content:center;margin-top:2px;';
      const minus = document.createElement('button');
      minus.textContent = '−';
      minus.style.cssText = 'width:20px;height:18px;border:none;border-radius:4px;cursor:pointer;font-size:12px;';
      const plus = document.createElement('button');
      plus.textContent = '+';
      plus.style.cssText = minus.style.cssText;
      minus.onclick = () => onChange(k, -1);
      plus.onclick = () => {
        if (maxFrom && counts[k] >= maxFrom[k]) return;
        onChange(k, 1);
      };
      btns.appendChild(minus);
      btns.appendChild(plus);
      cell.appendChild(btns);
      grid.appendChild(cell);
    }
    row.appendChild(grid);
    return row;
  }

  function open(state: GameState, onClose: () => void): void {
    close();
    closeFn = onClose;

    root = document.createElement('div');
    root.id = PANEL_ID;
    root.style.cssText =
      'position:fixed;inset:0;z-index:20000;background:rgba(0,0,0,0.55);' +
      'display:flex;align-items:center;justify-content:center;';
    document.body.appendChild(root);

    const box = document.createElement('div');
    box.style.cssText =
      'width:min(420px,92vw);max-height:85vh;overflow-y:auto;background:#0f172a;' +
      'border:1px solid rgba(255,255,255,0.15);border-radius:12px;padding:16px;color:#f1f5f9;';
    root.appendChild(box);

    const title = document.createElement('div');
    title.textContent = '资源交易';
    title.style.cssText = 'font-size:16px;font-weight:800;margin-bottom:12px;color:#fbbf24;';
    box.appendChild(title);

    const tabs = document.createElement('div');
    tabs.style.cssText = 'display:flex;gap:6px;margin-bottom:12px;';
    const bankTab = document.createElement('button');
    bankTab.textContent = '银行 / 港口';
    const playerTab = document.createElement('button');
    playerTab.textContent = '玩家交易';
    for (const b of [bankTab, playerTab]) {
      b.style.cssText =
        'flex:1;padding:8px;border:none;border-radius:8px;cursor:pointer;font-weight:600;font-size:12px;';
    }
    tabs.appendChild(bankTab);
    tabs.appendChild(playerTab);
    box.appendChild(tabs);

    const bankPane = document.createElement('div');
    const playerPane = document.createElement('div');
    playerPane.style.display = 'none';
    box.appendChild(bankPane);
    box.appendChild(playerPane);

    // --- Bank trade ---
    let bankGive: ResourceKey = 'wood';
    let bankReceive: ResourceKey = 'brick';

    const bankGiveSel = document.createElement('select');
    const bankRecvSel = document.createElement('select');
    for (const k of RES_KEYS) {
      const og = document.createElement('option');
      og.value = k;
      og.textContent = RESOURCE_NAMES[k];
      bankGiveSel.appendChild(og);
      const or = document.createElement('option');
      or.value = k;
      or.textContent = RESOURCE_NAMES[k];
      bankRecvSel.appendChild(or);
    }
    bankRecvSel.value = 'brick';

    const rateHint = document.createElement('div');
    rateHint.style.cssText = 'font-size:11px;color:#93c5fd;margin:8px 0;';

    function refreshBankHint(): void {
      const rate = tradeRateForGive(state, HUMAN_PLAYER, bankGive);
      rateHint.textContent = `汇率：${RESOURCE_NAMES[bankGive]}×${rate} → ${RESOURCE_NAMES[bankReceive]}×1` +
        (rate < 4 ? '（港口优惠）' : '（银行 4:1）');
    }

    bankGiveSel.onchange = () => {
      bankGive = bankGiveSel.value as ResourceKey;
      refreshBankHint();
    };
    bankRecvSel.onchange = () => {
      bankReceive = bankRecvSel.value as ResourceKey;
      refreshBankHint();
    };

    bankPane.innerHTML = '<div style="font-size:12px;margin-bottom:6px;">选择付出与获得资源：</div>';
    const bankRow = document.createElement('div');
    bankRow.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:8px;flex-wrap:wrap;';
    const giveLbl = document.createElement('span');
    giveLbl.textContent = '付出';
    giveLbl.style.fontSize = '12px';
    const arrow = document.createElement('span');
    arrow.textContent = '→ 得到';
    arrow.style.fontSize = '12px';
    bankRow.appendChild(giveLbl);
    bankRow.appendChild(bankGiveSel);
    bankRow.appendChild(arrow);
    bankRow.appendChild(bankRecvSel);
    bankPane.appendChild(bankRow);
    bankPane.appendChild(rateHint);
    refreshBankHint();

    const bankBtn = document.createElement('button');
    bankBtn.textContent = '确认银行交易';
    bankBtn.style.cssText =
      'width:100%;padding:10px;margin-top:8px;border:none;border-radius:8px;' +
      'background:#1d4ed8;color:#fff;font-weight:700;cursor:pointer;';
    bankBtn.onclick = () => {
      if (tryBankTrade(state, HUMAN_PLAYER, bankGive, bankReceive)) onClose();
    };
    bankPane.appendChild(bankBtn);

    // --- Player trade ---
    let partnerId = 1;
    const offer: Record<ResourceKey, number> = { wood: 0, brick: 0, ore: 0, wheat: 0, sheep: 0 };
    const request: Record<ResourceKey, number> = { wood: 0, brick: 0, ore: 0, wheat: 0, sheep: 0 };

    const partnerSel = document.createElement('select');
    for (let i = 1; i < state.players.length; i++) {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = state.players[i]!.name;
      partnerSel.appendChild(opt);
    }
    partnerSel.onchange = () => {
      partnerId = Number(partnerSel.value);
    };

    playerPane.appendChild(partnerSel);

    function syncCounts(): void {
      for (const k of RES_KEYS) {
        const o = playerPane.querySelector(`#tc-你给出-${k}`);
        const r = playerPane.querySelector(`#tc-你想要-${k}`);
        if (o) o.textContent = String(offer[k]);
        if (r) r.textContent = String(request[k]);
      }
    }

    const humanRes = state.players[HUMAN_PLAYER]!.resources;
    playerPane.appendChild(
      mkResRow('你给出', offer, (k, d) => {
        offer[k] = Math.max(0, Math.min(humanRes[k], offer[k] + d));
        syncCounts();
      }, humanRes),
    );
    playerPane.appendChild(
      mkResRow('你想要', request, (k, d) => {
        request[k] = Math.max(0, request[k] + d);
        syncCounts();
      }),
    );

    const tradeBtn = document.createElement('button');
    tradeBtn.textContent = '发起交易';
    tradeBtn.style.cssText =
      'width:100%;padding:10px;margin-top:8px;border:none;border-radius:8px;' +
      'background:#059669;color:#fff;font-weight:700;cursor:pointer;';
    tradeBtn.onclick = () => {
      const partner = state.players[partnerId]!;
      if (!aiAcceptsTrade(state, offer, request)) {
        appendLog(state, `${partner.name} 拒绝了交易`);
        onClose();
        return;
      }
      if (tryPlayerTrade(state, HUMAN_PLAYER, partnerId, { ...offer }, { ...request })) onClose();
    };
    playerPane.appendChild(tradeBtn);

    function setTab(bank: boolean): void {
      bankPane.style.display = bank ? 'block' : 'none';
      playerPane.style.display = bank ? 'none' : 'block';
      bankTab.style.background = bank ? '#1d4ed8' : 'rgba(255,255,255,0.1)';
      bankTab.style.color = bank ? '#fff' : '#94a3b8';
      playerTab.style.background = bank ? 'rgba(255,255,255,0.1)' : '#1d4ed8';
      playerTab.style.color = bank ? '#94a3b8' : '#fff';
    }
    bankTab.onclick = () => setTab(true);
    playerTab.onclick = () => setTab(false);
    setTab(true);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '关闭';
    closeBtn.style.cssText =
      'width:100%;padding:8px;margin-top:10px;border:1px solid rgba(255,255,255,0.2);' +
      'border-radius:8px;background:transparent;color:#94a3b8;cursor:pointer;';
    closeBtn.onclick = () => onClose();
    box.appendChild(closeBtn);

    root.addEventListener('click', (e) => {
      if (e.target === root) onClose();
    });
  }

  return {
    open,
    close,
    isOpen: () => root !== null,
  };
}
