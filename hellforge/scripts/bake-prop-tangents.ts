// bake-prop-tangents.ts — write MikkTSpace TANGENT accessors into prop GLBs
// that have normalTexture but no tangents (engine otherwise fills fixed
// (1,0,0,1) and normal mapping looks flat).
//
// Run from hellforge game root (deps live in packages/games: gltf-transform + mikktspace):
//   cd packages/games && bun install
//   cd hellforge
//   bun scripts/bake-prop-tangents.ts --file prop-hut-wall.glb
//   bun scripts/bake-prop-tangents.ts --active-scenes
//   bun scripts/bake-prop-tangents.ts --active-scenes --dry-run
//
// Writes with VertexLayout.SEPARATE — the engine glTF loader rejects
// interleaved bufferViews with byteStride (see merge-gen3d-motions.ts).
// meta.json GUIDs are preserved (source GLB rewritten in place).

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { NodeIO, VertexLayout } from '@gltf-transform/core';
import { tangents, unweld, weld } from '@gltf-transform/functions';
import { generateTangents } from 'mikktspace';

const gameRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const meshesDir = join(gameRoot, 'assets', '3d', 'props', 'meshes');
const scenePacks = [
  join(gameRoot, 'assets', 'scenes', 'rogue-encampment.pack.json'),
  join(gameRoot, 'assets', 'scenes', 'slagdeep-hollow.pack.json'),
];

function parseArgs(argv: string[]): {
  files: string[];
  activeScenes: boolean;
  dryRun: boolean;
  force: boolean;
} {
  const files: string[] = [];
  let activeScenes = false;
  let dryRun = false;
  let force = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--active-scenes') activeScenes = true;
    else if (a === '--dry-run') dryRun = true;
    else if (a === '--force') force = true;
    else if (a === '--file') {
      const v = argv[++i];
      if (!v) throw new Error('--file requires a path or basename');
      files.push(v);
    } else if (a === '--help' || a === '-h') {
      console.log(`Usage:
  bun scripts/bake-prop-tangents.ts --file <glb> [--dry-run] [--force]
  bun scripts/bake-prop-tangents.ts --active-scenes [--dry-run] [--force]
`);
      process.exit(0);
    } else {
      throw new Error(`unknown arg: ${a}`);
    }
  }
  if (!activeScenes && files.length === 0) {
    throw new Error('pass --file <glb> or --active-scenes');
  }
  return { files, activeScenes, dryRun, force };
}

function parseGlbJson(path: string): {
  hasNormalTexture: boolean;
  hasAnyTangent: boolean;
  missingTangent: boolean;
} {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8')) as {
    materials?: Array<{ normalTexture?: unknown }>;
    meshes?: Array<{ primitives?: Array<{ attributes?: { TANGENT?: number } }> }>;
  };
  const hasNormalTexture = (json.materials ?? []).some((m) => m.normalTexture !== undefined);
  let primCount = 0;
  let withTangent = 0;
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh.primitives ?? []) {
      primCount++;
      if (p.attributes?.TANGENT !== undefined) withTangent++;
    }
  }
  const hasAnyTangent = withTangent > 0;
  const missingTangent = hasNormalTexture && withTangent < primCount;
  return { hasNormalTexture, hasAnyTangent, missingTangent };
}

function resolveGlbPath(spec: string): string {
  if (spec.endsWith('.glb') && !spec.includes('/') && !spec.includes('\\')) {
    return join(meshesDir, spec);
  }
  return spec.startsWith('/') ? spec : join(gameRoot, spec);
}

function listActiveSceneGlbs(): string[] {
  const sceneText = scenePacks.map((p) => readFileSync(p, 'utf8')).join('\n');
  const out: string[] = [];
  for (const f of readdirSync(meshesDir).filter((x) => x.endsWith('.glb'))) {
    const metaPath = join(meshesDir, `${f}.meta.json`);
    let meta: { subAssets?: Array<{ guid?: string }> };
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8')) as typeof meta;
    } catch {
      continue;
    }
    const guids = (meta.subAssets ?? []).map((s) => s.guid).filter(Boolean) as string[];
    if (guids.some((g) => sceneText.includes(g))) out.push(join(meshesDir, f));
  }
  return out.sort();
}

async function bakeOne(path: string, dryRun: boolean, force: boolean): Promise<'baked' | 'skip' | 'dry'> {
  const name = basename(path);
  const info = parseGlbJson(path);
  if (!info.hasNormalTexture) {
    console.log(`  skip ${name}  (no normalTexture)`);
    return 'skip';
  }
  if (!info.missingTangent && !force) {
    console.log(`  skip ${name}  (already has TANGENT)`);
    return 'skip';
  }

  const before = statSync(path).size;
  if (dryRun) {
    console.log(`  dry-run ${name}  (${before} bytes, missingTangent=${info.missingTangent})`);
    return 'dry';
  }

  // MikkTSpace requires unwelded primitives (unique corner per triangle vertex).
  // weld() afterwards re-merges only corners with identical attributes (incl. tangent).
  const io = new NodeIO();
  io.setVertexLayout(VertexLayout.SEPARATE);
  const doc = await io.read(path);
  await doc.transform(
    unweld(),
    tangents({ generateTangents }),
    weld(),
  );
  await io.write(path, doc);

  const after = parseGlbJson(path);
  const afterSize = statSync(path).size;
  if (after.missingTangent) {
    throw new Error(`${name}: wrote GLB but TANGENT still missing`);
  }
  console.log(`  baked ${name}  ${before} → ${afterSize} bytes  TANGENT=ok`);
  return 'baked';
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const targets = new Set<string>();
  for (const f of args.files) targets.add(resolveGlbPath(f));
  if (args.activeScenes) {
    for (const p of listActiveSceneGlbs()) targets.add(p);
  }

  const list = [...targets].sort();
  console.log(`bake-prop-tangents: ${list.length} candidate(s)${args.dryRun ? ' (dry-run)' : ''}`);
  let baked = 0;
  let skipped = 0;
  let dry = 0;
  for (const path of list) {
    const r = await bakeOne(path, args.dryRun, args.force);
    if (r === 'baked') baked++;
    else if (r === 'dry') dry++;
    else skipped++;
  }
  console.log(`done: baked=${baked} dry=${dry} skipped=${skipped}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
