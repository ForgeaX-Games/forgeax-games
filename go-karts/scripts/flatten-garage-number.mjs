/**
 * Squash the shutter stall-number group in assets/original-garage/garage-original.glb.
 *
 * The "9" was baked from a full TorusGeometry, so it stood 0.12 proud of the
 * shutter and rendered as a 3D donut stuck on the garage wall. This rewrites
 * the group node's Z scale so the number reads as painted signage.
 *
 * Re-baking the garage from scratch needs the round-34 Three.js sources plus a
 * canvas backend, so this patches the shipped GLB in place instead. The bake
 * script applies the same NUMBER_RELIEF to the group it builds, so both paths
 * land on the same geometry.
 *
 * Re-run after any `git checkout` that restores garage-original.glb from LFS.
 * Idempotent. Usage: node scripts/flatten-garage-number.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const GLB = fileURLToPath(new URL('../assets/original-garage/garage-original.glb', import.meta.url));
const NUMBER_RELIEF = 0.2;
// Position of the baked stall-number group on the shutter.
const NUMBER_ORIGIN = [1.3, 2.72, -5.24];
const EPS = 1e-4;

const JSON_CHUNK = 0x4e4f534a;

function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path} is not a GLB`);
  const chunks = [];
  let offset = 12;
  while (offset < buf.length) {
    const length = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    chunks.push({ type, data: buf.subarray(offset + 8, offset + 8 + length) });
    offset += 8 + length;
    offset += (4 - (offset % 4)) % 4;
  }
  return chunks;
}

function writeGlb(path, chunks) {
  const parts = [];
  let total = 12;
  for (const chunk of chunks) {
    const pad = (4 - (chunk.data.length % 4)) % 4;
    const header = Buffer.alloc(8);
    header.writeUInt32LE(chunk.data.length + pad, 0);
    header.writeUInt32LE(chunk.type, 4);
    // JSON pads with spaces, BIN pads with zeroes.
    const padding = Buffer.alloc(pad, chunk.type === JSON_CHUNK ? 0x20 : 0x00);
    parts.push(header, chunk.data, padding);
    total += 8 + chunk.data.length + pad;
  }
  const head = Buffer.alloc(12);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  writeFileSync(path, Buffer.concat([head, ...parts]));
}

const chunks = readGlb(GLB);
const jsonChunk = chunks.find((chunk) => chunk.type === JSON_CHUNK);
if (!jsonChunk) throw new Error('GLB has no JSON chunk');
const gltf = JSON.parse(jsonChunk.data.toString('utf8'));

const matches = gltf.nodes.filter((node) =>
  node.translation?.every((value, axis) => Math.abs(value - NUMBER_ORIGIN[axis]) < EPS),
);
if (matches.length !== 1) {
  throw new Error(
    `expected exactly one node at ${NUMBER_ORIGIN.join(',')}, found ${matches.length}`,
  );
}

const [node] = matches;
if (node.scale && Math.abs(node.scale[2] - NUMBER_RELIEF) < EPS) {
  console.log('[flatten-garage-number] already flattened, nothing to do');
  process.exit(0);
}
if (node.matrix) throw new Error('stall-number node uses a matrix; TRS patch would be lost');

node.scale = [1, 1, NUMBER_RELIEF];
jsonChunk.data = Buffer.from(JSON.stringify(gltf), 'utf8');
writeGlb(GLB, chunks);
console.log(`[flatten-garage-number] stall number squashed to ${NUMBER_RELIEF} depth`);
