(function () {
  const rows = query({ with: ['Name'] }).rows;
  const sun = rows.find((row) => row.Name.value === 'SunderingSun');
  const sky = rows.find((row) => row.Name.value === 'SunderingSkylight');
  if (!sun || !sky) return { ok: false, sun: Boolean(sun), sky: Boolean(sky) };
  return gateway.dispatch({
    kind: 'transaction',
    label: 'Golden-hour arrival lighting pass',
    commands: [
      {
        kind: 'setComponent',
        entity: sun.entity,
        component: 'DirectionalLight',
        patch: {
          direction: [-0.62, -0.78, -0.28],
          color: [1, 0.68, 0.4],
          intensity: 4.35,
          castShadow: true,
          cascadeCount: 4,
          splitLambda: 0.78,
          cascadeBlend: 0.24,
          mapSize: 2048,
          depthBias: 0.004,
          normalBias: 0.04,
          shadowDistance: 90,
          pcfKernelSize: 3,
        },
      },
      {
        kind: 'setComponent',
        entity: sky.entity,
        component: 'Skylight',
        patch: {
          color: [0.32, 0.4, 0.58],
          intensity: 1.05,
        },
      },
    ],
  }, 'ai');
})()
