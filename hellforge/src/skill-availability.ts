// Pure unlock gate for the active kit — no engine imports (unit-testable).

import type { SkillNodeId } from './content-ids';

export type ActiveKitSkillId = 'magma' | 'frost' | 'arc' | 'blink';

/** Active kit skill → skill-tree node that grants it when rank > 0. */
export const SKILL_NODE_BY_ACTIVE: Record<ActiveKitSkillId, SkillNodeId> = {
  magma: 'magma-bolt',
  frost: 'frost-fang',
  arc: 'arc-surge',
  blink: 'phase-step',
};

export interface SkillAvailabilityDef {
  id: ActiveKitSkillId;
  unlockLevel: number;
}

/**
 * Available only when the matching skill-tree node rank is > 0.
 * `unlockLevel` remains display metadata (legacy sheet text); it does not
 * grant cast rights. New Sorceress: frost-fang rank 1 → frost only.
 */
export function isSkillAvailable(
  def: SkillAvailabilityDef,
  _level: number,
  skillRanks: Readonly<Partial<Record<SkillNodeId, number>>>,
): boolean {
  return (skillRanks[SKILL_NODE_BY_ACTIVE[def.id]] ?? 0) > 0;
}
