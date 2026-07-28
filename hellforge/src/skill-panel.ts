// Three-branch Sorceress skill tree UI (Spec §7) — 1:1 aidiablo D2R look:
// stone slab with carved grooves, right-side vertical tabs + points box,
// 54px gradient-framed nodes, right-angle metal-pipe prereq connectors,
// green learnable pulse, dark-blue hover tooltip, right-click invest.
// DOM implementation (no canvas) — same visuals, hellforge install* contract.
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
import { HudArt } from './hud-art';
import {
  FONT_UI, Ui, Z, panelScrollShellCss,
} from './ui-theme';
import { skillIconImg } from './ui-icons';
import { ensureUiStyles } from './ui-styles';

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
  /** Product "keystone" = code kind `capstone`. */
  readonly isKeystone: boolean;
  /** Badge frame edge length in px (normal 54 / keystone 78). */
  readonly frameSize: number;
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
/** Normal node badge edge length (px). */
export const NODE_SIZE = 54;
/** Keystone (`capstone`) badge edge length (px) — L4 larger than normal. */
export const KEYSTONE_SIZE = 78;

/** aidiablo frame recipes per node state (five-stop gradients). */
const FRAME_GRADIENT: Record<NodeAvailability, string> = {
  locked: 'linear-gradient(135deg,#3a3a38,#2a2a28,#333332,#2a2a28,#3a3a38)',
  available: 'linear-gradient(135deg,#8a7848,#6a5830,#7a6838,#6a5830,#8a7848)',
  invested: 'linear-gradient(135deg,#6aaa6a,#4a7a4a,#5a905a,#4a7a4a,#6aaa6a)',
  maxed: 'linear-gradient(135deg,#d4b058,#a88838,#b89848,#a08038,#d4b058)',
};

/** Extra outer ring for keystones — distinct from normal 54px badges. */
function keystoneFrameShadow(state: NodeAvailability): string {
  const rim = state === 'maxed' ? '#e0c060'
    : state === 'invested' ? '#6aaa6a'
    : state === 'available' ? '#c09838'
    : '#5a5448';
  return `0 0 0 2px #040302,0 0 0 4px #1a1410,0 0 0 6px ${rim},inset 0 0 10px rgba(0,0,0,0.65)`;
}

function branchGlyphSvg(branch: SkillBranch, sizePx: number, color: string): string {
  let body = '';
  if (branch === 'flame') {
    body = `<path d="M12 2 C12 8 6 11 6 16 a6 6 0 0 0 12 0 c0-5-6-8-6-14z" fill="${color}"/>`;
  } else if (branch === 'frost') {
    body = `<g stroke="${color}" stroke-width="1.8" stroke-linecap="round">` +
      `<path d="M12 3 V21 M4 7.5 L20 16.5 M20 7.5 L4 16.5"/></g>`;
  } else {
    body = `<path d="M13 2 L7 13 h4 L10 22 L17 9 h-4 z" fill="${color}"/>`;
  }
  return `<svg viewBox="0 0 24 24" width="${sizePx}" height="${sizePx}" aria-hidden="true">${body}</svg>`;
}

