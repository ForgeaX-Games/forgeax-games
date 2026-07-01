// ============================================================================
//  SECTOR STRIKE — a Call-of-Duty-like first-person shooter (forgeax-engine).
//
//  Everything you see is ECS entities driven by WebGPU PBR: a moody industrial
//  arena, humanoid soldiers, a 4-weapon loadout with per-gun viewmodels, ADS,
//  recoil, tracers, muzzle flashes and dynamic lighting. Only the flat HUD
//  (crosshair / ammo / hitmarkers) lives in the DOM, the way every FPS does.
//
//  Controls
//    Click / hold   fire            Right-mouse   aim down sights (ADS)
//    WASD           move            Shift         sprint
//    Mouse          look            R             reload
//    1 2 3 4 / Q    switch weapon   wheel         cycle weapon
// ============================================================================

import {
  Transform,
  MeshFilter,
  MeshRenderer,
  Camera,
  PointLight,
  Skylight,
  SkyboxBackground,
  SKYBOX_MODE_CUBEMAP,
  TONEMAP_ACES_FILMIC,
  perspective,
  Materials,
  quat,
  HANDLE_CUBE,
  createSphereGeometry,
  createCylinderGeometry,
  type MaterialAsset,
} from '@forgeax/engine-runtime';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import type { TextureAsset } from '@forgeax/engine-types';
import type { Entity, World } from '@forgeax/engine-ecs';
import type { BootstrapContext } from '@forgeax/engine-app';
import { instantiateScene, loadGltfRuntime } from './scene-runtime';
import { buildMeshCollision, type MeshCollision, type Box } from './scene-runtime/mesh-collision';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// HDR sky — same GUID + cubemap upload pipeline as cow-survivor. Spawns
// SkyboxBackground (visible cubemap) + Skylight (IBL ambient) so the warehouse
// PBR materials reflect daylight tones instead of going matte under the sun
// alone. Engine 2026-06-14: loadByGuid returns the PAYLOAD (not a handle);
// uploadCubemapFromEquirect lives on renderer.store and takes 3 args
// (world, sourceHandle, pod) — mint the shared source handle via allocSharedRef.
const SKY_HDR_GUID = '81eec382-392f-5a93-8998-0ecf11ef7990';

// Visible sky background. WebKit/WKWebView (the desktop app) can't render the
// cubemap SkyboxBackground (the equirect->cubemap precompute needs rgba16float
// render targets it lacks), so the background would otherwise clear to black
// ("没天空背景"). The Camera's clear color is a plain render-pass clear value
// with no GPU-feature requirement, so set it to a daytime-blue tone: on WebKit
// it IS the sky; on Chromium the cubemap skybox draws over it (harmless).
// Linear/pre-tonemap (ACES) — values are bright so the sky reads blue after
// tonemapping. perspective() carries clearR/G/B=0, so SKY_CLEAR must be spread
// AFTER it on every Camera write (spawn + the per-frame re-apply below).
const SKY_CLEAR = { clearR: 0.5, clearG: 0.72, clearB: 1.25 } as const;
/** Narrowed context for helper functions — only the subset used from the host. */
type FpsCtx = { world: World; assets: import('@forgeax/engine-runtime').AssetRegistry; app: import('@forgeax/engine-app').App };
async function installHdrSky(ctx: FpsCtx): Promise<Entity | null> {
  // ALWAYS spawn a solid-color Skylight first. The forgeax PBR shader computes
  // ambient=0 without a Skylight, so a lone DirectionalLight leaves every shaded
  // face black ("天光没了"). The engine binds a 1×1 white irradiance cube for a
  // cubemap-less Skylight, so this ambient is live on the very FIRST frame with
  // zero async GPU work — and crucially it works on WebKit/WKWebView (the
  // desktop Studio app), whose WebGPU lacks the rgba16float render-attachment
  // the IBL precompute needs. Cool daylight fill balances the warm sun.
  const skylight = ctx.world.spawn(
    { component: Skylight, data: { colorR: 0.82, colorG: 0.88, colorB: 1.0, intensity: 0.45 } },
  ).unwrap();

  // WebKit/WKWebView guard — calling uploadCubemapFromEquirect there poisons the
  // WebGPU device → first frame never renders → Play sticks on "Loading game"
  // forever. So on non-Chromium we keep the solid ambient above and stop here.
  // Negative allowlist (NOT Chrome/Chromium/Edg) is robust against Playwright's
  // "HeadlessChrome" UA.
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isChromium = /Chrome|Chromium|Edg/.test(ua);
  if (!isChromium) {
    console.info('[fps] non-Chromium WebGPU (WebKit/WKWebView): solid-color skylight only (no IBL/skybox)');
    return skylight;
  }
  const renderer = (ctx.app as unknown as { renderer?: { store?: { uploadCubemapFromEquirect?: unknown } } })?.renderer;
  const store = renderer?.store;
  const upload = (store && typeof store.uploadCubemapFromEquirect === 'function')
    ? (store.uploadCubemapFromEquirect as (w: unknown, h: unknown, p: unknown) => Promise<{ ok: boolean; value?: unknown; error?: { code: string } }>).bind(store)
    : null;
  if (!upload) { console.warn('[fps] HDR sky skipped — uploadCubemapFromEquirect not exposed'); return skylight; }
  const guidRes = AssetGuid.parse(SKY_HDR_GUID);
  if (!guidRes.ok) return skylight;
  const podRes = await ctx.assets.loadByGuid<TextureAsset>(guidRes.value);
  if (!podRes.ok) { console.warn('[fps] sky.hdr loadByGuid failed:', (podRes.error as { code?: string }).code); return skylight; }
  const srcHandle = ctx.world.allocSharedRef('TextureAsset', podRes.value);
  const cubemapRes = await upload(ctx.world, srcHandle, podRes.value);
  if (!cubemapRes.ok || cubemapRes.value === undefined) {
    console.warn('[fps] sky cubemap upload failed:', (cubemapRes as { error?: { code?: string } }).error?.code);
    return skylight;
  }
  // Upgrade the existing Skylight to full image-based lighting. Daytime
  // industrial ambient — lower intensity than the solid fill so the directional
  // sun shadow stays readable (high skylight washes contact-shadow contrast out
  // under canopies / inside doorways). Reset the tint to neutral so the HDR
  // drives the color.
  ctx.world.set(skylight, Skylight, { cubemap: cubemapRes.value, colorR: 1, colorG: 1, colorB: 1, intensity: 0.35 });
  ctx.world.spawn({ component: SkyboxBackground, data: { cubemap: cubemapRes.value, mode: SKYBOX_MODE_CUBEMAP } });
  return skylight;
}

