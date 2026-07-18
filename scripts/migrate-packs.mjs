#!/usr/bin/env node

/**
 * migrate-packs.mjs — one-shot idempotent pack data migration (M3b + M3d + M3e).
 *
 * M3b: Migrates hellforge + cow-level pack files from single
 * `material: <int>` to `materials: [<int>]` array form, renames
 * cow-level payload key `nodes` -> `entities`, fixes hellforge Ground
 * entity Transform, and fills cow-level forge.json defaultScene GUID.
 *
 * M3d: Moves scene packs from omnibus locations (scenes/ or game
 * root) into the canonical <slug>/assets/ directory so the Vite
 * pluginPack scanner indexes them for host loadByGuid.
 *
 * M3e: Bakes cylinder mesh geometry (createCylinderGeometry(0.5, 0.5,
 * 1, 18)) as an inline kind=mesh asset with GUID
 * c1111111-0000-5000-8000-000000000001 into cow-level
 * assets/scene.pack.json.  This closes the dependency-closure gap
 * left when M3c removed the cow-level self-load block that programmatically
 * cataloged the cylinder mesh at runtime.
 *
 * Idempotent — safe to run N times; already-correct files are skipped.
 *
 * Usage:
 *   bun run packages/games/scripts/migrate-packs.mjs
 *   bun run --cwd packages/games migrate-packs   (after t4 registration)
 *
 * ASCII-only — forgeax-english compliance.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, renameSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GAMES_ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadJson(filePath) {
  const raw = readFileSync(filePath, 'utf-8');
  return JSON.parse(raw);
}

function saveJson(filePath, data) {
  writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
}

// ---------------------------------------------------------------------------
// Discover cow-level directory (the one containing forge.json with id=cow-level)
// ---------------------------------------------------------------------------

function discoverTest3Dir() {
  for (const name of readdirSync(GAMES_ROOT)) {
    const forgePath = resolve(GAMES_ROOT, name, 'forge.json');
    if (!existsSync(forgePath)) continue;
    try {
      const forge = JSON.parse(readFileSync(forgePath, 'utf-8'));
      if (forge.id === 'cow-level') return name;
    } catch (_) {
      // skip unparseable forge.json
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Migrate: material -> materials (MeshRenderer only)
// ---------------------------------------------------------------------------

/**
 * Convert `components.MeshRenderer.material: <int>` to
 * `components.MeshRenderer.materials: [<int>]` on a single entity node.
 * Returns true if a change was made, false if already array or absent.
 * Preserves the integer refs-index value (no GUID substitution).
 *
 * Only touches `components.MeshRenderer.material` — asset-kind "material"
 * entries, asset refs, and other material-named keys elsewhere are ignored.
 */
function migrateMaterialToMaterials(entity) {
  const mr = entity?.components?.MeshRenderer;
  if (!mr) return false;
  if (!Object.prototype.hasOwnProperty.call(mr, 'material')) return false;
  if (Array.isArray(mr.material)) return false; // already migrated

  const val = mr.material;
  delete mr.material;
  mr.materials = [val];
  return true;
}

// ---------------------------------------------------------------------------
// Migrate: nodes -> entities (payload root key)
// ---------------------------------------------------------------------------

/**
 * Rename payload root key `nodes` -> `entities` so the engine
 * parseScenePayload reads it (asset-registry.ts:427 only reads
 * payload.entities). Returns true if renamed, false if already
 * entities or no nodes key present.
 */
function migrateNodesToEntities(payload) {
  if (!payload) return false;
  if (!Object.prototype.hasOwnProperty.call(payload, 'nodes')) return false;
  if (Object.prototype.hasOwnProperty.call(payload, 'entities')) return false; // already done

  payload.entities = payload.nodes;
  delete payload.nodes;
  return true;
}

// ---------------------------------------------------------------------------
// Per-pack migration functions
// ---------------------------------------------------------------------------

/**
 * Migrate hellforge rogue-encampment.pack.json:
 *   - 19x material -> materials in entity MeshRenderer components
 *   - Ground entity Transform: posX -> 0, posZ -> 0, posY -0.1 unchanged
 */
