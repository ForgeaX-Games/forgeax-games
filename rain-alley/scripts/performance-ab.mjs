/** Temporary, reversible isolation controls; never imported by the game. */
import { Name } from '@forgeax/engine-scene';
import { Visibility, MeshRenderer, DirectionalLight, SpotLight } from '@forgeax/engine-render';
const restore = [];
export function resetIsolation() {
  for (const fn of restore.splice(0).reverse()) fn();
}
export function isolate(kind) {
  resetIsolation();
  const { world } = window.__forgeax;
  let count = 0;
  if (kind === 'rain' || kind === 'all-meshes') {
    // Query row views are reused by the iterator. Copy entity IDs while iterating.
    const entities = [];
    for (const row of world.query({ read: [Name, MeshRenderer] }).unwrap())
      if (kind !== 'rain' || /^RainNight_(Rain|Splash)_/.test(row.get(Name).value)) entities.push(row.entity);
    for (const entity of entities) {
      const current = world.get(entity, Visibility);
      const previous = current.ok ? { ...current.value } : null;
      (previous ? world.set(entity, Visibility, { state: 1 }) : world.addComponent(entity, { component: Visibility, data: { state: 1 } })).unwrap();
      restore.push(() => previous ? world.set(entity, Visibility, previous) : world.removeComponent(entity, Visibility));
      count++;
    }
  } else if (kind === 'shadows') {
    for (const component of [DirectionalLight, SpotLight])
      for (const row of world.query({ read: [component] }).unwrap()) {
        const entity = row.entity, previous = { ...row.get(component) };
        world.set(entity, component, { ...previous, castShadow: false }).unwrap();
        restore.push(() => world.set(entity, component, previous)); count++;
      }
  }
  return { kind, count };
}
