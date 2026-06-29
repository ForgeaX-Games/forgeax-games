import { BUILD_COSTS, DISCARD_THRESHOLD, RESOURCE_KEYS, RESOURCE_NAMES, WIN_SCORE, type PortKind } from './constants';
import { getAdjacentVertices, getVertexEdges, neighborTileIds } from './map';
import {
  appendLog,
  drawDevCard,
  emitStage,
  playerTotalVp,
  totalResources,
} from './game-state';
import type {
  BuildingKind,
  DevCardKind,
  GameState,
  PlayerState,
  ResourceBag,
  ResourceKey,
  HarvestGainEvent,
} from './types';

export function canAfford(player: PlayerState, cost: ResourceBag): boolean {
  return (
    player.resources.wood >= cost.wood &&
    player.resources.brick >= cost.brick &&
    player.resources.ore >= cost.ore &&
    player.resources.wheat >= cost.wheat &&
    player.resources.sheep >= cost.sheep
  );
}

export function payCost(player: PlayerState, cost: ResourceBag): void {
  player.resources.wood -= cost.wood;
  player.resources.brick -= cost.brick;
  player.resources.ore -= cost.ore;
  player.resources.wheat -= cost.wheat;
  player.resources.sheep -= cost.sheep;
}

export function formatResources(r: ResourceBag): string {
  const parts: string[] = [];
  for (const k of ['wood', 'brick', 'ore', 'wheat', 'sheep'] as ResourceKey[]) {
    if (r[k] > 0) parts.push(`${RESOURCE_NAMES[k]}×${r[k]}`);
  }
  return parts.length ? parts.join(' ') : '（空）';
}

/** Distance rule: no building on adjacent vertices */
export function violatesDistance(state: GameState, vertexId: string): boolean {
  for (const adj of getAdjacentVertices(state.board, vertexId)) {
    if (state.placements.villages.has(adj) || state.placements.towns.has(adj)) return true;
  }
  return false;
}

export function hasRoadPathTo(state: GameState, playerId: number, vertexId: string): boolean {
  const network = getPlayerNetworkVertices(state, playerId);
  for (const eid of getVertexEdges(state.board, vertexId)) {
    if (state.placements.roadOwners.get(eid) !== playerId) continue;
    const e = state.board.edges.get(eid)!;
    const other = e.v1 === vertexId ? e.v2 : e.v1;
    if (network.has(other)) return true;
  }
  return false;
}

function getRoadOwner(state: GameState, edgeId: string): number | null {
  if (!state.placements.roads.has(edgeId)) return null;
  return state.placements.roadOwners.get(edgeId) ?? null;
}

function playerOwnsRoad(state: GameState, playerId: number, edgeId: string): boolean {
  return state.placements.roadOwners.get(edgeId) === playerId;
}

export function isValidSetupVillage(state: GameState, vertexId: string): { ok: true } | { ok: false; reason: string } {
  if (!state.board.vertices.has(vertexId)) return { ok: false, reason: '无效顶点' };
  if (state.placements.villages.has(vertexId) || state.placements.towns.has(vertexId)) {
    return { ok: false, reason: '已有建筑' };
  }
  if (violatesDistance(state, vertexId)) return { ok: false, reason: '距其他村庄过近' };
  return { ok: true };
}

export function getSetupRoadEdges(state: GameState, playerId: number): string[] {
  const network = getPlayerNetworkVertices(state, playerId);
  if (network.size === 0) return [];
  const out = new Set<string>();
  for (const vid of network) {
    for (const eid of getVertexEdges(state.board, vid)) {
      if (!state.placements.roads.has(eid)) out.add(eid);
    }
  }
  return [...out];
}

export function isValidSetupRoad(
  state: GameState,
  playerId: number,
  edgeId: string,
): { ok: true } | { ok: false; reason: string } {
  const e = state.board.edges.get(edgeId);
  if (!e) return { ok: false, reason: '无效道路' };
  if (state.placements.roads.has(edgeId)) return { ok: false, reason: '已有道路' };
  if (!getSetupRoadEdges(state, playerId).includes(edgeId)) {
    return { ok: false, reason: '须与己方村庄或道路相邻' };
  }
  return { ok: true };
}

