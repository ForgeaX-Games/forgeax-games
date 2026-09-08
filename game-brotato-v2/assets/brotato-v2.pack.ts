import { AssetGuid } from '@forgeax/engine-pack/guid';
import type {
  ScriptablePackAssetDeclarations,
  ScriptablePackDefinition,
  ScriptablePackOutputs,
} from '@forgeax/engine-pack/source';
import type { AssetGuid as AssetGuidType, LocalEntityId, SceneAsset } from '@forgeax/engine-types';
import { ok } from '@forgeax/engine-types';

const PACKAGE_NAME = 'Brotato 3D v2' as const;

function guid(value: string): AssetGuidType {
  const result = AssetGuid.parse(value);
  if (!result.ok) throw result.error;
  return result.value;
}

const assets = {
  'texture/glow-mask': {
    guid: guid('019fc0a0-2000-7000-8000-000000000020'),
    kind: 'texture',
    name: `${PACKAGE_NAME} / Glow Mask`,
  },
  'equirect/sky': {
    guid: guid('019fc0a0-2000-7000-8000-000000000021'),
    kind: 'equirect',
    name: `${PACKAGE_NAME} / Built-in Sky`,
  },
  'equirect/background': {
    guid: guid('019fc0a0-2000-7000-8000-000000000022'),
    kind: 'equirect',
    name: `${PACKAGE_NAME} / Dark Arena Background`,
  },
  'material/arena-floor': {
    guid: guid('019fc0a0-2000-7000-8000-000000000001'),
    kind: 'material',
    name: `${PACKAGE_NAME} / Arena Floor`,
  },
  'material/arena-tile-a': {
    guid: guid('019fc0a0-2000-7000-8000-000000000002'),
    kind: 'material',
    name: `${PACKAGE_NAME} / Arena Tile A`,
  },
  'material/arena-tile-b': {
    guid: guid('019fc0a0-2000-7000-8000-000000000003'),
    kind: 'material',
    name: `${PACKAGE_NAME} / Arena Tile B`,
  },
  'material/arena-wall': {
    guid: guid('019fc0a0-2000-7000-8000-000000000004'),
    kind: 'material',
    name: `${PACKAGE_NAME} / Arena Wall`,
  },
  'material/tomato-body': {
    guid: guid('019fc0a0-2000-7000-8000-000000000005'),
    kind: 'material',
    name: `${PACKAGE_NAME} / Tomato Body`,
  },
  'material/tomato-stem': {
    guid: guid('019fc0a0-2000-7000-8000-000000000006'),
    kind: 'material',
    name: `${PACKAGE_NAME} / Tomato Stem`,
  },
  'material/tomato-eye': {
    guid: guid('019fc0a0-2000-7000-8000-000000000007'),
    kind: 'material',
    name: `${PACKAGE_NAME} / Tomato Eye`,
  },
  'material/tomato-sole': {
    guid: guid('019fc0a0-2000-7000-8000-000000000008'),
    kind: 'material',
    name: `${PACKAGE_NAME} / Tomato Sole`,
  },
  'material/view-calibration': {
    guid: guid('019fc0a0-2000-7000-8000-000000000009'),
    kind: 'material',
    name: `${PACKAGE_NAME} / View Calibration`,
  },
  'material/potato-body': {
    guid: guid('019fc0a0-2000-7000-8000-00000000000a'),
    kind: 'material',
    name: `${PACKAGE_NAME} / Potato Body`,
  },
  'material/potato-sprout': {
    guid: guid('019fc0a0-2000-7000-8000-00000000000b'),
    kind: 'material',
    name: `${PACKAGE_NAME} / Potato Sprout`,
  },
  'material/weapon-wood': {
    guid: guid('019fc0a0-2000-7000-8000-00000000000c'),
    kind: 'material',
    name: `${PACKAGE_NAME} / Weapon Wood`,
  },
  'material/weapon-steel': {
    guid: guid('019fc0a0-2000-7000-8000-00000000000d'),
    kind: 'material',
    name: `${PACKAGE_NAME} / Weapon Steel`,
  },
  'material/hit-flash': {
    guid: guid('019fc0a0-2000-7000-8000-00000000000e'),
    kind: 'material',
    name: `${PACKAGE_NAME} / Hit Flash`,
  },
  'material/spawn-marker': {
    guid: guid('019fc0a0-2000-7000-8000-00000000000f'),
    kind: 'material',
    name: `${PACKAGE_NAME} / Spawn Marker`,
  },
  'material/attack-range': {
    guid: guid('019fc0a0-2000-7000-8000-000000000010'),
    kind: 'material',
    name: `${PACKAGE_NAME} / Attack Range`,
  },
  'mesh/arena-floor': {
    guid: guid('019fc0a0-2000-7000-8000-000000000030'),
    kind: 'mesh',
    name: `${PACKAGE_NAME} / Arena Floor Mesh`,
  },
  'mesh/arena-field-a': {
    guid: guid('019fc0a0-2000-7000-8000-000000000031'),
    kind: 'mesh',
    name: `${PACKAGE_NAME} / Arena Tile Field A`,
  },
  'mesh/arena-field-b': {
    guid: guid('019fc0a0-2000-7000-8000-000000000032'),
    kind: 'mesh',
    name: `${PACKAGE_NAME} / Arena Tile Field B`,
  },
  'mesh/arena-wall': {
    guid: guid('019fc0a0-2000-7000-8000-000000000033'),
    kind: 'mesh',
    name: `${PACKAGE_NAME} / Arena Wall Mesh`,
  },
  'mesh/tomato-body': {
    guid: guid('019fc0a0-2000-7000-8000-000000000034'),
    kind: 'mesh',
    name: `${PACKAGE_NAME} / Tomato Body Mesh`,
  },
  'mesh/tomato-hand': {
    guid: guid('019fc0a0-2000-7000-8000-000000000035'),
    kind: 'mesh',
    name: `${PACKAGE_NAME} / Tomato Hand Mesh`,
  },
  'mesh/tomato-foot': {
    guid: guid('019fc0a0-2000-7000-8000-000000000036'),
    kind: 'mesh',
    name: `${PACKAGE_NAME} / Tomato Foot Mesh`,
  },
  'mesh/view-calibration': {
    guid: guid('019fc0a0-2000-7000-8000-000000000037'),
    kind: 'mesh',
    name: `${PACKAGE_NAME} / View Calibration Mesh`,
  },
  'mesh/enemy-potato': {
    guid: guid('019fc0a0-2000-7000-8000-000000000038'),
    kind: 'mesh',
    name: `${PACKAGE_NAME} / Sprouted Potato Mesh`,
  },
  'mesh/weapon-spear': {
    guid: guid('019fc0a0-2000-7000-8000-000000000039'),
    kind: 'mesh',
    name: `${PACKAGE_NAME} / Spear Mesh`,
  },
  'mesh/weapon-axe': {
    guid: guid('019fc0a0-2000-7000-8000-00000000003a'),
    kind: 'mesh',
    name: `${PACKAGE_NAME} / Axe Mesh`,
  },
  'mesh/spawn-marker': {
    guid: guid('019fc0a0-2000-7000-8000-00000000003b'),
    kind: 'mesh',
    name: `${PACKAGE_NAME} / Spawn Marker Mesh`,
  },
  'mesh/range-spear': {
    guid: guid('019fc0a0-2000-7000-8000-00000000003d'),
    kind: 'mesh',
    name: `${PACKAGE_NAME} / Spear Attack Range`,
  },
  'mesh/range-axe': {
    guid: guid('019fc0a0-2000-7000-8000-00000000003e'),
    kind: 'mesh',
    name: `${PACKAGE_NAME} / Axe Attack Range`,
  },
  'scene/arena': {
    guid: guid('019fc0a0-2000-7000-8000-000000000050'),
    kind: 'scene',
    name: `${PACKAGE_NAME} / Arena Scene`,
  },
  'scene/player-tomato': {
    guid: guid('019fc0a0-2000-7000-8000-000000000051'),
    kind: 'scene',
    name: `${PACKAGE_NAME} / Tomato Player Scene`,
  },
  'scene/enemy-potato': {
    guid: guid('019fc0a0-2000-7000-8000-000000000052'),
    kind: 'scene',
    name: `${PACKAGE_NAME} / Sprouted Potato Scene`,
  },
  'scene/weapon-spear': {
    guid: guid('019fc0a0-2000-7000-8000-000000000053'),
    kind: 'scene',
    name: `${PACKAGE_NAME} / Spear Scene`,
  },
  'scene/weapon-axe': {
    guid: guid('019fc0a0-2000-7000-8000-000000000054'),
    kind: 'scene',
    name: `${PACKAGE_NAME} / Axe Scene`,
  },
  'scene/spawn-marker': {
    guid: guid('019fc0a0-2000-7000-8000-000000000055'),
    kind: 'scene',
    name: `${PACKAGE_NAME} / Spawn Marker Scene`,
  },
} as const satisfies ScriptablePackAssetDeclarations;

