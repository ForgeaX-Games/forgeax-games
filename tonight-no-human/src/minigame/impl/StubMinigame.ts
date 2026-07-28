import type { IMinigame, MinigameTags } from '../IMinigame';
import type { MatchContext } from '../../session/MatchContext';
import type { MinigameResult, PlayerInput } from '../../shared/types';
import { applyTypeRules, emptyResult } from '../rules/SettleRules';
import { GAME_CONFIG } from '../../shared/config';
import { minigameContentRoot } from '../../narrative/content/assetPath';

/** Placeholder minigame — auto-succeeds after a short timer for framework demo. */
export class StubMinigame implements IMinigame {
  readonly id: string;
  readonly tags: MinigameTags;
  /** content/minigames/<id> — reserved for future art/audio load */
  readonly contentRoot: string;
  private elapsed = 0;
  private readonly duration: number;
  private ctx: MatchContext | null = null;
  private done = false;

  constructor(id: string, tags: MinigameTags, durationSec = 8) {
    this.id = id;
    this.tags = tags;
    this.contentRoot = minigameContentRoot(id);
    this.duration = Math.min(durationSec, GAME_CONFIG.minigameHardCapSec);
  }

  async load(ctx: MatchContext): Promise<void> {
    this.ctx = ctx;
    this.elapsed = 0;
    this.done = false;
    // Future: fetch `${contentRoot}/level.json` etc.
  }

  start(_seed: number): void {
    this.elapsed = 0;
    this.done = false;
  }

  tick(dt: number, _inputs: PlayerInput[]): void {
    if (this.done) return;
    this.elapsed += dt;
    if (this.elapsed >= this.duration) this.done = true;
  }

  get finished(): boolean {
    return this.done;
  }

  get progress(): number {
    return Math.min(1, this.elapsed / this.duration);
  }

  settle(): MinigameResult {
    const ctx = this.ctx;
    if (!ctx) return emptyResult([]);
    const ids = ctx.room.players.map((p) => p.id);
    const success = true;
    const rankings = ids.slice();
    const sugarDelta = applyTypeRules(this.tags.type, ids, { success, rankings });
    return {
      rankings,
      survivors: ids,
      sugarDelta,
      titleEvents: [`stub_clear:${this.id}`],
    };
  }
}
