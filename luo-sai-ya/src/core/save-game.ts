import { createGameState } from './game-state';
import type { BoardGraph, GameState, Placements } from './types';

const LEGACY_SAVE_KEY = 'luo-sai-ya-save-v1';
const INDEX_KEY = 'luo-sai-ya-saves-index';
const SAVE_PREFIX = 'luo-sai-ya-save-';

export interface SaveSlotInfo {
  id: string;
  label: string;
  savedAt: number;
  round: number;
  phase: string;
  humanVp: number;
}

interface SaveIndex {
  version: 1;
  slots: SaveSlotInfo[];
}

interface SerializedBoard {
  tiles: BoardGraph['tiles'];
  vertices: [string, BoardGraph['vertices'] extends Map<string, infer V> ? V : never][];
  edges: [string, BoardGraph['edges'] extends Map<string, infer E> ? E : never][];
  robberTileId: number;
}

interface SerializedPlacements {
  villages: [string, number][];
  towns: string[];
  roads: string[];
  roadOwners: [string, number][];
}

export interface SerializedGameState {
  version: 1;
  slotId: string;
  label: string;
  savedAt: number;
  phase: GameState['phase'];
  round: number;
  board: SerializedBoard;
  players: GameState['players'];
  placements: SerializedPlacements;
  currentPlayer: number;
  setupPlayerIndex: number;
  setupPlacementRound: 1 | 2;
  setupVillageVertex: string | null;
  lastDice: [number, number] | null;
  diceSum: number;
  robberTileId: number;
  blockedTileId: number | null;
  devDeck: GameState['devDeck'];
  longestRoadPlayer: number | null;
  largestArmyPlayer: number | null;
  pendingDiscard: number[];
  log: string[];
  nextButtonLabel: string;
  gameEnded: boolean;
  winnerId: number | null;
  skipConfirm: boolean;
}

function newSlotId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function readIndex(): SaveIndex {
  try {
    const raw = localStorage.getItem(INDEX_KEY);
    if (!raw) return { version: 1, slots: [] };
    const data = JSON.parse(raw) as SaveIndex;
    if (data.version !== 1 || !Array.isArray(data.slots)) return { version: 1, slots: [] };
    return data;
  } catch {
    return { version: 1, slots: [] };
  }
}

function writeIndex(index: SaveIndex): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(index));
}

function slotKey(id: string): string {
  return `${SAVE_PREFIX}${id}`;
}

function humanVpFromPlayers(players: GameState['players']): number {
  const human = players[0];
  if (!human) return 0;
  return human.buildingVp + human.devVp + human.achievementVp;
}

function metaFromSerialized(id: string, data: SerializedGameState): SaveSlotInfo {
  return {
    id,
    label: data.label || defaultLabel(data.savedAt),
    savedAt: data.savedAt,
    round: data.round,
    phase: data.phase,
    humanVp: humanVpFromPlayers(data.players),
  };
}

