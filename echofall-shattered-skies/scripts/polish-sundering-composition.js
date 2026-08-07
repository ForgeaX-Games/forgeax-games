(function () {
  const rows = query({ with: ['Name', 'Transform'] }).rows;
  const byName = new Map(rows.map((row) => [row.Name.value, row]));
  // The running editor may briefly retain the runtime player's dynamic
  // Collider after Stop. Authored world collision always has a MeshFilter, so
  // gate the persistent static set rather than transient runtime bodies.
  const colliderCount = query({ with: ['Collider', 'MeshFilter'] }).rows.length;
  const particlePlayerCount = query({ with: ['ParticleEffectPlayer'] }).rows.length;
  if (colliderCount !== 64 || particlePlayerCount !== 3) {
    return {
      ok: false,
      reason: 'persistent physics or native VFX invariant failed before composition edit',
      colliderCount,
      particlePlayerCount,
    };
  }

  const mesh = {
    sphere: '95730fd2-9846-5f84-8658-0b3c971eb263',
  };
  const material = {
    basalt: '07b8795d-3392-4c38-9be4-b9ad073bf101',
    wet: 'a2c734a0-3308-42fc-b186-951751ce3103',
    stone: '2fbcb8a1-65b8-47ef-9b64-6d80ace3f102',
  };
  const qY = (angle) => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
  const same = (left, right) => left?.length === right.length &&
    Array.from(left).every((value, index) => Math.abs(value - right[index]) < 0.0001);
  const commands = [];
  let localId = -1;

  const setTransform = (name, pos, scale, turn = 0) => {
    const row = byName.get(name);
    if (!row) return;
    const quat = qY(turn);
    if (same(row.Transform.pos, pos) && same(row.Transform.scale, scale) && same(row.Transform.quat, quat)) return;
    commands.push({
      kind: 'setComponent', entity: row.entity, component: 'Transform',
      patch: { pos, scale, quat },
    });
  };
  const spawnRock = (name, pos, scale, turn, materialGuid) => {
    if (byName.has(name)) return;
    commands.push({
      kind: 'spawnEntity', _id: localId--, name,
      components: {
        Transform: { pos, scale, quat: qY(turn) },
        MeshFilter: { assetHandle: 0 },
      },
    });
    return materialGuid;
  };

  // Pull the four camera-edge crags down and away from the spawn. They remain
  // asymmetric framing shapes without clipping the viewport or hiding the route.
  setTransform('FrameCrag_Left_1', [-12.8, -0.8, 23.4], [2.5, 2.2, 1.75], -0.32);
  setTransform('FrameCrag_Left_2', [-10.4, -0.05, 18.0], [1.45, 1.35, 1.15], 0.38);
  setTransform('FrameCrag_Right_1', [13.4, -0.95, 24.7], [2.65, 2.3, 1.85], 0.28);
  setTransform('FrameCrag_Right_2', [10.7, -0.1, 16.4], [1.5, 1.3, 1.12], -0.45);

  // The two required opening shards describe a readable S from spawn to the
  // Windscar bridge; neither change touches a collider or a particle player.
  setTransform('EchoShard_1', [-3.4, 1.35, 22.4], [0.42, 1.0, 0.42], -0.28);
  setTransform('EchoShard_2', [1.8, 1.42, 18.2], [0.42, 1.0, 0.42], 0.34);
  setTransform('PathLedge_1', [-5.9, -0.08, 18.8], [1.9, 0.38, 1.45], -0.2);
  setTransform('PathLedge_2', [4.0, 0.02, 15.9], [1.65, 0.34, 1.3], 0.25);

  // Low, grounded stone pairs reveal the playable ribbon without becoming a
  // second obstacle authority. The open centreline remains wider than the KCC.
  const trail = [
    ['TrailStone_L01', [-4.9, 0.43, 25.0], [0.78, 0.24, 1.05], -0.40, material.wet],
    ['TrailStone_R01', [3.8, 0.34, 24.0], [0.58, 0.19, 0.82], 0.28, material.basalt],
    ['TrailStone_L02', [-6.0, 0.48, 22.0], [0.62, 0.20, 0.91], -0.14, material.basalt],
    ['TrailStone_R02', [4.6, 0.38, 21.0], [0.82, 0.23, 1.12], 0.44, material.wet],
    ['TrailStone_L03', [-4.0, 0.40, 18.4], [0.70, 0.18, 0.96], 0.36, material.wet],
    ['TrailStone_R03', [4.2, 0.42, 17.6], [0.55, 0.17, 0.78], -0.30, material.basalt],
    ['TrailStone_L04', [-5.3, 0.72, 14.8], [0.72, 0.20, 1.04], -0.18, material.basalt],
    ['TrailStone_R04', [0.2, 0.70, 13.5], [0.61, 0.18, 0.86], 0.42, material.stone],
    ['TrailStone_L05', [-7.2, 1.20, 10.7], [0.68, 0.19, 0.98], 0.34, material.wet],
    ['TrailStone_R05', [-2.0, 1.16, 9.2], [0.78, 0.22, 1.08], -0.26, material.stone],
    ['TrailStone_L06', [-7.6, 1.92, 6.3], [0.60, 0.18, 0.84], -0.32, material.basalt],
    ['TrailStone_R06', [-1.1, 1.90, 5.4], [0.74, 0.21, 1.02], 0.22, material.wet],
    ['TrailStone_L07', [-8.8, 2.05, 2.3], [0.84, 0.25, 1.14], 0.18, material.basalt],
    ['TrailStone_R07', [-2.8, 2.02, 0.8], [0.63, 0.18, 0.90], -0.38, material.stone],
  ];
  const trailMaterials = new Map(trail.map(([name, , , , materialGuid]) => [name, materialGuid]));
  for (const [name, pos, scale, turn, materialGuid] of trail) {
    spawnRock(name, pos, scale, turn, materialGuid);
  }

  let transaction = { ok: true, changed: false };
  if (commands.length > 0) {
    transaction = gateway.dispatch({
      kind: 'transaction',
      label: 'Compose the opening S path and grounded arrival framing',
      commands,
    }, 'ai');
    if (!transaction.ok) return { ok: false, transaction, colliderCount, particlePlayerCount };
  }

  // Asset references are bound through the public asset operation after the
  // structural transaction. Re-entry only repairs missing bindings by name.
  const visibleRows = query({ with: ['Name'] }).rows;
  const meshRows = new Map(query({ with: ['Name', 'MeshFilter'] }).rows.map((row) => [row.Name.value, row]));
  const rendererRows = new Map(query({ with: ['Name', 'MeshRenderer'] }).rows.map((row) => [row.Name.value, row]));
  const bindings = [];
  for (const row of visibleRows) {
    const materialGuid = trailMaterials.get(row.Name.value);
    if (!materialGuid) continue;
    const meshRow = meshRows.get(row.Name.value);
    const rendererRow = rendererRows.get(row.Name.value);
    if (!rendererRow) {
      bindings.push(gateway.dispatch({
        kind: 'addComponent', entity: row.entity, component: 'MeshRenderer', value: { materials: [] },
      }, 'ai'));
    }
    if (!meshRow?.MeshFilter?.assetHandle) {
      bindings.push(gateway.dispatch({
        kind: 'bindAssetRef', entity: row.entity, component: 'MeshFilter', field: 'assetHandle',
        assetType: 'MeshAsset', guids: [mesh.sphere], requestId: `echofall-composition-mesh-${row.entity}`,
      }, 'ai'));
    }
    if (!(rendererRow?.MeshRenderer?.materials?.length > 0)) {
      bindings.push(gateway.dispatch({
        kind: 'bindAssetRef', entity: row.entity, component: 'MeshRenderer', field: 'materials',
        assetType: 'MaterialAsset', guids: [materialGuid], requestId: `echofall-composition-material-${row.entity}`,
      }, 'ai'));
    }
  }

  return {
    ok: bindings.every((result) => result.ok !== false),
    changed: commands.length > 0 || bindings.length > 0,
    transformEdits: commands.filter((command) => command.kind === 'setComponent').length,
    spawned: commands.filter((command) => command.kind === 'spawnEntity').length,
    bindings: bindings.length,
    colliderCount,
    particlePlayerCount,
    transaction,
  };
})()
