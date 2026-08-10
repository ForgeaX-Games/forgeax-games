#!/usr/bin/env node
import { World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-scene';
import { Rotatable, stepRotatingTargets } from '../assets/plugins/rotating-target.ts';

const world = new World();
const entity = world.spawn(
  { component: Transform, data: { pos: [0, 0, 0], quat: [0, 0, 0, 1], scale: [1, 1, 1] } },
  { component: Rotatable, data: { speed: 0.3 } },
).unwrap();
const before = [...world.get(entity, Transform).unwrap().quat];
stepRotatingTargets(world, 1 / 60);
const after = [...world.get(entity, Transform).unwrap().quat];
const delta = Math.hypot(
  (after[0] ?? 0) - (before[0] ?? 0),
  (after[1] ?? 0) - (before[1] ?? 0),
  (after[2] ?? 0) - (before[2] ?? 0),
  (after[3] ?? 1) - (before[3] ?? 1),
);
if (!(delta > 0.0001)) throw new Error(`rotation did not advance: delta=${delta}`);
console.log(`[smoke-rotation] PASS delta=${delta.toFixed(6)} before=${JSON.stringify([...before])} after=${JSON.stringify([...after])}`);
