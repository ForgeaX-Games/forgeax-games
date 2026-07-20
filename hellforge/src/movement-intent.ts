// MovementIntent authority — click pathing and WASD share one reducer (Spec §5.3).
// InteractionRef uses stable content ids, never raw ECS entity handles.

import type { ActiveSkillId, AreaExitId, InteractionRef, NpcId } from './content-ids';
import { projectileCastRange, resolveSkill } from './skill-resolver';

export type MovementIntent =
  | { kind: 'none' }
  | { kind: 'point'; world: readonly [number, number] }
  | { kind: 'target'; target: InteractionRef }
  | { kind: 'vector'; x: number; z: number };

export type InteractionResult = 'ok' | 'failed' | 'consumed';

export type ResolvedInteraction = {
  position: readonly [number, number];
  interactionRange: number;
  valid: boolean;
  execute: () => InteractionResult;
};

export interface InteractionRegistry {
  resolve(ref: InteractionRef): ResolvedInteraction | null;
  /** Deterministic pick under a ground click (distance, then kind priority). */
  pickAt(world: readonly [number, number], radius: number): InteractionRef | null;
}

export type IntentCommand =
  | { op: 'set-point'; world: readonly [number, number] }
  | { op: 'set-target'; target: InteractionRef }
  | { op: 'set-vector'; x: number; z: number }
  | { op: 'clear' }
  | { op: 'release-vector' };

/** Kind priority when distances tie — lower wins. */
export const INTERACTION_KIND_PRIORITY: Record<InteractionRef['kind'], number> = {
  monster: 0,
  npc: 1,
  loot: 2,
  exit: 3,
};

export function reduceIntent(intent: MovementIntent, cmd: IntentCommand): MovementIntent {
  switch (cmd.op) {
    case 'set-point':
      return { kind: 'point', world: cmd.world };
    case 'set-target':
      return { kind: 'target', target: cmd.target };
    case 'set-vector':
      return { kind: 'vector', x: cmd.x, z: cmd.z };
    case 'clear':
      return { kind: 'none' };
    case 'release-vector':
      return intent.kind === 'vector' ? { kind: 'none' } : intent;
    default:
      return intent;
  }
}

/**
 * Advance target intent: clear stale refs; fire execute once in range.
 * Returns next intent + whether execute was invoked this tick.
 */
export function tickTargetIntent(
  intent: MovementIntent,
  player: readonly [number, number],
  registry: InteractionRegistry,
): { intent: MovementIntent; fired: boolean; result: InteractionResult | null } {
  if (intent.kind !== 'target') {
    return { intent, fired: false, result: null };
  }
  const resolved = registry.resolve(intent.target);
  if (!resolved || !resolved.valid) {
    return { intent: { kind: 'none' }, fired: false, result: null };
  }
  const dx = resolved.position[0] - player[0];
  const dz = resolved.position[1] - player[1];
  const dist = Math.hypot(dx, dz);
  if (dist > resolved.interactionRange) {
    return { intent, fired: false, result: null };
  }
  const result = resolved.execute();
  if (result === 'failed') {
    // Cooldown / mana — keep pursuing and retry.
    return { intent, fired: true, result };
  }
  return { intent: { kind: 'none' }, fired: true, result };
}

export function wasdVectorFromKeys(keys: Readonly<Record<string, boolean>>): { x: number; z: number } | null {
  const fwd =
    ((keys['KeyW'] || keys['ArrowUp']) ? 1 : 0) -
    ((keys['KeyS'] || keys['ArrowDown']) ? 1 : 0);
  const strafe =
    ((keys['KeyD'] || keys['ArrowRight']) ? 1 : 0) -
    ((keys['KeyA'] || keys['ArrowLeft']) ? 1 : 0);
  if (fwd === 0 && strafe === 0) return null;
  // ARPG axes: W = -Z, D = +X
  const x = strafe;
  const z = -fwd;
  const len = Math.hypot(x, z) || 1;
  // Avoid IEEE -0 from `(-0) / 1` so unit tests / reducers compare cleanly.
  const nx = x / len;
  const nz = z / len;
  return { x: nx === 0 ? 0 : nx, z: nz === 0 ? 0 : nz };
}

