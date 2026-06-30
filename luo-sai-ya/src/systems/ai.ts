import type { GameState, ResourceBag, ResourceKey } from '../core/types';
import { getVertexEdges } from '../core/map';
import { getSetupRoadEdges, isValidSetupVillage } from '../core/rules';

function bagTotal(b: Partial<ResourceBag> | undefined): number {
  if (!b) return 0;
  return (['wood', 'brick', 'ore', 'wheat', 'sheep'] as ResourceKey[]).reduce((s, k) => s + (b[k] ?? 0), 0);
}

/** AI accepts trade if it gains at least as many cards as it gives. */
export function aiAcceptsTrade(
  _state: GameState,
  offerToAi: Partial<ResourceBag>,
  requestFromAi: Partial<ResourceBag>,
): boolean {
  return bagTotal(requestFromAi) <= bagTotal(offerToAi);
}

export function pickSetupVillage(state: GameState, playerId: number): string | null {
  const candidates: string[] = [];
  for (const vid of state.board.vertices.keys()) {
    if (isValidSetupVillage(state, vid).ok) candidates.push(vid);
  }
  if (!candidates.length) return null;
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}

export function pickSetupRoad(state: GameState, playerId: number): string | null {
  const valid = getSetupRoadEdges(state, playerId);
  if (!valid.length) return null;
  return valid[Math.floor(Math.random() * valid.length)]!;
}

export function pickRobberTile(state: GameState): number {
  const candidates = state.board.tiles
    .filter((t) => t.id !== state.robberTileId && t.terrain !== 'desert')
    .map((t) => t.id);
  if (!candidates.length) return state.robberTileId;
  return candidates[Math.floor(Math.random() * candidates.length)]!;
}

export function pickDevelopAction(state: GameState, playerId: number): 'road' | 'dev' | 'skip' {
  const p = state.players[playerId]!;
  if (p.resources.wood >= 1 && p.resources.brick >= 1 && p.roadsLeft > 0) {
    const village = [...state.placements.villages.entries()].find(([, o]) => o === playerId)?.[0];
    if (village) {
      const edges = getVertexEdges(state.board, village).filter((e) => !state.placements.roads.has(e));
      if (edges.length) return 'road';
    }
  }
  if (
    p.resources.wood >= 1 &&
    p.resources.ore >= 1 &&
    p.resources.wheat >= 1
  ) return 'dev';
  return 'skip';
}

export function pickRoadForPlayer(state: GameState, playerId: number): string | null {
  for (const [vid, owner] of state.placements.villages) {
    if (owner !== playerId) continue;
    const edges = getVertexEdges(state.board, vid).filter((e) => !state.placements.roads.has(e));
    if (edges.length) return edges[Math.floor(Math.random() * edges.length)]!;
  }
  for (const vid of state.placements.towns) {
    const owner = state.placements.villages.get(vid);
    if (owner !== playerId) continue;
    const edges = getVertexEdges(state.board, vid).filter((e) => !state.placements.roads.has(e));
    if (edges.length) return edges[Math.floor(Math.random() * edges.length)]!;
  }
  return null;
}
