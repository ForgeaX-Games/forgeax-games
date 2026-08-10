import { World } from '@forgeax/engine-ecs';
import { Camera, DirectionalLight, PostProcessParams, Skylight, SkyboxBackground, SpotLight, perspective } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import { describe, expect, it, vi } from 'vitest';
import { packAtmosphericFogParams } from '../assets/plugins/atmospheric-fog-params';
import {
  AETHERFALL_FOG_SHADER_ID,
  AETHERFALL_LIGHTING_RIG,
  createAetherfallLightingRig,
} from '../assets/plugins/lighting-rig';

function fixture() {
  const world = new World();
  const key = world.spawn({
    component: DirectionalLight,
    data: { direction: [-0.42, -1, 0.26], color: [1, 0.88, 0.74], intensity: 1.25, shadowDistance: 70 },
  }).unwrap();
  const fill = world.spawn({
    component: Skylight,
    data: { color: [0.72, 0.78, 0.84], intensity: 0.4, rotation: [0, 0.173648, 0, 0.984808] },
  }).unwrap();
  const skybox = world.spawn({
    component: SkyboxBackground,
    data: { mode: 0, rotation: [0, 0, 0, 1] },
  }).unwrap();
  const camera = world.spawn({
    component: Camera,
    data: { ...perspective({ fov: Math.PI / 3, aspect: 16 / 9, near: 0.1, far: 200 }), exposure: 0.8 },
  }).unwrap();
  const originalFog = packAtmosphericFogParams({
    nearClip: 0.1,
    farClip: 200,
    density: 0.032,
    startDistance: 5.5,
    color: [0.19, 0.25, 0.32],
    maxOpacity: 0.72,
  });
  const fogParams = world.spawn({
    component: PostProcessParams,
    data: { shader: AETHERFALL_FOG_SHADER_ID, data: originalFog },
  }).unwrap();
  const loaded = {
    mapping: new Map([[1, key], [21, fill], [22, skybox]]),
    nodes: [
      { localId: 1, components: { Name: { value: 'Sun' } } },
      { localId: 21, components: { Name: { value: 'Skylight' } } },
      { localId: 22, components: { Name: { value: 'Skybox' } } },
    ],
  };
  return { world, key, fill, skybox, camera, fogParams, originalFog, loaded };
}

