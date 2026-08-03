/**
 * Animated boost-pad chevrons: soft bob + forward scroll (reads as "moving pads").
 */
import { Transform } from '@forgeax/engine-scene';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { LoadedScene } from './scene';

interface Arrow {
  entity: EntityHandle;
  baseZ: number;
  baseY: number;
  baseSx: number;
  baseSy: number;
  baseSz: number;
  phase: number;
}

interface PadFx {
  root: EntityHandle;
  baseY: number;
  arrows: Arrow[];
  phase: number;
}

export interface BoostPadFx {
  update(dt: number): void;
}

export function createBoostPadFx(world: World, scene: LoadedScene): BoostPadFx {
  const pads = new Map<number, PadFx>();

  for (const node of scene.nodes) {
    const name = (node.components.Name as { value?: string } | undefined)?.value;
    if (!name) continue;
    const rootMatch = /^BoostPadFx_(\d+)$/.exec(name);
    if (rootMatch) {
      const idx = Number(rootMatch[1]);
      const entity = scene.mapping.get(node.localId);
      if (entity === undefined) continue;
      const tf = node.components.Transform as { pos?: number[] } | undefined;
      pads.set(idx, {
        root: entity,
        baseY: tf?.pos?.[1] ?? 0.18,
        arrows: [],
        phase: idx * 0.37,
      });
      continue;
    }
    const arrowMatch = /^BoostPadFx_(\d+)_Arrow_(\d+)$/.exec(name);
    if (!arrowMatch) continue;
    const idx = Number(arrowMatch[1]);
    const entity = scene.mapping.get(node.localId);
    if (entity === undefined) continue;
    let pad = pads.get(idx);
    if (!pad) {
      pad = { root: entity, baseY: 0.18, arrows: [], phase: idx * 0.37 };
      pads.set(idx, pad);
    }
    const tf = node.components.Transform as
      | { pos?: number[]; scale?: number[] }
      | undefined;
    pad.arrows.push({
      entity,
      baseZ: tf?.pos?.[2] ?? 0,
      baseY: tf?.pos?.[1] ?? 0.02,
      baseSx: tf?.scale?.[0] ?? 1,
      baseSy: tf?.scale?.[1] ?? 0.08,
      baseSz: tf?.scale?.[2] ?? 0.55,
      phase: Number(arrowMatch[2]) * 0.55,
    });
  }

  let elapsed = 0;

  return {
    update(dt) {
      elapsed += Math.min(0.05, Math.max(0, dt));
      for (const pad of pads.values()) {
        const bob = Math.sin(elapsed * 3.2 + pad.phase) * 0.05;
        const root = world.get(pad.root, Transform);
        if (root.ok) {
          const pos = root.value.pos ?? [0, pad.baseY, 0];
          world.set(pad.root, Transform, {
            ...root.value,
            pos: [pos[0] ?? 0, pad.baseY + bob, pos[2] ?? 0],
          });
        }
        for (const arrow of pad.arrows) {
          // Scroll along local -Z (forward), wrap through a short band.
          const scroll = ((elapsed * 1.8 + arrow.phase) % 2.1) - 0.55;
          const pulse = 0.85 + 0.2 * Math.sin(elapsed * 6 + arrow.phase);
          const cur = world.get(arrow.entity, Transform);
          if (!cur.ok) continue;
          const pos = cur.value.pos ?? [0, arrow.baseY, arrow.baseZ];
          world.set(arrow.entity, Transform, {
            ...cur.value,
            pos: [pos[0] ?? 0, arrow.baseY, scroll],
            scale: [
              arrow.baseSx * pulse,
              arrow.baseSy * (0.9 + 0.25 * pulse),
              arrow.baseSz,
            ],
          });
        }
      }
    },
  };
}
