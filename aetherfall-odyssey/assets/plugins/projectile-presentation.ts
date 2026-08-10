import type { BootstrapContext } from "@forgeax/engine-app";
import { HANDLE_SPHERE } from "@forgeax/engine-assets-runtime";
import { createCapsuleGeometry } from "@forgeax/engine-geometry";
import {
  createQueryState,
  Entity,
  queryRun,
  Update,
  type EntityHandle,
  type World,
} from "@forgeax/engine-ecs";
import { Materials, MeshFilter, MeshRenderer } from "@forgeax/engine-render";
import {
  setTransparentSortConfig,
  TRANSPARENT_SORT_MODE_DISTANCE,
  TRANSPARENT_SORT_MODE_LAYER_Z,
} from "@forgeax/engine-render/authoring";
import type { Handle, MaterialAsset } from "@forgeax/engine-runtime";
import type { MeshAsset, TextureAsset } from "@forgeax/engine-types";
import type { ChromaticAberrationHandle } from "./chromatic-aberration";
import {
  createCustomProjectileMesh,
  type CustomProjectileMesh,
} from "./custom-projectile-mesh";
import { createHitFlashMaterial } from "./hit-flash-material";
import type { FbxMeshSwap } from "./fbx-mesh-swap";
import type { GltfMeshSwap } from "./gltf-mesh-swap";
import type { JpegTextureSwap } from "./jpeg-texture-swap";
import type { MeshHandleSwap } from "./mesh-handle-swap";
import {
  createSpriteAtlasLoop,
  type SpriteAtlasLoop,
} from "./sprite-atlas-loop";
import {
  HitFlash,
  Projectile,
  ProjectilePolicy,
  TargetPresentation,
  type ProjectileVisual,
} from "./components/gameplay";

export type ProjectilePresentation = {
  readonly bulletRadius: number;
  readonly bulletHalfHeight: number;
  readonly projectileMesh: Handle<"MeshAsset", "shared">;
  readonly projectileMaterial: Handle<"MaterialAsset", "shared">;
  readonly customProjectile: CustomProjectileMesh | undefined;
  readonly spriteAtlasLoop: SpriteAtlasLoop | undefined;
  readonly flashMaterial: Handle<"MaterialAsset", "shared">;
  readonly getProjectileVisual: () => ProjectileVisual;
  readonly setProjectileVisual: (visual: ProjectileVisual) => void;
  readonly materialsForCurrentMesh: (
    entity: EntityHandle,
    flashing: boolean,
  ) => readonly Handle<"MaterialAsset", "shared">[];
  readonly triggerFlash: (entity?: EntityHandle) => void;
  readonly multiMaterial: () => {
    readonly available: boolean;
    readonly materialCount: number;
    readonly submeshCount: number;
    readonly topologies: readonly string[];
    readonly slotsAligned: boolean;
  };
  readonly dispose: () => void;
};

type ProjectilePresentationArgs = {
  readonly world: World;
  readonly host: BootstrapContext | undefined;
  readonly player: EntityHandle | undefined;
  readonly primaryTarget: () => EntityHandle | undefined;
  readonly targetEntities: () => readonly EntityHandle[];
  readonly meshHandleSwap: MeshHandleSwap | undefined;
  readonly fbxMeshSwap: FbxMeshSwap | undefined;
  readonly gltfMeshSwap: GltfMeshSwap | undefined;
  readonly jpegTextureSwap: JpegTextureSwap | undefined;
  readonly chromaticAberration: ChromaticAberrationHandle;
  readonly comparisonEvidenceMode: boolean;
};