export function placeSetupVillage(state: GameState, playerId: number, vertexId: string): boolean {
  const check = isValidSetupVillage(state, vertexId);
  if (!check.ok) {
    appendLog(state, `无法放置村庄：${check.reason}`);
    return false;
  }
  state.placements.villages.set(vertexId, playerId);
  const p = state.players[playerId]!;
  p.villagesLeft--;
  p.buildingVp++;
  state.setupVillageVertex = vertexId;
  appendLog(state, `${p.name} 空降村庄 @ ${vertexId}（建筑分 +1）`);
  return true;
}

export function placeSetupRoad(state: GameState, playerId: number, edgeId: string): boolean {
  const check = isValidSetupRoad(state, playerId, edgeId);
  if (!check.ok) {
    appendLog(state, `无法放置道路：${check.reason}`);
    return false;
  }
  state.placements.roads.add(edgeId);
  state.placements.roadOwners.set(edgeId, playerId);
  const p = state.players[playerId]!;
  p.roadsLeft--;
  appendLog(state, `${p.name} 修建道路 @ ${edgeId}`);
  return true;
}

/** Setup harvest: each adjacent resource tile gives 1 */
export function setupHarvest(state: GameState, playerId: number, vertexId: string): void {
  const v = state.board.vertices.get(vertexId);
  if (!v) return;
  const p = state.players[playerId]!;
  const gained: Partial<ResourceBag> = {};
  for (const tid of v.tileIds) {
    const tile = state.board.tiles[tid]!;
    if (tile.terrain === 'desert') continue;
    const res = tile.terrain === 'forest' ? 'wood'
      : tile.terrain === 'hills' ? 'brick'
      : tile.terrain === 'mountains' ? 'ore'
      : tile.terrain === 'fields' ? 'wheat'
      : 'sheep';
    p.resources[res]++;
    gained[res] = (gained[res] ?? 0) + 1;
  }
  const parts = Object.entries(gained).map(([k, n]) => `${RESOURCE_NAMES[k as ResourceKey]}×${n}`);
  if (parts.length) appendLog(state, `  → 开局资源：${parts.join(' ')}`);
}

export function rollDice(state: GameState): [number, number] {
  const d1 = 1 + Math.floor(Math.random() * 6);
  const d2 = 1 + Math.floor(Math.random() * 6);
  state.lastDice = [d1, d2];
  state.diceSum = d1 + d2;
  return [d1, d2];
}

export function harvestForDice(state: GameState, sum: number): HarvestGainEvent[] {
  const events: HarvestGainEvent[] = [];
  if (sum === 7) {
    state.lastHarvestGains = events;
    return events;
  }
  const blocked = state.blockedTileId;
  const lines: string[] = [`骰和 = ${sum}，开始收割：`];
  for (const p of state.players) {
    const gains: string[] = [];
    for (const [vid, owner] of state.placements.villages) {
      if (owner !== p.id) continue;
      const isTown = state.placements.towns.has(vid);
      const mult = isTown ? 2 : 1;
      const v = state.board.vertices.get(vid)!;
      for (const tid of v.tileIds) {
        if (blocked !== null && tid === blocked) continue;
        const tile = state.board.tiles[tid]!;
        if (tile.number !== sum) continue;
        const res = tile.terrain === 'forest' ? 'wood'
          : tile.terrain === 'hills' ? 'brick'
          : tile.terrain === 'mountains' ? 'ore'
          : tile.terrain === 'fields' ? 'wheat'
          : tile.terrain === 'pasture' ? 'sheep' : null;
        if (!res) continue;
        p.resources[res] += mult;
        events.push({ playerId: p.id, resource: res, amount: mult });
        gains.push(`${RESOURCE_NAMES[res]}×${mult}(格#${tid})`);
      }
    }
    if (gains.length) lines.push(`  ${p.name}：${gains.join(' ')}`);
  }
  const any = lines.length > 1;
  if (!any) lines.push('  （无人产出）');
  emitStage(state, '收割阶段', lines);
  state.lastHarvestGains = events;
  return events;
}