export async function bootstrap(world: World, ctx?: BootstrapContext) {
  const { assets, registerUpdate, app } = ctx ?? {};

  // Host-controlled UI container + non-DOM side-effect cleanup registry. When
  // embedded in the editor, ■ Stop removes uiRoot wholesale (DOM cleanup) and
  // flushes registered cleanups in reverse (listeners / AudioContext). Standalone
  // (no ctx) falls back to document.body and a no-op cleanup.
  const uiMount: HTMLElement = ctx?.uiRoot ?? (typeof document !== 'undefined' ? document.body : (undefined as never));
  const onCleanup = ctx?.registerCleanup ?? (() => {});

  // ── canvas + aspect ─────────────────────────────────────────────────────
  const canvas = document.querySelector<HTMLCanvasElement>('#app')!;
  const dpr = window.devicePixelRatio || 1;
  const sizeCanvas = () => {
    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  };
  sizeCanvas();
  let aspect = canvas.width / canvas.height;

  // ── meshes (procedural geometry → real volumes, not just cubes) ───────────
  const regMesh = (r: { ok: boolean; value?: unknown; unwrap: () => unknown }) =>
    world.allocSharedRef('MeshAsset', r.unwrap() as never);
  const MESH_SPHERE = regMesh(createSphereGeometry(1, 20, 14) as never);
  const MESH_CYL = regMesh(createCylinderGeometry(0.5, 0.5, 1, 18) as never);

  // ── materials ─────────────────────────────────────────────────────────────
  const mat = (m: MaterialAsset) => world.allocSharedRef('MaterialAsset', m);
  const std = (rgb: [number, number, number], rough = 0.6, metal = 0, emis?: [number, number, number], ei = 1) =>
    mat(Materials.standard({
      baseColor: [rgb[0], rgb[1], rgb[2], 1], roughness: rough, metallic: metal,
      ...(emis ? { emissive: emis, emissiveIntensity: ei } : {}),
    }));

  // The STATIC arena's materials are now authored in scene.json and registered by
  // instantiateScene (▶ Play) / the editor (✎ Edit). Only the DYNAMIC palette
  // (enemies, gun, tracers) lives in code. matBarrel + matMetalWall are kept
  // because enemy parts (pouch / antenna) reuse them.
  const matBarrel = std([0.30, 0.34, 0.20], 0.5, 0.6);
  const matMetalWall = std([0.22, 0.24, 0.29], 0.5, 0.55);
  // enemy parts
  const matArmor = std([0.62, 0.10, 0.10], 0.5, 0.2, [0.18, 0.01, 0.01], 1);
  const matLimb = std([0.12, 0.13, 0.16], 0.6, 0.3);
  const matSkin = std([0.85, 0.58, 0.45], 0.7);
  const matHelmet = std([0.10, 0.11, 0.13], 0.45, 0.6);
  const matEye = std([1, 0.2, 0.15], 0.3, 0, [2.2, 0.2, 0.1], 1);
  const matVisor = std([0.05, 0.06, 0.09], 0.25, 0.7, [0.1, 0.32, 0.55], 1);
  const matDarkBelt = std([0.07, 0.07, 0.08], 0.55, 0.25);
  const matFlashHit = std([1, 1, 1], 0.3, 0, [1.6, 1.6, 1.6], 1);
  // gun
  const matGunMetal = std([0.06, 0.06, 0.07], 0.32, 0.85);
  const matGunPoly = std([0.10, 0.10, 0.12], 0.6, 0.1);
  const matGunWood = std([0.22, 0.13, 0.07], 0.6);
  const matTracer = mat(Materials.unlit([1.0, 0.85, 0.35, 1]));
  const matMuzzle = mat(Materials.unlit([1.0, 0.9, 0.55, 1]));

  type Mh = typeof HANDLE_CUBE;
  type MatH = ReturnType<typeof mat>;

  const spawnMesh = (
    mesh: Mh, material: MatH,
    px: number, py: number, pz: number,
    sx: number, sy: number, sz: number,
  ): Entity =>
    world.spawn(
      { component: Transform, data: { posX: px, posY: py, posZ: pz, scaleX: sx, scaleY: sy, scaleZ: sz } },
      { component: MeshFilter, data: { assetHandle: mesh } },
      { component: MeshRenderer, data: { materials: [material] } },
    ).unwrap();
  const box = (m: MatH, px: number, py: number, pz: number, sx: number, sy: number, sz: number) =>
    spawnMesh(HANDLE_CUBE as Mh, m, px, py, pz, sx, sy, sz);

  // IntelliScene_Demo at scale=1 spans x∈[-64,64] z∈[-103,103] (UE5.2 metres).
  // BOUND = max walk radius from origin; the mesh-collider slider also blocks
  // walls, so this is just a far-clip safety. 60 covers most of the warehouse
  // without letting the player escape into the empty void past the GLB extents.
  const HALF = 64;
  const BOUND = 60;
  // The static arena (floor, walls, neon, cover props, buildings, lights) is
  // authored in scene.json and instantiated below — collision is DERIVED from its
  // Collider components into the same covers/walls arrays gameplay already uses.
  const covers: { x: number; z: number; r: number }[] = [];
  const walls: { x: number; z: number; hw: number; hd: number }[] = [];
  // Per-node AABB collision from the imported GLB (IntelliScene), baked by
  // tools/bake-colliders.mjs. Every static mesh node = one box (UE-style).
  // Floor is aligned to y=0 (scene.json Transform.y), so the player/enemies
  // walk on the implicit y=0 plane; meshCol contributes the WALL collision —
  // boxes whose vertical span intersects the body band [feet+0.3, feet+1.8].
  let meshCol: MeshCollision | null = null;
  const BODY_FEET = 0;       // player/enemy feet plane (warehouse floor at y=0)
  // BODY_HEIGHT lowered from 1.9 to 1.5 so the player capsule's wall band
  // [BODY_FEET + STEP_UP, BODY_FEET + BODY_HEIGHT] = [0.6, 1.5] sits BELOW the
  // warehouse door-top mesh (median top y ≈ 1.76 in the per-node baked AABBs);
  // the prior 1.9 reached 1.9 m and clipped every doorway crown.
  const BODY_HEIGHT = 1.5;
  // EYE_Y is the camera/flashlight/muzzle/tracer origin — driven by BODY_HEIGHT
  // so changes propagate without scattering literals. 1.4 m matches a slightly
  // crouched stance fitting the industrial scale (real 1 unit = 1 m).
  const EYE_Y = 1.4;
  // Enemy chest / head raycast targets — must follow the ENEMY_SCALE applied
  // inside makeSoldier (0.65). Authored body y=1.15 / head y=1.78 * 0.65.
  const ENEMY_CHEST_Y = 1.15 * 0.65;   // 0.7475
  const ENEMY_HEAD_Y  = 1.78 * 0.65;   // 1.157
  const ENEMY_CHEST_R = 0.55 * 0.65;   // 0.3575
  const ENEMY_HEAD_R  = 0.28 * 0.65;   // 0.182
  // shared collision resolver: slides a circle of `radius` out of every cover
  // disc and every axis-aligned wall box. Used by BOTH the player and enemies.
  const resolveObstacles = (nx: number, nz: number, radius: number): [number, number] => {
    for (const c of covers) {
      const ex = nx - c.x, ez = nz - c.z; const d = Math.hypot(ex, ez); const min = c.r + radius;
      if (d < min && d > 0.0001) { nx = c.x + (ex / d) * min; nz = c.z + (ez / d) * min; }
    }
    for (const wl of walls) {
      const minx = wl.x - wl.hw - radius, maxx = wl.x + wl.hw + radius;
      const minz = wl.z - wl.hd - radius, maxz = wl.z + wl.hd + radius;
      if (nx > minx && nx < maxx && nz > minz && nz < maxz) {
        const pR = maxx - nx, pL = nx - minx, pT = maxz - nz, pB = nz - minz;
        const m = Math.min(pR, pL, pT, pB);
        if (m === pR) nx = maxx; else if (m === pL) nx = minx; else if (m === pT) nz = maxz; else nz = minz;
      }
    }
    if (meshCol) [nx, nz] = meshCol.slideXZ(nx, nz, radius, BODY_FEET, BODY_HEIGHT);
    return [nx, nz];
  };
  // ── load + instantiate the authored static arena (scene.json) ──────────────
  // The editor (✎ Edit) authors .forgeax/games/fps/scene.json; ▶ Play loads the
  // SAME file and instantiates it via @forgeax/scene (geometry/PBR/emissive/
  // lights), then derives collision from the doc's Collider components
  // (cylinder → covers, box → walls). Falls back to a bare floor + perimeter so
  // the game still runs if the file is missing/unreadable.
  try {
    const res = await fetch(new URL('./scene.json', import.meta.url));
    if (!res.ok) throw new Error(`scene.json ${res.status}`);
    const doc = await res.json();
    // Preload any GltfRef GLBs so ▶ Play renders the SAME real geometry as ✎ Edit
    // (the shared @forgeax/scene loader: parse + decode textures + register).
    // Without this, instantiateScene only spawns a placeholder for a GltfRef.
    // GLBs are fetched module-relative (assets/ sits next to scene.json), the
    // same transport scene.json itself uses — no /api dependency in Play.
    const fetchGlb = async (p: string): Promise<ArrayBuffer> => {
      const file = p.split('/').pop() ?? p;
      const r = await fetch(new URL(`./assets/${file}`, import.meta.url));
      if (!r.ok) throw new Error(`glb ${file} ${r.status}`);
      return r.arrayBuffer();
    };
    const gltfPaths = new Set<string>();
    for (const e of Object.values((doc as { entities?: Record<string, { components?: { GltfRef?: { path?: string } } }> }).entities ?? {})) {
      const path = e.components?.GltfRef?.path;
      if (path) gltfPaths.add(path);
    }
    await Promise.all([...gltfPaths].map((p) => loadGltfRuntime(p, fetchGlb, assets as never, world as never)));
    const { colliders } = instantiateScene(doc, { world: world as never, assets: assets as never });
    for (const c of colliders) {
      if (c.shape === 'box') walls.push({ x: c.x, z: c.z, hw: c.hw, hd: c.hd });
      else covers.push({ x: c.x, z: c.z, r: c.r });
    }
    // Per-node AABB colliders baked from the GLB (every static mesh = 1 box).
    // Gives real wall/prop collision for the imported IntelliScene warehouse.
    try {
      const cr = await fetch(new URL('./assets/IntelliScene_Demo.colliders.json', import.meta.url));
      if (cr.ok) {
        const cj = (await cr.json()) as { boxes: Box[] };
        meshCol = buildMeshCollision(cj.boxes);
        console.log(`[fps] mesh colliders: ${meshCol.count} boxes`);
      }
    } catch (e) {
      console.warn('[fps] mesh colliders unavailable:', (e as Error).message);
    }
    // HDR environment light + visible skybox (parallel to scene boot — fires
    // and forgets; if cubemap upload fails, scene.json's DirectionalLight is
    // still enough to light the warehouse, just without skylight tint).
    void installHdrSky({ world, assets, app });
  } catch (err) {
    console.warn('[fps] scene.json unavailable — using fallback arena:', err);
    box(matMetalWall, 0, -0.1, 0, HALF * 2, 0.2, HALF * 2);
    box(matMetalWall, 0, 1.6, HALF, HALF * 2, 3.4, 0.6);
    box(matMetalWall, 0, 1.6, -HALF, HALF * 2, 3.4, 0.6);
    box(matMetalWall, HALF, 1.6, 0, 0.6, 3.4, HALF * 2);
    box(matMetalWall, -HALF, 1.6, 0, 0.6, 3.4, HALF * 2);
  }

  // ── lighting (DYNAMIC only) ───────────────────────────────────────────────
  // The static sun + colored accent lights now live in scene.json. These two are
  // gameplay-driven: the flashlight follows the camera, the muzzleLight pulses on
  // fire (both positioned/animated in the update loop).
  const flashlight = world.spawn(
    { component: Transform, data: { posY: EYE_Y } },
    { component: PointLight, data: { colorR: 1.0, colorG: 0.93, colorB: 0.78, intensity: 9, range: 18 } },
  ).unwrap();
  // muzzle-flash light (pulsed on fire)
  const muzzleLight = world.spawn(
    { component: Transform, data: { posY: EYE_Y } },
    { component: PointLight, data: { colorR: 1.0, colorG: 0.85, colorB: 0.5, intensity: 0, range: 14 } },
  ).unwrap();

  // ── camera ────────────────────────────────────────────────────────────────
  // 90° hip-fire FOV: with the warehouse at real 1 unit = 1 m scale, the prior
  // ~76° felt cramped — props at 3-5 m read as oversized. 90° matches modern
  // PC FPS conventions (CS / Apex hip FOV) and lets the eye see more lateral
  // detail before turning, easing the "everything is too close" feel.
  const HIP_FOV = Math.PI / 2;
  const camera = world.spawn(
    { component: Transform, data: { posY: EYE_Y } },
    { component: Camera, data: { ...perspective({ fov: HIP_FOV, aspect, near: 0.04, far: 320 }), tonemap: TONEMAP_ACES_FILMIC, ...SKY_CLEAR } },
  ).unwrap();

  // ── weapons ─────────────────────────────────────────────────────────────
  interface Weapon {
    name: string; dmg: number; fire: number; mag: number; reserve: number;
    auto: boolean; pellets: number; spread: number; bloom: number; bloomMax: number;
    recoil: number; range: number; reload: number; adsFov: number;
    barLen: number; barRad: number; recLen: number; scope: boolean; tracerEvery: number;
    col: MatH;
  }
  const WEAPONS: Weapon[] = [
    { name: 'M4 CARBINE', dmg: 18, fire: 0.095, mag: 30, reserve: 240, auto: true, pellets: 1, spread: 0.009, bloom: 0.006, bloomMax: 0.05, recoil: 0.040, range: 95, reload: 1.6, adsFov: Math.PI / 3.1, barLen: 0.55, barRad: 0.05, recLen: 0.5, scope: false, tracerEvery: 2, col: matGunMetal },
    { name: 'MP5 SMG', dmg: 12, fire: 0.055, mag: 40, reserve: 320, auto: true, pellets: 1, spread: 0.018, bloom: 0.010, bloomMax: 0.085, recoil: 0.030, range: 60, reload: 1.4, adsFov: Math.PI / 2.85, barLen: 0.34, barRad: 0.045, recLen: 0.42, scope: false, tracerEvery: 3, col: matGunPoly },
    { name: 'SPAS SHOTGUN', dmg: 9, fire: 0.72, mag: 7, reserve: 56, auto: false, pellets: 9, spread: 0.085, bloom: 0, bloomMax: 0, recoil: 0.16, range: 34, reload: 2.0, adsFov: Math.PI / 2.7, barLen: 0.52, barRad: 0.075, recLen: 0.5, scope: false, tracerEvery: 1, col: matGunWood },
    { name: 'AWP SNIPER', dmg: 135, fire: 1.05, mag: 5, reserve: 40, auto: false, pellets: 1, spread: 0, bloom: 0, bloomMax: 0, recoil: 0.22, range: 280, reload: 2.4, adsFov: Math.PI / 6.5, barLen: 0.9, barRad: 0.05, recLen: 0.6, scope: true, tracerEvery: 1, col: matGunMetal },
  ];
  const ammoState = WEAPONS.map((w) => ({ mag: w.mag, reserve: w.reserve }));

  // gun viewmodel parts (reconfigured per weapon every frame)
  const gunReceiver = box(matGunMetal, 0, 0, 0, 0.001, 0.001, 0.001);
  const gunBarrel = spawnMesh(MESH_CYL as Mh, matGunMetal, 0, 0, 0, 0.001, 0.001, 0.001);
  const gunMag = box(matGunPoly, 0, 0, 0, 0.001, 0.001, 0.001);
  const gunStock = box(matGunPoly, 0, 0, 0, 0.001, 0.001, 0.001);
  // open U-shaped iron sight: left post + right post + base bar (top open so the
  // target isn't covered). Reconfigured per frame like the other gun parts.
  const gunSightL = box(matGunMetal, 0, 0, 0, 0.001, 0.001, 0.001);
  const gunSightR = box(matGunMetal, 0, 0, 0, 0.001, 0.001, 0.001);
  const gunSightB = box(matGunMetal, 0, 0, 0, 0.001, 0.001, 0.001);
  const gunScope = spawnMesh(MESH_CYL as Mh, matGunMetal, 0, 0, 0, 0.001, 0.001, 0.001);
  const muzzle = spawnMesh(MESH_SPHERE as Mh, matMuzzle, 0, 0, 0, 0.001, 0.001, 0.001);

  // tracer pool
  const TRACERS = 8;
  const tracers: { ent: Entity; t: number }[] = [];
  for (let i = 0; i < TRACERS; i++) tracers.push({ ent: box(matTracer, 0, -50, 0, 0.001, 0.001, 0.001), t: 0 });
  let tracerNext = 0;

  // ── enemies (humanoid soldiers) ───────────────────────────────────────────
  type AnimKind = 'static' | 'legL' | 'legR' | 'armL' | 'armR' | 'footL' | 'footR' | 'handL' | 'handR';
  interface Part { ent: Entity; lx: number; ly: number; lz: number; sx: number; sy: number; sz: number; anim: AnimKind; flashable: boolean; baseMat: MatH; }
  interface Enemy {
    parts: Part[]; x: number; z: number; feetY: number; face: number; hp: number; alive: boolean;
    speed: number; flash: number; matIsFlash: boolean; respawn: number; attackCd: number; phase: number;
  }
  const ENEMY_COUNT = 7;
  const ENEMY_HP = 44;
  const enemies: Enemy[] = [];

  const randEdge = () => {
    // Sample an OPEN floor point in the warehouse walkable corridor (reject
    // points inside walls / off the floor via the per-node mesh colliders).
    // Scale=1 footprint is ~128m x 206m; sample a wide central rectangle so
    // enemies materialise scattered across the floor, not bunched at the
    // spawn point.
    if (meshCol) {
      for (let t = 0; t < 80; t++) {
        const x = (Math.random() - 0.5) * 60;       // x ∈ [-30, 30]
        const z = (Math.random() - 0.5) * 100;      // z ∈ [-50, 50]
        if (meshCol.isOpen(x, z, 0.7)) return { x, z };
      }
    }
    // fallback: circular (old arena) if no mesh colliders
    const a = Math.random() * Math.PI * 2;
    const r = 15 + Math.random() * (BOUND - 15);
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  };

  const makeSoldier = (): Enemy => {
    const p = randEdge();
    const cyl = MESH_CYL as Mh;
    const sph = MESH_SPHERE as Mh;
    const cube = HANDLE_CUBE as Mh;
    const parts: Part[] = [];
    // Enemy scale relative to the GLB warehouse (UE5.2 export, 1 unit = 1 m;
    // door 1.98 m, walls in 4 m modules — see tools/bake-colliders.mjs measure
    // notes). Originally authored ~2.09 m tall (antenna tip at y=1.98), which
    // is taller than the warehouse door and overpowers the FPS frame at close
    // range. 0.65 → ~1.36 m enemies that comfortably pass under doorways and
    // read as a clear threat without filling the screen.
    const ENEMY_SCALE = 0.65;
    // spawn a body part; its mesh + base material are remembered so the hit-flash
    // and respawn can restore exactly the right look per piece. lx/ly/lz/sx/sy/sz
    // are passed in authored (full-scale) units and scaled by ENEMY_SCALE here so
    // every downstream consumer (per-frame Transform write, anim quat composition,
    // muzzle attach) sees a CONSISTENT scaled value.
    const S = ENEMY_SCALE;
    const part = (mesh: Mh, m: MatH, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, anim: AnimKind, flashable: boolean) =>
      parts.push({ ent: spawnMesh(mesh, m, 0, 0, 0, sx * S, sy * S, sz * S), lx: lx * S, ly: ly * S, lz: lz * S, sx: sx * S, sy: sy * S, sz: sz * S, anim, flashable, baseMat: m });

    // torso + chest plate + pelvis + belt
    part(cube, matArmor, 0, 1.20, 0, 0.56, 0.74, 0.34, 'static', true);
    part(cube, matHelmet, 0, 1.30, 0.16, 0.40, 0.46, 0.07, 'static', true);   // chest plate
    part(cube, matLimb, 0, 0.80, 0, 0.50, 0.30, 0.32, 'static', false);        // pelvis
    part(cube, matDarkBelt, 0, 0.66, 0, 0.54, 0.12, 0.36, 'static', false);    // belt
    // backpack + pouch
    part(cube, matLimb, 0, 1.22, -0.27, 0.42, 0.56, 0.20, 'static', false);
    part(cube, matBarrel, 0, 1.42, -0.35, 0.18, 0.20, 0.10, 'static', false);
    // shoulder pads
    part(sph, matHelmet, 0.40, 1.50, 0, 0.18, 0.14, 0.20, 'static', true);
    part(sph, matHelmet, -0.40, 1.50, 0, 0.18, 0.14, 0.20, 'static', true);
    // neck + head + helmet + visor + eye glow + antenna
    part(cyl, matSkin, 0, 1.60, 0, 0.10, 0.14, 0.10, 'static', true);          // neck
    part(sph, matSkin, 0, 1.76, 0, 0.17, 0.19, 0.17, 'static', true);          // head
    part(sph, matHelmet, 0, 1.84, 0, 0.21, 0.17, 0.22, 'static', false);       // helmet
    part(cube, matVisor, 0, 1.80, 0.15, 0.30, 0.10, 0.07, 'static', false);    // visor
    part(cube, matEye, 0, 1.76, 0.18, 0.22, 0.04, 0.02, 'static', false);      // eye glow
    part(cube, matMetalWall, 0.13, 1.98, -0.02, 0.03, 0.22, 0.03, 'static', false); // antenna
    // arms: upper (swing) + forearm + hands holding a rifle
    part(cyl, matArmor, 0.38, 1.28, 0, 0.15, 0.50, 0.15, 'armL', true);
    part(cyl, matArmor, -0.38, 1.28, 0, 0.15, 0.50, 0.15, 'armR', true);
    part(cyl, matLimb, 0.40, 0.96, 0.10, 0.13, 0.34, 0.13, 'handL', false);    // forearm L
    part(cyl, matLimb, -0.36, 0.98, 0.20, 0.13, 0.34, 0.13, 'handR', false);   // forearm R
    part(sph, matSkin, 0.40, 0.80, 0.20, 0.10, 0.10, 0.10, 'handL', false);    // hand L
    part(sph, matSkin, -0.32, 0.82, 0.34, 0.10, 0.10, 0.10, 'handR', false);   // hand R
    // carried rifle
    part(cube, matGunMetal, 0.05, 0.92, 0.40, 0.08, 0.11, 0.50, 'handR', false);
    part(cube, matGunMetal, 0.05, 0.98, 0.68, 0.05, 0.05, 0.26, 'handR', false); // barrel
    // legs (thigh + boot + knee pad)
    part(cyl, matLimb, 0.16, 0.46, 0, 0.18, 0.50, 0.18, 'legL', false);
    part(cyl, matLimb, -0.16, 0.46, 0, 0.18, 0.50, 0.18, 'legR', false);
    part(sph, matArmor, 0.16, 0.62, 0.06, 0.12, 0.10, 0.13, 'legL', true);     // knee pad L
    part(sph, matArmor, -0.16, 0.62, 0.06, 0.12, 0.10, 0.13, 'legR', true);    // knee pad R
    part(cube, matHelmet, 0.16, 0.10, 0.05, 0.20, 0.18, 0.32, 'footL', false); // boot L
    part(cube, matHelmet, -0.16, 0.10, 0.05, 0.20, 0.18, 0.32, 'footR', false);// boot R
    return { parts, x: p.x, z: p.z, feetY: meshCol ? meshCol.floorAt(p.x, p.z, 0) : 0, face: 0, hp: ENEMY_HP, alive: true, speed: 1.9 + Math.random() * 1.5, flash: 0, matIsFlash: false, respawn: 0, attackCd: 0, phase: Math.random() * 6.28 };
  };
  for (let i = 0; i < ENEMY_COUNT; i++) enemies.push(makeSoldier());

  // ── player + game state ───────────────────────────────────────────────────
  const state = {
    px: 0, pz: 0, yaw: 0, pitch: 0,
    // Vertical physics state — driven by meshCol.floorAt + gravity each frame
    // so the player follows the IntelliScene terrain (stairs up/down, stepping
    // off platforms, falling into lower floors). feetY is the SOLE Y reference;
    // all visual-Y consumers (camera, flashlight, muzzle light, viewmodel,
    // tracers, raycast eye) MUST add state.feetY to their authored EYE_Y/etc.
    feetY: 0, vy: 0, grounded: true,
    recoil: 0, recoilYaw: 0,
    health: 100, score: 0, kills: 0,
    weapon: 0, fireCd: 0, reloading: 0,
    bloom: 0, bob: 0,
    ads: 0, fov: HIP_FOV, fovPunch: 0,
    shake: 0,
    dead: false, started: false,
  };
  const SPEED = 5.4, SPRINT = 8.6;
  const GRAVITY = 22, JUMP_V = 7.2;   // jump apex ≈ 1.2 units

  // ── input ────────────────────────────────────────────────────────────────
  const keys: Record<string, boolean> = {};
  let fireDown = false, firePressed = false, adsDown = false;
  // Pointer-lock state mirrors cow-survivor: a SoT `locked` boolean updated
  // from both the web `pointerlockchange` event AND the Tauri postMessage
  // fallback path (WKWebView denies the web Pointer Lock API for embedded
  // content; the desktop shell uses native cursor-grab via parent postMessage).
  let locked = false;
  const isLocked = () => locked;
  // Save the REAL requestPointerLock before any iframe monkey-patch lands; the
  // Studio editor iframe rewrites HTMLElement.prototype.requestPointerLock to a
  // no-op on some platforms, so we call the saved reference inside mousedown.
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
    } catch { /* pointerlockerror handler takes over */ }
  };
  const isTauri = !!(window as unknown as { __TAURI__?: unknown }).__TAURI__
               || !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  const postCapture = (capture: boolean) => {
    try { window.parent.postMessage({ type: 'fx-pointer-capture', capture }, '*'); } catch { /* not embedded */ }
  };
  const setLocked = (v: boolean) => {
    locked = v;
    canvas.style.cursor = v ? 'none' : 'crosshair';
    if (!v) fireDown = false;
    syncHud();
  };

  const switchWeapon = (i: number) => {
    if (i < 0 || i >= WEAPONS.length || i === state.weapon || state.dead) return;
    state.weapon = i; state.reloading = 0; state.fireCd = 0.15; state.bloom = 0;
    audio.swap();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    keys[e.code] = true;
    if (e.code === 'KeyR') startReload();
    if (e.code === 'Digit1') switchWeapon(0);
    if (e.code === 'Digit2') switchWeapon(1);
    if (e.code === 'Digit3') switchWeapon(2);
    if (e.code === 'Digit4') switchWeapon(3);
    if (e.code === 'KeyQ') switchWeapon((state.weapon + 1) % WEAPONS.length);
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) e.preventDefault();
  };
  window.addEventListener('keydown', onKeyDown);
  onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  const onKeyUp = (e: KeyboardEvent) => { keys[e.code] = false; };
  window.addEventListener('keyup', onKeyUp);
  onCleanup(() => window.removeEventListener('keyup', onKeyUp));

  const onContextMenu = (e: MouseEvent) => e.preventDefault();
  canvas.addEventListener('contextmenu', onContextMenu);
  onCleanup(() => canvas.removeEventListener('contextmenu', onContextMenu));
  const onMouseDown = (e: MouseEvent) => {
    audio.resume();
    if (state.dead) { restart(); return; }
    if (!state.started) { state.started = true; audio.startAmbient(); }
    // Acquire pointer-lock on first click — mirrors cow-survivor: Tauri uses a
    // postMessage handshake (WKWebView denies the web Pointer Lock API for
    // embedded content), web uses the saved prototype reference to bypass any
    // iframe monkey-patch that nulls canvas.requestPointerLock.
    if (!locked) {
      if (isTauri) {
        postCapture(true);
        setLocked(true);
      } else {
        safeRequestLock(canvas);
      }
    }
    if (e.button === 0) { fireDown = true; firePressed = true; }
    if (e.button === 2) adsDown = true;
  };
  canvas.addEventListener('mousedown', onMouseDown);
  onCleanup(() => canvas.removeEventListener('mousedown', onMouseDown));
  const onMouseUp = (e: MouseEvent) => {
    if (e.button === 0) fireDown = false;
    if (e.button === 2) adsDown = false;
  };
  window.addEventListener('mouseup', onMouseUp);
  onCleanup(() => window.removeEventListener('mouseup', onMouseUp));
  const onMouseMove = (e: MouseEvent) => {
    if (!locked && !fireDown && !adsDown) return;
    const sens = 0.0023 * (state.ads > 0.5 ? 0.55 : 1);
    state.yaw -= e.movementX * sens;
    state.pitch = clamp(state.pitch - e.movementY * sens, -1.45, 1.45);
  };
  window.addEventListener('mousemove', onMouseMove);
  onCleanup(() => window.removeEventListener('mousemove', onMouseMove));
  const onWheel = (e: WheelEvent) => {
    if (!state.started || state.dead) return;
    const dir = e.deltaY > 0 ? 1 : -1;
    switchWeapon((state.weapon + dir + WEAPONS.length) % WEAPONS.length);
  };
  window.addEventListener('wheel', onWheel, { passive: true });
  onCleanup(() => window.removeEventListener('wheel', onWheel));
  // pointerlockchange fires for web Pointer Lock API; pointerlockerror fires
  // when the API is denied (iframe / WKWebView) — treat it as the Tauri-grab
  // success path so the cursor still hides + mouse-look engages.
  const onPointerLockChange = () => {
    setLocked(document.pointerLockElement === canvas);
  };
  document.addEventListener('pointerlockchange', onPointerLockChange);
  onCleanup(() => document.removeEventListener('pointerlockchange', onPointerLockChange));
  const onPointerLockError = () => {
    if (state.dead) return;
    postCapture(true);
    setLocked(true);
  };
  document.addEventListener('pointerlockerror', onPointerLockError);
  onCleanup(() => document.removeEventListener('pointerlockerror', onPointerLockError));
  const onEscKeyDown = (e: KeyboardEvent) => {
    // Esc releases the lock on both the Tauri (postMessage) and web paths.
    if (e.key === 'Escape' && locked) {
      postCapture(false);
      try { document.exitPointerLock?.(); } catch { /* ignore */ }
      setLocked(false);
    }
  };
  window.addEventListener('keydown', onEscKeyDown);
  onCleanup(() => window.removeEventListener('keydown', onEscKeyDown));
  const onResize = () => { sizeCanvas(); aspect = canvas.width / canvas.height; };
  window.addEventListener('resize', onResize);
  onCleanup(() => window.removeEventListener('resize', onResize));

  const hud = buildHud(uiMount);
  const audio = makeAudio();
  onCleanup(() => audio.close());

  function startReload() {
    const w = WEAPONS[state.weapon]; const a = ammoState[state.weapon];
    if (state.dead || state.reloading > 0 || a.mag >= w.mag || a.reserve <= 0) return;
    state.reloading = w.reload;
    audio.reload();
  }
  function restart() {
    state.health = 100; state.score = 0; state.kills = 0; state.weapon = 0;
    state.reloading = 0; state.fireCd = 0; state.dead = false; state.bloom = 0;
    state.px = 0; state.pz = 0; state.yaw = 0; state.pitch = 0; state.recoil = 0; state.recoilYaw = 0;
    for (let i = 0; i < WEAPONS.length; i++) { ammoState[i].mag = WEAPONS[i].mag; ammoState[i].reserve = WEAPONS[i].reserve; }
    for (const en of enemies) respawnEnemy(en, true);
    hud.over.style.display = 'none';
  }

  // ── scratch math ──────────────────────────────────────────────────────────
  const qYaw = quat.create(), qPitch = quat.create(), qCam = quat.create();
  const qBarrel = quat.create();
  const qRotX90 = quat.fromAxisAngle(quat.create(), [1, 0, 0], -Math.PI / 2);
  const fwd = new Float32Array(3), rgt = new Float32Array(3), upv = new Float32Array(3), off = new Float32Array(3);
  const eq = quat.create();

  const raySphere = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number) => {
    const ax = ox - cx, ay = oy - cy, az = oz - cz;
    const b = ax * dx + ay * dy + az * dz;
    const c = ax * ax + ay * ay + az * az - r * r;
    const disc = b * b - c;
    if (disc < 0) return -1;
    const s = Math.sqrt(disc);
    let t = -b - s; if (t < 0) t = -b + s;
    return t < 0 ? -1 : t;
  };

  function respawnEnemy(en: Enemy, immediate: boolean) {
    const p = randEdge();
    en.x = p.x; en.z = p.z;
    en.feetY = meshCol ? meshCol.floorAt(p.x, p.z, 0) : 0;
    en.hp = ENEMY_HP; en.alive = true; en.flash = 0; en.matIsFlash = false; en.respawn = 0;
    if (immediate) { en.attackCd = 0; en.phase = Math.random() * 6.28; }
    en.face = 0;
    // Place parts at the NEW position this very frame (face 0 → local offset is
    // identity-rotated). Without this the enemy loop's `continue` would skip
    // repositioning, leaving the parts at the previous death spot for one
    // rendered frame — the "enemy flashes then vanishes" artefact.
    for (const pt of en.parts) {
      world.set(pt.ent, Transform, {
        posX: en.x + pt.lx, posY: en.feetY + pt.ly, posZ: en.z + pt.lz,
        quatX: 0, quatY: 0, quatZ: 0, quatW: 1,
        scaleX: pt.sx, scaleY: pt.sy, scaleZ: pt.sz,
      });
      if (pt.flashable) world.set(pt.ent, MeshRenderer, { materials: [defaultMatFor(pt)] });
    }
  }
  const defaultMatFor = (pt: Part): MatH => pt.baseMat;
  function hideEnemy(en: Enemy) {
    for (const pt of en.parts) world.set(pt.ent, Transform, { scaleX: 0.0001, scaleY: 0.0001, scaleZ: 0.0001 });
  }

  const spawnTracer = (len: number) => {
    const tr = tracers[tracerNext]; tracerNext = (tracerNext + 1) % TRACERS;
    tr.t = 0.05;
    quat.transformVec3(off, qCam, [0.26, -0.16, -(len / 2) - 0.6]);
    world.set(tr.ent, Transform, {
      posX: state.px + off[0], posY: state.feetY + EYE_Y + off[1], posZ: state.pz + off[2],
      quatX: qCam[0], quatY: qCam[1], quatZ: qCam[2], quatW: qCam[3],
      scaleX: 0.03, scaleY: 0.03, scaleZ: len,
    });
  };

  let shotCount = 0;
  let muzzleT = 0;
  function fire() {
    const w = WEAPONS[state.weapon]; const a = ammoState[state.weapon];
    a.mag -= 1;
    audio.shot(state.weapon);
    state.fireCd = w.fire;
    state.recoil = Math.min(state.recoil + w.recoil, 0.32);
    state.recoilYaw += (Math.random() - 0.5) * w.recoil * 0.6;
    state.bloom = Math.min(state.bloom + w.bloom, w.bloomMax);
    state.fovPunch = Math.min(state.fovPunch + 0.03, 0.09);
    state.shake = Math.min(state.shake + w.recoil * 0.5, 0.14);
    muzzleT = 0.05;

    // aim basis
    quat.transformVec3(rgt, qCam, [1, 0, 0]);
    quat.transformVec3(upv, qCam, [0, 1, 0]);
    const moving = (keys['KeyW'] || keys['KeyA'] || keys['KeyS'] || keys['KeyD']) ? 0.02 : 0;
    const spread = (w.spread + state.bloom + moving) * (state.ads > 0.5 ? 0.25 : 1);

    let anyHit = false, anyKill = false, nearest = w.range;
    for (let p = 0; p < w.pellets; p++) {
      const jx = (Math.random() - 0.5) * spread * 2;
      const jy = (Math.random() - 0.5) * spread * 2;
      const dx = fwd[0] + rgt[0] * jx + upv[0] * jy;
      const dy = fwd[1] + rgt[1] * jx + upv[1] * jy;
      const dz = fwd[2] + rgt[2] * jx + upv[2] * jy;
      const dl = Math.hypot(dx, dy, dz) || 1;
      const nx = dx / dl, ny = dy / dl, nz = dz / dl;
      let best = -1; let hit: Enemy | null = null; let head = false;
      for (const en of enemies) {
        if (!en.alive) continue;
        const tb = raySphere(state.px, state.feetY + EYE_Y, state.pz, nx, ny, nz, en.x, ENEMY_CHEST_Y, en.z, ENEMY_CHEST_R);
        const th = raySphere(state.px, state.feetY + EYE_Y, state.pz, nx, ny, nz, en.x, ENEMY_HEAD_Y, en.z, ENEMY_HEAD_R);
        let t = -1, isHead = false;
        if (th >= 0 && (tb < 0 || th < tb)) { t = th; isHead = true; }
        else if (tb >= 0) { t = tb; }
        if (t >= 0 && t <= w.range && (best < 0 || t < best)) { best = t; hit = en; head = isHead; }
      }
      if (hit) {
        anyHit = true;
        if (best < nearest) nearest = best;
        hit.hp -= head ? w.dmg * 2.0 : w.dmg;
        hit.flash = 0.08;
        if (hit.hp <= 0) { anyKill = true; hideEnemy(hit); hit.alive = false; hit.respawn = 1.4 + Math.random() * 2.2; state.kills += 1; state.score += head ? 150 : 100; }
      }
    }
    if (shotCount % w.tracerEvery === 0) spawnTracer(Math.min(nearest, w.range));
    shotCount++;

    if (anyHit) { hud.hit.style.opacity = '1'; hudHitColor(anyKill); hudHitT = anyKill ? 0.32 : 0.18; if (anyKill) audio.kill(); else audio.hit(); }
  }

  let hudHitT = 0;
  function hudHitColor(kill: boolean) {
    for (const l of hud.hitLines) l.style.background = kill ? '#ff4d4d' : '#ffffff';
  }

  // ── frame update ────────────────────────────────────────────────────────
  registerUpdate((dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const w = WEAPONS[state.weapon];
    const a = ammoState[state.weapon];

    state.recoil = lerp(state.recoil, 0, Math.min(1, dt * 8));
    state.recoilYaw = lerp(state.recoilYaw, 0, Math.min(1, dt * 6));
    state.bloom = Math.max(0, state.bloom - dt * 0.06);
    state.fovPunch = Math.max(0, state.fovPunch - dt * 0.4);
    state.shake = Math.max(0, state.shake - dt * 0.6);
    state.ads = clamp(state.ads + (adsDown && !state.dead ? dt * 9 : -dt * 9), 0, 1);

    if (!state.dead && state.started) {
      // movement
      const sin = Math.sin(state.yaw), cos = Math.cos(state.yaw);
      let mx = 0, mz = 0;
      if (keys['KeyW']) { mx += -sin; mz += -cos; }
      if (keys['KeyS']) { mx += sin; mz += cos; }
      if (keys['KeyD']) { mx += cos; mz += -sin; }
      if (keys['KeyA']) { mx += -cos; mz += sin; }
      const len = Math.hypot(mx, mz);
      const sprint = (keys['ShiftLeft'] || keys['ShiftRight']) && state.ads < 0.5;
      if (len > 0.0001) {
        const spd = (sprint ? SPRINT : SPEED) * (state.ads > 0.5 ? 0.55 : 1) * dt;
        let nx = clamp(state.px + (mx / len) * spd, -BOUND, BOUND);
        let nz = clamp(state.pz + (mz / len) * spd, -BOUND, BOUND);
        [nx, nz] = resolveObstacles(nx, nz, 0.5);
        // enemies are solid bodies too — slide the player around them
        for (const en of enemies) {
          if (!en.alive) continue;
          const ex = nx - en.x, ez = nz - en.z; const d = Math.hypot(ex, ez); const min = 0.95;
          if (d < min && d > 0.0001) { nx = en.x + (ex / d) * min; nz = en.z + (ez / d) * min; }
        }
        nx = clamp(nx, -BOUND, BOUND); nz = clamp(nz, -BOUND, BOUND);
        state.px = nx; state.pz = nz;
        state.bob += dt * (sprint ? 15 : 9);
      }

      // Vertical physics (run every frame, even when not moving horizontally):
      //   feetY = max walkable surface under (px,pz) reachable from current
      //           feet by STEP_UP (handles stairs going UP automatically).
      //   when grounded → feetY snaps to floor (handles stairs going DOWN /
      //   stepping off ledges into a lower floor).
      //   when airborne (jumped or fell off a high ledge taller than STEP_UP)
      //   → integrate vy by gravity until feetY hits the floor again.
      if (meshCol) {
        const GRAVITY = 22, JUMP_V = 7.2;
        const groundY = meshCol.floorAt(state.px, state.pz, state.feetY);
        if (state.grounded && keys['Space']) { state.vy = JUMP_V; state.grounded = false; }
        state.vy -= GRAVITY * dt;
        state.feetY += state.vy * dt;
        if (state.feetY <= groundY) {
          state.feetY = groundY;
          state.vy = 0;
          state.grounded = true;
        } else {
          state.grounded = false;
        }
      }

      if (state.reloading > 0) {
        state.reloading -= dt;
        if (state.reloading <= 0) { const need = w.mag - a.mag; const take = Math.min(need, a.reserve); a.mag += take; a.reserve -= take; }
      }
      if (state.fireCd > 0) state.fireCd -= dt;
      const trigger = w.auto ? fireDown : firePressed;
      if (trigger && state.fireCd <= 0 && state.reloading <= 0) {
        if (a.mag > 0) fire(); else { if (firePressed) audio.empty(); startReload(); }
      }
      firePressed = false;
    }

    // camera orientation
    quat.fromAxisAngle(qYaw, [0, 1, 0], state.yaw + state.recoilYaw);
    quat.fromAxisAngle(qPitch, [1, 0, 0], state.pitch + state.recoil);
    quat.multiply(qCam, qYaw, qPitch);
    quat.transformVec3(fwd, qCam, [0, 0, -1]);

    // fov (ADS zoom + shot punch)
    const targetFov = lerp(HIP_FOV, w.adsFov, state.ads);
    state.fov = lerp(state.fov, targetFov, Math.min(1, dt * 12));
    // Re-apply ACES tonemap on every frame because `perspective(...)` returns
    // an obj that includes `tonemap: 0` (default) — set without it would reset
    // the camera to TONEMAP_NONE, which causes the engine to skip the skybox
    // pass ("camera.tonemap !== 'none' required" warn) and the HDR sky goes
    // black mid-game.
    world.set(camera, Camera, { ...perspective({ fov: state.fov + state.fovPunch, aspect, near: 0.04, far: 320 }), tonemap: TONEMAP_ACES_FILMIC, ...SKY_CLEAR });

    const bob = Math.sin(state.bob) * 0.03 * (1 - state.ads);
    const shx = (Math.random() - 0.5) * state.shake;
    const shy = (Math.random() - 0.5) * state.shake;
    world.set(camera, Transform, {
      posX: state.px + shx, posY: state.feetY + EYE_Y + bob + shy, posZ: state.pz,
      quatX: qCam[0], quatY: qCam[1], quatZ: qCam[2], quatW: qCam[3],
    });
    world.set(flashlight, Transform, { posX: state.px, posY: state.feetY + EYE_Y + 0.1, posZ: state.pz });

    // muzzle-flash light pulse
    if (muzzleT > 0) {
      muzzleT -= dt;
      quat.transformVec3(off, qCam, [0.26, -0.14, -(w.barLen + w.recLen + 0.2)]);
      world.set(muzzleLight, Transform, { posX: state.px + off[0], posY: state.feetY + EYE_Y + off[1], posZ: state.pz + off[2] });
      world.set(muzzleLight, PointLight, { intensity: 30 });
    } else {
      world.set(muzzleLight, PointLight, { intensity: 0 });
    }

    // ── gun viewmodel ─────────────────────────────────────────────────────
    quat.multiply(qBarrel, qCam, qRotX90);
    const sway = Math.sin(state.bob) * 0.01 * (1 - state.ads);
    const adsX = lerp(0.26, 0.0, state.ads);
    // ADS target lowers the WHOLE viewmodel (gun + rigidly-attached sight move as one)
    // so the U notch centre lands on the camera forward ray — no part floats off the gun.
    const adsY = lerp(-0.24, -0.144, state.ads);
    const kick = state.recoil * 0.5;
    const placeRel = (ent: Entity, lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, q: Float32Array = qCam) => {
      quat.transformVec3(off, qCam, [lx + sway, ly, lz]);
      world.set(ent, Transform, {
        posX: state.px + off[0], posY: state.feetY + EYE_Y + bob + off[1], posZ: state.pz + off[2],
        quatX: q[0], quatY: q[1], quatZ: q[2], quatW: q[3],
        scaleX: sx, scaleY: sy, scaleZ: sz,
      });
    };
    const scoped = w.scope && state.ads > 0.85;
    const HIDE = 0.0001;
    if (scoped) {
      // hide the whole viewmodel while looking through the scope
      for (const e of [gunReceiver, gunBarrel, gunMag, gunStock, gunSightL, gunSightR, gunSightB, gunScope, muzzle]) world.set(e, Transform, { scaleX: HIDE, scaleY: HIDE, scaleZ: HIDE });
    } else {
      placeRel(gunReceiver, adsX, adsY, -0.3 + kick, 0.11, 0.13, w.recLen, qCam);
      placeRel(gunBarrel, adsX, adsY + 0.02, -(w.recLen / 2) - (w.barLen / 2) - 0.28 + kick, w.barRad * 2, w.barLen, w.barRad * 2, qBarrel);
      placeRel(gunMag, adsX, adsY - 0.16, -0.2 + kick, 0.07, 0.2, 0.12, qCam);
      placeRel(gunStock, adsX, adsY + 0.01, 0.12 + kick, 0.08, 0.11, 0.2, qCam);
      const hideSight = () => { for (const e of [gunSightL, gunSightR, gunSightB]) world.set(e, Transform, { scaleX: HIDE, scaleY: HIDE, scaleZ: HIDE }); };
      if (w.scope) { placeRel(gunScope, adsX, adsY + 0.11, -0.34 + kick, 0.07, 0.34, 0.07, qBarrel); hideSight(); }
      else {
        // U-bracket: two vertical posts spaced in X, joined by a base bar; top stays open.
        // Fixed +0.1 offset above the receiver, so the sight stays rigidly bolted to the gun.
        const postH = 0.08, hwU = 0.05;
        const sgY = adsY + 0.1, sgZ = -0.34 + kick;
        placeRel(gunSightL, adsX - hwU, sgY + postH / 2, sgZ, 0.018, postH, 0.05, qCam);
        placeRel(gunSightR, adsX + hwU, sgY + postH / 2, sgZ, 0.018, postH, 0.05, qCam);
        placeRel(gunSightB, adsX, sgY, sgZ, hwU * 2 + 0.018, 0.018, 0.05, qCam);
        world.set(gunScope, Transform, { scaleX: HIDE, scaleY: HIDE, scaleZ: HIDE });
      }
      // muzzle flash sphere
      if (muzzleT > 0) { const s = 0.14 + Math.random() * 0.12; placeRel(muzzle, adsX, adsY + 0.02, -(w.recLen / 2) - w.barLen - 0.3 + kick, s, s, s * 1.4, qCam); }
      else world.set(muzzle, Transform, { scaleX: HIDE, scaleY: HIDE, scaleZ: HIDE });
    }

    // tracers
    for (const tr of tracers) {
      if (tr.t > 0) { tr.t -= dt; if (tr.t <= 0) world.set(tr.ent, Transform, { posY: -50, scaleX: HIDE, scaleY: HIDE, scaleZ: HIDE }); }
    }

    // ── enemies ──────────────────────────────────────────────────────────
    for (const en of enemies) {
      if (!en.alive) {
        en.respawn -= dt;
        if (en.respawn <= 0 && !state.dead) respawnEnemy(en, true);
        continue;
      }
      const dx = state.px - en.x, dz = state.pz - en.z;
      const d = Math.hypot(dx, dz) || 1;
      let moving = false;
      if (!state.dead && d > 1.35) {
        const step = en.speed * dt; en.x += (dx / d) * step; en.z += (dz / d) * step; moving = true;
        en.phase += dt * en.speed * 2.2;
      } else if (!state.dead) {
        en.attackCd -= dt;
        if (en.attackCd <= 0) {
          en.attackCd = 0.7; state.health -= 9; hud.dmg.style.opacity = '1'; state.shake = Math.min(state.shake + 0.1, 0.2); audio.hurt();
          if (state.health <= 0) { state.health = 0; state.dead = true; postCapture(false); try { document.exitPointerLock(); } catch { /* */ } setLocked(false); hud.over.style.display = 'flex'; }
        }
      }
      // ── enemy collision: world obstacles + separation from squadmates ──
      [en.x, en.z] = resolveObstacles(en.x, en.z, 0.55);
      // Enemy follows scene terrain — instant ground snap (no gravity, no jump
      // for enemies in this build; STEP_UP inside floorAt still lets them climb
      // stairs naturally as long as the per-step rise stays under 0.6 m).
      if (meshCol) en.feetY = meshCol.floorAt(en.x, en.z, en.feetY);
      for (const other of enemies) {
        if (other === en || !other.alive) continue;
        const sx = en.x - other.x, sz = en.z - other.z; const sd = Math.hypot(sx, sz); const min = 1.05;
        if (sd < min && sd > 0.0001) {
          const push = (min - sd) * 0.5;
          en.x += (sx / sd) * push; en.z += (sz / sd) * push;
          other.x -= (sx / sd) * push; other.z -= (sz / sd) * push;
        }
      }
      en.x = clamp(en.x, -BOUND, BOUND); en.z = clamp(en.z, -BOUND, BOUND);

      en.face = Math.atan2(dx, dz);
      quat.fromAxisAngle(eq, [0, 1, 0], en.face);
      const swing = Math.sin(en.phase) * (moving ? 0.22 : 0.02);
      const vbob = moving ? Math.abs(Math.sin(en.phase)) * 0.05 : 0;
      for (const pt of en.parts) {
        let lz = pt.lz;
        if (pt.anim === 'legL' || pt.anim === 'footL') lz += swing;
        else if (pt.anim === 'legR' || pt.anim === 'footR') lz -= swing;
        else if (pt.anim === 'armL' || pt.anim === 'handL') lz -= swing * 0.8;
        else if (pt.anim === 'armR' || pt.anim === 'handR') lz += swing * 0.8;
        quat.transformVec3(off, eq, [pt.lx, pt.ly + vbob, lz]);
        world.set(pt.ent, Transform, {
          posX: en.x + off[0], posY: en.feetY + off[1], posZ: en.z + off[2],
          quatX: eq[0], quatY: eq[1], quatZ: eq[2], quatW: eq[3],
          scaleX: pt.sx, scaleY: pt.sy, scaleZ: pt.sz,
        });
      }
      // hit flash
      if (en.flash > 0) en.flash -= dt;
      const wantFlash = en.flash > 0;
      if (wantFlash !== en.matIsFlash) {
        en.matIsFlash = wantFlash;
        for (const pt of en.parts) if (pt.flashable) world.set(pt.ent, MeshRenderer, { materials: [wantFlash ? matFlashHit : defaultMatFor(pt)] });
      }
    }

    // HUD timers
    if (hudHitT > 0) { hudHitT -= dt; if (hudHitT <= 0) hud.hit.style.opacity = '0'; }
    const dop = parseFloat(hud.dmg.style.opacity || '0');
    if (dop > 0) hud.dmg.style.opacity = String(Math.max(0, dop - dt * 2));
    // dynamic crosshair gap
    const gap = 5 + (state.bloom + (state.ads > 0.5 ? 0 : WEAPONS[state.weapon].spread)) * 420 + state.recoil * 60;
    hud.setGap(state.ads > 0.85 && WEAPONS[state.weapon].scope ? 999 : gap);
    hud.scope.style.opacity = WEAPONS[state.weapon].scope && state.ads > 0.85 ? '1' : '0';

    syncHud();
  });

  // ── HUD sync ──────────────────────────────────────────────────────────────
  function syncHud() {
    const w = WEAPONS[state.weapon]; const a = ammoState[state.weapon];
    const alive = enemies.reduce((n, e) => n + (e.alive ? 1 : 0), 0);
    hud.score.textContent = String(state.score);
    hud.kills.textContent = String(state.kills);
    hud.health.textContent = String(Math.ceil(state.health));
    hud.hpBar.style.width = clamp(state.health, 0, 100) + '%';
    hud.hpBar.style.background = state.health > 40 ? '#7CFC8A' : state.health > 20 ? '#FFD23F' : '#FF4D4D';
    hud.ammo.textContent = state.reloading > 0 ? 'RELOADING' : a.mag + ' / ' + a.reserve;
    hud.wname.textContent = w.name;
    hud.enemies.textContent = String(alive);
    for (let i = 0; i < hud.wslots.length; i++) hud.wslots[i].style.opacity = i === state.weapon ? '1' : '0.4';
    hud.start.style.display = state.started || state.dead ? 'none' : 'flex';
    hud.finalScore.textContent = String(state.score);
    hud.finalKills.textContent = String(state.kills);
  }
  syncHud();
};

