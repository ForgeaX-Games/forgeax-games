// Hero definitions — one HeroDef per playable class, gluing together GLB
// asset GUIDs + stat-calc (classes.ts) + skill kit (skills.ts) behind a
// single `HEROES[id]` lookup. This is the SSOT for "what does picking hero X
// give you" — main.ts / state.ts / skills.ts all read through it instead of
// hardcoding one witch's data.
//
// CharSelect is fixed Emberwalker create (classId sorceress). Companion heroes
// stay narrative/preview data only — not selectable create cards.

import { computeBaseStats, getClassDef, type ClassId, type GrowthMods, type PlayerStatsInit } from './classes';
import { SKILLS, type SkillDef } from './skills';

/** Hero GLB clip slots — sorceress is 7-clip; stand-ins may still use `move`. */
export type HeroGltfClipName =
  | 'idle'
  | 'walk'
  | 'run'
  | 'move'
  | 'attack'
  | 'hit'
  | 'death'
  | 'dodge';

export interface HeroGltfClip {
  name: HeroGltfClipName;
  guid: string;
}

export interface HeroDef {
  id: ClassId;
  displayName: string;
  gltf: { scene: string; clips: HeroGltfClip[] };
  scale: number;
  baseStats: PlayerStatsInit;
  growth: GrowthMods;
  skills: SkillDef[];
}

function heroFrom(
  id: ClassId,
  gltf: HeroDef['gltf'],
  scale: number,
): HeroDef {
  const classDef = getClassDef(id);
  return {
    id,
    displayName: classDef.name,
    gltf,
    scale,
    baseStats: computeBaseStats(classDef),
    growth: classDef.growthMods,
    // Class-specific kits not split yet — shared elemental set for the slice.
    skills: SKILLS,
  };
}

// GUIDs mirror assets/characters/charactery-merged.glb.meta.json subAssets[].
// Clip sourceIndex order after 7-clip merge: idle/walk/run/attack/hit/death/dodge.
const sorceressGltf = {
  scene: '019f439f-a25e-7fd4-a8b4-595783b0359f',
  clips: [
    { name: 'idle' as const, guid: '019f439f-a25e-7fd4-a8b4-595b8b491fe9' },
    { name: 'walk' as const, guid: '019f439f-a25e-7fd4-a8b4-595c34224d6c' },
    { name: 'run' as const, guid: '019f439f-a25e-7fd4-a8b4-59601eb96021' },
    { name: 'attack' as const, guid: '019f439f-a25e-7fd4-a8b4-595d1fd0ce06' },
    { name: 'hit' as const, guid: '019f439f-a25e-7fd4-a8b4-595ef92b9f86' },
    { name: 'death' as const, guid: '019f439f-a25e-7fd4-a8b4-595f1eb96020' },
    { name: 'dodge' as const, guid: '019fa6b5-57cd-799f-8ccb-adc910739cbd' },
  ],
};

// Stand-in until characterd-merged — characterw-merged.glb (5-clip merge order).
const barbarianGltf = {
  scene: '019f41e5-1d62-78b4-81b6-8effb359372c',
  clips: [
    { name: 'idle' as const, guid: '019f41e5-1d62-78b4-81b6-8f039bda8de4' },
    { name: 'move' as const, guid: '019f41e5-1d62-78b4-81b6-8f04bb5542cd' },
    { name: 'attack' as const, guid: '019f41e5-1d62-78b4-81b6-8f058d93bc4f' },
    { name: 'hit' as const, guid: '019f41e5-1d62-78b4-81b6-8f066f46b331' },
    { name: 'death' as const, guid: '019f41e5-1d62-78b4-81b6-8f077d27f1a5' },
  ],
};

// Stand-in until charactern-merged — witch.glb (legacy 5-clip pack).
const necromancerGltf = {
  scene: '5e3028dd-ddf6-4104-86d9-318d3e8fb5a6',
  clips: [
    { name: 'idle' as const, guid: 'c530adf2-8de6-486a-afaa-9af3a6e6dfd1' },
    { name: 'move' as const, guid: 'f9355148-5ddc-45a4-80d4-ef80fce559b0' },
    { name: 'attack' as const, guid: '9bb05e7d-6156-424f-8a20-f80373507f65' },
    { name: 'hit' as const, guid: '7faedc58-49cd-4fc9-93b7-66eca1b79674' },
    { name: 'death' as const, guid: 'ca6e7f12-8e1a-4b3c-9d50-2a4f1b8c6d04' },
  ],
};

export const HEROES: Partial<Record<ClassId, HeroDef>> = {
  barbarian: heroFrom('barbarian', barbarianGltf, 1.3),
  sorceress: heroFrom('sorceress', sorceressGltf, 1.3),
  necromancer: heroFrom('necromancer', necromancerGltf, 1.15),
};

export const DEFAULT_HERO_ID: ClassId = 'sorceress';

export function getHeroDef(id: ClassId): HeroDef {
  const def = HEROES[id];
  if (!def) throw new Error(`No HeroDef for classId "${id}" — no hero GLB wired up yet.`);
  return def;
}

export function listSelectableHeroes(): HeroDef[] {
  return (['barbarian', 'sorceress', 'necromancer'] as const).map((id) => getHeroDef(id));
}