export function runRobberDiscard(state: GameState): void {
  const lines: string[] = [];
  state.pendingDiscard = [];
  for (let i = 0; i < state.players.length; i++) {
    const p = state.players[i]!;
    let total = totalResources(p.resources);
    if (total <= DISCARD_THRESHOLD) {
      lines.push(`  ${p.name}：${total} 张，无需弃牌`);
      continue;
    }
    state.pendingDiscard.push(i);
    let discard = 0;
    while (total > DISCARD_THRESHOLD) {
      const drop = Math.ceil(total / 2);
      discard += drop;
      total -= drop;
      for (let d = 0; d < drop; d++) {
        const keys = (['wood', 'brick', 'ore', 'wheat', 'sheep'] as ResourceKey[]).filter((k) => p.resources[k] > 0);
        if (!keys.length) break;
        const k = keys[Math.floor(Math.random() * keys.length)]!;
        p.resources[k]--;
      }
    }
    lines.push(`  ${p.name}：弃牌 ${discard} 张（直至 ≤${DISCARD_THRESHOLD}）`);
  }
  emitStage(state, '强盗弃牌判定', lines);
}

export function moveRobber(state: GameState, tileId: number): void {
  const tile = state.board.tiles[tileId];
  if (!tile) return;
  state.robberTileId = tileId;
  state.blockedTileId = tileId;
  appendLog(state, `强盗移至 #${tileId} ${tile.terrain}（该格不再产出）`);
}

export function stealFrom(state: GameState, thiefId: number, victimId: number): void {
  const victim = state.players[victimId]!;
  const keys = (['wood', 'brick', 'ore', 'wheat', 'sheep'] as ResourceKey[]).filter((k) => victim.resources[k] > 0);
  if (!keys.length) {
    appendLog(state, `${state.players[thiefId]!.name} 掠夺 ${victim.name}：对方无资源`);
    return;
  }
  const k = keys[Math.floor(Math.random() * keys.length)]!;
  victim.resources[k]--;
  state.players[thiefId]!.resources[k]++;
  appendLog(state, `${state.players[thiefId]!.name} 掠夺 ${victim.name} 获得 ${RESOURCE_NAMES[k]}×1`);
}

export function pickRobberVictim(state: GameState, thiefId: number): number | null {
  const tile = state.board.tiles[state.robberTileId];
  if (!tile) return null;
  const candidates = new Set<number>();
  for (const [vid, owner] of state.placements.villages) {
    if (owner === thiefId) continue;
    const v = state.board.vertices.get(vid)!;
    if (v.tileIds.includes(state.robberTileId)) candidates.add(owner);
  }
  const list = [...candidates];
  if (!list.length) return null;
  return list[Math.floor(Math.random() * list.length)]!;
}

export function countRoadSegments(state: GameState, playerId: number): number {
  let n = 0;
  for (const eid of state.placements.roads) {
    if (playerOwnsRoad(state, playerId, eid)) n++;
  }
  return n;
}

/** Longest road: >5 segments, no branching — simplified: max edge count in longest path */
export function computeLongestRoad(state: GameState, playerId: number): number {
  const myEdges = [...state.placements.roads].filter((eid) => playerOwnsRoad(state, playerId, eid));
  if (myEdges.length <= 5) return myEdges.length;

  const adj = new Map<string, string[]>();
  for (const eid of myEdges) {
    const e = state.board.edges.get(eid)!;
    if (!adj.has(e.v1)) adj.set(e.v1, []);
    if (!adj.has(e.v2)) adj.set(e.v2, []);
    adj.get(e.v1)!.push(e.v2);
    adj.get(e.v2)!.push(e.v1);
  }

  let best = 0;
  const dfs = (v: string, visited: Set<string>, len: number) => {
    best = Math.max(best, len);
    for (const n of adj.get(v) ?? []) {
      const ek = state.board.edges.has(`${v}|${n}`) ? `${v}|${n}` : `${n}|${v}`;
      if (!myEdges.includes(ek) && !myEdges.includes(ek.split('|').reverse().join('|'))) {
        const e = [...state.board.edges.values()].find(
          (ed) => (ed.v1 === v && ed.v2 === n) || (ed.v2 === v && ed.v1 === n),
        );
        if (!e || !myEdges.includes(e.id)) continue;
      }
      const e = [...state.board.edges.values()].find(
        (ed) => (ed.v1 === v && ed.v2 === n) || (ed.v2 === v && ed.v1 === n),
      );
      if (!e || visited.has(e.id)) continue;
      visited.add(e.id);
      dfs(n, visited, len + 1);
      visited.delete(e.id);
    }
  };

  for (const v of adj.keys()) dfs(v, new Set(), 0);
  return best;
}

