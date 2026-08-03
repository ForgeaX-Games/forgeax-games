import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';

const DIR = fileURLToPath(new URL('../assets/original-garage/', import.meta.url));
const io = new NodeIO();
const sceneGuids = {};

for (const file of readdirSync(DIR).filter((name) => name.endsWith('.glb')).sort()) {
  const path = `${DIR}/${file}`;
  const metaPath = `${path}.meta.json`;
  const old = existsSync(metaPath)
    ? JSON.parse(readFileSync(metaPath, 'utf8'))
    : { subAssets: [] };
  const guidFor = (kind, sourceIndex) =>
    old.subAssets.find((asset) => asset.kind === kind && asset.sourceIndex === sourceIndex)
      ?.guid ?? randomUUID();

  const document = await io.read(path);
  const root = document.getRoot();
  const counts = {
    mesh: root.listMeshes().length,
    material: root.listMaterials().length,
    scene: root.listScenes().length,
    texture: root.listTextures().length,
  };
  const subAssets = [];
  for (const kind of ['mesh', 'material', 'scene', 'texture']) {
    for (let sourceIndex = 0; sourceIndex < counts[kind]; sourceIndex++) {
      subAssets.push({ guid: guidFor(kind, sourceIndex), kind, sourceIndex });
    }
  }
  const meta = {
    importSettings: {
      defaultSceneIndex: 0,
      diagnostics: {
        matrixTrsCoexistNodes: [],
        nodeNames: root.listNodes().map((node) => node.getName()),
        unsupportedExtensions: [],
      },
    },
    importer: 'gltf',
    kind: 'external-asset-package',
    schemaVersion: 1,
    source: file,
    subAssets,
  };
  writeFileSync(metaPath, `${JSON.stringify(meta, null, 2)}\n`);
  sceneGuids[file.replace(/\.glb$/, '')] = subAssets.find((asset) => asset.kind === 'scene')
    ?.guid;
  console.log(file, counts, sceneGuids[file.replace(/\.glb$/, '')]);
}

writeFileSync(`${DIR}/scene-guids.json`, `${JSON.stringify(sceneGuids, null, 2)}\n`);
