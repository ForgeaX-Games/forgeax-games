import { mulberry32, shuffleInPlace } from '../shared/ids';

/**
 * Reproducible random source for Host authority.
 * Match seed is broadcast once at match start so all clients can replay cosmetics.
 */
export class SeedService {
  readonly matchSeed: number;
  private rand: () => number;
  private stream = 0;

  constructor(matchSeed?: number) {
    this.matchSeed = (matchSeed ?? (Date.now() ^ (Math.random() * 0xffffffff))) >>> 0;
    this.rand = mulberry32(this.matchSeed);
  }

  /** Derive a child PRNG for a named stream (roles / minigame / vote dice). */
  fork(label: string): () => number {
    let h = this.matchSeed >>> 0;
    for (let i = 0; i < label.length; i++) {
      h = Math.imul(h ^ label.charCodeAt(i), 0x9e3779b1) >>> 0;
    }
    h = (h + (++this.stream) * 0x85ebca6b) >>> 0;
    return mulberry32(h);
  }

  next(): number {
    return this.rand();
  }

  nextInt(maxExclusive: number): number {
    return (this.rand() * maxExclusive) | 0;
  }

  shuffle<T>(items: T[]): T[] {
    return shuffleInPlace(items.slice(), this.rand);
  }

  pick<T>(items: readonly T[]): T {
    return items[this.nextInt(items.length)]!;
  }
}
