import type { World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-scene';
import type { StreetAssets } from '../street';
import { loadModel, pose, type V } from './models';
export async function createCityLife(world: World, assets: StreetAssets) {
  const roots: {
    kind: string;
    model: Awaited<ReturnType<typeof loadModel>>;
    base: V;
    phase: number;
  }[] = [];
  const refuse: V[] = [
    [-3.55, 0.36, -4.6],
    [3.7, 0.36, -18.7],
    [4.1, 0.36, -35.5],
    [-12.8, 0.36, -47.3],
    [12, 0.36, -58.6],
    [30, 0.36, -60.2],
  ];
  for (const kind of ['crow', 'rat', 'roach'])
    for (let i = 0; i < (kind === 'roach' ? 12 : 6); i++) {
      const model = await loadModel(world, assets, kind);
      const base: V =
        kind === 'crow'
          ? [i < 3 ? 0 : 8, 9.2, -(12 + i * 7)]
          : [...refuse[i % 6]];
      roots.push({ kind, model, base, phase: i * 1.73 });
    }
  let next = 0;
  return {
    update(now: number, eye: V) {
      if (now < next) return;
      next = now + 1 / 30;
      for (const a of roots) {
        const fear = Math.hypot(eye[0] - a.base[0], eye[2] - a.base[2]) < 3;
        const t =
          now * (a.kind === 'crow' ? 0.5 : a.kind === 'rat' ? 1.1 : 1.8) +
          a.phase;
        let pos: V, angle: number;
        if (a.kind === 'crow') {
          pos = [
            a.base[0] + Math.cos(t) * 2.4,
            a.base[1] + Math.sin(t * 0.67) * 0.8,
            a.base[2] + Math.sin(t) * 3.2,
          ];
          angle = Math.atan2(Math.sin(t) * 2.4, -Math.cos(t) * 3.2);
          pose(
            world,
            a.model,
            'WING_L',
            [0, 0, 0],
            [0, 0, Math.sin(now * 9 + a.phase) * 0.55],
          );
          pose(
            world,
            a.model,
            'WING_R',
            [0, 0, 0],
            [0, 0, -Math.sin(now * 9 + a.phase) * 0.55],
          );
        } else {
          // Predictable narrow curb routes keep creatures out of doors and road collision.
          const radius = a.kind === 'rat' ? 0.55 : 0.22;
          pos = [
            a.base[0] + Math.sin(t) * radius,
            a.base[1],
            a.base[2] + Math.sin(t * 2) * radius * 0.4,
          ];
          angle = Math.atan2(-Math.cos(t), -Math.cos(t * 2) * 0.8);
          if (fear) pos[0] += Math.sign(a.base[0] - eye[0]) * 0.12;
        }
        world.set(a.model.root, Transform, {
          pos,
          quat: [
            0,
            Math.sin((angle + Math.PI) / 2),
            0,
            Math.cos((angle + Math.PI) / 2),
          ],
        });
      }
    },
    counts: { crows: 6, rats: 6, roaches: 12 },
  };
}