type StandardMaterialOptions = Omit<
  Parameters<typeof import('@forgeax/engine-render').Materials.standard>[0],
  'baseColor'
>;

function material(
  materials: typeof import('@forgeax/engine-render').Materials,
  baseColor: readonly [number, number, number, number],
  options: StandardMaterialOptions,
) {
  return materials.standard({ ...options, baseColor });
}

function unlitRangeMaterial(
  materials: typeof import('@forgeax/engine-render').Materials,
  color: readonly [number, number, number, number],
) {
  return materials.unlit(color, {
    castShadow: false,
    renderState: {
      cullMode: 'none',
      depthWriteEnabled: false,
      blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
    },
  });
}

function mergedActorScene(
  name: string,
  mesh: AssetGuidType,
  materials: readonly AssetGuidType[],
  scale: number,
): SceneAsset {
  return {
    kind: 'scene',
    entities: [{
      localId: 0 as LocalEntityId,
      components: {
        Name: { value: name },
        Transform: { pos: [0, 0, 0], scale: [scale, scale, scale], quat: [0, 0, 0, 1] },
        MeshFilter: { assetHandle: AssetGuid.format(mesh) },
        MeshRenderer: { materials: materials.map((value) => AssetGuid.format(value)) },
      },
    }],
  };
}

