import { measurePerformance } from './performance-smoke.mjs';

/** A short input-driven sprint, turn, and return. Only the starting pose teleports.
 * Full combat rules stay enabled. Never lowers health or freezes enemies.
 */
export async function measureRoute(label = 'sprint-turn') {
  const { app } = window.__forgeax, api = window.__rainFps;
  const original = app.input.sample.bind(app.input);
  // Match game's signed mouse-to-angle mapping.
  let mx = api.snapshot().yaw / 0.0021, my = api.snapshot().pitch / 0.0021;
  let keys = [], edges = ['Enter'];
  app.input.sample = () => {
    const sample = { ...original(), pointerLocked: true, downCodes: new Set(keys), pressedCodes: new Set(edges),
      movementX: mx, movementY: my, buttons: [false,false,false], pressedButtons: [false,false,false] };
    mx = my = 0; edges = [];
    return sample;
  };
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const positions = [];
  let turn, timer;
  try {
    api.relocate([0, .9, -3]);
    await delay(500);
    keys = ['KeyW', 'ShiftLeft'];
    timer = setInterval(() => positions.push([...api.snapshot().player]), 250);
    turn = setTimeout(() => { mx = -Math.PI / .0021; }, 3000);
    const result = await measurePerformance({ durationMs: 6000, label });
    const distance = positions.reduce((s,p,i) => i ? s + Math.hypot(p[0]-positions[i-1][0],p[2]-positions[i-1][2]) : 0,0);
    return { ...result, distance, positions, endHealth: api.snapshot().health };
  } finally {
    clearTimeout(turn); clearInterval(timer); keys = [];
    app.input.sample = original;
  }
}
