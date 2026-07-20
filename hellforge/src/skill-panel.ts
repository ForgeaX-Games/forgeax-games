// Three-branch Sorceress skill tree UI (Spec §7).
// Invest / respec / hotbar assign — exclusive major panel via UiLayerManager.

import type { ActiveSkillId, SkillNodeId } from './content-ids';
import { resolveSkill } from './skill-resolver';
import {
  canInvest,
  getSkillNode,
  nodeAvailability,
  SKILL_NODES,
  type NodeAvailability,
  type SkillBranch,
  type SkillTreeResult,
  type SkillTreeState,
} from './skill-tree';
import {
  BRANCH_TABS,
  layoutPixels,
  prereqEdges,
} from './skill-tree-layout';
import { FONT_UI, Ui, panelChrome, panelScrollShellCss, panelTitleStyle } from './ui-theme';

export interface SkillNodeViewModel {
  readonly id: SkillNodeId;
  readonly name: string;
  readonly nameZh: string;
  readonly rank: number;
  readonly maxRank: number;
  readonly requiredLevel: number;
  readonly state: NodeAvailability;
  readonly canInvest: boolean;
  readonly grantsActive: ActiveSkillId | null;
  readonly currentEffect: readonly string[];
  readonly nextRankDelta: string | null;
}

export interface SkillTreeViewModel {
  readonly level: number;
  readonly unspentSkillPoints: number;
  readonly inCamp: boolean;
  readonly selectedHotbarSlot: 0 | 1 | 2 | 3;
  readonly hotbar: readonly (ActiveSkillId | null)[];
  readonly branch: SkillBranch;
  readonly nodes: readonly SkillNodeViewModel[];
}

export interface SkillPanelCallbacks {
  getViewModel(): SkillTreeViewModel;
  invest(nodeId: SkillNodeId): SkillTreeResult;
  respec(): SkillTreeResult;
  assign(nodeId: SkillNodeId, slot: 0 | 1 | 2 | 3): SkillTreeResult;
}

export interface SkillPanelHandle {
  show(): void;
  hide(): void;
  toggle(): void;
  setOpen(open: boolean): void;
  isOpen(): boolean;
  refresh(): void;
  dispose(): void;
}

const PANEL_ID = 'hellforge-skill-panel';
const NODE_SIZE = 56;

const STATE_STYLE: Record<NodeAvailability, { border: string; bg: string; opacity: string }> = {
  locked: { border: Ui.skillLocked, bg: Ui.inkWell, opacity: '0.55' },
  available: { border: Ui.skillAvailable, bg: Ui.goldFill, opacity: '1' },
  invested: { border: Ui.skillInvested, bg: 'rgba(60,44,16,0.95)', opacity: '1' },
  maxed: { border: Ui.skillMaxed, bg: 'rgba(80,56,18,0.98)', opacity: '1' },
};

function nextRankHint(nodeId: SkillNodeId, rank: number, maxRank: number): string | null {
  if (rank >= maxRank) return null;
  const next = rank + 1;
  const cur = resolveSkill(
    getSkillNode(nodeId).grantsActive ?? 'frost',
    { skillRanks: { [nodeId]: rank } },
  );
  // Prefer formula-specific short deltas from Spec §7.2.
  switch (nodeId) {
    case 'magma-bolt': return `下一阶：基础伤害 +12%（→${next}）`;
    case 'frost-fang': return `下一阶：基础伤害 +10%（→${next}）`;
    case 'arc-surge': return `下一阶：基础伤害 +10%（→${next}）`;
    case 'kindling': return `下一阶：火焰伤害 +6%`;
    case 'scorch': return `下一阶：灼烧 ${( [20, 30, 40][next - 1] )}%`;
    case 'volatile-core': return '下一阶：溅射半径 +0.35m · 比例 +10%';
    case 'permafrost': return '下一阶：减速时长 +0.4s';
    case 'piercing-ice': return '下一阶：穿透 +1';
    case 'shatter': return `下一阶：碎冰 ${[2, 3, 4][next - 1]} 片`;
    case 'conduction': return '下一阶：+1 电弧 · 总量 +8%';
    case 'phase-echo': return '下一阶：回响伤害 +10%';
    case 'phase-step': return '下一阶：解锁影踏';
    case 'hellfire-catalyst': return '下一阶：暴击狱火爆发';
    case 'winters-grasp': return '下一阶：对减速目标 +30%';
    case 'overcharge': return '下一阶：电弧命中减影踏 CD';
    default: {
      void cur;
      return `下一阶：等级 ${next}/${maxRank}`;
    }
  }
}