function nextRankHint(nodeId: SkillNodeId, rank: number, maxRank: number): string | null {
  if (rank >= maxRank) return null;
  const next = rank + 1;
  const cur = resolveSkill(
    getSkillNode(nodeId).grantsActive ?? 'frost',
    { skillRanks: { [nodeId]: rank } },
  );
  // Prefer formula-specific short deltas from Spec §7.2 / PR9 roster.
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
    // PR9 — flame
    case 'flame-burst': return `下一阶：基础伤害 +10%（→${next}）`;
    case 'ember': return '下一阶：灼烧时长 +0.5s';
    case 'searing': return '下一阶：灼烧暴击 +5%';
    case 'wildfire': return `下一阶：溅射灼烧 ${[50, 100][next - 1]}%`;
    case 'heat-shimmer': return '下一阶：熔火弹速 +15%';
    case 'furnace-heart': return '下一阶：灼烧击杀引爆';
    // PR9 — frost
    case 'frost-nova': return `下一阶：基础伤害 +10%（→${next}）`;
    case 'rime': return '下一阶：减速幅度 +5%';
    case 'piercing-cold': return '下一阶：穿透 +1';
    case 'glacier-shards': return '下一阶：碎冰片数 +1';
    case 'frozen-focus': return '下一阶：霜牙蓝耗 −0.5';
    case 'deep-freeze': return '下一阶：对已减速 +15% · 刷新减速';
    // PR9 — arcane
    case 'discharge': return `下一阶：基础伤害 +10% · 电弧 +1（→${next}）`;
    case 'resonance': return '下一阶：电弧伤害 +6%';
    case 'swift-phases': return '下一阶：影踏 CD −0.5s';
    case 'echo-mastery': return '下一阶：回响窗口 +0.5s · 伤害 +5%';
    case 'overcast': return '下一阶：电弧 CD −8%';
    case 'tempest-conduit': return '下一阶：过载上限 2s · 作用于释放';
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
  const isKeystone = def.kind === 'capstone';
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
    isKeystone,
    frameSize: isKeystone ? KEYSTONE_SIZE : NODE_SIZE,
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
  ensureUiStyles();
  const scoped = mount !== document.body;

  const root = document.createElement('div');
  root.id = PANEL_ID;
  root.style.cssText = `position:${scoped ? 'absolute' : 'fixed'};inset:0;z-index:${Z.skillPanel};display:none;` +
    'pointer-events:auto;overflow:hidden;background:rgba(4,3,2,0.6);';
  // Click empty space closes (aidiablo behavior).
  root.addEventListener('click', (e) => {
    if (e.target === root) handle.setOpen(false);
  });

  // ── PR6 painted panel frame (reuse character frame; dedicated skill art deferred) ──
  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
    'width:min(560px,94%);height:min(740px,92%);display:flex;box-sizing:border-box;' +
    `background:url('${HudArt.panelSkill()}') center/100% 100% no-repeat,rgba(12,8,4,0.96);` +
    'border:0;box-shadow:0 0 28px rgba(0,0,0,0.85);padding:36px 28px 40px;';
  panel.addEventListener('click', (e) => e.stopPropagation());

  // ── left: tree canvas area ───────────────────────────────────────────────
  const canvasWrap = document.createElement('div');
  canvasWrap.style.cssText = 'position:relative;flex:1;min-width:0;margin:8px 0 8px 8px;' +
    'background:rgba(6,4,3,0.55);border:1px solid rgba(224,184,74,0.12);';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;';
  const nodesLayer = document.createElement('div');
  nodesLayer.style.cssText = 'position:absolute;inset:0;';
  canvasWrap.append(svg, nodesLayer);

  // ── right: points box + vertical tabs + actions ──────────────────────────
  const sideCol = document.createElement('div');
  sideCol.style.cssText = 'flex:none;width:96px;margin:14px 14px 14px 6px;display:flex;flex-direction:column;gap:8px;';

  const pointsBox = document.createElement('div');
  pointsBox.style.cssText = 'text-align:center;padding:8px 4px;background:rgba(0,0,0,0.35);' +
    `border:1px solid #4a4438;border-radius:3px;`;
  sideCol.appendChild(pointsBox);

  const tabBtns = new Map<SkillBranch, HTMLButtonElement>();
  let activeBranch: SkillBranch = 'frost';
  for (const tab of BRANCH_TABS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.branch = tab.id;
    btn.textContent = tab.label;
    // Forged defaults — never flash native white button chrome before paintTabs().
    btn.style.cssText = 'position:relative;padding:9px 4px;cursor:pointer;border-radius:3px;' +
      `font:700 13px ${FONT_UI};letter-spacing:2px;color:#9a948e;` +
      'background:linear-gradient(90deg,#343230,#2a2826,#343230);border:1px solid #4a4438;';
    btn.addEventListener('click', () => {
      activeBranch = tab.id;
      refresh();
    });
    tabBtns.set(tab.id, btn);
    sideCol.appendChild(btn);
  }

  const assignRow = document.createElement('div');
  assignRow.style.cssText = 'display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-top:auto;';
  const respecBtn = document.createElement('button');
  respecBtn.type = 'button';
  respecBtn.textContent = '营地重置';
  respecBtn.style.cssText = 'padding:7px 6px;cursor:pointer;border-radius:3px;width:100%;' +
    `font:700 12px ${FONT_UI};border:1px solid ${Ui.goldDim};background:rgba(18,12,6,0.85);color:${Ui.goldBright};`;
  sideCol.append(assignRow, respecBtn);

  panel.append(canvasWrap, sideCol);
  root.appendChild(panel);

  // ── dark-blue hover tooltip (panel-local, aidiablo chrome) ───────────────
  const tip = document.createElement('div');
  tip.style.cssText = 'position:absolute;z-index:10;display:none;pointer-events:none;' +
    'min-width:220px;max-width:320px;padding:12px 16px;' +
    'background:linear-gradient(180deg,#100e1a 0%,#0a0816 40%,#060410 100%);' +
    'border:1px solid #2a4878;outline:1px solid #14203a;outline-offset:2px;' +
    'box-shadow:0 0 24px rgba(0,0,0,0.95),inset 0 0 40px rgba(15,20,50,0.4),inset 0 1px 0 rgba(80,100,160,0.2);' +
    `font:500 12px ${FONT_UI};color:#c0c0c0;line-height:1.5;`;
  panel.appendChild(tip);
  const showTip = (node: SkillNodeViewModel, e: MouseEvent): void => {
    const sec = (s: string): string => `<div style="border-top:1px solid #2a3a5a;margin-top:6px;padding-top:6px;">${s}</div>`;
    tip.innerHTML =
      `<div style="font-size:14px;font-weight:bold;color:#ffc000;border-bottom:1px solid #3a4a6a;padding-bottom:4px;">${node.nameZh} · ${node.name}</div>` +
      `<div style="font-size:11px;color:#8888ff;margin-top:4px;">${node.grantsActive ? '主动技能' : '被动'}</div>` +
      (node.requiredLevel > 1
        ? `<div style="margin-top:4px;color:${node.requiredLevel > (cb.getViewModel().level) ? '#ff4444' : '#aaaaaa'};">需要角色等级 ${node.requiredLevel}</div>`
        : '') +
      (node.currentEffect.length ? sec(`<div style="color:#ffc000;margin-bottom:2px;">当前效果</div>` +
        node.currentEffect.map((l) => `<div style="margin-left:8px;">${escapeHtml(l)}</div>`).join('')) : '') +
      (node.nextRankDelta
        ? sec(`<div style="background:rgba(20,30,60,0.4);padding:4px 6px;color:#4488cc;">${escapeHtml(node.nextRankDelta)}</div>`)
        : sec('<div style="color:#888;">已满级</div>')) +
      (node.canInvest
        ? sec('<div style="color:#20e820;font-size:10px;">左键/右键 投入 1 点</div>')
        : '');
    tip.style.display = 'block';
    const rect = panel.getBoundingClientRect();
    let x = e.clientX - rect.left + 20;
    let y = e.clientY - rect.top + 10;
    if (x + tip.offsetWidth > rect.width - 8) x = e.clientX - rect.left - tip.offsetWidth - 12;
    if (y + tip.offsetHeight > rect.height - 8) y = rect.height - tip.offsetHeight - 8;
    tip.style.left = `${Math.max(4, x)}px`;
    tip.style.top = `${Math.max(4, y)}px`;
  };
  const hideTip = (): void => { tip.style.display = 'none'; };

  let selectedNode: SkillNodeId | null = null;
  respecBtn.addEventListener('click', () => {
    const res = cb.respec();
    if (!res.ok) return;
    selectedNode = null;
    refresh();
  });

  mount.appendChild(root);

  let open = false;

  const paintTabs = (vm: SkillTreeViewModel): void => {
    for (const [id, btn] of tabBtns) {
      const on = id === activeBranch;
      const label = BRANCH_TABS.find((t) => t.id === id)?.label ?? id;
      btn.innerHTML =
        (on ? '<span style="position:absolute;left:-7px;top:50%;transform:translateY(-50%);' +
          'border-top:5px solid transparent;border-bottom:5px solid transparent;' +
          'border-right:7px solid #d4b878;"></span>' : '') +
        `<span style="color:${on ? '#f0c840' : '#9a948e'};">${label}</span>`;
      btn.style.background = on ? 'linear-gradient(90deg,#5a4830,#4a3a25,#5a4830)' : 'linear-gradient(90deg,#343230,#2a2826,#343230)';
      btn.style.border = on ? '2px solid #d4b878' : '1px solid #4a4438';
    }
    void vm;
  };

  const renderAssign = (node: SkillNodeViewModel | null, vm: SkillTreeViewModel): void => {
    assignRow.innerHTML = '';
    const label = document.createElement('span');
    label.textContent = '快捷';
    label.style.cssText = 'color:#8a7860;font-size:10px;';
    assignRow.appendChild(label);
    for (const slot of [0, 1, 2, 3] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = `${slot + 1}`;
      const selected = vm.selectedHotbarSlot === slot;
      const filled = vm.hotbar[slot];
      b.style.cssText = 'width:22px;height:22px;cursor:pointer;border-radius:3px;font-size:10px;' +
        `border:1px solid ${selected ? Ui.goldBright : '#4a4438'};` +
        `background:${filled ? 'rgba(48,36,14,0.92)' : 'rgba(18,12,6,0.85)'};` +
        `color:${selected ? Ui.goldBright : '#e0d8cc'};` +
        (selected ? 'box-shadow:0 0 8px rgba(245,216,120,0.35);' : '');
      b.disabled = !node?.grantsActive || node.rank <= 0;
      b.addEventListener('click', () => {
        if (!node?.grantsActive) return;
        const res = cb.assign(node.id, slot);
        if (!res.ok) return;
        refresh();
      });
      assignRow.appendChild(b);
    }
  };

  const refresh = (): void => {
    const vm = cb.getViewModel();
    pointsBox.innerHTML =
      `<div style="font-size:24px;font-weight:bold;color:${vm.unspentSkillPoints > 0 ? '#f0c840' : '#8a8580'};` +
      `${vm.unspentSkillPoints > 0 ? 'text-shadow:0 0 8px rgba(240,200,64,0.5);' : ''}">${vm.unspentSkillPoints}</div>` +
      `<div style="font-size:10px;color:#a8a098;letter-spacing:1px;">技能点</div>` +
      `<div style="font-size:10px;color:#6a6058;margin-top:2px;">Lv ${vm.level}${vm.inCamp ? ' · 营地' : ''}</div>`;
    respecBtn.disabled = !vm.inCamp;
    respecBtn.style.opacity = vm.inCamp ? '1' : '0.45';
    respecBtn.title = vm.inCamp ? '重置已投入点数（保留免费霜牙）' : '仅烬守营地可重置';
    paintTabs(vm);

    const w = canvasWrap.clientWidth || 400;
    const h = canvasWrap.clientHeight || 600;
    const positions = layoutPixels(activeBranch, w, h, 52);
    const edges = prereqEdges(activeBranch);

    // right-angle metal-pipe connectors (3-pass stroke + arrowhead)
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = '';
    for (const e of edges) {
      const a = positions.get(e.from);
      const b = positions.get(e.to);
      if (!a || !b) continue;
      const midY = (a.y + b.y) / 2;
      const dAttr = `M ${a.x} ${a.y} L ${a.x} ${midY} L ${b.x} ${midY} L ${b.x} ${b.y}`;
      const active = vm.nodes.find((n) => n.id === e.to && n.rank > 0) !== undefined;
      const passes: Array<[string, number]> = active
        ? [['#2a2825', 6], ['#5a5550', 4], ['#7a7570', 1.5]]
        : [['#1a1815', 5], ['#3a3530', 3]];
      for (const [color, width] of passes) {
        const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        p.setAttribute('d', dAttr);
        p.setAttribute('fill', 'none');
        p.setAttribute('stroke', color);
        p.setAttribute('stroke-width', String(width));
        p.setAttribute('stroke-linecap', 'round');
        p.setAttribute('stroke-linejoin', 'round');
        svg.appendChild(p);
      }
      // arrowhead at the target end
      const tri = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const dir = Math.sign(b.y - a.y) || 1;
      tri.setAttribute('d', `M ${b.x - 8} ${b.y - 6 * dir} L ${b.x + 8} ${b.y - 6 * dir} L ${b.x} ${b.y + 3 * dir} Z`);
      tri.setAttribute('fill', active ? '#5a5550' : '#3a3530');
      svg.appendChild(tri);
    }

    nodesLayer.innerHTML = '';
    const branchNodes = vm.nodes.filter((n) => getSkillNode(n.id).branch === activeBranch);
    const list = branchNodes.length ? branchNodes : vm.nodes;

    for (const node of list) {
      if (getSkillNode(node.id).branch !== activeBranch) continue;
      const pos = positions.get(node.id);
      if (!pos) continue;
      const el = document.createElement('button');
      el.type = 'button';
      el.dataset.nodeId = node.id;
      if (node.isKeystone) el.dataset.keystone = '1';
      const learned = node.rank > 0;
      const size = node.frameSize;
      const radius = node.isKeystone ? 8 : 5;
      const frameShadow = node.isKeystone
        ? keystoneFrameShadow(node.state)
        : '0 0 0 2px #040302,0 0 0 3px #121010,inset 0 0 6px rgba(0,0,0,0.6)';
      el.style.cssText = `position:absolute;width:${size}px;height:${size}px;` +
        `left:${pos.x - size / 2}px;top:${pos.y - size / 2}px;` +
        `padding:0;border-radius:${radius}px;cursor:pointer;` +
        `background:${FRAME_GRADIENT[node.state]};` +
        `box-shadow:${frameShadow};` +
        (selectedNode === node.id ? `outline:2px solid rgba(255,255,255,0.9);outline-offset:2px;` : '') +
        (node.state === 'locked' ? 'opacity:0.55;' : '');
      // icon recess
      const recessInset = node.isKeystone ? 6 : 4;
      const iconPx = node.isKeystone ? 56 : 40;
      const glyphPx = node.isKeystone ? 36 : 26;
      const recess = document.createElement('div');
      recess.style.cssText = `position:absolute;inset:${recessInset}px;display:flex;align-items:center;justify-content:center;` +
        `background:radial-gradient(circle at 50% 40%,${node.state === 'maxed' ? '#6a5838' : learned ? '#3a6838' : '#32323a'} 0%,${learned ? '#122a10' : '#121218'} 100%);` +
        `border-radius:${node.isKeystone ? 5 : 3}px;overflow:hidden;`;
      const icon = node.grantsActive
        ? skillIconImg(node.grantsActive, iconPx, { alt: node.nameZh })
        : null;
      if (icon) {
        icon.style.opacity = learned ? '1' : '0.35';
        recess.appendChild(icon);
      } else {
        recess.innerHTML = branchGlyphSvg(
          getSkillNode(node.id).branch, glyphPx,
          learned ? '#e8e0d0' : '#6a6a70',
        );
      }
      el.appendChild(recess);
      // rank badge
      const badge = document.createElement('div');
      badge.style.cssText = 'position:absolute;right:-4px;bottom:-4px;min-width:16px;height:14px;padding:0 2px;' +
        'background:rgba(0,0,0,0.9);border-radius:2px;font-size:9px;font-weight:bold;line-height:14px;text-align:center;' +
        `border:1px solid ${node.state === 'maxed' ? '#c09838' : learned ? '#38a038' : '#4a4438'};` +
        `color:${node.state === 'maxed' ? '#f0c840' : learned ? '#20e820' : '#8a8580'};`;
      badge.textContent = `${node.rank}/${node.maxRank}`;
      el.appendChild(badge);
      // learnable green pulse dot
      if (node.canInvest) {
        const dot = document.createElement('div');
        const pulse = node.isKeystone ? 12 : 10;
        dot.style.cssText = `position:absolute;top:-4px;right:-4px;width:${pulse}px;height:${pulse}px;border-radius:50%;` +
          'background:#20e820;box-shadow:0 0 6px 2px rgba(32,232,32,0.55);' +
          'animation:hf-skill-pulse 1.6s ease-in-out infinite;';
        el.appendChild(dot);
      }
      // maxed star
      if (node.state === 'maxed') {
        const star = document.createElement('div');
        star.style.cssText = `position:absolute;top:-6px;left:-4px;font-size:${node.isKeystone ? 14 : 12}px;color:#f0c840;` +
          'text-shadow:0 0 4px rgba(240,200,64,0.6);';
        star.textContent = '★';
        el.appendChild(star);
      }
      // name under node
      const name = document.createElement('div');
      name.style.cssText = 'position:absolute;top:100%;left:50%;transform:translateX(-50%);margin-top:3px;' +
        `font-size:11px;font-weight:bold;white-space:nowrap;color:${learned ? '#e8e0d0' : '#9a9490'};` +
        'text-shadow:0 1px 2px #000;';
      name.textContent = node.nameZh;
      el.appendChild(name);

      const investNow = (): void => {
        selectedNode = node.id;
        if (node.canInvest) cb.invest(node.id);
        refresh();
      };
      el.addEventListener('click', investNow);
      el.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        investNow();
      });
      el.addEventListener('mousemove', (ev) => showTip(node, ev));
      el.addEventListener('mouseleave', hideTip);
      nodesLayer.appendChild(el);
    }

    renderAssign(
      selectedNode ? (list.find((n) => n.id === selectedNode) ?? null) : null,
      vm,
    );
  };

  const handle: SkillPanelHandle = {
    show() { this.setOpen(true); },
    hide() { this.setOpen(false); },
    toggle() { this.setOpen(!open); },
    setOpen(next: boolean) {
      open = next;
      root.style.display = open ? 'block' : 'none';
      if (open) {
        // Layout needs measured size.
        requestAnimationFrame(() => refresh());
      } else {
        hideTip();
      }
    },
    isOpen: () => open,
    refresh,
    dispose: () => root.remove(),
  };

  // green pulse keyframes (one-off injection; ui-styles owns shared CSS)
  if (!document.getElementById('hellforge-skill-style')) {
    const s = document.createElement('style');
    s.id = 'hellforge-skill-style';
    s.textContent =
      '@keyframes hf-skill-pulse{0%,100%{transform:scale(1);opacity:1;}50%{transform:scale(1.5);opacity:0.45;}}';
    document.head.appendChild(s);
  }

  return handle;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