function defaultLabel(savedAt: number): string {
  const d = new Date(savedAt);
  return `存档 ${d.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

function migrateLegacySave(): void {
  try {
    const legacy = localStorage.getItem(LEGACY_SAVE_KEY);
    if (!legacy) return;
    const data = JSON.parse(legacy) as SerializedGameState;
    if (data.version !== 1) return;
    const id = newSlotId();
    const enriched: SerializedGameState = {
      ...data,
      slotId: id,
      label: defaultLabel(data.savedAt ?? Date.now()),
    };
    localStorage.setItem(slotKey(id), JSON.stringify(enriched));
    const index = readIndex();
    index.slots.unshift(metaFromSerialized(id, enriched));
    writeIndex(index);
    localStorage.removeItem(LEGACY_SAVE_KEY);
  } catch {
    /* ignore */
  }
}

function ensureMigrated(): void {
  migrateLegacySave();
}

function serializeBoard(board: BoardGraph): SerializedBoard {
  return {
    tiles: board.tiles,
    vertices: [...board.vertices.entries()],
    edges: [...board.edges.entries()],
    robberTileId: board.robberTileId,
  };
}

function deserializeBoard(data: SerializedBoard): BoardGraph {
  return {
    tiles: data.tiles,
    vertices: new Map(data.vertices),
    edges: new Map(data.edges),
    robberTileId: data.robberTileId,
  };
}

function serializePlacements(p: Placements): SerializedPlacements {
  return {
    villages: [...p.villages.entries()],
    towns: [...p.towns],
    roads: [...p.roads],
    roadOwners: [...p.roadOwners.entries()],
  };
}

function deserializePlacements(data: SerializedPlacements): Placements {
  return {
    villages: new Map(data.villages),
    towns: new Set(data.towns),
    roads: new Set(data.roads),
    roadOwners: new Map(data.roadOwners),
  };
}

export function serializeGameState(state: GameState, slotId: string, label: string): SerializedGameState {
  const savedAt = Date.now();
  return {
    version: 1,
    slotId,
    label,
    savedAt,
    phase: state.phase,
    round: state.round,
    board: serializeBoard(state.board),
    players: structuredClone(state.players),
    placements: serializePlacements(state.placements),
    currentPlayer: state.currentPlayer,
    setupPlayerIndex: state.setupPlayerIndex,
    setupPlacementRound: state.setupPlacementRound,
    setupVillageVertex: state.setupVillageVertex,
    lastDice: state.lastDice,
    diceSum: state.diceSum,
    robberTileId: state.robberTileId,
    blockedTileId: state.blockedTileId,
    devDeck: [...state.devDeck],
    longestRoadPlayer: state.longestRoadPlayer,
    largestArmyPlayer: state.largestArmyPlayer,
    pendingDiscard: [...state.pendingDiscard],
    log: [...state.log],
    nextButtonLabel: state.nextButtonLabel,
    gameEnded: state.gameEnded,
    winnerId: state.winnerId,
    skipConfirm: state.skipConfirm,
  };
}

export function deserializeGameState(data: SerializedGameState): GameState {
  const base = createGameState();
  return {
    ...base,
    phase: data.phase,
    round: data.round,
    board: deserializeBoard(data.board),
    players: structuredClone(data.players),
    placements: deserializePlacements(data.placements),
    currentPlayer: data.currentPlayer,
    setupPlayerIndex: data.setupPlayerIndex,
    setupPlacementRound: data.setupPlacementRound,
    setupVillageVertex: data.setupVillageVertex,
    lastDice: data.lastDice,
    diceSum: data.diceSum,
    robberTileId: data.robberTileId,
    blockedTileId: data.blockedTileId,
    devDeck: [...data.devDeck],
    longestRoadPlayer: data.longestRoadPlayer,
    largestArmyPlayer: data.largestArmyPlayer,
    pendingDiscard: [...data.pendingDiscard],
    log: [...data.log],
    nextButtonLabel: data.nextButtonLabel,
    gameEnded: data.gameEnded,
    winnerId: data.winnerId,
    skipConfirm: data.skipConfirm,
    selectedVertex: null,
    selectedEdge: null,
    selectedTileId: null,
    humanDevelopMode: 'idle',
    pendingDevCardIndex: null,
    lastHarvestGains: [],
  };
}

export function listSaves(): SaveSlotInfo[] {
  ensureMigrated();
  const index = readIndex();
  return [...index.slots].sort((a, b) => b.savedAt - a.savedAt);
}

export function hasSaves(): boolean {
  return listSaves().length > 0;
}

/** @deprecated use listSaves */
export function hasSave(): boolean {
  return hasSaves();
}

/** @deprecated use listSaves */
export function getSaveSummary(): SaveSlotInfo | null {
  return listSaves()[0] ?? null;
}

export function saveGame(state: GameState, slotId?: string | null, label?: string): { ok: boolean; slotId: string } {
  if (state.phase === 'init') return { ok: false, slotId: slotId ?? '' };
  ensureMigrated();
  try {
    const id = slotId || newSlotId();
    const index = readIndex();
    const existing = index.slots.find((s) => s.id === id);
    const slotLabel = label ?? existing?.label ?? defaultLabel(Date.now());
    const payload = serializeGameState(state, id, slotLabel);
    localStorage.setItem(slotKey(id), JSON.stringify(payload));
    const meta = metaFromSerialized(id, payload);
    const rest = index.slots.filter((s) => s.id !== id);
    index.slots = [meta, ...rest];
    writeIndex(index);
    return { ok: true, slotId: id };
  } catch {
    return { ok: false, slotId: slotId ?? '' };
  }
}

export function loadGame(slotId: string): GameState | null {
  ensureMigrated();
  try {
    const raw = localStorage.getItem(slotKey(slotId));
    if (!raw) return null;
    const data = JSON.parse(raw) as SerializedGameState;
    if (data.version !== 1) return null;
    return deserializeGameState(data);
  } catch {
    return null;
  }
}

export function deleteSave(slotId: string): boolean {
  ensureMigrated();
  try {
    localStorage.removeItem(slotKey(slotId));
    const index = readIndex();
    index.slots = index.slots.filter((s) => s.id !== slotId);
    writeIndex(index);
    return true;
  } catch {
    return false;
  }
}