function weaponScene(
  name: string,
  mesh: AssetGuidType,
  rangeMesh: AssetGuidType,
  materials: readonly AssetGuidType[],
  rangeMaterial: AssetGuidType,
): SceneAsset {
  return {
    kind: 'scene',
    entities: [
      {
        localId: 0 as LocalEntityId,
        components: {
          Name: { value: `${name} Root` },
          Transform: { pos: [0, 0, 0], scale: [1, 1, 1], quat: [0, 0, 0, 1] },
        },
      },
      {
        localId: 1 as LocalEntityId,
        components: {
          Name: { value: name },
          Transform: { pos: [0, 0, 0], scale: [1, 1, 1], quat: [0, 0, 0, 1] },
          ChildOf: { parent: 0 },
          MeshFilter: { assetHandle: AssetGuid.format(mesh) },
          MeshRenderer: { materials: materials.map((value) => AssetGuid.format(value)) },
        },
      },
      {
        localId: 2 as LocalEntityId,
        components: {
          Name: { value: `${name} Attack Range` },
          Transform: { pos: [0, -0.48, 0], scale: [1, 1, 1], quat: [0, 0, 0, 1] },
          ChildOf: { parent: 0 },
          MeshFilter: { assetHandle: AssetGuid.format(rangeMesh) },
          MeshRenderer: { materials: [AssetGuid.format(rangeMaterial)] },
        },
      },
    ],
  };
}

