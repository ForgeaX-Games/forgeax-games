// Normalize meshy/hunyuan GLBs for the ForgeaX Tier-C gltf importer.
// Fixes applied (all baked into geometry so the importer needs zero extensions):
//   1. dequantize            -> drop KHR_mesh_quantization (v1 allowlist rejects it)
//   2. bake node transforms  -> mesh vertices become real-world scale/position
//                               (raw positions are 0..16383 in quantized space;
//                                the real scale lives on the node — bake it in so
//                                a direct MeshFilter ref at Transform.scale=1 is correct)
//   3. bake KHR_texture_transform into TEXCOORD_0 (importer ignores it -> broken
//      UVs / camo look; meshy uses scale ~16x so this is essential)
//   4. de-interleave (SEPARATE) -> importer needs dense fixed-stride accessors
//   5. KEEP glTF doubleSided=true — ForgeaX bridge maps it to cullMode:'none'.
//      Do NOT geometrically duplicate faces (coplanar z-fight looks like holes).
// Usage: bun _normalize_glb.mjs <in.glb> <out.glb>
import { NodeIO, VertexLayout } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dequantize, transformMesh } from '@gltf-transform/functions';

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  console.error('usage: bun _normalize_glb.mjs <in.glb> <out.glb>');
  process.exit(2);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).setVertexLayout(VertexLayout.SEPARATE);
const doc = await io.read(inPath);
const root = doc.getRoot();

await doc.transform(dequantize());

// ── 3. bake KHR_texture_transform into TEXCOORD_0 ──────────────────────────
// Walk each primitive; if its material's baseColor texture carries a transform,
// apply (uv * scale + offset, rotation) to that primitive's UV accessor once.
const bakedUV = new Set();
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial();
    if (!mat) continue;
    const ti = mat.getBaseColorTextureInfo();
    if (!ti) continue;
    const tt = ti.getExtension('KHR_texture_transform');
    if (!tt) continue;
    const uv = prim.getAttribute('TEXCOORD_0');
    if (!uv || bakedUV.has(uv)) continue;
    bakedUV.add(uv);
    const scale = tt.getScale ? tt.getScale() : [1, 1];
    const offset = tt.getOffset ? tt.getOffset() : [0, 0];
    const rot = tt.getRotation ? tt.getRotation() : 0;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const arr = uv.getArray();
    for (let i = 0; i < arr.length; i += 2) {
      const u = arr[i];
      const v = arr[i + 1];
      // glTF KHR_texture_transform: scale first, then rotate, then offset.
      const su = u * scale[0];
      const sv = v * scale[1];
      arr[i] = su * cos + sv * sin + offset[0];
      arr[i + 1] = -su * sin + sv * cos + offset[1];
    }
    uv.setArray(arr);
  }
}
// The transform is now baked into UVs; strip the extension so the importer sees
// a plain textured material.
for (const mat of root.listMaterials()) {
  const ti = mat.getBaseColorTextureInfo();
  if (ti && ti.getExtension('KHR_texture_transform')) ti.setExtension('KHR_texture_transform', null);
}
const ttExt = doc.getRoot().listExtensionsUsed().find((e) => e.extensionName === 'KHR_texture_transform');
if (ttExt) ttExt.dispose();

// ── 2. bake node transforms into mesh geometry, then reset nodes to identity ─
for (const node of root.listNodes()) {
  const mesh = node.getMesh();
  if (!mesh) continue;
  const m = node.getWorldMatrix();
  transformMesh(mesh, m);
  node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

const ds = root.listMaterials().filter((m) => m.getDoubleSided()).length;
if (ds) console.log(`  kept doubleSided on ${ds} material(s) (bridge -> cullMode none)`);

await io.write(outPath, doc);
console.log(`normalized ${inPath} -> ${outPath}`);