export function updateAchievements(state: GameState): void {
  for (const p of state.players) p.achievementVp = 0;

  let bestRoad = 0;
  let roadPlayer: number | null = null;
  for (const p of state.players) {
    const len = computeLongestRoad(state, p.id);
    if (len > 5 && len > bestRoad) {
      bestRoad = len;
      roadPlayer = p.id;
    } else if (len > 5 && len === bestRoad) {
      roadPlayer = null;
    }
  }
  state.longestRoadPlayer = roadPlayer;
  if (roadPlayer !== null) state.players[roadPlayer]!.achievementVp += 2;

  let bestKnights = 0;
  let knightPlayer: number | null = null;
  for (const p of state.players) {
    if (p.knightsPlayed > 3 && p.knightsPlayed > bestKnights) {
      bestKnights = p.knightsPlayed;
      knightPlayer = p.id;
    } else if (p.knightsPlayed > 3 && p.knightsPlayed === bestKnights) {
      knightPlayer = null;
    }
  }
  state.largestArmyPlayer = knightPlayer;
  if (knightPlayer !== null) state.players[knightPlayer]!.achievementVp += 2;
}

export function checkWin(state: GameState): boolean {
  updateAchievements(state);
  for (const p of state.players) {
    const total = playerTotalVp(p);
    if (total >= WIN_SCORE) {
      state.gameEnded = true;
      state.winnerId = p.id;
      state.phase = 'game_over';
      emitStage(state, '游戏结束', [
        `${p.name} 达到 ${total} 分获胜！`,
        `  建筑 ${p.buildingVp} + 发展 ${p.devVp} + 成就 ${p.achievementVp}`,
      ]);
      state.nextButtonLabel = '重新开始';
      return true;
    }
  }
  return false;
}

export function isValidRobberTile(state: GameState, tileId: number): boolean {
  const tile = state.board.tiles[tileId];
  if (!tile || tile.terrain === 'desert') return false;
  if (tileId === state.robberTileId) return false;
  return true;
}

export function getBuildableRoadEdges(state: GameState, playerId: number): string[] {
  const reachable = getPlayerNetworkVertices(state, playerId);
  const out = new Set<string>();
  for (const vid of reachable) {
    for (const eid of getVertexEdges(state.board, vid)) {
      if (!state.placements.roads.has(eid)) out.add(eid);
    }
  }
  return [...out];
}

/** Vertices reachable from player villages/towns along placed roads. */
function getPlayerNetworkVertices(state: GameState, playerId: number): Set<string> {
  const visitedV = new Set<string>();
  const queue: string[] = [];

  for (const [vid, owner] of state.placements.villages) {
    if (owner === playerId) {
      queue.push(vid);
      visitedV.add(vid);
    }
  }

  while (queue.length > 0) {
    const v = queue.shift()!;
    for (const eid of getVertexEdges(state.board, v)) {
      if (!state.placements.roads.has(eid)) continue;
      if (state.placements.roadOwners.get(eid) !== playerId) continue;
      const e = state.board.edges.get(eid)!;
      const next = e.v1 === v ? e.v2 : e.v1;
      const vo = state.placements.villages.get(next);
      if (vo !== undefined && vo !== playerId) continue;
      if (!visitedV.has(next)) {
        visitedV.add(next);
        queue.push(next);
      }
    }
  }
  return visitedV;
}

export function isValidBuildVillage(
  state: GameState,
  playerId: number,
  vertexId: string,
): { ok: true } | { ok: false; reason: string } {
  const p = state.players[playerId]!;
  if (p.villagesLeft <= 0) return { ok: false, reason: '村庄配额已用尽' };
  if (!canAfford(p, BUILD_COSTS.village)) return { ok: false, reason: '资源不足' };
  if (!state.board.vertices.has(vertexId)) return { ok: false, reason: '无效顶点' };
  if (state.placements.villages.has(vertexId) || state.placements.towns.has(vertexId)) {
    return { ok: false, reason: '已有建筑' };
  }
  if (violatesDistance(state, vertexId)) return { ok: false, reason: '距其他村庄过近' };
  if (!hasRoadPathTo(state, playerId, vertexId)) return { ok: false, reason: '须与自己的道路网相连' };
  return { ok: true };
}

export function getBuildableVillageVertices(state: GameState, playerId: number): string[] {
  const out: string[] = [];
  for (const vid of state.board.vertices.keys()) {
    if (isValidBuildVillage(state, playerId, vid).ok) out.push(vid);
  }
  return out;
}

