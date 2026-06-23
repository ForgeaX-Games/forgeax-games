// ============================================================================
//  ForgeaX: Hellforge — Diablo II-flavoured action RPG sample.
//
//  Witch hero with full skinned mesh + 5 animation clips
//  (idle / move / attack / hit / death), 2.5D ⇄ FPS view toggle, WASD
//  movement around the Rogue Encampment.
//
//  Controls
//    WASD            move on ground       Shift           sprint (also swaps to `move` clip)
//    V               toggle 2.5D ⇄ FPS    Mouse (FPS)     look
//    Left-click      attack clip + cast   1/2/3/4/5       preview clip (idle/move/attack/hit/death)
//    Space           pause / resume       Esc             release pointer-lock
//    Mouse wheel     zoom (2.5D)
// ============================================================================

import {
  AnimationPlayer,
  Camera,
  ChildOf,
  DirectionalLight,
  DirectionalLightShadow,
  Materials,
  MeshFilter,
  MeshRenderer,
  Name,
  PointLight,
  SceneInstance,
  Skin,
  Skylight,
  SkyboxBackground,
  SKYBOX_MODE_CUBEMAP,
  TONEMAP_ACES_FILMIC,
  Transform,
  HANDLE_CUBE,
  HANDLE_QUAD,
  HANDLE_SPHERE,
  createCylinderGeometry,
  createSphereGeometry,
  perspective,
  quat,
  type MaterialAsset,
} from '@forgeax/engine-runtime';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import type { EntityHandle } from '@forgeax/engine-ecs';
import type { GameEntry } from '@forgeax/engine-app';
import type { AnimationClip, Asset, Handle, LocalEntityId, MeshAsset, SceneAsset, TextureAsset } from '@forgeax/engine-types';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// ── asset GUIDs (mirror assets/characters/witch.glb.meta.json subAssets[]) ─
const WITCH = {
  scene:  '5e3028dd-ddf6-4104-86d9-318d3e8fb5a6',
  clips: [
    { name: 'idle',   guid: 'c530adf2-8de6-486a-afaa-9af3a6e6dfd1' },
    { name: 'move',   guid: 'f9355148-5ddc-45a4-80d4-ef80fce559b0' },
    { name: 'attack', guid: '9bb05e7d-6156-424f-8a20-f80373507f65' },
    { name: 'hit',    guid: '7faedc58-49cd-4fc9-93b7-66eca1b79674' },
    { name: 'death',  guid: 'ca6e7f12-8e1a-4b3c-9d50-2a4f1b8c6d04' },
  ] as const,
} as const;
const SKY_HDR_GUID = '81eec382-392f-5a93-8998-0ecf11ef7990';

// Visible sky background for WebKit/WKWebView (the desktop app), which can't
// render the cubemap SkyboxBackground (needs rgba16float render targets it
// lacks) — without this the background clears to black ("没天空背景"). The
// Camera clear color needs no GPU feature; a dark hellish red-orange suits the
// forge. Linear/pre-tonemap (ACES). perspective() carries clearR/G/B=0, so
// spread SKY_CLEAR AFTER it on every Camera write (spawn + resize re-apply).
const SKY_CLEAR = { clearR: 0.32, clearG: 0.07, clearB: 0.035 } as const;

