import { Time, Update, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-scene';
import { SPAWN } from '../config/spawn.ts';
import { SpawnMarker } from '../ecs/components.ts';
import { COMBAT_STATE_KEY, type CombatState } from './combat-system.ts';

export const MARKER_ANIM_SYSTEM_NAME = 'brotato-v2/marker-anim';

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutBack(value: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const t = value - 1;
  return 1 + c3 * t * t * t + c1 * t * t;
}

/** Animate warning markers without visibility toggles, so low FPS cannot skip flashes. */
export function installMarkerAnimSystem(world: World): () => void {
  world
    .addSystem(Update, {
      name: MARKER_ANIM_SYSTEM_NAME,
      queries: [{ write: [Transform, SpawnMarker] }],
      fn: (world, [markers]) => {
        const dt = Math.max(0, world.getResource(Time).delta);
        const combat = world.getResource<CombatState>(COMBAT_STATE_KEY);
        for (const row of markers) {
          const marker = row.mut(SpawnMarker);
          const transform = row.mut(Transform);
          if (combat.phase === 'defeated') {
            const fade = Math.max(0.35, 1 - dt * 4);
            transform.scale[0] *= fade;
            transform.scale[1] *= fade;
            transform.scale[2] *= fade;
            continue;
          }
          const u = clamp01(1 - marker.ttl / Math.max(Number.EPSILON, marker.total));
          const pop = Math.max(0.1, easeOutBack(clamp01(u / SPAWN.marker.popInSec)));
          const hz = SPAWN.marker.blinkStartHz + (SPAWN.marker.blinkEndHz - SPAWN.marker.blinkStartHz) * u;
          marker.blinkPhase += hz * dt;
          const blink = 0.92 + Math.abs(Math.sin(Math.PI * marker.blinkPhase)) * 0.18;
          const swell = 1 + SPAWN.marker.swellScale * Math.max(0, (u - SPAWN.marker.swellFrom) / (1 - SPAWN.marker.swellFrom));
          const scale = pop * blink * swell;
          transform.scale[0] = scale;
          transform.scale[1] = scale;
          transform.scale[2] = scale;
        }
      },
    })
    .unwrap();
  return () => {
    const result = world.removeSystem(Update, MARKER_ANIM_SYSTEM_NAME);
    if (!result.ok && result.error.code !== 'system-before-unknown') throw result.error;
  };
}