export function tryBuildVillage(state: GameState, playerId: number, vertexId: string): boolean {
  const check = isValidBuildVillage(state, playerId, vertexId);
  if (!check.ok) {
    appendLog(state, `无法建造村庄：${check.reason}`);
    return false;
  }
  const p = state.players[playerId]!;
  payCost(p, BUILD_COSTS.village);
  state.placements.villages.set(vertexId, playerId);
  p.villagesLeft--;
  p.buildingVp++;
  appendLog(state, `${p.name} 建造村庄 @ ${vertexId}（建筑分 +1，余 ${p.villagesLeft}）`);
  checkWin(state);
  return true;
}

export function isValidUpgradeTown(
  state: GameState,
  playerId: number,
  vertexId: string,
): { ok: true } | { ok: false; reason: string } {
  const p = state.players[playerId]!;
  if (p.townsLeft <= 0) return { ok: false, reason: '城镇配额已用尽' };
  if (!canAfford(p, BUILD_COSTS.town)) return { ok: false, reason: '资源不足' };
  if (state.placements.villages.get(vertexId) !== playerId) return { ok: false, reason: '须升级自己的村庄' };
  if (state.placements.towns.has(vertexId)) return { ok: false, reason: '已是城镇' };
  return { ok: true };
}

export function getUpgradeableVertices(state: GameState, playerId: number): string[] {
  const out: string[] = [];
  for (const [vid, owner] of state.placements.villages) {
    if (owner !== playerId) continue;
    if (state.placements.towns.has(vid)) continue;
    if (isValidUpgradeTown(state, playerId, vid).ok) out.push(vid);
  }
  return out;
}

export function tryUpgradeTown(state: GameState, playerId: number, vertexId: string): boolean {
  const check = isValidUpgradeTown(state, playerId, vertexId);
  if (!check.ok) {
    appendLog(state, `无法升级城镇：${check.reason}`);
    return false;
  }
  const p = state.players[playerId]!;
  payCost(p, BUILD_COSTS.town);
  state.placements.towns.add(vertexId);
  p.townsLeft--;
  p.buildingVp++;
  appendLog(state, `${p.name} 升级城镇 @ ${vertexId}（建筑分 +1，余 ${p.townsLeft}）`);
  checkWin(state);
  return true;
}

export function playerHasPort(state: GameState, playerId: number, port: PortKind): boolean {
  for (const [vid, owner] of state.placements.villages) {
    if (owner !== playerId) continue;
    if (state.board.vertices.get(vid)?.port === port) return true;
  }
  for (const vid of state.placements.towns) {
    if (state.placements.villages.get(vid) !== playerId) continue;
    if (state.board.vertices.get(vid)?.port === port) return true;
  }
  return false;
}

/** Best exchange rate when trading `give` resource away (4 = bank, 3 = generic port, 2 = specialty). */
export function tradeRateForGive(state: GameState, playerId: number, give: ResourceKey): number {
  let rate = 4;
  if (playerHasPort(state, playerId, 'generic_3_1')) rate = 3;
  if (give === 'wood' && playerHasPort(state, playerId, 'wood_2_1')) rate = Math.min(rate, 2);
  if (give === 'brick' && playerHasPort(state, playerId, 'brick_2_1')) rate = Math.min(rate, 2);
  if (give === 'ore' && playerHasPort(state, playerId, 'ore_2_1')) rate = Math.min(rate, 2);
  return rate;
}

export function tryBankTrade(
  state: GameState,
  playerId: number,
  give: ResourceKey,
  receive: ResourceKey,
): boolean {
  const p = state.players[playerId]!;
  const rate = tradeRateForGive(state, playerId, give);
  if (give === receive) {
    appendLog(state, '付出与得到资源不能相同');
    return false;
  }
  if (p.resources[give] < rate) {
    appendLog(state, `资源不足：需要 ${RESOURCE_NAMES[give]}×${rate}`);
    return false;
  }
  p.resources[give] -= rate;
  p.resources[receive]++;
  appendLog(state, `${p.name} 银行交易：${RESOURCE_NAMES[give]}×${rate} → ${RESOURCE_NAMES[receive]}×1`);
  return true;
}

