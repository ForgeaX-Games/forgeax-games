import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packPath = resolve(root, 'assets/sundering-world-forms.pack.json');
const pack = JSON.parse(readFileSync(packPath, 'utf8'));
const materialPack = JSON.parse(readFileSync(resolve(root, 'assets/sundering-world-materials.pack.json'), 'utf8'));
const errors = [];
const guids = new Set();

if (pack.schemaVersion !== '2.0.0' || pack.kind !== 'internal-text-package') errors.push('pack header is not Pack v2 internal-text-package');
if (pack.assets?.length !== 10) errors.push(`expected 10 world mesh assets, found ${pack.assets?.length ?? 0}`);

for (const asset of pack.assets ?? []) {
  const mesh = asset.payload;
  if (guids.has(asset.guid)) errors.push(`${asset.guid}: duplicate GUID`);
  guids.add(asset.guid);
  if (asset.kind !== 'mesh') errors.push(`${asset.guid}: kind must be mesh`);
  if (!Array.isArray(mesh.vertices) || mesh.vertices.length % 12 !== 0) errors.push(`${asset.guid}: vertices must use 12-float stride`);
  const vertexCount = (mesh.vertices?.length ?? 0) / 12;
  if (!Array.isArray(mesh.indices) || mesh.indices.length % 3 !== 0) errors.push(`${asset.guid}: triangle indices malformed`);
  if (mesh.indices?.some((index) => !Number.isInteger(index) || index < 0 || index >= vertexCount)) errors.push(`${asset.guid}: index outside vertex range`);
  if (mesh.attributes?.position?.length !== vertexCount * 3) errors.push(`${asset.guid}: position attribute mismatch`);
  if (mesh.attributes?.normal?.length !== vertexCount * 3) errors.push(`${asset.guid}: normal attribute mismatch`);
  if (mesh.attributes?.uv?.length !== vertexCount * 2) errors.push(`${asset.guid}: uv attribute mismatch`);
  if (mesh.attributes?.tangent?.length !== vertexCount * 4) errors.push(`${asset.guid}: tangent attribute mismatch`);
  if (mesh.submeshes?.length !== 1 || mesh.submeshes[0].indexCount !== mesh.indices.length) errors.push(`${asset.guid}: submesh coverage mismatch`);
  if (mesh.aabb?.length !== 6 || mesh.aabb.some((value) => !Number.isFinite(value))) errors.push(`${asset.guid}: invalid AABB`);
  if (mesh.vertices?.some((value) => !Number.isFinite(value))) errors.push(`${asset.guid}: non-finite vertex`);
  for (let index = 0; index < (mesh.indices?.length ?? 0); index += 3) {
    const a = mesh.indices[index] * 12;
    const b = mesh.indices[index + 1] * 12;
    const c = mesh.indices[index + 2] * 12;
    const ab = [mesh.vertices[b] - mesh.vertices[a], mesh.vertices[b + 1] - mesh.vertices[a + 1], mesh.vertices[b + 2] - mesh.vertices[a + 2]];
    const ac = [mesh.vertices[c] - mesh.vertices[a], mesh.vertices[c + 1] - mesh.vertices[a + 1], mesh.vertices[c + 2] - mesh.vertices[a + 2]];
    const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
    if (Math.hypot(...cross) < 1e-8) errors.push(`${asset.guid}: degenerate triangle ${index / 3}`);
  }
}

for (const file of ['rock.gltf', 'rock.gltf.meta.json', 'rock.bin', 'rock.png', 'rock.png.meta.json', 'LICENSE', 'ATTRIBUTION.md']) {
  try { readFileSync(resolve(root, `assets/world/rock/${file}`)); }
  catch { errors.push(`licensed rock source missing ${file}`); }
}
for (const file of ['albedo.png', 'albedo.png.meta.json', 'LICENSE', 'ATTRIBUTION.md']) {
  try { readFileSync(resolve(root, `assets/world/wall/${file}`)); }
  catch { errors.push(`licensed wall source missing ${file}`); }
}
const rockMaterial = materialPack.assets?.find((asset) => asset.guid === '5c4c2f30-955e-4ae6-b864-e10100000001');
if (rockMaterial?.payload?.values?.baseColorTexture !== '019ea6b1-7e5e-7e6e-99cc-147aeb8c56a8') errors.push('licensed rock material does not bind the authored albedo texture');
if (!rockMaterial?.refs?.includes('019ea6b1-7e5e-7e6e-99cc-147aeb8c56a8')) errors.push('licensed rock material refs omit the texture GUID');
const ruinMaterial = materialPack.assets?.find((asset) => asset.guid === '5c4c2f30-955e-4ae6-b864-e10100000002');
if (ruinMaterial?.payload?.values?.baseColorTexture !== '019ee3df-a90e-7104-825e-e6b61b50a306') errors.push('ruin masonry material does not bind the authored wall texture');
if (!ruinMaterial?.refs?.includes('019ee3df-a90e-7104-825e-e6b61b50a306')) errors.push('ruin masonry material refs omit the texture GUID');
const byGuid = new Map(pack.assets.map((asset) => [asset.guid, asset]));
if (byGuid.get('5c4c2f30-955e-4ae6-b864-e00100000002')?.payload?.aabb?.[4] < 0.49) errors.push('island shelf top does not align with box collider top');
if (byGuid.get('5c4c2f30-955e-4ae6-b864-e00100000003')?.payload?.aabb?.[4] < 0.49) errors.push('bridge deck top does not align with box collider top');
if (byGuid.get('5c4c2f30-955e-4ae6-b864-e00100000010')?.payload?.aabb?.[4] < 0.49) errors.push('licensed rock top does not align with box collider top');

if (errors.length > 0) {
  console.error(JSON.stringify({ ok: false, errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({
  ok: true,
  assets: pack.assets.length,
  vertices: pack.assets.reduce((sum, asset) => sum + asset.payload.vertices.length / 12, 0),
  triangles: pack.assets.reduce((sum, asset) => sum + asset.payload.indices.length / 3, 0),
  licensedRockGuid: '5c4c2f30-955e-4ae6-b864-e00100000010',
}));
