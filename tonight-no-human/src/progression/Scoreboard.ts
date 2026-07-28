import type { PlayerSlot, RoleAssignment } from '../shared/types';
import { ROLE_LABELS } from '../shared/config';
import type { Ghost } from './Ghost';

export interface MatchScore {
  aliveCount: number;
  personal: Array<{
    id: string;
    name: string;
    sugarCoat: number;
    role?: string;
    isGhost: boolean;
    mischief: number;
    title: string;
  }>;
  funLine: string;
}

export class Scoreboard {
  build(players: PlayerSlot[], roles: RoleAssignment | null, ghost: Ghost): MatchScore {
    const alive = players.filter((p) => !p.isGhost);
    const personal = players.map((p) => {
      const role = roles?.mapping[p.id];
      const title = p.isGhost
        ? '捣蛋幽灵'
        : p.sugarCoat >= 2
          ? '糖衣完好'
          : '险些被抓走';
      return {
        id: p.id,
        name: p.displayName,
        sugarCoat: p.sugarCoat,
        role: role ? ROLE_LABELS[role] : undefined,
        isGhost: p.isGhost,
        mischief: ghost.score(p.id),
        title,
      };
    });
    return {
      aliveCount: alive.length,
      personal,
      funLine: '谁把你做成这样？——坩埚不负责售后。',
    };
  }
}
