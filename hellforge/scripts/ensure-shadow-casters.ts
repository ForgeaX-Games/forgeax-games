#!/usr/bin/env bun
// Patch Forward-only material payloads in scene packs to include ShadowCaster.
// Runtime also injects for GUID-loaded prop materials (see src/ensure-shadow-casters.ts).
//
//   bun scripts/ensure-shadow-casters.ts [pack.json ...]

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SHADOW_CASTER_PASS = {
  name: 'ShadowCaster',
  program: { module: 'forgeax::default-shadow-caster' },
  renderState: { tags: { LightMode: 'ShadowCaster' }, queue: 2000 },
};

type Pass = {
  name?: string;
  program?: { module?: string };
  renderState?: { tags?: { LightMode?: string }; queue?: number; blend?: unknown };
};

function patchPasses(passes: Pass[]): boolean {
  if (!Array.isArray(passes) || passes.length === 0) return false;
  if (passes.some((p) => p.name === 'ShadowCaster' || p.renderState?.tags?.LightMode === 'ShadowCaster')) {
    return false;
  }
  if (passes.some((p) => typeof p.program?.module === 'string' && p.program.module.includes('skin'))) {
    return false;
  }
  if (passes.some((p) => (p.renderState?.queue ?? 0) >= 3000 || p.renderState?.blend !== undefined)) {
    return false;
  }
  if (!passes.some((p) => p.name === 'Forward' || p.renderState?.tags?.LightMode === 'Forward')) {
    return false;
  }
  passes.push({ ...SHADOW_CASTER_PASS });
  return true;
}

function patchPack(path: string): number {
  const pack = JSON.parse(readFileSync(path, 'utf8')) as {
    assets?: Array<{ kind?: string; payload?: { passes?: Pass[]; kind?: string } }>;
  };
  let n = 0;
  for (const a of pack.assets ?? []) {
    if (a.kind !== 'material') continue;
    const passes = a.payload?.passes;
    if (!passes) continue;
    if (patchPasses(passes)) n++;
  }
  if (n > 0) writeFileSync(path, `${JSON.stringify(pack)}\n`);
  return n;
}

const defaults = [
  'assets/scenes/rogue-encampment.pack.json',
  'assets/scenes/slagdeep-hollow.pack.json',
];
const roots = process.argv.slice(2);
const files = (roots.length > 0 ? roots : defaults).map((p) => resolve(import.meta.dir, '..', p));
let total = 0;
for (const f of files) {
  const n = patchPack(f);
  total += n;
  console.log(`${f.split('/').pop()}: patched ${n} material(s)`);
}
console.log(`done — ${total} materials now cast shadows`);
