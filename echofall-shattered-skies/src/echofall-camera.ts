export type CameraTuning = {
  distance: number;
  height: number;
  shoulder: number;
  followRate: number;
  fov: number;
};

/** A restrained speed response that preserves the over-shoulder composition. */
export function cinematicCameraTarget(moving: boolean, sprinting: boolean, grounded: boolean): CameraTuning {
  const base = sprinting
    ? { distance: 5.35, height: 2.26, shoulder: 0.78, followRate: 9.2, fov: Math.PI / 2.95 }
    : moving
      ? { distance: 4.78, height: 2.12, shoulder: 0.7, followRate: 10.6, fov: Math.PI / 3.15 }
      : { distance: 4.58, height: 2.05, shoulder: 0.66, followRate: 11.5, fov: Math.PI / 3.3 };
  return grounded ? base : { ...base, distance: base.distance + 0.18, height: base.height + 0.08 };
}
