import type { GameState } from '../core/types';
import {
  ENDGAME_COL_BONUS,
  ENDGAME_COLOR_BONUS,
  ENDGAME_ROW_BONUS,
  FLOOR_SLOT_COUNT,
  floorCumulativeLabels,
  floorSlotPenaltyLabel,
} from '../core/scoring-reference';

const PANEL_ID = 'hua-zhuan-scoring-guide';
const HUD_W = 320;

const BTN_STYLE =
  'padding:6px 14px;border-radius:8px;border:1px solid rgba(255,235,200,0.22);' +
  'background:rgba(12,10,8,0.88);color:#fde68a;font-size:12px;font-weight:700;' +
  'cursor:pointer;font-family:system-ui,sans-serif;white-space:nowrap;' +
  'box-shadow:0 2px 12px rgba(0,0,0,0.3);backdrop-filter:blur(6px);';

export interface ScoringGuideUiApi {
  refresh(state: GameState): void;
  dispose(): void;
}

function slotRowHtml(): string {
  const slots = Array.from({ length: FLOOR_SLOT_COUNT }, (_, i) => {
    const n = i + 1;
    return `<span style="display:inline-flex;flex-direction:column;align-items:center;min-width:34px">` +
      `<span style="font-size:9px;opacity:0.65">格${n}</span>` +
      `<span style="color:#f87171;font-weight:700">${floorSlotPenaltyLabel(i)}</span>` +
      `</span>`;
  }).join('');
  return `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${slots}</div>`;
}

function cumulativeRowHtml(): string {
  return floorCumulativeLabels(FLOOR_SLOT_COUNT)
    .map(({ count, total }) => `<span style="margin-right:8px">${count}块→<b style="color:#f87171">${total}</b></span>`)
    .join('');
}

function buildBodyHtml(): string {
  return `
<div style="font-size:11px;line-height:1.5;color:#f8f4ec">
  <div style="font-size:12px;font-weight:800;margin-bottom:6px;color:#fde68a">算分规则</div>

  <div style="margin-bottom:8px">
    <div style="font-weight:700;color:#86efac;margin-bottom:2px">每轮 · 推墙计分</div>
    <div style="opacity:0.92">
      图案行满后推入墙面 1 块砖，按<strong>新砖所在连通线</strong>计分：
    </div>
    <ul style="margin:4px 0 0;padding-left:16px;opacity:0.92">
      <li>横向连续 <strong>≥2</strong> 格 → 加 <strong>横向格数</strong> 分（例：横 3 格 → +3）</li>
      <li>纵向连续 <strong>≥2</strong> 格 → 加 <strong>纵向格数</strong> 分（例：纵 4 格 → +4）</li>
      <li>横、纵均 ≥2 时<strong>两项相加</strong>（例：横 3 + 纵 2 → +5）</li>
      <li>横纵均不足 2（孤立 1 格）→ <strong>+0</strong></li>
    </ul>
  </div>

  <div style="margin-bottom:8px">
    <div style="font-weight:700;color:#f87171;margin-bottom:2px">每轮 · 扣分区</div>
    <div style="opacity:0.92">溢出 / 无法放入图案行的砖进入扣分区；+1 标记占 1 格。每格<strong>单独扣分</strong>，结算时累计：</div>
    ${slotRowHtml()}
    <div style="margin-top:4px;font-size:10px;opacity:0.85">累计示例：${cumulativeRowHtml()}</div>
  </div>

  <div>
    <div style="font-weight:700;color:#fde68a;margin-bottom:2px">终局 · 额外奖励</div>
    <div style="opacity:0.92">有人完成墙面整行后，本轮结束进入终局，额外加分：</div>
    <ul style="margin:4px 0 0;padding-left:16px;opacity:0.92">
      <li>每完成 <strong>一整行</strong>（5 格全亮）→ <strong>+${ENDGAME_ROW_BONUS}</strong> 分 / 行</li>
      <li>每完成 <strong>一整列</strong>（5 格全亮）→ <strong>+${ENDGAME_COL_BONUS}</strong> 分 / 列</li>
      <li>每集齐 <strong>一色</strong>（该色 5 块全在墙上）→ <strong>+${ENDGAME_COLOR_BONUS}</strong> 分 / 色</li>
    </ul>
  </div>
</div>`;
}

const ROOT_BASE =
  `position:fixed;bottom:52px;left:50%;transform:translateX(calc(-50% - ${HUD_W / 2}px));` +
  'z-index:190;max-width:min(680px,calc(100vw - 380px));pointer-events:auto;' +
  'font-family:system-ui,sans-serif;';

const ROOT_EXPANDED =
  ROOT_BASE +
  'padding:10px 14px;border-radius:10px;max-height:min(38vh,320px);overflow-y:auto;' +
  'background:rgba(12,10,8,0.88);border:1px solid rgba(255,235,200,0.16);' +
  'box-shadow:0 4px 24px rgba(0,0,0,0.35);backdrop-filter:blur(6px);';

const ROOT_COLLAPSED = ROOT_BASE + 'background:transparent;border:none;box-shadow:none;padding:0;';

export function installScoringGuideUi(): ScoringGuideUiApi {
  document.getElementById(PANEL_ID)?.remove();

  let expanded = false;

  const root = document.createElement('div');
  root.id = PANEL_ID;

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.style.cssText = BTN_STYLE;

  const body = document.createElement('div');
  body.innerHTML = buildBodyHtml();
  body.style.display = 'none';

  root.append(toggleBtn, body);
  document.body.appendChild(root);

  function applyLayout(): void {
    if (expanded) {
      root.style.cssText = ROOT_EXPANDED;
      toggleBtn.textContent = '收起 UI';
      toggleBtn.style.cssText = BTN_STYLE + 'width:100%;margin-bottom:8px;';
      body.style.display = 'block';
    } else {
      root.style.cssText = ROOT_COLLAPSED;
      toggleBtn.textContent = '算分规则';
      toggleBtn.style.cssText = BTN_STYLE;
      body.style.display = 'none';
    }
  }

  toggleBtn.onclick = () => {
    expanded = !expanded;
    applyLayout();
  };

  applyLayout();

  return {
    refresh(state) {
      root.style.visibility = state.phase === 'game_over' ? 'hidden' : 'visible';
      root.style.pointerEvents = state.phase === 'game_over' ? 'none' : 'auto';
    },
    dispose() {
      root.remove();
    },
  };
}
