(function () {
  const colliderNames = [
    'Island_', 'Bridge_', 'Monastery_Courtyard', 'Observatory_Dais', 'Altar_Platform',
    'RuinPillar_', 'ArrivalRock_', 'MonasteryRock_', 'ObservatoryRock_', 'AltarRock_',
  ];
  const existing = new Set(query({ with: ['Collider'] }).rows.map((row) => row.entity));
  const commands = query({ with: ['Name'] }).rows
    .filter((row) => colliderNames.some((prefix) => row.Name.value === prefix || row.Name.value.startsWith(prefix)))
    .filter((row) => !existing.has(row.entity))
    .map((row) => ({
      kind: 'addComponent', entity: row.entity, component: 'Collider',
      value: {
        shape: 0, halfExtents: [0.5, 0.5, 0.5], radius: 0.5, halfHeight: 0.5,
        friction: 0.88, restitution: 0, density: 1, isSensor: false,
        collisionGroups: 131071, solverGroups: 4294967295,
      },
    }));
  if (commands.length === 0) return { authored: 0, alreadyPresent: existing.size };
  const result = gateway.dispatch({
    kind: 'transaction', label: 'Persist Sundering Reach static collision geometry', commands,
  }, 'ai');
  return { authored: commands.length, alreadyPresent: existing.size, result };
})()
