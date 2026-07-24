// PR4a T2 — L1 world-policy table + freeze/invuln predicates.
// Assertions use literal flags (not alias tautologies against WORLD_POLICY_*).

import { describe, expect, test } from 'bun:test';
import { CinematicOwner } from './cinematic-owner';
import {
  BEAT_BOSS_DEFEAT,
  BEAT_BOSS_ENTRANCE,
  BEAT_CAMP_ARRIVAL,
  BEAT_FINISHER_FACE_CU,
  BEAT_FINISHER_HERO_SHOT,
  BEAT_QUEST_ACCEPTANCE,
  L1_WORLD_POLICY,
  policyForBeat,
  shouldFreezeAi,
  shouldPlayerBeInvulnerable,
} from './cinematic-policy';
import {
  createDodgeState,
  DODGE_BUILDUP_S,
  isDodgeInvulnerable,
  tickDodge,
  tryStartDodge,
} from './dodge';

const CAMP_FLAGS = {
  freezeAi: false,
  playerInvulnerable: false,
  playerInputLocked: true,
} as const;

const DEN_FLAGS = {
  freezeAi: true,
  playerInvulnerable: true,
  playerInputLocked: true,
} as const;

describe('L1 world-policy table', () => {
  test('camp beats: world running, no invuln, input locked', () => {
    for (const id of [BEAT_CAMP_ARRIVAL, BEAT_QUEST_ACCEPTANCE]) {
      expect(L1_WORLD_POLICY[id]).toEqual(CAMP_FLAGS);
      expect(policyForBeat(id)).toEqual(CAMP_FLAGS);
    }
  });

  test('Boss entrance / defeat + Hero Shot + face CU: freezeAi + invuln + input locked', () => {
    for (const id of [
      BEAT_BOSS_ENTRANCE,
      BEAT_BOSS_DEFEAT,
      BEAT_FINISHER_HERO_SHOT,
      BEAT_FINISHER_FACE_CU,
    ]) {
      expect(L1_WORLD_POLICY[id]).toEqual(DEN_FLAGS);
      expect(policyForBeat(id)).toEqual(DEN_FLAGS);
    }
  });

  test('unknown beat id falls back to den-safe policy', () => {
    expect(policyForBeat('unknown-beat')).toEqual(DEN_FLAGS);
  });

  test('policyForBeat returns a snapshot (caller mutation does not alias table)', () => {
    const p = policyForBeat(BEAT_CAMP_ARRIVAL);
    p.freezeAi = true;
    expect(L1_WORLD_POLICY[BEAT_CAMP_ARRIVAL]).toEqual(CAMP_FLAGS);
    expect(policyForBeat(BEAT_CAMP_ARRIVAL)).toEqual(CAMP_FLAGS);
  });
});

describe('shouldFreezeAi / shouldPlayerBeInvulnerable', () => {
  test('null policy → no cinematic invuln; dodge Movement i-frames still arm', () => {
    expect(shouldFreezeAi(null)).toBe(false);
    expect(shouldPlayerBeInvulnerable(null)).toBe(false);

    let s = tryStartDodge({
      state: createDodgeState(),
      x: 0,
      z: 0,
      dirX: 1,
      dirZ: 0,
    });
    const r = tickDodge({
      state: s,
      dt: DODGE_BUILDUP_S,
      x: 0,
      z: 0,
      walkable: () => true,
    });
    s = r.state;
    expect(isDodgeInvulnerable(s)).toBe(true);
    // onPlayerHit checks cinematic invuln first, then dodge — idle policy must
    // not swallow the dodge path.
    expect(shouldPlayerBeInvulnerable(null)).toBe(false);
  });

  test('owner acquire den → freeze+invuln; release clears so tick resumes', () => {
    const owner = new CinematicOwner();
    expect(shouldFreezeAi(owner)).toBe(false);
    expect(shouldPlayerBeInvulnerable(owner)).toBe(false);

    owner.acquire({
      beatId: BEAT_BOSS_ENTRANCE,
      policy: policyForBeat(BEAT_BOSS_ENTRANCE),
      channels: {},
    });
    expect(shouldFreezeAi(owner)).toBe(true);
    expect(shouldPlayerBeInvulnerable(owner)).toBe(true);
    // main.ts gate: `if (!shouldFreezeAi(...)) monsters.tick(...)`
    expect(!shouldFreezeAi(owner)).toBe(false);

    owner.release();
    expect(owner.policy).toBe(null);
    expect(shouldFreezeAi(owner)).toBe(false);
    expect(shouldPlayerBeInvulnerable(owner)).toBe(false);
    expect(!shouldFreezeAi(owner)).toBe(true); // tick resumes — no strand
  });

  test('camp policy on owner does not freeze AI or grant invuln', () => {
    const owner = new CinematicOwner();
    owner.acquire({
      beatId: BEAT_CAMP_ARRIVAL,
      policy: policyForBeat(BEAT_CAMP_ARRIVAL),
      channels: {},
    });
    expect(shouldFreezeAi(owner)).toBe(false);
    expect(shouldPlayerBeInvulnerable(owner)).toBe(false);
    expect(!shouldFreezeAi(owner)).toBe(true); // camp: monsters.tick keeps running
    owner.release();
  });
});
