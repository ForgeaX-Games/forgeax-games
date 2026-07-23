// validate-kit.ts — provenance rows ↔ on-disk kit modules + tangent contract
// + cheap check that boss-antechamber.pack.json refs resolve to kit metas
// (catches stale pack after Meshy/ingest GUID rewrites without rebake).
//
//   cd packages/games/hellforge
//   bun scripts/validate-kit.ts

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProvenanceDoc } from './bake-kit-antechamber.ts';

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const kitRoot = join(gameRoot, 'assets', 'kit');
const modulesDir = join(kitRoot, 'modules');
const provenancePath = join(kitRoot, 'provenance.json');
const antechamberPackPath = join(gameRoot, 'assets', 'scenes', 'boss-antechamber.pack.json');

const REQUIRED_IDS = [
  'kit-floor', 'kit-wall', 'kit-corner', 'kit-doorframe',
  'kit-pillar', 'kit-trim', 'kit-rubble',
] as const;

function inspectGlb(path: string): {
  hasNormalTexture: boolean;
  missingTangent: boolean;
  alphaMode: string | null;
  hasEmissiveTexture: boolean;
} {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
    materials?: Array<{
      alphaMode?: string;
      normalTexture?: unknown;
      emissiveTexture?: unknown;
    }>;
    meshes?: Array<{ primitives?: Array<{ attributes?: { TANGENT?: number } }> }>;
  };
  const mats = json.materials ?? [];
  const hasNormalTexture = mats.some((m) => m.normalTexture !== undefined);
  const hasEmissiveTexture = mats.some((m) => m.emissiveTexture !== undefined);
  const alphaMode = mats[0]?.alphaMode ?? null;
  let primCount = 0;
  let withTangent = 0;
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh.primitives ?? []) {
      primCount++;
      if (p.attributes?.TANGENT !== undefined) withTangent++;
    }
  }
  return {
    hasNormalTexture,
    missingTangent: hasNormalTexture && withTangent < primCount,
    alphaMode,
    hasEmissiveTexture,
  };
}

function main(): void {
  if (!existsSync(provenancePath)) {
    throw new Error(`missing ${provenancePath}`);
  }
  const doc = JSON.parse(readFileSync(provenancePath, 'utf8')) as ProvenanceDoc;
  if (doc.schemaVersion !== 1) throw new Error(`unsupported schemaVersion ${doc.schemaVersion}`);
  if (doc.kit !== 'boss-antechamber') throw new Error(`unexpected kit ${doc.kit}`);

  const byId = new Map(doc.modules.map((m) => [m.id, m]));
  const errors: string[] = [];

  for (const id of REQUIRED_IDS) {
    const row = byId.get(id);
    if (!row) {
      errors.push(`missing provenance row: ${id}`);
      continue;
    }
    const abs = join(kitRoot, row.path);
    if (!existsSync(abs)) {
      errors.push(`${id}: file missing at ${row.path}`);
      continue;
    }
    const bytes = readFileSync(abs);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== row.sha256) {
      errors.push(`${id}: sha256 mismatch (disk=${sha.slice(0, 12)}… manifest=${row.sha256.slice(0, 12)}…)`);
    }
    if (!existsSync(`${abs}.meta.json`)) {
      errors.push(`${id}: missing ${row.path}.meta.json`);
    }
    for (const field of ['license', 'attribution', 'intendedUse', 'source'] as const) {
      if (!row[field]) errors.push(`${id}: empty ${field}`);
    }
    if (row.source === 'wb-ai-asset/meshy' && row.jobId == null) {
      // Allowed but flagged — do not invent ids.
      console.warn(`  warn ${id}: Meshy source without jobId (honest omit OK)`);
    }
    if (row.source === 'hellforge-authored-modular' && row.jobId != null) {
      errors.push(`${id}: hellforge-authored row must not invent Meshy jobId`);
    }
    const g = inspectGlb(abs);
    if (g.hasEmissiveTexture) errors.push(`${id}: L4 forbid emissiveTexture`);
    if (g.alphaMode && g.alphaMode !== 'OPAQUE') {
      errors.push(`${id}: L4 requires OPAQUE (got ${g.alphaMode})`);
    }
    if (g.missingTangent) errors.push(`${id}: normalTexture present but TANGENT missing`);
    console.log(`  ok ${id}  source=${row.source}  TANGENT=${g.missingTangent ? 'MISSING' : 'ok'}`);
  }

  // Pack refs must resolve to current kit module GUIDs (rebake after ingest).
  if (!existsSync(antechamberPackPath)) {
    errors.push(`missing antechamber pack: ${antechamberPackPath}`);
  } else {
    const kitGuids = new Set<string>();
    for (const name of readdirSync(modulesDir)) {
      if (!name.endsWith('.glb.meta.json')) continue;
      const meta = JSON.parse(readFileSync(join(modulesDir, name), 'utf8')) as {
        subAssets?: Array<{ guid?: string }>;
      };
      for (const s of meta.subAssets ?? []) {
        if (typeof s.guid === 'string') kitGuids.add(s.guid);
      }
    }
    const pack = JSON.parse(readFileSync(antechamberPackPath, 'utf8')) as {
      assets?: Array<{ refs?: string[] }>;
    };
    const refs = pack.assets?.[0]?.refs ?? [];
    const orphan = refs.filter((g) => !kitGuids.has(g));
    if (orphan.length) {
      errors.push(
        `boss-antechamber.pack.json has ${orphan.length} ref(s) not in kit metas `
        + `(rebake with bake-antechamber.ts after ingest); e.g. ${orphan[0]}`,
      );
    } else {
      console.log(`  ok antechamber pack refs (${refs.length}) resolve to kit metas`);
    }
  }

  if (errors.length) {
    console.error('validate-kit FAILED:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`validate-kit OK — ${REQUIRED_IDS.length} modules`);
}

main();
