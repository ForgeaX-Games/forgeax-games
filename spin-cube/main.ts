import {
  Transform,
} from '@forgeax/engine-scene';
import {
  MeshFilter,
  MeshRenderer,
  Camera,
  Skylight,
  perspective,
} from '@forgeax/engine-render';
import {
  quat,
} from '@forgeax/engine-runtime';
import {
  type Handle,
  type MaterialAsset,
} from '@forgeax/engine-types';
import { HANDLE_CUBE } from '@forgeax/engine-assets-runtime';
import { Time, Update, defineComponent, Entity, type World } from '@forgeax/engine-ecs';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import type { BootstrapContext } from '@forgeax/engine-app';

const BASE_MATERIAL_GUID = 'd0606ad7-78d8-47e3-9d39-9ba94e9b4e22';

const Spin = defineComponent('Spin', { axisX: 'f32', axisY: 'f32', axisZ: 'f32', speed: 'f32' });
type InputRecord = { type: string; key?: string; phase?: string; x?: number; y?: number; button?: string };

export async function bootstrap(world: World, ctx?: BootstrapContext) {
  const { assets } = ctx ?? {};
  if (!assets) {
    console.error('[spin-cube] no asset registry — cannot load base material');
    return;
  }
  // Keep the carrier's input→query acceptance test game-owned. The host first
  // offers the typed action through this projection; games without an `input`
  // projection still receive the same DOM event fallback. This counter is
  // transient Play state and is discarded with the Play World on Stop.
  let inputEventCount = 0;
  let lastInput: InputRecord = { type: 'none' };
  ctx?.gameProjection?.registerAction({
    id: 'input',
    title: 'Record gameplay input',
    description: 'Record one typed input action for the carrier continuity probe',
    argsSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['key', 'pointer'] },
        key: { type: 'string' },
        phase: { type: 'string', enum: ['down', 'up'] },
        x: { type: 'number' },
        y: { type: 'number' },
        button: { type: 'string', enum: ['left', 'middle', 'right'] },
      },
      required: ['type'],
    },
    run: (args) => {
      inputEventCount += 1;
      const value = args as unknown as InputRecord;
      lastInput = { ...value };
    },
  });
  ctx?.gameProjection?.registerRead({
    id: 'input.status',
    title: 'Gameplay input status',
    description: 'Read the input actions received by the live Play World',
    read: () => ({ eventCount: inputEventCount, lastInput }),
  });
  const canvas = document.querySelector<HTMLCanvasElement>('#app')!;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  const aspect = canvas.width / canvas.height;

  const guidRes = AssetGuid.parse(BASE_MATERIAL_GUID);
  if (!guidRes.ok) {
    console.error('[spin-cube] base-material GUID parse failed');
    return;
  }
  // loadByGuid now catalogues the base-material payload (and returns it, not a
  // handle). We only need it catalogued so each derived child can lazily
  // resolve `parent` via registry.lookup at render time; the parent reference
  // is the base material's GUID, not a handle.
  const loadRes = await assets.loadByGuid<MaterialAsset>(guidRes.value);
  if (!loadRes.ok) {
    console.error('[spin-cube] loadByGuid failed:', loadRes.error.code);
    return;
  }
  const baseMaterialGuid = guidRes.value;

  world.spawn(
    { component: Transform, data: { pos: [0, 0, 8] } },
    // clearColor = visible sky-ish background on WebKit (no cubemap skybox
    // there; without this the background is black). Neutral studio blue-grey.
    { component: Camera, data: { ...perspective({ fov: Math.PI / 3, aspect }), clearColor: [0.14, 0.17, 0.24, 1] } },
  );

  // Ambient: standard materials compute ambient=0 without a Skylight, so the
  // cubes go black when ambient light disappears, especially on WebKit/WKWebView (the desktop app)
  // which can't run the IBL precompute. A cubemap-less Skylight binds the
  // engine's 1×1 white irradiance cube → flat ambient live on the first frame,
  // no async GPU work, renders everywhere.
  world.spawn({ component: Skylight, data: { color: [1, 1, 1], intensity: 0.9 } });

  for (let i = 0; i < 24; i++) {
    const material: Handle<'MaterialAsset', 'shared'> = world.allocSharedRef('MaterialAsset', {
      kind: 'material',
      parent: baseMaterialGuid,
      values: {
        baseColor: [0.2 + Math.random() * 0.8, 0.2 + Math.random() * 0.8, 0.2 + Math.random() * 0.8, 1],
      },
    } satisfies MaterialAsset);
    const ax = Math.random() - 0.5, ay = Math.random() - 0.5, az = Math.random() - 0.5;
    const len = Math.hypot(ax, ay, az) || 1;
    world.spawn(
      { component: Transform, data: { pos: [(Math.random() - 0.5) * 8, (Math.random() - 0.5) * 5, (Math.random() - 0.5) * 6] } },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [material] } },
      { component: Spin, data: { axisX: ax / len, axisY: ay / len, axisZ: az / len, speed: 0.5 + Math.random() * 2 } },
    );
  }

  const dq = quat.create(), cur = quat.create();
  world.addSystem(Update, {
    name: 'spin',
    queries: [{ with: [Entity, Transform, Spin] }],
    resources: ['Time'],
    fn: (_w, qr) => {
      const dt = world.getResource(Time).delta;
      for (const b of qr[0]) {
        const n = b.Entity.self.length;
        for (let i = 0; i < n; i++) {
          quat.fromAxisAngle(dq, [b.Spin.axisX[i]!, b.Spin.axisY[i]!, b.Spin.axisZ[i]!], dt * b.Spin.speed[i]!);
          cur[0] = b.Transform.quat[i * 4 + 0]!; cur[1] = b.Transform.quat[i * 4 + 1]!; cur[2] = b.Transform.quat[i * 4 + 2]!; cur[3] = b.Transform.quat[i * 4 + 3]!;
          quat.multiply(cur, dq, cur);
          b.Transform.quat[i * 4 + 0] = cur[0]; b.Transform.quat[i * 4 + 1] = cur[1]; b.Transform.quat[i * 4 + 2] = cur[2]; b.Transform.quat[i * 4 + 3] = cur[3];
        }
      }
    },
  });
}
