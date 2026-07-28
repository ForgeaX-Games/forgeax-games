import type { PlayerId } from '../shared/types';
import type { NetHost } from '../net/NetHost';
import { TimelinePlayer } from './TimelinePlayer';
import { VoteSystem } from './VoteSystem';
import { DmPresenter } from './DmPresenter';
import { requireNarrativeScript } from './content/NarrativeCatalog';
import { contentExists, resolveContentUrl } from './content/assetPath';
import type { NarrativeBeat, NarrativeScript } from './content/types';
import type { SeedService } from '../session/SeedService';

export type NarrativeDirectorHooks = {
  onBeat?: (beat: NarrativeBeat, script: NarrativeScript) => void;
  onAssetMissing?: (path: string) => void;
};

/**
 * Loads a NarrativeScript into TimelinePlayer + optional vote/clue side effects.
 * AppShell should call play()/tick() instead of hardcoding durations.
 */
export class NarrativeDirector {
  script: NarrativeScript | null = null;
  masterUrl: string | null = null;
  private firedBeats = new Set<string>();
  private voteStarted = new Set<string>();
  private hooks: NarrativeDirectorHooks;

  constructor(
    readonly timeline: TimelinePlayer,
    readonly votes: VoteSystem,
    readonly dm: DmPresenter,
    hooks: NarrativeDirectorHooks = {},
  ) {
    this.hooks = hooks;
  }

  async play(scriptId: string): Promise<NarrativeScript> {
    const script = requireNarrativeScript(scriptId);
    this.script = script;
    this.firedBeats.clear();
    this.voteStarted.clear();
    this.timeline.load(script.id, script.durationSec);
    this.masterUrl = script.assets.master
      ? resolveContentUrl(script.assets.master.path)
      : null;

    // Prefetch / existence check (non-blocking for missing Demo assets).
    const paths = [
      script.assets.master?.path,
      script.assets.dmPortrait?.path,
      ...(script.assets.privateStills?.map((a) => a.path) ?? []),
    ].filter((p): p is string => !!p);
    for (const p of paths) {
      void contentExists(p).then((ok) => {
        if (!ok) {
          console.info(`[narrative] asset-missing: ${p}`);
          this.hooks.onAssetMissing?.(p);
        }
      });
    }

    this.timeline.start();
    return script;
  }

  /** Host: distribute script.clues 1:1 to player seats via directed net. */
  distributeClues(net: NetHost, playerIds: PlayerId[]): void {
    const script = this.script;
    if (!script || script.clues.length === 0) return;
    const n = Math.min(script.clues.length, playerIds.length);
    for (let i = 0; i < n; i++) {
      const clue = script.clues[i]!;
      const target = playerIds[i]!;
      net.send(
        {
          type: 'privacy.clue',
          clue: {
            clueId: clue.clueId,
            targetPlayerId: target,
            body: clue.body,
          },
        },
        { to: target },
      );
    }
  }

  /**
   * Advance timeline; fire beats / open votes.
   * @returns true when script finished
   */
  tick(dt: number, seed: SeedService, nowMs: number): boolean {
    const script = this.script;
    if (!script) return true;
    const finished = this.timeline.tick(dt);
    const t = this.timeline.t;

    for (const beat of script.beats) {
      if (t >= beat.atSec && !this.firedBeats.has(beat.id)) {
        this.firedBeats.add(beat.id);
        this.hooks.onBeat?.(beat, script);
      }
    }

    for (const vote of script.votes ?? []) {
      if (t >= vote.openAtSec && !this.voteStarted.has(vote.id) && !this.votes.open) {
        this.voteStarted.add(vote.id);
        this.votes.begin(
          vote.options.map((o) => o.id),
          nowMs + vote.durationSec * 1000,
        );
      }
      if (
        this.votes.open &&
        this.voteStarted.has(vote.id) &&
        nowMs >= this.votes.deadlineMs
      ) {
        this.votes.close(seed);
      }
    }

    return finished;
  }

  skip(): void {
    this.timeline.skip();
  }

  /** Client mirror of Host timeline (from match.sync). */
  applyRemote(scriptId: string, t: number, playing: boolean): void {
    if (this.script?.id !== scriptId) {
      const script = requireNarrativeScript(scriptId);
      this.script = script;
      this.firedBeats.clear();
      this.voteStarted.clear();
      this.timeline.load(script.id, script.durationSec);
      this.masterUrl = script.assets.master
        ? resolveContentUrl(script.assets.master.path)
        : null;
    }
    this.timeline.t = t;
    this.timeline.playing = playing;
    if (t >= this.timeline.duration) {
      this.timeline.playing = false;
      this.timeline.t = this.timeline.duration;
    }
  }

  currentLine(): string {
    const script = this.script;
    if (!script) return '';
    let line = script.title;
    for (const beat of script.beats) {
      if (this.timeline.t >= beat.atSec && beat.text) line = beat.text;
    }
    return line;
  }
}