function migrateHellforgePack(filePath) {
  const data = loadJson(filePath);
  let materialChanged = 0;
  let groundFixed = false;

  for (const asset of data.assets || []) {
    const entities = asset?.payload?.entities;
    if (!Array.isArray(entities)) continue;
    for (const entity of entities) {
      if (migrateMaterialToMaterials(entity)) {
        materialChanged++;
      }
      // Fix Ground entity transform (research Finding 5.4)
      if (entity?.components?.Name?.value === 'Ground') {
        const t = entity?.components?.Transform;
        if (t) {
          if (t.posX !== 0) {
            t.posX = 0;
            groundFixed = true;
          }
          if (t.posZ !== 0) {
            t.posZ = 0;
            groundFixed = true;
          }
        }
      }
    }
  }

  if (materialChanged > 0 || groundFixed) {
    saveJson(filePath, data);
    const parts = [];
    parts.push(`${materialChanged} material->materials`);
    if (groundFixed) parts.push('Ground transform fixed');
    console.log(`hellforge: ${parts.join(', ')} (saved)`);
  } else {
    console.log('hellforge: already migrated, skipped');
  }
}

/**
 * Migrate cow-level scene.pack.json:
 *   - 38x material -> materials in entity/node MeshRenderer components
 *   - payload key nodes -> entities
 */
function migrateTest3Pack(filePath) {
  const data = loadJson(filePath);
  let materialChanged = 0;
  let nodesRenamed = false;

  for (const asset of data.assets || []) {
    const payload = asset?.payload;
    if (!payload) continue;

    if (migrateNodesToEntities(payload)) {
      nodesRenamed = true;
    }

    // Walk entities (or still-named nodes) after potential rename
    const entities = payload.entities || payload.nodes;
    if (!Array.isArray(entities)) continue;
    for (const entity of entities) {
      if (migrateMaterialToMaterials(entity)) {
        materialChanged++;
      }
    }
  }

  if (materialChanged > 0 || nodesRenamed) {
    saveJson(filePath, data);
    const parts = [];
    if (materialChanged > 0) parts.push(`${materialChanged} material->materials`);
    if (nodesRenamed) parts.push('nodes->entities');
    console.log(`cow-level: ${parts.join(', ')} (saved)`);
  } else {
    console.log('cow-level: already migrated, skipped');
  }
}

/**
 * Fill cow-level forge.json defaultScene GUID.
 * GUID 822234d8-dd44-4a4f-9336-525e995e41a0 matches the scene asset
 * guid in scene.pack.json (research Finding 9, disk-verified).
 */
