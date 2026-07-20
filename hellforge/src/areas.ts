// AreaDef registry — Cinderwatch / Ashen Reach / Slagdeep Hollow (Spec §5.4).
// Quest logic references AreaId; one-world teleport stays an internal adapter
// (callers never hard-code the dungeon (300,300) offset).

import type { AreaExitId, AreaId, QuestId, QuestSave, QuestStatus } from './content-ids';
import { deriveAreaSeed } from './combat-run';
import { DUNGEON_SEED, mulberry32 } from './dungeon-layout';
import { PURGE_QUEST_ID } from './quests';

/** Internal one-world teleport origin — not for quest/UI callers. */
const DUNGEON_ORIGIN = { x: 300, z: 300 } as const;

export type AreaKind = 'hub' | 'wilderness' | 'dungeon';
export type EnvironmentProfileId = 'cinderwatch-dusk' | 'ashen-wild' | 'slagdeep-ember';
export type MusicProfileId = 'camp' | 'den';
export type EncounterTableId = 'ashen-patrol' | 'slagdeep-den';

export type QuestRequirement = {
  readonly questId: QuestId;
  readonly statuses: readonly QuestStatus[];
};

export type AreaEntryPoint = {
  readonly id: string;
  /** World XZ — adapter hides dungeon origin from callers. */
  readonly pos: readonly [number, number];
};

export type AreaExitDef = {
  readonly id: AreaExitId;
  readonly from: AreaId;
  readonly to: AreaId;
  readonly entryId: string;
  readonly pad: readonly [number, number];
  readonly requiredQuestStates: readonly QuestRequirement[];
};

export type AuthoredSceneSource = {
  readonly kind: 'authored';
  readonly pack: string;
};

export type GeneratedAreaSource = {
  readonly kind: 'generated';
  readonly layoutSeed: number;
};

export type NavigationSource =
  | { readonly kind: 'camp-obstacles' }
  | { readonly kind: 'ashen-layout' }
  | { readonly kind: 'dungeon-grid' };

export interface AreaDef {
  readonly id: AreaId;
  readonly kind: AreaKind;
  readonly displayName: string;
  readonly displayNameEn: string;
  readonly source: AuthoredSceneSource | GeneratedAreaSource;
  readonly entryPoints: Readonly<Record<string, AreaEntryPoint>>;
  readonly exits: readonly AreaExitDef[];
  readonly requiredQuestStates: readonly QuestRequirement[];
  readonly encounters: EncounterTableId | null;
  readonly environment: EnvironmentProfileId;
  readonly navigation: NavigationSource;
  readonly music: MusicProfileId;
  /** Legacy main.ts area tag — camp/wild share one map. */
  readonly runtimeTag: 'camp' | 'wild' | 'den';
}

export type AreaTransition = {
  readonly areaId: AreaId;
  readonly entryId: string;
  readonly playerPos: readonly [number, number];
  readonly music: MusicProfileId;
  readonly environment: EnvironmentProfileId;
  readonly runtimeTag: 'camp' | 'wild' | 'den';
  readonly areaSeed: number;
};

export type AshenMarker = {
  readonly id: string;
  readonly pos: readonly [number, number];
  readonly kind?: string;
  readonly table?: string;
  readonly pool?: string;
};

export type AshenReachContent = {
  readonly landmarks: readonly AshenMarker[];
  readonly encounterMarkers: readonly AshenMarker[];
  readonly decorMarkers: readonly AshenMarker[];
};

/** Seeded encounter pick — never Math.random(). */
export type SeededEncounterPick = {
  readonly markerId: string;
  readonly kind: 'imp' | 'ashwalker' | 'charred';
  readonly pos: readonly [number, number];
};

export type SeededDecorPick = {
  readonly markerId: string;
  readonly decor: 'ash-pile' | 'slag-rock' | 'burnt-stump';
  readonly pos: readonly [number, number];
};

const CAVE_MOUTH: readonly [number, number] = [14, 24];
const CAMP_SPAWN: readonly [number, number] = [0, 5];
const WILD_NEAR_CAVE: readonly [number, number] = [11, 21];

const REACH_TO_SLAGDEEP: AreaExitDef = {
  id: 'reach-to-slagdeep',
  from: 'ashen-reach',
  to: 'slagdeep-hollow',
  entryId: 'den-entry',
  pad: CAVE_MOUTH,
  requiredQuestStates: [
    { questId: PURGE_QUEST_ID, statuses: ['active', 'ready', 'completed'] },
  ],
};