/** Assemble projectile geometry, authored visual variants, and hit presentation. */
export async function createProjectilePresentation(
  args: ProjectilePresentationArgs,
): Promise<ProjectilePresentation> {
  const bulletRadius = 0.12;
  const bulletHalfHeight = 0.16;
  let disposed = false;
  const cleanupSteps: Array<() => void> = [];
  const cleanup = (): void => {
    for (let index = cleanupSteps.length - 1; index >= 0; index -= 1) {
      try {
        cleanupSteps[index]?.();
      } catch (cleanupError) {
        console.error(
          "[aetherfall-projectile] presentation cleanup failed",
          cleanupError,
        );
      }
    }
  };
  let customProjectile: CustomProjectileMesh | undefined;
  let spriteAtlasLoop: SpriteAtlasLoop | undefined;
  let projectileMesh: Handle<"MeshAsset", "shared"> = HANDLE_SPHERE;
  let projectileMaterial: Handle<"MaterialAsset", "shared">;
  try {
    customProjectile =
      args.host?.renderer === undefined
        ? undefined
        : await createCustomProjectileMesh(args.world, args.host.renderer);
    if (customProjectile !== undefined) {
      cleanupSteps.push(() => customProjectile?.dispose());
      projectileMesh = customProjectile.meshHandle;
      projectileMaterial = customProjectile.materialHandle;
    } else {
      const bulletMaterial = args.world.allocSharedRef<
        "MaterialAsset",
        MaterialAsset
      >(
        "MaterialAsset",
        Materials.standard({
          baseColor: [1, 0.85, 0.3, 1],
          roughness: 0.4,
          metallic: 0,
          emissive: [1, 0.7, 0.15],
          emissiveIntensity: 5,
        }),
      );
      cleanupSteps.push(() =>
        args.world.sharedRefs.release(bulletMaterial).unwrap(),
      );
      const bulletMeshResult = createCapsuleGeometry(
        bulletRadius,
        bulletHalfHeight * 2,
        6,
        12,
      );
      if (bulletMeshResult.ok) {
        const bulletMesh = args.world.allocSharedRef(
          "MeshAsset",
          bulletMeshResult.value,
        );
        cleanupSteps.push(() =>
          args.world.sharedRefs.release(bulletMesh).unwrap(),
        );
        projectileMesh = bulletMesh;
      }
      projectileMaterial = bulletMaterial;
    }
    spriteAtlasLoop =
      customProjectile === undefined || !args.comparisonEvidenceMode
        ? undefined
        : await createSpriteAtlasLoop(
            args.world,
            args.host?.assets,
            customProjectile.spriteMaterialHandle,
            customProjectile.spriteLitMaterialHandle,
          );
    if (spriteAtlasLoop !== undefined) {
      const atlasMaterial = args.world.sharedRefs.resolve<
        "MaterialAsset",
        MaterialAsset
      >(spriteAtlasLoop.spriteMaterialHandle);
      const atlasTexture = atlasMaterial.ok
        ? atlasMaterial.value.values?.baseColorTexture
        : undefined;
      if (typeof atlasTexture === "number") {
        cleanupSteps.push(() =>
          args.world.sharedRefs
            .release(atlasTexture as Handle<"TextureAsset", "shared">)
            .unwrap(),
        );
      }
      cleanupSteps.push(() =>
        args.world.sharedRefs
          .release(spriteAtlasLoop!.spriteMaterialHandle)
          .unwrap(),
      );
      cleanupSteps.push(() =>
        args.world.sharedRefs
          .release(spriteAtlasLoop!.spriteLitMaterialHandle)
          .unwrap(),
      );
    }
  } catch (error) {
    cleanup();
    throw error;
  }
  const visualIndex = (visual: ProjectileVisual): number =>
    visual === "mesh" ? 0 : visual === "sprite" ? 1 : 2;
  const visualValue = (value: number): ProjectileVisual =>
    value === 1 ? "sprite" : value === 2 ? "sprite-lit" : "mesh";
  const getProjectileVisual = (): ProjectileVisual => {
    if (args.player === undefined) return "mesh";
    const policy = args.world.get(args.player, ProjectilePolicy);
    return policy.ok ? visualValue(policy.value.visualMode) : "mesh";
  };
  const setProjectileVisual = (visual: ProjectileVisual): void => {
    if (disposed) return;
    if (args.player !== undefined)
      args.world.set(args.player, ProjectilePolicy, {
        visualMode: visualIndex(visual),
      });
    const sort = setTransparentSortConfig(args.world, {
      mode:
        visual === "mesh"
          ? TRANSPARENT_SORT_MODE_LAYER_Z
          : TRANSPARENT_SORT_MODE_DISTANCE,
      yzAlpha: 1,
    });
    if (!sort.ok)
      console.error(
        "[game] projectile transparent-sort setup failed:",
        sort.error.code,
        sort.error.expected,
        sort.error.hint,
      );
  };
  try {
    setProjectileVisual("mesh");
  } catch (error) {
    cleanup();
    throw error;
  }

  let flashMaterial: Handle<"MaterialAsset", "shared">;
  try {
    flashMaterial = createHitFlashMaterial(args.world);
  } catch (error) {
    cleanup();
    throw error;
  }
  cleanupSteps.push(() =>
    args.world.sharedRefs.release(flashMaterial).unwrap(),
  );
  const materialsForCurrentMesh = (
    entity: EntityHandle,
    flashing: boolean,
  ): readonly Handle<"MaterialAsset", "shared">[] => {
    const presentation = args.world.get(entity, TargetPresentation);
    const original = presentation.ok
      ? presentation.value.authoredMaterials
      : [];
    const textured =
      args.jpegTextureSwap?.entity === entity &&
      args.jpegTextureSwap.active === "jpeg"
        ? args.jpegTextureSwap.jpegMaterials
        : original;
    const replacementHasOneSubmesh =
      (args.fbxMeshSwap?.entity === entity &&
        args.fbxMeshSwap.active === "fbx") ||
      (args.meshHandleSwap?.entity === entity &&
        args.meshHandleSwap.active === "alternate") ||
      (args.gltfMeshSwap?.entity === entity &&
        args.gltfMeshSwap.active !== "original");
    const useFlash = flashing && !disposed;
    if (replacementHasOneSubmesh)
      return [
        useFlash
          ? flashMaterial
          : (textured[0] ?? (0 as Handle<"MaterialAsset", "shared">)),
      ];
    return useFlash ? [flashMaterial, ...textured.slice(1)] : [...textured];
  };
  const triggerFlash = (entity?: EntityHandle): void => {
    if (disposed) return;
    const target = entity === undefined ? args.primaryTarget() : entity;
    if (target === undefined) return;
    const flash = args.world.get(target, HitFlash);
    if (!flash.ok || flash.value.remaining > 0) return;
    args.world.set(target, MeshRenderer, {
      materials: [...materialsForCurrentMesh(target, true)],
    });
    args.world.set(target, HitFlash, { remaining: 0.2 });
    args.chromaticAberration.setIntensity(
      Math.max(args.chromaticAberration.snapshot().intensity, 0.035),
    );
  };
  const multiMaterial = () => {
    const target = args.targetEntities().find((candidate) => {
      const presentation = args.world.get(candidate, TargetPresentation);
      return presentation.ok && presentation.value.authoredMaterials.length > 1;
    });
    if (target === undefined)
      return {
        available: false,
        materialCount: 0,
        submeshCount: 0,
        topologies: [],
        slotsAligned: false,
      };
    const renderer = args.world.get(target, MeshRenderer);
    const filter = args.world.get(target, MeshFilter);
    const mesh = filter.ok
      ? args.world.sharedRefs.resolve<"MeshAsset", MeshAsset>(
          filter.value.assetHandle,
        )
      : undefined;
    const materialCount = renderer.ok ? renderer.value.materials.length : 0;
    const submeshes = mesh?.ok === true ? mesh.value.submeshes : [];
    return {
      available: materialCount > 1 && materialCount === submeshes.length,
      materialCount,
      submeshCount: submeshes.length,
      topologies: submeshes.map((submesh) => submesh.topology),
      slotsAligned: materialCount === submeshes.length && materialCount > 1,
    };
  };

  cleanupSteps.push(() => {
    for (const entity of args.targetEntities()) {
      const flash = args.world.get(entity, HitFlash);
      if (!flash.ok || flash.value.remaining <= 0) continue;
      args.world.set(entity, MeshRenderer, {
        materials: [...materialsForCurrentMesh(entity, false)],
      });
      args.world.set(entity, HitFlash, { remaining: 0 });
    }
  });
  const projectileQuery = createQueryState({ with: [Projectile, Entity] });
  cleanupSteps.push(() => {
    const entities: EntityHandle[] = [];
    queryRun(projectileQuery, args.world, (bundle) => {
      for (const entity of bundle.Entity.self) {
        if (entity !== undefined) entities.push(entity as EntityHandle);
      }
    });
    for (const entity of entities) args.world.despawn(entity).unwrap();
  });
  for (const systemName of [
    "game-default-sprite-animation",
    "game-projectile-simulation",
  ]) {
    cleanupSteps.push(() => {
      const installed =
        args.world
          .inspect()
          .schedules.find((entry) => entry.schedule.name === Update.name)
          ?.systems.some((system) => system.name === systemName) === true;
      if (installed) args.world.removeSystem(Update, systemName).unwrap();
    });
  }
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    cleanup();
  };

  return {
    bulletRadius,
    bulletHalfHeight,
    projectileMesh,
    projectileMaterial,
    customProjectile,
    spriteAtlasLoop,
    flashMaterial,
    getProjectileVisual,
    setProjectileVisual,
    materialsForCurrentMesh,
    triggerFlash,
    multiMaterial,
    dispose,
  };
}
