/** Host-defined target profile carried through the shared Pack v2 GUID path. */
export const GAME_DEFAULT_TARGET_PROFILE_KIND = 'game-default-target-profile';
export const GAME_DEFAULT_TARGET_PROFILE_IMPORTER_KEY = GAME_DEFAULT_TARGET_PROFILE_KIND;
export const GAME_DEFAULT_TARGET_PROFILE_GUID = '019e2cc6-0c86-79da-aa76-b0984c86d461';

export type TargetProfile = {
  readonly kind: typeof GAME_DEFAULT_TARGET_PROFILE_KIND;
  readonly version: 1;
  readonly title: string;
  readonly scoreMultiplier: number;
  readonly baseColor: readonly [number, number, number, number];
};

export function isTargetProfile(value: unknown): value is TargetProfile {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  const color = record.baseColor;
  return record.kind === GAME_DEFAULT_TARGET_PROFILE_KIND
    && record.version === 1
    && typeof record.title === 'string'
    && record.title.length > 0
    && typeof record.scoreMultiplier === 'number'
    && Number.isFinite(record.scoreMultiplier)
    && record.scoreMultiplier > 0
    && Array.isArray(color)
    && color.length === 4
    && color.every((channel) => typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 1);
}
