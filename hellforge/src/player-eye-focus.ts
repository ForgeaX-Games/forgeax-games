// Player eye-focus marker for Face CU — resolve a head/face bone world
// position, then nudge toward the eyes (pure helpers; ECS wiring in main.ts).

/** Prefer face marker, then Head, then Mixamo / tip-of-head fallbacks. */
export const PLAYER_EYE_FOCUS_BONE_CANDIDATES = [
  'headfront',
  'Head',
  'mixamorig:Head',
  'head_end',
  'mixamorig:HeadTop_End',
] as const;

/** Column-major mat4 translation (Transform.world). */
export function translationFromWorldMat4(
  m: ArrayLike<number>,
): readonly [number, number, number] {
  return [Number(m[12] ?? 0), Number(m[13] ?? 0), Number(m[14] ?? 0)];
}

export type EyeBias = { readonly forward: number; readonly up: number };

/** Per-bone bias (meters at scale 1) from joint origin → eyes. */
export function eyeBiasForBone(boneName: string): EyeBias {
  const n = boneName.toLowerCase();
  if (n === 'headfront') return { forward: 0.02, up: 0.04 };
  if (n.includes('head_end') || n.includes('headtop')) {
    // Tip of skull — drop toward eyes, push slightly forward.
    return { forward: 0.06, up: -0.1 };
  }
  // Head / mixamorig:Head — joint is mid-skull; eyes sit forward + slightly up.
  return { forward: 0.1, up: 0.05 };
}

/**
 * Eye look-at from a head/face bone world position + player facing.
 * `playerScale` matches playerRig scale (sorceress default 1.3).
 */
export function eyeFocusFromHeadWorld(
  headWorld: readonly [number, number, number],
  faceXZ: readonly [number, number],
  playerScale: number,
  bias: EyeBias,
): readonly [number, number, number] {
  const fx = faceXZ[0] ?? 0;
  const fz = faceXZ[1] ?? -1;
  const len = Math.hypot(fx, fz);
  const nx = len > 1e-6 ? fx / len : 0;
  const nz = len > 1e-6 ? fz / len : -1;
  const s = playerScale > 1e-6 ? playerScale : 1;
  return [
    headWorld[0]! + nx * bias.forward * s,
    headWorld[1]! + bias.up * s,
    headWorld[2]! + nz * bias.forward * s,
  ];
}

/** Pick the best-ranked named entity from a SceneInstance.mapping. */
export function pickBestEyeFocusBone(
  named: ReadonlyArray<{ readonly ent: number; readonly name: string }>,
  candidates: readonly string[] = PLAYER_EYE_FOCUS_BONE_CANDIDATES,
): { readonly ent: number; readonly name: string } | null {
  const rank = new Map(candidates.map((n, i) => [n, i]));
  let best: { ent: number; name: string; rank: number } | null = null;
  for (const row of named) {
    const r = rank.get(row.name);
    if (r === undefined) continue;
    if (best === null || r < best.rank) {
      best = { ent: row.ent, name: row.name, rank: r };
      if (r === 0) break;
    }
  }
  return best ? { ent: best.ent, name: best.name } : null;
}
