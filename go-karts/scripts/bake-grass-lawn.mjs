/**
 * Bake a tiled cartoon lawn GLB with REQUIRED sampler REPEAT.
 * Mirrors hellforge bake-ground.ts — sampler-less textures silently fail to
 * bind in ForgeaX and render as white baseColorFactor film.
 *
 * Prefer the Three.js original `tex_grass.png` (flowers + tufts, repeat≈34 on
 * a ~460m plane). Procedural tile is fallback only.
 *
 * Usage: node scripts/bake-grass-lawn.mjs
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { PNG } from 'pngjs';
import { buildGrassTilePng } from './midground-textures.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(__dirname, '..', 'assets');
const OUT_GLB = join(ASSETS, 'grass_lawn.glb');
const OUT_META = `${OUT_GLB}.meta.json`;
const ORIG_TEX = join(__dirname, 'ref', 'tex_grass.png');

// Match claude-fable MainScene: PlaneGeometry(460) + texture.repeat(34,34).
const GROUND_SIZE = 460;
const UV_REPEAT = 34;

const MESH_GUID = 'b1a11e00-0010-4000-8000-000000000001';
const MAT_GUID = 'b1a11e00-0010-4000-8000-000000000002';
const TEX_GUID = 'b1a11e00-0010-4000-8000-000000000003';
const SCENE_GUID = 'b1a11e00-0010-4000-8000-000000000004';

/** Brighter saturated tile closer to the original screenshot (less mint wash). */
function buildReferenceGrassPng(size = 512) {
  const w = size;
  const h = size;
  const data = Buffer.alloc(w * h * 4);
  const hash = (x, y) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const n0 = hash(((x % w) + w) % w, ((y % h) + h) % h);
      const n1 = hash(x * 0.31 + 9, y * 0.31 + 4);
      const n2 = hash(x * 1.7 + 2, y * 1.7 + 5);
      // Base ≈ original lime lawn (#5aae3c family), mottled.
      let r = 62 + n0 * 28 + n1 * 14;
      let g = 148 + n0 * 42 + n1 * 18;
      let b = 42 + n0 * 16;
      // Light speckles (the faint pattern in the reference shot).
      if (n2 > 0.72) {
        r = Math.min(255, r + 28);
        g = Math.min(255, g + 36);
        b = Math.min(255, b + 12);
      }
      // Darker flecks for depth.
      if (n0 > 0.9 && n1 < 0.4) {
        r *= 0.82;
        g *= 0.85;
        b *= 0.75;
      }
      const o = (y * w + x) * 4;
      data[o] = Math.min(255, Math.max(0, r));
      data[o + 1] = Math.min(255, Math.max(0, g));
      data[o + 2] = Math.min(255, Math.max(0, b));
      data[o + 3] = 255;
    }
  }
  // Sparse flower confetti (small, like original roadside beds — not neon clutter).
  const flowers = [
    [255, 130, 160],
    [255, 220, 80],
    [255, 170, 80],
    [245, 245, 250],
  ];
  for (let i = 0; i < 55; i++) {
    const fx = Math.floor(hash(i, 1.1) * w);
    const fy = Math.floor(hash(i, 2.2) * h);
    const rad = 1 + Math.floor(hash(i, 3.3) * 2);
    const rgb = flowers[i % flowers.length];
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dy * dy > rad * rad) continue;
        const x = ((fx + dx) % w + w) % w;
        const y = ((fy + dy) % h + h) % h;
        const o = (y * w + x) * 4;
        data[o] = rgb[0];
        data[o + 1] = rgb[1];
        data[o + 2] = rgb[2];
      }
    }
  }
  const png = new PNG({ width: w, height: h });
  png.data = data;
  return PNG.sync.write(png);
}