const SLAGDEEP_TO_REACH: AreaExitDef = {
  id: 'slagdeep-to-reach',
  from: 'slagdeep-hollow',
  to: 'ashen-reach',
  entryId: 'cave-mouth',
  pad: CAVE_MOUTH,
  requiredQuestStates: [],
};

const CINDERWATCH_TO_REACH: AreaExitDef = {
  id: 'cinderwatch-to-reach',
  from: 'cinderwatch',
  to: 'ashen-reach',
  entryId: 'camp-gate',
  pad: [0, 14],
  requiredQuestStates: [],
};

const REACH_TO_CINDERWATCH: AreaExitDef = {
  id: 'reach-to-cinderwatch',
  from: 'ashen-reach',
  to: 'cinderwatch',
  entryId: 'camp-center',
  pad: CAMP_SPAWN,
  requiredQuestStates: [],
};

const AREAS: Record<AreaId, AreaDef> = {
  cinderwatch: {
    id: 'cinderwatch',
    kind: 'hub',
    displayName: '余烬哨站',
    displayNameEn: 'Cinderwatch',
    source: { kind: 'authored', pack: 'rogue-encampment.pack.json' },
    entryPoints: {
      'camp-center': { id: 'camp-center', pos: CAMP_SPAWN },
    },
    exits: [CINDERWATCH_TO_REACH],
    requiredQuestStates: [],
    encounters: null,
    environment: 'cinderwatch-dusk',
    navigation: { kind: 'camp-obstacles' },
    music: 'camp',
    runtimeTag: 'camp',
  },
  'ashen-reach': {
    id: 'ashen-reach',
    kind: 'wilderness',
    displayName: '灰烬荒原',
    displayNameEn: 'Ashen Reach',
    source: { kind: 'authored', pack: 'ashen-reach.layout.json' },
    entryPoints: {
      'camp-gate': { id: 'camp-gate', pos: [0, 14] },
      'cave-mouth': { id: 'cave-mouth', pos: WILD_NEAR_CAVE },
    },
    exits: [REACH_TO_CINDERWATCH, REACH_TO_SLAGDEEP],
    requiredQuestStates: [],
    encounters: 'ashen-patrol',
    environment: 'ashen-wild',
    navigation: { kind: 'ashen-layout' },
    music: 'camp',
    runtimeTag: 'wild',
  },
  'slagdeep-hollow': {
    id: 'slagdeep-hollow',
    kind: 'dungeon',
    displayName: '熔渣深窟',
    displayNameEn: 'Slagdeep Hollow',
    // Layout seed matches baked pack; combat-run still derives a per-character
    // seed for encounter reset bookkeeping (Task 4.3).
    source: { kind: 'generated', layoutSeed: DUNGEON_SEED },
    entryPoints: {
      'den-entry': { id: 'den-entry', pos: [0, 0] }, // filled by resolveDenEntry
    },
    exits: [SLAGDEEP_TO_REACH],
    requiredQuestStates: [
      { questId: PURGE_QUEST_ID, statuses: ['active', 'ready', 'completed'] },
    ],
    encounters: 'slagdeep-den',
    environment: 'slagdeep-ember',
    navigation: { kind: 'dungeon-grid' },
    music: 'den',
    runtimeTag: 'den',
  },
};

export function getAreaDef(id: AreaId): AreaDef {
  const def = AREAS[id];
  if (!def) throw new Error(`Unknown area: ${id}`);
  return def;
}

export function listAreaDefs(): readonly AreaDef[] {
  return [AREAS.cinderwatch, AREAS['ashen-reach'], AREAS['slagdeep-hollow']];
}

export function getExitDef(id: AreaExitId): AreaExitDef | null {
  for (const area of listAreaDefs()) {
    const hit = area.exits.find((e) => e.id === id);
    if (hit) return hit;
  }
  return null;
}

export function canEnterArea(
  exit: AreaExitDef,
  quests: Readonly<Record<QuestId, QuestSave>>,
): boolean {
  const dest = getAreaDef(exit.to);
  const reqs = [...exit.requiredQuestStates, ...dest.requiredQuestStates];
  for (const req of reqs) {
    const st = quests[req.questId]?.status;
    if (!st || !req.statuses.includes(st)) return false;
  }
  return true;
}

/** Can the player use the Slagdeep cave mouth given quest status? */
export function canEnterSlagdeep(
  quests: Readonly<Record<QuestId, QuestSave>>,
): boolean {
  return canEnterArea(REACH_TO_SLAGDEEP, quests);
}

