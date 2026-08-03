/**
 * Cartoon puff / spark pool (VfxPuff_* spheres).
 * Soft envelopes + drag so exhaust / box bursts don't read as hard rubber balls.
 */
import { Transform } from '@forgeax/engine-scene';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { KartPose } from './kart-controller';
import type { LoadedScene } from './scene';
import { forwardNegZ } from './orientation';

interface Puff {
  entity: EntityHandle;
  age: number;
  ttl: number;
  vx: number;
  vy: number;
  vz: number;
  peak: number;
  grav: number;
  drag: number;
  active: boolean;
}

export interface RaceVfx {
  update(dt: number): void;
  updateExhaust(dt: number, pose: KartPose, boosting: boolean, racing: boolean): void;
  burstAt(x: number, y: number, z: number, kind?: 'smoke' | 'spark' | 'box'): void;
  boostPadAt(x: number, y: number, z: number): void;
  reset(): void;
}

/** Soft birth → hold → dissolve (no linear grow that looks like inflating balls). */
function softScale(u: number, peak: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 0;
  if (u < 0.2) {
    const t = u / 0.2;
    const s = t * t * (3 - 2 * t);
    return peak * 0.15 + peak * 0.85 * s;
  }
  const t = (u - 0.2) / 0.8;
  // Ease-out dissolve (matches original opacity 1 - u² feel via scale).
  return peak * (1 - t) * (1 - t) * (1 - t * 0.35);
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export function createRaceVfx(world: World, scene: LoadedScene): RaceVfx {
  const pool: Puff[] = [];
  for (const node of scene.nodes) {
    const name = (node.components.Name as { value?: string } | undefined)?.value;
    if (!name?.startsWith('VfxPuff_')) continue;
    const entity = scene.mapping.get(node.localId);
    if (entity === undefined) continue;
    pool.push({
      entity,
      age: 0,
      ttl: 1,
      vx: 0,
      vy: 0,
      vz: 0,
      peak: 0.4,
      grav: 0,
      drag: 1.8,
      active: false,
    });
    hide(world, entity);
  }

  let emitAcc = 0;
  let cursor = 0;

  const alloc = (): Puff | null => {
    if (pool.length === 0) return null;
    for (let n = 0; n < pool.length; n++) {
      const p = pool[cursor]!;
      cursor = (cursor + 1) % pool.length;
      if (!p.active) return p;
    }
    let best = pool[0]!;
    for (const p of pool) {
      if (p.age / p.ttl > best.age / best.ttl) best = p;
    }
    return best;
  };

  const spawn = (
    x: number,
    y: number,
    z: number,
    opts: {
      ttl: number;
      vx?: number;
      vy?: number;
      vz?: number;
      peak: number;
      grav?: number;
      drag?: number;
    },
  ): void => {
    const p = alloc();
    if (!p) return;
    p.active = true;
    p.age = 0;
    p.ttl = Math.max(0.05, opts.ttl);
    p.vx = opts.vx ?? 0;
    p.vy = opts.vy ?? 0;
    p.vz = opts.vz ?? 0;
    p.peak = opts.peak;
    p.grav = opts.grav ?? 0;
    p.drag = opts.drag ?? 2.2;
    const cur = world.get(p.entity, Transform);
    if (!cur.ok) return;
    const s = softScale(0.02, p.peak);
    world.set(p.entity, Transform, {
      ...cur.value,
      pos: [x, y, z],
      scale: [s, s, s],
    });
  };

  return {
    update(dt) {
      const d = Math.min(0.05, Math.max(0, dt));
      for (const p of pool) {
        if (!p.active) continue;
        p.age += d;
        if (p.age >= p.ttl) {
          p.active = false;
          hide(world, p.entity);
          continue;
        }
        // Air drag — kills the “shot out of a cannon” look.
        const damp = Math.exp(-p.drag * d);
        p.vx *= damp;
        p.vz *= damp;
        p.vy = p.vy * damp + p.grav * d;
        const u = p.age / p.ttl;
        const s = softScale(u, p.peak);
        const cur = world.get(p.entity, Transform);
        if (!cur.ok) continue;
        const pos = cur.value.pos ?? [0, 0, 0];
        world.set(p.entity, Transform, {
          ...cur.value,
          pos: [
            (pos[0] ?? 0) + p.vx * d,
            (pos[1] ?? 0) + p.vy * d,
            (pos[2] ?? 0) + p.vz * d,
          ],
          scale: [s, s, s],
        });
      }
    },

    updateExhaust(dt, pose, boosting, racing) {
      if (!racing) return;
      emitAcc += dt;
      // Higher cadence + smaller overlapping puffs = soft continuous plume.
      const interval = boosting ? 0.028 : 0.055;
      if (emitAcc < interval) return;
      emitAcc = 0;
      const fwd = forwardNegZ(pose.yaw);
      const back = 1.05 + Math.random() * 0.2;
      const side = (Math.random() - 0.5) * (boosting ? 0.45 : 0.28);
      const x = pose.x - fwd.x * back + fwd.z * side;
      const y = pose.y + 0.38 + Math.random() * 0.12;
      const z = pose.z - fwd.z * back - fwd.x * side;
      const n = boosting ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const push = boosting ? rand(0.9, 1.6) : rand(0.25, 0.7);
        spawn(
          x + rand(-0.12, 0.12),
          y + rand(-0.05, 0.1),
          z + rand(-0.12, 0.12),
          {
            ttl: boosting ? rand(0.45, 0.7) : rand(0.65, 0.95),
            vx: -fwd.x * push + rand(-0.35, 0.35),
            vy: rand(0.7, 1.35),
            vz: -fwd.z * push + rand(-0.35, 0.35),
            peak: boosting ? rand(0.32, 0.55) : rand(0.22, 0.38),
            grav: -0.15,
            drag: boosting ? 1.6 : 2.4,
          },
        );
      }
      if (boosting && Math.random() < 0.55) {
        // Tiny warm sparks tucked in the plume (reuse spark-colored pool slots).
        spawn(x, y, z, {
          ttl: rand(0.18, 0.32),
          vx: -fwd.x * rand(2.2, 3.4) + rand(-0.5, 0.5),
          vy: rand(0.4, 1.2),
          vz: -fwd.z * rand(2.2, 3.4) + rand(-0.5, 0.5),
          peak: rand(0.08, 0.14),
          grav: -6,
          drag: 3.5,
        });
      }
    },

    burstAt(x, y, z, kind = 'smoke') {
      if (kind === 'box') {
        // Soft white flash (grow then dissolve) — reads as “pop”.
        spawn(x, y + 0.15, z, {
          ttl: 0.32,
          vx: rand(-0.2, 0.2),
          vy: rand(0.4, 0.9),
          vz: rand(-0.2, 0.2),
          peak: 1.15,
          grav: 0,
          drag: 3,
        });
        spawn(x, y + 0.2, z, {
          ttl: 0.45,
          peak: 0.75,
          vy: 0.5,
          grav: 0,
          drag: 2.5,
        });
        // Colored shards: random cones, heavy drag + gravity (original boxBurst).
        for (let i = 0; i < 16; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = rand(1.2, 3.2);
          spawn(x + rand(-0.1, 0.1), y + rand(0.05, 0.25), z + rand(-0.1, 0.1), {
            ttl: rand(0.45, 0.75),
            vx: Math.cos(a) * sp,
            vy: rand(2.0, 4.2),
            vz: Math.sin(a) * sp,
            peak: rand(0.14, 0.28),
            grav: -9,
            drag: 1.1,
          });
        }
        return;
      }
      if (kind === 'spark') {
        for (let i = 0; i < 12; i++) {
          const a = Math.random() * Math.PI * 2;
          const sp = rand(2.5, 4.5);
          spawn(x, y, z, {
            ttl: rand(0.22, 0.4),
            vx: Math.cos(a) * sp,
            vy: rand(1.0, 2.8),
            vz: Math.sin(a) * sp,
            peak: rand(0.08, 0.16),
            grav: -8,
            drag: 2.8,
          });
        }
        return;
      }
      for (let i = 0; i < 8; i++) {
        spawn(x + rand(-0.2, 0.2), y, z + rand(-0.2, 0.2), {
          ttl: rand(0.5, 0.8),
          vx: rand(-0.8, 0.8),
          vy: rand(0.8, 1.5),
          vz: rand(-0.8, 0.8),
          peak: rand(0.3, 0.55),
          grav: -0.2,
          drag: 2.2,
        });
      }
    },

    boostPadAt(x, y, z) {
      spawn(x, y + 0.1, z, { ttl: 0.28, peak: 0.9, vy: 0.6, drag: 3 });
      for (let i = 0; i < 14; i++) {
        spawn(x + rand(-0.7, 0.7), y + 0.1, z + rand(-0.7, 0.7), {
          ttl: rand(0.28, 0.48),
          vx: rand(-2.2, 2.2),
          vy: rand(1.8, 4.0),
          vz: rand(-2.2, 2.2),
          peak: rand(0.08, 0.16),
          grav: -9,
          drag: 2.5,
        });
      }
      for (let i = 0; i < 6; i++) {
        spawn(x + rand(-0.3, 0.3), y + 0.15, z + rand(-0.3, 0.3), {
          ttl: rand(0.4, 0.65),
          vx: rand(-0.8, 0.8),
          vy: rand(0.6, 1.4),
          vz: rand(-0.8, 0.8),
          peak: rand(0.28, 0.48),
          grav: -0.3,
          drag: 2.2,
        });
      }
    },

    reset() {
      emitAcc = 0;
      for (const p of pool) {
        p.active = false;
        hide(world, p.entity);
      }
    },
  };
}

function hide(world: World, entity: EntityHandle): void {
  const cur = world.get(entity, Transform);
  if (!cur.ok) return;
  world.set(entity, Transform, {
    ...cur.value,
    pos: [0, -40, 0],
    scale: [0, 0, 0],
  });
}