describe('Aetherfall lighting rig', () => {
  it('delivers renderer-visible key, shadow-fill, and crystal spill energy after inverse-square falloff', () => {
    const { key, fill, cameraExposure, rims } = AETHERFALL_LIGHTING_RIG;
    const sceneResponse = cameraExposure * (key.intensity + fill.intensity);
    expect(sceneResponse).toBeGreaterThanOrEqual(3);
    expect(sceneResponse).toBeLessThanOrEqual(3.6);

    const punctualResponse = (name: string, target: readonly [number, number, number]) => {
      const light = rims.find((candidate) => candidate.name === name);
      expect(light).toBeDefined();
      const offset = target.map((value, index) => value - light!.position[index]!) as [number, number, number];
      const distanceSquared = offset.reduce((sum, value) => sum + value * value, 0);
      const distance = Math.sqrt(distanceSquared);
      const invRangeSquared = 1 / (light!.range * light!.range);
      const rangeFactor = 1 - (distanceSquared * invRangeSquared) ** 2;
      const attenuation = Math.max(Math.min(rangeFactor, 1), 0) / distanceSquared;
      const alignment = offset.reduce(
        (sum, value, index) => sum + value / distance * light!.direction[index]!,
        0,
      );
      return { light: light!, response: light!.intensity * attenuation, alignment };
    };

    const openingCrystal = punctualResponse('Aetherfall_OpeningCrystalSpill', [6.1, 2.9, -6.3]);
    expect(openingCrystal.alignment).toBeGreaterThan(0.995);
    expect(openingCrystal.response).toBeGreaterThanOrEqual(7);
    expect(openingCrystal.response).toBeLessThanOrEqual(13);
    expect(Math.max(...openingCrystal.light.color) - Math.min(...openingCrystal.light.color)).toBeLessThanOrEqual(0.44);

    const lastLight = punctualResponse('Aetherfall_LastLightCrystalSpill', [1.8, 1.55, -16.4]);
    expect(lastLight.alignment).toBeGreaterThan(0.995);
    expect(lastLight.response).toBeGreaterThanOrEqual(4);
    expect(lastLight.response).toBeLessThanOrEqual(7);
  });

  it('encodes readable midtones with deliberate warm-key and cool-sky separation', () => {
    const { key, fill, cameraExposure, fog, rims } = AETHERFALL_LIGHTING_RIG;
    expect(Math.hypot(...key.direction)).toBeCloseTo(1, 6);
    expect(key.color[0] - key.color[2]).toBeGreaterThanOrEqual(0.35);
    expect(key.intensity).toBeGreaterThanOrEqual(2.4);
    expect(key.intensity).toBeLessThanOrEqual(2.9);
    expect(Math.abs(key.direction[1])).toBeGreaterThanOrEqual(0.45);
    expect(Math.abs(key.direction[1])).toBeLessThanOrEqual(0.7);
    expect(key.shadowDistance).toBeGreaterThanOrEqual(45);
    expect(key.shadowDistance).toBeLessThanOrEqual(60);
    expect(fill.color[2] - fill.color[0]).toBeGreaterThanOrEqual(0.25);
    expect(fill.color[2] - fill.color[0]).toBeLessThanOrEqual(0.38);
    expect(fill.intensity).toBeGreaterThanOrEqual(0.35);
    expect(fill.intensity).toBeLessThanOrEqual(0.55);
    expect(cameraExposure).toBeGreaterThanOrEqual(0.95);
    expect(cameraExposure).toBeLessThanOrEqual(1.1);
    expect(rims).toHaveLength(2);
    expect(rims.every((rim) => Math.abs(Math.hypot(...rim.direction) - 1) < 1e-6)).toBe(true);
    expect(rims.every((rim) => rim.outerConeDeg > rim.innerConeDeg && rim.outerConeDeg <= 50)).toBe(true);

    // Directional + skylight + two spots is the entire authored rig budget.
    expect(2 + rims.length).toBeLessThanOrEqual(4);
    expect(rims.every((rim) => rim.intensity <= 340 && rim.range <= 22)).toBe(true);
    expect(rims.reduce((sum, rim) => sum + rim.intensity, 0)).toBeLessThanOrEqual(600);
    expect(Math.hypot(...AETHERFALL_LIGHTING_RIG.environmentRotation)).toBeCloseTo(1, 6);

    const crystal = rims.find((rim) => rim.name === 'Aetherfall_LastLightCrystalSpill');
    expect(crystal).toBeDefined();
    const toBeacon = [
      1.8 - crystal!.position[0],
      1.55 - crystal!.position[1],
      -16.4 - crystal!.position[2],
    ] as const;
    const toBeaconLength = Math.hypot(...toBeacon);
    const alignment = toBeacon.reduce(
      (sum, value, index) => sum + value / toBeaconLength * crystal!.direction[index]!,
      0,
    );
    expect(alignment).toBeGreaterThan(0.99);
    expect(crystal!.color[2]).toBeGreaterThan(crystal!.color[1]);
    expect(crystal!.color[1]).toBeGreaterThan(crystal!.color[0]);
  });

  it('keeps the foreground clear while separating midground and far silhouettes with bright fog', () => {
    const { fog } = AETHERFALL_LIGHTING_RIG;
    const fogAmount = (distance: number) => Math.min(
      1 - Math.exp(-Math.max(distance - fog.startDistance, 0) * fog.density),
      fog.maxOpacity,
    );

    expect(fog.color[2]).toBeGreaterThan(fog.color[1]);
    expect(fog.color[1]).toBeGreaterThan(fog.color[0]);
    expect(fog.color.every((channel) => channel >= 0.24)).toBe(true);
    expect(fog.density).toBeGreaterThanOrEqual(0.01);
    expect(fog.density).toBeLessThanOrEqual(0.014);
    expect(fog.startDistance).toBeGreaterThanOrEqual(22);
    expect(fog.startDistance).toBeLessThanOrEqual(28);
    expect(fog.maxOpacity).toBeGreaterThanOrEqual(0.32);
    expect(fog.maxOpacity).toBeLessThanOrEqual(0.42);
    expect(fogAmount(20)).toBe(0);
    expect(fogAmount(35)).toBeGreaterThan(0.1);
    expect(fogAmount(35)).toBeLessThan(0.13);
    expect(fogAmount(55)).toBeGreaterThan(0.29);
    expect(fogAmount(55)).toBeLessThan(0.32);
    expect(fogAmount(80)).toBeCloseTo(fog.maxOpacity, 6);
  });

  it('grades borrowed owners, spawns two inspectable kickers, and restores all state once', () => {
    const { world, key, fill, skybox, camera, fogParams, originalFog, loaded } = fixture();
    const handle = createAetherfallLightingRig({ world, loaded, camera });
    expect(handle).toBeDefined();
    Array.from(world.get(key, DirectionalLight).unwrap().color).forEach((value, index) => {
      expect(value).toBeCloseTo(AETHERFALL_LIGHTING_RIG.key.color[index]!, 6);
    });
    expect(world.get(key, DirectionalLight).unwrap().intensity).toBeCloseTo(AETHERFALL_LIGHTING_RIG.key.intensity, 6);
    Array.from(world.get(fill, Skylight).unwrap().color).forEach((value, index) => {
      expect(value).toBeCloseTo(AETHERFALL_LIGHTING_RIG.fill.color[index]!, 6);
    });
    expect(world.get(fill, Skylight).unwrap().intensity).toBeCloseTo(AETHERFALL_LIGHTING_RIG.fill.intensity, 6);
    Array.from(world.get(fill, Skylight).unwrap().rotation).forEach((value, index) => {
      expect(value).toBeCloseTo(AETHERFALL_LIGHTING_RIG.environmentRotation[index]!, 6);
    });
    Array.from(world.get(skybox, SkyboxBackground).unwrap().rotation).forEach((value, index) => {
      expect(value).toBeCloseTo(AETHERFALL_LIGHTING_RIG.environmentRotation[index]!, 6);
    });
    expect(world.get(camera, Camera).unwrap().exposure).toBeCloseTo(AETHERFALL_LIGHTING_RIG.cameraExposure, 6);
    expect(Array.from(world.get(fogParams, PostProcessParams).unwrap().data)).toEqual(
      Array.from(packAtmosphericFogParams(AETHERFALL_LIGHTING_RIG.fog)),
    );
    expect(handle!.rimLights).toHaveLength(2);
    for (const entity of handle!.rimLights) {
      expect(world.get(entity, Transform).ok).toBe(true);
      const spot = world.get(entity, SpotLight).unwrap();
      expect(spot.castShadow).toBe(false);
      expect(spot.outerConeDeg).toBeGreaterThan(spot.innerConeDeg);
    }

    handle!.dispose();
    handle!.dispose();
    expect(handle!.rimLights.every((entity) => !world.get(entity, SpotLight).ok)).toBe(true);
    expect(world.get(key, DirectionalLight).unwrap().intensity).toBeCloseTo(1.25, 6);
    expect(world.get(fill, Skylight).unwrap().intensity).toBeCloseTo(0.4, 6);
    expect(Array.from(world.get(fill, Skylight).unwrap().rotation)[1]).toBeCloseTo(0.173648, 6);
    expect(Array.from(world.get(skybox, SkyboxBackground).unwrap().rotation)).toEqual([0, 0, 0, 1]);
    expect(world.get(camera, Camera).unwrap().exposure).toBeCloseTo(0.8, 6);
    expect(Array.from(world.get(fogParams, PostProcessParams).unwrap().data)).toEqual(Array.from(originalFog));
  });

  it('fails before mutation when any existing grade owner is missing', () => {
    const { world, key, fill, camera, loaded } = fixture();
    const fogOnlyWorld = new World();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const noFog = createAetherfallLightingRig({
      world: fogOnlyWorld,
      loaded: { mapping: new Map([[1, key], [21, fill]]), nodes: loaded.nodes },
      camera,
    });
    expect(noFog).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      '[aetherfall] lighting rig unavailable: Sun, Skylight, Skybox, and atmospheric fog are required',
    );
    errorSpy.mockRestore();
  });
});