function buildGroundGlb(png) {
  const h = GROUND_SIZE / 2;
  // CCW from +Y so the top face is front-facing (engine culls backs).
  const pos = new Float32Array([-h, 0, -h, h, 0, -h, h, 0, h, -h, 0, h]);
  const uv = new Float32Array([0, 0, UV_REPEAT, 0, UV_REPEAT, UV_REPEAT, 0, UV_REPEAT]);
  const nrm = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
  const idx = new Uint32Array([0, 2, 1, 0, 3, 2]);

  const posBytes = Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength);
  const uvBytes = Buffer.from(uv.buffer, uv.byteOffset, uv.byteLength);
  const nrmBytes = Buffer.from(nrm.buffer, nrm.byteOffset, nrm.byteLength);
  const idxBytes = Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength);
  const bin = Buffer.concat([posBytes, uvBytes, nrmBytes, idxBytes, png]);

  const posOff = 0;
  const uvOff = posOff + posBytes.length;
  const nrmOff = uvOff + uvBytes.length;
  const idxOff = nrmOff + nrmBytes.length;
  const imgOff = idxOff + idxBytes.length;

  const gltf = {
    asset: { version: '2.0', generator: 'go-karts-bake-grass-lawn' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: posOff, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: uvOff, byteLength: uvBytes.length, target: 34962 },
      { buffer: 0, byteOffset: nrmOff, byteLength: nrmBytes.length, target: 34962 },
      { buffer: 0, byteOffset: idxOff, byteLength: idxBytes.length, target: 34963 },
      { buffer: 0, byteOffset: imgOff, byteLength: png.length },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5126,
        count: 4,
        type: 'VEC3',
        min: [-h, 0, -h],
        max: [h, 0, h],
      },
      { bufferView: 1, componentType: 5126, count: 4, type: 'VEC2' },
      { bufferView: 2, componentType: 5126, count: 4, type: 'VEC3' },
      { bufferView: 3, componentType: 5125, count: 6, type: 'SCALAR' },
    ],
    images: [{ name: 'grass_tile', mimeType: 'image/png', bufferView: 4 }],
    // REQUIRED — without sampler, ForgeaX binds white film.
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    textures: [{ name: 'grass_tile', sampler: 0, source: 0 }],
    materials: [
      {
        name: 'GrassLawnMat',
        pbrMetallicRoughness: {
          baseColorTexture: { index: 0, texCoord: 0 },
          // Richer than original 0xa8d878 — ForgeaX lighting reads greyer.
          baseColorFactor: [0.52, 0.86, 0.28, 1],
          metallicFactor: 0,
          roughnessFactor: 0.95,
        },
      },
    ],
    meshes: [
      {
        name: 'GrassLawn',
        primitives: [
          {
            attributes: { POSITION: 0, TEXCOORD_0: 1, NORMAL: 2 },
            indices: 3,
            material: 0,
          },
        ],
      },
    ],
    nodes: [{ name: 'GrassLawn', mesh: 0 }],
    scenes: [{ name: 'GrassLawnScene', nodes: [0] }],
    scene: 0,
  };

  const jsonStr = JSON.stringify(gltf);
  const jsonPad = (4 - (jsonStr.length % 4)) % 4;
  const jsonChunk = Buffer.alloc(jsonStr.length + jsonPad, 0x20);
  jsonChunk.write(jsonStr, 'utf8');
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk =
    binPad === 0 ? bin : Buffer.concat([bin, Buffer.alloc(binPad)]);

  const totalLen = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = Buffer.alloc(totalLen);
  let o = 0;
  out.writeUInt32LE(0x46546c67, o);
  o += 4;
  out.writeUInt32LE(2, o);
  o += 4;
  out.writeUInt32LE(totalLen, o);
  o += 4;
  out.writeUInt32LE(jsonChunk.length, o);
  o += 4;
  out.write('JSON', o, 4, 'ascii');
  o += 4;
  jsonChunk.copy(out, o);
  o += jsonChunk.length;
  out.writeUInt32LE(binChunk.length, o);
  o += 4;
  out.write('BIN\x00', o, 4, 'ascii');
  o += 4;
  binChunk.copy(out, o);
  return out;
}

if (!existsSync(ASSETS)) mkdirSync(ASSETS, { recursive: true });

// Prefer the hand-painted original tile (claude-fable dist/assets/tex_grass.png).
let png;
let albedoNote = 'procedural';
if (existsSync(ORIG_TEX)) {
  png = readFileSync(ORIG_TEX);
  // Keep albedo only inside the GLB — loose PNGs under assets/ trip integrity-repair.
  albedoNote = 'tex_grass.png (original)';
} else {
  try {
    png = buildReferenceGrassPng(512);
    albedoNote = 'procedural-reference';
  } catch {
    png = buildGrassTilePng(512);
    albedoNote = 'procedural-midground';
  }
}

const glb = buildGroundGlb(png);
writeFileSync(OUT_GLB, glb);

// Match working glTF sidecars (prop_*.glb.meta.json): no contentHash / sourceKey —
// those trip pack-malformed-meta and collapse the whole catalog to [].
const meta = {
  importSettings: {
    defaultSceneIndex: 0,
    diagnostics: {
      matrixTrsCoexistNodes: [],
      nodeNames: ['GrassLawn'],
      unsupportedExtensions: [],
    },
  },
  importer: 'gltf',
  kind: 'external-asset-package',
  schemaVersion: 1,
  source: 'grass_lawn.glb',
  subAssets: [
    { guid: MESH_GUID, kind: 'mesh', sourceIndex: 0 },
    { guid: MAT_GUID, kind: 'material', sourceIndex: 0 },
    { guid: SCENE_GUID, kind: 'scene', sourceIndex: 0 },
    { guid: TEX_GUID, kind: 'texture', sourceIndex: 0 },
  ],
};
writeFileSync(OUT_META, `${JSON.stringify(meta, null, 2)}\n`);

console.log(
  'Wrote',
  OUT_GLB,
  `${(glb.length / 1024).toFixed(1)}KB`,
  `UV 0–${UV_REPEAT}`,
  'size',
  GROUND_SIZE,
  'm',
  'albedo',
  albedoNote,
);
console.log('GUIDs mesh', MESH_GUID, 'mat', MAT_GUID);
