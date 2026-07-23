// Pure unlock gate for the active kit — no engine imports (unit-testable).

import type { SkillNodeId } from './content-ids';
import { FINISHER_UNLOCK_LEVEL } from './finisher';

export type ActiveKitSkillId = 'magma' | 'frost' | 'arc' | 'blink' | 'inferno-nova';

/** Active kit skill → skill-tree node that grants it when rank > 0. */
export const SKILL_NODE_BY_ACTIVE: Readonly<Partial<Record<ActiveKitSkillId, SkillNodeId>>> = {
  magma: 'magma-bolt',
  frost: 'frost-fang',
  arc: 'arc-surge',
  blink: 'phase-step',
  // inferno-nova is level-granted (L5/L8), not tree-gated.
};

/** Level-granted actives (no skill-tree node). */
export const LEVEL_UNLOCK_ACTIVE: Readonly<Partial<Record<ActiveKitSkillId, number>>> = {
  'inferno-nova': FINISHER_UNLOCK_LEVEL,
};

export interface SkillAvailabilityDef {
  id: ActiveKitSkillId;
  unlockLevel: number;
}

/**
 * Tree-gated actives: matching skill-tree node rank > 0.
 * Level-gated actives (finisher): player level ≥ unlock.
 * `unlockLevel` on the def remains display metadata for tree skills.
 */
export function isSkillAvailable(
  def: SkillAvailabilityDef,
  level: number,
  skillRanks: Readonly<Partial<Record<SkillNodeId, number>>>,
): boolean {
  const levelUnlock = LEVEL_UNLOCK_ACTIVE[def.id];
  if (levelUnlock !== undefined) return level >= levelUnlock;
  const nodeId = SKILL_NODE_BY_ACTIVE[def.id];
  if (!nodeId) return false;
  return (skillRanks[nodeId] ?? 0) > 0;
}
