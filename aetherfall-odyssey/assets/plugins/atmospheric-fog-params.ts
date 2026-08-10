export const ATMOSPHERIC_FOG_PARAM_BYTES = 32;

export type AtmosphericFogConfig = {
  readonly nearClip: number;
  readonly farClip: number;
  readonly density: number;
  readonly startDistance: number;
  readonly color: readonly [number, number, number];
  readonly maxOpacity: number;
};

export const AETHERFALL_FOG_CONFIG: AtmosphericFogConfig = {
  nearClip: 0.1,
  farClip: 200,
  density: 0.032,
  startDistance: 5.5,
  color: [0.19, 0.25, 0.32],
  maxOpacity: 0.72,
};

export function packAtmosphericFogParams(config: AtmosphericFogConfig): Uint8Array {
  const bytes = new ArrayBuffer(ATMOSPHERIC_FOG_PARAM_BYTES);
  const values = new Float32Array(bytes);
  const nearClip = Math.max(0.001, config.nearClip);
  values[0] = nearClip;
  values[1] = Math.max(nearClip + 0.001, config.farClip);
  values[2] = Math.max(0, config.density);
  values[3] = Math.max(0, config.startDistance);
  values[4] = Math.max(0, config.color[0]);
  values[5] = Math.max(0, config.color[1]);
  values[6] = Math.max(0, config.color[2]);
  values[7] = Math.max(0, Math.min(1, config.maxOpacity));
  return new Uint8Array(bytes);
}