// ── DOM HUD ───────────────────────────────────────────────────────────────
function buildHud(mount: HTMLElement) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;pointer-events:none;font-family:"Segoe UI",system-ui,sans-serif;color:#eaf2ff;z-index:9999;user-select:none';
  wrap.innerHTML = `
    <style>
      .ss-ln{position:absolute;background:#9effa0;box-shadow:0 0 4px #000;transition:background .1s}
      .ss-dot{position:absolute;left:50%;top:50%;width:3px;height:3px;border-radius:50%;background:#9effa0;transform:translate(-50%,-50%);box-shadow:0 0 4px #000}
      .ss-hit{position:absolute;left:50%;top:50%;width:26px;height:26px;transform:translate(-50%,-50%) rotate(45deg);opacity:0;transition:opacity .08s}
      .ss-hit .ss-ln{transition:none}
      .ss-panel{position:absolute}
      .ss-num{font-size:32px;font-weight:800;letter-spacing:1px;text-shadow:0 2px 8px #000}
      .ss-lbl{font-size:11px;letter-spacing:3px;opacity:.6;text-transform:uppercase}
      .ss-bar{width:210px;height:9px;background:rgba(255,255,255,.12);border-radius:5px;margin-top:6px;overflow:hidden}
      .ss-bar>div{height:100%;border-radius:5px;transition:width .12s}
      .ss-wlist{position:absolute;right:30px;top:96px;text-align:right;font-size:13px;letter-spacing:2px;line-height:1.9}
      .ss-screen{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:radial-gradient(ellipse at center,rgba(8,10,16,.5),rgba(3,4,8,.93))}
      .ss-title{font-size:48px;font-weight:900;letter-spacing:7px;text-shadow:0 4px 26px #000}
      .ss-sub{margin-top:14px;font-size:15px;letter-spacing:2px;opacity:.85}
      .ss-hint{margin-top:24px;font-size:13px;letter-spacing:1px;opacity:.6;max-width:520px;text-align:center;line-height:1.8}
      .ss-dead{color:#ff5a5a}
      .ss-scope{position:absolute;inset:0;opacity:0;transition:opacity .12s;background:radial-gradient(circle at center, transparent 0 22%, rgba(0,0,0,.55) 30%, #000 34%);}
      .ss-scope::before{content:"";position:absolute;left:50%;top:0;width:1px;height:100%;background:rgba(120,255,150,.5);transform:translateX(-50%)}
      .ss-scope::after{content:"";position:absolute;top:50%;left:0;height:1px;width:100%;background:rgba(120,255,150,.5);transform:translateY(-50%)}
    </style>
    <div id="ssCross">
      <div class="ss-ln" id="lnT"></div><div class="ss-ln" id="lnB"></div>
      <div class="ss-ln" id="lnL"></div><div class="ss-ln" id="lnR"></div>
      <div class="ss-dot"></div>
    </div>
    <div class="ss-hit" id="ssHit"><div class="ss-ln" id="hk0"></div><div class="ss-ln" id="hk1"></div></div>
    <div class="ss-scope" id="ssScope"></div>
    <div id="ssDmg" style="position:absolute;inset:0;box-shadow:inset 0 0 170px 46px rgba(220,0,0,.85);opacity:0;transition:opacity .1s"></div>

    <div class="ss-panel" style="left:26px;bottom:22px">
      <div class="ss-lbl">HEALTH</div><div class="ss-num"><span id="ssHp">100</span></div>
      <div class="ss-bar"><div id="ssHpBar" style="width:100%"></div></div>
    </div>
    <div class="ss-panel" style="right:30px;bottom:22px;text-align:right">
      <div class="ss-lbl" id="ssWName">M4 CARBINE</div><div class="ss-num" id="ssAmmo">30 / 240</div>
    </div>
    <div class="ss-panel" style="right:30px;top:20px;text-align:right">
      <div class="ss-lbl">SCORE</div><div class="ss-num" id="ssScore">0</div>
      <div class="ss-lbl" style="margin-top:6px">KILLS <span id="ssKills">0</span> · HOSTILES <span id="ssEn">0</span></div>
    </div>
    <div class="ss-wlist">
      <div id="w0">1 · M4 CARBINE</div><div id="w1">2 · MP5 SMG</div>
      <div id="w2">3 · SPAS SHOTGUN</div><div id="w3">4 · AWP SNIPER</div>
    </div>

    <div class="ss-screen" id="ssStart">
      <div class="ss-title">SECTOR STRIKE</div>
      <div class="ss-sub">CLICK TO DEPLOY</div>
      <div class="ss-hint">WASD move · MOUSE look · CLICK fire · RIGHT-MOUSE aim · SHIFT sprint · R reload · 1-4 / Q / wheel switch weapon<br/>Headshots deal double damage. Hold the line.</div>
    </div>
    <div class="ss-screen" id="ssOver" style="display:none">
      <div class="ss-title ss-dead">YOU DIED</div>
      <div class="ss-sub">SCORE <span id="ssFinal">0</span> · KILLS <span id="ssFinalK">0</span></div>
      <div class="ss-hint">Click to redeploy.</div>
    </div>`;
  mount.appendChild(wrap);
  const q = (id: string) => wrap.querySelector<HTMLElement>('#' + id)!;
  const lnT = q('lnT'), lnB = q('lnB'), lnL = q('lnL'), lnR = q('lnR');
  const LEN = 9;
  const setGap = (g: number) => {
    if (g > 500) { for (const e of [lnT, lnB, lnL, lnR]) e.style.opacity = '0'; return; }
    for (const e of [lnT, lnB, lnL, lnR]) e.style.opacity = '1';
    lnT.style.cssText = `position:absolute;background:#9effa0;box-shadow:0 0 4px #000;left:calc(50% - 1px);top:calc(50% - ${g + LEN}px);width:2px;height:${LEN}px`;
    lnB.style.cssText = `position:absolute;background:#9effa0;box-shadow:0 0 4px #000;left:calc(50% - 1px);top:calc(50% + ${g}px);width:2px;height:${LEN}px`;
    lnL.style.cssText = `position:absolute;background:#9effa0;box-shadow:0 0 4px #000;top:calc(50% - 1px);left:calc(50% - ${g + LEN}px);height:2px;width:${LEN}px`;
    lnR.style.cssText = `position:absolute;background:#9effa0;box-shadow:0 0 4px #000;top:calc(50% - 1px);left:calc(50% + ${g}px);height:2px;width:${LEN}px`;
  };
  setGap(6);
  // hitmarker X
  const hk0 = q('hk0'), hk1 = q('hk1');
  hk0.style.cssText = 'position:absolute;left:50%;top:0;width:2px;height:100%;background:#fff;transform:translateX(-50%)';
  hk1.style.cssText = 'position:absolute;top:50%;left:0;height:2px;width:100%;background:#fff;transform:translateY(-50%)';

  return {
    score: q('ssScore'), kills: q('ssKills'), health: q('ssHp'), hpBar: q('ssHpBar'),
    ammo: q('ssAmmo'), wname: q('ssWName'), enemies: q('ssEn'),
    dmg: q('ssDmg'), hit: q('ssHit'), hitLines: [hk0, hk1], scope: q('ssScope'),
    start: q('ssStart'), over: q('ssOver'), finalScore: q('ssFinal'), finalKills: q('ssFinalK'),
    wslots: [q('w0'), q('w1'), q('w2'), q('w3')],
    setGap,
  };
}

