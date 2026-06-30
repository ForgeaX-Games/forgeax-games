import { deleteSave, listSaves } from '../core/save-game';

const MENU_ID = 'luo-sai-ya-main-menu';

const PHASE_LABEL: Record<string, string> = {
  map_ready: '地图就绪',
  setup_village: '开局',
  setup_road: '开局',
  turn_roll: '对局中',
  turn_harvest: '对局中',
  turn_robber_discard: '对局中',
  turn_robber_move: '对局中',
  turn_robber_steal: '对局中',
  turn_develop: '对局中',
  game_over: '已结束',
};

export interface MainMenuCallbacks {
  onNewGame: () => void;
  onLoadSave: (slotId: string) => void;
  onShowHelp: () => void;
}

export interface MainMenuApi {
  show(): void;
  hide(): void;
  refresh(): void;
  setCallbacks(cb: MainMenuCallbacks): void;
  dispose(): void;
}

function menuBtn(bg: string): string {
  return (
    'width:100%;padding:12px 16px;border:none;border-radius:8px;color:#fff;' +
    `background:${bg};font-size:14px;font-weight:700;cursor:pointer;margin-bottom:8px;`
  );
}

function formatWhen(savedAt: number): string {
  return new Date(savedAt).toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function installMainMenu(): MainMenuApi {
  document.getElementById(MENU_ID)?.remove();

  const root = document.createElement('div');
  root.id = MENU_ID;
  root.style.cssText =
    'position:fixed;inset:0;z-index:10040;pointer-events:auto;' +
    'display:flex;align-items:center;justify-content:center;' +
    'background:radial-gradient(ellipse at 50% 30%,#1e3a5f 0%,#0c1220 70%);' +
    'font-family:system-ui,sans-serif;color:#f1f5f9;';

  const card = document.createElement('div');
  card.style.cssText =
    'width:min(92vw,400px);padding:28px 24px;border-radius:16px;text-align:center;' +
    'background:rgba(8,12,22,0.92);border:1px solid rgba(255,255,255,0.1);' +
    'box-shadow:0 24px 60px rgba(0,0,0,0.45);';

  const title = document.createElement('h1');
  title.textContent = '洛塞娅';
  title.style.cssText = 'margin:0 0 6px;font-size:28px;font-weight:800;color:#fbbf24;letter-spacing:0.08em;';

  const subtitle = document.createElement('p');
  subtitle.textContent = '六边形岛屿策略桌游';
  subtitle.style.cssText = 'margin:0 0 20px;font-size:12px;color:#94a3b8;';

  const homeView = document.createElement('div');
  const newBtn = document.createElement('button');
  newBtn.textContent = '新游戏';
  newBtn.style.cssText = menuBtn('linear-gradient(135deg,#d97706,#b45309)');

  const loadBtn = document.createElement('button');
  loadBtn.textContent = '载入存档';
  loadBtn.style.cssText = menuBtn('linear-gradient(135deg,#2563eb,#1d4ed8)');

  const helpBtn = document.createElement('button');
  helpBtn.textContent = '玩法说明';
  helpBtn.style.cssText = menuBtn('#334155');
  homeView.append(newBtn, loadBtn, helpBtn);

  const loadView = document.createElement('div');
  loadView.style.display = 'none';

  const loadTitle = document.createElement('div');
  loadTitle.textContent = '选择存档载入';
  loadTitle.style.cssText = 'font-size:15px;font-weight:800;color:#67e8f9;margin-bottom:10px;text-align:left;';

  const saveList = document.createElement('div');
  saveList.style.cssText =
    'max-height:min(50vh,320px);overflow-y:auto;display:flex;flex-direction:column;gap:8px;' +
    'margin-bottom:12px;text-align:left;';

  const emptyHint = document.createElement('div');
  emptyHint.textContent = '暂无存档，请先开始新游戏并保存。';
  emptyHint.style.cssText = 'font-size:12px;color:#94a3b8;padding:16px 8px;text-align:center;';

  const backBtn = document.createElement('button');
  backBtn.textContent = '返回';
  backBtn.style.cssText = menuBtn('#475569');
  loadView.append(loadTitle, saveList, backBtn);

  card.append(title, subtitle, homeView, loadView);
  root.appendChild(card);
  document.body.appendChild(root);

  let cb: MainMenuCallbacks | null = null;

  function showHome(): void {
    homeView.style.display = 'block';
    loadView.style.display = 'none';
    subtitle.textContent = '六边形岛屿策略桌游';
  }

  function showLoadList(): void {
    homeView.style.display = 'none';
    loadView.style.display = 'block';
    subtitle.textContent = `${listSaves().length} 个存档`;
    renderSaveList();
  }

  function renderSaveList(): void {
    saveList.innerHTML = '';
    const saves = listSaves();
    if (!saves.length) {
      saveList.appendChild(emptyHint);
      return;
    }

    for (const slot of saves) {
      const row = document.createElement('div');
      row.style.cssText =
        'display:flex;align-items:stretch;gap:6px;padding:10px;border-radius:8px;' +
        'background:rgba(255,255,255,0.05);border:1px solid rgba(255,255,255,0.08);';

      const main = document.createElement('button');
      main.type = 'button';
      main.style.cssText =
        'flex:1;text-align:left;border:none;background:transparent;color:inherit;cursor:pointer;padding:0;';
      main.innerHTML =
        `<div style="font-weight:700;font-size:13px;color:#f1f5f9;margin-bottom:4px;">${slot.label}</div>` +
        `<div style="font-size:11px;color:#94a3b8;line-height:1.45;">` +
        `第 ${slot.round} 轮 · ${PHASE_LABEL[slot.phase] ?? slot.phase} · 你的 ${slot.humanVp} 分` +
        `</div>` +
        `<div style="font-size:10px;color:#64748b;margin-top:3px;">${formatWhen(slot.savedAt)}</div>`;

      const loadOne = document.createElement('button');
      loadOne.textContent = '载入';
      loadOne.style.cssText =
        'align-self:center;padding:6px 12px;border:none;border-radius:6px;' +
        'background:linear-gradient(135deg,#059669,#047857);color:#fff;font-weight:700;font-size:11px;cursor:pointer;';

      const del = document.createElement('button');
      del.textContent = '删';
      del.title = '删除此存档';
      del.style.cssText =
        'align-self:center;padding:6px 8px;border:none;border-radius:6px;' +
        'background:#7f1d1d;color:#fecaca;font-weight:700;font-size:11px;cursor:pointer;';

      const doLoad = () => cb?.onLoadSave(slot.id);
      main.onclick = doLoad;
      loadOne.onclick = doLoad;
      del.onclick = (e) => {
        e.stopPropagation();
        if (confirm(`确定删除「${slot.label}」？`)) {
          deleteSave(slot.id);
          renderSaveList();
          subtitle.textContent = `${listSaves().length} 个存档`;
        }
      };

      row.append(main, loadOne, del);
      saveList.appendChild(row);
    }
  }

  function refresh(): void {
    if (loadView.style.display !== 'none') {
      renderSaveList();
      subtitle.textContent = `${listSaves().length} 个存档`;
    }
  }

  newBtn.onclick = () => cb?.onNewGame();
  loadBtn.onclick = () => showLoadList();
  helpBtn.onclick = () => cb?.onShowHelp();
  backBtn.onclick = () => showHome();

  return {
    show() {
      showHome();
      refresh();
      root.style.display = 'flex';
    },
    hide() {
      root.style.display = 'none';
    },
    refresh,
    setCallbacks(callbacks) {
      cb = callbacks;
    },
    dispose() {
      root.remove();
    },
  };
}
