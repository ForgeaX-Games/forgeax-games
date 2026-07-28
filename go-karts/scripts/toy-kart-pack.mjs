/**
 * Place a distilled ToyKart (+Z nose) as ChildOf hierarchy under a drive root.
 * Uses built-in sphere/cube/cylinder — ForgeaX scene.pack native, Edit/Play shared.
 *
 * Mesh local: +Z = nose (DISTILLATION). Parent visual gets MESH_PLUS_Z_TO_FORGEAX_YAW.
 * Pet sits on visual at TOYKART_SEAT.
 */
export const CUBE = 'cbe42beb-8975-5096-b3a1-3dda4cb4c077';
export const SPHERE = '95730fd2-9846-5f84-8658-0b3c971eb263';
export const CYLINDER = 'ab20af21-0764-55be-a7f2-b80ab3d46a0a';

export const TOYKART_SEAT = [0, 0.55, -0.25];
export const MESH_PLUS_Z_TO_FORGEAX_YAW = Math.PI;

/** Theme material GUID triples: body / accent / rim (+ shared tire). */
export const THEMES = {
  dog: {
    body: 'b1a11e00-0002-4000-8000-000000000010',
    accent: 'b1a11e00-0002-4000-8000-000000000011',
    rim: 'b1a11e00-0002-4000-8000-000000000012',
  },
  duck: {
    body: 'b1a11e00-0002-4000-8000-000000000020',
    accent: 'b1a11e00-0002-4000-8000-000000000021',
    rim: 'b1a11e00-0002-4000-8000-000000000022',
  },
  panda: {
    body: 'b1a11e00-0002-4000-8000-000000000030',
    accent: 'b1a11e00-0002-4000-8000-000000000031',
    rim: 'b1a11e00-0002-4000-8000-000000000032',
  },
};

export const TIRE_MAT = 'b1a11e00-0002-4000-8000-000000000013';

/**
 * @param {{
 *   entities: any[],
 *   nextLocalId: () => number,
 *   refIndex: (guid: string) => number,
 *   yawQuat: (yaw: number) => number[],
 *   rootId: number,
 *   namePrefix: string,
 *   theme: keyof typeof THEMES,
 * }} opts
 * @returns {number} visual localId
 */
export function pushToyKartVisual(opts) {
  const { entities, nextLocalId, refIndex, yawQuat, rootId, namePrefix, theme } = opts;
  const mats = THEMES[theme];
  const visualId = nextLocalId();

  entities.push({
    localId: visualId,
    components: {
      Name: { value: `${namePrefix}Visual` },
      Transform: {
        pos: [0, 0, 0],
        quat: yawQuat(MESH_PLUS_Z_TO_FORGEAX_YAW),
        scale: [1, 1, 1],
      },
      ChildOf: { parent: rootId },
    },
  });

  const part = (name, meshGuid, matGuid, pos, scale, quat = [0, 0, 0, 1]) => {
    entities.push({
      localId: nextLocalId(),
      components: {
        Name: { value: name },
        Transform: { pos, quat, scale },
        MeshFilter: { assetHandle: refIndex(meshGuid) },
        MeshRenderer: { materials: [refIndex(matGuid)] },
        ChildOf: { parent: visualId },
      },
    });
  };

  // Distilled from ToyKart.ts createToyKart (proportions preserved).
  part(`${namePrefix}Body`, SPHERE, mats.body, [0, 0.52, 0], [1.0, 0.62, 1.5]);
  part(`${namePrefix}Nose`, SPHERE, mats.accent, [0, 0.42, 1.12], [1.5, 0.7, 0.8]);
  part(`${namePrefix}Ring`, CYLINDER, mats.accent, [0, 0.82, -0.18], [0.92, 0.08, 0.92]);
  part(`${namePrefix}Backrest`, SPHERE, mats.accent, [0, 0.9, -0.78], [0.34, 0.34, 0.15]);
  part(`${namePrefix}Spoiler`, CUBE, mats.rim, [0, 0.72, -1.28], [0.9, 0.09, 0.28]);
  part(`${namePrefix}StrutL`, CYLINDER, mats.accent, [-0.3, 0.58, -1.28], [0.07, 0.26, 0.07]);
  part(`${namePrefix}StrutR`, CYLINDER, mats.accent, [0.3, 0.58, -1.28], [0.07, 0.26, 0.07]);
  part(`${namePrefix}Pipe`, CYLINDER, mats.rim, [0.34, 0.5, -1.18], [0.18, 0.34, 0.18]);

  for (const [sx, sz, label] of [
    [-0.72, 0.78, 'FL'],
    [0.72, 0.78, 'FR'],
    [-0.72, -0.78, 'RL'],
    [0.72, -0.78, 'RR'],
  ]) {
    part(`${namePrefix}Tire${label}`, SPHERE, TIRE_MAT, [sx, 0.36, sz], [0.26, 0.36, 0.36]);
    part(`${namePrefix}Hub${label}`, CYLINDER, mats.rim, [sx, 0.36, sz], [0.19, 0.3, 0.19]);
  }

  return visualId;
}
