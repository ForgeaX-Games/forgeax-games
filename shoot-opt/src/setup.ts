/**
 * Materials & Geometry registration — single source of truth for all visual assets.
 * // 把所有颜料和画笔整整齐齐放在一起~ ♪
 *
 * Materials live as authored assets under `assets/materials/*.pack.json` and are
 * loaded by GUID at runtime; geometry is still procedurally generated.
 */
import {
  createBoxGeometry,
  createSphereGeometry,
  createConeGeometry,
  createCylinderGeometry,
} from '@forgeax/engine-runtime';
import type { AssetRegistry, MaterialAsset, MeshAsset } from '@forgeax/engine-runtime';
import type { Handle, World } from '@forgeax/engine-ecs';
import { AssetGuid } from '@forgeax/engine-pack/guid';

type MeshHandle = Handle<'MeshAsset', 'shared'>;
type MatHandle = Handle<'MaterialAsset', 'shared'>;

export interface Geo {
  coneHi: MeshHandle;
  coneSharp: MeshHandle;
  coneSm: MeshHandle;
  sphere: MeshHandle;
  sphereSm: MeshHandle;
  sphereTiny: MeshHandle;
  cylinder: MeshHandle;
  cylSm: MeshHandle;
  bullet: MeshHandle;
  particle: MeshHandle;
  starMesh: MeshHandle;
  nebula: MeshHandle;
  CUBE: MeshHandle;
}

export interface Mat {
  // Player
  hull: MatHandle; hullLight: MatHandle; wing: MatHandle; cockpit: MatHandle;
  engine: MatHandle; nozzle: MatHandle; thrustCore: MatHandle; thrustOuter: MatHandle;
  stripe: MatHandle; panelLine: MatHandle; navRed: MatHandle; navGreen: MatHandle;
  finTip: MatHandle; weaponPod: MatHandle;
  // Trail
  trailA: MatHandle; trailB: MatHandle;
  // Enemies
  eHullRed: MatHandle; eHullGold: MatHandle; eHullPurple: MatHandle; eHullGreen: MatHandle;
  eCore: MatHandle; eWing: MatHandle; eThruster: MatHandle;
  eCoreGold: MatHandle; eCorePurple: MatHandle; eCoreGreen: MatHandle;
  eArmor: MatHandle; eGunMetal: MatHandle; eShield: MatHandle;
  // Bullets
  bullet: MatHandle; bulletE: MatHandle;
  // Explosions
  expW: MatHandle; expO: MatHandle; expR: MatHandle;
  // Background — city
  cityDark: MatHandle; cityMid: MatHandle; cityLight: MatHandle;
  windowCyan: MatHandle; windowPink: MatHandle; windowYellow: MatHandle; windowWhite: MatHandle;
  neonCyan: MatHandle; neonPink: MatHandle; neonPurple: MatHandle; neonGreen: MatHandle;
  roadDark: MatHandle; roadLine: MatHandle;
  trafficA: MatHandle; trafficB: MatHandle;
  rooftop: MatHandle; antenna: MatHandle;
  // Background — industrial zone
  factory: MatHandle; smokestack: MatHandle; pipe: MatHandle; steamGlow: MatHandle; rust: MatHandle;
  // Background — river zone
  water: MatHandle; waterGlow: MatHandle; bridge: MatHandle; riverBank: MatHandle;
  // Background — park zone
  grass: MatHandle; tree: MatHandle; treeTrunk: MatHandle; holoBillboard: MatHandle; fountain: MatHandle;
  // Background — highway zone
  highway: MatHandle; highwayRail: MatHandle; highwayLight: MatHandle;
  // Power-ups
  puShield: MatHandle; puTriple: MatHandle; puBomb: MatHandle; puHeal: MatHandle;
  // Obstacles
  obstacle: MatHandle; obstacleGlow: MatHandle;
  // Background — sky
  starW: MatHandle; starD: MatHandle;
}

