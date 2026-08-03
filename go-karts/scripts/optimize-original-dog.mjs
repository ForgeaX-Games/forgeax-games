import { renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '/tmp/go-karts-bake-deps/node_modules/@napi-rs/canvas/index.js';
import { MeshoptSimplifier } from '/tmp/go-karts-bake-deps/node_modules/meshoptimizer/meshopt_simplifier.js';
import { NodeIO, VertexLayout } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { simplify, weld } from '@gltf-transform/functions';

const source = fileURLToPath(new URL('../assets/original-garage/pet-dog.glb', import.meta.url));
const output = fileURLToPath(
  new URL('../assets/original-garage/pet-dog-optimized.glb', import.meta.url),
);
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .setVertexLayout(VertexLayout.SEPARATE);
const document = await io.read(source);

for (const texture of document.getRoot().listTextures()) {
  const image = await loadImage(Buffer.from(texture.getImage()));
  const max = 1024;
  const scale = Math.min(1, max / Math.max(image.width, image.height));
  const canvas = createCanvas(
    Math.max(1, Math.round(image.width * scale)),
    Math.max(1, Math.round(image.height * scale)),
  );
  canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
  texture.setImage(canvas.encodeSync('png')).setMimeType('image/png');
}

await MeshoptSimplifier.ready;
await document.transform(
  weld(),
  simplify({
    simplifier: MeshoptSimplifier,
    ratio: 0.06,
    error: 0.002,
  }),
);
await io.write(output, document);
renameSync(output, source);

const primitive = document.getRoot().listMeshes()[0]?.listPrimitives()[0];
console.log('optimized dog', {
  vertices: primitive?.getAttribute('POSITION')?.getCount(),
  indices: primitive?.getIndices()?.getCount(),
  texture: document.getRoot().listTextures()[0]?.getSize(),
});
