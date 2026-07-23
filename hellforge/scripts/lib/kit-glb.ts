// Shared GLB packing + procedural stone textures for the antechamber kit.
// VertexLayout.SEPARATE (no interleaved byteStride) — engine parseGlb rejects
// gltf-transform interleaved views. Opaque PBR only (L4: no MASK, no emissive tex).

import { deflateSync } from 'node:zlib';

export type MeshArrays = {
  pos: Float32Array;
  nrm: Float32Array;
  uv: Float32Array;
  idx: Uint32Array;
};

export type Rgba = [number, number, number, number];

/** Minimal RGB PNG (8-bit, filter None). */
export function encodePngRgb(width: number, height: number, rgb: Uint8Array): Buffer {
  if (rgb.length !== width * height * 3) throw new Error('rgb length mismatch');
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter None
    rgb.copy(raw, row + 1, y * width * 3, (y + 1) * width * 3);
  }
  const compressed = deflateSync(raw);

  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc = (buf: Buffer): number => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const typeBuf = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const body = Buffer.concat([typeBuf, data]);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc(body), 0);
    return Buffer.concat([len, body, crcBuf]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Dark ash-stone albedo (AO baked into albedo via edge darkening). */
export function makeStoneAlbedoPng(size = 128, seed = 1): Buffer {
  const rgb = Buffer.alloc(size * size * 3);
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size;
      const ny = y / size;
      const n = 0.55 + 0.25 * Math.sin(nx * 17.1 + seed) * Math.cos(ny * 13.7)
        + 0.12 * rnd();
      const edge = Math.min(nx, ny, 1 - nx, 1 - ny);
      const ao = 0.72 + 0.28 * Math.min(1, edge * 8); // AO into albedo
      const r = Math.min(255, Math.floor((0.18 + n * 0.08) * ao * 255));
      const g = Math.min(255, Math.floor((0.14 + n * 0.06) * ao * 255));
      const b = Math.min(255, Math.floor((0.13 + n * 0.05) * ao * 255));
      const i = (y * size + x) * 3;
      rgb[i] = r;
      rgb[i + 1] = g;
      rgb[i + 2] = b;
    }
  }
  return encodePngRgb(size, size, rgb);
}

/** Subtle stone normal map (OpenGL-style, mostly +Z / up in tangent space). */
export function makeStoneNormalPng(size = 128, seed = 2): Buffer {
  const rgb = Buffer.alloc(size * size * 3);
  let s = seed >>> 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (rnd() - 0.5) * 0.35;
      const dy = (rnd() - 0.5) * 0.35;
      let nx = dx;
      let ny = dy;
      let nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 3;
      rgb[i] = Math.floor((nx * 0.5 + 0.5) * 255);
      rgb[i + 1] = Math.floor((ny * 0.5 + 0.5) * 255);
      rgb[i + 2] = Math.floor((nz * 0.5 + 0.5) * 255);
    }
  }
  return encodePngRgb(size, size, rgb);
}

function pushBox(
  out: { pos: number[]; nrm: number[]; uv: number[]; idx: number[] },
  min: [number, number, number],
  max: [number, number, number],
  uvScale = 1,
): void {
  // 6 faces, CCW from outside (engine culls back faces; no doubleSided reliance).
  const faces: Array<{
    corners: Array<[number, number, number]>;
    n: [number, number, number];
    uv: Array<[number, number]>;
  }> = [
    { // +Y
      corners: [[min[0], max[1], min[2]], [max[0], max[1], min[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]]],
      n: [0, 1, 0],
      uv: [[0, 0], [uvScale, 0], [uvScale, uvScale], [0, uvScale]],
    },
    { // -Y
      corners: [[min[0], min[1], max[2]], [max[0], min[1], max[2]], [max[0], min[1], min[2]], [min[0], min[1], min[2]]],
      n: [0, -1, 0],
      uv: [[0, 0], [uvScale, 0], [uvScale, uvScale], [0, uvScale]],
    },
    { // +Z
      corners: [[min[0], min[1], max[2]], [min[0], max[1], max[2]], [max[0], max[1], max[2]], [max[0], min[1], max[2]]],
      n: [0, 0, 1],
      uv: [[0, 0], [0, uvScale], [uvScale, uvScale], [uvScale, 0]],
    },
    { // -Z
      corners: [[max[0], min[1], min[2]], [max[0], max[1], min[2]], [min[0], max[1], min[2]], [min[0], min[1], min[2]]],
      n: [0, 0, -1],
      uv: [[0, 0], [0, uvScale], [uvScale, uvScale], [uvScale, 0]],
    },
    { // +X
      corners: [[max[0], min[1], max[2]], [max[0], max[1], max[2]], [max[0], max[1], min[2]], [max[0], min[1], min[2]]],
      n: [1, 0, 0],
      uv: [[0, 0], [0, uvScale], [uvScale, uvScale], [uvScale, 0]],
    },
    { // -X
      corners: [[min[0], min[1], min[2]], [min[0], max[1], min[2]], [min[0], max[1], max[2]], [min[0], min[1], max[2]]],
      n: [-1, 0, 0],
      uv: [[0, 0], [0, uvScale], [uvScale, uvScale], [uvScale, 0]],
    },
  ];
  for (const f of faces) {
    const base = out.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      const c = f.corners[i]!;
      out.pos.push(c[0], c[1], c[2]);
      out.nrm.push(f.n[0], f.n[1], f.n[2]);
      out.uv.push(f.uv[i]![0], f.uv[i]![1]);
    }
    out.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}

