const ARENA_WALL_OFFSET = 20.2;

/**
 * Arena and camera numeric SSOT.
 *
 * M0 deliberately fixes the arena to a 40 x 40 tile grid. Later gameplay
 * systems should consume these values instead of repeating world dimensions.
 */
export const ARENA = {
  /** Player-reachable half extent; M1 will use this for movement clamping. */
  limit: 18.8,
  /** Wall center distance, exposed separately for camera follow math. */
  wallOffset: ARENA_WALL_OFFSET,
  grid: { columns: 40, rows: 40 },
  floor: { width: 40, height: 0.4, depth: 40 },
  tile: { width: 0.94, height: 0.12, depth: 0.94, spacing: 1 },
  wall: { width: 40, height: 0.9, depth: 0.36, offset: ARENA_WALL_OFFSET, y: 0.34 },
} as const;

export const CAMERA = {
  /** Fixed top-down view. Follow behavior is intentionally an M1 concern. */
  position: [0, 34, 10] as const,
  target: [0, 0, 0] as const,
  up: [0, 1, 0] as const,
  fov: Math.PI / 3,
  near: 0.1,
  far: 150,
  exposure: 1.22,
  clearColor: [0.018, 0.035, 0.075, 1] as const,
} as const;

export const M0_BUILD_ID = 'M0 / 40x40 ARENA' as const;
export const M1_BUILD_ID = 'M1 / TOMATO + CAMERA RIG' as const;
export const M2_BUILD_ID = 'M2 / COMBAT LOOP + DUAL WEAPONS' as const;
