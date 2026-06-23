// Cow-Level Survivor — vampire-survivors-like roguelike shooter on the D2
// Cow Level vibe. Keeps the template's twin-view (top-down ⇄ FPS) intact;
// adds: enemy spawner, weapon roguelike, upgrades, kill FX, screen shake,
// floating combat text. Multi-level campaign: each stage's static scene
// lives in scenes/<level>.pack.json (✎ Edit renders the same files); the
// per-stage bestiary / lighting / pacing lives in src/levels.ts; dynamic
// gameplay lives here. Player level, weapons and upgrades carry across
// stages; the scene + spawner reset on every transition.

import {
  Transform, Camera, perspective, quat, ChildOf,
  Skylight, SkyboxBackground, SKYBOX_MODE_CUBEMAP, TONEMAP_ACES_FILMIC,
  BLOOM_DISABLED, ANTIALIAS_MSAA, PointLight, SceneInstance,
  type MaterialAsset,
} from '@forgeax/engine-runtime';
import { Collider, ColliderShapeValue, RigidBody, RigidBodyTypeValue } from '@forgeax/engine-physics';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import type { Entity, EntityHandle } from '@forgeax/engine-ecs';
import type { GameEntry } from '@forgeax/engine-app';
import type { SceneAsset, LocalNodeId, TextureAsset } from '@forgeax/engine-types';

// M3c: the play-runtime host injects the instantiated defaultScene root +
// loaded SceneAsset onto the GameContext before entry runs. The engine-app
// GameEntry signature stays unchanged (engine zero-change), so the first-level
// branch in loadLevel reads these host-fed fields through a structural
// widening of the received ctx.
type HostFedContext = Parameters<GameEntry>[0] & {
  readonly defaultSceneRoot?: EntityHandle;
  readonly defaultScene?: SceneAsset;
};

import { installHud, type ViewMode, type WeaponIconState } from './src/hud';
import {
  EnemyManager, ENEMIES, loadMonsterVisuals, loadCharacterVisual, spawnPackVisual,
  type Enemy, type EnemyKind, type PackVisual,
} from './src/enemies';
import { LEVELS } from './src/levels';
import { installCowSurvivorPipeline } from './src/render-pipeline';
import { loadEffectAssets } from './src/effects';
import { WeaponSystem, type WeaponKind } from './src/weapons';
import { installUpgradeUI, rollUpgrades, xpForLevel, type UpgradeCard } from './src/upgrades';
import { FxSystem } from './src/fx';
import { GemSystem } from './src/gems';
import { SfxSystem } from './src/sfx';

const SKY_HDR_GUID = '81eec382-392f-5a93-8998-0ecf11ef7990';
const CYLINDER_GUID = 'c1111111-0000-5000-8000-000000000001';
const HANDLE_FIELD: Record<string, string> = { MeshFilter: 'assetHandle', MeshRenderer: 'material' };
const STRIP_COMPONENTS = new Set(['Collider']);

interface PackNode { localId: number; components: Record<string, Record<string, unknown>> }
interface PackAsset { guid: string; kind: string; payload: unknown; refs?: string[] }
interface ScenePack { assets: PackAsset[] }

// ── HDR sky (purple-tinted D2 hell vibe; HDR texture is generic) ─────────
// Returns the Skylight entity so level transitions can re-mood the ambient
// (day vs night) with a single intensity write; null when the renderer
// lacks the cubemap upload path (sky silently skipped).
//
// engine e53f4616: `uploadCubemapFromEquirect` lives on `renderer.store` and is
// now 3-arg `(world, sourceHandle, sourcePod)`. `loadByGuid` returns the
// PAYLOAD; the source handle is minted via `world.allocSharedRef('TextureAsset',
// pod)`. Probe the store surface and gracefully skip if not exposed.
async function installHdrSky(ctx: Parameters<GameEntry>[0]): Promise<Entity | null> {
  // ALWAYS spawn a solid-color Skylight first. The forgeax PBR shader computes
  // ambient=0 without a Skylight, so a lone DirectionalLight leaves shaded faces
  // black ("天光没了"). A cubemap-less Skylight binds the engine's 1×1 white
  // irradiance cube — ambient is live on the very first frame with no async GPU
  // work, and it works on WebKit/WKWebView (desktop app) whose WebGPU lacks the
  // rgba16float render-attachment the IBL precompute needs. Cool, moody fill.
  const skylight = ctx.world.spawn(
    { component: Skylight, data: { colorR: 0.7, colorG: 0.78, colorB: 0.95, intensity: 0.3 } },
  ).unwrap();

  // WebKit/WKWebView guard — calling uploadCubemapFromEquirect there poisons the
  // WebGPU device → first frame never renders → Play sticks on "Loading game"
  // forever. Keep the solid ambient above and stop here. Negative allowlist
  // (NOT Chrome/Chromium/Edg) is robust against Playwright's "HeadlessChrome" UA.
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isChromium = /Chrome|Chromium|Edg/.test(ua);
  if (!isChromium) {
    console.info('[cow] non-Chromium WebGPU (WebKit/WKWebView): solid-color skylight only (no IBL/skybox)');
    return skylight;
  }
  const renderer = (ctx.app as unknown as { renderer?: { store?: { uploadCubemapFromEquirect?: unknown } } })?.renderer;
  const store = renderer?.store;
  const upload = (store && typeof store.uploadCubemapFromEquirect === 'function')
    ? (store.uploadCubemapFromEquirect as (
        world: unknown, h: unknown, p: unknown,
      ) => Promise<{ ok: boolean; value?: unknown; error?: { code: string } }>).bind(store)
    : null;
  if (!upload) {
    console.warn('[cow] HDR sky skipped — uploadCubemapFromEquirect not exposed on renderer.store');
    return skylight;
  }
  const guidRes = AssetGuid.parse(SKY_HDR_GUID);
  if (!guidRes.ok) return skylight;
  const podRes = await ctx.assets.loadByGuid<TextureAsset>(guidRes.value);
  if (!podRes.ok) return skylight;
  const srcHandle = ctx.world.allocSharedRef<'TextureAsset', TextureAsset>('TextureAsset', podRes.value);
  const cubemapRes = await upload(ctx.world, srcHandle, podRes.value);
  if (!cubemapRes.ok || cubemapRes.value === undefined) {
    console.warn('[cow] HDR sky cubemap upload failed:', (cubemapRes as { error?: { code?: string } }).error?.code);
    return skylight;
  }
  // Upgrade the existing Skylight to image-based lighting — lower intensity so
  // the scene reads moody, not bright daylight. Neutral tint lets the HDR drive.
  ctx.world.set(skylight, Skylight, { cubemap: cubemapRes.value, colorR: 1, colorG: 1, colorB: 1, intensity: 0.12 });
  ctx.world.spawn({ component: SkyboxBackground, data: { cubemap: cubemapRes.value, mode: SKYBOX_MODE_CUBEMAP } });
  return skylight;
}

// ── scene-pack loader (same as the template) ─────────────────────────────
interface LoadedScene {
  mapping: ReadonlyMap<number, Entity>;
  nodes: PackNode[];
  /** SceneInstance synthetic root — `world.despawnScene(synthRoot)` tears the
   *  whole stage down on level transitions. */
  synthRoot: Entity;
}

