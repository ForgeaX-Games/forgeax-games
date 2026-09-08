import type { WeaponProfile } from '../../assets/lib/weapons/types.ts';
import { hitsShape } from './shapes.ts';

export interface TargetingInput {
  readonly enemyIds: readonly number[];
  readonly enemyXs: readonly number[];
  readonly enemyZs: readonly number[];
  readonly enemyHealth: readonly number[];
  readonly enemyRadius: number;
  readonly playerX: number;
  readonly playerZ: number;
  readonly playerFacing: number;
  readonly slots: readonly {
    readonly profile: WeaponProfile;
    readonly slotAngle: number;
    readonly ready: boolean;
  }[];
  readonly ringRadius: number;
}

export interface SlotAssignment {
  readonly slotIndex: number;
  readonly aimYaw: number;
  readonly hits: readonly number[];
}

const scratch = {
  candidates: [] as number[],
  reserved: new Set<number>(),
  pendingDamage: new Map<number, number>(),
  assignments: [] as SlotAssignment[],
  hitIds: [] as number[],
};

function distanceSquared(
  input: TargetingInput,
  index: number,
  weaponX: number,
  weaponZ: number,
): number {
  const dx = (input.enemyXs[index] ?? 0) - weaponX;
  const dz = (input.enemyZs[index] ?? 0) - weaponZ;
  return dx * dx + dz * dz;
}

function candidateInRange(
  input: TargetingInput,
  index: number,
  profile: WeaponProfile,
  weaponX: number,
  weaponZ: number,
): boolean {
  const distance = Math.sqrt(distanceSquared(input, index, weaponX, weaponZ));
  return distance <= profile.range + input.enemyRadius;
}

function betterCandidate(
  input: TargetingInput,
  nextIndex: number,
  currentIndex: number,
  weaponX: number,
  weaponZ: number,
): boolean {
  const nextDistance = distanceSquared(input, nextIndex, weaponX, weaponZ);
  const currentDistance = distanceSquared(input, currentIndex, weaponX, weaponZ);
  if (nextDistance !== currentDistance) return nextDistance < currentDistance;
  return (input.enemyIds[nextIndex] ?? 0) < (input.enemyIds[currentIndex] ?? 0);
}

function chooseTarget(
  input: TargetingInput,
  profile: WeaponProfile,
  weaponX: number,
  weaponZ: number,
  allowReserved: boolean,
): number {
  let bestIndex = -1;
  for (const index of scratch.candidates) {
    const id = input.enemyIds[index];
    if (id === undefined) continue;
    if (!allowReserved && scratch.reserved.has(id)) continue;
    if ((scratch.pendingDamage.get(id) ?? 0) >= (input.enemyHealth[index] ?? 0)) continue;
    if (!candidateInRange(input, index, profile, weaponX, weaponZ)) continue;
    if (bestIndex < 0 || betterCandidate(input, index, bestIndex, weaponX, weaponZ)) bestIndex = index;
  }
  return bestIndex;
}

/** Deterministic, three-layer target distribution for the two M2 weapon slots. */
export function assignTargets(input: TargetingInput): readonly SlotAssignment[] {
  scratch.candidates.length = 0;
  scratch.reserved.clear();
  scratch.pendingDamage.clear();
  scratch.assignments.length = 0;
  for (let index = 0; index < input.enemyIds.length; index += 1) scratch.candidates.push(index);

  for (let slotIndex = 0; slotIndex < input.slots.length; slotIndex += 1) {
    const slot = input.slots[slotIndex];
    if (slot === undefined || !slot.ready) continue;
    const weaponX = input.playerX + Math.sin(input.playerFacing + slot.slotAngle) * input.ringRadius;
    const weaponZ = input.playerZ + Math.cos(input.playerFacing + slot.slotAngle) * input.ringRadius;
    let bestIndex = chooseTarget(input, slot.profile, weaponX, weaponZ, false);
    if (bestIndex < 0) bestIndex = chooseTarget(input, slot.profile, weaponX, weaponZ, true);
    if (bestIndex < 0) {
      scratch.assignments.push({ slotIndex, aimYaw: 0, hits: [] });
      continue;
    }

    const bestX = input.enemyXs[bestIndex] ?? weaponX;
    const bestZ = input.enemyZs[bestIndex] ?? weaponZ + 1;
    const aimYaw = Math.atan2(bestX - weaponX, bestZ - weaponZ);
    const aimX = Math.sin(aimYaw);
    const aimZ = Math.cos(aimYaw);
    scratch.hitIds.length = 0;
    const hitCandidates = scratch.candidates.slice().sort((left, right) => {
      if (betterCandidate(input, left, right, weaponX, weaponZ)) return -1;
      if (betterCandidate(input, right, left, weaponX, weaponZ)) return 1;
      return 0;
    });
    for (const index of hitCandidates) {
      const id = input.enemyIds[index];
      if (id === undefined || (scratch.pendingDamage.get(id) ?? 0) >= (input.enemyHealth[index] ?? 0)) continue;
      if (!hitsShape(weaponX, weaponZ, aimX, aimZ, slot.profile, input.enemyXs[index] ?? 0, input.enemyZs[index] ?? 0, input.enemyRadius)) continue;
      scratch.hitIds.push(id);
      if (scratch.hitIds.length >= slot.profile.maxTargets) break;
    }
    const hits = scratch.hitIds.slice();
    for (const id of hits) {
      scratch.reserved.add(id);
      scratch.pendingDamage.set(id, (scratch.pendingDamage.get(id) ?? 0) + slot.profile.damage);
    }
    scratch.assignments.push({ slotIndex, aimYaw, hits });
  }
  return scratch.assignments.slice();
}
