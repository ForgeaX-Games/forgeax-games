import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '/tmp/go-karts-bake-deps/node_modules/@napi-rs/canvas/index.js';
import { MeshoptSimplifier } from '/tmp/go-karts-bake-deps/node_modules/meshoptimizer/meshopt_simplifier.js';
import {
  NodeIO,
  VertexLayout,
} from '/tmp/go-karts-bake-deps/node_modules/@gltf-transform/core/dist/index.js';
import { ALL_EXTENSIONS } from '/tmp/go-karts-bake-deps/node_modules/@gltf-transform/extensions/dist/index.js';
import {
  simplify,
  weld,
} from '/tmp/go-karts-bake-deps/node_modules/@gltf-transform/functions/dist/index.js';

const assets = fileURLToPath(new URL('../assets/', import.meta.url));
const pets = ['pet_duck', 'pet_panda'];
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .setVertexLayout(VertexLayout.SEPARATE);

await MeshoptSimplifier.ready;

for (const name of pets) {
  const source = `${assets}${name}.glb`;
  const output = `${assets}${name}.optimized.glb`;
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

  await document.transform(
    weld(),
    simplify({
      simplifier: MeshoptSimplifier,
      ratio: 0.06,
      error: 0.002,
    }),
  );
  await io.write(output, document);

  const primitive = document.getRoot().listMeshes()[0]?.listPrimitives()[0];
  console.log(name, {
    vertices: primitive?.getAttribute('POSITION')?.getCount(),
    indices: primitive?.getIndices()?.getCount(),
    texture: document.getRoot().listTextures()[0]?.getSize(),
  });
}
