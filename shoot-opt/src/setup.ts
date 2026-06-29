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
  hull: '468b0c54-ca46-4684-8f38-e3807dea2091',
  hullLight: 'e4fb6ef7-9555-44fc-9149-439aa72dcd9e',
  wing: 'e7e8591c-16ee-4c93-b93a-509f083ef4c9',
  cockpit: '0085bd79-a515-4dd0-aa1c-7026bb93f702',
  engine: '0428353d-4da9-45c3-bdc7-920888dca65d',
  nozzle: '42a798e8-651c-418e-bad6-2fc4e2b8eea2',
  thrustCore: '8e9ca397-09a9-40cd-9891-16040e8e6829',
  thrustOuter: '0548965b-8460-4e6d-86b8-8fc1612cf775',
  stripe: '0c1625f8-8ba8-4018-8516-81e18e6ce22c',
  panelLine: '39e34fce-ba85-4bf6-9642-6a352f7eb3db',
  navRed: '664ce26b-7480-4107-9651-3de8161b72c2',
  navGreen: '5907c521-feab-4377-98c5-07253f6ce81a',
  finTip: '7cc5e46c-8877-4319-a803-37aa345fddc9',
  weaponPod: '740ce011-11ab-417d-8d1d-a759e206fb08',
  trailA: '43cfe27d-ef4a-42ed-be24-b901b3b77232',
  trailB: 'f9836373-c794-4a9b-85b4-cfad933ee5cb',
  eHullRed: '56bea74d-b5bd-4b89-ace2-480cc329922d',
  eHullGold: 'f3a3fc1a-bfaf-44e3-96e1-12a255cd2d06',
  eHullPurple: '499f003f-4e1d-44e2-9f03-153d6134aea9',
  eHullGreen: 'a89160f4-5c3c-4d63-aba8-4fd18a7bfceb',
  eCore: '44119905-bcaf-41fd-9f1d-9243554b3b30',
  eWing: '51e5cbb3-5a5f-4063-8af9-bab747043607',
  eThruster: '6ad212bf-d66d-4c23-8f20-3a2a94279f58',
  eCoreGold: '9b7ebb6c-ba4e-41b5-8263-4de1db9ae7ec',
  eCorePurple: 'ad387448-0f6e-497a-843c-6a632647918a',
  eCoreGreen: '95921ad3-196d-438b-9f2d-05f8e7ba8f83',
  eArmor: '66ab5a3d-9355-45f8-b4f6-e2c6b8c23aa8',
  eGunMetal: '7dfd449f-356c-48a9-88f6-8117049cb01e',
  eShield: 'f656bf14-9409-483f-8b54-1b38cfe27c96',
  bullet: 'c3f7d4ed-6233-4e25-9dae-0f880296abbe',
  bulletE: 'bfd06247-c544-401e-8402-e9f5f03fc4ad',
  expW: 'd2b701b1-3e55-4f68-8d03-19ff750d97b9',
  expO: '79fd5f3a-81e9-4d7f-adea-eb04f18d5420',
  expR: '1ae980ab-fa87-48a3-9a45-9f72cbb0d5f7',
  cityDark: '45475e18-9ad7-4b33-821a-fb60fac5ee2f',
  cityMid: '883edcd8-d9c1-4a64-a789-2314ffeb1206',
  cityLight: 'ee12dc8e-1719-42ce-a1cf-23412b844fbd',
  windowCyan: '2d36f7ff-66b4-4082-b224-b9f2169ed274',
  windowPink: '3e0a76fb-6043-485d-b8f3-192f7006388e',
  windowYellow: '2b4180fc-a3b4-42ce-9c99-8c192536a5b3',
  windowWhite: 'fb7d34f7-7389-4698-b037-41478b7bb3df',
  neonCyan: '2bf34788-6217-4882-8e0b-3906f931c683',
  neonPink: 'dd82ad83-2dad-4a86-bccd-ec9aff282fa5',
  neonPurple: '9f352185-68c1-4bad-818f-cd0162a881dd',
  neonGreen: 'ef95d61c-8260-4c4d-91bd-d2e3aeca16e5',
  roadDark: '871278e5-abbf-42b2-b1e5-290ae130b7ec',
  roadLine: 'e6216681-51b6-496f-a56e-09c08d230612',
  trafficA: '20c82f04-8daf-4918-814c-f8f9dae70d76',
  trafficB: '712787b4-b381-43b4-af66-63efef1be5b6',
  rooftop: 'ab652017-77e8-47ae-80c0-91ff44032d3f',
  antenna: '2e282659-7dc2-4706-840b-f4f83fac4f06',
  factory: '443e8217-5160-4ea7-97a3-a42497f04231',
  smokestack: '0e13ba5b-2a22-4835-b67e-ca13ef0e4d52',
  pipe: '038bd802-6c04-4b7d-8e3e-4cb26d8e11e0',
  steamGlow: 'c4329efc-a8c3-490a-9b0d-693003c9e842',
  rust: '8b10bbec-7909-4853-8618-8c0c6edbace9',
  water: 'c3ae628a-342d-404e-ab00-57c4e53123a0',
  waterGlow: 'f1a15553-1cd5-4b5e-baae-5d071c578d21',
  bridge: 'c90d989a-6eeb-4cfd-ab29-7d7dda928110',
  riverBank: 'bff1dbe3-3836-4b61-a1ca-499bcab65d26',
  grass: '61672b8b-86ca-492f-8666-d4b9fab54aa8',
  tree: 'f74a3351-0b4c-4483-906b-91533c368ec8',
  treeTrunk: '2a39fd5e-2e58-443d-8c0b-b954dd02f685',
  holoBillboard: '3666481c-12a6-4c6b-92d6-4ae20ca2f035',
  fountain: '8a1a7ccc-6d51-43e3-aefb-d719bf93b3be',
  highway: '0baf667d-c265-4d5a-8d63-781f9521cac9',
  highwayRail: 'a69c95e9-48d0-4b91-a9aa-046e2ad394fc',
  highwayLight: '697b32de-3b80-4d14-a14d-bc9be5575656',
  puShield: 'f62ff3db-7806-487e-8b49-e26e0dbe7ee1',
  puTriple: 'acaa2752-519c-47a7-ab7a-91c5fd26056b',
  puBomb: '355b2e24-4480-4afe-ab29-bd3e35bef828',
  puHeal: '6a6b2ed8-3806-4c85-8932-246cda9c0ff8',
  obstacle: '48515838-2991-4539-b6ee-dc4d4b1ec2af',
  obstacleGlow: '25e43232-2071-4076-92ff-a1439a9b2447',
  starW: 'e271995c-10c0-44ff-a35e-aa8b7950a180',
  starD: '80a179df-74dd-44e5-867b-cc431b0a5f30',
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