// ── HDR sky (same path cow / fps use) ─────────────────────────────────────
async function installHdrSky(ctx: Parameters<GameEntry>[0]): Promise<EntityHandle | null> {
  // ALWAYS spawn a solid-color Skylight first. Without a Skylight the forgeax
  // PBR shader computes ambient=0, so a lone DirectionalLight leaves shaded
  // faces black ("天光没了"). A cubemap-less Skylight binds the engine's 1×1
  // white irradiance cube — ambient is live on the first frame with no async GPU
  // work, and it works on WebKit/WKWebView (desktop app) whose WebGPU lacks the
  // rgba16float render-attachment the IBL precompute needs. Warm hellish fill.
  const skylight = ctx.world.spawn(
    { component: Skylight, data: { colorR: 1.0, colorG: 0.5, colorB: 0.32, intensity: 0.2 } },
  ).unwrap();

  // WebKit/WKWebView guard — calling uploadCubemapFromEquirect there (the HDR
  // path uses colorFormats:['rgba16float']) produces a device error that poisons
  // the WebGPU device → the first frame never renders → Play sticks on
  // "Loading game" forever. Keep the solid ambient above and stop here. The
  // negative allowlist (NOT Chrome/Chromium/Edg) is more robust than \bChrome\b
  // whose word boundary misses Playwright's "HeadlessChrome" UA.
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isChromium = /Chrome|Chromium|Edg/.test(ua);
  if (!isChromium) {
    console.info('[hellforge] non-Chromium WebGPU (WebKit/WKWebView): solid-color skylight only (no IBL/skybox)');
    return skylight;
  }
  // engine e53f4616: `uploadCubemapFromEquirect` is now 3-arg
  // `(world, sourceHandle: Handle<'TextureAsset','shared'>, sourcePod)` and
  // returns `Handle<'CubeTextureAsset','shared'>`. `loadByGuid` returns the
  // PAYLOAD; the source handle is minted via `world.allocSharedRef`. Probe
  // both the (older) assets-side and the store-side surface; gracefully skip
  // if neither is exposed.
  const assetsAny = ctx.assets as unknown as {
    uploadCubemapFromEquirect?: (
      w: typeof ctx.world,
      h: Handle<'TextureAsset', 'shared'>,
      p: TextureAsset,
    ) => Promise<{ ok: boolean; value?: Handle<'CubeTextureAsset', 'shared'>; error?: { code: string } }>;
  };
  const renderer = (ctx.app as unknown as {
    renderer?: {
      store?: {
        uploadCubemapFromEquirect?: (
          w: typeof ctx.world,
          h: Handle<'TextureAsset', 'shared'>,
          p: TextureAsset,
        ) => Promise<{ ok: boolean; value?: Handle<'CubeTextureAsset', 'shared'>; error?: { code: string } }>;
      };
    };
  })?.renderer;
  const store = renderer?.store;
  const uploadOnAssets = typeof assetsAny.uploadCubemapFromEquirect === 'function' ? assetsAny.uploadCubemapFromEquirect.bind(assetsAny) : null;
  const uploadOnStore = (store && typeof store.uploadCubemapFromEquirect === 'function')
    ? store.uploadCubemapFromEquirect.bind(store)
    : null;
  const upload = uploadOnAssets ?? uploadOnStore;
  if (!upload) return skylight;
  const guidRes = AssetGuid.parse(SKY_HDR_GUID);
  if (!guidRes.ok) return skylight;
  const podRes = await ctx.assets.loadByGuid<TextureAsset>(guidRes.value);
  if (!podRes.ok) return skylight;
  const srcHandle = ctx.world.allocSharedRef<'TextureAsset', TextureAsset>('TextureAsset', podRes.value);
  const cubemapRes = await upload(ctx.world, srcHandle, podRes.value);
  if (!cubemapRes.ok || cubemapRes.value === undefined) return skylight;
  // Upgrade the existing Skylight to image-based lighting — very low intensity
  // (the HDR is bright) so the hellish mood holds. Neutral tint lets HDR drive.
  ctx.world.set(skylight, Skylight, { cubemap: cubemapRes.value, colorR: 1, colorG: 1, colorB: 1, intensity: 0.04 });
  ctx.world.spawn({ component: SkyboxBackground, data: { cubemap: cubemapRes.value, mode: SKYBOX_MODE_CUBEMAP } });
  return skylight;
}

// ── encampment scene-pack loader (same shape cow uses) ────────────────────
interface PackNode { localId: number; components: Record<string, Record<string, unknown>> }
interface PackAsset { guid: string; kind: string; payload: unknown; refs?: string[] }
interface ScenePack { assets: PackAsset[] }
const STRIP = new Set(['Collider']);
const HF: Record<string, string> = { MeshFilter: 'assetHandle' };

async function instantiateScenePack(pack: ScenePack, ctx: Parameters<GameEntry>[0]): Promise<EntityHandle | null> {
  const { world, assets } = ctx;
  const sceneEntry = pack.assets.find((a) => a.kind === 'scene');
  if (!sceneEntry) return null;
  const payload = sceneEntry.payload as { kind: 'scene'; entities?: PackNode[]; nodes?: PackNode[] };
  const packNodes = payload.entities ?? payload.nodes ?? [];
  const refs = sceneEntry.refs ?? [];
  // engine e53f4616: `registerWithGuid` is gone → `assets.catalog(guid, payload)`
  // returns a Result and never throws. Re-entering with the same GUID returns
  // Err harmlessly (payload identical), so we just ignore the Result.
  const regOnce = <T extends Asset>(g: string, payload: T) => {
    const gid = AssetGuid.parse(g); if (!gid.ok) return;
    assets.catalog<T>(gid.value, payload);
  };
  for (const a of pack.assets) if (a.kind === 'material') regOnce<MaterialAsset>(a.guid, a.payload as MaterialAsset);

  const sceneAsset: SceneAsset = {
    kind: 'scene',
    entities: packNodes.map((n) => {
      const comps: Record<string, Record<string, unknown>> = {};
      for (const [name, data] of Object.entries(n.components)) {
        if (STRIP.has(name)) continue;
        const hf = HF[name];
        const resolved: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(data)) {
          // Editor still saves MeshRenderer.material (singular int) — engine
          // #317 renamed to materials: [...]; convert in place so the engine
          // doesn't reject with spawn-data-unknown-field.
          if (name === 'MeshRenderer' && field === 'material' && typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < refs.length) {
            const arr = (resolved.materials as unknown[] | undefined) ?? [];
            arr[0] = refs[value];
            resolved.materials = arr;
            continue;
          }
          if (name === 'MeshRenderer' && field === 'materials' && Array.isArray(value)) {
            resolved[field] = value.map((v) =>
              (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < refs.length) ? refs[v] : v);
            continue;
          }
          // Editor still saves DirectionalLightShadow.orthoHalfExtent — engine
          // #387 split it into cascadeCount/splitLambda/cascadeBlend. Drop the
          // stale field and inject a sane CSM default if missing.
          if (name === 'DirectionalLightShadow' && field === 'orthoHalfExtent') continue;
          // Ground entity has a stray offset that drifted in via an editor
          // save (-4.78, -0.1, -1.92 instead of 0, -0.1, 0). Snap Ground's
          // Transform back to (0, -0.1, 0) so the world origin lines up with
          // the campfire / witch spawn.
          if (name === 'Transform' && (n.components.Name as { value?: string } | undefined)?.value === 'Ground'
              && (field === 'posX' || field === 'posZ')) {
            resolved[field] = 0;
            continue;
          }
          resolved[field] = (hf === field && typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < refs.length)
            ? refs[value] : value;
        }
        // Inject CSM default fields on DirectionalLightShadow if the editor
        // wrote only the legacy orthoHalfExtent shape.
        if (name === 'DirectionalLightShadow' && resolved.cascadeCount === undefined) {
          resolved.cascadeCount = 1;
          if (resolved.nearPlane === undefined) resolved.nearPlane = 0.1;
        }
        comps[name] = resolved;
      }
      return { localId: n.localId as unknown as LocalEntityId, components: comps };
    }),
  };
  const gid = AssetGuid.parse(sceneEntry.guid);
  if (!gid.ok) return null;
  // engine e53f4616: catalog the scene payload (Err on re-enter is harmless —
  // payload identical). `loadByGuid` now returns the PAYLOAD; `instantiate`
  // still wants a Handle, so mint one via `world.allocSharedRef`.
  assets.catalog<SceneAsset>(gid.value, sceneAsset);
  const h = await assets.loadByGuid<SceneAsset>(gid.value);
  if (!h.ok) { console.error('[hellforge] encampment loadByGuid:', h.error); return null; }
  const sceneHandle = world.allocSharedRef<'SceneAsset', SceneAsset>('SceneAsset', h.value);
  const inst = assets.instantiate<SceneAsset>(sceneHandle, world);
  if (!inst.ok) { console.error('[hellforge] encampment instantiate:', JSON.stringify(inst.error)); return null; }
  return inst.value as EntityHandle;
}

