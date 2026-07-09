/**
 * MarsCraft -> forgeax-engine — world checksum computer (Milestone M15 chunk 1)
 * =============================================================================
 * Adapts the Three.js source `web/network/ChecksumComputer.ts` to fingerprint the
 * forgeax ECS world instead of the original OO ECS. It is the DESYNC DETECTOR: it
 * hashes the sim-relevant state of every unit/building in a STABLE, deterministic
 * order (sorted by raw entity id) so the same world state always produces the same
 * checksum, and any divergence between two peers (or two replays) shows up as a
 * different number.
 *
 * ── Stable ordering (the determinism keystone) ───────────────────────────────
 * forgeax has no world-level entity enumeration outside a system tick, so we scan
 * a raw-id range via `world.get` (the same gen-0-handle trick `probeCombat` in
 * main.ts uses: an EntityHandle is (generation<<24)|index, so raw 0..N addresses
 * generation-0 handles — true for freshly-spawned, never-recycled entities). We
 * collect all live units, SORT by raw id, then hash. Sorting removes any
 * dependence on discovery/iteration order, which is what makes the hash a valid
 * cross-peer fingerprint.
 *
 * Sampled per entity (matches the source's fields, mapped to forgeax components):
 *   raw id, playerId (Faction), typeId hash (UnitType.category+combatType),
 *   quantized position (Transform), hp/maxHp/shield (Health), current command
 *   type. Finally the global sim RNG state + call-count are folded in.
 */

import type { World, EntityHandle } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-runtime';
import { Faction, Health, UnitType, commandCurrent, type CommandType } from '../components';
import { ChecksumBuilder, type ChecksumResult } from './checksum';
import { getGameRngState, getGameRngCallCount } from './seeded-random';

/** Default raw-id scan ceiling — matches the range probeCombat/probeAiUnits use. */
export const DEFAULT_SCAN_MAX = 8000;

const _builder = new ChecksumBuilder();

// Command-type -> small stable integer (charCodeAt of first char, like the
// source) so the command influences the hash without needing a string table.
function cmdTypeCode(t: CommandType | undefined): number {
  return t ? t.charCodeAt(0) : 0;
}

/**
 * Collect the raw ids of every live entity carrying a Transform, in a range
 * `[0, scanMax)`, sorted ascending. "Live" = `world.get(e, Transform).ok`
 * (the cheatsheet's liveness test; `world.isAlive` does not exist on World).
 */
export function collectStableEntityIds(world: World, scanMax = DEFAULT_SCAN_MAX): number[] {
  const ids: number[] = [];
  for (let raw = 0; raw < scanMax; raw++) {
    const eh = raw as unknown as EntityHandle;
    if (world.get(eh, Transform).ok) ids.push(raw);
  }
  // Already ascending from the scan, but sort explicitly to make the contract
  // (stable order regardless of how ids were gathered) self-evident.
  ids.sort((a, b) => a - b);
  return ids;
}

/**
 * Compute the deterministic checksum over the whole world.
 * @param world   the forgeax world
 * @param scanMax raw-id scan ceiling (default DEFAULT_SCAN_MAX)
 */
export function computeGameChecksum(world: World, scanMax = DEFAULT_SCAN_MAX): ChecksumResult {
  _builder.reset();

  const ids = collectStableEntityIds(world, scanMax);
  _builder.feedInt(ids.length);

  for (const raw of ids) {
    const eh = raw as unknown as EntityHandle;
    _builder.feedInt(raw);

    const tr = world.get(eh, Transform);
    if (tr.ok) {
      _builder.feedFloat(tr.value.pos[0]);
      _builder.feedFloat(tr.value.pos[1]);
      _builder.feedFloat(tr.value.pos[2]);
    }

    const health = world.get(eh, Health);
    if (health.ok) {
      _builder.feedFloat(health.value.hp);
      _builder.feedFloat(health.value.maxHp);
      _builder.feedFloat(health.value.shield);
      _builder.feedInt(health.value.isDead ? 1 : 0);
    }

    const ut = world.get(eh, UnitType);
    if (ut.ok) {
      // typeId string lives in a companion map; category+combatType are the
      // stable numeric identity carried on the component.
      _builder.feedInt(ut.value.category | 0);
      _builder.feedInt(ut.value.combatType | 0);
    }

    const faction = world.get(eh, Faction);
    if (faction.ok) {
      _builder.feedInt(faction.value.playerId | 0);
    }

    const cmd = commandCurrent.get(eh);
    _builder.feedInt(cmdTypeCode(cmd?.type));
  }

  const rngState = getGameRngState();
  const rngCallCount = getGameRngCallCount();
  _builder.feedInt(rngState);
  _builder.feedInt(rngCallCount);

  return {
    checksum: _builder.finalize(),
    entityCount: ids.length,
    rngState,
    rngCallCount,
  };
}
