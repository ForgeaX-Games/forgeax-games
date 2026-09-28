/** Actual damage/death/restart through input; no health edits. */
export async function runDeathSmoke() {
  const api = window.__rainFps,
    app = window.__forgeax.app,
    original = app.input.sample.bind(app.input);
  let mx = 0,
    my = 0,
    edges = [];
  app.input.sample = () => {
    const r = {
      ...original(),
      pointerLocked: true,
      downCodes: new Set(),
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
  const samples = [];
  try {
    const enemy = api.snapshot().targets.find((t) => t.melee && t.health > 0),
      p = enemy.position;
    api.relocate([p[0] + 0.95, p[1], p[2]]);
    await delay(300);
    const s = api.snapshot(),
      dx = p[0] - s.player[0],
      dz = p[2] - s.player[2],
      yaw = Math.atan2(-dx, -dz);
    mx = -(yaw - s.yaw) / 0.0021;
    my = -(-0.15 - s.pitch) / 0.0021;
    const start = performance.now();
    while (api.snapshot().health > 0 && performance.now() - start < 60000) {
      await delay(150);
      const s = api.snapshot();
      samples.push({
        time: s.gameTime,
        health: s.health,
        opacity: Number(document.querySelector('.ra-wound').style.opacity),
      });
    }
    const dead = api.snapshot(),
      overlay = document.querySelector('.ra-death').style.display;
    window.__deathCheckpoint = { health: dead.health, overlay };
    await delay(1500);
    edges = ['Enter'];
    await delay(500);
    const reset = api.snapshot();
    return {
      pass:
        dead.health === 0 &&
        overlay === 'grid' &&
        reset.health === 100 &&
        Math.hypot(reset.player[0], reset.player[2] + 3) < 0.3 &&
        reset.kills === 0 &&
        reset.ammo[0] === 30,
      dead: { health: dead.health, overlay },
      restart: {
        health: reset.health,
        player: reset.player,
        kills: reset.kills,
        ammo: reset.ammo,
      },
      samples,
    };
  } finally {
    app.input.sample = original;
  }
}