const start: GameEntry = async (ctx) => {
  const { world, assets, registerUpdate } = ctx;

  // ── canvas ────────────────────────────────────────────────────────────
  const canvas = document.querySelector<HTMLCanvasElement>('#app')!;
  const dpr = window.devicePixelRatio || 1;
  const sizeCanvas = () => {
    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  };
  sizeCanvas();
  let aspect = canvas.width / canvas.height;

  // ── 1. encampment scene (engine-native pack) ──────────────────────────
  try {
    const res = await fetch(new URL('./scenes/rogue-encampment.pack.json', import.meta.url));
    if (res.ok) {
      const pack = (await res.json()) as ScenePack;
      await instantiateScenePack(pack, ctx);
    }
  } catch (err) {
    console.warn('[hellforge] encampment unavailable:', (err as Error).message);
  }

  // ── 2. HDR sky (fire-and-forget) ──────────────────────────────────────
  void installHdrSky(ctx);

  // ── 3. witch GLB — via gltfImporter sub-assets ────────────────────────
  // play-runtime's vite.config wires gltfImporter into pluginPack, so the GLB
  // sub-assets land in pack-index.json on boot. We loadByGuid the scene +
  // each clip, instantiate the scene, then add AnimationPlayer to the Skin
  // entity inside it. Mirrors hello-skin exactly.
  type ClipHandle = Handle<'AnimationClip', 'shared'>;
  const clipHandles = new Map<string, ClipHandle>();
  const clipDur = new Map<string, number>(); // clip name → duration (seconds)

  // ── player rig: the ONE coordinate frame we move ──────────────────────
  // We never touch the witch's internal joints / scene mapping. The entire
  // witch scene is parented under this rig entity; moving the rig rigidly
  // carries her whole body + skeleton via the engine's ChildOf → Transform
  // propagation. Spawn it BEFORE instantiate so we can pass it as parent.
  const playerRig = world.spawn(
    { component: Transform, data: { posX: 0, posY: 0, posZ: 5 } },
  ).unwrap() as EntityHandle;

  let witchRoot: EntityHandle | null = null;
  let witchSkinEnt: EntityHandle | null = null;
  try {
    const sceneGuid = AssetGuid.parse(WITCH.scene);
    if (!sceneGuid.ok) throw new Error('witch scene guid parse');
    // engine e53f4616: `loadByGuid` returns the PAYLOAD. `instantiate` wants a
    // Handle, so mint one via `world.allocSharedRef`; clip handles passed to
    // AnimationPlayer are likewise minted from each clip payload, and the clip
    // duration is read straight off the payload (no more `assets.get`).
    const sceneRes = await assets.loadByGuid<SceneAsset>(sceneGuid.value);
    if (!sceneRes.ok) throw new Error('witch scene loadByGuid: ' + ((sceneRes.error as { code?: string }).code ?? '?'));
    for (const def of WITCH.clips) {
      const g = AssetGuid.parse(def.guid);
      if (!g.ok) { console.warn('[hellforge] clip guid parse:', def.name); continue; }
      const r = await assets.loadByGuid<AnimationClip>(g.value);
      if (!r.ok) { console.warn('[hellforge] clip loadByGuid:', def.name, (r.error as { code?: string }).code); continue; }
      const clipHandle = world.allocSharedRef<'AnimationClip', AnimationClip>('AnimationClip', r.value);
      clipHandles.set(def.name, clipHandle);
      // Record clip duration so one-shot clips (attack/hit/death) can auto-end.
      clipDur.set(def.name, (r.value as unknown as { duration: number }).duration);
    }
    // Parent the witch scene under playerRig (3rd arg) so the rig drives her.
    const sceneHandle = world.allocSharedRef<'SceneAsset', SceneAsset>('SceneAsset', sceneRes.value);
    const instRes = assets.instantiate<SceneAsset>(sceneHandle, world, playerRig);
    if (!instRes.ok) throw new Error('witch instantiate: ' + ((instRes.error as { code?: string }).code ?? '?'));
    witchRoot = instRes.value as EntityHandle;
    const sceneInst = world.get(witchRoot, SceneInstance);
    if (sceneInst.ok) {
      // Find the Skin entity in the spawned hierarchy (= same idiom as hello-skin).
      // Only needed to drive the AnimationPlayer clip, never to move her.
      for (let i = 0; i < sceneInst.value.mapping.length; i++) {
        const ent = sceneInst.value.mapping[i];
        if (ent === undefined || ent === 0) continue;
        if (world.get(ent as EntityHandle, Skin).ok) {
          witchSkinEnt = ent as EntityHandle;
          break;
        }
      }
    }
    if (witchSkinEnt !== null && clipHandles.has('idle')) {
      world.addComponent(witchSkinEnt, {
        component: AnimationPlayer,
        data: { clips: [clipHandles.get('idle')!], times: new Float32Array([0]), weights: new Float32Array([1]), speeds: new Float32Array([1]), paused: false, looping: true },
      });
      // ── engine skinning-contract fix ──────────────────────────────────
      // default-standard-pbr-skin.wgsl computes the final vertex as
      //   world = meshNode.worldFromLocal * (palette * pos)
      // and palette already = jointWorld * IBM (full world, incl. ancestors).
      // The skinned mesh node (CH_Witch_001) is a ChildOf the Armature, so it
      // shares every ancestor with the joints — any rig transform would be
      // applied TWICE (once via meshNode.worldFromLocal, once via the palette).
      // The engine's contract (glTF skinning) is that the mesh node sits at
      // world identity and the palette carries everything. We enforce that by
      // detaching the mesh node from the Armature subtree and pinning its local
      // transform to identity. Movement then lives purely in the palette, which
      // the playerRig drives through the joints — single, correct transform.
      world.removeComponent(witchSkinEnt, ChildOf);
      world.set(witchSkinEnt, Transform, {
        posX: 0, posY: 0, posZ: 0,
        quatX: 0, quatY: 0, quatZ: 0, quatW: 1,
        scaleX: 1, scaleY: 1, scaleZ: 1,
      });
    } else {
      console.warn('[hellforge] witch spawned but Skin entity / idle clip missing — animation off');
    }
    console.log('[hellforge] witch loaded — clips:', [...clipHandles.keys()]);
  } catch (err) {
    console.warn('[hellforge] witch.glb sub-asset load failed — placeholder:', (err as Error).message);
    // engine e53f4616: `assets.register(payload).unwrap()` (payload → handle)
    // is gone; mint the in-code anonymous material/mesh handles via
    // `world.allocSharedRef(tag, payload)` instead (MeshFilter.assetHandle =
    // shared<MeshAsset>, MeshRenderer.materials = array<shared<MaterialAsset>>).
    const matWitch = world.allocSharedRef<'MaterialAsset', MaterialAsset>(
      'MaterialAsset',
      Materials.standard({ baseColor: [0.25, 0.18, 0.45, 1], roughness: 0.6, metallic: 0.1 }),
    );
    const cyl = world.allocSharedRef<'MeshAsset', MeshAsset>(
      'MeshAsset',
      (createCylinderGeometry(0.5, 0.5, 1, 16) as unknown as { unwrap: () => MeshAsset }).unwrap(),
    );
    // Placeholder is also parented under playerRig (local offset only); the rig
    // still moves it. posZ local = 0 because playerRig carries the position.
    witchRoot = world.spawn(
      { component: Transform, data: { posX: 0, posY: 0.85, posZ: 0, scaleX: 0.6, scaleY: 1.7, scaleZ: 0.6 } },
      { component: MeshFilter, data: { assetHandle: cyl } },
      { component: MeshRenderer, data: { materials: [matWitch] } },
      { component: ChildOf, data: { parent: playerRig } },
    ).unwrap();
  }

  // ── player state ──────────────────────────────────────────────────────
  type ViewMode = 'topdown' | 'fps';
  const keys: Record<string, boolean> = {};

  // Player-following warm torch light (cow-survivor level2 night pattern).
  // Lets the witch read against the dim moonlit ambient instead of vanishing
  // into shadow; the directional moonlight casts proper shadows around her.
  const playerLight = world.spawn(
    { component: Transform, data: { posX: 0, posY: 3.0, posZ: 5 } },
    { component: PointLight, data: { colorR: 1.0, colorG: 0.55, colorB: 0.35, intensity: 10, range: 7 } },
  ).unwrap();

  // Witch shadow proxy: humanoid-sized vertical box at her position.
  // Material has ONLY a ShadowCaster pass — no Forward — so the engine
  // writes its depth into the shadow atlas but never renders it in the
  // colour pass, leaving the proxy invisible to the camera while the
  // moonlight projects a real geometry-cast shadow onto the ground
  // (same path the hut shadows use).
  //
  // Why a proxy: the engine's default-shadow-caster shader is 12F /
  // vertex-only; the witch's skinned mesh is 18F. A proper skinned
  // shadow caster needs engine-side BindGroup-2 wiring for the joint
  // palette during the shadow pass — the
  // hellforge::pbr-skin-shadow-caster shader registered above is the
  // future replacement once that engine support lands.
  // engine e53f4616: `assets.register` is gone → mint the handle via
  // `world.allocSharedRef('MaterialAsset', payload)`.
  const shadowProxyMat = world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
    kind: 'material',
    passes: [
      {
        name: 'ShadowCaster',
        shader: 'forgeax::default-shadow-caster',
        tags: { LightMode: 'ShadowCaster' },
        queue: 2000,
      },
    ],
    paramValues: {},
  });
  const shadowDisc = world.spawn(
    { component: Transform, data: { posX: 0, posY: 0.85, posZ: 5, scaleX: 0.6, scaleY: 1.7, scaleZ: 0.45 } },
    { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
    { component: MeshRenderer, data: { materials: [shadowProxyMat] } },
  ).unwrap();
  const state = {
    px: 0, pz: 5,
    mode: 'topdown' as ViewMode,
    locked: false,
    currentClip: 'idle' as string,
    paused: false,
    moving: false,
    // One-shot clip (attack/hit/death): plays once, LOCKS locomotion (no
    // translation/turn) until it ends, then the state machine resumes
    // move/idle. `oneShotUntil` is the performance.now() ms at which it ends.
    oneShotUntil: 0,
  };
  // lookYaw/lookPitch are the orbit angles for the GTA-style third-person
  // camera; faceX/faceZ is the witch's current facing direction (unit vector),
  // driven each frame by registerUpdate. lookPitch starts slightly downward so
  // the third-person camera sits above-and-behind looking down at her.
  let lookYaw = 0, lookPitch = -0.25;
  let faceX = 0, faceZ = -1;
  (window as unknown as { __hf?: unknown }).__hf = {
    state,
    playerRig,
    get witchRoot() { return witchRoot; },
    get witchSkinEnt() { return witchSkinEnt; },
    get lookYaw() { return lookYaw; },
    get lookPitch() { return lookPitch; },
  };

  // ── camera ────────────────────────────────────────────────────────────
  const FOV = Math.PI / 2.4;
  const camera = world.spawn(
    { component: Transform, data: { posY: 1.6, posZ: 0 } },
    { component: Camera, data: { ...perspective({ fov: FOV, aspect, near: 0.05, far: 200 }), tonemap: TONEMAP_ACES_FILMIC, ...SKY_CLEAR } },
  ).unwrap();
  world.set(camera, Camera, { tonemap: TONEMAP_ACES_FILMIC });
  // Expose on debug global so we can probe live entity transforms.
  ((window as unknown as { __hf: Record<string, unknown> }).__hf).camera = camera;
  ((window as unknown as { __hf: Record<string, unknown> }).__hf).Transform = Transform;
  ((window as unknown as { __hf: Record<string, unknown> }).__hf).Name = Name;
  ((window as unknown as { __hf: Record<string, unknown> }).__hf).ChildOf = ChildOf;
  ((window as unknown as { __hf: Record<string, unknown> }).__hf).world = world;

  // ── pointer-lock (web + Tauri) ────────────────────────────────────────
  const realRequestLock = HTMLElement.prototype.requestPointerLock;
  // requestPointerLock() returns a Promise that REJECTS asynchronously when the
  // window lacks focus (`WrongDocumentError: Pointer lock requires the window to
  // have focus` — common in WKWebView desktop). try/catch does NOT catch a
  // rejected Promise → unhandled rejection. Wrap every call: focus-gate (skip
  // silently if unfocused; next focused click re-locks) + swallow the rejection.
  const safeRequestLock = (el: HTMLElement): void => {
    try {
      if (!document.hasFocus()) { try { window.focus(); } catch { /* ignore */ } }
      if (!document.hasFocus()) return;
      const r = realRequestLock.call(el) as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
    } catch { /* pointerlockerror handles fallback */ }
  };
  const isTauri = !!(window as unknown as { __TAURI__?: unknown }).__TAURI__
               || !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  const postCapture = (capture: boolean) => {
    try { window.parent.postMessage({ type: 'fx-pointer-capture', capture }, '*'); } catch { /* not embedded */ }
  };
  const setLocked = (v: boolean) => {
    state.locked = v;
    canvas.style.cursor = v ? 'none' : (state.mode === 'fps' ? 'crosshair' : '');
    syncHud();
  };

  // ── HUD ───────────────────────────────────────────────────────────────
  const hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;top:14px;left:14px;color:#ddd;font:14px ui-monospace,Menlo,monospace;text-shadow:0 1px 2px #000;pointer-events:none;z-index:10';
  document.body.appendChild(hud);
  const syncHud = () => {
    const lockHint = state.mode === 'fps' ? (state.locked ? '🎮 鼠标已锁定 · ESC 释放' : '🖱️ 点击锁定鼠标 (转视角)') : '';
    hud.innerHTML = `<div style="background:rgba(0,0,0,0.55);padding:8px 12px;border-radius:6px;line-height:1.55">
      <b>ForgeaX: Hellforge</b> · 第一幕 流浪者营地<br>
      视角: <b>${state.mode === 'topdown' ? '2.5D 跟随' : '第三人称 (GTA)'}</b> · <kbd>V</kbd> 切换<br>
      <kbd>WASD</kbd> 移动 · <kbd>Shift</kbd> 冲刺 · ${state.mode === 'topdown' ? '<kbd>滚轮</kbd> 缩放' : '<kbd>鼠标</kbd> 视角'}<br>
      动画: <b>${state.currentClip}</b>${state.paused ? ' (暂停)' : ''} · <kbd>1</kbd>idle <kbd>2</kbd>move <kbd>3</kbd>attack <kbd>4</kbd>hit <kbd>5</kbd>death · <kbd>Space</kbd>暂停<br>
      位置: px=${state.px.toFixed(2)}, pz=${state.pz.toFixed(2)}<br>
      ${lockHint}
    </div>`;
  };
  syncHud();

  // One-shot playback speeds (>1 = snappier). Attack & hit read punchier a bit
  // faster; death stays at natural speed.
  const ATTACK_SPEED = 1.9;
  const HIT_SPEED = 1.7;

  // ── clip helpers ──────────────────────────────────────────────────────
  // Looping locomotion clip (idle / move). speed is set to 1 here; the move
  // clip's playback speed is re-synced to ground speed every frame in the loop.
  const swapClip = (name: string) => {
    if (witchSkinEnt === null) return;
    const h = clipHandles.get(name);
    if (h === undefined || state.currentClip === name) return;
    state.currentClip = name;
    world.set(witchSkinEnt, AnimationPlayer, {
      clips: [h], times: new Float32Array([0]), weights: new Float32Array([1]), speeds: new Float32Array([1]), looping: true, paused: state.paused,
    });
    syncHud();
  };
  // One-shot clip (attack / hit / death): plays once (no loop) at the given
  // playback speed, and LOCKS movement until it finishes (oneShotUntil). The
  // locomotion state machine resumes move/idle afterwards. Re-firing restarts
  // it (combo-friendly). A faster `speed` shortens the real duration, so
  // oneShotUntil is the clip length divided by speed.
  const playOnce = (name: string, speed = 1) => {
    if (witchSkinEnt === null) return;
    // Ignore re-triggers while a one-shot is still playing — pressing attack
    // repeatedly no longer restarts it from frame 0; it must finish first.
    if (performance.now() < state.oneShotUntil) return;
    const h = clipHandles.get(name);
    if (h === undefined) return;
    state.currentClip = name;
    state.oneShotUntil = performance.now() + ((clipDur.get(name) ?? 1) / speed) * 1000;
    world.set(witchSkinEnt, AnimationPlayer, {
      clips: [h], times: new Float32Array([0]), weights: new Float32Array([1]), speeds: new Float32Array([speed]), looping: false, paused: state.paused,
    });
    syncHud();
  };
  const togglePause = () => {
    if (witchSkinEnt === null) return;
    state.paused = !state.paused;
    world.set(witchSkinEnt, AnimationPlayer, { paused: state.paused });
    syncHud();
  };

  // ── input ─────────────────────────────────────────────────────────────
  ((window as unknown as { __hf: Record<string, unknown> }).__hf).keys = keys;
  window.addEventListener('keydown', (e) => {
    if (keys[e.code]) return;        // repeat → no edge action
    keys[e.code] = true;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === 'KeyV') {
      state.mode = state.mode === 'topdown' ? 'fps' : 'topdown';
      if (state.mode === 'topdown' && state.locked) {
        postCapture(false);
        try { document.exitPointerLock?.(); } catch { /* ignore */ }
        setLocked(false);
      }
      canvas.style.cursor = state.mode === 'fps' ? (state.locked ? 'none' : 'crosshair') : '';
      syncHud();
    }
    if (e.code === 'Digit1') swapClip('idle');
    if (e.code === 'Digit2') swapClip('move');
    if (e.code === 'Digit3') playOnce('attack', ATTACK_SPEED);
    if (e.code === 'Digit4') playOnce('hit', HIT_SPEED);
    if (e.code === 'Digit5') playOnce('death');
    if (e.code === 'Space') togglePause();
    if (e.key === 'Escape' && state.locked) {
      postCapture(false);
      try { document.exitPointerLock?.(); } catch { /* ignore */ }
      setLocked(false);
    }
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0 && !state.paused) {
      playOnce('attack', ATTACK_SPEED); // one-shot; locks movement until done
    }
    if (state.mode !== 'fps' || state.locked) return;
    if (isTauri) { postCapture(true); setLocked(true); }
    else { safeRequestLock(canvas); }
  });
  document.addEventListener('pointerlockchange', () => {
    setLocked(document.pointerLockElement === canvas);
  });
  document.addEventListener('pointerlockerror', () => {
    if (state.mode !== 'fps') return;
    postCapture(true);
    setLocked(true);
  });
  window.addEventListener('resize', () => {
    sizeCanvas();
    aspect = canvas.width / canvas.height;
    world.set(camera, Camera, { ...perspective({ fov: FOV, aspect, near: 0.05, far: 200 }), tonemap: TONEMAP_ACES_FILMIC, ...SKY_CLEAR });
  });

  // Cow-style mouse look (FPS only when pointer-locked).
  window.addEventListener('mousemove', (e) => {
    if (state.mode !== 'fps' || !state.locked) return;
    lookYaw -= e.movementX * 0.0023;
    lookPitch = clamp(lookPitch - e.movementY * 0.0023, -1.3, 1.3);
  });

  // ── tuning ─────────────────────────────────────────────────────────────
  const SPEED = 3.4, SPRINT = 5.4;   // m/s walk / sprint (−25% from 4.5/7.2)
  const TURN = 2.6;                  // arrow-key turn rate in 3rd-person (rad/s)
  // 2.5D: pulled in close so she reads large; same ~56° pitch (ratio kept at
  // 1.5). Camera smoothly FOLLOWS her every frame.
  const TOP_DY = 6.3, TOP_DZ = 4.2;
  const CAM_LERP = 8;                // 2.5D follow smoothing (higher = snappier)
  // GTA-style third-person rig: camera orbits behind + above the witch and
  // looks at a point near her chest, so her body sits slightly ahead/below
  // centre with the world visible in front of her.
  const TP_DIST = 3.2;              // camera distance behind the witch (m)
  const TP_TARGET_Y = 1.35;        // look-at height on her body (chest/head)
  // Facing sign: GLB authored forward axis. +1 = atan2(faceX,faceZ) faces the
  // travel direction. Flip to -1 if she moonwalks (back faces travel).
  const FACING_SIGN = 1;
  // Foot-slide fix: the `move` clip looks natural (feet plant, no slide) when
  // the body travels at ANIM_STRIDE m/s with playback speed 1. We scale the
  // clip's playback speed by groundSpeed / ANIM_STRIDE so the legs always keep
  // pace with the actual translation (walk and sprint both match). Lower this
  // if the feet still slide forward; raise it if they shuffle too fast.
  // ANIM_STRIDE = the move clip's implied locomotion speed at playback 1
  // (measured from the planted-foot world velocity: legs keep up with the body
  // only when animSpeed = groundSpeed / ANIM_STRIDE). Measured ~1.25 m/s.
  const ANIM_STRIDE = 1.15;
  // MAX raised so sprint (5.4 / 1.15 = 4.7) is not clamped — clamping would
  // re-introduce foot sliding at sprint speed.
  const ANIM_SPEED_MIN = 0.5, ANIM_SPEED_MAX = 4.8;

  const topPitch = -Math.atan2(TOP_DY, TOP_DZ);
  const topQ = quat.create();
  quat.fromAxisAngle(topQ, [1, 0, 0], topPitch);

  // 2.5D follow target: the ground point the camera tracks. Starts on the
  // witch's spawn so frame 1 frames her; lerps toward her each frame.
  let focusX = state.px;
  let focusZ = state.pz;

  registerUpdate((dt: number) => {
    // ── FPS look via arrow keys ───────────────────────────────────────────
    if (state.mode === 'fps') {
      if (keys['ArrowLeft']) lookYaw += TURN * dt;
      if (keys['ArrowRight']) lookYaw -= TURN * dt;
      if (keys['ArrowUp']) lookPitch = clamp(lookPitch + TURN * dt, -1.3, 1.3);
      if (keys['ArrowDown']) lookPitch = clamp(lookPitch - TURN * dt, -1.3, 1.3);
    }

    // ── input → world-space movement vector ───────────────────────────────
    // 2.5D: W=-Z (away), S=+Z (toward camera), A=-X (left), D=+X (right).
    // FPS: relative to look yaw.
    const sprint = !!keys['ShiftLeft'] || !!keys['ShiftRight'];
    const spd = (sprint ? SPRINT : SPEED) * dt;
    const am = state.mode !== 'fps';
    const fwd = ((keys['KeyW'] || (am && keys['ArrowUp'])) ? 1 : 0) -
                ((keys['KeyS'] || (am && keys['ArrowDown'])) ? 1 : 0);
    const strafe = ((keys['KeyD'] || (am && keys['ArrowRight'])) ? 1 : 0) -
                   ((keys['KeyA'] || (am && keys['ArrowLeft'])) ? 1 : 0);
    let mvx = 0, mvz = 0;
    if (state.mode === 'fps') {
      const fwdX = -Math.sin(lookYaw), fwdZ = -Math.cos(lookYaw);
      const rgtX = -fwdZ, rgtZ = fwdX;
      mvx = fwdX * fwd + rgtX * strafe;
      mvz = fwdZ * fwd + rgtZ * strafe;
    } else {
      mvx = strafe;
      mvz = -fwd;
    }

    // ── one-shot clip locks locomotion ───────────────────────────────────
    // While an attack / hit / death clip is still playing the witch is rooted:
    // no translation, no turning, until the clip finishes.
    const oneShotActive = !state.paused && performance.now() < state.oneShotUntil;

    // ── integrate position + update facing (blocked during a one-shot) ─────
    const len = Math.hypot(mvx, mvz);
    state.moving = !oneShotActive && len > 0;
    if (state.moving) {
      const nx = mvx / len, nz = mvz / len;
      faceX = nx; faceZ = nz;
      state.px = clamp(state.px + nx * spd, -24, 24);
      state.pz = clamp(state.pz + nz * spd, -13, 24);
    }

    // ── animation state machine ───────────────────────────────────────────
    // A one-shot clip owns the body until it ends; then locomotion (move/idle)
    // resumes from the live moving state. The move clip's playback speed tracks
    // ground speed so the feet don't slide.
    if (!state.paused && !oneShotActive) {
      if (state.oneShotUntil !== 0) state.oneShotUntil = 0; // just ended
      swapClip(state.moving ? 'move' : 'idle'); // no-op if already current
      if (state.moving && state.currentClip === 'move' && witchSkinEnt !== null) {
        const ground = sprint ? SPRINT : SPEED;
        const animSpeed = clamp(ground / ANIM_STRIDE, ANIM_SPEED_MIN, ANIM_SPEED_MAX);
        world.set(witchSkinEnt, AnimationPlayer, { speeds: new Float32Array([animSpeed]) });
      }
    }

    // ── drive ONLY the player rig (the coordinate frame) ──────────────────
    // The witch is parented under it, so this single Transform write moves her
    // whole body + skeleton via ChildOf propagation. posY stays 0 (she stands
    // on the ground); a pure Y-yaw quaternion turns her toward the travel
    // direction without ever tipping over. We never touch her internal mapping.
    {
      const yaw = Math.atan2(FACING_SIGN * faceX, FACING_SIGN * faceZ);
      const qy = quat.create();
      quat.fromAxisAngle(qy, [0, 1, 0], yaw);
      world.set(playerRig, Transform, {
        posX: state.px, posY: 0, posZ: state.pz,
        quatX: qy[0]!, quatY: qy[1]!, quatZ: qy[2]!, quatW: qy[3]!,
      });
    }

    // Player-following torch — same XZ as the witch + a bit above ground.
    world.set(playerLight, Transform, { posX: state.px, posY: 3.0, posZ: state.pz });
    // Witch shadow proxy — invisible humanoid box at her position; the
    // moonlight projects a real geometry-cast shadow onto the ground.
    world.set(shadowDisc, Transform, {
      posX: state.px, posY: 0.85, posZ: state.pz,
      scaleX: 0.6, scaleY: 1.7, scaleZ: 0.45,
    });

    // ── camera ────────────────────────────────────────────────────────────
    if (state.mode === 'fps') {
      // GTA-style third-person: orbit the camera behind + above the witch and
      // look at a point on her chest. She sits slightly ahead/below screen
      // centre with the world visible in front of her.
      const qy = quat.create(); quat.fromAxisAngle(qy, [0, 1, 0], lookYaw);
      const qx = quat.create(); quat.fromAxisAngle(qx, [1, 0, 0], lookPitch);
      const cq = quat.create(); quat.multiply(cq, qy, qx);
      // Camera forward = (qy*qx) applied to -Z.
      const cp = Math.cos(lookPitch), sp = Math.sin(lookPitch);
      const fwdX = -cp * Math.sin(lookYaw);
      const fwdY = sp;
      const fwdZ = -cp * Math.cos(lookYaw);
      // Look target on her body; camera sits TP_DIST behind along -forward.
      const tx = state.px, ty = TP_TARGET_Y, tz = state.pz;
      world.set(camera, Transform, {
        posX: tx - fwdX * TP_DIST,
        posY: ty - fwdY * TP_DIST,
        posZ: tz - fwdZ * TP_DIST,
        quatX: cq[0]!, quatY: cq[1]!, quatZ: cq[2]!, quatW: cq[3]!,
      });
    } else {
      // 2.5D: smoothly follow the witch (camera tracks her movement).
      const a = 1 - Math.exp(-CAM_LERP * dt);
      focusX += (state.px - focusX) * a;
      focusZ += (state.pz - focusZ) * a;
      world.set(camera, Transform, {
        posX: focusX, posY: TOP_DY, posZ: focusZ + TOP_DZ,
        quatX: topQ[0]!, quatY: topQ[1]!, quatZ: topQ[2]!, quatW: topQ[3]!,
      });
    }
  });
};

export default start;
