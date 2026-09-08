import type { WeaponProfile } from './types.ts';

/** Compact axe: the authored X/Z footprint stays within 0.5 x 0.5 grid. */
export const AXE_PROFILE: WeaponProfile = {
  id: 'axe',
  displayName: 'Axe',
  shape: 'sweep',
  damage: 10,
  cooldown: 2,
  range: 2.3,
  arcDegrees: 140,
  maxTargets: 6,
  windup: 0.08,
  strike: 0.12,
  recover: 0.16,
  model: {
    materialSlots: ['wood', 'steel'],
    restYaw: 0,
    parts: [
      {
        id: 'handle',
        shape: { kind: 'cylinder', radiusTop: 0.03, radiusBottom: 0.03, height: 0.34, radialSegments: 10 },
        position: [0, 0, 0.02],
        rotation: [Math.PI / 2, 0, 0],
        materialSlot: 0,
      },
      {
        id: 'head-core',
        shape: { kind: 'box', width: 0.07, height: 0.12, depth: 0.16 },
        position: [0, 0, 0.11],
        materialSlot: 1,
      },
      {
        id: 'blade',
        shape: { kind: 'cone', radius: 0.13, height: 0.1, radialSegments: 10 },
        position: [0, 0, 0.16],
        rotation: [0, 0, Math.PI / 2],
        scale: [1, 0.55, 1],
        materialSlot: 1,
      },
      {
        id: 'pommel',
        shape: { kind: 'sphere', radius: 0.035, widthSegments: 10, heightSegments: 8 },
        position: [0, 0, -0.16],
        materialSlot: 0,
      },
    ],
  },
};
