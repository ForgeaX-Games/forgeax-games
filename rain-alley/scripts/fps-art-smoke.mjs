import { Name, Transform } from '@forgeax/engine-scene';
import { WEAPONS } from '../src/fps/weapons';
/** Mechanical acceptance uses actual imported entity transforms and the real input/state loop. */
export async function runArtSmoke() {
  const { app, world } = window.__forgeax,
    api = window.__rainFps;
  const original = app.input.sample.bind(app.input);
  let edges = [],
    fire = false,
    press = false;
  app.input.sample = () => {
    const s = original(),
      r = {
        ...s,
        pointerLocked: true,
        downCodes: new Set(),
        pressedCodes: new Set(edges),
        buttons: [fire, false, false],
        pressedButtons: [press, false, false],
        movementX: 0,
        movementY: 0,
      };
    edges = [];
    press = false;
    return r;
  };
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (check) => {
    const end = performance.now() + 12000;
    while (!check()) {
      if (performance.now() > end) throw new Error('art state deadline');
      await delay(20);
    }
  };
  const part = (id, role) => {
    for (const row of world.query({ read: [Name, Transform] }).unwrap())
      if (row.get(Name).value === `${id}__${role}`) {
        const t = row.get(Transform);
        return {
          pos: Array.from(t.pos),
          quat: Array.from(t.quat),
          scale: Array.from(t.scale),
        };
      }
    throw new Error(`Missing imported node ${id}/${role}`);
  };
  const results = [];
  try {
    for (const [index, role] of [
      [0, 'MAGAZINE'],
      [5, 'CYLINDER'],
      [7, 'FEED_COVER'],
      [8, 'CLIP'],
      [10, 'SHELL'],
    ]) {
      edges = [`Digit${(index + 1) % 10}`];
      if (index === 10) {
        edges = ['Digit0'];
        await delay(100);
        edges = ['KeyE'];
      }
      await until(() => api.snapshot().weapon === WEAPONS[index].id);
      await until(
        () => api.snapshot().gameTime > api.snapshot().readyAt + 0.03,
      );
      fire = press = true;
      await delay(100);
      fire = false;
      await delay(200);
      const before = part(WEAPONS[index].asset, role),
        handBefore = part(WEAPONS[index].asset, 'HAND_L');
      edges = ['KeyR'];
      await until(() => api.snapshot().reloadEnd > 0);
      const start = api.snapshot().gameTime,
        end = api.snapshot().reloadEnd;
      await until(() => api.snapshot().gameTime > start + (end - start) * 0.46);
      const during = part(WEAPONS[index].asset, role),
        handDuring = part(WEAPONS[index].asset, 'HAND_L');
      results.push({
        asset: WEAPONS[index].asset,
        style: WEAPONS[index].reloadStyle,
        part: role,
        before,
        during,
        handMoved: JSON.stringify(handBefore) !== JSON.stringify(handDuring),
        partMoved: JSON.stringify(before) !== JSON.stringify(during),
      });
      await until(() => api.snapshot().reloadEnd === 0);
    }
    return {
      kind: 'imported-part-transform-check',
      results,
      pass: results.every((r) => r.handMoved && r.partMoved),
    };
  } finally {
    app.input.sample = original;
  }
}
