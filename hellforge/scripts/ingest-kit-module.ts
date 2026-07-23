// ingest-kit-module.ts — drop a Meshy / wb-ai-asset GLB into the kit layout.
//
// Normalizes export → assets/kit/modules/<id>.glb, bakes MikkTSpace tangents
// when normalTexture is present, rewrites .meta.json + provenance.json row.
//
//   cd packages/games/hellforge
//   bun scripts/ingest-kit-module.ts \
//     --id kit-wall \
//     --file /path/to/meshy-export.glb \
//     --job-id <real-meshy-job-id> \
//     --prompt "dark fantasy hell stone wall tile, URP opaque PBR" \
//     --provider meshy
//
// REQUIRED after a successful ingest (meta GUIDs change):
//   bun scripts/bake-antechamber.ts
//   bun scripts/validate-scene-pack.ts assets/scenes/boss-antechamber.pack.json --allow-missing-veyra
//   bun scripts/validate-kit.ts
// Without rebake, boss-antechamber.pack.json keeps stale mesh/material refs.
//
// Does NOT call Meshy. Never invent job ids — omit --job-id if unknown.

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO, VertexLayout } from '@gltf-transform/core';
import { tangents, unweld, weld } from '@gltf-transform/functions';
import { generateTangents } from 'mikktspace';

import { cookKitMeta } from './lib/kit-meta.ts';
import type { ProvenanceDoc, ProvenanceModule } from './bake-kit-antechamber.ts';

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const kitRoot = join(gameRoot, 'assets', 'kit');
const modulesDir = join(kitRoot, 'modules');
const provenancePath = join(kitRoot, 'provenance.json');

const KNOWN_IDS = new Set([
  'kit-floor', 'kit-wall', 'kit-corner', 'kit-doorframe',
  'kit-pillar', 'kit-trim', 'kit-rubble',
]);

function parseArgs(argv: string[]): {
  id: string;
  file: string;
  jobId: string | null;
  prompt: string | null;
  provider: string;
  dryRun: boolean;
} {
  let id = '';
  let file = '';
  let jobId: string | null = null;
  let prompt: string | null = null;
  let provider = 'meshy';
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--id') id = argv[++i] ?? '';
    else if (a === '--file') file = argv[++i] ?? '';
    else if (a === '--job-id') jobId = argv[++i] ?? null;
    else if (a === '--prompt') prompt = argv[++i] ?? null;
    else if (a === '--provider') provider = argv[++i] ?? 'meshy';
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--help' || a === '-h') {
      console.log(`Usage:
  bun scripts/ingest-kit-module.ts --id <kit-*> --file <export.glb> \\
    [--job-id <id>] [--prompt "..."] [--provider meshy] [--dry-run]
`);
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  if (!id || !file) throw new Error('--id and --file are required');
  if (!KNOWN_IDS.has(id)) throw new Error(`unknown kit id ${id}; expected one of ${[...KNOWN_IDS].join(', ')}`);
  if (!existsSync(file)) throw new Error(`file not found: ${file}`);
  return { id, file, jobId, prompt, provider, dryRun };
}

function glbNeedsTangents(path: string): boolean {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
    materials?: Array<{ normalTexture?: unknown }>;
    meshes?: Array<{ primitives?: Array<{ attributes?: { TANGENT?: number } }> }>;
  };
  const hasNormal = (json.materials ?? []).some((m) => m.normalTexture !== undefined);
  if (!hasNormal) return false;
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh.primitives ?? []) {
      if (p.attributes?.TANGENT === undefined) return true;
    }
  }
  return false;
}

async function bakeTangents(path: string): Promise<void> {
  const io = new NodeIO();
  io.setVertexLayout(VertexLayout.SEPARATE);
  const doc = await io.read(path);
  await doc.transform(unweld(), tangents({ generateTangents }), weld());
  await io.write(path, doc);
}

/** L4: strip emissive maps; keep opaque PBR (Track A importer gaps). */
async function normalizeL4Materials(path: string): Promise<boolean> {
  const io = new NodeIO();
  io.setVertexLayout(VertexLayout.SEPARATE);
  const doc = await io.read(path);
  let changed = false;
  for (const mat of doc.getRoot().listMaterials()) {
    if (mat.getEmissiveTexture()) {
      mat.setEmissiveTexture(null);
      changed = true;
    }
    if (mat.getAlphaMode() !== 'OPAQUE') {
      mat.setAlphaMode('OPAQUE');
      changed = true;
    }
  }
  if (changed) await io.write(path, doc);
  return changed;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const dest = join(modulesDir, `${args.id}.glb`);
  const rel = `modules/${args.id}.glb`;

  if (args.dryRun) {
    console.log(`dry-run: would copy ${args.file} → ${dest}`);
    console.log(`  jobId=${args.jobId ?? '(omit)'} provider=${args.provider}`);
    return;
  }

  copyFileSync(args.file, dest);
  if (await normalizeL4Materials(dest)) {
    console.log(`  L4 normalize: stripped emissiveTexture / forced OPAQUE on ${basename(dest)}`);
  }
  if (glbNeedsTangents(dest)) {
    console.log(`  baking tangents for ${basename(dest)}…`);
    await bakeTangents(dest);
  } else {
    console.log(`  tangents ok / no normalTexture — skip bake`);
  }

  const glb = readFileSync(dest);
  const sha256 = createHash('sha256').update(glb).digest('hex');
  const meta = cookKitMeta(new Uint8Array(glb), `sha256:${sha256}`, `${args.id}.glb`);
  if (!meta) throw new Error('cookKitMeta failed — is the GLB valid / non-Draco?');
  writeFileSync(`${dest}.meta.json`, `${JSON.stringify(meta, null, 2)}\n`, 'utf8');

  if (!existsSync(provenancePath)) {
    throw new Error('provenance.json missing — run bake-kit-antechamber.ts first');
  }
  const doc = JSON.parse(readFileSync(provenancePath, 'utf8')) as ProvenanceDoc;
  const exportTime = new Date().toISOString();
  const row: ProvenanceModule = {
    id: args.id,
    path: rel,
    sha256,
    source: 'wb-ai-asset/meshy',
    meshySwapEligible: false,
    license: 'Meshy commercial license (operator account) — record plan terms in PR',
    attribution: 'Hellforge team via ForgeaX Studio wb-ai-asset / Meshy',
    intendedUse: doc.modules.find((m) => m.id === args.id)?.intendedUse
      ?? `Boss antechamber module ${args.id}`,
    provider: args.provider,
    jobId: args.jobId,
    prompt: args.prompt,
    exportTime,
    notes: args.jobId
      ? `Ingested from ${basename(args.file)}; tangents normalized.`
      : `Ingested from ${basename(args.file)}; job id omitted (unknown). Do not invent ids.`,
  };
  const idx = doc.modules.findIndex((m) => m.id === args.id);
  if (idx >= 0) doc.modules[idx] = row;
  else doc.modules.push(row);
  doc.updatedAt = exportTime;
  writeFileSync(provenancePath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
  console.log(`ingest-kit-module: ${args.id} → ${rel} sha256=${sha256.slice(0, 12)}…`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
