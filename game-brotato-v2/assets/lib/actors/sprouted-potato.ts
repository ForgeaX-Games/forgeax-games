import type { ActorPart, ActorRecipe } from '../model-kit.ts';

const sproutAngles = [-0.62, 0.08, 0.72] as const;
const sprouts = sproutAngles.flatMap((angle, index) => {
  const x = Math.cos(angle) * 0.18;
  const z = Math.sin(angle) * 0.14;
  return [
    {
      id: `sprout-stalk-${index}`,
      shape: { kind: 'cylinder', radiusTop: 0.022, radiusBottom: 0.022, height: 0.2, radialSegments: 8 },
      position: [x, 0.98, z],
      rotation: [Math.sin(angle) * 0.42, 0, Math.cos(angle) * 0.42],
      materialSlot: 1,
    } satisfies ActorPart,
    {
      id: `sprout-bud-${index}`,
      shape: { kind: 'sphere', radius: 0.055, widthSegments: 10, heightSegments: 8 },
      position: [x + Math.sin(angle) * 0.055, 1.1, z + Math.cos(angle) * 0.055],
      scale: [1, 1.3, 1],
      materialSlot: 1,
    } satisfies ActorPart,
  ];
});

const body: readonly ActorPart[] = [
  {
    id: 'body',
    shape: { kind: 'sphere', radius: 0.46, widthSegments: 18, heightSegments: 12 },
    position: [0, 0.48, 0],
    scale: [1.25, 0.88, 0.95],
    materialSlot: 0,
  },
  {
    id: 'bump-0',
    shape: { kind: 'sphere', radius: 0.13, widthSegments: 10, heightSegments: 8 },
    position: [0.36, 0.55, 0.16],
    scale: [1, 0.8, 1],
    materialSlot: 0,
  },
  {
    id: 'bump-1',
    shape: { kind: 'sphere', radius: 0.13, widthSegments: 10, heightSegments: 8 },
    position: [-0.28, 0.42, 0.26],
    scale: [1, 0.8, 1],
    materialSlot: 0,
  },
  {
    id: 'bump-2',
    shape: { kind: 'sphere', radius: 0.13, widthSegments: 10, heightSegments: 8 },
    position: [0.1, 0.35, -0.3],
    scale: [1, 0.8, 1],
    materialSlot: 0,
  },
  ...sprouts,
  {
    id: 'pit-0',
    shape: { kind: 'sphere', radius: 0.05, widthSegments: 10, heightSegments: 8 },
    position: [-0.27, 0.64, 0.39],
    scale: [1, 1, 0.5],
    materialSlot: 2,
  },
  {
    id: 'pit-1',
    shape: { kind: 'sphere', radius: 0.05, widthSegments: 10, heightSegments: 8 },
    position: [0.27, 0.5, 0.4],
    scale: [1, 1, 0.5],
    materialSlot: 2,
  },
  {
    id: 'pit-2',
    shape: { kind: 'sphere', radius: 0.05, widthSegments: 10, heightSegments: 8 },
    position: [0.05, 0.76, 0.38],
    scale: [1, 1, 0.5],
    materialSlot: 2,
  },
  {
    id: 'eye-l',
    shape: { kind: 'sphere', radius: 0.075, widthSegments: 12, heightSegments: 8 },
    position: [-0.16, 0.58, 0.4],
    scale: [0.65, 1, 0.45],
    materialSlot: 2,
  },
  {
    id: 'eye-r',
    shape: { kind: 'sphere', radius: 0.075, widthSegments: 12, heightSegments: 8 },
    position: [0.16, 0.58, 0.4],
    scale: [0.65, 1, 0.45],
    materialSlot: 2,
  },
];

export const SPROUTED_POTATO_RECIPE: ActorRecipe = {
  id: 'sprouted-potato',
  displayName: 'Sprouted Potato',
  materialSlots: ['body', 'sprout', 'eye'],
  body,
  limbs: [
    {
      id: 'hand-l',
      parts: [{ id: 'hand-l', shape: { kind: 'sphere', radius: 0.12, widthSegments: 12, heightSegments: 8 }, position: [0, 0, 0], scale: [1, 0.92, 1], materialSlot: 0 }],
      anchor: [-0.56, 0.44, 0.02],
      motion: { kind: 'bob', axis: 'y', idleAmplitude: 0.025, idleFrequency: 1.2, moveAmplitude: 0.045, moveFrequency: 2.2, phase: 0 },
    },
    {
      id: 'hand-r',
      parts: [{ id: 'hand-r', shape: { kind: 'sphere', radius: 0.12, widthSegments: 12, heightSegments: 8 }, position: [0, 0, 0], scale: [1, 0.92, 1], materialSlot: 0 }],
      anchor: [0.56, 0.44, 0.02],
      motion: { kind: 'bob', axis: 'y', idleAmplitude: 0.025, idleFrequency: 1.2, moveAmplitude: 0.045, moveFrequency: 2.2, phase: Math.PI },
    },
    {
      id: 'foot-l',
      parts: [{ id: 'foot-l', shape: { kind: 'sphere', radius: 0.16, widthSegments: 12, heightSegments: 8 }, position: [0, 0, 0], scale: [1, 0.66, 1.3], materialSlot: 0 }],
      anchor: [-0.23, 0.14, 0.05],
      motion: { kind: 'swing', axis: 'z', idleAmplitude: 0.015, idleFrequency: 0.9, moveAmplitude: 0.1, moveFrequency: 2.8, phase: 0 },
    },
    {
      id: 'foot-r',
      parts: [{ id: 'foot-r', shape: { kind: 'sphere', radius: 0.16, widthSegments: 12, heightSegments: 8 }, position: [0, 0, 0], scale: [1, 0.66, 1.3], materialSlot: 0 }],
      anchor: [0.23, 0.14, 0.05],
      motion: { kind: 'swing', axis: 'z', idleAmplitude: 0.015, idleFrequency: 0.9, moveAmplitude: 0.1, moveFrequency: 2.8, phase: Math.PI },
    },
  ],
  // 0.92 keeps the root's collision footprint close to one 1 x 1 arena tile.
  rootScale: 0.92,
  groundOffset: 0.0344,
};
