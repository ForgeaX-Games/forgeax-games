(function () {
  const rows = query({ with: ['Name', 'MeshFilter', 'MeshRenderer'] }).rows;
  const sphereSource = rows.find((row) => row.Name.value === 'BeaconCore_Dawn');
  if (!sphereSource) return { ok: false, reason: 'sphere source missing' };

  const sphere = sphereSource.MeshFilter.assetHandle.raw;
  const material = {
    basalt: '07b8795d-3392-4c38-9be4-b9ad073bf101',
    wet: 'a2c734a0-3308-42fc-b186-951751ce3103',
    cyan: 'cc0c6eaf-086b-4a02-b0d3-ea068b178105',
  };
  const names = new Set(rows.map((row) => row.Name.value));
  const commands = [];
  const qY = (angle) => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
  const qZ = (angle) => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
  const patchMesh = (name, materialGuid) => {
    const row = rows.find((candidate) => candidate.Name.value === name);
    if (!row) return;
    if (row.MeshFilter.assetHandle.raw !== sphere) {
      commands.push({ kind: 'setComponent', entity: row.entity, component: 'MeshFilter', patch: { assetHandle: sphere } });
    }
    if (row.MeshRenderer.materials[0]?.raw !== materialGuid) {
      commands.push({ kind: 'setComponent', entity: row.entity, component: 'MeshRenderer', patch: { materials: [materialGuid] } });
    }
  };
  const boulder = (name, pos, scale, materialGuid, turn = 0) => {
    if (names.has(name)) return;
    commands.push({
      kind: 'spawnEntity', name,
      components: {
        Transform: { pos, scale, quat: qY(turn) },
        MeshFilter: { assetHandle: sphere },
        MeshRenderer: { materials: [materialGuid] },
      },
    });
  };

  // Preserve every existing collider-bearing platform and bridge. Their hard cube
  // silhouettes are visually buried under non-colliding rock strata instead.
  const shelf = (prefix, cx, cy, cz, rx, rz, count, mat) => {
    for (let index = 0; index < count; index += 1) {
      const angle = (index / count) * Math.PI * 2 + 0.23;
      const radius = 0.7 + (index % 3) * 0.13;
      boulder(
        `${prefix}_${index + 1}`,
        [cx + Math.cos(angle) * rx, cy - 0.45 - (index % 2) * 0.38, cz + Math.sin(angle) * rz],
        [radius * (1.55 + (index % 2) * 0.28), radius * (1.1 + (index % 3) * 0.26), radius * 1.25],
        mat,
        angle * 0.73,
      );
    }
  };
  shelf('CliffArrival', 0, -1.1, 24, 14.5, 11.3, 14, material.wet);
  shelf('CliffMonastery', -3.5, -0.2, 1, 16.7, 12.8, 16, material.basalt);
  shelf('CliffObservatory', 7.3, 1.0, -18, 13.8, 11.4, 14, material.wet);
  shelf('CliffAltar', 0.2, 2.0, -31, 15.6, 12.3, 16, material.basalt);

  // Weighted foreground framing: two side crags point inward to the first beacon,
  // while a low fractured ledge makes the initial path read as a route, not a box.
  [
    ['FrameCrag_Left_1', [-10.5, 1.0, 25.5], [3.3, 5.5, 2.6], material.wet, -0.25],
    ['FrameCrag_Left_2', [-8.7, 2.9, 21.8], [2.2, 3.2, 1.9], material.basalt, 0.34],
    ['FrameCrag_Right_1', [10.8, 0.4, 22.0], [3.0, 4.7, 2.4], material.wet, 0.22],
    ['FrameCrag_Right_2', [8.8, 2.1, 18.4], [1.7, 2.6, 1.5], material.basalt, -0.42],
    ['PathLedge_1', [-5.7, 0.1, 16.8], [2.3, 0.72, 3.4], material.basalt, -0.16],
    ['PathLedge_2', [-4.5, 0.55, 10.8], [1.9, 0.65, 2.8], material.wet, -0.24],
  ].forEach(([name, pos, scale, mat, turn]) => boulder(name, pos, scale, mat, turn));

  // Remove the visible black primitive language from the distant geography. These
  // replacements are visual-only; no existing collision rows are added or removed.
  for (let index = 1; index <= 5; index += 1) patchMesh(`FarIsland_${index}`, index % 2 === 0 ? material.wet : material.basalt);
  patchMesh('RiftCore', material.cyan);

  const farRock = [
    [-28, 1.2, -10, 5.8], [25, 4.7, -30, 4.9], [-20, 9.3, -45, 4.1], [32, -3.4, 5, 6.7], [-34, -7.0, 20, 5.2],
  ];
  farRock.forEach(([x, y, z, size], index) => {
    boulder(`FarCrag_${index + 1}`, [x + 1.4, y - size * 0.35, z - 0.8], [size, size * 1.15, size * 0.72], index % 2 ? material.wet : material.basalt, index * 0.66);
  });

  // Break the regular bridge outline with sparse, asymmetric abutments rather than
  // adding another forest of identical pillars.
  [
    ['BridgeButtress_1', [-4.9, 0.0, 12.2], [0.9, 2.1, 1.25], material.basalt, 0.2],
    ['BridgeButtress_2', [-0.3, 0.6, 7.3], [0.72, 1.7, 1.05], material.wet, -0.3],
    ['BridgeButtress_3', [0.7, 1.7, -7.6], [0.9, 2.0, 1.2], material.basalt, 0.25],
    ['BridgeButtress_4', [8.4, 2.3, -13.8], [0.72, 1.65, 1.05], material.wet, -0.18],
    ['BridgeButtress_5', [0.1, 3.2, -26.5], [0.92, 2.2, 1.25], material.basalt, 0.17],
  ].forEach(([name, pos, scale, mat, turn]) => boulder(name, pos, scale, mat, turn));

  if (commands.length === 0) return { ok: true, polished: 0, reason: 'already sculpted' };
  const result = gateway.dispatch({
    kind: 'transaction',
    label: 'Sculpt Sundering Reach cliffs and remove blockout silhouettes',
    commands,
  }, 'ai');
  return { ok: result.ok, polished: commands.length, result };
})()
