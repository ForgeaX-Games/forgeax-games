/** Small deterministic PRNG owned by the spawn director. */
export interface Rng {
  readonly state: number;
  readonly next: () => number;
  readonly nextInt: (lo: number, hi: number) => number;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return {
    get state() {
      return state >>> 0;
    },
    next,
    nextInt: (lo, hi) => {
      const lower = Math.ceil(Math.min(lo, hi));
      const upper = Math.floor(Math.max(lo, hi));
      if (upper <= lower) return lower;
      return lower + Math.floor((upper - lower + 1) * next());
    },
  };
}