/**
 * GUID → material-key map. Each GUID resolves to an authored asset pack under
 * `assets/materials/<key>.pack.json`. Editing a material's look means editing
 * the pack file, not this source — this is just the binding layer.
 */
export const GUIDS: Record<keyof Mat, string> = {
  hull: 'f946e3fc-ebdc-450a-ad61-b3d585209df6',
  hullLight: '296304e7-bb9f-4d91-9076-44ed416bea5d',
  wing: 'bd08cd7b-c6cd-4b4d-b1b1-a49405d5e12c',
  cockpit: '85632fc7-a6f7-4c10-a3d3-13db749acf47',
  engine: '0d790ae8-5389-46f6-943a-06dc0c876300',
  nozzle: '587d0745-0584-41f8-a739-a5e33e9ace6f',
  thrustCore: '138112c8-0272-40c8-97d0-521c3baf7570',
  thrustOuter: '052b1b41-5cb6-4c9e-a8b5-7065d780ba35',
  stripe: 'e8d3e786-2e75-40d5-943e-3a4195c2b07f',
  panelLine: '9c58eb2b-e361-46ff-b18a-693f8fe08937',
  navRed: '793dd890-da43-4f49-a98e-531c69472c1b',
  navGreen: '87135b03-5dd9-4536-a5a4-1f8322382dd8',
  finTip: '9a1c8019-2c7d-4168-a370-4ef4233a96aa',
  weaponPod: '7753cee8-221e-4c58-bccc-725a345d45bd',
  trailA: '421782a0-f94a-4c87-b499-42ab73fbc1ee',
  trailB: 'd892eb0c-6a78-4f31-bb67-65f733f4f03a',
  eHullRed: 'ec757c47-fc01-444b-b161-8cd571516c72',
  eHullGold: '193a76eb-02aa-4a23-be78-3d13910c83d2',
  eHullPurple: 'e6d51201-93e3-4e02-ab54-8d9b06ef3035',
  eHullGreen: 'a6a9fb42-a088-47d9-899b-149a8ba0f53f',
  eCore: 'e7f914fa-1595-4045-9e7f-b433e64c2f75',
  eWing: '7274e943-e8c5-499a-8aa3-e2fe60a352df',
  eThruster: '8fb621ff-7923-4348-9f3b-312f0a67a758',
  eCoreGold: 'dd73b244-792c-49eb-b36a-bb1d7638422f',
  eCorePurple: 'e7c0c929-ecd4-4a20-a1ab-cbff65d9a5b4',
  eCoreGreen: 'd5a615bc-6719-4329-9b58-1c23ee794583',
  eArmor: 'fe3d4a7f-11af-4e5f-8391-bd8fdfe8e6a7',
  eGunMetal: '342668cc-cb6d-43cc-8b74-38e84d9efce3',
  eShield: '5a5a5409-28c6-43f8-8cd2-27de07dda814',
  bullet: '6828746a-abf8-49dc-80f1-6dd2af6d8e43',
  bulletE: '0bc6a109-ad40-4bd1-b827-7f9ce592d87a',
  expW: '0f624665-83f2-4f91-92d2-2908e218fbb6',
  expO: '87b29928-75ba-4057-ae3d-a0b8dee29d2b',
  expR: '076c1468-2d5e-40bf-b29f-9eab2c7260be',
  cityDark: '51faa353-4c90-4cc8-8b5f-f2eed0f58e27',
  cityMid: '94e6b7b4-42ae-4416-9d44-f6b27a05108e',
  cityLight: 'e88df918-9c77-4b98-a797-a4c9e7dde544',
  windowCyan: '81306111-f240-404a-aaff-f80be5f24a3b',
  windowPink: '9a98bfdd-b388-4662-b87f-e2f45f213981',
  windowYellow: '4323aa53-4561-4f75-9959-e4bd56215187',
  windowWhite: '4a52609c-ba71-413d-952e-2b6d86d862ab',
  neonCyan: 'c11750c0-99ba-4c80-a56a-445f2991e9d0',
  neonPink: 'a3dbf4c8-a44e-4be3-af39-436718c817a6',
  neonPurple: '06bc1784-373d-4aea-a54f-3cbc2d42a9a5',
  neonGreen: 'e91665f0-80bd-41b4-924f-5561e2e5413e',
  roadDark: 'f748967e-970e-480d-806e-28ef454378ed',
  roadLine: 'ed169377-9bb1-4ad5-adae-34e5de3e3a86',
  trafficA: '7cbfc0d1-0361-495d-b571-bafcebed6ae4',
  trafficB: 'c84f58f2-8477-4ec7-8342-6181a4050000',
  rooftop: '975bdeb4-5496-4701-b635-bdc58194fac8',
  antenna: '84d6ae18-1f1e-453d-89f4-ab616f0b71e8',
  factory: '9be89f29-021d-4200-9aa4-9305cb2f17e5',
  smokestack: 'a53c8817-7ff7-41d7-abae-450036a0a0ca',
  pipe: '1910814f-5bc4-4765-b11b-f78db2498254',
  steamGlow: 'd07744a6-da7d-4850-ae04-bc061187d354',
  rust: 'c2fcc66b-912b-4546-8b2a-69593c845da5',
  water: '1f51667a-7f15-4bb5-8523-af6b32251135',
  waterGlow: '056bbdaf-39fa-4b6b-9f1a-6d31a13981a4',
  bridge: '8c6f1d58-7183-4e14-b478-fb9877143546',
  riverBank: '456fc1e8-7934-4c42-bd33-69b83ffda1a0',
  grass: '22e91e0f-da29-4e16-ad1a-339e559ce9b6',
  tree: '4ad2929d-6ec3-4d6c-99c1-f1c420689c00',
  treeTrunk: '6472a1d4-e7f4-4261-966f-15faaed82bc0',
  holoBillboard: '8d9d4426-90f4-4e0f-9a7e-6887a146152b',
  fountain: '47d621d4-d29a-468f-ac11-11e617ef86d0',
  highway: '08d50505-507c-4d75-9821-1837bfb062fe',
  highwayRail: 'cd37bdec-9291-4f2b-94df-c7a8c32046ee',
  highwayLight: '12db2efe-d8fc-44b5-b478-1934f127ce8c',
  puShield: 'ca67b9b7-fbcf-4c5d-8e70-b46607e62d99',
  puTriple: 'ebc7b1b2-672f-404f-942c-75fd2b73b9a0',
  puBomb: '770495aa-6d82-45d6-81d9-82c37a8c9f42',
  puHeal: 'd00d1012-12eb-493e-8652-2a97daba683a',
  obstacle: '311c6e3a-ca51-4186-b383-89d2f1a31076',
  obstacleGlow: '42ebfb41-8e38-4bd6-9114-e0ff94c5974e',
  starW: 'fd083c47-a279-4495-94c3-4ced947af6e7',
  starD: '81d50e5d-52d4-4cf4-9b83-8a3baf2efc38',
};

