import { GAME_CONFIG } from '../shared/config';
import type { PlayerId } from '../shared/types';
import type { RoomState } from '../session/RoomState';
import type { MinigameResult } from '../shared/types';
import { clampSugar } from '../minigame/rules/SettleRules';

export class SugarCoat {
  applyResult(room: RoomState, result: MinigameResult): PlayerId[] {
    const becameGhost: PlayerId[] = [];
    for (const p of room.players) {
      const d = result.sugarDelta[p.id] ?? 0;
      p.sugarCoat = clampSugar(p.sugarCoat + d);
      if (p.sugarCoat <= 0 && !p.isGhost) {
        p.isGhost = true;
        p.sugarCoat = 0;
        becameGhost.push(p.id);
      }
    }
    return becameGhost;
  }

  reset(room: RoomState): void {
    for (const p of room.players) {
      p.sugarCoat = GAME_CONFIG.sugarCoatStart;
      p.isGhost = false;
    }
  }
}
