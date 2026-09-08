import type { WeaponProfile } from './types.ts';

/** Compact hand-sized spear: the authored X/Z footprint stays within 0.5 x 0.5 grid. */
export const SPEAR_PROFILE: WeaponProfile = {
  id: 'spear',
  displayName: 'Spear',
  shape: 'thrust',
  damage: 10,
  cooldown: 2,
  range: 4.2,
  arcDegrees: 18,
  thrustWidth: 0.9,
  maxTargets: 3,
  windup: 0.1,
  strike: 0.08,
  recover: 0.14,
  model: {
    materialSlots: ['wood', 'steel'],
    restYaw: 0,
    parts: [
      {
        id: 'shaft',
        shape: { kind: 'cylinder', radiusTop: 0.018, radiusBottom: 0.018, height: 0.36, radialSegments: 10 },
        position: [0, 0, 0.01],
        rotation: [Math.PI / 2, 0, 0],
        materialSlot: 0,
      },
      {
        id: 'head',
        shape: { kind: 'cone', radius: 0.06, height: 0.14, radialSegments: 10 },
        position: [0, 0, 0.22],
        rotation: [-Math.PI / 2, 0, 0],
        materialSlot: 1,
      },
      {
        id: 'collar',
        shape: { kind: 'torus', radius: 0.045, tube: 0.012 },
        position: [0, 0, 0.14],
        rotation: [Math.PI / 2, 0, 0],
        materialSlot: 1,
      },
      {
        id: 'butt',
        shape: { kind: 'sphere', radius: 0.028, widthSegments: 10, heightSegments: 8 },
        position: [0, 0, -0.18],
        materialSlot: 0,
      },
    ],
  },
};
