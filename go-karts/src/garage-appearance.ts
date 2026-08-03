import type { World } from '@forgeax/engine-ecs';
import { MeshFilter, MeshRenderer } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import type { LoadedScene } from './scene';
import type { GarageSelection, OutfitKind } from './garage';
import { findEntityByName } from './scene';

const PET_SOURCE = {
  dog: null,
  duck: 'KartDuckDriver',
  panda: 'KartPandaDriver',
} as const;

/** Scene-baked procedural outfit pieces — fallback only if original GLBs fail. */
const OUTFIT_PIECES: Partial<Record<OutfitKind, readonly string[]>> = {
  straw: ['OutfitHatBrim', 'OutfitHatCrown'],
  shades: ['OutfitGlassLeft', 'OutfitGlassRight', 'OutfitGlassBridge'],
  party: ['OutfitPartyHat', 'OutfitPartyPom'],
};

const OUTFIT_AUTHORED_SCALE: Record<string, readonly [number, number, number]> = {
  OutfitHatBrim: [0.38, 0.045, 0.33],
  OutfitHatCrown: [0.23, 0.13, 0.22],
  OutfitGlassLeft: [0.13, 0.12, 0.055],
  OutfitGlassRight: [0.13, 0.12, 0.055],
  OutfitGlassBridge: [0.09, 0.025, 0.035],
  OutfitPartyHat: [0.17, 0.33, 0.17],
  OutfitPartyPom: [0.09, 0.09, 0.09],
};

/** Show or hide pack-primitive straw/shades/party pieces. */
export function setProceduralOutfitPieces(
  world: World,
  scene: LoadedScene,
  outfit: OutfitKind | null,
): void {
  const active = new Set(outfit ? (OUTFIT_PIECES[outfit] ?? []) : []);
  for (const pieces of Object.values(OUTFIT_PIECES)) {
    for (const name of pieces ?? []) {
      const entity = findEntityByName(scene, name);
      if (entity === undefined) continue;
      const transform = world.get(entity, Transform);
      if (!transform.ok) continue;
      const shown = active.has(name);
      const scale = shown
        ? (OUTFIT_AUTHORED_SCALE[name] ?? [1, 1, 1])
        : ([0, 0, 0] as const);
      world.set(entity, Transform, {
        ...transform.value,
        scale: [...scale],
      });
    }
  }
}

export function applyGarageSelection(
  world: World,
  scene: LoadedScene,
  selection: GarageSelection,
): void {
  const playerPet = findEntityByName(scene, 'PetDriver');
  const sourceName = PET_SOURCE[selection.pet];
  const sourcePet = sourceName ? findEntityByName(scene, sourceName) : undefined;
  if (playerPet !== undefined && sourcePet !== undefined) {
    const mesh = world.get(sourcePet, MeshFilter);
    const renderer = world.get(sourcePet, MeshRenderer);
    const sourceTransform = world.get(sourcePet, Transform);
    const playerTransform = world.get(playerPet, Transform);
    if (mesh.ok) world.set(playerPet, MeshFilter, mesh.value);
    if (renderer.ok) world.set(playerPet, MeshRenderer, renderer.value);
    if (sourceTransform.ok && playerTransform.ok) {
      world.set(playerPet, Transform, {
        ...playerTransform.value,
        scale: sourceTransform.value.scale,
      });
    }
  }

  // Prefer original-garage accessory GLBs. Keep pack primitives hidden unless
  // original-garage-models explicitly re-enables them as a load fallback.
  setProceduralOutfitPieces(world, scene, null);
}
