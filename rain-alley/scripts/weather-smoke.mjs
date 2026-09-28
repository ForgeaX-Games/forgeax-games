import { Name, Transform } from '@forgeax/engine-scene';
import {
  MeshRenderer,
  SpotLight,
  PointLight,
  Fog,
} from '@forgeax/engine-render';
import { STREET_COLLISION_PROXIES } from '../src/street-layout';
import { rainFloorAt } from '../src/fps/weather';

/** Read real ECS and rendered-pass evidence, not configuration-only checks. */
export async function runWeatherSmoke() {
  const { world, renderer } = window.__forgeax;
  const collect = () => {
    const found = [];
    for (const row of world.query({ read: [Name, Transform] }).unwrap()) {
      const name = row.get(Name).value;
      if (name.startsWith('RainNight_Rain_'))
        found.push({ name, pos: [...row.get(Transform).pos] });
    }
    return found;
  };
  const before = collect();
  await new Promise((r) => setTimeout(r, 400));
  const after = collect(),
    ins = renderer.inspect();
  const checks = [
    {
      name: 'bounded rain cells',
      pass: after.length === 48,
      count: after.length,
    },
    {
      name: 'rain transforms move',
      pass: after.some((c, i) => c.pos[1] !== before[i]?.pos[1]),
    },
    {
      name: 'fog component',
      pass: [...world.query({ read: [Fog] }).unwrap()].length === 1,
    },
    {
      name: 'eight shop lights, muzzle flash and weapon fill',
      pass: [...world.query({ read: [PointLight] }).unwrap()].length === 10,
    },
    {
      name: 'three street spotlights',
      pass: [...world.query({ read: [SpotLight] }).unwrap()].length === 3,
    },
    {
      name: 'HDR bloom actually encoded',
      pass: ins.bloom.enabled && ins.bloom.encodeCount === 4,
    },
    {
      name: 'spot shadow pass actually scheduled',
      pass: ins.perFramePassNames.includes('spot-shadow-0'),
    },
    {
      name: 'reflection cube actually captured',
      pass:
        ins.reflectionProbes.rawFacesCaptured === 18 &&
        ins.reflectionProbes.activeCount === 3,
    },
  ];
  for (const p of STREET_COLLISION_PROXIES.filter(
    (p) => p.name.startsWith('COL_INT_') && p.name.endsWith('_Floor'),
  ))
    checks.push({
      name: `rain remains above ${p.name}`,
      pass: rainFloorAt(p.center[0], p.center[2]) > 3,
      height: rainFloorAt(p.center[0], p.center[2]),
    });
  let shadowMaterials = 0;
  for (const row of world.query({ read: [MeshRenderer] }).unwrap()) {
    for (const handle of row.get(MeshRenderer).materials) {
      const m = world.sharedRefs.resolve(handle);
      if (m.ok && m.value.passes?.some((p) => p.name === 'shadow-caster'))
        shadowMaterials++;
    }
  }
  checks.push({
    name: 'scene materials contain shadow casters',
    pass: shadowMaterials > 0,
    count: shadowMaterials,
  });
  return {
    kind: 'live-weather-render-contract',
    pass: checks.every((c) => c.pass),
    checks,
    frameMs: window.__rainFps.snapshot().frameMs,
    passes: ins.perFramePassNames,
    bloom: ins.bloom,
    reflection: ins.reflectionProbes,
    canvas: {
      width: document.querySelector('canvas')?.width,
      height: document.querySelector('canvas')?.height,
    },
    limits:
      'Input remains separate; cube capture is static, rain uses conservative proxy bounds, not droplet physics.',
  };
}
