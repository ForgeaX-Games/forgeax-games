/**
 * Runtime mystery-box pickups. Each authored ItemBox_* root can hide and
 * respawn independently.
 *
 * Hide by parking underground (not scale 0 alone) — ForgeaX + emissive/bloom
 * crates used to strobe when scale collapsed or emissive faced the camera.
 */
import { Transform } from '@forgeax/engine-scene';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { LoadedScene } from './scene';
import type { KartPose } from './kart-controller';

// Horizontal body overlap: kart + box half extents are wider than their centers.
const PICKUP_RADIUS = 2;
const RESPAWN_SECONDS = 5;
const BOX_SCALE: [number, number, number] = [1.25, 1.25, 1.25];
const HIDDEN_Y = -40;

interface BoxState {
  entity: EntityHandle;
  x: number;
  y: number;
  z: number;
  yaw: number;
  taken: boolean;
  respawn: number;
}

export interface ItemBoxes {
  update(
    dt: number,
    pose: KartPose,
    canReceive: boolean,
    onReceive: (box: { x: number; y: number; z: number }) => void,
  ): number;
  reset(): void;
}

export function createItemBoxes(world: World, scene: LoadedScene): ItemBoxes {
  const boxes: BoxState[] = [];

  for (const node of scene.nodes) {
    const name = (node.components.Name as { value?: string } | undefined)?.value;
    if (!name?.startsWith('ItemBox_')) continue;
    const entity = scene.mapping.get(node.localId);
    if (entity === undefined) continue;
    const tf = node.components.Transform as
      | { pos?: number[]; quat?: number[] }
      | undefined;
    if (!tf?.pos || tf.pos.length < 3) continue;
    const quat = tf.quat ?? [0, 0, 0, 1];
    boxes.push({
      entity,
      x: tf.pos[0]!,
      y: tf.pos[1]!,
      z: tf.pos[2]!,
      yaw: 2 * Math.atan2(quat[1] ?? 0, quat[3] ?? 1),
      taken: false,
      respawn: 0,
    });
  }

  const writeBox = (box: BoxState, visible: boolean): void => {
    const cur = world.get(box.entity, Transform);
    if (!cur.ok) return;
    if (!visible) {
      world.set(box.entity, Transform, {
        ...cur.value,
        pos: [box.x, HIDDEN_Y, box.z],
        scale: [0, 0, 0],
      });
      return;
    }
    // Keep crates static. Continuous yaw + bloom made the ? face strobe.
    world.set(box.entity, Transform, {
      ...cur.value,
      pos: [box.x, box.y, box.z],
      quat: [0, Math.sin(box.yaw * 0.5), 0, Math.cos(box.yaw * 0.5)],
      scale: BOX_SCALE,
    });
  };

  const reset = (): void => {
    for (const box of boxes) {
      box.taken = false;
      box.respawn = 0;
      writeBox(box, true);
    }
  };

  return {
    update(dt, pose, canReceive, onReceive) {
      let picked = 0;
      for (const box of boxes) {
        if (box.taken) {
          box.respawn -= dt;
          if (box.respawn <= 0) {
            box.taken = false;
            box.respawn = 0;
            writeBox(box, true);
          } else {
            writeBox(box, false);
          }
          continue;
        }

        writeBox(box, true);
        const dx = pose.x - box.x;
        const dz = pose.z - box.z;
        if (dx * dx + dz * dz >= PICKUP_RADIUS * PICKUP_RADIUS) continue;

        box.taken = true;
        box.respawn = RESPAWN_SECONDS;
        writeBox(box, false);
        picked++;
        if (canReceive) onReceive({ x: box.x, y: box.y + 0.6, z: box.z });
      }
      return picked;
    },
    reset,
  };
}
