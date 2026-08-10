export type EnvironmentVec2 = readonly [number, number];
export type EnvironmentVec3 = readonly [number, number, number];

export type RouteFootprint = {
  readonly start: EnvironmentVec2;
  readonly end: EnvironmentVec2;
  readonly halfWidth: number;
};

export type InteractionApron = {
  readonly position: EnvironmentVec2;
  readonly radius: number;
};

/** Stable authored route clearances shared by current and replacement environment renderers. */
export const EXPLORATION_ROUTE_FOOTPRINTS: readonly RouteFootprint[] = [
  { start: [0, 2.35], end: [0, -3.1], halfWidth: 1.72 },
  { start: [0, -2.2], end: [-6.2, -4.9], halfWidth: 1.18 },
  { start: [0, -2.55], end: [6.05, -6.3], halfWidth: 1.18 },
  { start: [0, -5.2], end: [-2.65, -11.2], halfWidth: 1.12 },
  { start: [-0.2, -8.15], end: [1.8, -15.15], halfWidth: 1.28 },
] as const;

/** Stable interaction clearances; visual dressing must stay outside these objective aprons. */
export const EXPLORATION_INTERACTION_APRONS: readonly InteractionApron[] = [
  { position: [0, 3.1], radius: 2.15 },
  { position: [-6.2, -4.9], radius: 1.8 },
  { position: [6.05, -6.3], radius: 1.8 },
  { position: [-2.65, -11.2], radius: 1.72 },
  { position: [1.8, -16.4], radius: 4.95 },
] as const;

export const GROUND_DRESSING_ROUTE_MARGIN = 0.24;

export const LAST_LIGHT_TERRACE = {
  position: [1.8, 0, -16.8] as EnvironmentVec3,
  radiusX: 5.2,
  radiusZ: 3.25,
  superellipsePower: 6,
  colliderHalfExtents: [4.75, 0.65, 2.7] as EnvironmentVec3,
} as const;

export const LAST_LIGHT_TERRACE_COLLIDER = {
  position: [
    LAST_LIGHT_TERRACE.position[0],
    LAST_LIGHT_TERRACE.position[1] - LAST_LIGHT_TERRACE.colliderHalfExtents[1],
    LAST_LIGHT_TERRACE.position[2],
  ] as EnvironmentVec3,
  halfExtents: LAST_LIGHT_TERRACE.colliderHalfExtents,
  yaw: 0,
} as const;

export const LAST_LIGHT_CAUSEWAY = {
  position: [0, -0.3, -12.8] as EnvironmentVec3,
  halfExtents: [0.9, 0.3, 1.6] as EnvironmentVec3,
  yaw: 0,
} as const;
