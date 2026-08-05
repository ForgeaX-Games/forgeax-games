/**
 * Post-process baked _race_track_raw.glb:
 * - Inject asphalt/sidewalk PNG textures by base-color match
 * - Expand shared mesh instances with FULL world matrices (parent chain)
 * - Merge meshes per material
 * - Flip sidewalk/asphalt if needed, SEPARATE vertex layout
 * - Write assets/race_track.glb
 *
 * Usage: node scripts/postprocess-race-track.mjs
 *
 * CRITICAL: Do NOT use flatten()/local-only bake. GLTFExporter shares meshes
 * across hundreds of nodes (boxes/capsules). Local bake or flatten collapses
 * instances → skyline/houses stack at origin → scene looks empty.
 */
import { NodeIO, VertexLayout } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize } from '@gltf-transform/functions';
import { mat3, mat4, vec3 } from 'gl-matrix';
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { writeAllMidTextures, MID_TEX_DIR } from './midground-textures.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, '..', 'assets');
// Bake intermediates live OUTSIDE assets/: the editor's integrity scan imports
// every sidecar-less .glb under assets/ on boot, and its generated GUIDs are
// UUIDv7, which the pack scanner rejects — one such sidecar collapses the whole
// per-game catalog to zero rows (blank scene tree + empty Content Browser).
const ASSETS_SRC = join(__dirname, '..', 'assets-src');
const TEX =
  '/Users/you/Desktop/forgeax/claude-fable-5-93/code_rounds/round-34/code/public/assets';
const RAW = join(ASSETS_SRC, '_race_track_raw.glb');
const DST = join(ASSETS, 'race_track.glb');