export function tryPlayerTrade(
  state: GameState,
  fromId: number,
  toId: number,
  offer: Partial<ResourceBag>,
  request: Partial<ResourceBag>,
): boolean {
  const from = state.players[fromId]!;
  const to = state.players[toId]!;
  for (const k of ['wood', 'brick', 'ore', 'wheat', 'sheep'] as ResourceKey[]) {
    const o = offer[k] ?? 0;
    const r = request[k] ?? 0;
    if (o < 0 || r < 0) return false;
    if (from.resources[k] < o) {
      appendLog(state, `${from.name} ${RESOURCE_NAMES[k]} 不足`);
      return false;
    }
    if (to.resources[k] < r) {
      appendLog(state, `${to.name} ${RESOURCE_NAMES[k]} 不足`);
      return false;
    }
  }
  const offerTotal = Object.values(offer).reduce((a, b) => a + (b ?? 0), 0);
  const requestTotal = Object.values(request).reduce((a, b) => a + (b ?? 0), 0);
  if (offerTotal === 0 || requestTotal === 0) {
    appendLog(state, '交易双方资源数量须 > 0');
    return false;
  }
  for (const k of ['wood', 'brick', 'ore', 'wheat', 'sheep'] as ResourceKey[]) {
    const o = offer[k] ?? 0;
    const r = request[k] ?? 0;
    from.resources[k] -= o;
    from.resources[k] += r;
    to.resources[k] -= r;
    to.resources[k] += o;
  }
  const offerStr = formatPartialBag(offer);
  const reqStr = formatPartialBag(request);
  appendLog(state, `交易：${from.name} 给出[${offerStr}] ↔ ${to.name} 给出[${reqStr}]`);
  return true;
}

function formatPartialBag(bag: Partial<ResourceBag>): string {
  return (['wood', 'brick', 'ore', 'wheat', 'sheep'] as ResourceKey[])
    .filter((k) => (bag[k] ?? 0) > 0)
    .map((k) => `${RESOURCE_NAMES[k]}×${bag[k]}`)
    .join(' ');
}

export function canHumanBuildRoad(state: GameState, playerId: number): boolean {
  const p = state.players[playerId]!;
  return p.roadsLeft > 0 && canAfford(p, BUILD_COSTS.road) && getBuildableRoadEdges(state, playerId).length > 0;
}

export function canHumanBuildVillage(state: GameState, playerId: number): boolean {
  const p = state.players[playerId]!;
  return p.villagesLeft > 0 && canAfford(p, BUILD_COSTS.village) && getBuildableVillageVertices(state, playerId).length > 0;
}

export function canHumanUpgradeTown(state: GameState, playerId: number): boolean {
  const p = state.players[playerId]!;
  return p.townsLeft > 0 && canAfford(p, BUILD_COSTS.town) && getUpgradeableVertices(state, playerId).length > 0;
}


export function canHumanBuyDevCard(state: GameState, playerId: number): boolean {
  return canAfford(state.players[playerId]!, BUILD_COSTS.devCard);
}

export function computeResourceMissing(
  cost: ResourceBag,
  have: ResourceBag,
): Partial<Record<ResourceKey, number>> {
  const missing: Partial<Record<ResourceKey, number>> = {};
  for (const k of RESOURCE_KEYS) {
    const need = cost[k] ?? 0;
    if (need > 0 && have[k] < need) missing[k] = need - have[k];
  }
  return missing;
}

export function formatMissingList(m: Partial<Record<ResourceKey, number>>): string {
  const parts = RESOURCE_KEYS.filter((k) => (m[k] ?? 0) > 0).map((k) => `${RESOURCE_NAMES[k]}×${m[k]}`);
  return parts.length ? parts.join('、') : '无';
}

export interface ActionResourceGap {
  label: string;
  missing: Partial<Record<ResourceKey, number>>;
  /** 资源已满足建造花费 */
  resourcesReady: boolean;
  /** 当前可执行（资源 + 配额 + 地图条件） */
  canBuild: boolean;
  /** 资源够但还不能建造时的原因 */
  blocker: string | null;
}

function roadPlacementBlocker(state: GameState, playerId: number): string | null {
  const p = state.players[playerId]!;
  if (p.roadsLeft <= 0) return '配额用尽';
  if (getBuildableRoadEdges(state, playerId).length === 0) return '无可连边';
  return null;
}