export async function registerMaterials(assets: AssetRegistry, world: World): Promise<Mat> {
  const entries = Object.entries(GUIDS) as [keyof Mat, string][];
  const result = {} as Mat;
  for (const [key, guidStr] of entries) {
    const guid = AssetGuid.parse(guidStr);
    if (!guid.ok) throw new Error(`[shoot] bad GUID for material "${key}"`);
    // loadByGuid catalogues the payload (and recursively its base-material
    // refs) but returns the PAYLOAD, not a handle. Mint the column handle on
    // the World; the derived material's `parent` GUID resolves lazily at render.
    const loaded = await assets.loadByGuid<MaterialAsset>(guid.value);
    if (!loaded.ok) throw new Error(`[shoot] loadByGuid failed for "${key}": ${loaded.error.code}`);
    result[key] = world.allocSharedRef('MaterialAsset', loaded.value);
  }
  return result;
}

/**
 * GUID → geometry-key map. Geometry is procedurally generated but registered
 * under stable GUIDs so authored scene assets (`assets/enemies/*.pack.json`)
 * can reference each mesh by GUID in their `refs[]`. The factory shape for each
 * key (radius/segments) lives in `registerGeometry` below — this map only binds
 * the GUID identity.
 */
export const GEO_GUIDS: Record<keyof Geo, string> = {
  coneHi:     '53f79c6c-ad95-45e5-b8fd-d2195717e9c4',
  coneSharp:  '612e6ee7-d57b-4210-9ae1-bec70517f677',
  coneSm:     '8d8c2ac9-9cb5-4a9c-8526-c70469aa3f82',
  sphere:     '307095a5-3aed-4a3d-9c31-7c937e12404f',
  sphereSm:   '8c6bc8c9-b788-44b9-8371-44693e8310a2',
  sphereTiny: 'c343641e-5b9a-4e34-984f-d4371560a47a',
  cylinder:   '511966a3-80a9-44e6-bfa4-c14ba1c46d0a',
  cylSm:      '1a01a4b1-492e-4352-84be-6c884b91f29b',
  bullet:     '821a2dea-2333-484b-8ca4-61df1fe16cbf',
  particle:   'ab9e4510-c305-457c-8946-f6c18ea98d7b',
  starMesh:   '89be6120-94aa-4b6f-9fd1-c88781aad7dc',
  nebula:     'a4fa1ed4-b66b-4cde-a630-35a93bc74167',
  CUBE:       '00d274da-e863-41d8-bafe-10b97d1468d4',
};