export function meshFloor(): MeshArrays {
  const o = { pos: [] as number[], nrm: [] as number[], uv: [] as number[], idx: [] as number[] };
  // 2×2 tile; top at y=0 (walk plane), thickness 0.12
  pushBox(o, [-1, -0.12, -1], [1, 0, 1], 1);
  return toArrays(o);
}

export function meshWall(): MeshArrays {
  const o = { pos: [] as number[], nrm: [] as number[], uv: [] as number[], idx: [] as number[] };
  // 2m run × 3.2m tall × 0.35m thick; centered on XZ, base at y=0
  pushBox(o, [-1, 0, -0.175], [1, 3.2, 0.175], 1.2);
  return toArrays(o);
}

export function meshCorner(): MeshArrays {
  const o = { pos: [] as number[], nrm: [] as number[], uv: [] as number[], idx: [] as number[] };
  // L-corner: two wall segments meeting at origin
  pushBox(o, [-1, 0, -0.175], [0.175, 3.2, 0.175], 1.2);
  pushBox(o, [-0.175, 0, -1], [0.175, 3.2, 0.175], 1.2);
  return toArrays(o);
}

export function meshDoorframe(): MeshArrays {
  const o = { pos: [] as number[], nrm: [] as number[], uv: [] as number[], idx: [] as number[] };
  const t = 0.28;
  const h = 3.0;
  const w = 2.2;
  const opening = 1.4;
  // left / right posts + lintel
  pushBox(o, [-w / 2, 0, -t / 2], [-opening / 2, h, t / 2], 1);
  pushBox(o, [opening / 2, 0, -t / 2], [w / 2, h, t / 2], 1);
  pushBox(o, [-w / 2, h - 0.35, -t / 2], [w / 2, h + 0.15, t / 2], 1);
  return toArrays(o);
}

export function meshPillar(): MeshArrays {
  const o = { pos: [] as number[], nrm: [] as number[], uv: [] as number[], idx: [] as number[] };
  pushBox(o, [-0.28, 0, -0.28], [0.28, 3.4, 0.28], 1.4);
  // capital / base pads
  pushBox(o, [-0.38, 0, -0.38], [0.38, 0.18, 0.38], 0.5);
  pushBox(o, [-0.36, 3.2, -0.36], [0.36, 3.4, 0.36], 0.5);
  return toArrays(o);
}

export function meshTrim(): MeshArrays {
  const o = { pos: [] as number[], nrm: [] as number[], uv: [] as number[], idx: [] as number[] };
  // Horizontal cornice ledge for 2m wall run
  pushBox(o, [-1, 0, -0.22], [1, 0.18, 0.22], 1);
  return toArrays(o);
}

export function meshRubble(): MeshArrays {
  const o = { pos: [] as number[], nrm: [] as number[], uv: [] as number[], idx: [] as number[] };
  pushBox(o, [-0.55, 0, -0.4], [0.1, 0.22, 0.35], 0.8);
  pushBox(o, [-0.15, 0, -0.5], [0.55, 0.14, 0.2], 0.7);
  pushBox(o, [0.05, 0, 0.05], [0.45, 0.28, 0.5], 0.6);
  return toArrays(o);
}

function toArrays(o: { pos: number[]; nrm: number[]; uv: number[]; idx: number[] }): MeshArrays {
  return {
    pos: new Float32Array(o.pos),
    nrm: new Float32Array(o.nrm),
    uv: new Float32Array(o.uv),
    idx: new Uint32Array(o.idx),
  };
}

