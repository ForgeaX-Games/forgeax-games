export const BEACON_ORDER = ['Dawn', 'Gale', 'Aether'] as const;
export type BeaconId = typeof BEACON_ORDER[number];

export function requiredShards(beaconIndex: number): number {
  return [2, 4, 6][Math.max(0, Math.min(2, beaconIndex))]!;
}

export function canAttune(beaconIndex: number, activated: number, shards: number): boolean {
  return beaconIndex === activated && shards >= requiredShards(beaconIndex);
}

/** One short, actionable objective for the first-minute exploration loop. */
export function explorationObjective(activated: number, shards: number): string {
  const beacon = BEACON_ORDER[activated];
  if (beacon === undefined) return 'THE REACH IS RESTORED';
  const remaining = Math.max(0, requiredShards(activated) - shards);
  return remaining > 0
    ? `FIND ${remaining} ECHO SHARD${remaining === 1 ? '' : 'S'} FOR ${beacon.toUpperCase()}`
    : `FOLLOW THE LIGHT · ATTUNE ${beacon.toUpperCase()}`;
}

/** Compact, stable checkpoint wording shared by HUD and recovery feedback. */
export function checkpointLabel(checkpointId: string): string {
  return checkpointId === 'arrival' ? 'ARRIVAL' : `${checkpointId.toUpperCase()} BEACON`;
}

export function regionForPosition(z: number): string {
  if (z > 12) return 'FRACTURED SHORE';
  if (z > -9) return 'WIND-SCAR MONASTERY';
  if (z > -25) return 'STARFALL OBSERVATORY';
  return 'AETHER ALTAR';
}

export function normalizedAxes(forward: number, strafe: number): [number, number] {
  const length = Math.hypot(forward, strafe);
  return length > 1 ? [forward / length, strafe / length] : [forward, strafe];
}
