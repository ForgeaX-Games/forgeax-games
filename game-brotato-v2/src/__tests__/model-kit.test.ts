import { describe, expect, it } from 'vitest';
import { buildActorHierarchy, buildActorMergedMesh, buildActorMeshes } from '../../assets/lib/model-kit.ts';
import { TOMATO_RECIPE } from '../../assets/lib/actors/tomato.ts';

const GUID = '019fc0a0-2000-7000-8000-000000000001';

describe('Brotato v2 M1 actor model kit', () => {
  it('preserves triangle count across hierarchy and merged assembly routes', () => {
    const separate = buildActorMeshes(TOMATO_RECIPE);
    const merged = buildActorMergedMesh(TOMATO_RECIPE);
    const separateTriangles = [separate.body, ...separate.limbs.values()].reduce(
      (sum, mesh) => sum + (mesh.indices?.length ?? 0) / 3,
      0,
    );
    expect(merged.indices?.length ?? 0).toBe(separateTriangles * 3);
  });

  it('emits renderable mesh slots and a ChildOf hierarchy rooted at localId 0', () => {
    const separate = buildActorMeshes(TOMATO_RECIPE);
    for (const mesh of [separate.body, ...separate.limbs.values()]) {
      expect(mesh.submeshes.length).toBeGreaterThan(0);
      expect(mesh.materialSlots.length).toBeGreaterThan(0);
    }
    const scene = buildActorHierarchy(TOMATO_RECIPE, {
      bodyMesh: GUID,
      limbMeshes: new Map(TOMATO_RECIPE.limbs.map((limb) => [limb.id, GUID])),
      materials: [GUID, GUID, GUID, GUID],
    });
    expect(scene.entities).toHaveLength(6);
    for (const entity of scene.entities.slice(2)) {
      expect(entity.components.ChildOf).toEqual({ parent: 0 });
    }
  });
});