export function packTexturedGlb(opts: {
  name: string;
  mesh: MeshArrays;
  albedoPng: Buffer;
  normalPng: Buffer;
  baseColorFactor?: Rgba;
  metallic?: number;
  roughness?: number;
  generator?: string;
}): Buffer {
  const { pos, nrm, uv, idx } = opts.mesh;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    minX = Math.min(minX, pos[i]!); maxX = Math.max(maxX, pos[i]!);
    minY = Math.min(minY, pos[i + 1]!); maxY = Math.max(maxY, pos[i + 1]!);
    minZ = Math.min(minZ, pos[i + 2]!); maxZ = Math.max(maxZ, pos[i + 2]!);
  }

  const posBytes = Buffer.from(pos.buffer, pos.byteOffset, pos.byteLength);
  const uvBytes = Buffer.from(uv.buffer, uv.byteOffset, uv.byteLength);
  const nrmBytes = Buffer.from(nrm.buffer, nrm.byteOffset, nrm.byteLength);
  const idxBytes = Buffer.from(idx.buffer, idx.byteOffset, idx.byteLength);
  const bin = Buffer.concat([posBytes, uvBytes, nrmBytes, idxBytes, opts.albedoPng, opts.normalPng]);

  let o = 0;
  const posOff = o; o += posBytes.length;
  const uvOff = o; o += uvBytes.length;
  const nrmOff = o; o += nrmBytes.length;
  const idxOff = o; o += idxBytes.length;
  const albedoOff = o; o += opts.albedoPng.length;
  const normalOff = o;

  const gltf = {
    asset: { version: '2.0', generator: opts.generator ?? 'hellforge-bake-kit-antechamber' },
    buffers: [{ byteLength: bin.length }],
    bufferViews: [
      { buffer: 0, byteOffset: posOff, byteLength: posBytes.length, target: 34962 },
      { buffer: 0, byteOffset: uvOff, byteLength: uvBytes.length, target: 34962 },
      { buffer: 0, byteOffset: nrmOff, byteLength: nrmBytes.length, target: 34962 },
      { buffer: 0, byteOffset: idxOff, byteLength: idxBytes.length, target: 34963 },
      { buffer: 0, byteOffset: albedoOff, byteLength: opts.albedoPng.length },
      { buffer: 0, byteOffset: normalOff, byteLength: opts.normalPng.length },
    ],
    accessors: [
      {
        bufferView: 0, componentType: 5126, count: pos.length / 3, type: 'VEC3',
        min: [minX, minY, minZ], max: [maxX, maxY, maxZ],
      },
      { bufferView: 1, componentType: 5126, count: uv.length / 2, type: 'VEC2' },
      { bufferView: 2, componentType: 5126, count: nrm.length / 3, type: 'VEC3' },
      { bufferView: 3, componentType: 5125, count: idx.length, type: 'SCALAR' },
    ],
    images: [
      { mimeType: 'image/png', bufferView: 4, name: `${opts.name}-albedo` },
      { mimeType: 'image/png', bufferView: 5, name: `${opts.name}-normal` },
    ],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    textures: [
      { sampler: 0, source: 0 },
      { sampler: 0, source: 1 },
    ],
    materials: [{
      name: `${opts.name}-mat`,
      alphaMode: 'OPAQUE',
      pbrMetallicRoughness: {
        baseColorFactor: opts.baseColorFactor ?? [1, 1, 1, 1],
        baseColorTexture: { index: 0, texCoord: 0 },
        metallicFactor: opts.metallic ?? 0.05,
        roughnessFactor: opts.roughness ?? 0.92,
      },
      normalTexture: { index: 1, texCoord: 0, scale: 1 },
      // L4: no emissiveTexture; factor-only emissive deferred to spawn if needed
    }],
    meshes: [{
      name: opts.name,
      primitives: [{
        attributes: { POSITION: 0, TEXCOORD_0: 1, NORMAL: 2 },
        indices: 3,
        material: 0,
      }],
    }],
    nodes: [{ name: opts.name, mesh: 0 }],
    scenes: [{ name: 'scene', nodes: [0] }],
    scene: 0,
  };

  const jsonStr = JSON.stringify(gltf);
  const jsonPad = (4 - (jsonStr.length % 4)) % 4;
  const jsonChunk = Buffer.alloc(jsonStr.length + jsonPad, 0x20);
  jsonChunk.write(jsonStr, 'utf8');
  const binPad = (4 - (bin.length % 4)) % 4;
  const binChunk = binPad === 0 ? bin : Buffer.concat([bin, Buffer.alloc(binPad)]);

  const totalLen = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
  const out = Buffer.alloc(totalLen);
  let w = 0;
  out.writeUInt32LE(0x46546c67, w); w += 4;
  out.writeUInt32LE(2, w); w += 4;
  out.writeUInt32LE(totalLen, w); w += 4;
  out.writeUInt32LE(jsonChunk.length, w); w += 4;
  out.write('JSON', w, 4, 'ascii'); w += 4;
  jsonChunk.copy(out, w); w += jsonChunk.length;
  out.writeUInt32LE(binChunk.length, w); w += 4;
  out.write('BIN\x00', w, 4, 'ascii'); w += 4;
  binChunk.copy(out, w);
  return out;
}
