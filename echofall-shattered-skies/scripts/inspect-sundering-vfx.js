(function () {
  const requests = ['echofall-vfx-49', 'echofall-vfx-41', 'echofall-vfx-45'];
  return {
    runs: requests.map((requestId) => gateway.getOperationRun(requestId)),
    rhi: gateway.getOperationRun('echofall-native-vfx-rhi-1'),
    players: query({ with: ['Name', 'ParticleEffectPlayer'] }).rows.map((row) => ({
      entity: row.entity,
      name: row.Name.value,
      player: row.ParticleEffectPlayer,
    })),
    compatible: gateway.assetCatalog({ compatibleWith: 'ParticleEffectAsset' }),
  };
})()
