(async function () {
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
  const materialFor = (name) => {
    if (name === 'Island_Arrival_Rim' || name.startsWith('ObservatoryRock_') || name === 'Bridge_Starfall_2') return material.wet;
    if (name.startsWith('Island_') || name.startsWith('ArrivalRock_') || name.startsWith('MonasteryRock_') || name.startsWith('AltarRock_')) return material.basalt;
    if (name.startsWith('Bridge_') || name.includes('Courtyard') || name.includes('Dais') || name.includes('Platform') || name.startsWith('RuinPillar_') || name.includes('Lintel')) return material.stone;
    if (name.startsWith('BronzeBand_') || name.startsWith('BeaconBase_') || name.startsWith('BeaconSpire_') || name.startsWith('BrokenCable_') || name === 'ExplorerRelic') return material.bronze;
    if (name.startsWith('BeaconCore_')) return material.amber;
    if (name.startsWith('EchoShard_') || name.startsWith('BeaconHalo_') || name.startsWith('CrystalVein_') || name.startsWith('Waterfall_') || name.startsWith('FarSpire_') || name.startsWith('SkyRift_')) return material.cyan;
    if (name.startsWith('WindGrass_')) return material.foliage;
    if (name.startsWith('CloudShelf_')) return material.mist;
    if (name.startsWith('FarIsland_') || name === 'RiftCore') return material.void;
    return material.stone;
  };
  const rows = query({ with: ['Name', 'MeshRenderer'] }).rows;
  const runs = [];
  for (const row of rows) {
    const requestId = `echofall-v4-material-${row.entity}`;
    const accepted = gateway.dispatch({
      kind: 'bindAssetRef', entity: row.entity, component: 'MeshRenderer', field: 'materials',
      assetType: 'MaterialAsset', guids: [materialFor(row.Name.value)], requestId,
    }, 'ai');
    runs.push(accepted.ok ? await gateway.waitOperationRun(requestId) : accepted);
  }
  const failed = runs.filter((run) => run?.ok !== true || run?.value?.status === 'failed');
  return { attempted: rows.length, failed: failed.length, sampleFailure: failed[0] ?? null };
})()
