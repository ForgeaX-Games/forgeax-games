// Temporary developer probe for the user's running local ForgeaX preview.
// Movement uses the real Rapier character controller and shipping colliders.
// Reload the page after verification to remove this helper and reset the game.
(() => {
  const w = window.__forgeax.world;
  const components = w.components.entries();
  const T = components.get('Transform');
  const C = components.get('CharacterController');
  const Camera = components.get('Camera');
  const player = [...w.query({ read: [T, C] }).unwrap()][0].entity;
  const physics = w.getResource('PhysicsWorld');
  const pos = () => Array.from(w.get(player, T).unwrap().pos);
  const teleport = (start) => {
    physics.teleport(player, new Float32Array(start));
    physics.applyPendingTeleports();
    physics.setKinematicPosition(player, { x: start[0], y: start[1], z: start[2] });
    w.set(player, T, { pos: start });
    physics.moveAndSlide(player, new Float32Array([0, -.01, 0]));
  };
  const move = (target) => {
    const trace = [];
    let steps = 0;
    for (; steps < 1200; steps++) {
      const at = pos();
      const dx = target[0] - at[0], dz = target[2] - at[2];
      const distance = Math.hypot(dx, dz);
      if (distance < .06) break;
      const step = Math.min(.08, distance);
      physics.moveAndSlide(player, new Float32Array([
        dx / distance * step, -.03, dz / distance * step,
      ]));
      if (steps % 20 === 0) trace.push(pos());
      if (steps > 80 && trace.length > 3 && Math.hypot(
        trace.at(-1)[0] - trace.at(-3)[0], trace.at(-1)[2] - trace.at(-3)[2],
      ) < .001) break;
    }
    const end = pos();
    return { target, end, steps, grounded: w.get(player, C).unwrap().grounded,
      passed: Math.hypot(end[0] - target[0], end[2] - target[2]) < .2
        && Math.abs(end[1] - target[1]) < .13, trace };
  };
  window.__districtProbe = {
    results: [], pos, teleport, move,
    async walk(name, start, target) {
      teleport(start);
      const actualStart = pos();
      const r = { name, start: actualStart, ...move(target) };
      this.results.push(r);
      await new Promise(requestAnimationFrame);
      return r;
    },
    async route(name, points) {
      teleport(points[0]);
      const segments = [];
      for (const point of points.slice(1)) {
        const result = move(point); segments.push(result);
        if (!result.passed) break;
      }
      const r = { name, passed: segments.length === points.length - 1
        && segments.every(x => x.passed), segments };
      this.results.push(r);
      await new Promise(requestAnimationFrame);
      return r;
    },
    snapshot() {
      const r = window.__forgeax.renderer.inspect();
      const camera = [...w.query({ read: [T, Camera] }).unwrap()][0];
      return { player: pos(), grounded: w.get(player, C).unwrap().grounded,
        camera: Array.from(camera.get(T).pos), renderer: r.state,
        canvas: [document.querySelector('canvas').width, document.querySelector('canvas').height],
        frame: r.frame.frameId, batches: r.renderScene.topology.batchCount,
        candidates: r.renderScene.topology.candidateCount,
        materialBindingsReady: r.meshMaterialBindings.every(x => x.residency.every(y => y.readiness === 'ready')),
        bindingDiagnostics: r.meshMaterialBindings.flatMap(x => x.diagnostics),
        world: window.__forgeaxExecutionReport().world };
    },
  };
  return 'District runtime probe ready';
})();
