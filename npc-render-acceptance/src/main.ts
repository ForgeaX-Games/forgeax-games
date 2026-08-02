import type { BootstrapEntry } from '@forgeax/engine-app';
import { HANDLE_CUBE } from '@forgeax/engine-assets-runtime';
import { Update, type World } from '@forgeax/engine-ecs';
import { Camera, Instances, Materials, MeshFilter, MeshRenderer, perspective } from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import { NPC_PROTOCOL_VERSION, NpcClient, type PerceptionSnapshot } from '@forgeax/npc-client';

const BODY_COUNT = 5_000;
const SPOTLIGHT_COUNT = 30;
const MAX_INSTANCES_PER_ENTITY = 2_048;
const MODE_KEY = 'forgeax.npc-render-acceptance.mode';

function transforms(count: number, start: number): Float32Array {
  const out = new Float32Array(count * 16);
  for (let i = 0; i < count; i += 1) {
    const n = start + i, base = i * 16;
    const x = (n % 100) - 49.5, z = Math.floor(n / 100) - 24.5;
    out[base] = 0.32; out[base + 5] = 0.7; out[base + 10] = 0.32; out[base + 15] = 1;
    out[base + 12] = x * 0.7; out[base + 13] = 0.35; out[base + 14] = z * 0.7;
  }
  return out;
}

function snapshot(npcId: string, index: number): PerceptionSnapshot {
  return {
    v: NPC_PROTOCOL_VERSION,
    eventId: `render-acceptance-${npcId}`,
    game: 'npc-render-acceptance',
    npcId,
    t: 0,
    trigger: 'heartbeat',
    self: { pos: { x: index % 10, y: Math.floor(index / 10) }, activity: 'idle' },
    nearby: [],
    events: [{ type: 'renderer_acceptance' }],
    affordances: [{ action: 'wait' }],
  };
}

function spawnBodies(world: World, count: number): number {
  const material = world.allocSharedRef('MaterialAsset', Materials.standard({
    baseColor: [0.32, 0.72, 0.92, 1], roughness: 0.8, metallic: 0,
  }));
  let start = 0, entities = 0;
  while (start < count) {
    const size = Math.min(MAX_INSTANCES_PER_ENTITY, count - start);
    world.spawn(
      { component: Transform, data: {} },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [material] } },
      { component: Instances, data: { transforms: transforms(size, start) } },
    ).unwrap();
    start += size;
    entities += 1;
  }
  return entities;
}

const start: BootstrapEntry = async (world, ctx) => {
  world.spawn(
    { component: Transform, data: { pos: [0, 34, 34] } },
    { component: Camera, data: perspective({ fov: Math.PI / 3, aspect: 16 / 9, near: 0.1, far: 200 }) },
  ).unwrap();
  const mode = typeof localStorage === 'undefined' ? 'body' : localStorage.getItem(MODE_KEY) ?? 'body';
  const bodyCount = mode === 'spotlight' ? 500 + SPOTLIGHT_COUNT : BODY_COUNT;
  const renderEntities = spawnBodies(world, bodyCount);
  let client: NpcClient | null = null;
  if (mode === 'spotlight') {
    const ids = Array.from({ length: SPOTLIGHT_COUNT }, (_, i) => `spotlight-${i}`);
    void NpcClient.connect({ game: 'npc-render-acceptance', npcIds: ids }).then((connected) => {
      client = connected;
      for (const id of ids) connected.declareAffordances(id, [{ action: 'wait' }]);
      return connected.sendSnapshots(ids.map((id, i) => snapshot(id, i)));
    });
  }
  const stats = {
    mode,
    bodyCount,
    spotlightCount: mode === 'spotlight' ? SPOTLIGHT_COUNT : 0,
    renderEntities,
    frames: 0,
    startedAt: performance.now(),
    frameTimes: [] as number[],
    lastFrameAt: performance.now(),
    report() {
      const samples = [...this.frameTimes].sort((a, b) => a - b);
      const meanFrameMs = samples.reduce((sum, value) => sum + value, 0) / Math.max(1, samples.length);
      return {
        mode: this.mode,
        bodyCount: this.bodyCount,
        spotlightCount: this.spotlightCount,
        renderEntities: this.renderEntities,
        frames: this.frames,
        fps: meanFrameMs > 0 ? 1_000 / meanFrameMs : 0,
        meanFrameMs,
        p95FrameMs: samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)] ?? 0,
      };
    },
  };
  Object.assign(globalThis, { __npcRenderAcceptance: stats });
  world.addSystem(Update, { name: 'npc-render-acceptance', queries: [], fn: () => {
    const now = performance.now();
    stats.frames += 1;
    if (stats.frames > 60) stats.frameTimes.push(now - stats.lastFrameAt);
    if (stats.frameTimes.length > 300) stats.frameTimes.shift();
    stats.lastFrameAt = now;
  } }).unwrap();
  ctx?.registerCleanup?.(() => { if (client) void client.endEpisode().finally(() => client?.disconnect()); });
};

export default start;
