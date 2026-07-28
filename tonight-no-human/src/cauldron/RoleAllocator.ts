import type { CandyRole, PlayerId, RoleAssignment } from '../shared/types';
import type { SeedService } from '../session/SeedService';
import type { ClassifiedCast } from './AiClassifier';

const ALL_ROLES: CandyRole[] = ['soft', 'melt', 'hard', 'burst'];

/**
 * Force one-of-each candy role, then randomly assign to four players.
 * NOT "who cast what gets that role" — architecture §2.5 iron rule.
 */
export class RoleAllocator {
  allocate(playerIds: PlayerId[], _classified: ClassifiedCast[], seed: SeedService): RoleAssignment {
    const roles = seed.shuffle(ALL_ROLES);
    // If fewer than 4 players (demo 2–3), still assign distinct roles from the pool.
    const mapping: Record<PlayerId, CandyRole> = {};
    playerIds.forEach((id, i) => {
      mapping[id] = roles[i % roles.length]!;
    });
    // Conflict note: classified bias is intentionally ignored for final mapping
    // in Demo (only used for prop cosmetics later). Formal may weight rarity.
    return { mapping, seed: seed.matchSeed };
  }
}
