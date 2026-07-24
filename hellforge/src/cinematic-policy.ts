// PR4a T2 — Per-beat world policy (L1 table) + freeze/invuln predicates.
// Camp beats keep the world running; den beats freeze AI and arm invuln.
// Single freeze gate writer: CinematicOwner.policy (via seam); predicates only read.

import { FINISHER_FACE_CU_ID, FINISHER_HERO_SHOT_ID } from './cutscene';
import type { WorldPolicy } from './cinematic-owner';

/** Camp arrival — existing `camp-intro` cutscene id. */
export const BEAT_CAMP_ARRIVAL = 'camp-intro';
/** Quest acceptance (Veyra) — authored in T3. */
export const BEAT_QUEST_ACCEPTANCE = 'quest-acceptance';
/** Boss entrance — authored in T3. */
export const BEAT_BOSS_ENTRANCE = 'boss-entrance';
/** Boss defeat sting — authored in T3. */
export const BEAT_BOSS_DEFEAT = 'boss-defeat';
/** Finisher Hero Shot — den-safe (same freeze/invuln as Boss beats). */
export const BEAT_FINISHER_HERO_SHOT = FINISHER_HERO_SHOT_ID;
/** Finisher face CU (L4 Option A) — den-safe; additive after Hero Shot. */
export const BEAT_FINISHER_FACE_CU = FINISHER_FACE_CU_ID;

/** Camp / safe-space: world runs; input locked by cutscene chrome. */
export const WORLD_POLICY_CAMP: WorldPolicy = {
  freezeAi: false,
  playerInvulnerable: false,
  playerInputLocked: true,
};

/** Den / combat: freeze AI + player invulnerable + input locked. */
export const WORLD_POLICY_DEN: WorldPolicy = {
  freezeAi: true,
  playerInvulnerable: true,
  playerInputLocked: true,
};

/**
 * L1 per-beat world-policy table (plan §4).
 * Unknown beat ids fall back to den-safe via `policyForBeat`.
 */
export const L1_WORLD_POLICY: Readonly<Record<string, WorldPolicy>> = {
  [BEAT_CAMP_ARRIVAL]: WORLD_POLICY_CAMP,
  [BEAT_QUEST_ACCEPTANCE]: WORLD_POLICY_CAMP,
  [BEAT_BOSS_ENTRANCE]: WORLD_POLICY_DEN,
  [BEAT_BOSS_DEFEAT]: WORLD_POLICY_DEN,
  [BEAT_FINISHER_HERO_SHOT]: WORLD_POLICY_DEN,
  [BEAT_FINISHER_FACE_CU]: WORLD_POLICY_DEN,
};

/** Snapshot policy for a beat id (unknown → den-safe). */
export function policyForBeat(beatId: string): WorldPolicy {
  const found = L1_WORLD_POLICY[beatId];
  return { ...(found ?? WORLD_POLICY_DEN) };
}

type PolicySource =
  | WorldPolicy
  | { readonly policy: WorldPolicy | null }
  | null
  | undefined;

function resolvePolicy(source: PolicySource): WorldPolicy | null {
  if (source == null) return null;
  if ('freezeAi' in source) return source;
  return source.policy;
}

/** True when the active policy freezes monster AI (`monsters.tick` skip). */
export function shouldFreezeAi(source: PolicySource): boolean {
  return resolvePolicy(source)?.freezeAi === true;
}

/** True when the active policy grants player invulnerability. */
export function shouldPlayerBeInvulnerable(source: PolicySource): boolean {
  return resolvePolicy(source)?.playerInvulnerable === true;
}
