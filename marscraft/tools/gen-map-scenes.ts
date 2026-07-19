/**
 * gen-map-scenes — blueprint → editable scene pack generator (M18).
 * =============================================================================
 * Converts every MapBlueprint in the registry into `scenes/<id>.pack.json`: an
 * editable forgeax scene pack whose entities are Name+Transform MARKERS for the
 * map's resource / start placements (see docs/map-scene-schema.md). The initial
 * scene reproduces EXACTLY the old procedural map (it runs `generateMap` and
 * emits a marker per computed placement); the designer then edits it in the
 * Studio editor.
 *
 * Run:  bun tools/gen-map-scenes.ts     (idempotent — re-seeds from blueprints)
 *
 * mapgen is engine-agnostic (no @forgeax imports) so this runs under plain bun.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAP_REGISTRY } from '../src/mapgen/map-registry';
import { generateMap } from '../src/mapgen/generator';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCENES_DIR = join(HERE, '..', 'scenes');

/** Stable per-map scene GUIDs (v4-shaped; hand-assigned so forge.json can pin one). */
const SCENE_GUID: Record<string, string> = {
  'red-canyon':        'a1b2c3d4-0001-4a10-8a10-marscraftmap1'.replace('marscraftmap1', 'aa0000000001'),
  'nebula-plateau':    'a1b2c3d4-0002-4a10-8a10-aa0000000002',
  'crystal-wasteland': 'a1b2c3d4-0003-4a10-8a10-aa0000000003',
  'lava-snow-pool':    'a1b2c3d4-0004-4a10-8a10-aa0000000004',
  'heat-wave-highway': 'a1b2c3d4-0005-4a10-8a10-aa0000000005',
  'lost-temple':       'a1b2c3d4-0006-4a10-8a10-aa0000000006',
  'twin-peaks':        'a1b2c3d4-0007-4a10-8a10-aa0000000007',
};

interface PackNode { localId: number; components: Record<string, Record<string, unknown>>; }

/** Y-rotation quaternion (facing about +Y). */
function quatY(rad: number): { quat: [number, number, number, number] } {
  const h = rad * 0.5;
  return { quat: [0, Math.sin(h), 0, Math.cos(h)] };
}

function nameMarker(localId: number, name: string, x: number, z: number, rot?: number): PackNode {
  const t: Record<string, unknown> = { pos: [x, 0, z], scale: [1, 1, 1] };
  if (rot !== undefined) Object.assign(t, quatY(rot));
  return { localId, components: { Name: { value: name }, Transform: t } };
}

let total = 0;
mkdirSync(SCENES_DIR, { recursive: true });
for (const entry of MAP_REGISTRY) {
  const guid = SCENE_GUID[entry.id];
  if (!guid) { console.warn(`[gen] no GUID for map ${entry.id} — skipped`); continue; }
  const map = generateMap(entry.blueprint);

  const entities: PackNode[] = [];
  let id = 0;
  // MapRoot marker (terrain blueprint reference).
  entities.push(nameMarker(id++, `MapRoot:${entry.id}`, 0, 0));
  // Start locations (Y-rotation = facing).
  for (const s of map.spawnPoints) {
    entities.push(nameMarker(id++, `Start:P${s.playerId}`, s.x, s.z, s.facing));
  }
  // Mineral patches (amount in the name suffix).
  for (const m of map.minerals) {
    entities.push(nameMarker(id++, `Mineral:${Math.round(m.amount)}`, m.x, m.z));
  }
  // Vespene geysers.
  for (const g of map.geysers) {
    entities.push(nameMarker(id++, `Geyser:${Math.round(g.amount)}`, g.x, g.z));
  }

  const pack = {
    schemaVersion: '1.0.0',
    kind: 'internal-text-package',
    assets: [
      {
        guid,
        kind: 'scene',
        // `refs: []` — the scene asset's handle-ref table (material/mesh GUIDs
        // resolved by index in MeshRenderer/MeshFilter). Marker entities carry no
        // mesh, so it's empty, but the engine's pack importer expects the array
        // to be present (cow-survivor's packs always have it).
        refs: [] as string[],
        payload: { kind: 'scene', entities },
      },
    ],
  };
  const out = join(SCENES_DIR, `${entry.id}.pack.json`);
  writeFileSync(out, JSON.stringify(pack, null, 2) + '\n');
  console.log(`[gen] ${entry.id}: ${entities.length} markers (${map.spawnPoints.length} starts, ${map.minerals.length} minerals, ${map.geysers.length} geysers) → scenes/${entry.id}.pack.json`);
  total++;
}
console.log(`[gen] wrote ${total} map scene packs.`);
