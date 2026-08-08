(function () {
  const effectGuid = 'f7b169a1-73cc-4cc4-b0c1-6f93d8db44a1';
  const beaconNames = ['BeaconCore_Dawn', 'BeaconCore_Gale', 'BeaconCore_Aether'];
  const existing = new Set(query({ with: ['ParticleEffectPlayer'] }).rows.map((row) => row.entity));
  const targets = query({ with: ['Name'] }).rows
    .filter((row) => beaconNames.includes(row.Name.value))
    .sort((left, right) => left.Name.value.localeCompare(right.Name.value));
  const commands = targets
    .filter((row) => !existing.has(row.entity))
    .map((row, index) => ({
      kind: 'addComponent',
      entity: row.entity,
      component: 'ParticleEffectPlayer',
      value: {
        effect: 0,
        playing: true,
        seed: 0xeca000 + index * 977,
        timeScale: 1,
      },
    }));

  const authored = commands.length === 0
    ? { ok: true }
    : gateway.dispatch({
        kind: 'transaction',
        label: 'Author native beacon VFX players',
        commands,
      }, 'ai');
  if (!authored.ok) {
    return { authored: 0, alreadyPresent: existing.size, result: authored };
  }

  const binds = targets.map((row) => {
    const requestId = `echofall-vfx-${row.entity}`;
    return {
      entity: row.entity,
      requestId,
      accepted: gateway.dispatch({
        kind: 'bindAssetRef',
        entity: row.entity,
        component: 'ParticleEffectPlayer',
        field: 'effect',
        assetType: 'ParticleEffectAsset',
        guids: [effectGuid],
        requestId,
      }, 'ai'),
    };
  });
  return { authored: commands.length, alreadyPresent: existing.size, authoredResult: authored, binds };
})()
