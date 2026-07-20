// Transient combat-run domain (Spec §9 / §12).
// Owns area, derived seed, and objective flags for one active dungeon run.
// Never serialized — reload/death re-derives seed and resets flags.

import type { AreaId, QuestId } from './content-ids';
import type { CharacterDomain } from './character-domain';
import { deepClone, deepFreeze, shouldFreezeSnapshots, type DeepReadonly } from './deep-readonly';
import { PURGE_QUEST_ID, questStatus } from './quests';

/** Structural camp return from death reset — avoids circular import with areas.ts. */
export type CampReturnTransition = {
  readonly areaId: AreaId;
  readonly entryId: string;
  readonly playerPos: readonly [number, number];
};

/**
 * Runtime HP/MP slice used by death reset — kept local so this module never
 * imports state.ts → heroes.ts → skills.ts (engine) in unit tests.
 */
export interface PlayerRuntimeState {
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  dead: boolean;
  hurtCooldown: number;
}

export type CombatObjectiveId = 'den-minions-cleared' | 'slagdeep-boss-defeated';

export const COMBAT_OBJECTIVE_IDS: readonly CombatObjectiveId[] = [
  'den-minions-cleared',
  'slagdeep-boss-defeated',
] as const;

export interface CombatRunSnapshot {
  readonly areaId: AreaId;
  readonly areaSeed: number;
  readonly objectives: Readonly<Record<CombatObjectiveId, boolean>>;
}

export type CombatRunCommand =
  | {
      op: 'enter';
      areaId: AreaId;
      characterId: string;
      questId?: QuestId;
    }
  | { op: 'mark-objective'; id: CombatObjectiveId }
  | { op: 'reset' };

export type CombatRunResult =
  | { ok: true }
  | { ok: false; reason: 'unknown-objective' };

export interface CombatRunDomain {
  dispatch(command: CombatRunCommand): CombatRunResult;
  snapshot(): DeepReadonly<CombatRunSnapshot>;
  /** True when both objectives are complete in this run. */
  objectivesMet(): boolean;
}

/** Fixed 32-bit FNV-1a over `characterId|questId|areaId`. */
export function deriveAreaSeed(
  characterId: string,
  questId: QuestId,
  areaId: AreaId,
): number {
  const input = `${characterId}|${questId}|${areaId}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function emptyObjectives(): Record<CombatObjectiveId, boolean> {
  return {
    'den-minions-cleared': false,
    'slagdeep-boss-defeated': false,
  };
}

class CombatRunDomainImpl implements CombatRunDomain {
  #areaId: AreaId;
  #areaSeed: number;
  #objectives: Record<CombatObjectiveId, boolean>;

  constructor(areaId: AreaId = 'cinderwatch', areaSeed = 0) {
    this.#areaId = areaId;
    this.#areaSeed = areaSeed >>> 0;
    this.#objectives = emptyObjectives();
  }

  dispatch(command: CombatRunCommand): CombatRunResult {
    switch (command.op) {
      case 'enter': {
        const questId = command.questId ?? PURGE_QUEST_ID;
        this.#areaId = command.areaId;
        this.#areaSeed = deriveAreaSeed(command.characterId, questId, command.areaId);
        this.#objectives = emptyObjectives();
        return { ok: true };
      }
      case 'mark-objective': {
        if (!(command.id in this.#objectives)) {
          return { ok: false, reason: 'unknown-objective' };
        }
        this.#objectives = { ...this.#objectives, [command.id]: true };
        return { ok: true };
      }
      case 'reset': {
        // Clear both flags; preserve area + derived seed (Spec §9 / Task 4.1).
        this.#objectives = emptyObjectives();
        return { ok: true };
      }
      default: {
        const _e: never = command;
        return _e;
      }
    }
  }

  objectivesMet(): boolean {
    return COMBAT_OBJECTIVE_IDS.every((id) => this.#objectives[id]);
  }

  snapshot(): DeepReadonly<CombatRunSnapshot> {
    const raw: CombatRunSnapshot = {
      areaId: this.#areaId,
      areaSeed: this.#areaSeed,
      objectives: { ...this.#objectives },
    };
    const detached = deepClone(raw);
    return (shouldFreezeSnapshots() ? deepFreeze(detached) : detached) as DeepReadonly<CombatRunSnapshot>;
  }
}

export function createCombatRunDomain(
  areaId: AreaId = 'cinderwatch',
  areaSeed = 0,
): CombatRunDomain {
  return new CombatRunDomainImpl(areaId, areaSeed);
}

export interface EncounterReset {
  clear(): void;
  reset(areaId: AreaId, seed: number): void;
}

export interface CombatTransientResetters {
  encounters: EncounterReset;
  enemyAttacks: { clear(): void };
  playerSkills: { clearProjectilesAndCooldowns(): void };
  loot: { clearGroundDrops(): void };
  fx: { clearTransient(): void };
}

/**
 * Death / failed-run orchestration (Spec §12).
 * Preserves CharacterDomain progression; clears transients; rebuilds encounters
 * from the derived area seed; returns the player to Cinderwatch at full HP/MP.
 */
export function resetCombatRun(input: {
  failedAreaId: AreaId;
  character: CharacterDomain;
  run: CombatRunDomain;
  runtime: PlayerRuntimeState;
  resetters: CombatTransientResetters;
  returnToCamp: () => CampReturnTransition;
}): DeepReadonly<CombatRunSnapshot> {
  const status = questStatus(input.character);
  // Objective flags only reset while the quest is still active.
  if (status === 'active') {
    input.run.dispatch({ op: 'reset' });
  }

  input.resetters.encounters.clear();
  input.resetters.enemyAttacks.clear();
  input.resetters.playerSkills.clearProjectilesAndCooldowns();
  input.resetters.loot.clearGroundDrops();
  input.resetters.fx.clearTransient();

  const seed = input.run.snapshot().areaSeed;
  input.resetters.encounters.reset(input.failedAreaId, seed);

  input.returnToCamp();
  // Spec §12: full HP/MP at camp; no XP penalty (caller must not toll XP).
  input.runtime.dead = false;
  input.runtime.hp = input.runtime.maxHp;
  input.runtime.mana = input.runtime.maxMana;
  input.runtime.hurtCooldown = 1.5;

  return input.run.snapshot();
}
