// One-off generator: ENEMIES defs → assets/monsters/<kind>.pack.json
//
// Exports each enemy's lowpoly assembly (parts + palette) as a NATIVE engine
// scene pack, the same format the editor edits and ▶ Play instantiates. After
// this runs, the packs become the appearance SSOT: enemies.ts loads them at
// game start (loadMonsterVisuals) and the editor opens them via the
// SceneSwitcher's 怪物资产 group — UE-style standalone asset editing.
//
// Run: bun run scripts/gen-monster-packs.ts   (from the game dir)
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENEMIES } from '../src/enemies';

const CUBE_GUID = 'cbe42beb-8975-5096-b3a1-3dda4cb4c077';
const SPHERE_GUID = '95730fd2-9846-5f84-8658-0b3c971eb263';

// FNV-1a–based deterministic UUID-shaped guid (same trick as editor-core's
// stableGuid — stable across regenerations so references never churn).
function stableGuid(key: string): string {
  const pass = (salt: number): number => {
    let h = (0x811c9dc5 ^ salt) >>> 0;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h >>> 0;
  };
  const hex = [pass(1), pass(2), pass(3), pass(4)].map((n) => n.toString(16).padStart(8, '0')).join('');
  const s = hex.split('');
  s[12] = '5';
  s[16] = ((parseInt(s[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${s.slice(8, 12).join('')}-${s.slice(12, 16).join('')}-${s.slice(16, 20).join('')}-${hex.slice(20)}`;
}

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'assets', 'monsters');
mkdirSync(outDir, { recursive: true });

for (const def of Object.values(ENEMIES)) {
  const refs: string[] = [CUBE_GUID, SPHERE_GUID];
  const materials: Array<{ guid: string; kind: 'material'; payload: unknown; refs: string[] }> = [];
  const matRefIndex = new Map<string, number>();
  for (const [slot, p] of Object.entries(def.palette)) {
    if (!p) continue;
    const guid = stableGuid(`monster:${def.kind}:mat:${slot}`);
    const paramValues: Record<string, unknown> = {
      baseColor: [p.color[0], p.color[1], p.color[2], 1],
      metallic: p.metallic ?? 0.05,
      roughness: p.roughness ?? 0.6,
    };
    if (p.emissive && (p.emissiveIntensity ?? 2) > 0) {
      paramValues.emissive = [p.emissive[0], p.emissive[1], p.emissive[2]];
      paramValues.emissiveIntensity = p.emissiveIntensity ?? 2;
    }
    materials.push({
      guid, kind: 'material',
      payload: {
        kind: 'material',
        passes: [{ name: 'Forward', shader: 'forgeax::default-standard-pbr', tags: { LightMode: 'Forward' }, queue: 2000 }],
        paramValues,
      },
      refs: [],
    });
    matRefIndex.set(slot, refs.length);
    refs.push(guid);
  }

  const slotCounts = new Map<string, number>();
  const entities = def.parts.map((ps, i) => {
    const n = (slotCounts.get(ps.mat) ?? 0) + 1;
    slotCounts.set(ps.mat, n);
    const t: Record<string, number> = {
      posX: ps.px, posY: ps.py, posZ: ps.pz,
      scaleX: ps.sx, scaleY: ps.sy, scaleZ: ps.sz,
    };
    if (ps.rotY !== undefined) {
      const h = ps.rotY / 2;
      t.quatX = 0; t.quatY = Math.sin(h); t.quatZ = 0; t.quatW = Math.cos(h);
    }
    return {
      localId: i,
      components: {
        // Name carries the material-slot key (runtime parses `<slot>_<n>`).
        Name: { value: n === 1 && def.parts.filter((q) => q.mat === ps.mat).length === 1 ? ps.mat : `${ps.mat}_${n}` },
        Transform: t,
        MeshFilter: { assetHandle: ps.shape === 'sphere' ? 1 : 0 },
        MeshRenderer: { material: matRefIndex.get(ps.mat) ?? 2 },
      },
    };
  });

  const pack = {
    schemaVersion: '1.0.0',
    kind: 'internal-text-package',
    assets: [
      {
        guid: stableGuid(`monster:${def.kind}:scene`),
        kind: 'scene',
        payload: { kind: 'scene', entities },
        refs,
      },
      ...materials,
    ],
  };
  const file = join(outDir, `${def.kind}.pack.json`);
  writeFileSync(file, JSON.stringify(pack, null, 1) + '\n');
  console.log(`wrote ${file} (${entities.length} parts, ${materials.length} materials)`);
}
