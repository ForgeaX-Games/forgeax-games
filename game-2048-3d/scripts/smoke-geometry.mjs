#!/usr/bin/env node
import { createCapsuleGeometry } from '@forgeax/engine-geometry';

const radius = 0.12;
const length = 0.32;
const result = createCapsuleGeometry(radius, length, 6, 12);
if (!result.ok) throw new Error(`capsule geometry failed: ${result.error.code}`);
const position = result.value.attributes.position;
const index = result.value.indices;
if (position.length < 3 * 12 || index.length < 3) {
  throw new Error(`capsule geometry is empty: vertices=${position.length / 3} indices=${index.length}`);
}
console.log(`[smoke-geometry] PASS vertices=${position.length / 3} triangles=${index.length / 3} radius=${radius} length=${length}`);
