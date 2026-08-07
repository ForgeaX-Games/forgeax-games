export type LandmarkVfxState = {
  coreScale: number;
  haloScale: number;
  haloYaw: number;
  particleTimeScale: number;
  proximity: number;
};

/**
 * One proximity signal drives mesh breathing, halo motion, and the native
 * ParticleEffectPlayer clock so landmark feedback cannot drift across layers.
 */
export function landmarkVfxState(elapsed: number, distance: number, activated: boolean): LandmarkVfxState {
  const proximity = Math.max(0, Math.min(1, 1 - Math.max(0, distance) / 14));
  const energy = 0.72 + proximity * 0.28 + (activated ? 0.26 : 0);
  const breath = Math.sin(elapsed * (1.8 + proximity * 1.1)) * 0.055;
  return {
    coreScale: energy + breath,
    haloScale: 0.92 + proximity * 0.15 + (activated ? 0.17 : 0) - breath * 0.45,
    haloYaw: elapsed * (0.22 + proximity * 0.38 + (activated ? 0.28 : 0)),
    particleTimeScale: 0.78 + proximity * 0.62 + (activated ? 0.45 : 0),
    proximity,
  };
}
