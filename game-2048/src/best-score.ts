export const BEST_SCORE_KEY = 'forgeax.game-2048.best-score.v1';

export interface BestScoreStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readBestScore(storage: BestScoreStorage | undefined): number {
  if (!storage) return 0;
  try {
    const parsed = Number(storage.getItem(BEST_SCORE_KEY));
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function persistBestScore(storage: BestScoreStorage | undefined, score: number): void {
  if (!storage || !Number.isSafeInteger(score) || score < 0) return;
  try { storage.setItem(BEST_SCORE_KEY, String(score)); } catch { /* private or quota-limited storage */ }
}