function migrateTest3ForgeJson(filePath) {
  const data = loadJson(filePath);
  if (Object.prototype.hasOwnProperty.call(data, 'defaultScene')) {
    console.log('cow-level forge.json: defaultScene already set, skipped');
    return;
  }
  data.defaultScene = '822234d8-dd44-4a4f-9336-525e995e41a0';
  saveJson(filePath, data);
  console.log('cow-level forge.json: defaultScene added (saved)');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const TEST3_DIR = discoverTest3Dir();

console.log('=== migrate-packs (M3b) ===');

// hellforge — try new location (assets/) first, then old (scenes/)
{
  const newPath = resolve(GAMES_ROOT, 'hellforge/assets/rogue-encampment.pack.json');
  const oldPath = resolve(GAMES_ROOT, 'hellforge/scenes/rogue-encampment.pack.json');
  const path = existsSync(newPath) ? newPath : (existsSync(oldPath) ? oldPath : null);
  if (path) {
    migrateHellforgePack(path);
  } else {
    console.log('hellforge: pack not found, skipped');
  }
}

// cow-level — try new location (assets/) first, then old (game root)
if (TEST3_DIR) {
  const newPath = resolve(GAMES_ROOT, TEST3_DIR, 'assets/scene.pack.json');
  const oldPath = resolve(GAMES_ROOT, TEST3_DIR, 'scene.pack.json');
  const path = existsSync(newPath) ? newPath : (existsSync(oldPath) ? oldPath : null);
  if (path) {
    migrateTest3Pack(path);
  } else {
    console.log('cow-level: pack not found, skipped');
  }
  migrateTest3ForgeJson(resolve(GAMES_ROOT, TEST3_DIR, 'forge.json'));
} else {
  console.error('ERROR: could not discover cow-level game directory (forge.json with id=cow-level)');
  process.exit(2);
}

// ---------------------------------------------------------------------------
// M3d — Move scene packs into assets/ so the Vite pluginPack scanner
//       (which only scans <slug>/assets/) indexes them for loadByGuid.
// ---------------------------------------------------------------------------

/**
 * moveFileSync(src, dst):
 *   - Renames src -> dst (atomic when on the same filesystem).
 *   - Creates parent dirs for dst if needed.
 *   - Idempotent: if dst already exists, skip (no overwrite).
 *   - If src does not exist, warn (already moved or no source).
 *   - Returns 'moved' | 'skipped-dst-exists' | 'skipped-src-missing'.
 */
function movePack(src, dst) {
  if (existsSync(dst)) {
    console.log(`  skip (dst exists): ${basename(dst)}`);
    return 'skipped-dst-exists';
  }
  if (!existsSync(src)) {
    console.log(`  skip (src missing): ${basename(src)}`);
    return 'skipped-src-missing';
  }
  mkdirSync(dirname(dst), { recursive: true });
  renameSync(src, dst);
  console.log(`  moved: ${basename(src)} -> ${basename(dst)}`);
  return 'moved';
}

function migrateM3dScenePacks() {
  console.log('=== M3d: move scene packs to assets/ ===');

  const packs = [
    {
      game: 'hellforge',
      src: resolve(GAMES_ROOT, 'hellforge', 'scenes', 'rogue-encampment.pack.json'),
      dst: resolve(GAMES_ROOT, 'hellforge', 'assets', 'rogue-encampment.pack.json'),
    },
    {
      game: 'cow-level',
      src: resolve(GAMES_ROOT, TEST3_DIR, 'scene.pack.json'),
      dst: resolve(GAMES_ROOT, TEST3_DIR, 'assets', 'scene.pack.json'),
    },
    {
      game: 'cow-survivor',
      src: resolve(GAMES_ROOT, 'cow-survivor', 'scenes', 'level1.pack.json'),
      dst: resolve(GAMES_ROOT, 'cow-survivor', 'assets', 'level1.pack.json'),
    },
    {
      game: 'cow-survivor',
      src: resolve(GAMES_ROOT, 'cow-survivor', 'scenes', 'level2.pack.json'),
      dst: resolve(GAMES_ROOT, 'cow-survivor', 'assets', 'level2.pack.json'),
    },
  ];

  let moved = 0;
  let skipped = 0;

  for (const { game, src, dst } of packs) {
    console.log(`${game}:`);
    const result = movePack(src, dst);
    if (result === 'moved') moved++;
    else skipped++;
  }

  console.log(`M3d done: ${moved} moved, ${skipped} skipped`);
}

// M3d also verifies cow-level forge.json defaultScene is filled (M3b work).
function verifyM3dForgeJson() {
  if (!TEST3_DIR) return;
  const forgePath = resolve(GAMES_ROOT, TEST3_DIR, 'forge.json');
  const forge = loadJson(forgePath);
  if (forge.defaultScene === '822234d8-dd44-4a4f-9336-525e995e41a0') {
    console.log('cow-level forge.json: defaultScene 822234d8 OK');
  } else {
    console.log('cow-level forge.json: defaultScene MISSING or MISMATCH — filling');
    forge.defaultScene = '822234d8-dd44-4a4f-9336-525e995e41a0';
    saveJson(forgePath, forge);
  }
}

migrateM3dScenePacks();
verifyM3dForgeJson();

// ---------------------------------------------------------------------------
// M3e — Bake cylinder mesh geometry as inline kind=mesh asset into cow-level
//       assets/scene.pack.json.  GUID c1111111-0000-5000-8000-000000000001
//       matches scene refs[2] and the old self-load CYLINDER_GUID.
//       Geometry parameters createCylinderGeometry(0.5,0.5,1,18) are
//       verbatim identical to the old cow-level main.ts:166 self-load
//       block that M3c removed.
//
//       The engine-runtime geometry module is imported dynamically so the
//       rest of the script stays zero-dependency.  If the engine dist is
//       unavailable, the script falls back to inline precomputed constants
//       (same geometry, baked ahead of time).
// ---------------------------------------------------------------------------

/**
 * Compute (or load precomputed) cylinder mesh geometry POD for
 * createCylinderGeometry(0.5, 0.5, 1, 18).
 *
 * Returns { vertices: number[], indices: number[] } or null on failure.
 */
async function bakeCylinderMeshGeo() {
  // Try dynamic import of the engine runtime geometry module first.
  // The script runs from repo root, so we resolve from __dirname.
  const engineGeoPath = resolve(__dirname, '..', '..', 'engine', 'packages', 'runtime', 'dist', 'geometry', 'index.mjs');
  try {
    const mod = await import(engineGeoPath);
    const r = mod.createCylinderGeometry(0.5, 0.5, 1, 18);
    if (r.ok && r.value) {
      return {
        vertices: Array.from(r.value.vertices),
        indices: Array.from(r.value.indices),
      };
    }
  } catch (_) {
    // Dynamic import failed — fall through to precomputed constants.
  }

  // Fallback: precomputed by createCylinderGeometry(0.5, 0.5, 1, 18)
  // at 2026-06-22 (engine @ forgeax/engine-runtime dist/geometry/index.mjs).
  // V=936 (78 vertices * 12 floats/vertex), I=216.
  // Each vertex: position(3) + normal(3) + uv(2) + tangent(4) = 12 floats.
  // eslint-disable-next-line -- long inline array, this IS the SSOT
  /* BEGIN M3E_CYLINDER_GEO */
  const CYLINDER_VERTICES = [0,0.5,0.5,0,0,1,0,0,1,0,0,-1,0.1710100769996643,0.5,0.46984630823135376,0.3420201539993286,0,0.9396926164627075,0.0555555559694767,0,0.9396926164627075,0,-0.3420201539993286,-1,0.32139381766319275,0.5,0.3830222189426422,0.6427876353263855,0,0.7660444378852844,0.1111111119389534,0,0.7660444378852844,0,-0.6427876353263855,-1,0.4330126941204071,0.5,0.25,0.8660253882408142,0,0.5,0.1666666716337204,0,0.5,0,-0.8660253882408142,-1,0.49240386486053467,0.5,0.08682408928871155,0.9848077297210693,0,0.1736481785774231,0.2222222238779068,0,0.1736481785774231,0,-0.9848077297210693,-1,0.49240386486053467,0.5,-0.08682408928871155,0.9848077297210693,0,-0.1736481785774231,0.2777777910232544,0,-0.1736481785774231,0,-0.9848077297210693,-1,0.4330126941204071,0.5,-0.25,0.8660253882408142,0,-0.5,0.3333333432674408,0,-0.5,0,-0.8660253882408142,-1,0.32139381766319275,0.5,-0.3830222189426422,0.6427876353263855,0,-0.7660444378852844,0.3888888955116272,0,-0.7660444378852844,0,-0.6427876353263855,-1,0.1710100769996643,0.5,-0.46984630823135376,0.3420201539993286,0,-0.9396926164627075,0.4444444477558136,0,-0.9396926164627075,0,-0.3420201539993286,-1,6.123234262925839e-17,0.5,-0.5,1.2246468525851679e-16,0,-1,0.5,0,-1,0,-1.2511564692051653e-16,-1,-0.1710100769996643,0.5,-0.46984630823135376,-0.3420201539993286,0,-0.9396926164627075,0.5555555820465088,0,-0.9396926164627075,0,0.3420201539993286,-1,-0.32139381766319275,0.5,-0.3830222189426422,-0.6427876353263855,0,-0.7660444378852844,0.6111111044883728,0,-0.7660444378852844,0,0.6427876353263855,-1,-0.4330126941204071,0.5,-0.25,-0.8660253882408142,0,-0.5,0.6666666865348816,0,-0.5,0,0.8660253882408142,-1,-0.49240386486053467,0.5,-0.08682408928871155,-0.9848077297210693,0,-0.1736481785774231,0.7222222089767456,0,-0.1736481785774231,0,0.9848077297210693,-1,-0.49240386486053467,0.5,0.08682408928871155,-0.9848077297210693,0,0.1736481785774231,0.7777777910232544,0,0.1736481785774231,0,0.9848077297210693,-1,-0.4330126941204071,0.5,0.25,-0.8660253882408142,0,0.5,0.8333333134651184,0,0.5,0,0.8660253882408142,-1,-0.32139381766319275,0.5,0.3830222189426422,-0.6427876353263855,0,0.7660444378852844,0.8888888955116272,0,0.7660444378852844,0,0.6427876353263855,-1,-0.1710100769996643,0.5,0.46984630823135376,-0.3420201539993286,0,0.9396926164627075,0.9444444179534912,0,0.9396926164627075,0,0.3420201539993286,-1,-1.2246468525851679e-16,0.5,0.5,-2.4492937051703357e-16,0,1,1,0,1,0,2.5365375693419366e-16,-1,0,-0.5,0.5,0,0,1,0,1,1,0,0,-1,0.1710100769996643,-0.5,0.46984630823135376,0.3420201539993286,0,0.9396926164627075,0.0555555559694767,1,0.9396926164627075,0,-0.3420201539993286,-1,0.32139381766319275,-0.5,0.3830222189426422,0.6427876353263855,0,0.7660444378852844,0.1111111119389534,1,0.7660444378852844,0,-0.6427876353263855,-1,0.4330126941204071,-0.5,0.25,0.8660253882408142,0,0.5,0.1666666716337204,1,0.5,0,-0.8660253882408142,-1,0.49240386486053467,-0.5,0.08682408928871155,0.9848077297210693,0,0.1736481785774231,0.2222222238779068,1,0.1736481785774231,0,-0.9848077297210693,-1,0.49240386486053467,-0.5,-0.08682408928871155,0.9848077297210693,0,-0.1736481785774231,0.2777777910232544,1,-0.1736481785774231,0,-0.9848077297210693,-1,0.4330126941204071,-0.5,-0.25,0.8660253882408142,0,-0.5,0.3333333432674408,1,-0.5,0,-0.8660253882408142,-1,0.32139381766319275,-0.5,-0.3830222189426422,0.6427876353263855,0,-0.7660444378852844,0.3888888955116272,1,-0.7660444378852844,0,-0.6427876353263855,-1,0.1710100769996643,-0.5,-0.46984630823135376,0.3420201539993286,0,-0.9396926164627075,0.4444444477558136,1,-0.9396926164627075,0,-0.3420201539993286,-1,6.123234262925839e-17,-0.5,-0.5,1.2246468525851679e-16,0,-1,0.5,1,-1,0,-1.2511564692051653e-16,-1,-0.1710100769996643,-0.5,-0.46984630823135376,-0.3420201539993286,0,-0.9396926164627075,0.5555555820465088,1,-0.9396926164627075,0,0.3420201539993286,-1,-0.32139381766319275,-0.5,-0.3830222189426422,-0.6427876353263855,0,-0.7660444378852844,0.6111111044883728,1,-0.7660444378852844,0,0.6427876353263855,-1,-0.4330126941204071,-0.5,-0.25,-0.8660253882408142,0,-0.5,0.6666666865348816,1,-0.5,0,0.8660253882408142,-1,-0.49240386486053467,-0.5,-0.08682408928871155,-0.9848077297210693,0,-0.1736481785774231,0.7222222089767456,1,-0.1736481785774231,0,0.9848077297210693,-1,-0.49240386486053467,-0.5,0.08682408928871155,-0.9848077297210693,0,0.1736481785774231,0.7777777910232544,1,0.1736481785774231,0,0.9848077297210693,-1,-0.4330126941204071,-0.5,0.25,-0.8660253882408142,0,0.5,0.8333333134651184,1,0.5,0,0.8660253882408142,-1,-0.32139381766319275,-0.5,0.3830222189426422,-0.6427876353263855,0,0.7660444378852844,0.8888888955116272,1,0.7660444378852844,0,0.6427876353263855,-1,-0.1710100769996643,-0.5,0.46984630823135376,-0.3420201539993286,0,0.9396926164627075,0.9444444179534912,1,0.9396926164627075,0,0.3420201539993286,-1,-1.2246468525851679e-16,-0.5,0.5,-2.4492937051703357e-16,0,1,1,1,1,0,2.5365375693419366e-16,-1,0,0.5,0,0,1,0,0.5,0.5,1,0,-1.5981740357037702e-15,-1,0,0.5,0.5,0,1,0,0.5,1,1,0,0,-1,0.1710100769996643,0.5,0.46984630823135376,0,1,0,0.6710100769996643,0.9698463082313538,1,0,-8.188121825014605e-8,-1,0.32139381766319275,0.5,0.3830222189426422,0,1,0,0.8213937878608704,0.8830222487449646,1,0,-3.8313164196779326e-8,-1,0.4330126941204071,0.5,0.25,0,1,0,0.9330127239227295,0.75,1,0,8.713615073929759e-8,-1,0.49240386486053467,0.5,0.08682408928871155,0,1,0,0.9924038648605347,0.5868240594863892,1,0,5.869911490208324e-8,-1,0.49240386486053467,0.5,-0.08682408928871155,0,1,0,0.9924038648605347,0.41317591071128845,1,0,1.5131039532434443e-8,-1,0.4330126941204071,0.5,-0.25,0,1,0,0.9330127239227295,0.25,1,0,0,-1,0.32139381766319275,0.5,-0.3830222189426422,0,1,0,0.8213937878608704,0.11697778105735779,1,0,-4.17188683599079e-9,-1,0.1710100769996643,0.5,-0.46984630823135376,0,1,0,0.6710100769996643,0.03015368990600109,1,0,1.2741235844160315e-9,-1,6.123234262925839e-17,0.5,-0.5,0,1,0,0.5,0,1,0,-2.41851421791464e-24,-1,-0.1710100769996643,0.5,-0.46984630823135376,0,1,0,0.3289899230003357,0.03015368990600109,1,0,-1.2741239174829389e-9,-1,-0.32139381766319275,0.5,-0.3830222189426422,0,1,0,0.17860619723796844,0.11697778105735779,1,0,4.17188639190158e-9,-1,-0.4330126941204071,0.5,-0.25,0,1,0,0.0669872984290123,0.25,1,0,0,-1,-0.49240386486053467,0.5,-0.08682408928871155,0,1,0,0.007596123497933149,0.41317591071128845,1,0,-1.5131039532434443e-8,-1,-0.49240386486053467,0.5,0.08682408928871155,0,1,0,0.007596123497933149,0.5868240594863892,1,0,-5.869911490208324e-8,-1,-0.4330126941204071,0.5,0.25,0,1,0,0.0669872984290123,0.75,1,0,-8.713615784472495e-8,-1,-0.32139381766319275,0.5,0.3830222189426422,0,1,0,0.17860619723796844,0.8830222487449646,1,0,3.831314643321093e-8,-1,-0.1710100769996643,0.5,0.46984630823135376,0,1,0,0.3289899230003357,0.9698463082313538,1,0,8.188121825014605e-8,-1,-1.2246468525851679e-16,0.5,0.5,0,1,0,0.5,1,1,0,0,-1,0,-0.5,0,0,-1,0,0.5,0.5,1,0,-1.5981740357037702e-15,1,0,-0.5,0.5,0,-1,0,0.5,1,1,0,0,1,0.1710100769996643,-0.5,0.46984630823135376,0,-1,0,0.6710100769996643,0.9698463082313538,1,0,-8.188121825014605e-8,1,0.32139381766319275,-0.5,0.3830222189426422,0,-1,0,0.8213937878608704,0.8830222487449646,1,0,-3.8313164196779326e-8,1,0.4330126941204071,-0.5,0.25,0,-1,0,0.9330127239227295,0.75,1,0,8.713615073929759e-8,1,0.49240386486053467,-0.5,0.08682408928871155,0,-1,0,0.9924038648605347,0.5868240594863892,1,0,5.869911490208324e-8,1,0.49240386486053467,-0.5,-0.08682408928871155,0,-1,0,0.9924038648605347,0.41317591071128845,1,0,1.5131039532434443e-8,1,0.4330126941204071,-0.5,-0.25,0,-1,0,0.9330127239227295,0.25,1,0,0,1,0.32139381766319275,-0.5,-0.3830222189426422,0,-1,0,0.8213937878608704,0.11697778105735779,1,0,-4.17188683599079e-9,1,0.1710100769996643,-0.5,-0.46984630823135376,0,-1,0,0.6710100769996643,0.03015368990600109,1,0,1.2741235844160315e-9,1,6.123234262925839e-17,-0.5,-0.5,0,-1,0,0.5,0,1,0,-2.41851421791464e-24,1,-0.1710100769996643,-0.5,-0.46984630823135376,0,-1,0,0.3289899230003357,0.03015368990600109,1,0,-1.2741239174829389e-9,1,-0.32139381766319275,-0.5,-0.3830222189426422,0,-1,0,0.17860619723796844,0.11697778105735779,1,0,4.17188639190158e-9,1,-0.4330126941204071,-0.5,-0.25,0,-1,0,0.0669872984290123,0.25,1,0,0,1,-0.49240386486053467,-0.5,-0.08682408928871155,0,-1,0,0.007596123497933149,0.41317591071128845,1,0,-1.5131039532434443e-8,1,-0.49240386486053467,-0.5,0.08682408928871155,0,-1,0,0.007596123497933149,0.5868240594863892,1,0,-5.869911490208324e-8,1,-0.4330126941204071,-0.5,0.25,0,-1,0,0.0669872984290123,0.75,1,0,-8.713615784472495e-8,1,-0.32139381766319275,-0.5,0.3830222189426422,0,-1,0,0.17860619723796844,0.8830222487449646,1,0,3.831314643321093e-8,1,-0.1710100769996643,-0.5,0.46984630823135376,0,-1,0,0.3289899230003357,0.9698463082313538,1,0,8.188121825014605e-8,1,-1.2246468525851679e-16,-0.5,0.5,0,-1,0,0.5,1,1,0,0,1];
  const CYLINDER_INDICES = [0,19,1,19,20,1,1,20,2,20,21,2,2,21,3,21,22,3,3,22,4,22,23,4,4,23,5,23,24,5,5,24,6,24,25,6,6,25,7,25,26,7,7,26,8,26,27,8,8,27,9,27,28,9,9,28,10,28,29,10,10,29,11,29,30,11,11,30,12,30,31,12,12,31,13,31,32,13,13,32,14,32,33,14,14,33,15,33,34,15,15,34,16,34,35,16,16,35,17,35,36,17,17,36,18,36,37,18,38,39,40,38,40,41,38,41,42,38,42,43,38,43,44,38,44,45,38,45,46,38,46,47,38,47,48,38,48,49,38,49,50,38,50,51,38,51,52,38,52,53,38,53,54,38,54,55,38,55,56,38,56,57,58,60,59,58,61,60,58,62,61,58,63,62,58,64,63,58,65,64,58,66,65,58,67,66,58,68,67,58,69,68,58,70,69,58,71,70,58,72,71,58,73,72,58,74,73,58,75,74,58,76,75,58,77,76];
  /* END M3E_CYLINDER_GEO */
  return { vertices: CYLINDER_VERTICES, indices: CYLINDER_INDICES };
}

/**
 * Bake cylinder mesh asset (kind=mesh) into cow-level assets/scene.pack.json.
 *
 * Idempotent — if a mesh asset with GUID
 * c1111111-0000-5000-8000-000000000001 already exists in assets[], skip.
 * Appends 1 new asset to the assets[] array.
 *
 * Geometry: createCylinderGeometry(0.5, 0.5, 1, 18).
 * 78 vertices * 12 floats/vertex (pos+normal+uv+tangent) = 936 floats.
 * 216 indices.
 */
async function migrateM3eCylinderMesh() {
  if (!TEST3_DIR) return;
  console.log('=== M3e: bake cylinder mesh asset into cow-level pack ===');

  const packPath = resolve(GAMES_ROOT, TEST3_DIR, 'assets', 'scene.pack.json');
  if (!existsSync(packPath)) {
    console.log('M3e: cow-level scene.pack.json not found, skipped');
    return;
  }

  const data = loadJson(packPath);
  const assets = data.assets;
  if (!Array.isArray(assets)) {
    console.log('M3e: no assets array in pack, skipped');
    return;
  }

  const CYLINDER_GUID = 'c1111111-0000-5000-8000-000000000001';

  // Idempotent guard: skip if cylinder mesh already present.
  const existing = assets.find(
    (a) => a && a.guid === CYLINDER_GUID && a.kind === 'mesh',
  );
  if (existing) {
    console.log('cow-level M3e: cylinder mesh already present, skipped');
    return;
  }

  const geo = await bakeCylinderMeshGeo();
  if (!geo) {
    console.error('M3e: failed to compute cylinder geometry, skipped');
    return;
  }

  const meshAsset = {
    guid: CYLINDER_GUID,
    kind: 'mesh',
    payload: {
      kind: 'mesh',
      vertices: geo.vertices,
      indices: geo.indices,
    },
    refs: [],
  };

  assets.push(meshAsset);
  saveJson(packPath, data);
  console.log(`cow-level M3e: cylinder mesh asset (guid=${CYLINDER_GUID}) added (vert=${geo.vertices.length}, idx=${geo.indices.length})`);
}

await migrateM3eCylinderMesh();

console.log('=== done ===');