import type { PlayerId } from '../shared/types';

/** Ghost mischief score + limited abilities stub. */
export class Ghost {
  mischief: Record<PlayerId, number> = {};

  onBecomeGhost(id: PlayerId): void {
    this.mischief[id] = this.mischief[id] ?? 0;
  }

  addMischief(id: PlayerId, points: number): void {
    this.mischief[id] = (this.mischief[id] ?? 0) + points;
  }

  score(id: PlayerId): number {
    return this.mischief[id] ?? 0;
  }
}
