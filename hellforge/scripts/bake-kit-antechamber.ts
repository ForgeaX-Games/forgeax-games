// bake-kit-antechamber.ts — team-authored modular Boss antechamber kit slice.
//
// Interim L4-compliant modules (opaque PBR + baked AO-in-albedo + normals +
// MikkTSpace tangents). Provenance marks source=hellforge-authored-modular and
// meshySwapEligible=true so Studio wb-ai-asset / Meshy can replace in place.
//
//   cd packages/games/hellforge
//   bun scripts/bake-kit-antechamber.ts
//   bun scripts/validate-kit.ts

import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO, VertexLayout } from '@gltf-transform/core';
import { tangents, unweld, weld } from '@gltf-transform/functions';
import { generateTangents } from 'mikktspace';

import {
  makeStoneAlbedoPng,
  makeStoneNormalPng,
  meshCorner,
  meshDoorframe,
  meshFloor,
  meshPillar,
  meshRubble,
  meshTrim,
  meshWall,
  packTexturedGlb,
  type MeshArrays,
  type Rgba,
} from './lib/kit-glb.ts';
import { cookKitMeta } from './lib/kit-meta.ts';

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const kitRoot = join(gameRoot, 'assets', 'kit');
const modulesDir = join(kitRoot, 'modules');

export type KitModuleDef = {
  id: string;
  intendedUse: string;
  mesh: () => MeshArrays;
  baseColorFactor: Rgba;
  metallic: number;
  roughness: number;
  seed: number;
};

export const KIT_MODULES: readonly KitModuleDef[] = [
  {
    id: 'kit-floor',
    intendedUse: 'Boss antechamber 2m floor tile',
    mesh: meshFloor,
    baseColorFactor: [0.95, 0.92, 0.9, 1],
    metallic: 0.02,
    roughness: 0.94,
    seed: 11,
  },
  {
    id: 'kit-wall',
    intendedUse: 'Boss antechamber 2m wall run',
    mesh: meshWall,
    baseColorFactor: [1, 0.96, 0.92, 1],
    metallic: 0.04,
    roughness: 0.9,
    seed: 22,
  },
  {
    id: 'kit-corner',
    intendedUse: 'Boss antechamber L-corner wall',
    mesh: meshCorner,
    baseColorFactor: [1, 0.95, 0.9, 1],
    metallic: 0.04,
    roughness: 0.9,
    seed: 33,
  },
  {
    id: 'kit-doorframe',
    intendedUse: 'Boss antechamber doorframe / portal trim',
    mesh: meshDoorframe,
    baseColorFactor: [0.9, 0.85, 0.8, 1],
    metallic: 0.08,
    roughness: 0.85,
    seed: 44,
  },
  {
    id: 'kit-pillar',
    intendedUse: 'Boss antechamber support pillar',
    mesh: meshPillar,
    baseColorFactor: [0.92, 0.88, 0.84, 1],
    metallic: 0.06,
    roughness: 0.88,
    seed: 55,
  },
  {
    id: 'kit-trim',
    intendedUse: 'Boss antechamber cornice / wall trim',
    mesh: meshTrim,
    baseColorFactor: [0.88, 0.82, 0.76, 1],
    metallic: 0.1,
    roughness: 0.8,
    seed: 66,
  },
  {
    id: 'kit-rubble',
    intendedUse: 'Boss antechamber rubble / floor decals',
    mesh: meshRubble,
    baseColorFactor: [0.85, 0.8, 0.78, 1],
    metallic: 0.03,
    roughness: 0.95,
    seed: 77,
  },
] as const;

export type ProvenanceModule = {
  id: string;
  path: string;
  sha256: string;
  source: 'hellforge-authored-modular' | 'wb-ai-asset/meshy';
  meshySwapEligible: boolean;
  license: string;
  attribution: string;
  intendedUse: string;
  provider: string | null;
  jobId: string | null;
  prompt: string | null;
  exportTime: string | null;
  notes: string;
};

export type ProvenanceDoc = {
  schemaVersion: 1;
  kit: 'boss-antechamber';
  updatedAt: string;
  materialFallback: 'L4';
  modules: ProvenanceModule[];
};

async function bakeTangentsInPlace(glbPath: string): Promise<void> {
  const io = new NodeIO();
  io.setVertexLayout(VertexLayout.SEPARATE);
  const doc = await io.read(glbPath);
  await doc.transform(unweld(), tangents({ generateTangents }), weld());
  await io.write(glbPath, doc);
}

function hasTangents(glb: Buffer): boolean {
  const jsonLen = glb.readUInt32LE(12);
  const json = JSON.parse(glb.subarray(20, 20 + jsonLen).toString('utf8')) as {
    meshes?: Array<{ primitives?: Array<{ attributes?: { TANGENT?: number } }> }>;
  };
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh.primitives ?? []) {
      if (p.attributes?.TANGENT === undefined) return false;
    }
  }
  return (json.meshes ?? []).length > 0;
}

async function main(): Promise<void> {
  mkdirSync(modulesDir, { recursive: true });
  const updatedAt = new Date().toISOString();
  const rows: ProvenanceModule[] = [];

  for (const def of KIT_MODULES) {
    const albedo = makeStoneAlbedoPng(128, def.seed);
    const normal = makeStoneNormalPng(128, def.seed + 1000);
    let glb = packTexturedGlb({
      name: def.id,
      mesh: def.mesh(),
      albedoPng: albedo,
      normalPng: normal,
      baseColorFactor: def.baseColorFactor,
      metallic: def.metallic,
      roughness: def.roughness,
    });

    const rel = `modules/${def.id}.glb`;
    const outPath = join(kitRoot, rel);
    writeFileSync(outPath, glb);
    await bakeTangentsInPlace(outPath);
    glb = Buffer.from(await Bun.file(outPath).arrayBuffer());
    if (!hasTangents(glb)) throw new Error(`${def.id}: missing TANGENT after bake`);

    const sha256 = createHash('sha256').update(glb).digest('hex');
    const contentHash = `sha256:${sha256}`;
    const meta = cookKitMeta(new Uint8Array(glb), contentHash, `${def.id}.glb`);
    if (!meta) throw new Error(`${def.id}: cookKitMeta failed`);
    writeFileSync(`${outPath}.meta.json`, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

    rows.push({
      id: def.id,
      path: rel,
      sha256,
      source: 'hellforge-authored-modular',
      meshySwapEligible: true,
      license: 'Apache-2.0',
      attribution: 'Hellforge team — procedural modular kit (interim)',
      intendedUse: def.intendedUse,
      provider: null,
      jobId: null,
      prompt: null,
      exportTime: null,
      notes:
        'Interim team-owned geometry + procedural stone textures under L4 fallback '
        + '(AO baked into albedo; opaque PBR; no MASK; no emissive textures; MikkTSpace tangents). '
        + 'Replace in place via wb-ai-asset → Meshy using ingest-kit-module.ts; do not invent job ids.',
    });
    console.log(`  wrote ${rel} (${(glb.length / 1024).toFixed(1)} KB) sha256=${sha256.slice(0, 12)}… TANGENT=ok`);
  }

  const provenance: ProvenanceDoc = {
    schemaVersion: 1,
    kit: 'boss-antechamber',
    updatedAt,
    materialFallback: 'L4',
    modules: rows,
  };
  writeFileSync(join(kitRoot, 'provenance.json'), `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');
  console.log(`bake-kit-antechamber done — ${rows.length} modules → assets/kit/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
