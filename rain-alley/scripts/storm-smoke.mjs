import { Name, Transform } from '@forgeax/engine-scene';
import {
  MeshFilter,
  MeshRenderer,
  PointLight,
  Visibility,
  VisibilityStateValue,
} from '@forgeax/engine-render';
/** Observe actual shots and world-space cases through real input and ECS, then restore input. */
export async function runStormSmoke() {
  const { app, world } = window.__forgeax,
    api = window.__rainFps;
  const original = app.input.sample.bind(app.input);
  let keys = ['Digit1'],
    firing = false,
    edge = false;
  app.input.sample = () => {
    const s = original(),
      r = {
        ...s,
        pointerLocked: true,
        downCodes: new Set(),
        pressedCodes: new Set(keys),
        buttons: [firing, false, false],
        pressedButtons: [edge, false, false],
        movementX: 0,
        movementY: 0,
      };
    keys = [];
    edge = false;
    return r;
  };
  const cases = () => {
    const out = [];
    for (const row of world
      .query({ read: [Name, Transform, Visibility] })
      .unwrap()) {
      if (row.get(Name).value.startsWith('Weapon_Casing_'))
        out.push({
          entity: row.entity,
          pos: [...row.get(Transform).pos],
          visible: row.get(Visibility).state === VisibilityStateValue.visible,
        });
    }
    return out;
  };
  const checks = [],
    samples = [];
  let flashes = 0;
  try {
    await new Promise((r) => setTimeout(r, 500));
    const before = api.snapshot(),
      start = performance.now();
    firing = true;
    edge = true;
    while (
      api.snapshot().gameTime < before.gameTime + 0.8 &&
      performance.now() - start < 12000
    ) {
      await new Promise(requestAnimationFrame);
      for (const row of world.query({ read: [Name, PointLight] }).unwrap())
        if (
          row.get(Name).value === 'Weapon_MuzzleLight' &&
          row.get(PointLight).intensity > 0
        )
          flashes++;
      samples.push(cases().filter((c) => c.visible));
    }
    firing = false;
    const after = api.snapshot();
    checks.push({
      name: 'real firing',
      pass: after.shots > before.shots,
      shots: after.shots - before.shots,
    });
    checks.push({
      name: 'flash light follows shots',
      pass: flashes > 0,
      frames: flashes,
    });
    const positions = new Map();
    let moving = false;
    for (const frame of samples)
      for (const c of frame) {
        const old = positions.get(c.entity);
        if (old && Math.hypot(...c.pos.map((v, i) => v - old[i])) > 0.005)
          moving = true;
        positions.set(c.entity, c.pos);
      }
    checks.push({
      name: 'visible cases travel in world space',
      pass: moving,
      observed: positions.size,
    });
    checks.push({
      name: 'case pool is bounded',
      pass: cases().length === 24,
      count: cases().length,
    });
    let sky = false,
      rainDrops = 0;
    for (const row of world
      .query({ read: [Name, MeshFilter, MeshRenderer] })
      .unwrap()) {
      const name = row.get(Name).value;
      if (name === 'RainNight_CitySky')
        sky = row.get(MeshRenderer).materials.length === 1;
      if (name === 'RainNight_Rain_0') {
        const m = world.sharedRefs.resolve(row.get(MeshFilter).assetHandle);
        if (m.ok) rainDrops = m.value.indices.length / 12;
      }
    }
    checks.push({ name: 'city sky mesh is installed', pass: sky });
    checks.push({
      name: 'heavy rain shared mesh',
      pass: rainDrops === 160,
      dropsPerCell: rainDrops,
    });
    return {
      pass: checks.every((c) => c.pass),
      checks,
      frameMs: after.frameMs,
      limits:
        'Cosmetic ballistic cases bounce using Rapier rays; no case rigid bodies. Visual sky and material quality additionally require screenshots.',
    };
  } finally {
    app.input.sample = original;
  }
}
