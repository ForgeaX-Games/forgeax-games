/** Run in the local ForgeaX Play realm. Injects InputBackend samples, never changes weapon rules.
 * Real browser pointer-lock permission and human feel remain separate manual checks.
 * Reload Play after running to reset the training session. */
export async function runFpsSmoke() {
  const { app, world } = window.__forgeax;
  const api = window.__rainFps;
  if (!api) throw new Error('FPS entry is not loaded');
  const original = app.input.sample.bind(app.input);
  let keys = [],
    edges = [],
    buttons = [false, false, false],
    mouseEdge = false,
    mx = 0,
    my = 0;
  app.input.sample = () => {
    const s = original();
    const result = {
      ...s,
      pointerLocked: true,
      downCodes: new Set(keys),
      pressedCodes: new Set(edges),
      buttons: [...buttons],
      pressedButtons: [mouseEdge, false, false],
      movementX: mx,
      movementY: my,
    };
    edges = [];
    mouseEdge = false;
    mx = my = 0;
    return result;
  };
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const until = async (predicate, timeout = 6000) => {
    const end = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() > end) throw new Error('runtime state deadline');
      await delay(25);
    }
  };
  const ready = () =>
    until(() => api.snapshot().gameTime >= api.snapshot().readyAt + 0.02);
  const result = {
    kind: 'input-backend-injection',
    guns: [],
    doors: [],
    checks: [],
  };
  const physics = world.getResource('PhysicsWorld');
  const aimAt = (point, ads = false) => {
    const s = api.snapshot(),
      p = s.player;
    const dx = point[0] - p[0],
      dy = point[1] - p[1] - 0.74,
      dz = point[2] - p[2];
    const yaw = Math.atan2(-dx, -dz),
      pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const sensitivity = 0.0021 * (ads ? 62 / 80 : 1);
    mx = -(yaw - s.yaw) / sensitivity;
    my = -(pitch - s.pitch) / sensitivity;
  };
  try {
    // Shoot the visible first target using actual physical raycasts.
    buttons = [false, false, false];
    aimAt([-1.35, 1.1, -13]);
    await delay(250);
    buttons = [false, false, true];
    await delay(250);
    const initial = api.snapshot();
    buttons = [true, false, true];
    mouseEdge = true;
    await until(() => api.snapshot().gameTime >= initial.gameTime + 0.65);
    buttons = [false, false, false];
    await delay(300);
    const combat = api.snapshot();
    result.checks.push({
      name: 'CAR-15 physical hits and kill',
      pass: combat.hits > initial.hits && combat.kills > initial.kills,
      shots: combat.shots - initial.shots,
      hits: combat.hits - initial.hits,
    });
    // Living-city combat stays active. Use the sheltered low roof for catalog firing.
    if (api.relocate) {
      api.relocate([-8, 8, -3]);
      await delay(250);
    }
    // Look skyward so the catalog test does not depend on target respawn timing.
    const view = api.snapshot();
    my = -(0.8 - view.pitch) / 0.0021;
    await delay(60);
    for (let i = 0; i < 12; i++) {
      edges = [i < 10 ? `Digit${(i + 1) % 10}` : 'KeyE'];
      await delay(100);
      await ready();
      const before = api.snapshot();
      buttons = [true, false, false];
      mouseEdge = true;
      await delay(400);
      buttons = [false, false, false];
      const after = api.snapshot();
      result.guns.push({
        index: i,
        weapon: after.weapon,
        shots: after.shots - before.shots,
        ammoUsed: before.ammo[i] - after.ammo[i],
        pass: after.shots > before.shots && before.ammo[i] > after.ammo[i],
      });
      await delay(100);
    }
    edges = ['Digit1'];
    await delay(100);
    await ready();
    edges = ['KeyR'];
    await delay(100);
    const reloading = api.snapshot();
    await until(() => api.snapshot().reloadEnd === 0);
    result.checks.push({
      name: 'reload completes in runtime',
      pass: reloading.reloadEnd > 0 && api.snapshot().ammo[0] === 30,
    });
    // Each route starts from a named street approach; traversal itself uses held movement
    // through the game loop, with Rapier resolving every frame (not endpoint teleport).
    for (const door of [
      { name: 'pawn', start: [0, 0.9, -12], end: [-7.3, 1.24, -12] },
      { name: 'tea', start: [8, 0.9, -31.5], end: [0.25, 1.24, -31.5] },
      { name: 'grocery', start: [8, 0.9, -53.5], end: [17.75, 1.24, -53.5] },
      { name: 'kitchen', start: [28, 0.9, -52], end: [33.25, 1.24, -52] },
    ]) {
      if (api.relocate) api.relocate(door.start);
      else
        physics.teleport(
          api.snapshot().playerEntity,
          new Float32Array(door.start),
        );
      await delay(100);
      aimAt([door.end[0], 1.64, door.end[2]]);
      await delay(100);
      keys = ['KeyW'];
      const wallStart = performance.now(),
        gameStart = api.snapshot().gameTime;
      const deadline = wallStart + 20000;
      while (
        performance.now() < deadline &&
        api.snapshot().gameTime - gameStart < 4.5
      ) {
        await delay(50);
        const p = api.snapshot().player;
        if (
          Math.sign(door.end[0] - door.start[0]) * (p[0] - door.end[0]) >=
            -0.15 &&
          Math.abs(p[2] - door.end[2]) < 0.65
        )
          break;
      }
      keys = [];
      await delay(120);
      const p = api.snapshot().player;
      result.doors.push({
        name: door.name,
        wallTimeMs: performance.now() - wallStart,
        gameTimeSeconds: api.snapshot().gameTime - gameStart,
        end: p,
        pass:
          Math.hypot(p[0] - door.end[0], p[2] - door.end[2]) < 0.5 &&
          p[1] > 1.1 &&
          p[1] < 1.5,
      });
    }
    result.frameMs = api.snapshot().frameMs;
    result.pass =
      result.guns.every((x) => x.pass) &&
      result.doors.every((x) => x.pass) &&
      result.checks.every((x) => x.pass);
    return result;
  } finally {
    app.input.sample = original;
  }
}
