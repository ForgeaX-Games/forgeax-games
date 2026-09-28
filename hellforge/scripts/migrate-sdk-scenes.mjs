// Idempotent authoring migration: stable keyed scenes, renderer-owned batches.
// Run after a legacy scene bake. No geometry, asset GUID or refs order changes.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Materials } from '@forgeax/engine/render';
const root = resolve(import.meta.dirname, '../assets');
const batchPath = resolve(root, 'scenes/slagdeep.instances.json');
const batches = existsSync(batchPath) ? JSON.parse(readFileSync(batchPath, 'utf8')) : {};
for (const file of readdirSync(root, { recursive: true }).filter((f) => f.endsWith('.pack.json'))) {
  const path = resolve(root, file);
  const pack = JSON.parse(readFileSync(path, 'utf8'));
  let changed = false;
  for (const asset of pack.assets ?? []) {
    if (asset.kind === 'material') {
      const material = asset.payload;
      const forward = material?.passes?.find((pass) => pass.renderState?.tags?.LightMode === 'Forward');
      const module = forward?.program?.module;
      if (module === 'forgeax::default-standard-pbr' || module === 'forgeax::default-unlit') {
        const values = material.values ?? {};
        const renderState = structuredClone(forward.renderState ?? {});
        if (renderState.tags) delete renderState.tags.LightMode;
        const options = { ...values, renderState,
          castShadow: material.passes.some((pass) => pass.renderState?.tags?.LightMode === 'ShadowCaster') };
        const migrated = module === 'forgeax::default-standard-pbr'
          ? Materials.standard({ ...options, baseColor: values.baseColor ?? [1, 1, 1, 1] })
          : Materials.unlit(values.baseColor ?? [1, 1, 1, 1], options);
        asset.payload = { ...migrated, values: { ...migrated.values, ...values } };
        changed = true;
      }
      for (const pass of asset.payload?.passes ?? []) {
        const normalized = { Forward: 'forward', Deferred: 'deferred', ShadowCaster: 'shadow-caster' }[pass.name];
        if (normalized) { pass.name = normalized; changed = true; }
        const lightMode = { forward: 'Forward', deferred: 'Deferred', 'shadow-caster': 'ShadowCaster' }[pass.name];
        if (lightMode && pass.renderState?.tags?.LightMode !== lightMode) {
          pass.renderState = { ...pass.renderState, tags: { ...pass.renderState?.tags, LightMode: lightMode } };
          changed = true;
        }
      }
    }
    if (asset.kind !== 'scene' || !Array.isArray(asset.payload?.entities)) continue;
    const rows = asset.payload.entities;
    const keys = new Map(rows.map((row, index) => [row.localId ?? index, row.bindingKey ?? String(row.localId ?? index)]));
    const entities = {};
    for (const [index, row] of rows.entries()) {
      const key = keys.get(row.localId ?? index);
      if (entities[key]) throw new Error('Duplicate scene key: ' + file + ':' + key);
      const components = row.components;
      if (typeof components.ChildOf?.parent === 'number') components.ChildOf.parent = keys.get(components.ChildOf.parent);
      if (components.Children?.entities) components.Children.entities = components.Children.entities.map((id) => keys.get(id));
      const light = components.DirectionalLight;
      if (light && 'pcfKernelSize' in light) {
        light.shadowFilter = ({ 1: 1, 3: 2, 5: 3 })[light.pcfKernelSize] ?? 3;
        delete light.pcfKernelSize;
      }
      if (components.Instances?.transforms) {
        const name = components.Name?.value;
        if (!name) throw new Error('Baked batch requires a unique Name: ' + key);
        batches[name] = components.Instances.transforms;
        delete components.Instances;
      }
      entities[key] = { components, ...(row.instance ? { instance: row.instance } : {}) };
    }
    asset.payload.entities = entities;
    changed = true;
    console.log(JSON.stringify({ file, guid: asset.guid, entities: rows.length }));
  }
  if (changed) writeFileSync(path, JSON.stringify(pack, null, 2) + '\n');
}
writeFileSync(batchPath, JSON.stringify(batches) + '\n');
