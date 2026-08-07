(function () {
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
  };
  const commands = [];
  let localId = -1;
  const qY = (angle) => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
  const qZ = (angle) => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
  const visible = (name, pos, scale, materialGuid, quat) => {
    commands.push({
      kind: 'spawnEntity',
      _id: localId--,
      name,
      components: {
        Transform: { pos, scale, ...(quat ? { quat } : {}) },
        MeshFilter: { assetHandle: 0 },
        MeshRenderer: { materials: [materialGuid] },
      },
    });
  };
  const marker = (name, pos) => commands.push({
    kind: 'spawnEntity',
    _id: localId--,
    name,
    components: { Transform: { pos, scale: [1, 1, 1] } },
  });
  const cluster = (prefix, cx, cy, cz, count, spread, mat = material.basalt) => {
    for (let index = 0; index < count; index += 1) {
      const phase = index * 2.399963;
      const radius = spread * (0.35 + (index % 5) / 7);
      const size = 0.7 + ((index * 7) % 9) * 0.18;
      visible(`${prefix}_${index + 1}`,
        [cx + Math.cos(phase) * radius, cy + ((index * 3) % 4) * 0.18, cz + Math.sin(phase) * radius],
        [size * 1.35, size * (0.75 + (index % 3) * 0.22), size], mat, qY(phase * 0.37));
    }
  };

  // Walkable island chain: arrival shelf, reveal bridge, monastery, observatory, and final altar.
  visible('Island_Arrival', [0, -0.8, 24], [16, 2.2, 13], material.basalt, qY(-0.08));
  visible('Island_Arrival_Rim', [-3, 0.15, 20], [10, 0.45, 7], material.wet, qY(0.12));
  visible('Bridge_Windscar_1', [-2.4, 0.45, 14], [3.2, 0.65, 8], material.stone, qY(-0.08));
  visible('Bridge_Windscar_2', [-4.8, 1.0, 8.3], [3.2, 0.62, 6.5], material.stone, qY(-0.14));
  visible('Island_Monastery', [-3.5, 0.25, 1], [18, 2.8, 15], material.basalt, qY(0.06));
  visible('Monastery_Courtyard', [-2.8, 1.8, 0.5], [12, 0.5, 9], material.stone, qY(0.06));
  visible('Bridge_Starfall_1', [2.8, 2.2, -6], [3.2, 0.58, 8], material.stone, qY(-0.33));
  visible('Bridge_Starfall_2', [6.5, 3.0, -11.8], [3.1, 0.55, 7.2], material.wet, qY(-0.22));
  visible('Island_Observatory', [7.3, 1.6, -18], [15, 3.4, 13], material.basalt, qY(-0.05));
  visible('Observatory_Dais', [6.5, 3.45, -18.5], [9.5, 0.5, 8], material.stone, qY(-0.05));
  visible('Bridge_LastLight', [2.5, 4.0, -24], [3.1, 0.55, 10], material.bronze, qY(0.18));
  visible('Island_Altar', [0.2, 2.8, -31], [17, 4.2, 14], material.basalt, qY(0.04));
  visible('Altar_Platform', [0, 5.05, -31], [11, 0.65, 9], material.stone, qY(0.04));

  // Architectural rhythm and silhouette breaks.
  const pillars = [
    [-7, 3.4, 4], [-1, 3.2, 5], [2, 3.8, -1], [-7.5, 3.1, -3],
    [3.5, 5.0, -17], [10.5, 5.4, -17], [5.2, 5.8, -22], [9.8, 5.3, -22],
    [-4.6, 7.0, -34], [4.8, 7.2, -34], [-5.5, 6.6, -27.5], [5.8, 6.8, -27.5],
  ];
  pillars.forEach(([x, y, z], index) => {
    visible(`RuinPillar_${index + 1}`, [x, y, z], [1.1 + (index % 2) * 0.35, 4.4 + (index % 3), 1.1], material.stone, qY(index * 0.31));
    visible(`BronzeBand_${index + 1}`, [x, y + 1.0, z], [1.35, 0.28, 1.35], material.bronze, qY(index * 0.31));
  });
  visible('Monastery_Lintel', [-4, 6.0, 4], [7.5, 0.8, 1.2], material.stone, qY(0.07));
  visible('Observatory_Lintel', [7.2, 8.0, -21.8], [8, 0.65, 1.2], material.bronze, qY(-0.04));

  // Three mechanically meaningful beacons; names are the gameplay binding contract.
  const beacons = [
    ['Dawn', -6.2, 2.3, -1.0], ['Gale', 7.2, 4.1, -19.0], ['Aether', 0, 5.8, -31.2],
  ];
  beacons.forEach(([id, x, y, z], index) => {
    visible(`BeaconBase_${id}`, [x, y, z], [3.4, 0.55, 3.4], material.bronze, qY(index * 0.5));
    visible(`BeaconSpire_${id}`, [x, y + 2.0, z], [0.65, 4.2, 0.65], material.bronze);
    visible(`BeaconCore_${id}`, [x, y + 4.25, z], [1.15, 1.15, 1.15], material.amber);
    visible(`BeaconHalo_${id}`, [x, y + 4.25, z], [2.25, 0.18, 2.25], material.cyan);
    marker(`BeaconTrigger_${id}`, [x, y + 0.5, z]);
  });

  // Echo shards are visible authored objects and one-shot gameplay pickups.
  const shards = [
    [-4.2, 1.2, 21], [2.6, 1.35, 18], [-5.0, 2.5, 8.2], [-8.0, 2.4, 1.8],
    [0.5, 2.6, -2.8], [5.2, 4.5, -14], [10.2, 4.5, -20.5], [2.3, 5.9, -28.5],
  ];
  shards.forEach(([x, y, z], index) => visible(`EchoShard_${index + 1}`, [x, y, z], [0.45, 1.15, 0.45], material.cyan, qY(index * 0.77)));

  // Foreground storytelling clusters, foliage clumps, cables, and crystal veins.
  cluster('ArrivalRock', -5.7, 0.5, 26.5, 9, 4.2, material.wet);
  cluster('MonasteryRock', 2.0, 2.0, 3.5, 11, 5.2, material.basalt);
  cluster('ObservatoryRock', 10.0, 4.0, -16.0, 9, 4.0, material.wet);
  cluster('AltarRock', -2.0, 5.2, -35.0, 10, 4.8, material.basalt);
  const foliage = [
    [-6,1.4,23],[-2,1.2,26],[5,1.1,23],[-7,2.1,5],[-1,2.1,5],[2,2.2,-1],
    [9,3.9,-15],[11,3.7,-20],[4,4.0,-22],[-5,5.3,-29],[4,5.4,-28],[-3,5.5,-35],
  ];
  foliage.forEach(([x,y,z], index) => {
    visible(`WindGrass_${index + 1}`, [x,y,z], [1.5 + (index % 3) * 0.4, 0.8 + (index % 2) * 0.45, 1.5], material.foliage, qY(index * 0.62));
    if (index % 2 === 0) visible(`CrystalVein_${index + 1}`, [x + 0.7,y + 0.6,z - 0.5], [0.35,1.4,0.35], material.cyan, qY(index));
  });
  visible('BrokenCable_1', [-1, 4.5, 12], [0.13, 7.5, 0.13], material.bronze, qZ(0.38));
  visible('BrokenCable_2', [5.2, 5.6, -7], [0.13, 9, 0.13], material.bronze, qZ(-0.3));
  visible('ExplorerRelic', [-2.2, 1.0, 22.5], [0.9, 0.28, 1.8], material.bronze, qY(0.45));

  // Waterfalls, cloud shelves and distant floating geography establish scale.
  visible('Waterfall_Monastery', [-10.8, -7.0, 0], [2.2, 18, 0.32], material.cyan);
  visible('Waterfall_Observatory', [13.5, -6.0, -20], [2.5, 22, 0.35], material.cyan);
  visible('Waterfall_Altar', [-8.0, -9.0, -33], [2.8, 28, 0.42], material.cyan);
  for (let index = 0; index < 10; index += 1) {
    const angle = index * 1.97;
    const radius = 22 + (index % 4) * 8;
    visible(`CloudShelf_${index + 1}`, [Math.cos(angle) * radius, -6 - (index % 3), 2 + Math.sin(angle) * radius], [10 + (index % 3) * 4, 1.2, 5], material.mist, qY(angle));
  }
  const farIslands = [[-28,4,-10,9],[25,7,-30,7],[-20,12,-45,6],[32,-1,5,11],[-34,-4,20,8]];
  farIslands.forEach(([x,y,z,s], index) => {
    visible(`FarIsland_${index + 1}`, [x,y,z], [s,2.8+s*0.15,s*0.72], material.void, qY(index * 0.71));
    visible(`FarSpire_${index + 1}`, [x,y+4,z], [0.8,6+(index%3)*2,0.8], material.cyan);
  });

  // The sky-rift ring is the always-readable destination silhouette.
  for (let index = 0; index < 28; index += 1) {
    const angle = (index / 28) * Math.PI * 2;
    const radius = 11.5;
    visible(`SkyRift_${index + 1}`,
      [Math.cos(angle) * radius, 18 + Math.sin(angle) * radius, -58],
      [2.7, 0.58, 0.75], index % 4 === 0 ? material.amber : material.cyan, qZ(angle + Math.PI / 2));
  }
  visible('RiftCore', [0, 18, -58], [7.2, 7.2, 0.5], material.void);

  marker('PlayerSpawn', [0, 1.1, 27]);
  marker('Checkpoint_Dawn', [-6.2, 2.8, -1]);
  marker('Checkpoint_Gale', [7.2, 4.6, -19]);
  marker('Checkpoint_Aether', [0, 6.2, -31.2]);
  marker('CompletionGate', [0, 6.2, -36.5]);

  commands.push({
    kind: 'spawnEntity', _id: localId--, name: 'SunderingSun',
    components: {
      Transform: { pos: [18, 26, 12], scale: [1, 1, 1] },
      DirectionalLight: { direction: [-0.48, -1, -0.22], color: [1, 0.72, 0.45], intensity: 3.5, castShadow: true, mapSize: 2048, shadowDistance: 90 },
    },
  });
  commands.push({
    kind: 'spawnEntity', _id: localId--, name: 'SunderingSkylight',
    components: { Skylight: { color: [0.16, 0.28, 0.46], intensity: 0.56 } },
  });
  commands.push({
    kind: 'spawnEntity', _id: localId--, name: 'SunderingSkybox',
    components: { SkyboxBackground: { mode: 0 } },
  });

  const result = gateway.dispatch({
    kind: 'transaction',
    label: 'Author the Sundering Reach exploration world',
    commands,
  }, 'ai');
  return { result, commandCount: commands.length };
})()
