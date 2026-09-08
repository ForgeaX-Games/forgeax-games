import type { ActorPart, ActorRecipe } from '../model-kit.ts';

const calyx = Array.from({ length: 5 }, (_, index) => {
  const angle = (index / 5) * Math.PI * 2;
  return {
    id: `calyx-${index}`,
    shape: { kind: 'cone', radius: 0.1, height: 0.26, radialSegments: 6 },
    position: [Math.cos(angle) * 0.22, 0.93, Math.sin(angle) * 0.22],
    // The cone's point leans outward and down so the calyx wraps the crown.
    rotation: [
      Math.PI * 0.55 * Math.cos(angle + Math.PI / 2),
      -angle,
      Math.PI * 0.55 * Math.sin(angle),
    ],
    materialSlot: 1,
  } satisfies ActorPart;
});

const body: readonly ActorPart[] = [
  {
    id: 'body',
    shape: { kind: 'sphere', radius: 0.5, widthSegments: 20, heightSegments: 14 },
    position: [0, 0.52, 0],
    scale: [1.15, 0.92, 1.15],
    materialSlot: 0,
  },
  ...calyx,
  {
    id: 'stem',
    shape: { kind: 'cylinder', radiusTop: 0.05, radiusBottom: 0.05, height: 0.34, radialSegments: 8 },
    position: [0, 1.12, 0],
    materialSlot: 1,
  },
  {
    id: 'eye-l',
    shape: { kind: 'sphere', radius: 0.08, widthSegments: 12, heightSegments: 8 },
    position: [-0.17, 0.62, 0.44],
    scale: [0.7, 1.15, 0.5],
    materialSlot: 2,
  },
  {
    id: 'eye-r',
    shape: { kind: 'sphere', radius: 0.08, widthSegments: 12, heightSegments: 8 },
    position: [0.17, 0.62, 0.44],
    scale: [0.7, 1.15, 0.5],
    materialSlot: 2,
  },
];

export const TOMATO_RECIPE: ActorRecipe = {
  id: 'tomato',
  displayName: 'Tomato',
  materialSlots: ['body', 'stem', 'eye', 'sole'],
  body,
  limbs: [
    {
      id: 'hand-l',
      parts: [
        {
          id: 'hand-l',
          shape: { kind: 'sphere', radius: 0.15, widthSegments: 14, heightSegments: 10 },
          position: [0, 0, 0],
          scale: [1, 0.92, 1],
          materialSlot: 0,
        },
      ],
      anchor: [-0.62, 0.5, 0.02],
      motion: {
        kind: 'bob',
        axis: 'y',
        idleAmplitude: 0.035,
        idleFrequency: 1.1,
        moveAmplitude: 0.07,
        moveFrequency: 2.4,
        phase: 0,
      },
    },
    {
      id: 'hand-r',
      parts: [
        {
          id: 'hand-r',
          shape: { kind: 'sphere', radius: 0.15, widthSegments: 14, heightSegments: 10 },
          position: [0, 0, 0],
          scale: [1, 0.92, 1],
          materialSlot: 0,
        },
      ],
      anchor: [0.62, 0.5, 0.02],
      motion: {
        kind: 'bob',
        axis: 'y',
        idleAmplitude: 0.035,
        idleFrequency: 1.1,
        moveAmplitude: 0.07,
        moveFrequency: 2.4,
        phase: Math.PI,
      },
    },
    {
      id: 'foot-l',
      parts: [
        {
          id: 'foot-l',
          shape: { kind: 'sphere', radius: 0.19, widthSegments: 14, heightSegments: 10 },
          position: [0, 0, 0],
          scale: [1, 0.68, 1.35],
          materialSlot: 3,
        },
      ],
      anchor: [-0.26, 0.16, 0.06],
      motion: {
        kind: 'swing',
        axis: 'z',
        idleAmplitude: 0.02,
        idleFrequency: 0.9,
        moveAmplitude: 0.16,
        moveFrequency: 3.2,
        phase: 0,
      },
    },
    {
      id: 'foot-r',
      parts: [
        {
          id: 'foot-r',
          shape: { kind: 'sphere', radius: 0.19, widthSegments: 14, heightSegments: 10 },
          position: [0, 0, 0],
          scale: [1, 0.68, 1.35],
          materialSlot: 3,
        },
      ],
      anchor: [0.26, 0.16, 0.06],
      motion: {
        kind: 'swing',
        axis: 'z',
        idleAmplitude: 0.02,
        idleFrequency: 0.9,
        moveAmplitude: 0.16,
        moveFrequency: 3.2,
        phase: Math.PI,
      },
    },
  ],
  rootScale: 1,
  // The scaled foot sphere bottoms at 0.16 - 0.19 * 0.68 = 0.0308.
  groundOffset: 0.0308,
};
