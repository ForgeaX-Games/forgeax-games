/**
 * 《今晚别变回人》— ForgeaX entry.
 *
 * Static vignette: assets/scene.pack.json (atmosphere only for now).
 * Dynamic: AppShell drives MatchFSM (lobby → cauldron → narrative → minigames → settle).
 */
import { Transform } from '@forgeax/engine-scene';
import {
  Camera,
  perspective,
  SceneInstance,
  TONEMAP_REINHARD_EXTENDED,
  BLOOM_ENABLED,
  ANTIALIAS_FXAA,
  PointLight,
  MeshFilter,
  MeshRenderer,
  Materials,
} from '@forgeax/engine-render';
import { quat } from '@forgeax/engine-runtime';
import { HANDLE_CUBE, type AssetRegistry } from '@forgeax/engine-assets-runtime';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { Time, Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
import type { BootstrapContext } from '@forgeax/engine-app';
import type { MaterialAsset, SceneAsset } from '@forgeax/engine-types';
import { AppShell } from './src/app/shell/AppShell';

const SCENE_GUID = 'fb1066e9-2079-4d68-b1f7-aea6f61c1a72';

interface PackNode {
  localId: number;
  components: Record<string, Record<string, unknown>>;
}

type Ctx = { world: World; assets?: AssetRegistry };

async function loadScene(
  ctx: Ctx,
): Promise<{ mapping: ReadonlyMap<number, EntityHandle>; nodes: PackNode[] } | null> {
  const { world, assets } = ctx;
  if (!assets) return null;
  const sceneGuid = AssetGuid.parse(SCENE_GUID);
  if (!sceneGuid.ok) return null;
  const loadRes = await assets.loadByGuid<SceneAsset>(sceneGuid.value);
  if (!loadRes.ok) {
    console.error('[tonight-no-human] scene loadByGuid failed:', loadRes.error);
    return null;
  }
  const sceneHandle = world.allocSharedRef('SceneAsset', loadRes.value);
  const instRes = assets.instantiate<SceneAsset>(sceneHandle, world);
  if (!instRes.ok) {
    console.error('[tonight-no-human] scene instantiate failed');
    return null;
  }
  const root = instRes.value;
  const sceneInst = world.get(root, SceneInstance);
  if (!sceneInst.ok) return null;
  const mappingArr = sceneInst.value.mapping;
  if (!mappingArr) return null;
  const nodes = loadRes.value.entities as unknown as PackNode[];
  const mapping = new Map<number, EntityHandle>();
  for (const n of nodes) {
    const e = mappingArr[n.localId];
    if (e !== undefined) mapping.set(n.localId, e as EntityHandle);
  }
  return { mapping, nodes };
}

function spawnFallback(world: World): void {
  const ground = world.allocSharedRef<'MaterialAsset', MaterialAsset>(
    'MaterialAsset',
    Materials.standard({ baseColor: [0.42, 0.22, 0.18, 1], roughness: 0.95, metallic: 0 }),
  );
  world.spawn(
    { component: Transform, data: { pos: [0, -0.1, 0], scale: [24, 0.2, 24] } },
    { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
    { component: MeshRenderer, data: { materials: [ground] } },
  );
}

export async function bootstrap(world: World, ctx?: BootstrapContext) {
  const registerCleanup = ctx?.registerCleanup;

  const canvas = document.querySelector<HTMLCanvasElement>('#app');
  if (!canvas) {
    console.error('[tonight-no-human] #app canvas missing');
    return;
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  const aspect = canvas.width / canvas.height || 1;

  // ── adopt host scene or load ourselves ───────────────────────────────
  let loaded: { mapping: ReadonlyMap<number, EntityHandle>; nodes: PackNode[] } | null = null;
  const hostRoot = ctx?.defaultSceneRoot;
  if (hostRoot !== undefined && ctx?.defaultScene !== undefined) {
    const sceneInst = world.get(hostRoot, SceneInstance);
    if (sceneInst.ok) {
      const mappingArr = sceneInst.value.mapping as unknown as { length: number; [i: number]: number };
      const mapping = new Map<number, EntityHandle>();
      for (let localId = 0; localId < mappingArr.length; localId++) {
        const e = mappingArr[localId];
        if (e !== undefined && e !== 0xffffffff && e !== 0) mapping.set(localId, e as EntityHandle);
      }
      loaded = { mapping, nodes: ctx.defaultScene.entities as unknown as PackNode[] };
    }
  }
  if (!loaded) {
    try {
      loaded = await loadScene({ world, assets: ctx?.assets });
    } catch (err) {
      console.warn('[tonight-no-human] scene unavailable:', err);
    }
  }
  if (!loaded) spawnFallback(world);

  // ── camera: warm ofrenda-ish top-down ────────────────────────────────
  const TOP_DY = 14;
  const TOP_DZ = 10;
  const topPitch = -Math.atan2(TOP_DY, TOP_DZ);
  const topQ = quat.create();
  quat.fromAxisAngle(topQ, [1, 0, 0], topPitch);
  world.spawn(
    {
      component: Transform,
      data: { pos: [0, TOP_DY, TOP_DZ], quat: [topQ[0]!, topQ[1]!, topQ[2]!, topQ[3]!] },
    },
    {
      component: Camera,
      data: {
        ...perspective({ fov: Math.PI / 3, aspect, near: 0.1, far: 200 }),
        tonemap: TONEMAP_REINHARD_EXTENDED,
        bloom: BLOOM_ENABLED,
        antialias: ANTIALIAS_FXAA,
        // Warm dusk clear — readable without HDR skybox on WebKit.
        clearColor: [0.35, 0.18, 0.14, 1],
      },
    },
  );

  world.spawn(
    { component: Transform, data: { pos: [2, 5, 1] } },
    { component: PointLight, data: { color: [1, 0.55, 0.28], intensity: 48, range: 24 } },
  );

  // ── match shell ──────────────────────────────────────────────────────
  const hudHost = ctx?.uiRoot ?? canvas.parentElement ?? document.body;
  const shell = new AppShell(hudHost);
  registerCleanup?.(() => shell.dispose());

  world.addSystem(Update, {
    name: 'tonight-no-human-update',
    queries: [],
    fn: () => {
      const dt = world.getResource(Time).delta;
      shell.tick(dt);
    },
  });

  console.info('[tonight-no-human] shell ready · phase', shell.fsm.phase);
}