async function instantiateScenePack(
  pack: ScenePack,
  ctx: Parameters<GameEntry>[0],
): Promise<LoadedScene | null> {
  const { world, assets } = ctx;
  const sceneEntry = pack.assets.find((a) => a.kind === 'scene');
  if (!sceneEntry) return null;
  // engine e53f4616: the old GUID-mint register call is gone → `assets.catalog(
  // guid, payload)` returns a Result and never throws. Across level transitions the cylinder
  // geometry (and any asset shared between level packs) is already catalogued
  // from the previous level — that is fine, the payload is identical; a
  // collision returns Err harmlessly, so we just ignore the Result.
  const registerOnce = <T extends MaterialAsset | SceneAsset | { kind: string },>(guidStr: string, payload: T): void => {
    const g = AssetGuid.parse(guidStr);
    if (!g.ok) return;
    assets.catalog(g.value, payload as Parameters<typeof assets.catalog>[1]);
  };
  const scenePayload = sceneEntry.payload as { kind: 'scene'; entities?: PackNode[]; nodes?: PackNode[] };
  const packNodes = scenePayload.entities ?? scenePayload.nodes ?? [];
  const refs = sceneEntry.refs ?? [];
  for (const a of pack.assets) {
    if (a.kind !== 'material') continue;
    registerOnce<MaterialAsset>(a.guid, a.payload as MaterialAsset);
  }
  {
    const { createCylinderGeometry } = await import('@forgeax/engine-runtime');
    const cylGeo = createCylinderGeometry(0.5, 0.5, 1, 18);
    if (cylGeo.ok) registerOnce(CYLINDER_GUID, cylGeo.value);
  }
  const sceneAsset: SceneAsset = {
    kind: 'scene',
    entities: packNodes.map((n) => {
      const components: Record<string, Record<string, unknown>> = {};
      for (const [name, data] of Object.entries(n.components)) {
        if (STRIP_COMPONENTS.has(name)) continue;
        const hf = HANDLE_FIELD[name];
        const resolved: Record<string, unknown> = {};
        for (const [field, value] of Object.entries(data)) {
          // ubpa engine 81dfc5297 + cow 17926e5: MeshRenderer schema flipped
          // from `material: <ref-index>` (singular int) to `materials: <ref-index[]>`
          // (plural array). Pack JSONs ship the new shape; we still need to
          // translate each ref-index → GUID string here. Keep the legacy
          // single-`material` branch below for back-compat with any pack that
          // hasn't migrated yet.
          if (name === 'MeshRenderer' && field === 'materials' && Array.isArray(value)) {
            resolved[field] = value.map((v) =>
              (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < refs.length) ? refs[v] : v);
            continue;
          }
          resolved[field] = (hf === field && typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < refs.length)
            ? refs[value]
            : value;
        }
        if (name === 'MeshRenderer' && 'material' in resolved) {
          const single = resolved['material'];
          delete resolved['material'];
          resolved['materials'] = single === undefined || single === null ? [] : [single];
        }
        components[name] = resolved;
      }
      return { localId: n.localId as LocalNodeId, components };
    }),
  };
  const sceneGuid = AssetGuid.parse(sceneEntry.guid);
  if (!sceneGuid.ok) return null;
  // Engine 5dfeb0b6 (feat-20260608-scene-nesting-ecs-fication) ECS-fied
  // SceneInstance: `world.sceneInstances` is gone. `assets.instantiate` now
  // returns the synthetic-root Entity directly (a fresh entity with identity
  // Transform + a `SceneInstance` component carrying source/mapping/state).
  // The localId -> Entity map lives on `SceneInstance.mapping` (Uint32Array).
  // setSceneAssetResolver is no longer needed — shared-ref resolution is
  // wired by AssetRegistry.instantiate itself.
  // engine e53f4616: catalog the scene payload (Err on re-enter collision is
  // harmless — payload is identical). `loadByGuid` now returns the PAYLOAD;
  // `instantiate` still wants a Handle, so mint one via `world.allocSharedRef`.
  assets.catalog<SceneAsset>(sceneGuid.value, sceneAsset);
  const payloadRes = await assets.loadByGuid<SceneAsset>(sceneGuid.value);  if (!payloadRes.ok) { console.error('[game] scene loadByGuid failed:', payloadRes.error); return null; }
  const sceneHandle = world.allocSharedRef<'SceneAsset', SceneAsset>('SceneAsset', payloadRes.value);
  const instRes = assets.instantiate<SceneAsset>(sceneHandle, world);
  if (!instRes.ok) { console.error('[game] scene instantiate failed:', (instRes.error as { code?: string })?.code); return null; }
  const synthRoot = instRes.value as Entity;
  const sceneInst = world.get(synthRoot, SceneInstance);
  if (!sceneInst.ok) { console.error('[game] SceneInstance lookup failed on synthetic root'); return null; }
  // Project the Uint32Array `mapping[localId] = entity` into the Map<localId,
  // Entity> shape every cow-survivor caller (setupPlayerRoot / blocker scan /
  // enemy targeting) reads from.
  const mapping = new Map<number, Entity>();
  const arr = sceneInst.value.mapping;
  for (let localId = 0; localId < arr.length; localId++) {
    const e = arr[localId] as Entity;
    if (e !== 0) mapping.set(localId, e);
  }
  return { mapping, nodes: packNodes, synthRoot };
}

// ── thick invisible ground collider (top at y=0) ─────────────────────────
function spawnGroundCollider(ctx: Parameters<GameEntry>[0]): void {
  ctx.world.spawn(
    { component: Transform, data: { posX: 0, posY: -5, posZ: 0 } },
    { component: RigidBody, data: { type: RigidBodyTypeValue.static } },
    { component: Collider, data: { shape: ColliderShapeValue.cuboid, halfExtentsX: 60, halfExtentsY: 5, halfExtentsZ: 60, friction: 0.9, restitution: 0 } },
  );
}

// ── add static physics to authored steles + Blocker_ props (enemies/players bounce off) ─
// Physics ⊥ visuals decoupling: the scene-pack nodes already render the visible
// cubes; addComponent-ing a RigidBody onto an already-instantiated scene entity does
// NOT reliably get picked up by rapier's physics-system (it built them as bodyless).
// So instead we spawn a SEPARATE invisible static collider entity at each blocker's
// position (same pattern as spawnGroundCollider). Stele + Blocker_ both go this way.
// Returns both the soft-push circles AND the spawned collider entities so a
// level transition can despawn the physics bodies along with the scene.
function attachBlockerPhysics(
  ctx: Parameters<GameEntry>[0],
  loaded: LoadedScene,
): { blockers: Array<{ cx: number; cz: number; r: number }>; colliders: Entity[] } {
  const blockers: Array<{ cx: number; cz: number; r: number }> = [];
  const colliders: Entity[] = [];
  for (const n of loaded.nodes) {
    const nm = (n.components.Name as { value?: string } | undefined)?.value;
    if (!nm || !(nm.startsWith('Stele') || nm.startsWith('Blocker_'))) continue;
    const t = (n.components.Transform ?? {}) as Record<string, number>;
    const cx = t.posX ?? 0;
    const cy = t.posY ?? 0.5;
    const cz = t.posZ ?? 0;
    const hx = Math.abs(t.scaleX ?? 1) * 0.5;
    const hy = Math.abs(t.scaleY ?? 1) * 0.5;
    const hz = Math.abs(t.scaleZ ?? 1) * 0.5;
    // Slightly pad the physics collider so the visible cube's outer face really
    // blocks; walkBlockers uses a rotation-agnostic diagonal radius for soft push.
    const PAD = 1.05;
    const c = ctx.world.spawn(
      { component: Transform, data: { posX: cx, posY: cy, posZ: cz } },
      { component: RigidBody, data: { type: RigidBodyTypeValue.static } },
      { component: Collider, data: {
        shape: ColliderShapeValue.cuboid,
        halfExtentsX: hx * PAD, halfExtentsY: hy * PAD, halfExtentsZ: hz * PAD,
        friction: 0.7, restitution: 0.2,
      } },
    ).unwrap();
    colliders.push(c);
    blockers.push({ cx, cz, r: Math.hypot(hx, hz) * PAD });
  }
  return { blockers, colliders };
}

const PLAYER_Y = 0.75;

// The scene pack carries only a Transform-only `Player` spawn MARKER; the
// character's lowpoly assembly lives in assets/characters/player.pack.json
// (editable in the Studio editor like any monster asset). Physics goes on the
// marker root; the visual parts hang off it via ChildOf.
function setupPlayerRoot(
  ctx: Parameters<GameEntry>[0],
  root: Entity,
  visual: PackVisual | null,
): Array<{ e: Entity; sx: number; sy: number; sz: number }> {
  const { world } = ctx;
  world.addComponent(root, { component: RigidBody, data: { type: RigidBodyTypeValue.kinematic } });
  world.addComponent(root, { component: Collider, data: { shape: ColliderShapeValue.capsule, radius: 0.35, halfHeight: 0.4 } });
  return visual ? spawnPackVisual(ctx, root, visual) : [];
}

