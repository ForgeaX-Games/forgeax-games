import type { ActorRecipe } from '../model-kit.ts';

/** The red cross and ring shown during the one-second enemy warning window. */
export const SPAWN_MARKER_RECIPE: ActorRecipe = {
  id: 'spawn-marker',
  displayName: 'Spawn Marker',
  materialSlots: ['spawn-marker'],
  body: [
    {
      id: 'bar-a',
      shape: { kind: 'box', width: 1.5, height: 0.06, depth: 0.28 },
      position: [0, 0.03, 0],
      rotation: [0, Math.PI / 4, 0],
      materialSlot: 0,
    },
    {
      id: 'bar-b',
      shape: { kind: 'box', width: 1.5, height: 0.06, depth: 0.28 },
      position: [0, 0.03, 0],
      rotation: [0, -Math.PI / 4, 0],
      materialSlot: 0,
    },
    {
      id: 'ring',
      shape: { kind: 'torus', radius: 0.95, tube: 0.07 },
      position: [0, 0.02, 0],
      rotation: [-Math.PI / 2, 0, 0],
      materialSlot: 0,
    },
  ],
  limbs: [],
  rootScale: 1,
  groundOffset: 0,
};
