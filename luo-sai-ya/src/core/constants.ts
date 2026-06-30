export const NUM_PLAYERS = 4;
export const HUMAN_PLAYER = 0;
export const WIN_SCORE = 10;
export const DISCARD_THRESHOLD = 7;
export const MAX_ROADS = 10;

export const PLAYER_COLORS = ['#ef4444', '#3b82f6', '#f59e0b', '#10b981'] as const;

export type TerrainType = 'desert' | 'forest' | 'hills' | 'mountains' | 'fields' | 'pasture';
export type ResourceType = 'wood' | 'brick' | 'ore' | 'wheat' | 'sheep';
export type PortKind = 'generic_3_1' | 'wood_2_1' | 'ore_2_1' | 'brick_2_1';

export const PORT_LABELS: Record<PortKind, string> = {
  generic_3_1: '3:1',
  wood_2_1: '2木',
  ore_2_1: '2石',
  brick_2_1: '2砖',
};

export const TERRAIN_INFO: Record<TerrainType, { name: string; resource: ResourceType | null; color: string }> = {
  desert: { name: '沙漠', resource: null, color: '#d4a574' },
  forest: { name: '森林', resource: 'wood', color: '#228b22' },
  hills: { name: '砖厂', resource: 'brick', color: '#c45c26' },
  mountains: { name: '矿山', resource: 'ore', color: '#6b7280' },
  fields: { name: '麦田', resource: 'wheat', color: '#eab308' },
  pasture: { name: '草原', resource: 'sheep', color: '#84cc16' },
};

export const RESOURCE_NAMES: Record<ResourceType, string> = {
  wood: '木',
  brick: '砖',
  ore: '石',
  wheat: '粮',
  sheep: '羊',
};

export const RESOURCE_KEYS: ResourceType[] = ['wood', 'brick', 'ore', 'wheat', 'sheep'];

export const BUILD_COSTS = {
  road: { wood: 1, brick: 1, ore: 0, wheat: 0, sheep: 0 },
  village: { wood: 1, brick: 1, ore: 0, wheat: 1, sheep: 1 },
  town: { wood: 0, brick: 0, ore: 3, wheat: 2, sheep: 0 },
  devCard: { wood: 1, brick: 0, ore: 1, wheat: 1, sheep: 0 },
} as const;

/** 37-hex layout (radius 3): inner 19 + outer ring (+2 resource hex per edge) */
export const BOARD_TILE_DEFS: ReadonlyArray<{ q: number; r: number; terrain: TerrainType; number: number | null }> = [
  // center + ring 1–2 (original 19)
  { q: 0, r: 0, terrain: 'desert', number: null },
  { q: 0, r: -1, terrain: 'forest', number: 6 },
  { q: 1, r: -1, terrain: 'pasture', number: 2 },
  { q: 1, r: 0, terrain: 'fields', number: 3 },
  { q: 0, r: 1, terrain: 'hills', number: 5 },
  { q: -1, r: 1, terrain: 'mountains', number: 6 },
  { q: -1, r: 0, terrain: 'forest', number: 7 },
  { q: 0, r: -2, terrain: 'pasture', number: 10 },
  { q: 1, r: -2, terrain: 'fields', number: 12 },
  { q: 2, r: -2, terrain: 'hills', number: 8 },
  { q: 2, r: -1, terrain: 'forest', number: 4 },
  { q: 2, r: 0, terrain: 'pasture', number: 11 },
  { q: 1, r: 1, terrain: 'mountains', number: 9 },
  { q: 0, r: 2, terrain: 'fields', number: 4 },
  { q: -1, r: 2, terrain: 'forest', number: 3 },
  { q: -2, r: 2, terrain: 'hills', number: 5 },
  { q: -2, r: 1, terrain: 'pasture', number: 10 },
  { q: -2, r: 0, terrain: 'fields', number: 3 },
  { q: -1, r: -1, terrain: 'mountains', number: 8 },
  // ring 3 — outer perimeter (+2 hex per side)
  { q: 0, r: -3, terrain: 'pasture', number: 11 },
  { q: 1, r: -3, terrain: 'fields', number: 12 },
  { q: 2, r: -3, terrain: 'forest', number: 7 },
  { q: 3, r: -3, terrain: 'hills', number: 5 },
  { q: 3, r: -2, terrain: 'mountains', number: 9 },
  { q: 3, r: -1, terrain: 'pasture', number: 2 },
  { q: 3, r: 0, terrain: 'fields', number: 4 },
  { q: 2, r: 1, terrain: 'forest', number: 6 },
  { q: 1, r: 2, terrain: 'hills', number: 8 },
  { q: 0, r: 3, terrain: 'mountains', number: 6 },
  { q: -1, r: 3, terrain: 'pasture', number: 10 },
  { q: -2, r: 3, terrain: 'fields', number: 3 },
  { q: -3, r: 3, terrain: 'forest', number: 4 },
  { q: -3, r: 2, terrain: 'hills', number: 5 },
  { q: -3, r: 1, terrain: 'mountains', number: 9 },
  { q: -3, r: 0, terrain: 'pasture', number: 11 },
  { q: -2, r: -1, terrain: 'fields', number: 3 },
  { q: -1, r: -2, terrain: 'forest', number: 7 },
];

/** Port kinds placed evenly on coastal vertices (see map.ts) */
export const COASTAL_PORT_CYCLE: ReadonlyArray<PortKind> = [
  'generic_3_1',
  'wood_2_1',
  'generic_3_1',
  'ore_2_1',
  'brick_2_1',
  'generic_3_1',
  'wood_2_1',
  'generic_3_1',
  'ore_2_1',
  'brick_2_1',
  'generic_3_1',
  'generic_3_1',
];

export type DevCardKind = 'knight' | 'university' | 'monopoly';

export const DEV_DECK: DevCardKind[] = [
  ...Array(6).fill('knight' as const),
  ...Array(4).fill('university' as const),
  ...Array(3).fill('monopoly' as const),
];
