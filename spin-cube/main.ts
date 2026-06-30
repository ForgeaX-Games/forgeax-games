import { Transform, MeshFilter, MeshRenderer, Camera, Skylight, perspective, quat, HANDLE_CUBE, type Handle, type MaterialAsset } from '@forgeax/engine-runtime';
import { defineComponent, Entity, type World } from '@forgeax/engine-ecs';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import type { BootstrapContext } from '@forgeax/engine-app';

const BASE_MATERIAL_GUID = 'd0606ad7-78d8-47e3-9d39-9ba94e9b4e22';

const Spin = defineComponent('Spin', { axisX: 'f32', axisY: 'f32', axisZ: 'f32', speed: 'f32' });

export async function bootstrap(world: World, ctx?: BootstrapContext) {
  const { assets } = ctx ?? {};
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
    { component: Transform, data: { posY: 0, posZ: 8 } },
    // clearR/G/B = visible sky-ish background on WebKit (no cubemap skybox
    // there; without this the background is black). Neutral studio blue-grey.
    { component: Camera, data: { ...perspective({ fov: Math.PI / 3, aspect }), clearR: 0.14, clearG: 0.17, clearB: 0.24 } },
  );

  // Ambient: standard materials compute ambient=0 without a Skylight, so the
  // cubes go black ("天光没了"), especially on WebKit/WKWebView (the desktop app)
  // which can't run the IBL precompute. A cubemap-less Skylight binds the
  // engine's 1×1 white irradiance cube → flat ambient live on the first frame,
  // no async GPU work, renders everywhere.
  world.spawn({ component: Skylight, data: { colorR: 1, colorG: 1, colorB: 1, intensity: 0.9 } });

  for (let i = 0; i < 24; i++) {
    const material: Handle<'MaterialAsset', 'shared'> = world.allocSharedRef('MaterialAsset', {
      kind: 'material',
      parent: baseMaterialGuid,
      paramValues: {
        baseColor: [0.2 + Math.random() * 0.8, 0.2 + Math.random() * 0.8, 0.2 + Math.random() * 0.8, 1],
      },
    } satisfies MaterialAsset);
    const ax = Math.random() - 0.5, ay = Math.random() - 0.5, az = Math.random() - 0.5;
    const len = Math.hypot(ax, ay, az) || 1;
    world.spawn(
      { component: Transform, data: { posX: (Math.random() - 0.5) * 8, posY: (Math.random() - 0.5) * 5, posZ: (Math.random() - 0.5) * 6 } },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [material] } },
      { component: Spin, data: { axisX: ax / len, axisY: ay / len, axisZ: az / len, speed: 0.5 + Math.random() * 2 } },
    );
  }

  const dq = quat.create(), cur = quat.create();
  world.addSystem({
    name: 'spin',
    queries: [{ with: [Entity, Transform, Spin] }],
    resources: ['Time'],
    fn: (_w, qr) => {
      const dt = world.getResource<{ dt: number }>('Time').dt;
      for (const b of qr[0]) {
        const n = b.Entity.self.length;
        for (let i = 0; i < n; i++) {
          quat.fromAxisAngle(dq, [b.Spin.axisX[i]!, b.Spin.axisY[i]!, b.Spin.axisZ[i]!], dt * b.Spin.speed[i]!);
          cur[0] = b.Transform.quatX[i]!; cur[1] = b.Transform.quatY[i]!; cur[2] = b.Transform.quatZ[i]!; cur[3] = b.Transform.quatW[i]!;
          quat.multiply(cur, dq, cur);
          b.Transform.quatX[i] = cur[0]; b.Transform.quatY[i] = cur[1]; b.Transform.quatZ[i] = cur[2]; b.Transform.quatW[i] = cur[3];
        }
      }
    },
  });
}