export function buildNodeViewModel(
  nodeId: SkillNodeId,
  treeState: SkillTreeState,
): SkillNodeViewModel {
  const def = getSkillNode(nodeId);
  const rank = treeState.skillRanks[nodeId] ?? 0;
  const state = nodeAvailability(def, treeState, treeState.level);
  const active = def.grantsActive ?? null;
  let currentEffect: readonly string[] = [];
  if (active && rank > 0) {
    currentEffect = resolveSkill(active, { skillRanks: treeState.skillRanks }).tooltipLines;
  } else if (rank > 0) {
    const parent = def.branch === 'flame' ? 'magma' : def.branch === 'frost' ? 'frost' : 'arc';
    currentEffect = resolveSkill(parent, { skillRanks: treeState.skillRanks }).tooltipLines.slice(1);
  }
  return {
    id: nodeId,
    name: def.name,
    nameZh: def.nameZh,
    rank,
    maxRank: def.maxRank,
    requiredLevel: def.requiredLevel,
    state,
    canInvest: canInvest(def, treeState),
    grantsActive: active,
    currentEffect,
    nextRankDelta: nextRankHint(nodeId, rank, def.maxRank),
  };
}

export function buildSkillTreeViewModel(input: {
  treeState: SkillTreeState;
  inCamp: boolean;
  branch?: SkillBranch;
}): SkillTreeViewModel {
  const branch = input.branch ?? 'frost';
  return {
    level: input.treeState.level,
    unspentSkillPoints: input.treeState.unspentSkillPoints,
    inCamp: input.inCamp,
    selectedHotbarSlot: input.treeState.selectedHotbarSlot,
    hotbar: input.treeState.hotbar,
    branch,
    nodes: SKILL_NODES.map((n) => buildNodeViewModel(n.id, input.treeState)),
  };
}