function villagePlacementBlocker(state: GameState, playerId: number): string | null {
  const p = state.players[playerId]!;
  if (p.villagesLeft <= 0) return '配额用尽';
  if (getBuildableVillageVertices(state, playerId).length > 0) return null;
  for (const vid of state.board.vertices.keys()) {
    if (state.placements.villages.has(vid) || state.placements.towns.has(vid)) continue;
    if (violatesDistance(state, vid)) continue;
    if (hasRoadPathTo(state, playerId, vid)) return '无可建点';
  }
  return '须先修路';
}

function townPlacementBlocker(state: GameState, playerId: number): string | null {
  const p = state.players[playerId]!;
  if (p.townsLeft <= 0) return '配额用尽';
  if (getUpgradeableVertices(state, playerId).length === 0) return '无可升级';
  return null;
}

export function getHumanActionGaps(state: GameState, playerId: number): ActionResourceGap[] {
  const p = state.players[playerId]!;
  const rows: {
    label: string;
    cost: ResourceBag;
    canBuild: boolean;
    blocker: string | null;
  }[] = [
    {
      label: '道路',
      cost: BUILD_COSTS.road,
      canBuild: canHumanBuildRoad(state, playerId),
      blocker: roadPlacementBlocker(state, playerId),
    },
    {
      label: '村庄',
      cost: BUILD_COSTS.village,
      canBuild: canHumanBuildVillage(state, playerId),
      blocker: villagePlacementBlocker(state, playerId),
    },
    {
      label: '城镇',
      cost: BUILD_COSTS.town,
      canBuild: canHumanUpgradeTown(state, playerId),
      blocker: townPlacementBlocker(state, playerId),
    },
    {
      label: '发展卡',
      cost: BUILD_COSTS.devCard,
      canBuild: canHumanBuyDevCard(state, playerId),
      blocker: null,
    },
  ];
  return rows.map(({ label, cost, canBuild, blocker }) => {
    const missing = computeResourceMissing(cost, p.resources);
    const resourcesReady = Object.keys(missing).length === 0;
    return {
      label,
      missing,
      resourcesReady,
      canBuild,
      blocker: resourcesReady && !canBuild ? blocker : null,
    };
  });
}

/** Hint for bank trade: which builds still need the target resource. */
export function bankReceiveHint(state: GameState, playerId: number, receive: ResourceKey): string {
  const gaps = getHumanActionGaps(state, playerId);
  const related = gaps.filter((g) => (g.missing[receive] ?? 0) > 0);
  if (!related.length) return `换${RESOURCE_NAMES[receive]}：当前建造无此缺口`;
  return related
    .map((g) => `${g.label}还缺${RESOURCE_NAMES[receive]}×${g.missing[receive]}`)
    .join('；');
}

export function tryBuildRoad(state: GameState, playerId: number, edgeId: string): boolean {
  const p = state.players[playerId]!;
  if (p.roadsLeft <= 0) return false;
  if (!canAfford(p, BUILD_COSTS.road)) return false;
  if (!getBuildableRoadEdges(state, playerId).includes(edgeId)) {
    appendLog(state, '无法在此修建道路（须与己方道路网相连）');
    return false;
  }
  const e = state.board.edges.get(edgeId);
  if (!e || state.placements.roads.has(edgeId)) return false;
  payCost(p, BUILD_COSTS.road);
  state.placements.roads.add(edgeId);
  state.placements.roadOwners.set(edgeId, playerId);
  p.roadsLeft--;
  appendLog(state, `${p.name} 建造道路 @ ${edgeId}（余 ${p.roadsLeft}）`);
  checkWin(state);
  return true;
}

export function tryBuyDevCard(state: GameState, playerId: number): boolean {
  const p = state.players[playerId]!;
  if (!canAfford(p, BUILD_COSTS.devCard)) return false;
  payCost(p, BUILD_COSTS.devCard);
  const card = drawDevCard(state, p);
  if (card) appendLog(state, `${p.name} 购买发展卡（${card.kind}）`);
  return !!card;
}

export function playUniversity(state: GameState, playerId: number): void {
  const p = state.players[playerId]!;
  p.devVp++;
  p.shownCards.push('university');
  appendLog(state, `${p.name} 打出大学卡（发展分 +1）`);
}

export function playKnightRobber(state: GameState, playerId: number, tileId: number): boolean {
  if (!isValidRobberTile(state, tileId)) return false;
  moveRobber(state, tileId);
  const victim = pickRobberVictim(state, playerId);
  if (victim !== null) stealFrom(state, playerId, victim);
  else appendLog(state, '强盗格旁无其他玩家村庄，跳过掠夺');
  return true;
}

