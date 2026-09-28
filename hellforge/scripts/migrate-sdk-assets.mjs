// One-time, idempotent source migration. Preserves GLB BIN bytes and all GUIDs.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '../assets');
const apply = process.argv.includes('--apply');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
for (const file of readdirSync(root, { recursive: true }).filter((f) => f.endsWith('.glb'))) {
  const path = resolve(root, file);
  const original = readFileSync(path);
  if (original.readUInt32LE(0) !== 0x46546c67) throw new Error('Invalid GLB: ' + file);
  const jsonLength = original.readUInt32LE(12);
  const json = JSON.parse(original.subarray(20, 20 + jsonLength).toString('utf8'));
  const changes = [];
  for (const [index, material] of (json.materials ?? []).entries()) {
    // These seven opaque stone modules were exported with white emission but
    // no emissive texture. Keep geometry/maps intact; stone must receive light.
    if (/^kit\/modules\/kit-(corner|doorframe|floor|pillar|rubble|trim|wall)\.glb$/.test(file)
      && !material.emissiveTexture && material.emissiveFactor?.some((x) => x !== 0)) {
      const before = material.emissiveFactor;
      material.emissiveFactor = [0, 0, 0];
      changes.push({ material: index, field: 'emissiveFactor', before, after: material.emissiveFactor });
    }
    const specular = material.extensions?.KHR_materials_specular;
    if (!specular?.specularColorFactor) continue;
    const before = specular.specularColorFactor;
    const after = before.map((x) => Math.max(0, Math.min(1, x)));
    if (before.some((x, i) => x !== after[i])) {
      specular.specularColorFactor = after;
      changes.push({ material: index, field: 'specularColorFactor', before, after });
    }
  }
  if (!changes.length) continue;
  const jsonBytes = Buffer.from(JSON.stringify(json));
  const paddedLength = Math.ceil(jsonBytes.length / 4) * 4;
  const tail = original.subarray(20 + jsonLength);
  const output = Buffer.alloc(20 + paddedLength + tail.length, 0x20);
  original.copy(output, 0, 0, 20);
  output.writeUInt32LE(output.length, 8);
  output.writeUInt32LE(paddedLength, 12);
  jsonBytes.copy(output, 20);
  tail.copy(output, 20 + paddedLength);
  if (apply) writeFileSync(path, output);
  console.log(JSON.stringify({ file, changes, applied: apply, beforeSha256: hash(original), afterSha256: hash(output), binaryUnchanged: true }));
}
