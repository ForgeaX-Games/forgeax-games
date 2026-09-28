/** Input-driven living city acceptance. Does not change health or AI rules. */
export async function runLivingCitySmoke() {
  const { world, app } = window.__forgeax,
    api = window.__rainFps,
    physics = world.getResource('PhysicsWorld');
  const original = app.input.sample.bind(app.input);
  let keys = [],
    edges = [],
    mx = 0,
    my = 0;
  app.input.sample = () => {
    const r = {
      ...original(),
      pointerLocked: true,
      downCodes: new Set(keys),
      pressedCodes: new Set(edges),
      buttons: [false, false, false],
      pressedButtons: [false, false, false],
      movementX: mx,
      movementY: my,
    };
    edges = [];
    mx = my = 0;
    return r;
  };
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (fn, ms = 12000) => {
    const end = performance.now() + ms;
    while (!fn()) {
      if (performance.now() > end) throw Error('Living-city deadline');
      await delay(30);
    }
  };
  const face = (yaw, pitch = 0) => {
    const s = api.snapshot();
    mx = -(yaw - s.yaw) / 0.0021;
    my = -(pitch - s.pitch) / 0.0021;
  };
  const tp = (x, y, z) => api.relocate([x, y, z]);
  const initialTargets = api.snapshot().targets;
  const checks = [];
  window.__livingProgress = checks;
  try {
    if (api.snapshot().health <= 0) {
      edges = ['Enter'];
      await delay(200);
    }
    face(0);
    tp(2.25, 0.9, -1.3);
    await delay(180);
    keys = ['KeyW'];
    let maxY = 0;
    const samples = [];
    const start = performance.now();
    while (
      api.snapshot().player[2] > -18.4 &&
      performance.now() - start < 12000
    ) {
      const s = api.snapshot();
      maxY = Math.max(maxY, s.player[1]);
      samples.push(s.player);
      await delay(45);
    }
    keys = [];
    await delay(180);
    checks.push({
      name: 'walk up and down both gallery stairs',
      pass:
        maxY > 4 &&
        api.snapshot().player[2] < -18 &&
        api.snapshot().player[1] < 1.6,
      maxY,
      end: api.snapshot().player,
    });
    tp(1, 0.9, -10);
    await delay(200);
    edges = ['KeyF'];
    await until(() => api.snapshot().climbing > 0, 2500);
    await until(() => api.snapshot().climbing === 0, 8000);
    checks.push({
      name: 'F ladder reaches gallery',
      pass: api.snapshot().player[1] > 4 && api.snapshot().player[0] > 2,
      end: api.snapshot().player,
    });
    // Open street: actual enemy attacks reduce health and melee units approach.
    tp(0, 0.9, -3);
    await delay(200);
    const before = api.snapshot();
    await until(() => api.snapshot().health < before.health, 10000);
    const after = api.snapshot();
    checks.push({
      name: 'enemy attack causes player damage',
      pass: after.health < before.health,
      before: before.health,
      after: after.health,
      attacks: after.targets.reduce((s, t) => s + t.attacks, 0),
    });
    checks.push({
      name: 'enemies move from patrol bases',
      pass: after.targets.some(
        (t, i) =>
          Math.hypot(
            t.position[0] - initialTargets[i].position[0],
            t.position[2] - initialTargets[i].position[2],
          ) > 0.2,
      ),
    });
    checks.push({
      name: 'injury overlay visible',
      pass: Number(document.querySelector('.ra-wound').style.opacity) > 0,
    });
    // A windup can finish after taking cover: the shot may sound, but must cause no damage.
    // Other enemies around the dogleg may still see the player.
    tp(8, 0.9, -29);
    await delay(200);
    const covered = api.snapshot();
    await delay(2200);
    const coveredAfter = api.snapshot();
    checks.push({
      name: 'dogleg wall blocks first shooter damage',
      pass:
        !coveredAfter.targets[0].visible &&
        coveredAfter.targets[0].resolvedDamage ===
          covered.targets[0].resolvedDamage,
      shooterBefore: covered.targets[0],
      shooterAfter: coveredAfter.targets[0],
    });
    const ambient = api.snapshot().ambient;
    checks.push({
      name: 'ambient species installed',
      pass: ambient.crows === 6 && ambient.rats === 6 && ambient.roaches === 12,
      ...ambient,
    });
    return {
      checks,
      pass: checks.every((c) => c.pass),
      stairsSamples: samples,
      frameMs: api.snapshot().frameMs,
      limits:
        'InputBackend driven. Wall test uses controlled pose; not a full playthrough. No health/AI bypass.',
    };
  } finally {
    app.input.sample = original;
  }
}
