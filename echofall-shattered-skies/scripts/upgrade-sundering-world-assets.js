(function () {
  const mesh = {
    crag: '5c4c2f30-955e-4ae6-b864-e00100000001',
    shelf: '5c4c2f30-955e-4ae6-b864-e00100000002',
    bridge: '5c4c2f30-955e-4ae6-b864-e00100000003',
    column: '5c4c2f30-955e-4ae6-b864-e00100000004',
    obelisk: '5c4c2f30-955e-4ae6-b864-e00100000005',
    crystal: '5c4c2f30-955e-4ae6-b864-e00100000006',
    halo: '5c4c2f30-955e-4ae6-b864-e00100000007',
    grass: '5c4c2f30-955e-4ae6-b864-e00100000008',
    rift: '5c4c2f30-955e-4ae6-b864-e00100000009',
    licensedRock: '5c4c2f30-955e-4ae6-b864-e00100000010',
  };
  const material = {
    basalt: '07b8795d-3392-4c38-9be4-b9ad073bf101',
    stone: '2fbcb8a1-65b8-47ef-9b64-6d80ace3f102',
    wet: 'a2c734a0-3308-42fc-b186-951751ce3103',
    bronze: '40e31cc7-e991-4b27-8cf3-e9de253e5104',
    cyan: 'cc0c6eaf-086b-4a02-b0d3-ea068b178105',
    amber: '6d901653-687b-4a21-997e-719544fcc106',
    foliage: '73bb908e-87b3-4673-b390-534e9e1cf107',
    mist: 'f3e5e31c-6e47-4b13-b44a-334b9af04108',
    void: '9007ba30-7c22-4d8c-af75-b8becff1c109',
    licensedRock: '5c4c2f30-955e-4ae6-b864-e10100000001',
    ruinMasonry: '5c4c2f30-955e-4ae6-b864-e10100000002',
  };
  const requiredAssets = [...Object.values(mesh), material.licensedRock, material.ruinMasonry];
  const catalog = gateway.assetCatalog();
  const missingAssets = requiredAssets.filter((guid) => !catalog.some((row) => row.guid === guid));
  if (missingAssets.length > 0) return { ok: false, reason: 'world asset catalog incomplete', missingAssets };

  const staticColliderCount = query({ with: ['Collider', 'MeshFilter'] }).rows.length;
  const particlePlayerCount = query({ with: ['ParticleEffectPlayer'] }).rows.length;
  if (staticColliderCount !== 64 || particlePlayerCount !== 3) {
    return { ok: false, reason: 'physics or VFX persistence invariant failed', staticColliderCount, particlePlayerCount };
  }

  const qY = (angle) => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
  const qX = (angle) => [Math.sin(angle / 2), 0, 0, Math.cos(angle / 2)];
  const qZ = (angle) => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
  const rows = query({ with: ['Name'] }).rows;
  const names = new Set(rows.map((row) => row.Name.value));
  const safeMeshSource = query({ with: ['Name', 'MeshFilter', 'MeshRenderer'] }).rows.find((row) => row.Name.value === 'BeaconCore_Dawn');
  if (!safeMeshSource) return { ok: false, reason: 'safe authored mesh placeholder missing' };
  // Component creation requires the opaque shared handle object (or a GUID),
  // not the runtime's numeric `.raw` slot.
  const safeMeshHandle = safeMeshSource.MeshFilter.assetHandle;
  const safeMaterialHandle = safeMeshSource.MeshRenderer.materials[0];
  let localId = -1;
  const story = [];
  const add = (name, pos, scale, quat, meshGuid, materialGuid) => story.push({ name, pos, scale, quat, meshGuid, materialGuid });

  // Three stacked cairns make the opening route feel inhabited and keep the
  // first turn legible without adding invisible collision walls.
  [
    ['01', -4.8, 24.2, -0.28],
    ['02', 3.9, 20.4, 0.34],
    ['03', -5.3, 15.7, -0.18],
  ].forEach(([id, x, z, turn], cairn) => {
    add(`StoryCairn_${id}_Base`, [x, 0.58 + cairn * 0.17, z], [1.35, 0.72, 1.05], qY(turn), mesh.licensedRock, material.licensedRock);
    add(`StoryCairn_${id}_Middle`, [x + 0.08, 1.18 + cairn * 0.17, z - 0.04], [0.86, 0.58, 0.76], qY(turn + 0.8), mesh.licensedRock, material.licensedRock);
    add(`StoryCairn_${id}_Crown`, [x - 0.04, 1.66 + cairn * 0.17, z], [0.48, 0.68, 0.44], qY(turn - 0.55), mesh.licensedRock, material.licensedRock);
  });

  // A broken monastery gate is the midground reveal. Its open centre frames
  // the first beacon from the S path instead of forming another solid wall.
  add('StoryGate_Monastery_Left', [-7.1, 4.5, 4.9], [1.3, 5.5, 1.35], qY(-0.08), mesh.column, material.ruinMasonry);
  add('StoryGate_Monastery_Right', [0.1, 4.3, 4.7], [1.2, 5.1, 1.3], qY(0.12), mesh.column, material.ruinMasonry);
  add('StoryGate_Monastery_Crown', [-3.55, 7.0, 4.8], [6.2, 1.0, 1.25], qZ(-0.055), mesh.bridge, material.ruinMasonry);

  // Fallen columns tell the story of the skyquake and break the repeated
  // upright silhouette without blocking the walkable ribbon.
  [
    ['01', [-9.4, 2.35, 0.0], [1.15, 4.8, 1.15], 1.33, material.ruinMasonry],
    ['02', [11.3, 4.0, -16.0], [1.0, 4.1, 1.0], -1.18, material.ruinMasonry],
    ['03', [-5.8, 5.1, -29.0], [1.2, 5.2, 1.2], 1.42, material.ruinMasonry],
    ['04', [6.8, 5.35, -34.8], [0.9, 3.8, 0.9], -1.27, material.bronze],
  ].forEach(([id, pos, scale, tilt, mat]) => add(`StoryFallenColumn_${id}`, pos, scale, qZ(tilt), mesh.column, mat));

  // Asymmetric waystones trace the full S: left at the monastery, right at
  // the observatory, then back to the altar. They are navigation grammar,
  // not a fence; every marker stays outside the traversal centreline.
  [
    ['01', [-6.8, 1.15, 12.0], 0.14], ['02', [-8.2, 2.15, 5.7], -0.18],
    ['03', [0.7, 2.55, -4.0], 0.22], ['04', [8.8, 3.95, -10.8], -0.12],
    ['05', [11.0, 4.75, -21.9], 0.18], ['06', [5.4, 4.85, -25.4], -0.16],
    ['07', [-4.7, 5.8, -27.7], 0.20], ['08', [-6.2, 6.3, -34.0], -0.15],
  ].forEach(([id, pos, turn], index) => add(`StoryWaystone_${id}`, pos, [0.8 + (index % 3) * 0.12, 2.6 + (index % 2) * 0.55, 0.8], qY(turn), mesh.obelisk, index < 4 ? material.bronze : material.wet));

  // Crystal gardens sit at each reveal edge, giving the cyan objective color
  // a grounded source rather than leaving it as floating UI/VFX language.
  [
    [-8.0, 1.4, 20.6, 0.32], [5.8, 1.35, 18.8, 0.42], [-9.8, 2.3, 2.7, 0.55],
    [3.0, 2.55, 1.0, 0.38], [12.2, 4.2, -18.5, 0.62], [3.2, 4.4, -20.8, 0.46],
    [-7.6, 5.6, -31.0, 0.68], [5.9, 5.9, -30.0, 0.52],
  ].forEach(([x, y, z, size], index) => add(`StoryCrystalGarden_${String(index + 1).padStart(2, '0')}`, [x, y, z], [size, size * 2.2, size], qY(index * 0.91), mesh.crystal, index % 3 === 0 ? material.amber : material.cyan));

  // Vertical broken rings repeat the celestial-circle motif at human scale.
  add('StoryShrineRing_Dawn', [-6.2, 5.4, 0.6], [3.6, 3.6, 0.55], qX(Math.PI / 2), mesh.halo, material.bronze);
  add('StoryShrineRing_Gale', [7.2, 7.3, -20.5], [4.0, 4.0, 0.55], qX(Math.PI / 2), mesh.halo, material.wet);
  add('StoryShrineRing_Aether', [0.0, 9.4, -33.0], [4.8, 4.8, 0.7], qX(Math.PI / 2), mesh.halo, material.bronze);

  // Six distant needles form a deep skyline behind the final rift. They carry
  // no colliders and cannot interfere with gameplay.
  [
    [-28, 9, -38, 8.5], [-18, 14, -52, 12], [-9, 11, -63, 9.5],
    [12, 13, -62, 11], [23, 10, -49, 8], [32, 6, -34, 10],
  ].forEach(([x, y, z, height], index) => add(`StoryDistantNeedle_${String(index + 1).padStart(2, '0')}`, [x, y, z], [2.0 + index * 0.12, height, 2.0], qY(index * 0.37), mesh.obelisk, index % 2 === 0 ? material.void : material.wet));

  const spawnCommands = story.filter((item) => !names.has(item.name)).map((item) => ({
    kind: 'spawnEntity', _id: localId--, name: item.name,
    components: {
      Transform: { pos: item.pos, scale: item.scale, quat: item.quat },
      MeshFilter: { assetHandle: safeMeshHandle },
      MeshRenderer: { materials: [safeMaterialHandle] },
      Visibility: { state: 1 },
    },
  }));
  let structural = { ok: true, changed: false };
  if (spawnCommands.length > 0) {
    structural = gateway.dispatch({ kind: 'transaction', label: 'Add layered Sundering Reach environmental storytelling', commands: spawnCommands }, 'ai');
    if (!structural.ok) return { ok: false, reason: 'story spawn failed', structural };
  }

  const desiredMesh = (name) => {
    if (/^Island_|^FarIsland_|^CloudShelf_|^BeaconBase_/.test(name)) return mesh.shelf;
    if (/^Bridge_|Courtyard$|Dais$|Platform$|_Crown$|^Monastery_Lintel$|^Observatory_Lintel$/.test(name)) return mesh.bridge;
    if (/^RuinPillar_|^StoryFallenColumn_|^StoryGate_.*_(Left|Right)$/.test(name)) return mesh.column;
    if (/^BeaconSpire_|^FarSpire_|^StoryWaystone_|^StoryDistantNeedle_/.test(name)) return mesh.obelisk;
    if (/^EchoShard_|^CrystalVein_|^BeaconCore_|^StoryCrystalGarden_/.test(name)) return mesh.crystal;
    if (/^BeaconHalo_|^BronzeBand_|^StoryShrineRing_/.test(name)) return mesh.halo;
    if (/^WindGrass_/.test(name)) return mesh.grass;
    if (/^SkyRift_|^Waterfall_|^RiftCore$|^ExplorerRelic$/.test(name)) return mesh.rift;
    if (/^(ArrivalRock|MonasteryRock|ObservatoryRock|AltarRock|TrailStone_|FrameCrag_|PathLedge_|BridgeButtress_|StoryCairn_)/.test(name)) return mesh.licensedRock;
    if (/^(Cliff|FarCrag_)/.test(name)) return mesh.crag;
    return undefined;
  };
  const storyByName = new Map(story.map((item) => [item.name, item]));
  const desiredMaterial = (name, desired, index) => {
    if (desired === mesh.licensedRock) return material.licensedRock;
    const authored = storyByName.get(name);
    if (authored) return authored.materialGuid;
    if (desired === mesh.bridge || desired === mesh.column) return material.ruinMasonry;
    if (/^Cliff/.test(name)) return index % 4 === 0 ? material.wet : material.basalt;
    if (/^FarCrag_/.test(name)) return index % 2 === 0 ? material.wet : material.basalt;
    return undefined;
  };

  const fresh = query({ with: ['Name'] }).rows;
  const revisionRow = fresh.find((row) => /^(WorldAssetRevision|WorldAssetBindingOffset)_\d+$/.test(row.Name.value));
  const legacyBatchIndex = revisionRow?.Name.value.startsWith('WorldAssetRevision_')
    ? Number(revisionRow.Name.value.split('_').at(-1))
    : undefined;
  const persistedBindingOffset = revisionRow
    ? (legacyBatchIndex === undefined ? Number(revisionRow.Name.value.split('_').at(-1)) : legacyBatchIndex * 36)
    : 0;
  const meshRows = new Map(query({ with: ['Name', 'MeshFilter'] }).rows.map((row) => [row.Name.value, row]));
  let rendererRows = new Map(query({ with: ['Name', 'MeshRenderer'] }).rows.map((row) => [row.Name.value, row]));
  const rendererCommands = [];
  fresh.forEach((row) => {
    const name = row.Name.value;
    if (!desiredMesh(name) || rendererRows.has(name)) return;
    rendererCommands.push({ kind: 'addComponent', entity: row.entity, component: 'MeshRenderer', value: { materials: [safeMaterialHandle] } });
  });
  let rendererRepair = { ok: true, changed: false };
  if (rendererCommands.length > 0) {
    rendererRepair = gateway.dispatch({ kind: 'transaction', label: 'Repair missing renderers on authored world forms', commands: rendererCommands }, 'ai');
    if (!rendererRepair.ok) return { ok: false, reason: 'renderer repair failed', rendererRepair };
  }
  rendererRows = new Map(query({ with: ['Name', 'MeshRenderer'] }).rows.map((row) => [row.Name.value, row]));

  const bindingTasks = [];
  const bindingOrder = [...fresh].sort((left, right) => Number(/^Story/.test(right.Name.value)) - Number(/^Story/.test(left.Name.value)));
  bindingOrder.forEach((row, index) => {
    const name = row.Name.value;
    const desired = desiredMesh(name);
    if (!desired) return;
    const meshRow = meshRows.get(name);
    const rendererRow = rendererRows.get(name);
    if (meshRow?.MeshFilter?.assetHandle?.raw !== desired) {
      bindingTasks.push({
        kind: 'bindAssetRef', entity: row.entity, component: 'MeshFilter', field: 'assetHandle', assetType: 'MeshAsset',
        guids: [desired], requestId: `echofall-world-mesh-${row.entity}-20260806c`,
      });
    }
    const desiredMat = desiredMaterial(name, desired, index);
    if (desiredMat && rendererRow?.MeshRenderer?.materials?.[0]?.raw !== desiredMat) {
      bindingTasks.push({
        kind: 'bindAssetRef', entity: row.entity, component: 'MeshRenderer', field: 'materials', assetType: 'MaterialAsset',
        guids: [desiredMat], requestId: `echofall-world-material-${row.entity}-20260806c`,
      });
    }
  });

  // The transport has a bounded request deadline. Process a deterministic
  // slice per re-entry; each successful binding disappears from the next
  // candidate list, so retries converge without replaying mutations.
  // Keep each editor-frame mutation slice small. A 24-bind slice can monopolize
  // the interactive carrier while meshes/materials rebuild, whereas eight
  // remains comfortably inside the transport deadline on this full scene.
  const bindingBatchSize = persistedBindingOffset < 82 ? 4 : 8;
  const bindingBatchOffset = persistedBindingOffset;
  const batch = bindingTasks.slice(bindingBatchOffset, bindingBatchOffset + bindingBatchSize);
  const bindings = batch.map((task) => gateway.dispatch(task, 'ai'));
  const failures = bindings.filter((result) => result.ok === false);
  let revision = { ok: failures.length === 0 };
  if (failures.length === 0 && batch.length > 0) {
    const nextName = `WorldAssetBindingOffset_${String(bindingBatchOffset + batch.length).padStart(3, '0')}`;
    revision = revisionRow
      ? gateway.dispatch({ kind: 'setComponent', entity: revisionRow.entity, component: 'Name', patch: { value: nextName } }, 'ai')
      : gateway.dispatch({ kind: 'spawnEntity', name: nextName, components: { Transform: { pos: [0, -80, 0], scale: [1, 1, 1] } } }, 'ai');
  }
  return {
    ok: failures.length === 0 && revision.ok !== false,
    changed: spawnCommands.length > 0 || rendererCommands.length > 0 || bindings.length > 0,
    spawned: spawnCommands.length,
    rendererRepairs: rendererCommands.length,
    rendererRepair,
    bindings: bindings.length,
    bindingBatchOffset,
    remainingBindings: Math.max(0, bindingTasks.length - bindingBatchOffset - batch.length),
    revision,
    failedBindings: failures.length,
    firstFailure: failures[0],
    staticColliderCount,
    particlePlayerCount,
    structural,
  };
})()
