// Root-joint normalization for imported (gen3d / Meshy) animation clips.
// Engine-free: operates on the importer's clip payload shape
// `{ duration, channels: [{ targetId, property, sampler: { input, output } }] }`,
// where translation/scale outputs are xyz triples.
//
// `targetId` is an opaque hash, not a joint name, so the caller resolves which
// ids are the rig root through the instantiated scene (every mapping entity
// carries both `Name` and `AnimationTargetId`) — see
// `collectRootJointTargetIds` in `bind-skinned-animation.ts`.

/** Root joint of every rig we ship — Meshy short names plus generic `Root`. */
const ROOT_JOINT_RE = /Hips|Root/i;

/** True when a rig joint name is the root the bakes below hang off. */
export function isRootJointName(name: string): boolean {
  return ROOT_JOINT_RE.test(name);
}

interface RootChannel {
  readonly targetId?: string;
  readonly property?: string;
  readonly sampler?: { readonly output?: Float32Array };
}

/** Structural subset of the engine's `AnimationClip` this module mutates. */
export interface RootNormalizableClip {
  readonly channels?: readonly RootChannel[];
}

function rootTargetId(ch: RootChannel, rootTargetIds: ReadonlySet<string>): string | null {
  const id = ch.targetId;
  return id !== undefined && rootTargetIds.has(id) ? id : null;
}

/** A positive uniform scale held for the whole clip; null when animated or skewed. */
function constantUniformScale(out: Float32Array | undefined): number | null {
  if (out === undefined || out.length < 3) return null;
  const s = out[0]!;
  if (!(s > 0)) return null;
  for (let i = 0; i < out.length; i++) {
    if (Math.abs(out[i]! - s) > 1e-4) return null;
  }
  return s;
}

/**
 * Undo the two bakes Meshy motions arrive with, in place.
 *
 * 1. **Rig scale** — a motion authored on a uniformly scaled rig ships a constant
 *    `Hips.scale = s` with `Hips.translation` pre-multiplied by `s`
 *    (`Walking_Woman` carries s = 1.1765). Hips is the root joint, so `s`
 *    propagates down the whole skeleton and the character inflates for exactly
 *    as long as that clip plays. Restore it by dividing the translation back out
 *    and pinning the scale to 1.
 * 2. **Horizontal root motion** — some clips translate the root across the clip
 *    (`Roll_Dodge`: ~4 m of hips +Z; zombie `move`: 1.67 m). World position is
 *    ours to drive (`src/dodge.ts` steps the roll, the AI steps monsters), so the
 *    baked offset makes the actor travel twice and then snap back when the clip
 *    ends or loops. Pin the X/Z tracks to their first key, keeping Y — that is
 *    the gait bob / roll crouch.
 *
 * Idempotent: after one pass the scale is 1 and X/Z are already pinned, so
 * re-running on a cached shared payload is a no-op.
 */
export function normalizeClipRoot(
  clip: RootNormalizableClip,
  rootTargetIds: ReadonlySet<string>,
): void {
  const channels = clip.channels ?? [];

  const rigScale = new Map<string, number>();
  for (const ch of channels) {
    const id = rootTargetId(ch, rootTargetIds);
    if (id === null || ch.property !== 'scale') continue;
    const s = constantUniformScale(ch.sampler?.output);
    if (s !== null && s !== 1) rigScale.set(id, s);
  }

  for (const ch of channels) {
    const id = rootTargetId(ch, rootTargetIds);
    if (id === null) continue;
    const out = ch.sampler?.output;
    if (out === undefined) continue;
    const s = rigScale.get(id);
    if (ch.property === 'scale') {
      if (s !== undefined) out.fill(1);
      continue;
    }
    if (ch.property !== 'translation' || out.length < 3) continue;
    if (s !== undefined) {
      for (let i = 0; i < out.length; i++) out[i] = out[i]! / s;
    }
    const x0 = out[0]!;
    const z0 = out[2]!;
    for (let i = 0; i < out.length; i += 3) {
      out[i] = x0;
      out[i + 2] = z0;
    }
  }
}