export type InteractionCandidate = {
  ref: InteractionRef;
  position: readonly [number, number];
  pickRadius: number;
};

/** Pick nearest candidate; ties break by INTERACTION_KIND_PRIORITY. */
export function pickInteractionAt(
  world: readonly [number, number],
  radius: number,
  candidates: readonly InteractionCandidate[],
): InteractionRef | null {
  let best: InteractionCandidate | null = null;
  let bestD2 = radius * radius;
  let bestPri = 99;
  for (const c of candidates) {
    const dx = c.position[0] - world[0];
    const dz = c.position[1] - world[1];
    const d2 = dx * dx + dz * dz;
    const r = Math.min(radius, c.pickRadius);
    if (d2 > r * r) continue;
    const pri = INTERACTION_KIND_PRIORITY[c.ref.kind];
    if (
      !best
      || d2 < bestD2 - 1e-9
      || (Math.abs(d2 - bestD2) <= 1e-9 && pri < bestPri)
    ) {
      best = c;
      bestD2 = d2;
      bestPri = pri;
    }
  }
  return best?.ref ?? null;
}

export interface InteractionRegistryDeps {
  getMonster: (id: string) => { x: number; z: number; radius: number } | null;
  getNpc: (id: NpcId) => { x: number; z: number } | null;
  getLoot: (id: string) => { x: number; z: number } | null;
  getExit: (id: AreaExitId) => { x: number; z: number } | null;
  listCandidates: () => readonly InteractionCandidate[];
  onMonsterInRange: (id: string) => InteractionResult;
  onNpcInteract: (id: NpcId) => InteractionResult;
  onLootInteract: (id: string) => InteractionResult;
  onExitInteract: (id: AreaExitId) => InteractionResult;
  /** Override frost pursuit range; defaults to Spec speed×lifetime. */
  frostCastRange?: number;
  npcRange?: number;
  lootRange?: number;
  exitRange?: number;
}

export function createInteractionRegistry(deps: InteractionRegistryDeps): InteractionRegistry {
  const frostRange = deps.frostCastRange
    ?? projectileCastRange(resolveSkill('frost'));
  const npcRange = deps.npcRange ?? 2.2;
  const lootRange = deps.lootRange ?? 1.2;
  const exitRange = deps.exitRange ?? 1.5;

  return {
    pickAt(world, radius) {
      return pickInteractionAt(world, radius, deps.listCandidates());
    },
    resolve(ref) {
      if (ref.kind === 'monster') {
        const m = deps.getMonster(ref.id);
        if (!m) return null;
        return {
          position: [m.x, m.z],
          interactionRange: frostRange,
          valid: true,
          execute: () => deps.onMonsterInRange(ref.id),
        };
      }
      if (ref.kind === 'npc') {
        const n = deps.getNpc(ref.id);
        if (!n) return null;
        return {
          position: [n.x, n.z],
          interactionRange: npcRange,
          valid: true,
          execute: () => deps.onNpcInteract(ref.id),
        };
      }
      if (ref.kind === 'loot') {
        const l = deps.getLoot(ref.id);
        if (!l) return null;
        return {
          position: [l.x, l.z],
          interactionRange: lootRange,
          valid: true,
          execute: () => deps.onLootInteract(ref.id),
        };
      }
      const e = deps.getExit(ref.id);
      if (!e) return null;
      return {
        position: [e.x, e.z],
        interactionRange: exitRange,
        valid: true,
        execute: () => deps.onExitInteract(ref.id),
      };
    },
  };
}

/** Frost is the LMB primary pursuit skill (Spec §5.3). */
export const LMB_PURSUIT_SKILL: ActiveSkillId = 'frost';
