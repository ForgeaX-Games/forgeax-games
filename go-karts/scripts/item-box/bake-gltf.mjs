/**
 * Build item_box.gltf (+ .bin) with non-interleaved accessors for ForgeaX importer.
 */
import { Document, NodeIO } from '@gltf-transform/core';
import { readFileSync } from 'fs';

function boxMesh(doc) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  const faces = [
    { n: [0, 0, 1], v: [[-0.5, -0.5, 0.5], [0.5, -0.5, 0.5], [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5]] },
    { n: [0, 0, -1], v: [[0.5, -0.5, -0.5], [-0.5, -0.5, -0.5], [-0.5, 0.5, -0.5], [0.5, 0.5, -0.5]] },
    { n: [1, 0, 0], v: [[0.5, -0.5, 0.5], [0.5, -0.5, -0.5], [0.5, 0.5, -0.5], [0.5, 0.5, 0.5]] },
    { n: [-1, 0, 0], v: [[-0.5, -0.5, -0.5], [-0.5, -0.5, 0.5], [-0.5, 0.5, 0.5], [-0.5, 0.5, -0.5]] },
    { n: [0, 1, 0], v: [[-0.5, 0.5, 0.5], [0.5, 0.5, 0.5], [0.5, 0.5, -0.5], [-0.5, 0.5, -0.5]] },
    { n: [0, -1, 0], v: [[-0.5, -0.5, -0.5], [0.5, -0.5, -0.5], [0.5, -0.5, 0.5], [-0.5, -0.5, 0.5]] },
  ];
  const faceUV = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (const f of faces) {
    const base = positions.length / 3;
    for (let i = 0; i < 4; i++) {
      positions.push(...f.v[i]);
      normals.push(...f.n);
      uvs.push(...faceUV[i]);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const posAcc = doc
    .createAccessor('pos')
    .setType('VEC3')
    .setArray(new Float32Array(positions))
    .setBuffer(doc.createBuffer());
  const nrmAcc = doc
    .createAccessor('nrm')
    .setType('VEC3')
    .setArray(new Float32Array(normals))
    .setBuffer(doc.createBuffer());
  const uvAcc = doc
    .createAccessor('uv')
    .setType('VEC2')
    .setArray(new Float32Array(uvs))
    .setBuffer(doc.createBuffer());
  const idxAcc = doc
    .createAccessor('idx')
    .setType('SCALAR')
    .setArray(new Uint16Array(indices))
    .setBuffer(doc.createBuffer());

  const prim = doc
    .createPrimitive()
    .setAttribute('POSITION', posAcc)
    .setAttribute('NORMAL', nrmAcc)
    .setAttribute('TEXCOORD_0', uvAcc)
    .setIndices(idxAcc);
  return doc.createMesh('ItemBoxBody').addPrimitive(prim);
}

const doc = new Document();
const woodTex = doc
  .createTexture('wood_q')
  .setImage(readFileSync('./wood_q.png'))
  .setMimeType('image/png');

// No emissive — ForgeaX bloom makes glowing ? strobe as the crate spins.
// Yellow mark already lives in the baseColor wood_q / baseColor_1 atlas.
const mat = doc
  .createMaterial('ItemBoxMat')
  .setBaseColorTexture(woodTex)
  .setBaseColorFactor([1, 1, 1, 1])
  .setMetallicFactor(0.08)
  .setRoughnessFactor(0.72);

const mesh = boxMesh(doc);
mesh.listPrimitives()[0].setMaterial(mat);
doc.createScene('ItemBoxScene').addChild(doc.createNode('ItemBox').setMesh(mesh));

const io = new NodeIO();
// .gltf allows multiple buffers (non-interleaved) which ForgeaX import accepts.
await io.write('./item_box.gltf', doc);
console.log('wrote item_box.gltf');