export function playKnight(state: GameState, playerId: number): void {
  const p = state.players[playerId]!;
  p.knightsPlayed++;
  p.shownCards.push('knight');
  appendLog(state, `${p.name} 打出骑士卡（已出 ${p.knightsPlayed} 张）`);
  updateAchievements(state);
  const neighbors = neighborTileIds(state.board, state.robberTileId);
  const target = neighbors[Math.floor(Math.random() * neighbors.length)] ?? state.robberTileId;
  playKnightRobber(state, playerId, target);
}

export function playMonopoly(state: GameState, playerId: number, resource: ResourceKey): void {
  const p = state.players[playerId]!;
  p.shownCards.push('monopoly');
  let total = 0;
  for (const other of state.players) {
    if (other.id === playerId) continue;
    total += other.resources[resource];
    other.resources[resource] = 0;
  }
  p.resources[resource] += total;
  appendLog(state, `${p.name} 资源控制：全场 ${RESOURCE_NAMES[resource]} → 自己（共 ${total} 张）`);
}

export function formatPlayerStatus(state: GameState, playerId: number): string {
  const p = state.players[playerId]!;
  return `${p.name} | VP ${playerTotalVp(p)}(建${p.buildingVp}+发${p.devVp}+成${p.achievementVp}) | ${formatResources(p.resources)}`;
}

export function devCardLabel(kind: DevCardKind): string {
  switch (kind) {
    case 'knight': return '骑士';
    case 'university': return '大学';
    case 'monopoly': return '资源控制';
  }
}

export function canHumanPlayDevCard(state: GameState, playerId: number, cardIndex: number): boolean {
  if (state.phase !== 'turn_develop' || state.currentPlayer !== playerId) return false;
  const card = state.players[playerId]!.devCards[cardIndex];
  return !!card && !card.played;
}

export function playDevCardUniversity(state: GameState, playerId: number, cardIndex: number): boolean {
  if (!canHumanPlayDevCard(state, playerId, cardIndex)) return false;
  const card = state.players[playerId]!.devCards[cardIndex]!;
  if (card.kind !== 'university') return false;
  card.played = true;
  playUniversity(state, playerId);
  checkWin(state);
  return true;
}

export function startDevCardKnight(state: GameState, playerId: number, cardIndex: number): boolean {
  if (!canHumanPlayDevCard(state, playerId, cardIndex)) return false;
  const card = state.players[playerId]!.devCards[cardIndex]!;
  if (card.kind !== 'knight') return false;
  state.pendingDevCardIndex = cardIndex;
  appendLog(state, `${state.players[playerId]!.name} 打出骑士卡：点击地图移动强盗并掠夺`);
  return true;
}

export function completeDevCardKnight(state: GameState, playerId: number, tileId: number): boolean {
  const idx = state.pendingDevCardIndex;
  if (idx === null || state.currentPlayer !== playerId) return false;
  const p = state.players[playerId]!;
  const card = p.devCards[idx];
  if (!card || card.played || card.kind !== 'knight') return false;
  if (!playKnightRobber(state, playerId, tileId)) return false;
  card.played = true;
  p.knightsPlayed++;
  p.shownCards.push('knight');
  updateAchievements(state);
  state.pendingDevCardIndex = null;
  appendLog(state, `${p.name} 骑士生效（已出 ${p.knightsPlayed} 张）`);
  return true;
}

export function startDevCardMonopoly(state: GameState, playerId: number, cardIndex: number): boolean {
  if (!canHumanPlayDevCard(state, playerId, cardIndex)) return false;
  const p = state.players[playerId]!;
  const card = p.devCards[cardIndex]!;
  if (card.kind !== 'monopoly') return false;
  state.pendingDevCardIndex = cardIndex;
  appendLog(state, `${p.name} 打出资源控制卡：选择要垄断的资源`);
  return true;
}

export function completeDevCardMonopoly(
  state: GameState,
  playerId: number,
  resource: ResourceKey,
): boolean {
  const idx = state.pendingDevCardIndex;
  if (idx === null || state.currentPlayer !== playerId) return false;
  const p = state.players[playerId]!;
  const card = p.devCards[idx];
  if (!card || card.played || card.kind !== 'monopoly') return false;
  card.played = true;
  state.pendingDevCardIndex = null;
  playMonopoly(state, playerId, resource);
  return true;
}
