// Cow-Level Survivor — vampire-survivors-like roguelike shooter on the D2
// Cow Level vibe. Keeps the template's twin-view (top-down ⇄ FPS) intact;
// adds: enemy spawner, weapon roguelike, upgrades, kill FX, screen shake,
// floating combat text. Multi-level campaign: each stage's static scene
// lives in scenes/<level>.pack.json (✎ Edit renders the same files); the
// per-stage bestiary / lighting / pacing lives in src/levels.ts; dynamic
// gameplay lives here. Player level, weapons and upgrades carry across
// stages; the scene + spawner reset on every transition.

import {
  Transform,
  Name,
} from '@forgeax/engine-scene';
import {
  Camera,
  perspective,
  Skylight,
  SkyboxBackground,
  TONEMAP_ACES_FILMIC,
  BLOOM_DISABLED,
  ANTIALIAS_MSAA,
  PointLight,
  SceneInstance,
} from '@forgeax/engine-render';
import {
  quat,
} from '@forgeax/engine-runtime';
import { Collider, ColliderShapeValue, RigidBody, RigidBodyTypeValue } from '@forgeax/engine-physics';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { ENTITY_NULL_RAW, Time, Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
import type { BootstrapContext, GameContext } from '@forgeax/engine-app';
import { INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine-input';
import type { SceneAsset, EquirectAsset } from '@forgeax/engine-types';

// The host injects the instantiated defaultScene root + loaded SceneAsset
// onto the BootstrapContext. HostFedContext is now just an alias.
type HostFedContext = BootstrapContext;

// Narrowed context for helper functions that need world + assets.
type Sctx = { world: World; assets: import('@forgeax/engine-assets-runtime').AssetRegistry };

import { installHud, type ViewMode, type WeaponIconState } from './src/hud';
import {
  EnemyManager, ENEMIES,
  type Enemy, type EnemyKind,
} from './src/enemies';
import { LEVELS } from './src/levels';
import { installCowSurvivorPipeline } from './src/render-pipeline';
import { EFFECT_ASSETS } from './src/effects';
import { WeaponSystem, type WeaponKind } from './src/weapons';
import { installUpgradeUI, rollUpgrades, xpForLevel, type UpgradeCard } from './src/upgrades';
import { FxSystem } from './src/fx';
import { GemSystem } from './src/gems';
import { SfxSystem } from './src/sfx';

const SKY_HDR_GUID = '81eec382-392f-5a93-8998-0ecf11ef7990';
const PLAYER_SCENE_GUID = '589979d4-a0f8-4299-b057-6f2346ad4a05';

// ── HDR sky (purple-tinted D2 hell vibe; HDR texture is generic) ─────────
// Returns the Skylight entity so level transitions can re-mood the ambient
// (day vs night) with a single intensity write; null only when the world
// can't even spawn (never in practice — solid fill always renders).
//
// engine feat-20260709: the imperative `renderer.store.uploadCubemapFromEquirect`
// path is gone. Attach a shared `EquirectAsset` to `Skylight.equirect` and the
// engine lazy-projects the cubemap + IBL itself (caps-gated; degrades to the
// solid tint on WebKit/WKWebView whose WebGPU lacks the rgba16float attachment).
async function installHdrSky(ctx: Sctx): Promise<EntityHandle | null> {
  // ALWAYS spawn a solid-color Skylight first. The forgeax PBR shader computes
  // ambient=0 without a Skylight, so a lone DirectionalLight leaves shaded faces
  // black ("天光没了"). A cubemap-less Skylight binds the engine's 1×1 white
  // irradiance cube — ambient is live on the very first frame with no async GPU
  // work. Cool, moody fill until the equirect projection reports ready.
  const skylight = ctx.world.spawn(
    { component: Skylight, data: { color: [0.7, 0.78, 0.95], intensity: 0.3 } },
  ).unwrap() as EntityHandle;

  const guidRes = AssetGuid.parse(SKY_HDR_GUID);
  if (!guidRes.ok) return skylight;
  const podRes = await ctx.assets.loadByGuid<EquirectAsset>(guidRes.value);
  if (!podRes.ok) {
    console.warn('[cow] HDR sky loadByGuid failed:', (podRes.error as { code?: string }).code);
    return skylight;
  }
  const equirect = ctx.world.allocSharedRef<'EquirectAsset', EquirectAsset>('EquirectAsset', podRes.value);
  // Attach equirect → engine lazy-projects cubemap + IBL (caps permitting).
  // Lower intensity + neutral tint so the HDR drives color once projected.
  ctx.world.set(skylight, Skylight, { equirect, color: [1, 1, 1], intensity: 0.12 });
  ctx.world.spawn({ component: SkyboxBackground, data: { equirect } });
  return skylight;
}

// ── native SceneAsset loading ──────────────────────────────────────────────
interface LoadedScene {
  mapping: ReadonlyMap<number, EntityHandle>;
  scene: SceneAsset;
  /** SceneInstance synthetic root — `world.despawnScene(synthRoot)` tears the
   *  whole stage down on level transitions. */
  synthRoot: EntityHandle;
}

function mappingFromInstance(world: World, synthRoot: EntityHandle): ReadonlyMap<number, EntityHandle> | null {
  const sceneInst = world.get(synthRoot, SceneInstance);
  if (!sceneInst.ok) return null;
  const mapping = new Map<number, EntityHandle>();
  for (let localId = 0; localId < sceneInst.value.mapping.length; localId++) {
    const entity = sceneInst.value.mapping[localId]!;
    if (entity !== ENTITY_NULL_RAW) mapping.set(localId, entity as EntityHandle);
  }
  return mapping;
}

async function instantiateSceneGuid(
  ctx: Sctx,
  sceneGuid: string,
  parent?: EntityHandle,
): Promise<LoadedScene | null> {
  const guid = AssetGuid.parse(sceneGuid);
  if (!guid.ok) {
    console.error('[cow] invalid SceneAsset GUID:', sceneGuid);
    return null;
  }
  const sceneRes = await ctx.assets.loadByGuid<SceneAsset>(guid.value);
  if (!sceneRes.ok) {
    console.error('[cow] SceneAsset loadByGuid failed:', sceneGuid, sceneRes.error);
    return null;
  }
  const handle = ctx.world.allocSharedRef<'SceneAsset', SceneAsset>('SceneAsset', sceneRes.value);
  const instRes = ctx.assets.instantiate(handle, ctx.world, parent);
  if (!instRes.ok) {
    console.error('[cow] SceneAsset instantiate failed:', sceneGuid, instRes.error);
    return null;
  }
  const synthRoot = instRes.value as EntityHandle;
  const mapping = mappingFromInstance(ctx.world, synthRoot);
  if (mapping === null) {
    console.error('[cow] SceneInstance missing after instantiate:', sceneGuid);
    return null;
  }
  return { mapping, scene: sceneRes.value, synthRoot };
}

function sceneEntityByName(
  world: World,
  loaded: LoadedScene,
  name: string,
): EntityHandle | undefined {
  for (const entity of loaded.mapping.values()) {
    const named = world.get(entity, Name);
    if (named.ok && named.value.value === name) return entity;
  }
  return undefined;
}

// ── thick invisible ground collider (top at y=0) ─────────────────────────
function spawnGroundCollider(ctx: Sctx): void {
  ctx.world.spawn(
    { component: Transform, data: { pos: [0, -5, 0] } },
    { component: RigidBody, data: { type: RigidBodyTypeValue.static } },
    { component: Collider, data: { shape: ColliderShapeValue.cuboid, halfExtents: [60, 5, 60], friction: 0.9, restitution: 0 } },
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
  ctx: Sctx,
  loaded: LoadedScene,
): { blockers: Array<{ cx: number; cz: number; r: number }>; colliders: EntityHandle[] } {
  const blockers: Array<{ cx: number; cz: number; r: number }> = [];
  const colliders: EntityHandle[] = [];
  for (const entity of loaded.mapping.values()) {
    const named = ctx.world.get(entity, Name);
    const name = named.ok ? named.value.value : '';
    if (!(name.startsWith('Stele') || name.startsWith('Blocker_'))) continue;
    const transform = ctx.world.get(entity, Transform);
    if (!transform.ok) continue;
    const { pos, scale, quat: rotation } = transform.value;
    const hx = Math.abs(scale[0]) * 0.5;
    const hy = Math.abs(scale[1]) * 0.5;
    const hz = Math.abs(scale[2]) * 0.5;
    // Slightly pad the physics collider so the visible cube's outer face really
    // blocks. Preserve the authored rotation instead of making the physics proxy
    // disagree with its visual source.
    const PAD = 1.05;
    const collider = ctx.world.spawn(
      { component: Transform, data: { pos, quat: rotation } },
      { component: RigidBody, data: { type: RigidBodyTypeValue.static } },
      { component: Collider, data: {
        shape: ColliderShapeValue.cuboid,
        halfExtents: [hx * PAD, hy * PAD, hz * PAD],
        friction: 0.7, restitution: 0.2,
      } },
    ).unwrap();
    colliders.push(collider);
    blockers.push({ cx: pos[0], cz: pos[2], r: Math.hypot(hx, hz) * PAD });
  }
  return { blockers, colliders };
}

const PLAYER_Y = 0.75;

// The level SceneAsset owns a transform-only `Player` marker. Physics belongs
// on that marker; its visible child tree is the native Player SceneAsset.
async function setupPlayerRoot(
  ctx: GameContext,
  root: EntityHandle,
): Promise<Array<{ e: EntityHandle; sx: number; sy: number; sz: number }>> {
  const body = ctx.world.addComponent(root, {
    component: RigidBody,
    data: { type: RigidBodyTypeValue.kinematic },
  });
  const collider = ctx.world.addComponent(root, {
    component: Collider,
    data: { shape: ColliderShapeValue.capsule, radius: 0.35, halfHeight: 0.4 },
  });
  if (!body.ok) {
    console.error('[cow] failed to configure Player rigid body:', body.error);
    return [];
  }
  if (!collider.ok) {
    console.error('[cow] failed to configure Player collider:', collider.error);
    return [];
  }

  const visual = await instantiateSceneGuid({ world: ctx.world, assets: ctx.assets }, PLAYER_SCENE_GUID, root);
  if (visual === null) return [];

  const parts: Array<{ e: EntityHandle; sx: number; sy: number; sz: number }> = [];
  for (const entity of visual.mapping.values()) {
    const transform = ctx.world.get(entity, Transform);
    if (!transform.ok) continue;
    parts.push({
      e: entity,
      sx: transform.value.scale[0],
      sy: transform.value.scale[1],
      sz: transform.value.scale[2],
    });
  }
  return parts;
}

export async function bootstrap(world: World, ctx?: BootstrapContext) {
  // The engine-app host always supplies a BootstrapContext (renderer, assets,
  // app, registerUpdate). Bail loudly if a legacy/degenerate host omits it —
  // every system below needs assets + registerUpdate, so there is nothing
  // meaningful to run without it.
  if (!ctx) { console.error('[game] no BootstrapContext — cannot start'); return; }
  const { assets, app } = ctx;

  // The gameplay systems (EnemyManager / FxSystem / …) predate the
  // world-as-first-param bootstrap hook and still take the legacy GameContext
  // ({ world, assets, app, registerUpdate, … }). Assemble one from the world +
  // BootstrapContext so those systems (and the Sctx helpers, which only read
  // world + assets) type-check without `!` casts.
  const gameCtx: GameContext = {
    world, assets, app,
    uiRoot: ctx.uiRoot, registerCleanup: ctx.registerCleanup,
  };

  // Host-controlled UI container: the host removes it wholesale on ■ Stop so
  // every DOM overlay we mount into it disappears with the run. Fall back to
  // <body> for standalone/legacy hosts that don't inject one.
  const uiMount: HTMLElement = ctx?.uiRoot ?? (typeof document !== 'undefined' ? document.body : (undefined as never));
  // Non-DOM side effects (event listeners, AudioContext, timers) are NOT
  // reclaimed by removing the uiRoot — register each here so ■ Stop flushes
  // them (in reverse order). No-op fallback keeps standalone callers clean.
  const onCleanup = ctx?.registerCleanup ?? (() => {});

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
  spawnGroundCollider({ world, assets });
  const skylight = await installHdrSky({ world, assets });

  // ── per-level state (rebound by loadLevel on every stage transition) ───
  let levelIdx = 0;
  let levelElapsed = 0;
  let transitioning = false;
  let sceneRoot: EntityHandle | null = null;
  let walkBlockers: Array<{ cx: number; cz: number; r: number }> = [];
  let blockerColliders: EntityHandle[] = [];
  let player!: EntityHandle;
  let bodyParts: Array<{ e: EntityHandle; sx: number; sy: number; sz: number }> = [];
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
    { component: Transform, data: { pos: [camX, TOP_DY, camZ], quat: topQ } },
    // T1 visual upgrade:
    //   • ACES filmic tonemap for cinematic dark scenes (vs the muddier reinhard)
    //   • MSAA replaces FXAA — low-poly cube edges read crisp instead of fuzzy
    //   • bloom threshold lowered + intensity bumped so emissives genuinely glow
    //     (lightning arcs / boss aura / lanterns / monster eyes)
    // clearColor = visible sky on WebKit (the desktop app can't render the
    // cubemap skybox; without this the background is black). Moody dusk-blue;
    // linear/pre-ACES. On Chromium the cubemap skybox draws over it.
    { component: Camera, data: { ...perspective({ fov: Math.PI / 3, aspect, near: 0.1, far: 220 }), tonemap: TONEMAP_ACES_FILMIC, bloom: BLOOM_DISABLED, antialias: ANTIALIAS_MSAA, clearColor: [0.16, 0.2, 0.34, 1] } },
  ).unwrap();

  // ── one warm point light that follows the player (D2 atmospheric spot) ─
  const playerLight = world.spawn(
    { component: Transform, data: { pos: [px, 4, pz] } },
    { component: PointLight, data: { color: [1, 0.55, 0.35], intensity: 12, range: 6 } },
  ).unwrap();

  // ── game systems ───────────────────────────────────────────────────────
  // Visual prefabs and level scenes are loaded through GUIDs at the point they
  // are instanced. Effect tuning is runtime behavior, so it remains a typed
  // game-owned constant rather than a second JSON asset transport.
  const enemies = new EnemyManager(gameCtx);
  if (!(await enemies.prepare())) {
    console.error('[cow] required monster SceneAssets could not be loaded');
    return;
  }
  const fx = new FxSystem(gameCtx, EFFECT_ASSETS);
  const weapons = new WeaponSystem(gameCtx, fx);
  const gems = new GemSystem(gameCtx);
  const sfx = new SfxSystem();
  // AudioContext creation must happen inside the browser gesture. This listener
  // owns audio activation only; movement and pointer lock remain exclusively in
  // the engine input backend.
  const enableAudio = () => { sfx.start(); };
  canvas.addEventListener('pointerdown', enableAudio, { once: true });
  onCleanup(() => {
    canvas.removeEventListener('pointerdown', enableAudio);
    sfx.dispose();
  });
  const picker = installUpgradeUI(uiMount);
  onCleanup(() => picker.dispose());

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

  // The host input backend is the sole pointer-lock owner. Cow merely gates
  // lock eligibility by view mode and consumes the frozen InputSnapshot.
  let hud!: ReturnType<typeof installHud>;

  // ── HUD ────────────────────────────────────────────────────────────────
  const setMode = (m: ViewMode) => {
    mode = m;
    hud.setMode(m);
    // hide body parts in FPS so they don't block the eye-cam
    for (const p of bodyParts) {
      world.set(p.e, Transform, m === 'fps'
        ? { scale: [0, 0, 0] }
        : { scale: [p.sx, p.sy, p.sz] });
    }
    ctx.setPointerLockAllowed?.(m === 'fps');
  };
  ctx.setPointerLockAllowed?.(false);
  hud = installHud({ initialMode: 'topdown', onToggle: () => setMode(mode === 'fps' ? 'topdown' : 'fps'), mount: uiMount });
  onCleanup(() => hud.dispose());

  // ── upgrade flow ───────────────────────────────────────────────────────
  const ownedWeapons = (): Set<WeaponKind> => new Set(weapons.loadout.map((w) => w.def.kind));
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
    // Re-enable the host input gate. Its next canvas click is the only place
    // pointer lock may be requested, preserving browser gesture semantics.
    ctx.setPointerLockAllowed?.(mode === 'fps');
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

  const gainXp = (amt: number) => {
    xp += amt;
    while (xp >= xpMax) {
      xp -= xpMax;
      level += 1;
      xpMax = xpForLevel(level);
      // Pause gameplay and revoke the host input gate so the upgrade cards can
      // receive pointer input. The backend releases any active lock itself.
      const cards = rollUpgrades(ownedWeapons());
      picker.show(level, cards);
      paused = true;
      ctx.setPointerLockAllowed?.(false);
    }
    hud.setLevel(level, xp, xpMax);
  };

  // ── input ──────────────────────────────────────────────────────────────
  const LOOK_SENS = 0.0022;
  let lookYaw = 0;
  let lookPitch = 0;
  const clampPitch = (pitch: number) => Math.max(-1.2, Math.min(1.2, pitch));
  const inputSnapshot = (): InputSnapshot | null => {
    try {
      return world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
    } catch {
      return null;
    }
  };

  // ── projection helper (world -> canvas-CSS pixels) for floating text ───
  const FOV = Math.PI / 3;
  const project = (wx: number, wy: number, wz: number): { sx: number; sy: number } | null => {
    const camTr = world.get(camera, Transform);
    if (!camTr.ok) return null;
    const cpx = camTr.value.pos[0], cpy = camTr.value.pos[1], cpz = camTr.value.pos[2];
    const qx = -camTr.value.quat[0], qy = -camTr.value.quat[1], qz = -camTr.value.quat[2], qw = camTr.value.quat[3];
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
    // The host has already instanced the chosen initial SceneAsset. Reuse it
    // only when it matches Cow's requested level; every subsequent transition
    // uses the same catalog GUID → loadByGuid → instantiate path.
    if (useHost && hostCtx.defaultSceneRoot !== undefined && hostCtx.defaultScene !== undefined) {
      // BootstrapContext intentionally carries a SceneAsset payload, not its GUID.
      // Re-resolve the expected level through the same registry and compare payload
      // identity; a match proves the host pre-instanced precisely this level.
      const expectedGuid = AssetGuid.parse(cfg.sceneGuid);
      if (expectedGuid.ok) {
        const expected = await assets.loadByGuid<SceneAsset>(expectedGuid.value);
        if (expected.ok && expected.value === hostCtx.defaultScene) {
          const synthRoot = hostCtx.defaultSceneRoot as EntityHandle;
          const mapping = mappingFromInstance(world, synthRoot);
          if (mapping !== null) loaded = { mapping, scene: hostCtx.defaultScene, synthRoot };
        }
      }
    }
    if (loaded === null) {
      // A host-instanced but different initial scene must not remain underneath
      // Cow's requested stage.
      if (useHost && hostCtx.defaultSceneRoot !== undefined) {
        const discarded = world.despawnScene(hostCtx.defaultSceneRoot as EntityHandle);
        if (!discarded.ok) console.warn('[cow] failed to discard unmatched host scene:', discarded.error);
      }
      loaded = await instantiateSceneGuid({ world, assets }, cfg.sceneGuid);
    }
    if (!loaded) return false;
    sceneRoot = loaded.synthRoot;
    const bp = attachBlockerPhysics(gameCtx, loaded);
    walkBlockers = bp.blockers;
    blockerColliders = bp.colliders;

    const playerEntity = sceneEntityByName(world, loaded, 'Player');
    if (playerEntity === undefined) {
      console.error('[game] no Player marker in SceneAsset:', cfg.sceneGuid);
      return false;
    }
    player = playerEntity;
    bodyParts = await setupPlayerRoot(gameCtx, player);
    const playerTransform = world.get(player, Transform);
    px = playerTransform.ok ? playerTransform.value.pos[0] : 0;
    pz = playerTransform.ok ? playerTransform.value.pos[2] : 0;
    jumpY = PLAYER_Y; vy = 0; grounded = true;
    camX = px; camZ = pz + TOP_DZ;
    setMode(mode);   // re-apply FPS body-part hiding to the fresh parts

    // Level mood: ambient skylight + the warm/cold light that follows the player.
    if (skylight !== null) world.set(skylight, Skylight, { intensity: cfg.skylightIntensity });
    const [lr, lg, lb] = cfg.playerLight.color;
    world.set(playerLight, PointLight, { color: [lr, lg, lb], intensity: cfg.playerLight.intensity, range: cfg.playerLight.range });
    world.set(playerLight, Transform, { pos: [px, 4, pz] });

    enemies.setLevel(cfg.spawn);
    // Swap scene-effect materials onto native scene members whose Name matches
    // each effect's game-owned binding rule.
    fx.attachSceneEffects(loaded.mapping.values());
    levelElapsed = 0;
    hud.setStage(idx + 1, cfg.name);
    hud.banner(cfg.name, '#ff7090', 1800);
    setTimeout(() => hud.banner(cfg.subtitle, '#80c8ff', 1400), 1800);
    return true;
  };

  // Deaths are staged so collision scans never structurally mutate the live
  // enemy collection. Level teardown clears the queue before dropping its scene.
  const pendingDeaths = new Map<EntityHandle, Enemy>();

  // Tear down everything stage-scoped: enemies, bullets, blocker physics,
  // and the whole scene tree (player included — the next pack brings its own).
  const unloadLevel = (): void => {
    pendingDeaths.clear();
    enemies.killAll();
    for (const bullet of [...weapons.bullets]) weapons.destroyBullet(bullet);
    gems.clear();
    fx.clearTransient();
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

  // The host decides which native SceneAsset is initially instanced. Cow owns
  // only the mapping from that scene to campaign behavior: an editor-selected
  // non-default Cow level is a one-level run; the campaign default continues
  // through every configured level. No game-side play-config file is read.
  let endIdx = LEVELS.length - 1;
  if (ctx.defaultScene !== undefined) {
    const selected = await Promise.all(LEVELS.map(async (candidate) => {
      const guid = AssetGuid.parse(candidate.sceneGuid);
      if (!guid.ok) return -1;
      const loaded = await assets.loadByGuid<SceneAsset>(guid.value);
      return loaded.ok && loaded.value === ctx.defaultScene ? LEVELS.indexOf(candidate) : -1;
    }));
    const selectedIdx = selected.find((idx) => idx >= 0);
    if (selectedIdx !== undefined) {
      levelIdx = selectedIdx;
      if (levelIdx !== 0) endIdx = levelIdx;
    }
  }

  if (!(await loadLevel(levelIdx))) {
    console.error('[game] failed to load the first level — bailing');
    return;
  }

  // Launcher "play this scene" — live in-place scene switch. The editor only
  // forwards a GUID; Cow owns whether that scene is a level and what switching it
  // means for campaign state.
  const setLevelLive = (sceneGuid: string): void => {
    const idx = LEVELS.findIndex((level) => level.sceneGuid === sceneGuid);
    if (idx < 0 || idx === levelIdx || transitioning || gameOver) return;
    transitioning = true;
    void (async () => {
      unloadLevel();
      levelIdx = idx;
      endIdx = idx;
      const ok = await loadLevel(idx, false);
      transitioning = false;
      if (!ok) { gameOver = true; hud.banner('关卡加载失败…', '#ff4060', 6000); }
    })().catch((e) => { transitioning = false; console.error('[game] live level switch failed:', e); });
  };
  if (typeof window !== 'undefined') {
    const onLauncherMessage = (ev: MessageEvent) => {
      const d = ev.data as { type?: string; sceneGuid?: string } | null;
      if (d?.type === 'VAG_SET_LEVEL' && typeof d.sceneGuid === 'string') setLevelLive(d.sceneGuid);
    };
    window.addEventListener('message', onLauncherMessage);
    onCleanup(() => window.removeEventListener('message', onLauncherMessage));
  }

  // ── main update ────────────────────────────────────────────────────────
  const queueDeath = (enemy: Enemy, payload: ReturnType<typeof enemies.damage>): void => {
    if (payload !== null) pendingDeaths.set(enemy.e, enemy);
  };
  const flushDeaths = (): void => {
    while (pendingDeaths.size > 0) {
      const deaths = [...pendingDeaths.values()];
      pendingDeaths.clear();
      for (const enemy of deaths) {
        const def = ENEMIES[enemy.kind];
        const payload = { score: def.score, xp: def.xp, kind: enemy.kind, x: enemy.x, z: enemy.z };
        enemies.finalizeKill(enemy);
        onKill(payload);
      }
    }
  };

  world.addSystem(Update, { name: 'cow-survivor-update', queries: [], fn: () => {
    const dt = world.getResource(Time).delta;
    if (gameOver || transitioning) return;
    if (paused) {
      // While picker is open, keep camera + HUD ticking but skip all gameplay
      const a = 1 - Math.exp(-CAM_FOLLOW * dt);
      camX += (px - camX) * a; camZ += (pz + TOP_DZ - camZ) * a;
      if (mode === 'topdown') {
        world.set(camera, Transform, { pos: [camX, TOP_DY, camZ], quat: topQ });
      }
      return;
    }

    elapsed += dt;
    playerSlowUntil = Math.max(0, playerSlowUntil - dt);
    hud.setTimer(elapsed);

    // — stage clear: survive the level's duration —
    levelElapsed += dt;
    if (levelElapsed >= LEVELS[levelIdx]!.duration) {
      advanceLevel();
      return;
    }

    const input = inputSnapshot();
    const keyDown = (key: string): boolean => input?.keyboard.down(key) ?? false;
    const mouse = input?.mouse;
    if (mode === 'fps') {
      hud.setLockStatus(mouse?.pointerLocked ? '🎮 已锁定 · ESC 释放' : '🖱️ 点击锁定鼠标');
    }

    // The backend owns lock state and pointer deltas. Cow only interprets them
    // when FPS mode is active.
    if (mode === 'fps') {
      const delta = mouse?.movementDelta ?? { x: 0, y: 0 };
      if (mouse?.pointerLocked) {
        lookYaw -= delta.x * LOOK_SENS;
        lookPitch = clampPitch(lookPitch - delta.y * LOOK_SENS);
      }
      const turn = 2.4;
      if (keyDown('ArrowLeft')) lookYaw += turn * dt;
      if (keyDown('ArrowRight')) lookYaw -= turn * dt;
      if (keyDown('ArrowUp')) lookPitch = clampPitch(lookPitch + turn * 0.6 * dt);
      if (keyDown('ArrowDown')) lookPitch = clampPitch(lookPitch - turn * 0.6 * dt);
    }

    // — movement —
    const topDown = mode !== 'fps';
    const forward = (keyDown('w') || (topDown && keyDown('ArrowUp')) ? 1 : 0)
      - (keyDown('s') || (topDown && keyDown('ArrowDown')) ? 1 : 0);
    const strafe = (keyDown('d') || (topDown && keyDown('ArrowRight')) ? 1 : 0)
      - (keyDown('a') || (topDown && keyDown('ArrowLeft')) ? 1 : 0);
    let mvx = 0, mvz = 0;
    if (mode === 'fps') {
      const fwdX = -Math.sin(lookYaw), fwdZ = -Math.cos(lookYaw);
      const rgtX = -fwdZ, rgtZ = fwdX;
      faceX = fwdX; faceZ = fwdZ;
      mvx = fwdX * forward + rgtX * strafe; mvz = fwdZ * forward + rgtZ * strafe;
    } else {
      mvx = strafe; mvz = -forward;
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
    const space = keyDown(' ');
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
    world.set(player, Transform, { pos: [px, jumpY, pz], quat: q });
    // follow light (D2 spotlight feel)
    world.set(playerLight, Transform, { pos: [px, 4, pz] });

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

    // — manual fire (F or a host-reported locked primary click) —
    const manualShoot = keyDown('f') || (mode === 'fps' && !!mouse?.pointerLocked && mouse.button(0));
    if (manualShoot && weapons.loadout.length > 0) {
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
        queueDeath(a, adead);
      }
    });

    // — bullet ↔ enemy collisions (proximity) ──────────────────────────────
    for (let bi = weapons.bullets.length - 1; bi >= 0; bi--) {
      const b = weapons.bullets[bi]!;
      // primary hit
      for (const en of enemies.enemies) {
        if (en.dead || b.hits.has(en.e)) continue;
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
              queueDeath(a, adead);
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
            const visited = new Set<EntityHandle>([en.e]);
            let from = en;
            let remaining = b.chainTargets;
            while (remaining > 0) {
              // find nearest enemy in chainRange not yet visited
              let best: Enemy | null = null;
              let bestD = b.chainRange * b.chainRange;
              for (const c of enemies.enemies) {
                if (c.dead || visited.has(c.e)) continue;
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
              queueDeath(best, cdead);
              from = best;
              remaining -= 1;
            }
            fx.shake(1.2, 0.1);
          }
          queueDeath(en, dead);
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
        if (en.dead) continue;
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
            en.dead = true;
            pendingDeaths.set(en.e, en);
            fx.burst(en.x, 0.4, en.z, 8, en.kind === 'sparkcalf' ? 'cyan' : 'red');
            // small AoE damage to nearby enemies
            const aoe = enemies.inRadius(en.x, en.z, 1.6);
            for (const a of aoe) {
              const adead = enemies.damage(a, 12);
              queueDeath(a, adead);
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

    // Commit deaths only after every traversal over `enemies.enemies` completes.
    // Death side-effects may queue additional deaths, so drain to a fixed point.
    flushDeaths();

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
        pos: [px + sh.dx, jumpY + EYE + sh.dy, pz + sh.dz],
        quat: cq,
      });
    } else {
      const a = 1 - Math.exp(-CAM_FOLLOW * dt);
      camX += (px - camX) * a;
      camZ += (pz + TOP_DZ - camZ) * a;
      world.set(camera, Transform, {
        pos: [camX + sh.dx, TOP_DY + sh.dy, camZ + sh.dz],
        quat: topQ,
      });
    }
  }});

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
            queueDeath(a, adead);
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
}