function srgbToLinear(hex) {
  const r = ((hex >> 16) & 255) / 255;
  const g = ((hex >> 8) & 255) / 255;
  const b = (hex & 255) / 255;
  const toLin = (u) => (u <= 0.04045 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4));
  return [toLin(r), toLin(g), toLin(b)];
}
function colorKey(c, e = 0) {
  return c.slice(0, 3).map((x) => (Math.round(x * 200) / 200).toFixed(3)).join(',') + `|e${e}`;
}
function matchKind(c) {
  // ONLY asphalt + sidewalk textures. Never grass/wood — those share greens/browns
  // with trees/facades and merge into a noisy camo plane after material bucketing.
  const targets = [
    ['asphalt', srgbToLinear(0xc8ccd6)],
    ['asphalt', srgbToLinear(0x9aa0ae)],
    ['sidewalk', srgbToLinear(0xd8d3c8)],
    ['sidewalk', srgbToLinear(0xcfc9ba)],
  ];
  let best = null,
    bestD = 0.012;
  for (const [k, t] of targets) {
    const d = (c[0] - t[0]) ** 2 + (c[1] - t[1]) ** 2 + (c[2] - t[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return best;
}

/** World matrix = parent₀ … parentₙ · local (gltf-transform parent chain). */
function worldMatrix(node) {
  const chain = [];
  for (let n = node; n; n = n.getParentNode()) chain.push(n);
  const out = mat4.create();
  for (let i = chain.length - 1; i >= 0; i--) {
    const n = chain[i];
    const t = n.getTranslation() ?? [0, 0, 0];
    const r = n.getRotation() ?? [0, 0, 0, 1];
    const s = n.getScale() ?? [1, 1, 1];
    const local = mat4.create();
    mat4.fromRotationTranslationScale(local, r, t, s);
    mat4.multiply(out, out, local);
  }
  return out;
}

function readPrim(prim) {
  const pos = prim.getAttribute('POSITION');
  const nrm = prim.getAttribute('NORMAL');
  const uv = prim.getAttribute('TEXCOORD_0');
  const idxAcc = prim.getIndices();
  if (!pos) return null;
  const posArr = Array.from(pos.getArray());
  const vertCount = posArr.length / 3;
  // RoundedBoxGeometry / some Three exports are non-indexed — synthesize triangle list.
  let idx;
  if (idxAcc) {
    idx = Array.from(idxAcc.getArray());
  } else {
    idx = [];
    for (let i = 0; i < vertCount; i++) idx.push(i);
  }
  if (idx.length < 3) return null;
  return {
    pos: posArr,
    nrm: nrm ? Array.from(nrm.getArray()) : null,
    uv: uv ? Array.from(uv.getArray()) : null,
    idx,
  };
}

function transformPrim(data, world) {
  const pos = data.pos.slice();
  const tmp = vec3.create();
  for (let i = 0; i < pos.length; i += 3) {
    vec3.set(tmp, pos[i], pos[i + 1], pos[i + 2]);
    vec3.transformMat4(tmp, tmp, world);
    pos[i] = tmp[0];
    pos[i + 1] = tmp[1];
    pos[i + 2] = tmp[2];
  }
  let nrm = null;
  if (data.nrm) {
    nrm = data.nrm.slice();
    const normalMat = mat3.create();
    mat3.normalFromMat4(normalMat, world);
    for (let i = 0; i < nrm.length; i += 3) {
      vec3.set(tmp, nrm[i], nrm[i + 1], nrm[i + 2]);
      vec3.transformMat3(tmp, tmp, normalMat);
      vec3.normalize(tmp, tmp);
      nrm[i] = tmp[0];
      nrm[i + 1] = tmp[1];
      nrm[i + 2] = tmp[2];
    }
  }
  return { pos, nrm, uv: data.uv ? data.uv.slice() : null, idx: data.idx.slice() };
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.SEPARATE);
const doc = await io.read(RAW);
await doc.transform(dequantize());
const root = doc.getRoot();

const textures = {};
for (const [k, f] of Object.entries({
  asphalt: 'tex_asphalt.png',
  sidewalk: 'tex_sidewalk.png',
})) {
  textures[k] = doc
    .createTexture(k)
    .setImage(readFileSync(join(TEX, f)))
    .setMimeType('image/png');
}

// Midground readable textures (shop signs / awnings / city glass)
writeAllMidTextures();
const midFiles = {
  mid_sign_pizza: 'sign_pizza.png',
  mid_sign_burger: 'sign_burger.png',
  mid_sign_gelato: 'sign_gelato.png',
  mid_sign_cake: 'sign_cake.png',
  mid_awning_pizza: 'awning_pizza.png',
  mid_awning_burger: 'awning_burger.png',
  mid_awning_gelato: 'awning_gelato.png',
  mid_awning_cake: 'awning_cake.png',
  mid_window_grid: 'window_grid.png',
  mid_sign_chinatown: 'sign_chinatown.png',
  mid_sign_toys: 'sign_toys.png',
  mid_sign_cafe: 'sign_cafe.png',
  mid_sign_gifts: 'sign_gifts.png',
  mid_sign_petmall: 'sign_petmall.png',
  mid_sign_seeyou: 'sign_seeyou.png',
  mid_sign_go: 'sign_go.png',
  mid_sign_noodle: 'sign_noodle.png',
  mid_sign_teahouse: 'sign_teahouse.png',
  mid_sign_baobao: 'sign_baobao.png',
  mid_sign_goldenwok: 'sign_goldenwok.png',
  mid_sign_luckydragon: 'sign_luckydragon.png',
  mid_sign_dimsum: 'sign_dimsum.png',
  mid_sign_jadepalace: 'sign_jadepalace.png',
  mid_sign_teagarden: 'sign_teagarden.png',
  mid_sign_baohouse: 'sign_baohouse.png',
  mid_sign_chevron: 'sign_chevron.png',
};
for (const [name, file] of Object.entries(midFiles)) {
  textures[name] = doc
    .createTexture(name)
    .setImage(readFileSync(join(MID_TEX_DIR, file)))
    .setMimeType('image/png');
}

// Banner cloth textures (start = original race_banner art; city = paw strip)
textures.mid_banner_start = doc
  .createTexture('mid_banner_start')
  .setImage(readFileSync(join(TEX, 'race_banner.png')))
  .setMimeType('image/png');
textures.mid_banner_paw = doc
  .createTexture('mid_banner_paw')
  .setImage(readFileSync(join(MID_TEX_DIR, 'banner_paw.png')))
  .setMimeType('image/png');
textures.mid_billboard_corgi = doc
  .createTexture('mid_billboard_corgi')
  .setImage(readFileSync(join(TEX, 'billboard_corgi.png')))
  .setMimeType('image/png');
textures.mid_billboard_panda = doc
  .createTexture('mid_billboard_panda')
  .setImage(readFileSync(join(TEX, 'billboard_panda.png')))
  .setMimeType('image/png');

// Original mall material maps (copied into mid_tex name keys)
const mallFromOriginal = {
  mid_mall_floor: 'tex_mall_floor.png',
  mid_mall_wood: 'tex_wood_wall.png',
  mid_mall_concrete: 'tex_concrete.png',
  mid_mall_view: 'tex_window_view.png',
};
for (const [name, file] of Object.entries(mallFromOriginal)) {
  const src = join(TEX, file);
  textures[name] = doc
    .createTexture(name)
    .setImage(readFileSync(src))
    .setMimeType('image/png');
}

const canon = new Map();
const remap = new Map();
let midKept = 0;
for (const mat of root.listMaterials()) {
  const name = mat.getName() || '';
  const c = mat.getBaseColorFactor();
  const em = mat.getEmissiveFactor?.() || [0, 0, 0];
  const eKey = em[0] + em[1] + em[2] > 0.01 ? 1 : 0;

  // Midground: keep UNIQUE named mats + inject PNG (never merge into skyline solids)
  if (name.startsWith('mid_')) {
    const key = `mid:${name}`;
    if (!canon.has(key)) {
      if (textures[name]) {
        mat.setBaseColorTexture(textures[name]);
        mat.setBaseColorFactor([1, 1, 1, 1]);
      }
      mat.setName(name);
      canon.set(key, mat);
      midKept += 1;
    }
    remap.set(mat, canon.get(key));
    continue;
  }

  const kind = matchKind(c);
  const key = kind ? `tex:${kind}|e${eKey}` : colorKey(c, eKey);
  if (!canon.has(key)) {
    if (kind) {
      mat.setBaseColorTexture(textures[kind]);
      mat.setBaseColorFactor([1, 1, 1, 1]);
      mat.setName(kind);
    } else {
      mat.setName(`col_${key}`);
    }
    canon.set(key, mat);
  }
  remap.set(mat, canon.get(key));
}
console.log('Midground textured mats kept', midKept);

for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const m = prim.getMaterial();
    if (m && remap.has(m)) prim.setMaterial(remap.get(m));
  }
}
for (const mat of [...root.listMaterials()]) {
  if (![...canon.values()].includes(mat)) mat.dispose();
}

// Expand every mesh NODE with its world matrix (handles shared mesh instances).
const buckets = new Map();
let instanceCount = 0;
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const world = worldMatrix(node);
  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial();
    if (!mat) continue;
    const raw = readPrim(prim);
    if (!raw) continue;
    const data = transformPrim(raw, world);
    let b = buckets.get(mat);
    if (!b) b = { pos: [], nrm: [], uv: [], idx: [], hasNrm: !!data.nrm, hasUv: !!data.uv };
    buckets.set(mat, b);
    const base = b.pos.length / 3;
    b.pos.push(...data.pos);
    if (data.nrm && b.hasNrm) b.nrm.push(...data.nrm);
    else b.hasNrm = false;
    if (data.uv && b.hasUv) b.uv.push(...data.uv);
    else b.hasUv = false;
    for (const i of data.idx) b.idx.push(i + base);
    instanceCount++;
  }
}