const scriptablePack = {
  schemaVersion: '1.0.0',
  packageId: guid('019fc0a0-2000-7000-8000-000000000000'),
  name: PACKAGE_NAME,
  assets,
  externalAssets: {},
  async build() {
    const {
      bindMaterialSlots,
      buildActorHierarchy,
      buildActorMergedMesh,
      buildActorMeshes,
      createArenaGeometry,
      createArenaBackgroundEquirect,
      createAttackRangeGeometry,
      createArenaScene,
      createGlowMaskTexture,
      createSkyEquirect,
      createViewCalibrationGeometry,
    } = await import('./lib.ts');
    const { TOMATO_RECIPE } = await import('./lib/actors/tomato.ts');
    const { SPROUTED_POTATO_RECIPE } = await import('./lib/actors/sprouted-potato.ts');
    const { SPAWN_MARKER_RECIPE } = await import('./lib/markers/spawn-marker.ts');
    const { AXE_PROFILE } = await import('./lib/weapons/axe.ts');
    const { SPEAR_PROFILE } = await import('./lib/weapons/spear.ts');
    const { Materials } = await import('@forgeax/engine-render');
    const geometry = createArenaGeometry();
    const glowMask = assets['texture/glow-mask'].guid;
    const sky = assets['equirect/sky'].guid;
    const background = assets['equirect/background'].guid;
    const floorMaterial = assets['material/arena-floor'].guid;
    const tileAMaterial = assets['material/arena-tile-a'].guid;
    const tileBMaterial = assets['material/arena-tile-b'].guid;
    const wallMaterial = assets['material/arena-wall'].guid;
    const tomatoBodyMaterial = assets['material/tomato-body'].guid;
    const tomatoStemMaterial = assets['material/tomato-stem'].guid;
    const tomatoEyeMaterial = assets['material/tomato-eye'].guid;
    const tomatoSoleMaterial = assets['material/tomato-sole'].guid;
    const calibrationMaterial = assets['material/view-calibration'].guid;
    const potatoBodyMaterial = assets['material/potato-body'].guid;
    const potatoSproutMaterial = assets['material/potato-sprout'].guid;
    const weaponWoodMaterial = assets['material/weapon-wood'].guid;
    const weaponSteelMaterial = assets['material/weapon-steel'].guid;
    const hitFlashMaterial = assets['material/hit-flash'].guid;
    const spawnMarkerMaterial = assets['material/spawn-marker'].guid;
    const attackRangeMaterial = assets['material/attack-range'].guid;
    const tomatoMaterials = [
      tomatoBodyMaterial,
      tomatoStemMaterial,
      tomatoEyeMaterial,
      tomatoSoleMaterial,
    ] as const;
    const tomatoMeshes = buildActorMeshes(TOMATO_RECIPE);
    const tomatoHand = tomatoMeshes.limbs.get('hand-l');
    const tomatoFoot = tomatoMeshes.limbs.get('foot-l');
    if (tomatoHand === undefined || tomatoFoot === undefined) {
      throw new Error('Brotato tomato recipe must define hand and foot meshes');
    }
    const potatoMaterials = [potatoBodyMaterial, potatoSproutMaterial, tomatoEyeMaterial] as const;
    const weaponMaterials = [weaponWoodMaterial, weaponSteelMaterial] as const;
    const potatoMesh = buildActorMergedMesh(SPROUTED_POTATO_RECIPE);
    const spearMesh = buildActorMergedMesh({
      id: SPEAR_PROFILE.id,
      displayName: SPEAR_PROFILE.displayName,
      materialSlots: SPEAR_PROFILE.model.materialSlots,
      body: SPEAR_PROFILE.model.parts,
      limbs: [],
      rootScale: 1,
      groundOffset: 0,
    });
    const axeMesh = buildActorMergedMesh({
      id: AXE_PROFILE.id,
      displayName: AXE_PROFILE.displayName,
      materialSlots: AXE_PROFILE.model.materialSlots,
      body: AXE_PROFILE.model.parts,
      limbs: [],
      rootScale: 1,
      groundOffset: 0,
    });
    const spawnMarkerMesh = buildActorMergedMesh(SPAWN_MARKER_RECIPE);
    return ok({
      'texture/glow-mask': createGlowMaskTexture(),
      'equirect/sky': createSkyEquirect(),
      'equirect/background': createArenaBackgroundEquirect(),
      'material/arena-floor': material(Materials, [0.09, 0.16, 0.24, 1], {
        metallic: 0.08, roughness: 0.9, castShadow: true,
      }),
      'material/arena-tile-a': material(Materials, [0.14, 0.26, 0.39, 1], {
        metallic: 0.05, roughness: 0.8, castShadow: true,
      }),
      'material/arena-tile-b': material(Materials, [0.16, 0.29, 0.43, 1], {
        metallic: 0.08, roughness: 0.74, castShadow: true,
      }),
      'material/arena-wall': material(Materials, [0.08, 0.2, 0.29, 1], {
        baseColorTexture: AssetGuid.format(glowMask),
        metallic: 0.25,
        roughness: 0.5,
        emissive: [0.01, 0.08, 0.12],
        emissiveIntensity: 0.8,
        castShadow: true,
      }),
      'material/tomato-body': material(Materials, [0.86, 0.13, 0.12, 1], {
        metallic: 0.05,
        roughness: 0.38,
        emissive: [0.06, 0.008, 0.006],
        emissiveIntensity: 0.35,
        castShadow: true,
      }),
      'material/tomato-stem': material(Materials, [0.22, 0.62, 0.2, 1], {
        metallic: 0.02,
        roughness: 0.52,
        emissive: [0.01, 0.035, 0.008],
        emissiveIntensity: 0.2,
        castShadow: true,
      }),
      'material/tomato-eye': material(Materials, [0.06, 0.05, 0.08, 1], {
        metallic: 0,
        roughness: 0.3,
        castShadow: true,
      }),
      'material/tomato-sole': material(Materials, [0.62, 0.09, 0.09, 1], {
        metallic: 0.03,
        roughness: 0.44,
        castShadow: true,
      }),
      'material/view-calibration': material(Materials, [0.02, 0.95, 1, 1], {
        metallic: 0.05,
        roughness: 0.25,
        emissive: [0.01, 0.7, 0.9],
        emissiveIntensity: 2.5,
        castShadow: false,
      }),
      'material/potato-body': material(Materials, [0.72, 0.55, 0.32, 1], {
        metallic: 0,
        roughness: 0.78,
        castShadow: true,
      }),
      'material/potato-sprout': material(Materials, [0.55, 0.78, 0.42, 1], {
        metallic: 0,
        roughness: 0.55,
        emissive: [0.04, 0.1, 0.02],
        emissiveIntensity: 0.3,
        castShadow: true,
      }),
      'material/weapon-wood': material(Materials, [0.38, 0.17, 0.07, 1], {
        metallic: 0,
        roughness: 0.74,
        castShadow: false,
      }),
      'material/weapon-steel': material(Materials, [0.47, 0.62, 0.72, 1], {
        metallic: 0.78,
        roughness: 0.23,
        castShadow: false,
      }),
      'material/hit-flash': material(Materials, [1, 0.95, 0.72, 1], {
        metallic: 0,
        roughness: 0.35,
        emissive: [1, 0.7, 0.2],
        emissiveIntensity: 3,
        castShadow: false,
      }),
      'material/spawn-marker': material(Materials, [0.88, 0.20, 0.17, 1], {
        metallic: 0,
        roughness: 0.9,
        emissive: [0.88, 0.20, 0.17],
        emissiveIntensity: 1.2,
        castShadow: false,
      }),
      'material/attack-range': unlitRangeMaterial(Materials, [0.48, 0.9, 1, 0.2]),
      'mesh/arena-floor': bindMaterialSlots(geometry.floor, [floorMaterial], 'arena-floor'),
      'mesh/arena-field-a': bindMaterialSlots(geometry.tileA, [tileAMaterial], 'arena-field-a'),
      'mesh/arena-field-b': bindMaterialSlots(geometry.tileB, [tileBMaterial], 'arena-field-b'),
      'mesh/arena-wall': bindMaterialSlots(geometry.wall, [wallMaterial], 'arena-wall'),
      'mesh/tomato-body': bindMaterialSlots(tomatoMeshes.body, tomatoMaterials, 'tomato-body'),
      'mesh/tomato-hand': bindMaterialSlots(tomatoHand, tomatoMaterials, 'tomato-hand'),
      'mesh/tomato-foot': bindMaterialSlots(tomatoFoot, tomatoMaterials, 'tomato-foot'),
      'mesh/view-calibration': bindMaterialSlots(
        createViewCalibrationGeometry(),
        [calibrationMaterial],
        'view-calibration',
      ),
      'mesh/enemy-potato': bindMaterialSlots(potatoMesh, potatoMaterials, 'enemy-potato'),
      'mesh/weapon-spear': bindMaterialSlots(spearMesh, weaponMaterials, 'weapon-spear'),
      'mesh/weapon-axe': bindMaterialSlots(axeMesh, weaponMaterials, 'weapon-axe'),
      'mesh/spawn-marker': bindMaterialSlots(spawnMarkerMesh, [spawnMarkerMaterial], 'spawn-marker'),
      'mesh/range-spear': bindMaterialSlots(
        createAttackRangeGeometry(SPEAR_PROFILE),
        [attackRangeMaterial],
        'range-spear',
      ),
      'mesh/range-axe': bindMaterialSlots(
        createAttackRangeGeometry(AXE_PROFILE),
        [attackRangeMaterial],
        'range-axe',
      ),
      'scene/arena': createArenaScene({
        meshArenaFloor: assets['mesh/arena-floor'].guid,
        meshArenaTileA: assets['mesh/arena-field-a'].guid,
        meshArenaTileB: assets['mesh/arena-field-b'].guid,
        meshArenaWall: assets['mesh/arena-wall'].guid,
        materialArenaFloor: floorMaterial,
        materialArenaTileA: tileAMaterial,
        materialArenaTileB: tileBMaterial,
        materialArenaWall: wallMaterial,
        equirectSky: sky,
        equirectBackground: background,
      }),
      'scene/player-tomato': buildActorHierarchy(TOMATO_RECIPE, {
        bodyMesh: AssetGuid.format(assets['mesh/tomato-body'].guid),
        limbMeshes: new Map([
          ['hand-l', AssetGuid.format(assets['mesh/tomato-hand'].guid)],
          ['hand-r', AssetGuid.format(assets['mesh/tomato-hand'].guid)],
          ['foot-l', AssetGuid.format(assets['mesh/tomato-foot'].guid)],
          ['foot-r', AssetGuid.format(assets['mesh/tomato-foot'].guid)],
        ]),
        materials: tomatoMaterials.map((value) => AssetGuid.format(value)),
      }),
      'scene/enemy-potato': mergedActorScene(
        'Sprouted Potato',
        assets['mesh/enemy-potato'].guid,
        potatoMaterials,
        SPROUTED_POTATO_RECIPE.rootScale,
      ),
      'scene/weapon-spear': weaponScene(
        'Spear',
        assets['mesh/weapon-spear'].guid,
        assets['mesh/range-spear'].guid,
        weaponMaterials,
        attackRangeMaterial,
      ),
      'scene/weapon-axe': weaponScene(
        'Axe',
        assets['mesh/weapon-axe'].guid,
        assets['mesh/range-axe'].guid,
        weaponMaterials,
        attackRangeMaterial,
      ),
      'scene/spawn-marker': mergedActorScene(
        'Spawn Marker',
        assets['mesh/spawn-marker'].guid,
        [spawnMarkerMaterial],
        SPAWN_MARKER_RECIPE.rootScale,
      ),
    } satisfies ScriptablePackOutputs<typeof assets>);
  },
} satisfies ScriptablePackDefinition<typeof assets>;

export { assets };
export default scriptablePack;