export function installSkillPanel(mount: HTMLElement, cb: SkillPanelCallbacks): SkillPanelHandle {
  document.getElementById(PANEL_ID)?.remove();
  const scoped = mount !== document.body;

  const root = document.createElement('div');
  root.id = PANEL_ID;
  root.style.cssText = `position:${scoped ? 'absolute' : 'fixed'};inset:0;z-index:120;display:none;` +
    `pointer-events:none;overflow:hidden;background:rgba(4,3,2,0.55);`;

  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
    'width:min(720px,94%);height:min(560px,86%);pointer-events:auto;display:flex;flex-direction:column;' +
    'box-sizing:border-box;border-radius:10px;overflow:hidden;' +
    panelScrollShellCss(560, 48) +
    panelChrome(`font:600 13px ${FONT_UI};`);

  // Header
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;' +
    'padding:14px 18px 10px;flex:none;gap:12px;';
  const titleLeft = document.createElement('div');
  titleLeft.style.cssText = panelTitleStyle();
  titleLeft.textContent = '技能树';
  const pointsEl = document.createElement('div');
  pointsEl.style.cssText = `font:700 12px ${FONT_UI};color:${Ui.goldBright};letter-spacing:1px;`;
  const closeHint = document.createElement('div');
  closeHint.textContent = 'K 关闭';
  closeHint.style.cssText = `font:600 11px ${FONT_UI};color:${Ui.textDim};`;
  header.append(titleLeft, pointsEl, closeHint);

  // Tabs
  const tabs = document.createElement('div');
  tabs.style.cssText = 'display:flex;gap:8px;padding:0 18px 10px;flex:none;';
  const tabBtns = new Map<SkillBranch, HTMLButtonElement>();
  let activeBranch: SkillBranch = 'frost';

  for (const tab of BRANCH_TABS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = tab.label;
    btn.dataset.branch = tab.id;
    btn.style.cssText = 'padding:6px 14px;cursor:pointer;border-radius:4px;' +
      `font:700 12px ${FONT_UI};letter-spacing:2px;`;
    btn.addEventListener('click', () => {
      activeBranch = tab.id;
      refresh();
    });
    tabBtns.set(tab.id, btn);
    tabs.appendChild(btn);
  }

  // Canvas
  const canvasWrap = document.createElement('div');
  canvasWrap.style.cssText = 'position:relative;flex:1;min-height:0;margin:0 14px;' +
    `border:1px solid ${Ui.goldLineSoft};border-radius:6px;background:${Ui.ink};overflow:hidden;`;

  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  const nodesLayer = document.createElement('div');
  nodesLayer.style.cssText = 'position:absolute;inset:0;';

  const detail = document.createElement('div');
  detail.style.cssText = 'flex:none;padding:10px 18px 8px;min-height:88px;' +
    `border-top:1px solid ${Ui.goldLineSoft};font:500 12px ${FONT_UI};color:${Ui.textMuted};`;

  // Footer actions
  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;justify-content:space-between;align-items:center;' +
    'gap:10px;padding:8px 18px 14px;flex:none;';
  const assignRow = document.createElement('div');
  assignRow.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap;';
  const respecBtn = document.createElement('button');
  respecBtn.type = 'button';
  respecBtn.textContent = '营地重置';
  respecBtn.style.cssText = 'padding:7px 14px;cursor:pointer;border-radius:4px;' +
    `font:700 12px ${FONT_UI};border:1px solid ${Ui.goldDim};background:${Ui.inkWell};color:${Ui.goldBright};`;

  let selectedNode: SkillNodeId | null = null;

  respecBtn.addEventListener('click', () => {
    const res = cb.respec();
    if (!res.ok) {
      detail.textContent = res.reason === 'not-in-camp'
        ? '只能在烬守营地重置技能点'
        : `无法重置：${res.reason}`;
      return;
    }
    selectedNode = null;
    refresh();
  });

  footer.append(assignRow, respecBtn);
  canvasWrap.append(svg, nodesLayer);
  panel.append(header, tabs, canvasWrap, detail, footer);
  root.appendChild(panel);
  mount.appendChild(root);

  let open = false;

  const paintTabs = (): void => {
    for (const [id, btn] of tabBtns) {
      const on = id === activeBranch;
      btn.style.background = on ? Ui.goldFill : Ui.inkWell;
      btn.style.border = `1px solid ${on ? Ui.gold : Ui.goldLineSoft}`;
      btn.style.color = on ? Ui.goldBright : Ui.textDim;
    }
  };

  const renderAssign = (node: SkillNodeViewModel | null, vm: SkillTreeViewModel): void => {
    assignRow.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = '分配快捷栏';
    label.style.cssText = `color:${Ui.textDim};font-size:11px;margin-right:4px;`;
    assignRow.appendChild(label);
    for (const slot of [0, 1, 2, 3] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${slot + 1}`;
      const selected = vm.selectedHotbarSlot === slot;
      const filled = vm.hotbar[slot];
      b.style.cssText = 'width:28px;height:28px;cursor:pointer;border-radius:4px;' +
        `font:700 12px ${FONT_UI};` +
        `border:1px solid ${selected ? Ui.goldBright : Ui.goldLineSoft};` +
        `background:${filled ? Ui.goldFill : Ui.inkWell};` +
        `color:${selected ? Ui.goldBright : Ui.text};` +
        (selected ? `box-shadow:0 0 8px rgba(245,216,120,0.35);` : '');
      b.title = filled ? `槽 ${slot + 1}: ${filled}` : `槽 ${slot + 1}: 空`;
      b.disabled = !node?.grantsActive || node.rank <= 0;
      b.addEventListener('click', () => {
        if (!node?.grantsActive) return;
        const res = cb.assign(node.id, slot);
        if (!res.ok) {
          detail.textContent = `无法分配：${res.reason}`;
          return;
        }
        refresh();
      });
      assignRow.appendChild(b);
    }
  };

  const showDetail = (node: SkillNodeViewModel | null, vm: SkillTreeViewModel): void => {
    if (!node) {
      detail.innerHTML = `<span style="color:${Ui.textDim}">选择一个技能节点。数字键仅切换右侧技能栏选中槽（RMB 施放）。</span>`;
      renderAssign(null, vm);
      return;
    }
    const lines = [
      `<div style="color:${Ui.goldBright};font-weight:700;margin-bottom:4px;">${node.nameZh} · ${node.name}</div>`,
      `<div>等级 ${node.rank}/${node.maxRank}` +
        (node.requiredLevel > 1 ? ` · 需求角色等级 ${node.requiredLevel}` : '') +
        ` · ${node.state}</div>`,
      node.currentEffect.length
        ? `<div style="margin-top:4px;color:${Ui.text};">${node.currentEffect.join(' · ')}</div>`
        : '',
      node.nextRankDelta
        ? `<div style="margin-top:4px;color:${Ui.ok};">${node.nextRankDelta}</div>`
        : `<div style="margin-top:4px;color:${Ui.textDim};">已满级</div>`,
      node.canInvest
        ? `<div style="margin-top:4px;color:${Ui.gold};">点击节点投入 1 点</div>`
        : '',
    ];
    detail.innerHTML = lines.filter(Boolean).join('');
    renderAssign(node, vm);
  };

  const refresh = (): void => {
    const vm = cb.getViewModel();
    // Keep branch from local tab state; view model may mirror it.
    pointsEl.textContent = `未分配 ${vm.unspentSkillPoints} 点 · Lv ${vm.level}` +
      (vm.inCamp ? ' · 营地' : '');
    respecBtn.disabled = !vm.inCamp;
    respecBtn.style.opacity = vm.inCamp ? '1' : '0.45';
    respecBtn.title = vm.inCamp ? '重置已投入点数（保留免费霜牙）' : '仅烬守营地可重置';
    paintTabs();

    const w = canvasWrap.clientWidth || 640;
    const h = canvasWrap.clientHeight || 360;
    const positions = layoutPixels(activeBranch, w, h, 52);
    const edges = prereqEdges(activeBranch);

    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = '';
    for (const e of edges) {
      const a = positions.get(e.from);
      const b = positions.get(e.to);
      if (!a || !b) continue;
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', String(a.x));
      line.setAttribute('y1', String(a.y));
      line.setAttribute('x2', String(b.x));
      line.setAttribute('y2', String(b.y));
      line.setAttribute('stroke', Ui.goldLineSoft);
      line.setAttribute('stroke-width', '2');
      svg.appendChild(line);
    }

    nodesLayer.innerHTML = '';
    const branchNodes = vm.nodes.filter((n) => getSkillNode(n.id).branch === activeBranch);
    // If caller already filtered by branch, use vm.nodes; else filter.
    const list = branchNodes.length ? branchNodes : vm.nodes;

    for (const node of list) {
      if (getSkillNode(node.id).branch !== activeBranch) continue;
      const pos = positions.get(node.id);
      if (!pos) continue;
      const st = STATE_STYLE[node.state];
      const el = document.createElement('button');
      el.type = 'button';
      el.dataset.nodeId = node.id;
      el.style.cssText = 'position:absolute;width:' + NODE_SIZE + 'px;height:' + NODE_SIZE + 'px;' +
        `left:${pos.x - NODE_SIZE / 2}px;top:${pos.y - NODE_SIZE / 2}px;` +
        `border:2px solid ${st.border};background:${st.bg};opacity:${st.opacity};` +
        'border-radius:8px;cursor:pointer;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;padding:4px;box-sizing:border-box;' +
        (selectedNode === node.id ? `box-shadow:0 0 0 2px ${Ui.goldBright};` : '');
      el.innerHTML =
        `<div style="font-size:10px;color:${Ui.goldBright};line-height:1.1;text-align:center;">${node.nameZh}</div>` +
        `<div style="font-size:11px;color:${Ui.text};margin-top:2px;">${node.rank}/${node.maxRank}</div>`;
      el.addEventListener('click', () => {
        selectedNode = node.id;
        if (node.canInvest) {
          const res = cb.invest(node.id);
          if (!res.ok) {
            showDetail(node, cb.getViewModel());
            detail.innerHTML += `<div style="color:${Ui.danger};margin-top:4px;">无法投入：${res.reason}</div>`;
            refresh();
            return;
          }
        }
        refresh();
      });
      nodesLayer.appendChild(el);
    }

    const selected = selectedNode
      ? list.find((n) => n.id === selectedNode) ?? null
      : null;
    showDetail(selected ?? null, vm);
  };

  return {
    show() { this.setOpen(true); },
    hide() { this.setOpen(false); },
    toggle() { this.setOpen(!open); },
    setOpen(next: boolean) {
      open = next;
      root.style.display = open ? 'block' : 'none';
      if (open) {
        // Layout needs measured size.
        requestAnimationFrame(() => refresh());
      }
    },
    isOpen: () => open,
    refresh,
    dispose: () => root.remove(),
  };
}
