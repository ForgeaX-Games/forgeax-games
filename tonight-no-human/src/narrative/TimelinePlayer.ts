/**
 * Shared narrative timeline clock — all clients play the master track in sync.
 * Private close-ups stay on PrivacyChannel.
 */
export class TimelinePlayer {
  playing = false;
  t = 0;
  duration = 0;
  narrativeId: string | null = null;

  load(narrativeId: string, durationSec: number): void {
    this.narrativeId = narrativeId;
    this.duration = durationSec;
    this.t = 0;
    this.playing = false;
  }

  start(): void {
    this.playing = true;
  }

  tick(dt: number): boolean {
    if (!this.playing) return false;
    this.t += dt;
    if (this.t >= this.duration) {
      this.playing = false;
      this.t = this.duration;
      return true; // finished
    }
    return false;
  }

  skip(): void {
    this.t = this.duration;
    this.playing = false;
  }

  get progress(): number {
    return this.duration <= 0 ? 1 : Math.min(1, this.t / this.duration);
  }
}