export type DenEntryResolver = {
  /** World-space den entry pad (includes dungeon origin internally). */
  entry: { x: number; z: number };
  exitPad: { x: number; z: number };
};

/**
 * Resolve a teleport into `id` via `entryId`. Dungeon origin stays inside this
 * adapter — callers pass logical entry ids only.
 */
export function enterArea(
  id: AreaId,
  entryId: string,
  opts: {
    characterId: string;
    den?: DenEntryResolver;
  },
): AreaTransition {
  const def = getAreaDef(id);
  let playerPos: readonly [number, number];
  if (id === 'slagdeep-hollow') {
    const den = opts.den;
    if (!den) throw new Error('enterArea(slagdeep-hollow) requires den resolver');
    playerPos = [den.entry.x, den.entry.z];
  } else {
    const ep = def.entryPoints[entryId];
    if (!ep) throw new Error(`Unknown entry "${entryId}" for area ${id}`);
    playerPos = ep.pos;
  }
  const areaSeed = deriveAreaSeed(opts.characterId, PURGE_QUEST_ID, id);
  return {
    areaId: id,
    entryId,
    playerPos,
    music: def.music,
    environment: def.environment,
    runtimeTag: def.runtimeTag,
    areaSeed,
  };
}

/** Exit pad world position for reach→slagdeep (authored cave mouth). */
export function slagdeepCaveMouth(): readonly [number, number] {
  return CAVE_MOUTH;
}

/** Internal: dungeon world origin — not for quest/UI callers. */
export function dungeonWorldOrigin(): { readonly x: number; readonly z: number } {
  return DUNGEON_ORIGIN;
}

export function slagdeepLayoutSeed(): number {
  return DUNGEON_SEED;
}

const ENCOUNTER_KINDS = ['imp', 'ashwalker', 'charred'] as const;
const DECOR_KINDS = ['ash-pile', 'slag-rock', 'burnt-stump'] as const;

/**
 * Deterministic encounter choices from authored markers + area seed.
 * Replaces ambient Math.random() in wilderness generation.
 */
export function chooseSeededEncounters(
  markers: readonly AshenMarker[],
  areaSeed: number,
): readonly SeededEncounterPick[] {
  const rnd = mulberry32(areaSeed ^ 0xe1c0);
  const out: SeededEncounterPick[] = [];
  for (const m of markers) {
    const kind = ENCOUNTER_KINDS[Math.floor(rnd() * ENCOUNTER_KINDS.length)]!;
    out.push({ markerId: m.id, kind, pos: m.pos });
  }
  return out;
}

export function chooseSeededDecor(
  markers: readonly AshenMarker[],
  areaSeed: number,
): readonly SeededDecorPick[] {
  const rnd = mulberry32(areaSeed ^ 0xd3c0);
  const out: SeededDecorPick[] = [];
  for (const m of markers) {
    const decor = DECOR_KINDS[Math.floor(rnd() * DECOR_KINDS.length)]!;
    out.push({ markerId: m.id, decor, pos: m.pos });
  }
  return out;
}

/** Seeded wild patrol spawn around the player (no Math.random). */
export function nextWildSpawn(
  areaSeed: number,
  tick: number,
  player: readonly [number, number],
  opts: {
    inCamp: (x: number, z: number) => boolean;
    walkable: (x: number, z: number) => boolean;
    inDungeon: (x: number, z: number) => boolean;
  },
): { kind: 'imp' | 'ashwalker' | 'charred'; x: number; z: number; nextDelay: number } | null {
  const rnd = mulberry32((areaSeed ^ Math.imul(tick, 0x9e3779b9)) >>> 0);
  const nextDelay = 2.2 + rnd() * 1.6;
  for (let tries = 0; tries < 8; tries++) {
    const ang = rnd() * Math.PI * 2;
    const r = 10 + rnd() * 5;
    const x = player[0] + Math.cos(ang) * r;
    const z = player[1] + Math.sin(ang) * r;
    if (opts.inCamp(x, z) || !opts.walkable(x, z) || opts.inDungeon(x, z)) continue;
    const roll = rnd();
    const kind = roll < 0.5 ? 'imp' : roll < 0.85 ? 'ashwalker' : 'charred';
    return { kind, x, z, nextDelay };
  }
  return null;
}

/** Advance wild-spawn timer with a seeded delay even when spawn fails. */
export function nextWildSpawnDelay(areaSeed: number, tick: number): number {
  const rnd = mulberry32((areaSeed ^ Math.imul(tick, 0x9e3779b9)) >>> 0);
  return 2.2 + rnd() * 1.6;
}
