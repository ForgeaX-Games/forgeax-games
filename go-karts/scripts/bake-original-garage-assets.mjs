import { mkdirSync, writeFileSync } from 'node:fs';
import {
  createCanvas,
  ImageData,
  loadImage,
} from '/tmp/go-karts-bake-deps/node_modules/@napi-rs/canvas/index.js';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

const ORIGINAL =
  '/Users/you/Desktop/forgeax/forgeax-games/claude-fable-5-93/code_rounds/round-34/code/src/entities';
const OUT = new URL('../assets/original-garage/', import.meta.url);

globalThis.document ??= {
  createElement(name) {
    if (name !== 'canvas') throw new Error(`Unsupported bake element: ${name}`);
    return createCanvas(256, 256);
  },
};
globalThis.ImageData ??= ImageData;
globalThis.FileReader ??= class {
  result = null;
  onloadend = null;
  readAsArrayBuffer(blob) {
    return blob.arrayBuffer().then((value) => {
      this.result = value;
      this.onloadend?.({ target: this });
    });
  }
  readAsDataURL(blob) {
    return blob.arrayBuffer().then((value) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(value).toString('base64')}`;
      this.onloadend?.({ target: this });
    });
  }
};

const { KART_STYLES } = await import(`${ORIGINAL}/KartStyles.ts`);
const { KART_THEMES } = await import(`${ORIGINAL}/ToyKart.ts`);
const { ACCESSORIES } = await import(`${ORIGINAL}/Accessories.ts`);
const { createGarage } = await import(`${ORIGINAL}/Garage.ts`);

mkdirSync(OUT, { recursive: true });
const exporter = new GLTFExporter();

async function writeGlb(name, object) {
  const scene = new THREE.Scene();
  object.name = name;
  scene.add(object);
  scene.updateMatrixWorld(true);
  const glb = await exporter.parseAsync(scene, {
    binary: true,
    trs: true,
    onlyVisible: true,
    maxTextureSize: 1024,
  });
  writeFileSync(new URL(`${name}.glb`, OUT), Buffer.from(glb));
}

async function loadCanvasTexture(path, repeatX = 1, repeatY = 1) {
  const image = await loadImage(path);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  return texture;
}

const manifest = { karts: {}, accessories: {} };
// Use real mesh decals below because ForgeaX does not reliably preserve this
// generated CanvasTexture. The underlying body must stay white.
const dogTheme = { ...KART_THEMES.dog, spots: false };
for (const style of KART_STYLES) {
  const kart = style.build(dogTheme);
  if (style.id === 'box' || style.id === 'rocket') {
    // Flaps / fins / tape intentionally intersect. DoubleSide + emissive made
    // ForgeaX depth-sort strobe while the showroom rotates — keep single-sided
    // and rely on a slight polygon offset for decals instead.
    kart.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material)
        ? object.material
        : [object.material];
      for (const material of materials) {
        material.side = THREE.FrontSide;
        if (material.isMeshStandardMaterial) {
          material.emissive?.setHex?.(0);
          material.emissiveIntensity = 0;
          material.polygonOffset = true;
          material.polygonOffsetFactor = -1;
          material.polygonOffsetUnits = -1;
        }
      }
    });
  }
  // ForgeaX can drop the generated CanvasTexture on this material. Real mesh
  // decals preserve the original dalmatian body in every renderer backend.
  if (style.id === 'classic') {
    const spotMaterial = new THREE.MeshStandardMaterial({
      color: 0x252933,
      roughness: 0.72,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const spots = [
      [-0.42, 0.72, 1.01, 0.16, 0.11, -0.25],
      [0.35, 0.78, 1.05, 0.13, 0.18, 0.4],
      [-0.18, 0.98, 0.78, 0.12, 0.09, 0.1],
      [0.55, 0.54, 0.74, 0.11, 0.08, -0.3],
      [-0.56, 0.45, 0.7, 0.09, 0.13, 0.2],
      [0.1, 0.5, 1.17, 0.1, 0.07, -0.1],
    ];
    for (const [x, y, z, sx, sy, rz] of spots) {
      const decal = new THREE.Mesh(new THREE.CircleGeometry(1, 16), spotMaterial);
      decal.position.set(x, y, z);
      decal.scale.set(sx, sy, 1);
      decal.rotation.z = rz;
      kart.add(decal);
    }
  }
  const seat = kart.userData.seat;
  manifest.karts[style.id] = {
    label: style.name,
    seat: seat ? [seat.x, seat.y, seat.z] : [0, 0.55, -0.25],
  };
  await writeGlb(`kart-${style.id}`, kart);
  console.log('baked kart', style.id);
}

for (const accessory of ACCESSORIES) {
  const model = accessory.build();
  manifest.accessories[accessory.id] = {
    label: accessory.name,
    socket: accessory.socket,
  };
  await writeGlb(`accessory-${accessory.id}`, model);
  console.log('baked accessory', accessory.id);
}

const ORIGINAL_ASSETS =
  '/Users/you/Desktop/forgeax/forgeax-games/claude-fable-5-93/code_rounds/round-34/code/public/assets';
const concrete = await loadCanvasTexture(`${ORIGINAL_ASSETS}/tex_concrete.png`, 4, 3);
const metalScuff = await loadCanvasTexture(`${ORIGINAL_ASSETS}/tex_metal_scuff.png`, 2, 1);
const poster = await loadCanvasTexture(`${ORIGINAL_ASSETS}/race_banner.png`);
const garage = createGarage(concrete, metalScuff, poster).group;
const lights = [];
garage.traverse((object) => {
  if (object.isLight) lights.push(object);
});
for (const light of lights) light.parent?.remove(light);
// Canvas-text "91" is not portable across all ForgeaX import backends.
// Rebuild it as actual shallow geometry on the shutter.
const numberMaterial = new THREE.MeshStandardMaterial({
  color: 0xe9e6dc,
  roughness: 0.88,
  emissive: 0x262522,
  emissiveIntensity: 0.18,
});
// The stall number is painted signage. Building the "9" from a full torus made
// it stand 0.12 off the shutter and read as a donut hanging on the wall, so the
// whole group is squashed on Z. Keep NUMBER_RELIEF in sync with
// scripts/flatten-garage-number.mjs, which applies the same squash to the
// already-baked garage-original.glb.
const NUMBER_RELIEF = 0.2;
const stallNumber = new THREE.Group();
stallNumber.position.set(0, 0, -5.24);
stallNumber.scale.z = NUMBER_RELIEF;
garage.add(stallNumber);
const nineRing = new THREE.Mesh(
  new THREE.TorusGeometry(0.48, 0.12, 12, 28),
  numberMaterial,
);
nineRing.position.set(1.3, 2.72, 0);
stallNumber.add(nineRing);
const nineStem = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.82, 0.05), numberMaterial);
nineStem.position.set(1.64, 2.22, 0);
nineStem.rotation.z = -0.16;
stallNumber.add(nineStem);
const oneStem = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.45, 0.05), numberMaterial);
oneStem.position.set(2.42, 2.45, 0);
stallNumber.add(oneStem);
const oneTop = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.05), numberMaterial);
oneTop.position.set(2.23, 2.88, 0);
oneTop.rotation.z = -0.7;
stallNumber.add(oneTop);
await writeGlb('garage-original', garage);
console.log('baked original procedural garage');

writeFileSync(new URL('manifest.json', OUT), JSON.stringify(manifest, null, 2));
console.log('wrote', new URL('.', OUT).pathname);