// ── procedural audio (Web Audio API; zero asset files) ─────────────────────
function makeAudio() {
  let ctx: AudioContext | null = null;
  let master: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let ambient = false;

  const ensure = () => {
    if (ctx) return;
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 0.5);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  };
  const resume = () => { ensure(); if (ctx && ctx.state === 'suspended') void ctx.resume(); };

  const noise = (when: number, dur: number, vol: number, type: BiquadFilterType, freq: number, q = 1) => {
    if (!ctx || !master || !noiseBuf) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  };
  const tone = (when: number, freq: number, dur: number, vol: number, type: OscillatorType = 'sine', slideTo?: number) => {
    if (!ctx || !master) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = type;
    const g = ctx.createGain();
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.02);
  };

  const shot = (w: number) => {
    ensure();
    if (w === 0) { noise(0, 0.12, 0.5, 'highpass', 1100); tone(0, 150, 0.12, 0.4, 'square', 60); }
    else if (w === 1) { noise(0, 0.07, 0.42, 'highpass', 1700); tone(0, 190, 0.07, 0.3, 'square', 90); }
    else if (w === 2) { noise(0, 0.3, 0.6, 'lowpass', 850); tone(0, 95, 0.28, 0.55, 'sine', 42); }
    else { noise(0, 0.26, 0.65, 'highpass', 750); tone(0, 130, 0.32, 0.6, 'sawtooth', 48); }
  };
  const hit = () => { ensure(); tone(0, 1500, 0.05, 0.28, 'square'); };
  const kill = () => { ensure(); tone(0, 900, 0.04, 0.3, 'square'); tone(0.04, 1400, 0.08, 0.3, 'square'); };
  const empty = () => { ensure(); noise(0, 0.03, 0.25, 'highpass', 3500); };
  const reload = () => { ensure(); noise(0, 0.04, 0.3, 'bandpass', 2200, 2); noise(0.22, 0.05, 0.3, 'bandpass', 1500, 2); noise(0.5, 0.05, 0.35, 'bandpass', 2600, 2); };
  const swap = () => { ensure(); noise(0, 0.03, 0.2, 'bandpass', 2000, 2); tone(0.02, 520, 0.06, 0.16, 'square'); };
  const hurt = () => { ensure(); tone(0, 90, 0.22, 0.5, 'sine', 45); noise(0, 0.16, 0.3, 'lowpass', 380); };

  const startAmbient = () => {
    ensure();
    if (!ctx || !master || ambient) return;
    ambient = true;
    const g = ctx.createGain(); g.gain.value = 0.05; g.connect(master);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 220; f.connect(g);
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = 55; o1.connect(f);
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = 58; o2.connect(f);
    o1.start(); o2.start();
  };

  // Tear down the AudioContext (closes the ambient drone + frees the WebAudio
  // graph) so ■ Stop leaves no running oscillators. Guarded: close() rejects if
  // already closed, and ctx may never have been created (ensure() never ran).
  const close = () => {
    if (ctx && ctx.state !== 'closed') { void ctx.close().catch(() => {}); }
    ctx = null; master = null; noiseBuf = null; ambient = false;
  };

  return { resume, startAmbient, shot, hit, kill, empty, reload, swap, hurt, close };
}

// end of bootstrap
