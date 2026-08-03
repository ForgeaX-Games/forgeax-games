/**
 * Undo mid_grass PNG inject that produced white-film lawns in ForgeaX.
 * Restores solid green factor and drops the unbound baseColorTexture.
 *
 * Usage: node scripts/unpatch-grass-texture.mjs
 */
import { NodeIO, VertexLayout } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, '..', 'assets');
const DST = join(ASSETS, 'race_track.glb');
const PAIRS = join(ASSETS, 'race-pairs.json');
// Match bake std(0xa8d878) after typical glTF linear export ≈ original col key.
const SOLID_NAME = 'col_0.390,0.685,0.190|e0';
const SOLID_FACTOR = [0.39, 0.685, 0.19, 1];

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.SEPARATE);
const doc = await io.read(DST);
const root = doc.getRoot();

let fixed = 0;
for (const mat of root.listMaterials()) {
  const name = mat.getName() || '';
  if (name !== 'mid_grass' && name !== SOLID_NAME) continue;
  mat.setName(SOLID_NAME);
  mat.setBaseColorTexture(null);
  mat.setBaseColorFactor(SOLID_FACTOR);
  fixed += 1;
}

if (fixed === 0) {
  console.warn('No mid_grass / lawn mat found — nothing to unpatch');
} else {
  const pairs = JSON.parse(readFileSync(PAIRS, 'utf8'));
  for (const p of pairs) {
    if (p.name === 'mid_grass') p.name = SOLID_NAME;
  }
  writeFileSync(PAIRS, JSON.stringify(pairs, null, 2));
  const out = await io.writeBinary(doc);
  writeFileSync(DST, out);
  console.log('Restored solid lawn', SOLID_NAME, `${(out.byteLength / 1e6).toFixed(2)}MB`);
}
