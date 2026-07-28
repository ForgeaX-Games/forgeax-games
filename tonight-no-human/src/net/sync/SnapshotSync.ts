import { GAME_CONFIG } from '../../shared/config';
import type { NetHost } from '../NetHost';
import type { PlayerInput } from '../../shared/types';

/**
 * Snapshot sync ~20Hz + client prediction seam.
 * Host authorizes; clients interpolate. Stub stores last snapshot only.
 */
export class SnapshotSync {
  private frame = 0;
  private acc = 0;
  private readonly interval = 1 / GAME_CONFIG.snapshotHz;
  lastSnapshot: unknown = null;
  pendingInputs: PlayerInput[] = [];

  constructor(private net: NetHost) {}

  pushInput(input: PlayerInput): void {
    if (this.net.isHost) {
      this.pendingInputs.push(input);
    } else {
      this.net.send({ type: 'match.input', input });
    }
  }

  tick(dt: number, buildBody: () => unknown): void {
    if (!this.net.isHost) return;
    this.acc += dt;
    while (this.acc >= this.interval) {
      this.acc -= this.interval;
      this.frame += 1;
      const body = buildBody();
      this.lastSnapshot = body;
      this.net.broadcast({ type: 'match.snapshot', frame: this.frame, body });
      this.pendingInputs = [];
    }
  }
}
