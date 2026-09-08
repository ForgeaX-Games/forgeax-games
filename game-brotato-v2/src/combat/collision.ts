export interface CollisionCircle {
  x: number;
  z: number;
  readonly radius: number;
}

function pushOut(body: CollisionCircle, other: CollisionCircle, fallbackX: number, fallbackZ: number): void {
  const dx = body.x - other.x;
  const dz = body.z - other.z;
  const distance = Math.hypot(dx, dz);
  const minimumDistance = Math.max(0, body.radius) + Math.max(0, other.radius);
  if (distance >= minimumDistance) return;

  const nx = distance > Number.EPSILON ? dx / distance : fallbackX;
  const nz = distance > Number.EPSILON ? dz / distance : fallbackZ;
  body.x = other.x + nx * minimumDistance;
  body.z = other.z + nz * minimumDistance;
}

/**
 * Resolve circular actor footprints in place. The player is a fixed blocker;
 * ordered enemy pairs push later bodies away when several enemies arrive on
 * the same fixed tick.
 */
export function resolveCircleOverlaps(
  bodies: CollisionCircle[],
  blocker: CollisionCircle,
  iterations: number,
): void {
  const passCount = Math.max(1, Math.floor(iterations));
  for (let pass = 0; pass < passCount; pass += 1) {
    for (const body of bodies) pushOut(body, blocker, 0, 1);
    for (let left = 0; left < bodies.length; left += 1) {
      const first = bodies[left];
      if (first === undefined) continue;
      for (let right = left + 1; right < bodies.length; right += 1) {
        const second = bodies[right];
        if (second === undefined) continue;
        pushOut(second, first, 1, 0);
      }
    }
  }
}