// Drop degenerate zero-thickness sheets (floating "brown plates" in sky).
for (const [mat, b] of [...buckets.entries()]) {
  let min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < b.pos.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], b.pos[i + k]);
      max[k] = Math.max(max[k], b.pos[i + k]);
    }
  }
  const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const thin = Math.min(...size);
  if (thin < 0.055 && Math.max(...size) > 3.5) {
    console.log('Drop degenerate sheet', mat.getName(), 'size', size.map((x) => +x.toFixed(2)));
    buckets.delete(mat);
  }
}
console.log('Expanded mesh instances', instanceCount, 'material buckets', buckets.size);

const scene = root.listScenes()[0];
for (const child of [...scene.listChildren()]) scene.removeChild(child);
for (const node of [...root.listNodes()]) node.dispose();
for (const mesh of [...root.listMeshes()]) mesh.dispose();

const pairs = [];
let mi = 0;
for (const [mat, b] of buckets) {
  const name = mat.getName() || `part_${mi}`;
  const mesh = doc.createMesh(name);
  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(b.pos)))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(b.idx)))
    .setMaterial(mat);
  if (b.hasNrm && b.nrm.length)
    prim.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(b.nrm)));
  if (b.hasUv && b.uv.length)
    prim.setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(b.uv)));

  // Ensure asphalt / sidewalk faces +Y (ribbon bake often winds normals downward)
  if (name === 'sidewalk' || name === 'asphalt') {
    const nrm = prim.getAttribute('NORMAL');
    if (nrm) {
      const n = nrm.getArray();
      let sumY = 0,
        c = 0;
      for (let i = 1; i < n.length; i += 3) {
        sumY += n[i];
        c++;
      }
      if (c && sumY / c < 0) {
        const idx = prim.getIndices().getArray();
        for (let i = 0; i < idx.length; i += 3) {
          const tmp = idx[i + 1];
          idx[i + 1] = idx[i + 2];
          idx[i + 2] = tmp;
        }
        prim.getIndices().setArray(idx);
        for (let i = 0; i < n.length; i++) n[i] = -n[i];
        nrm.setArray(n);
      }
    }
  }

  mesh.addPrimitive(prim);
  scene.addChild(doc.createNode(`RacePart_${mi}`).setMesh(mesh));
  pairs.push({ meshIndex: mi, matIndex: mi, name });
  mi++;
}

// Drop orphan materials not referenced by the merged parts (importer otherwise
// emits mesh/mat count mismatch vs race-pairs.json).
const usedMats = new Set(buckets.keys());
for (const mat of [...root.listMaterials()]) {
  if (!usedMats.has(mat)) mat.dispose();
}

const out = await io.writeBinary(doc);
writeFileSync(DST, out);
writeFileSync(join(ASSETS, 'race-pairs.json'), JSON.stringify(pairs, null, 2));
console.log('Wrote', DST, `${(out.byteLength / 1e6).toFixed(2)}MB`, 'parts', mi);
