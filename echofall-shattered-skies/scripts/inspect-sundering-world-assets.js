(function () {
  const mesh = gateway.assetCatalog({ compatibleWith: 'MeshAsset' });
  const texture = gateway.assetCatalog({ compatibleWith: 'TextureAsset' });
  const all = gateway.assetCatalog();
  const named = query({ with: ['Name'] }).rows;
  const meshRows = query({ with: ['Name', 'MeshFilter'] }).rows;
  const rendererRows = query({ with: ['Name', 'MeshRenderer'] }).rows;
  const rendererNames = new Set(rendererRows.map((row) => row.Name.value));
  const rendererByName = new Map(rendererRows.map((row) => [row.Name.value, row]));
  const visibilityByName = new Map(query({ with: ['Name', 'Visibility'] }).rows.map((row) => [row.Name.value, row.Visibility.state]));
  const storyRows = meshRows.filter((row) => /^Story/.test(row.Name.value));
  const sharedRaw = (value) => typeof value === 'number' ? value : value?.raw;
  const rowsOf = (result) => Array.isArray(result) ? result : (result.assets ?? result.compatible ?? []);
  const interesting = (rows) => rowsOf(rows).filter((row) => /rock|grass|wall|iron|sponza|sundering/i.test(`${row.name ?? ''} ${row.sourcePath ?? ''} ${row.sourceKey ?? ''}`));
  return {
    meshResultKeys: Object.keys(mesh),
    textureResultKeys: Object.keys(texture),
    totalCatalog: all.length,
    interestingMesh: interesting(mesh).map((row) => ({ guid: row.guid, name: row.name, sourcePath: row.sourcePath })),
    interestingTexture: interesting(texture).map((row) => ({ guid: row.guid, name: row.name, sourcePath: row.sourcePath })),
    authoredWorldForms: all.filter((row) => /^5c4c2f30-955e-4ae6-b864-e001000000(0[1-9]|10)$/i.test(row.guid)).map((row) => row.guid),
    importedRock: all.filter((row) => /^019ea6af-9d77-7776-9e32-58b/.test(row.guid)).map((row) => ({ guid: row.guid, kind: row.kind, sourceKey: row.sourceKey })),
    scene: {
      entities: named.length,
      story: named.filter((row) => /^Story/.test(row.Name.value)).length,
      storyHidden: storyRows.filter((row) => visibilityByName.get(row.Name.value) === 1).length,
      storyZeroMeshHandles: storyRows.filter((row) => !(sharedRaw(row.MeshFilter.assetHandle) > 0)).length,
      storyZeroMaterialHandles: storyRows.filter((row) => !(sharedRaw(rendererByName.get(row.Name.value)?.MeshRenderer.materials?.[0]) > 0)).length,
      storySamples: storyRows.slice(0, 5).map((row) => ({
        name: row.Name.value,
        mesh: row.MeshFilter.assetHandle,
        material: rendererByName.get(row.Name.value)?.MeshRenderer.materials?.[0],
        visibility: visibilityByName.get(row.Name.value),
      })),
      cliffsMissingRenderer: meshRows.filter((row) => /^Cliff/.test(row.Name.value) && !rendererNames.has(row.Name.value)).length,
      bindingSamples: meshRows.slice(0, 8).map((row) => ({ name: row.Name.value, mesh: row.MeshFilter.assetHandle })),
      revision: named.find((row) => /^(WorldAssetRevision|WorldAssetBindingOffset)_/.test(row.Name.value))?.Name.value,
      staticColliders: query({ with: ['Collider', 'MeshFilter'] }).rows.length,
      particlePlayers: query({ with: ['ParticleEffectPlayer'] }).rows.length,
      meshFilters: meshRows.length,
      meshZeroHandles: meshRows.filter((row) => !(sharedRaw(row.MeshFilter.assetHandle) > 0)).length,
      renderers: rendererRows.length,
      materialZeroHandles: rendererRows.filter((row) => {
        const materials = row.MeshRenderer.materials;
        return !Array.isArray(materials) || materials.length === 0 || !(sharedRaw(materials[0]) > 0);
      }).length,
    },
  };
})()