export function registerGeometry(assets: AssetRegistry, world: World): Geo {
  // `catalog(guid, payload)` registers the GUID->mesh-payload binding so scenes
  // can reference geometry by GUID; it returns the payload, not a handle. The
  // column handle (the number consumed as MeshFilter.assetHandle) is minted on
  // the World via `allocSharedRef`.
  const r = (key: keyof Geo, m: MeshAsset): MeshHandle => {
    const guid = AssetGuid.parse(GEO_GUIDS[key]);
    if (!guid.ok) throw new Error(`[shoot] bad GUID for geometry "${key}"`);
    const cat = assets.catalog<MeshAsset>(guid.value, m);
    if (!cat.ok) throw new Error(`[shoot] catalog failed for geometry "${key}": ${cat.error.code}`);
    return world.allocSharedRef('MeshAsset', cat.value);
  };
  return {
    coneHi:     r('coneHi',     createConeGeometry(0.5, 1.5, 16).unwrap()),
    coneSharp:  r('coneSharp',  createConeGeometry(0.3, 2.0, 12).unwrap()),
    coneSm:     r('coneSm',     createConeGeometry(0.3, 0.8, 10).unwrap()),
    sphere:     r('sphere',     createSphereGeometry(0.5, 12, 10).unwrap()),
    sphereSm:   r('sphereSm',   createSphereGeometry(0.5, 8, 6).unwrap()),
    sphereTiny: r('sphereTiny', createSphereGeometry(0.5, 6, 4).unwrap()),
    cylinder:   r('cylinder',   createCylinderGeometry(0.5, 0.5, 1.0, 12).unwrap()),
    cylSm:      r('cylSm',       createCylinderGeometry(0.5, 0.5, 1.0, 8).unwrap()),
    bullet:     r('bullet',     createSphereGeometry(0.18, 8, 6).unwrap()),
    particle:   r('particle',   createSphereGeometry(0.14, 5, 4).unwrap()),
    starMesh:   r('starMesh',   createSphereGeometry(0.5, 4, 3).unwrap()),
    nebula:     r('nebula',     createSphereGeometry(1.0, 8, 6).unwrap()),
    CUBE:       r('CUBE',       createBoxGeometry(1, 1, 1).unwrap()),
  };
}