const start: GameEntry = async (ctx) => {
  const { world, registerUpdate } = ctx;

  const canvas = document.querySelector<HTMLCanvasElement>('#app')!;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  const aspect = canvas.width / canvas.height || 1;

  // ── persistent world setup (survives level transitions) ────────────────
  // T2: install custom render pipeline that runs the URP forward chain plus a
  // trailing cinema-post fullscreen pass (vignette + chromatic aberration +
  // micro radial blur) — see src/render-pipeline.ts. Runs after createApp
  // resolves but before any scene loads, so the very first frame is composed
  // through the cinema pass.
  // Custom cow pipeline (cinema-post) DISABLED 2026-06-14: the engine upgrade
  // to CSM (#387) changed swap-chain attachment format; cinema-post's "@location(0)
  // -> swap-chain" path raises "RenderPipeline not compatible with RenderPassEncoder"
  // every frame ('limit-exceeded' bucket). Falling back to the engine's DEFAULT
  // forgeax::urp pipeline (the same one ✎ Edit renders through) so Play matches
  // Edit and shadows / skybox / tonemap / fxaa all work. Cost: loses cinema-post
  // (vignette + chromatic aberration) — re-enable once render-pipeline.ts ports
  // the urp v18 swap-chain copy pattern (recordFxaaPass-style final write).
  void installCowSurvivorPipeline;
  spawnGroundCollider(ctx);
  const skylight = await installHdrSky(ctx);

  // ── per-level state (rebound by loadLevel on every stage transition) ───
  let levelIdx = 0;
  let levelElapsed = 0;
  let transitioning = false;
  let sceneRoot: Entity | null = null;
  let walkBlockers: Array<{ cx: number; cz: number; r: number }> = [];
  let blockerColliders: Entity[] = [];
  let player!: Entity;
  let bodyParts: Array<{ e: Entity; sx: number; sy: number; sz: number }> = [];
  let px = 0, pz = 0;

  // ── camera (twin-view: top-down ⇄ FPS) ─────────────────────────────────
  const TOP_DY = 18, TOP_DZ = 12;
  const CAM_FOLLOW = 7;
  const EYE = 0.55;
  const topPitch = -Math.atan2(TOP_DY, TOP_DZ);
  const topQ = quat.create();
  quat.fromAxisAngle(topQ, [1, 0, 0], topPitch);
  let camX = px, camZ = pz + TOP_DZ;
  const camera = world.spawn(
    { component: Transform, data: { posX: camX, posY: TOP_DY, posZ: camZ, quatX: topQ[0]!, quatY: topQ[1]!, quatZ: topQ[2]!, quatW: topQ[3]! } },
    // T1 visual upgrade:
    //   • ACES filmic tonemap for cinematic dark scenes (vs the muddier reinhard)
    //   • MSAA replaces FXAA — low-poly cube edges read crisp instead of fuzzy
    //   • bloom threshold lowered + intensity bumped so emissives genuinely glow
    //     (lightning arcs / boss aura / lanterns / monster eyes)
    // clearR/G/B = visible sky on WebKit (the desktop app can't render the
    // cubemap skybox; without this the background is black). Moody dusk-blue;
    // linear/pre-ACES. On Chromium the cubemap skybox draws over it.
    { component: Camera, data: { ...perspective({ fov: Math.PI / 3, aspect, near: 0.1, far: 220 }), tonemap: TONEMAP_ACES_FILMIC, bloom: BLOOM_DISABLED, antialias: ANTIALIAS_MSAA, clearR: 0.16, clearG: 0.2, clearB: 0.34 } },
  ).unwrap();

  // ── one warm point light that follows the player (D2 atmospheric spot) ─
  const playerLight = world.spawn(
    { component: Transform, data: { posX: px, posY: 4, posZ: pz } },
    { component: PointLight, data: { colorR: 1, colorG: 0.55, colorB: 0.35, intensity: 12, range: 6 } },
  ).unwrap();

  // ── game systems ───────────────────────────────────────────────────────
  // Monster + character appearance packs (assets/monsters|characters/*.pack.json
  // — editable in the Studio editor) must land before EnemyManager bakes
  // palette materials / the first level assembles the player.
  await loadMonsterVisuals(import.meta.url);
  const playerVisual = await loadCharacterVisual(import.meta.url, 'player');
  if (!playerVisual) console.warn('[game] assets/characters/player.pack.json missing — player will be invisible');
  // E1 — load effect assets (assets/effects/*.fx.json). The FX system reads
  // initial paramValues + pool sizes + default lifetime/scale from these
  // files so a designer can tweak fx without recompiling.
  const effectAssets = await loadEffectAssets(import.meta.url);
  const enemies = new EnemyManager(ctx);
  const fx = new FxSystem(ctx, effectAssets);
  const weapons = new WeaponSystem(ctx, fx);
  const gems = new GemSystem(ctx);
  const sfx = new SfxSystem();
  const picker = installUpgradeUI();

  // Start the player with the pistol
  // E1+ — start with the four shader-driven weapons equipped so the new
  // custom-shader visuals (fire trail / ice shard / lightning bolt /
  // pistol) are immediately visible in the run, instead of gated behind
  // random level-up draws. Pick-up upgrades stack damage/cooldown/etc on
  // top of these.
  weapons.acquire('pistol');
  weapons.acquire('fire');
  weapons.acquire('ice');
  weapons.acquire('chain');

  // ── state ──────────────────────────────────────────────────────────────
  let mode: ViewMode = 'topdown';
  let score = 0;
  let kills = 0;
  let combo = 0;
  let comboTimer = 0;
  const COMBO_WINDOW = 2.5;
  let elapsed = 0;
  let hp = 100;
  let maxHp = 100;
  let level = 1;
  let xp = 0;
  let xpMax = xpForLevel(1);
  let invuln = 0;     // i-frames after a hit
  let paused = false; // upgrade picker is open
  let speedBonus = 1; // upgrade multiplier
  let playerSlowUntil = 0; // toxic-cow contact slow timer (s)
  let gameOver = false;
  let locked = false;

  // ── pointer-lock + FPS controls (forward — used by setMode below) ─────
  const realRequestLock = HTMLElement.prototype.requestPointerLock;
  // requestPointerLock() returns a Promise that REJECTS asynchronously when the
  // window lacks focus (`WrongDocumentError` — common in WKWebView desktop).
  // try/catch can't catch a rejected Promise → unhandled rejection. Wrap: focus-
  // gate (skip if unfocused; next focused click re-locks) + swallow rejection.
  const safeRequestLock = (el: HTMLElement): void => {
    try {
      if (!document.hasFocus()) { try { window.focus(); } catch { /* ignore */ } }
      // Do NOT bail on !document.hasFocus(): in the Tauri desktop WKWebView an
      // embedded iframe often doesn't report focus synchronously on the click
      // gesture, so bailing skipped requestPointerLock entirely — no lock AND no
      // pointerlockerror, so the native-grab fallback never fired either and the
      // cursor stayed free to wander off-window. Always attempt the lock; the
      // promise rejection is swallowed below and a real denial still surfaces
      // through the pointerlockerror handler.
      const r = realRequestLock.call(el) as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
    } catch { /* error handler will retry */ }
  };
  const postCapture = (capture: boolean) => {
    try { window.parent.postMessage({ type: 'fx-pointer-capture', capture }, '*'); } catch { /* not embedded */ }
  };
  // Forward declarations: `hud` and `setLocked` are referenced by closures
  // (setMode, pointer-lock handlers) but their concrete values are only
  // assigned after `installHud`. We split the binding from the assignment so
  // TS sees them as definitely-assigned before any closure can RUN them.
  let hud!: ReturnType<typeof installHud>;
  const setLocked = (v: boolean) => {
    locked = v;
    canvas.style.cursor = v ? 'none' : (mode === 'fps' ? 'crosshair' : '');
    hud.setLockStatus(v ? '🎮 已锁定 · ESC 释放' : '🖱️ 点击锁定鼠标');
  };

  // ── HUD ────────────────────────────────────────────────────────────────
  const setMode = (m: ViewMode) => {
    mode = m;
    hud.setMode(m);
    // hide body parts in FPS so they don't block the eye-cam
    for (const p of bodyParts) {
      world.set(p.e, Transform, m === 'fps'
        ? { scaleX: 0, scaleY: 0, scaleZ: 0 }
        : { scaleX: p.sx, scaleY: p.sy, scaleZ: p.sz });
    }
    canvas.style.cursor = m === 'fps' ? 'crosshair' : '';
    if (m !== 'fps' && locked) {
      postCapture(false);
      try { document.exitPointerLock?.(); } catch { /* ignore */ }
      setLocked(false);
    }
  };
  hud = installHud({ initialMode: 'topdown', onToggle: () => setMode(mode === 'fps' ? 'topdown' : 'fps') });

  // Detect Tauri once (WKWebView denies the web Pointer Lock API for embedded
  // content; we use the native cursor-grab path via parent postMessage).
  // Hoisted above applyCard/setMode so closures referencing it can run before
  // the rest of the pointer-lock block below.
  const isTauri = !!(window as unknown as { __TAURI__?: unknown }).__TAURI__
               || !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

  // ── upgrade flow ───────────────────────────────────────────────────────
  const ownedWeapons = (): Set<WeaponKind> => new Set(weapons.loadout.map((w) => w.def.kind));
  // When the upgrade picker opens we have to RELEASE pointer-lock so the
  // mouse cursor reappears and can click the cards. After the player picks,
  // if they were locked in FPS before, we silently re-lock. Tracked here so
  // gainXp() can decide whether to release, and applyCard() whether to re-lock.
  let wasLockedBeforePicker = false;
  const applyCard = (c: UpgradeCard) => {
    if (c.id.startsWith('weapon:')) {
      const k = c.id.split(':')[1] as WeaponKind;
      weapons.acquire(k);
    } else {
      switch (c.id) {
        case 'stat:damage':    weapons.damageMul *= 1.2; break;
        case 'stat:cooldown':  weapons.cooldownMul *= 0.85; break;
        case 'stat:bullets':   weapons.bulletMul += 1; break;
        case 'stat:speed':     speedBonus *= 1.15; break;
        case 'stat:heal': {
          hp = maxHp;
          hud.setHp(hp, maxHp);
          popupAt('+HP', px, 1.8, pz, { color: '#80ff90', size: 26, weight: 800, glow: 'rgba(120,255,140,0.7)' });
          sfx.playPickup('T2');
          break;
        }
      }
    }
    picker.hide();
    paused = false;
    hud.banner('LEVEL UP!', '#ffe080', 700);
    sfx.playLevelUp();
    // Re-engage pointer-lock if the player was locked into FPS before the
    // picker opened. We can't call requestPointerLock from a click on the
    // upgrade card directly (different element + Chromium may flake), so
    // we use the SAME canvas-click path the player already uses to lock.
    // Web: prototype-method bypass. Tauri: postMessage path. Both happen
    // INSIDE the click event the card just dispatched → counts as a user
    // gesture, lock should succeed.
    if (wasLockedBeforePicker && mode === 'fps') {
      if (isTauri) {
        postCapture(true);
        setLocked(true);
      } else {
        safeRequestLock(canvas);
      }
    }
    wasLockedBeforePicker = false;
  };
  picker.pickedCallback = applyCard;

  // ── boss cinematic hooks (warning at T-4s, spawn arrival banner) ─────────
  // EnemyManager fires these so main.ts can layer DOM HUD + screen shake on
  // top of the gameplay event without enemies.ts having to know about the HUD.
  enemies.onBossWarning = () => {
    hud.banner('⚠  牛王逼近…', '#ff6040', 2200);
    fx.shake(2.0, 0.8);
    sfx.playBossWarn();
  };
  enemies.onBossSpawn = (bx, bz) => {
    hud.banner('👑  牛王降临', '#ffd060', 2400);
    fx.shake(6.0, 0.6);
    // gold debris splash from where the king lands — visual "stomp"
    fx.burst(bx, 0.6, bz, 16, 'gold');
    sfx.playBossSpawn();
  };

  // hotkeys 1/2/3 for upgrade picker
  window.addEventListener('keydown', (e) => {
    if (!picker.isOpen()) return;
    if (e.key === '1' || e.key === '2' || e.key === '3') {
      const idx = parseInt(e.key, 10) - 1;
      const cards = document.querySelectorAll<HTMLDivElement>('.forgeax-card');
      if (cards[idx]) cards[idx].click();
    }
  });

  const gainXp = (amt: number) => {
    xp += amt;
    while (xp >= xpMax) {
      xp -= xpMax;
      level += 1;
      xpMax = xpForLevel(level);
      // queue an upgrade pick — pause game + release pointer-lock so the
      // mouse cursor reappears and can click the cards (FPS players were
      // locked before the level-up).
      const cards = rollUpgrades(ownedWeapons());
      picker.show(level, cards);
      paused = true;
      if (locked) {
        wasLockedBeforePicker = true;
        postCapture(false);
        try { document.exitPointerLock?.(); } catch { /* ignore */ }
        setLocked(false);
      }
    }
    hud.setLevel(level, xp, xpMax);
  };

  // ── pointer-lock event wiring (setLocked declared above) ───────────────
  document.addEventListener('pointerlockchange', () => setLocked(document.pointerLockElement === canvas));
  document.addEventListener('pointerlockerror', () => {
    if (mode !== 'fps') return;
    postCapture(true);
    setLocked(true);
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && locked) {
      postCapture(false);
      try { document.exitPointerLock?.(); } catch { /* ignore */ }
      setLocked(false);
    }
  });

  // ── input ──────────────────────────────────────────────────────────────
  const keys: Record<string, boolean> = {};
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (e.code === 'KeyV') setMode(mode === 'fps' ? 'topdown' : 'fps');
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  const LOOK_SENS = 0.0022;
  let lookYaw = 0;
  let lookPitch = 0;
  let wantManualShoot = false;
  const clampPitch = (p: number) => Math.max(-1.2, Math.min(1.2, p));
  window.addEventListener('mousemove', (e) => {
    if (mode !== 'fps' || !locked) return;
    lookYaw -= e.movementX * LOOK_SENS;
    lookPitch = clampPitch(lookPitch - e.movementY * LOOK_SENS);
  });
  canvas.addEventListener('mousedown', () => {
    // First user gesture → bring the WebAudio context online (idempotent).
    // Must happen INSIDE the click handler per Chrome/Safari autoplay policy.
    sfx.start();
    if (mode !== 'fps' || locked) return;
    if (isTauri) {
      postCapture(true);
      setLocked(true);
    } else {
      safeRequestLock(canvas);
    }
  });
  canvas.addEventListener('click', () => {
    sfx.start();    // top-down click also counts as a gesture for audio init
    if (mode === 'fps' && locked) wantManualShoot = true;
  });

  // ── projection helper (world -> canvas-CSS pixels) for floating text ───
  const FOV = Math.PI / 3;
  const project = (wx: number, wy: number, wz: number): { sx: number; sy: number } | null => {
    const camTr = world.get(camera, Transform);
    if (!camTr.ok) return null;
    const cpx = camTr.value.posX, cpy = camTr.value.posY, cpz = camTr.value.posZ;
    const qx = -camTr.value.quatX, qy = -camTr.value.quatY, qz = -camTr.value.quatZ, qw = camTr.value.quatW;
    const dx = wx - cpx, dy = wy - cpy, dz = wz - cpz;
    const tx = 2 * (qy * dz - qz * dy);
    const ty = 2 * (qz * dx - qx * dz);
    const tz = 2 * (qx * dy - qy * dx);
    const lx = dx + qw * tx + (qy * tz - qz * ty);
    const ly = dy + qw * ty + (qz * tx - qx * tz);
    const lz = dz + qw * tz + (qx * ty - qy * tx);
    if (lz >= -0.05) return null;
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    if (cssW <= 0 || cssH <= 0) return null;
    const f = 1 / Math.tan(FOV * 0.5);
    const ndcX = (lx * f) / (-lz * (cssW / cssH));
    const ndcY = (ly * f) / -lz;
    if (ndcX < -1.4 || ndcX > 1.4 || ndcY < -1.4 || ndcY > 1.4) return null;
    return { sx: (ndcX + 1) * 0.5 * cssW, sy: (1 - ndcY) * 0.5 * cssH };
  };

  const popupAt = (text: string, wx: number, wy: number, wz: number, style?: Parameters<typeof hud.floatScore>[3]) => {
    const p = project(wx, wy, wz);
    if (p) hud.floatScore(text, p.sx, p.sy, style);
  };

  // ── gameplay constants ─────────────────────────────────────────────────
  const BASE_SPEED = 6;
  const PLAYER_RADIUS = 0.35;
  const BOUND = 28;
  const JUMP_V = 6.5;
  const GRAV = 18;
  const PLAYER_HIT_R = 0.65;  // body collision against enemies

  let faceX = 0, faceZ = -1;
  let jumpY = PLAYER_Y, vy = 0, grounded = true, prevSpace = false;

  // ── level loading / transition ─────────────────────────────────────────
  const loadLevel = async (idx: number, useHost = true): Promise<boolean> => {
    const cfg = LEVELS[idx]!;
    let loaded: LoadedScene | null = null;
    const hostCtx = ctx as HostFedContext;
    // useHost: only the INITIAL boot of level 1 may reuse the host-fed
    // defaultScene (play-runtime instantiated it pre-entry). A LIVE switch
    // (Launcher VAG_SET_LEVEL) self-loads the pack — the host root was already
    // consumed/despawned, so reusing it would fail.
    if (useHost && idx === 0 && hostCtx.defaultSceneRoot !== undefined && hostCtx.defaultScene !== undefined) {
      // M3c first level: the host already resolved + instantiated the level-1
      // defaultScene before entry ran (no dual-load). Recover the LoadedScene
      // the consumers below read from the host-fed root + SceneAsset instead of
      // fetching + instantiating cfg.scenePack ourselves. synthRoot is the host
      // root so unloadLevel can despawnScene it consistently on transition.
      const hostRoot = hostCtx.defaultSceneRoot as unknown as Entity;
      const sceneInst = world.get(hostRoot, SceneInstance);
      if (!sceneInst.ok) {
        console.error('[game] SceneInstance lookup failed on host root');
      } else {
        const mapping = new Map<number, Entity>();
        const arr = sceneInst.value.mapping;
        for (let localId = 0; localId < arr.length; localId++) {
          const e = arr[localId] as Entity;
          if (e !== 0) mapping.set(localId, e);
        }
        loaded = { mapping, nodes: hostCtx.defaultScene.entities as unknown as PackNode[], synthRoot: hostRoot };
      }
    } else {
      // Level transitions (idx !== 0) and the no-host-root fallback keep the
      // original self-load path: fetch the pack + instantiate + (later)
      // despawnScene the synthetic root.
      try {
        const res = await fetch(new URL(cfg.scenePack, import.meta.url), { cache: 'no-store' });
        if (!res.ok) throw new Error(`${cfg.scenePack} ${res.status}`);
        const pack = await res.json() as ScenePack;
        loaded = await instantiateScenePack(pack, ctx);
      } catch (err) {
        console.error('[game] level scene pack unavailable:', err);
      }
    }
    if (!loaded) return false;
    sceneRoot = loaded.synthRoot;
    const bp = attachBlockerPhysics(ctx, loaded);
    walkBlockers = bp.blockers;
    blockerColliders = bp.colliders;

    const playerNode = loaded.nodes.find((n) => (n.components.Name as { value?: string } | undefined)?.value === 'Player');
    const pe = playerNode === undefined ? undefined : loaded.mapping.get(playerNode.localId);
    if (playerNode === undefined || pe === undefined) {
      console.error('[game] no Player node in level scene pack');
      return false;
    }
    player = pe;
    bodyParts = setupPlayerRoot(ctx, player, playerVisual);
    const pT = (playerNode.components.Transform ?? {}) as Record<string, number>;
    px = pT.posX ?? 0;
    pz = pT.posZ ?? 0;
    jumpY = PLAYER_Y; vy = 0; grounded = true;
    camX = px; camZ = pz + TOP_DZ;
    setMode(mode);   // re-apply FPS body-part hiding to the fresh parts

    // Level mood: ambient skylight + the warm/cold light that follows the player.
    if (skylight !== null) world.set(skylight, Skylight, { intensity: cfg.skylightIntensity });
    const [lr, lg, lb] = cfg.playerLight.color;
    world.set(playerLight, PointLight, { colorR: lr, colorG: lg, colorB: lb, intensity: cfg.playerLight.intensity, range: cfg.playerLight.range });
    world.set(playerLight, Transform, { posX: px, posY: 4, posZ: pz });

    enemies.setLevel(cfg.spawn);
    // E1 — swap scene-effect materials onto level entities whose Name
    // matches each effect's attachTo prefix (torch flame onto graveyard
    // lanterns, rune glow onto stele/altar runes).
    fx.attachSceneEffects(loaded.nodes, loaded.mapping);
    levelElapsed = 0;
    hud.setStage(idx + 1, cfg.name);
    hud.banner(cfg.name, '#ff7090', 1800);
    setTimeout(() => hud.banner(cfg.subtitle, '#80c8ff', 1400), 1800);
    return true;
  };

  // Tear down everything stage-scoped: enemies, bullets, blocker physics,
  // and the whole scene tree (player included — the next pack brings its own).
  const unloadLevel = (): void => {
    enemies.killAll();
    for (const b of [...weapons.bullets]) weapons.destroyBullet(b);
    for (const c of blockerColliders) world.despawn(c);
    blockerColliders = [];
    walkBlockers = [];
    if (sceneRoot !== null) {
      const r = world.despawnScene(sceneRoot);
      if (!r.ok) console.error('[game] despawnScene failed:', r.error);
      sceneRoot = null;
    }
  };

  const advanceLevel = (): void => {
    transitioning = true;
    if (levelIdx >= endIdx) {
      // Final stage (campaign end, or the single level the launcher picked).
      gameOver = true;
      hud.banner('🏆 通 关 ！', '#ffe080', 9000);
      sfx.playLevelUp();
      setTimeout(() => hud.banner(`最终得分 ${score} · 击杀 ${kills}`, '#80c8ff', 8000), 2400);
      return;
    }
    hud.banner(`第 ${levelIdx + 1} 关 完成！`, '#80ff90', 2000);
    sfx.playLevelUp();
    fx.shake(2, 0.4);
    setTimeout(() => {
      void (async () => {
        // Bank leftover gems as XP before the field is wiped.
        const carried = gems.collectAll().reduce((sum, ev) => sum + ev.xp, 0);
        unloadLevel();
        levelIdx += 1;
        const okLoad = await loadLevel(levelIdx);
        if (!okLoad) {
          gameOver = true;
          hud.banner('关卡加载失败…', '#ff4060', 6000);
          return;
        }
        if (carried > 0) gainXp(carried);
        transitioning = false;
      })().catch((err) => {
        console.error('[game] level transition failed:', err);
        gameOver = true;
        hud.banner('关卡加载失败…', '#ff4060', 6000);
      });
    }, 1800);
  };

  // ── launcher config (editor 启动器面板写入 play-config.json) ─────────────
  // { "mode": "campaign" }                       → full run from level 1
  // { "mode": "level", "level": "level2" }       → play THAT level only
  // { "mode": "level", "level": "level2", "endAfter": false } → start there,
  //   then continue the campaign. Missing/invalid file = campaign.
  let endIdx = LEVELS.length - 1;
  try {
    const r = await fetch(new URL('./play-config.json', import.meta.url), { cache: 'no-store' });
    if (r.ok) {
      const cfg = await r.json() as { mode?: string; level?: string; endAfter?: boolean };
      if (cfg.mode === 'level' && typeof cfg.level === 'string') {
        const i = LEVELS.findIndex((l) => l.id === cfg.level);
        if (i >= 0) {
          levelIdx = i;
          if (cfg.endAfter !== false) endIdx = i;
        }
      }
    }
  } catch { /* no launcher config → campaign */ }

  // The host (play-runtime, asset-first startup) pre-instantiates forge.json's
  // defaultScene (= level 1) into the world BEFORE entry runs. When the launcher
  // picked a DIFFERENT starting level, that level-1 scene is the wrong stage AND
  // would render UNDERNEATH the one loadLevel(idx!==0) is about to fetch (two
  // overlapping scenes → "选关了 Play 没变 / 一团乱"). Despawn the host scene so
  // a non-default pick starts clean. (idx===0 keeps the host scene — loadLevel's
  // idx===0 branch reuses it, no dual-load.)
  if (levelIdx !== 0) {
    const hostRoot0 = (ctx as HostFedContext).defaultSceneRoot;
    if (hostRoot0 !== undefined) {
      const dr = world.despawnScene(hostRoot0 as unknown as Entity);
      if (!dr.ok) console.warn('[game] despawn host defaultScene before non-default level failed:', dr.error);
    }
  }

  if (!(await loadLevel(levelIdx))) {
    console.error('[game] failed to load the first level — bailing');
    return;
  }

  // Launcher "play this level" — live in-place level switch. The editor Launcher
  // posts VAG_SET_LEVEL{level} when the user picks a level, so ▶ Play switches
  // WITHOUT reloading the game iframe (an iframe reload re-creates the WebGPU
  // context, which wedges WKWebView's GPU process — the desktop crash). We unload
  // the current stage + load the picked one in place (useHost=false: the host
  // defaultScene was already consumed at boot).
  const setLevelLive = (id: string): void => {
    const idx = LEVELS.findIndex((l) => l.id === id);
    if (idx < 0 || idx === levelIdx || transitioning || gameOver) return;
    transitioning = true;
    void (async () => {
      unloadLevel();
      levelIdx = idx;
      if (idx > endIdx) endIdx = idx;
      const ok = await loadLevel(idx, false);
      transitioning = false;
      if (!ok) { gameOver = true; hud.banner('关卡加载失败…', '#ff4060', 6000); }
    })().catch((e) => { transitioning = false; console.error('[game] live level switch failed:', e); });
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('message', (ev: MessageEvent) => {
      const d = ev.data as { type?: string; level?: string } | null;
      if (d?.type === 'VAG_SET_LEVEL' && typeof d.level === 'string') setLevelLive(d.level);
    });
  }

  // ── main update ────────────────────────────────────────────────────────
  registerUpdate((dt: number) => {
    if (gameOver || transitioning) return;
    if (paused) {
      // While picker is open, keep camera + HUD ticking but skip all gameplay
      const a = 1 - Math.exp(-CAM_FOLLOW * dt);
      camX += (px - camX) * a; camZ += (pz + TOP_DZ - camZ) * a;
      if (mode === 'topdown') {
        world.set(camera, Transform, { posX: camX, posY: TOP_DY, posZ: camZ, quatX: topQ[0]!, quatY: topQ[1]!, quatZ: topQ[2]!, quatW: topQ[3]! });
      }
      return;
    }

    elapsed += dt;
    hud.setTimer(elapsed);

    // — stage clear: survive the level's duration —
    levelElapsed += dt;
    if (levelElapsed >= LEVELS[levelIdx]!.duration) {
      advanceLevel();
      return;
    }

    // — FPS look via arrow keys (keyboard fallback) —
    if (mode === 'fps') {
      const TURN = 2.4;
      if (keys['ArrowLeft']) lookYaw += TURN * dt;
      if (keys['ArrowRight']) lookYaw -= TURN * dt;
      if (keys['ArrowUp']) lookPitch = Math.min(1.2, lookPitch + TURN * 0.6 * dt);
      if (keys['ArrowDown']) lookPitch = Math.max(-1.2, lookPitch - TURN * 0.6 * dt);
    }

    // — movement —
    const am = mode !== 'fps';
    const f = ((keys['KeyW'] || (am && keys['ArrowUp'])) ? 1 : 0) - ((keys['KeyS'] || (am && keys['ArrowDown'])) ? 1 : 0);
    const s = ((keys['KeyD'] || (am && keys['ArrowRight'])) ? 1 : 0) - ((keys['KeyA'] || (am && keys['ArrowLeft'])) ? 1 : 0);
    let mvx = 0, mvz = 0;
    if (mode === 'fps') {
      const fwdX = -Math.sin(lookYaw), fwdZ = -Math.cos(lookYaw);
      const rgtX = -fwdZ, rgtZ = fwdX;
      faceX = fwdX; faceZ = fwdZ;
      mvx = fwdX * f + rgtX * s; mvz = fwdZ * f + rgtZ * s;
    } else {
      mvx = s; mvz = -f;
      if (mvx !== 0 || mvz !== 0) {
        const l = Math.hypot(mvx, mvz);
        faceX = mvx / l; faceZ = mvz / l;
      }
    }
    if (mvx !== 0 || mvz !== 0) {
      const l = Math.hypot(mvx, mvz) || 1;
      const slowMul = playerSlowUntil > 0 ? 0.55 : 1.0;
      const step = BASE_SPEED * speedBonus * slowMul * dt;
      let nx = Math.max(-BOUND, Math.min(BOUND, px + (mvx / l) * step));
      let nz = Math.max(-BOUND, Math.min(BOUND, pz + (mvz / l) * step));
      for (const o of walkBlockers) {
        const ox = nx - o.cx, oz = nz - o.cz;
        const d = Math.hypot(ox, oz);
        const minD = PLAYER_RADIUS + o.r;
        if (d < minD) {
          if (d > 1e-4) { nx = o.cx + (ox / d) * minD; nz = o.cz + (oz / d) * minD; }
          else { nx = o.cx + minD; }
        }
      }
      px = nx; pz = nz;
    }

    // — jump —
    const space = !!keys['Space'];
    if (space && !prevSpace && grounded) { vy = JUMP_V; grounded = false; }
    prevSpace = space;
    if (!grounded) {
      vy -= GRAV * dt;
      jumpY += vy * dt;
      if (jumpY <= PLAYER_Y) { jumpY = PLAYER_Y; vy = 0; grounded = true; }
    }

    // — drive player root —
    const yaw = Math.atan2(-faceX, -faceZ);
    const q = quat.eulerY(yaw);
    world.set(player, Transform, { posX: px, posY: jumpY, posZ: pz, quatX: q[0]!, quatY: q[1]!, quatZ: q[2]!, quatW: q[3]! });
    // follow light (D2 spotlight feel)
    world.set(playerLight, Transform, { posX: px, posY: 4, posZ: pz });

    // — spawner —
    enemies.tickSpawn(dt, px, pz);
    enemies.tickAI(dt, px, pz);

    // — auto-fire all weapons —
    const nearestFn = (x: number, z: number, r?: number) => {
      const en = enemies.nearest(x, z, r ?? 22);
      return en ? { x: en.x, z: en.z } : null;
    };
    const autoFired = weapons.tickAutoFire(dt, px, jumpY + 0.5, pz, nearestFn);
    if (autoFired.length > 0) {
      fx.shake(0.6, 0.06);
      // One SFX per weapon that fired this frame.
      for (const k of autoFired) sfx.playShot(k);
    }

    // — manual fire (F or FPS click) —
    if ((wantManualShoot || keys['KeyF']) && weapons.loadout.length > 0) {
      const w = weapons.loadout[0]!;
      if (w.cooldown <= 0) {
        let dirX = faceX, dirY = 0, dirZ = faceZ;
        let oy = jumpY + 0.5;
        if (mode === 'fps') {
          const cp = Math.cos(lookPitch);
          dirX = -Math.sin(lookYaw) * cp; dirY = Math.sin(lookPitch); dirZ = -Math.cos(lookYaw) * cp;
          oy = jumpY + EYE;
        }
        const fired = weapons.fireManual(px, oy, pz, dirX, dirY, dirZ);
        if (fired) sfx.playShot(fired);
      }
    }
    wantManualShoot = false;

    // — bullet motion —
    // Grenade impacts are handled out-of-band via this callback so the AoE
    // happens on the SAME frame the grenade lands (the generic bullet↔enemy
    // proximity scan below sees the grenade get killed before it can run).
    weapons.tickBullets(dt, px, jumpY + 0.5, pz, (gx, gy, gz, gdmg, gradius) => {
      // P2: full particle-burst explosion (60+ instanced fire/smoke/spark
      // particles + ground shockwave). Replaces the old single-sphere
      // fireball + per-kill burst combo. Single call covers visual.
      fx.explosion(gx, gy + 0.2, gz, Math.max(2.0, gradius * 1.2));
      fx.shake(3.5, 0.25);
      sfx.playExplosion();
      // damage every enemy within the AoE radius
      const aoe = enemies.inRadius(gx, gz, gradius);
      for (const a of aoe) {
        const adead = enemies.damage(a, gdmg);
        const aDef = ENEMIES[a.kind];
        popupAt(Math.round(gdmg).toString(), a.x, aDef.colliderHY * 2 + 0.5, a.z,
          { color: '#ffaa40', size: 22, weight: 800, glow: 'rgba(255,150,40,0.7)' });
        if (adead) onKill(adead);
      }
    });

    // — bullet ↔ enemy collisions (proximity) ──────────────────────────────
    for (let bi = weapons.bullets.length - 1; bi >= 0; bi--) {
      const b = weapons.bullets[bi]!;
      // primary hit
      for (const en of enemies.enemies) {
        if (b.hits.has(en.e)) continue;
        const def = ENEMIES[en.kind];
        // Match enemy collider half-extents (XZ); bullet has its own ~0.5 r.
        const reach = Math.max(def.colliderHX, def.colliderHZ) + 0.4;
        const enemyTopY = (def.colliderHY + 0.05) + def.colliderHY;  // visual top
        const dx = b.x - en.x, dz = b.z - en.z;
        // bullet must be within XZ disk AND within ~vertical span of the enemy
        if (dx * dx + dz * dz <= reach * reach && b.y >= 0 && b.y <= enemyTopY + 0.6) {
          b.hits.add(en.e);
          // apply damage; crit roll
          const isCrit = Math.random() < 0.12;
          const dmg = b.damage * (isCrit ? 2.0 : 1.0);
          const dead = enemies.damage(en, dmg);
          // every bullet hit chimes a small impact tick. Cheap; perceptually
          // important — without per-hit feedback, an auto-shooter feels mute.
          sfx.playHit();
          // Chain-lightning: draw the visible bolt from the BULLET's last
          // position to the first hit target. The chain-jump loop below
          // draws bolt segments between each subsequent target, so the
          // player sees "bullet → enemy → enemy → enemy" as one connected
          // arc instead of just damage numbers popping.
          if (b.weapon === 'chain') {
            fx.lightningArc(b.x, b.z, en.x, en.z, 'purple');
            fx.lightningSpark(en.x, en.z, 1.0);
          }
          // floating damage text
          popupAt(
            (isCrit ? 'CRIT ' : '') + Math.round(dmg).toString(),
            en.x, enemyTopY + 0.6, en.z,
            isCrit
              ? { color: '#ff4060', size: 36, weight: 900, glow: 'rgba(255,80,90,0.8)', rotate: -4 }
              : { color: '#ffec80', size: 20, weight: 700, glow: 'rgba(255,200,80,0.5)' },
          );
          // AoE
          if (b.onHit === 'aoe' && b.aoeRadius > 0) {
            const aoe = enemies.inRadius(b.x, b.z, b.aoeRadius);
            for (const a of aoe) {
              if (a === en) continue;
              if (b.hits.has(a.e)) continue;
              b.hits.add(a.e);
              const ad = b.damage * 0.7;
              const adead = enemies.damage(a, ad);
              const aDef = ENEMIES[a.kind];
              popupAt(Math.round(ad).toString(), a.x, aDef.colliderHY * 2 + 0.5, a.z,
                { color: '#ffaa40', size: 18, glow: 'rgba(255,150,40,0.6)' });
              if (adead) onKill(adead);
            }
            fx.shake(2.0, 0.18);
            // Fire / grenade impact = a proper boom (per-hit AoE expansion).
            sfx.playExplosion();
          }
          // SLOW
          if (b.onHit === 'slow' && b.slowSec > 0) {
            enemies.slow(en, b.slowSec);
          }
          // CHAIN: jump to up to N other enemies in range
          if (b.onHit === 'chain' && b.chainTargets > 0) {
            const visited = new Set<Entity>([en.e]);
            let from = en;
            let remaining = b.chainTargets;
            while (remaining > 0) {
              // find nearest enemy in chainRange not yet visited
              let best: Enemy | null = null;
              let bestD = b.chainRange * b.chainRange;
              for (const c of enemies.enemies) {
                if (visited.has(c.e)) continue;
                const ddx = c.x - from.x, ddz = c.z - from.z;
                const dd = ddx * ddx + ddz * ddz;
                if (dd < bestD) { bestD = dd; best = c; }
              }
              if (!best) break;
              visited.add(best.e);
              // Draw the visible chain arc BETWEEN the previous link and
              // this one. Without this, the chain damage just pops floating
              // numbers on far enemies with no visual connection — the user
              // can't tell it's a chain lightning at all. Each call adds 3
              // emissive cube segments that shrink to zero in 0.18s, so
              // the trail of arcs reads as one connected bolt for ~0.3s.
              fx.lightningArc(from.x, from.z, best.x, best.z, 'purple');
              fx.lightningSpark(best.x, best.z, 1.0);
              const cd = b.damage * 0.6;
              const cdead = enemies.damage(best, cd);
              const cDef = ENEMIES[best.kind];
              popupAt(Math.round(cd).toString(), best.x, cDef.colliderHY * 2 + 0.5, best.z,
                { color: '#cc88ff', size: 18, glow: 'rgba(200,120,255,0.7)' });
              if (cdead) onKill(cdead);
              from = best;
              remaining -= 1;
            }
            fx.shake(1.2, 0.1);
          }
          if (dead) onKill(dead);
          fx.shake(1.0, 0.08);
          if (!b.pierce && !b.isBoomerang) {
            weapons.destroyBullet(b);
            break;
          }
        }
      }
    }

    // — enemy ↔ player collision (contact damage with i-frames) —
    if (invuln > 0) invuln -= dt;
    if (invuln <= 0) {
      for (const en of enemies.enemies) {
        const def = ENEMIES[en.kind];
        const r = Math.max(def.colliderHX, def.colliderHZ) + PLAYER_HIT_R;
        const dx = en.x - px, dz = en.z - pz;
        if (dx * dx + dz * dz <= r * r) {
          hp -= def.damage;
          hud.setHp(hp, maxHp);
          hud.damageFlash();
          fx.shake(3.0, 0.25);
          sfx.playPlayerHit();
          popupAt('-' + def.damage, px, 1.8, pz, { color: '#ff4040', size: 28, weight: 900, glow: 'rgba(255,40,40,0.7)' });
          invuln = 0.7;
          // toxic / poison contact — slow the player briefly via speedBonus
          if (def.contactSlow && def.contactSlow > 0) {
            // Apply a brief speed penalty by lowering speedBonus for ~contactSlow seconds.
            // (Stored on the closure-local `playerSlowUntil` set below.)
            playerSlowUntil = Math.max(playerSlowUntil, def.contactSlow);
          }
          // Sparkcalves (and any selfDestructOnContact) blow up on hit.
          if (def.selfDestructOnContact) {
            enemies.kill(en);
            fx.burst(en.x, 0.4, en.z, 8, en.kind === 'sparkcalf' ? 'cyan' : 'red');
            // small AoE damage to nearby enemies
            const aoe = enemies.inRadius(en.x, en.z, 1.6);
            for (const a of aoe) {
              const adead = enemies.damage(a, 12);
              if (adead) onKill(adead);
            }
          }
          if (hp <= 0) {
            gameOver = true;
            hud.banner('GAME OVER', '#ff4060', 6000);
            sfx.playGameOver();
            setTimeout(() => {
              hud.banner('刷新页面重来~', '#80c8ff', 5000);
            }, 1600);
          }
          break;
        }
      }
    }

    // — debris + shake decay + ambient swarm hum scaled by crowd density —
    fx.tickDebris(dt);
    const sh = fx.tickShake(dt);
    sfx.tickAmbient(enemies.enemies.length);

    // — xp gems: bob/magnet/collect; each pickup awards xp + popup —
    const picked = gems.tick(dt, px, jumpY, pz);
    for (const ev of picked) {
      gainXp(ev.xp);
      sfx.playPickup(ev.tier);
      const tierColor =
        ev.tier === 'BOSS' ? '#ffe070' :
        ev.tier === 'T3' ? '#d080ff' :
        ev.tier === 'T2' ? '#80c8ff' : '#80ff90';
      popupAt('+' + ev.xp + ' XP', ev.x, ev.y + 0.4, ev.z, {
        color: tierColor, size: 18, weight: 700,
        glow: 'rgba(255,255,255,0.5)', duration: 700,
      });
    }

    // — combo timeout —
    if (combo > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) {
        combo = 0;
        hud.setCombo(0);
      }
    }

    // — weapon icons cooldown —
    const states: WeaponIconState[] = weapons.loadout.map((w) => ({
      icon: w.def.icon,
      level: w.level,
      cooldownPct: Math.max(0, Math.min(1, w.cooldown / (w.def.baseCooldown * weapons.cooldownMul))),
    }));
    hud.setWeapons(states);

    // — camera —
    if (mode === 'fps') {
      const qy = quat.create(); quat.fromAxisAngle(qy, [0, 1, 0], lookYaw);
      const qx = quat.create(); quat.fromAxisAngle(qx, [1, 0, 0], lookPitch);
      const cq = quat.create(); quat.multiply(cq, qy, qx);
      world.set(camera, Transform, {
        posX: px + sh.dx, posY: jumpY + EYE + sh.dy, posZ: pz + sh.dz,
        quatX: cq[0]!, quatY: cq[1]!, quatZ: cq[2]!, quatW: cq[3]!,
      });
    } else {
      const a = 1 - Math.exp(-CAM_FOLLOW * dt);
      camX += (px - camX) * a;
      camZ += (pz + TOP_DZ - camZ) * a;
      world.set(camera, Transform, {
        posX: camX + sh.dx, posY: TOP_DY + sh.dy, posZ: camZ + sh.dz,
        quatX: topQ[0]!, quatY: topQ[1]!, quatZ: topQ[2]!, quatW: topQ[3]!,
      });
    }
  });

  // ── kill side-effects (score, drop xp gems, debris, on-death spawns) ──────
  // XP no longer lands directly — the kill drops gems via GemSystem, and the
  // player collects them by walking near. The HUD's "+N XP" popup is fired
  // from the gem-pickup event below (NOT here), so picking up each gem feels
  // independently rewarding.
  function onKill(payload: { score: number; xp: number; kind: EnemyKind; x: number; z: number }): void {
    score += payload.score;
    kills += 1;
    combo += 1;
    comboTimer = COMBO_WINDOW;
    hud.setScore(score);
    hud.setKills(kills);
    hud.setCombo(combo);
    // No per-kill ground shockwave: chain weapons can deliver 5+ kills
    // within one frame, which would saturate the 16-slot shockwave pool
    // and tile the play field with overlapping rings (the rings collapse
    // because pool params get overwritten). Shockwaves are now only spawned
    // by grenade impact + boss death (the deathFx 'big' branch below).
    // Drop xp gems at the kill point. They magnet → player when close.
    gems.dropFrom(payload);
    // popup
    popupAt('+' + payload.score, payload.x, 1.6, payload.z, {
      color: combo >= 10 ? '#ffe080' : '#ffec80',
      size: combo >= 10 ? 26 : 20,
      weight: 700, glow: 'rgba(255,200,80,0.6)',
    });
    // debris by kind (driven by ENEMIES[kind].deathFx)
    const def = ENEMIES[payload.kind];
    // Per-kill audio: bosses get the dramatic explosion + custom layered
    // hit, sparkcalves explode for real, everyone else uses the generic
    // "kill squelch". Played BEFORE the visual switch so the impact reads
    // as one event, not a stutter.
    // Per-kill death FX — each `deathFx` variant gets its OWN visual idiom
    // (fx.spark/dissipate/shatter/splash, not just colored gibs) AND its OWN
    // sound (sfx.play*Death) so the kill reads as a distinct event matching
    // the enemy's flavor. Audio is fired BEFORE the visual so the impact
    // lands as one combined sensory hit rather than a stutter.
    switch (def.deathFx) {
      case 'gem':
        // BOSS — T3 shockwave ring + wide gold splash + chunky gibs + heavy
        // shake + banner. Sound is a layered "boss spawn" (timpani) + a
        // delayed boom.
        sfx.playBossSpawn();
        setTimeout(() => sfx.playExplosion(), 180);
        // Boss kill: full particle explosion (large radius for the heavy
        // smoke + fire spread) + a gold burst. The cube-disc shockwave
        // ring was dropped to kill the "rectangular ground tile" artifact;
        // particles + screen shake convey the impact without it.
        fx.explosion(payload.x, 0.5, payload.z, 6.0);
        fx.splash(payload.x, payload.z, 'gold', 24);
        fx.burst(payload.x, 0.4, payload.z, 16, 'gold');
        fx.shake(8, 0.6);
        hud.banner('BOSS DOWN!', '#ffe080', 1600);
        break;
      case 'split':
        // BloodCow — wet split: red splash on the ground + two sparkcalves
        // spawned out of the corpse. Sound is the squelchy split-death cue.
        sfx.playSplitDeath();
        fx.splash(payload.x, payload.z, 'red', 14);
        enemies.spawn('sparkcalf', payload.x + 0.6, payload.z);
        enemies.spawn('sparkcalf', payload.x - 0.6, payload.z);
        break;
      case 'explode':
        // SparkCalf — vertical cyan spark pillar + light shake + small AoE
        // damage to nearby enemies. Sound is the high-zap death.
        sfx.playSparkDeath();
        fx.spark(payload.x, payload.z, 'cyan');
        fx.shake(1.4, 0.12);
        {
          const aoe = enemies.inRadius(payload.x, payload.z, 1.8);
          for (const a of aoe) {
            const adead = enemies.damage(a, 14);
            if (adead) onKill(adead);
          }
        }
        break;
      case 'shatter':
        // StoneBull — heavy magenta cubes fall + tumble + meaty shake. Sound
        // is layered low knocks (4 staggered booms) for "rocks landing".
        sfx.playShatterDeath();
        fx.shatter(payload.x, payload.z, 'magenta');
        fx.shake(2.5, 0.25);
        break;
      case 'cloud':
        // ToxicCow — green dissipating cloud. Slow, soft, dread-y. Sound is
        // a long band-passed hiss + low bubble pop.
        sfx.playPoisonDeath();
        fx.dissipate(payload.x, payload.z, 'green', 1.4);
        break;
      case 'wisp':
        // ShadowStalker — purple soul-pillar rising up. Sound sweeps high.
        sfx.playWispDeath();
        fx.spark(payload.x, payload.z, 'purple');
        break;
      case 'gibs':
      default:
        // GrassCalf / RagingCow — generic short red gib burst.
        sfx.playKill();
        fx.burst(payload.x, 0.4, payload.z, 6, 'red');
        break;
    }
  }
};

export default start;
