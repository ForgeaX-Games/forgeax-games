import {
  Transform, Camera, perspective, quat, Materials, MeshFilter, MeshRenderer,
  HANDLE_CUBE, HANDLE_SPHERE, createCylinderGeometry, createSphereGeometry, ChildOf,
  SceneInstance,
  Skylight, SkyboxBackground, SKYBOX_MODE_CUBEMAP, TONEMAP_ACES_FILMIC,
  BLOOM_DISABLED, ANTIALIAS_MSAA, PointLight,
  type MaterialAsset, type Handle,
} from '@forgeax/engine-runtime';
import { Collider, ColliderShapeValue, RigidBody, RigidBodyTypeValue } from '@forgeax/engine-physics';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import type { Entity } from '@forgeax/engine-ecs';
import type { GameEntry } from '@forgeax/engine-app';
import type { SceneAsset, LocalNodeId, TextureAsset } from '@forgeax/engine-types';
import { installHud, type UpgradeChoice, type ViewMode } from './src/hud';

type MatHandle = Handle<'MaterialAsset', 'shared'>;

const SKY_HDR_GUID = '81eec382-392f-5a93-8998-0ecf11ef7990';
const CYLINDER_GUID = 'c1111111-0000-5000-8000-000000000001';
const HANDLE_FIELD: Record<string, string> = { MeshFilter: 'assetHandle', MeshRenderer: 'material' };
const STRIP_COMPONENTS = new Set(['Collider']);

interface PackNode { localId: number; components: Record<string, Record<string, unknown>> }
interface PackAsset { guid: string; kind: string; payload: unknown; refs?: string[] }
interface ScenePack { assets: PackAsset[] }

interface EnemyType {
  id: string;
  name: string;
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  xp: number;
  score: number;
  color: readonly [number, number, number, number];
  scale: number;
  boss?: boolean;
}

interface Enemy {
  e: Entity;
  parts: Entity[];
  type: EnemyType;
  hp: number;
  maxHp: number;
  x: number;
  z: number;
  y: number;
  radius: number;
  slow: number;
  burn: number;
  burnTick: number;
  knockX: number;
  knockZ: number;
  flash: number;
  hitPulse: number;
}

interface Bullet {
  e: Entity;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
  radius: number;
  damage: number;
  pierce: number;
  kind: 'stake' | 'bone' | 'fire' | 'ice';
  hit: Set<Entity>;
}

interface Spark {
  e: Entity;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  life: number;
}

interface Pickup {
  e: Entity;
  x: number;
  z: number;
  xp: number;
  age: number;
}

const ENEMY_TYPES: EnemyType[] = [
  { id: 'calf', name: 'Fallen Calf', hp: 24, speed: 2.25, damage: 8, radius: 0.42, xp: 2, score: 12, color: [0.72, 0.62, 0.48, 1], scale: 0.78 },
  { id: 'cow', name: 'Hell Bovine', hp: 42, speed: 1.85, damage: 12, radius: 0.55, xp: 3, score: 20, color: [0.86, 0.78, 0.62, 1], scale: 1 },
  { id: 'bull', name: 'Bone Bull', hp: 85, speed: 1.45, damage: 18, radius: 0.7, xp: 6, score: 45, color: [0.64, 0.72, 0.78, 1], scale: 1.18 },
  { id: 'shaman', name: 'Moo Shaman', hp: 58, speed: 1.25, damage: 15, radius: 0.5, xp: 7, score: 55, color: [0.76, 0.32, 0.95, 1], scale: 0.95 },
  { id: 'butcher', name: 'Butcher Cow', hp: 125, speed: 1.05, damage: 26, radius: 0.78, xp: 10, score: 90, color: [0.98, 0.28, 0.22, 1], scale: 1.28 },
  { id: 'king', name: 'The Cow King', hp: 520, speed: 0.92, damage: 34, radius: 1.08, xp: 40, score: 450, color: [1, 0.86, 0.22, 1], scale: 1.75, boss: true },
];

async function installHdrSky(ctx: Parameters<GameEntry>[0]): Promise<void> {
  // ALWAYS spawn a solid-color Skylight first. Without a Skylight the forgeax
  // PBR shader computes ambient=0, so a lone DirectionalLight leaves shaded
  // faces black ("天光没了"). A cubemap-less Skylight binds the engine's 1×1
  // white irradiance cube — ambient is live on the first frame with no async GPU
  // work, and it works on WebKit/WKWebView (desktop app) whose WebGPU lacks the
  // rgba16float render-attachment the IBL precompute needs. Dim cool fill keeps
  // the dark mood while still letting surfaces read.
  const skylight = ctx.world.spawn(
    { component: Skylight, data: { colorR: 0.62, colorG: 0.7, colorB: 0.9, intensity: 0.25 } },
  ).unwrap();

  // WebKit/WKWebView guard — calling uploadCubemapFromEquirect there poisons the
  // WebGPU device → first frame never renders → Play sticks on "Loading game"
  // forever. Keep the solid ambient above and stop here. Negative allowlist
  // (NOT Chrome/Chromium/Edg) is robust against Playwright's "HeadlessChrome" UA.
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isChromium = /Chrome|Chromium|Edg/.test(ua);
  if (!isChromium) {
    console.info('[暗黑奶牛关] non-Chromium WebGPU (WebKit/WKWebView): solid-color skylight only (no IBL/skybox)');
    return;
  }
  const renderer = (ctx.app as unknown as { renderer?: { store?: { uploadCubemapFromEquirect?: unknown } } })?.renderer;
  const store = renderer?.store;
  if (!store || typeof store.uploadCubemapFromEquirect !== 'function') return;
  const guidRes = AssetGuid.parse(SKY_HDR_GUID);
  if (!guidRes.ok) return;
  // loadByGuid returns the payload (D-17); mint a source column handle, then
  // call the 3-arg uploadCubemapFromEquirect(world, sourceHandle, sourcePod).
  const podRes = await ctx.assets.loadByGuid<TextureAsset>(guidRes.value);
  if (!podRes.ok) return;
  const srcHandle = ctx.world.allocSharedRef<'TextureAsset', TextureAsset>('TextureAsset', podRes.value);
  const upload = store.uploadCubemapFromEquirect as (w: unknown, h: unknown, p: unknown) => Promise<{ ok: boolean; value?: unknown }>;
  const cubemapRes = await upload.call(store, ctx.world, srcHandle, podRes.value);
  if (!cubemapRes.ok || cubemapRes.value === undefined) return;
  // Upgrade the existing Skylight to image-based lighting (neutral tint lets the
  // HDR drive the color).
  ctx.world.set(skylight, Skylight, { cubemap: cubemapRes.value, colorR: 1, colorG: 1, colorB: 1, intensity: 0.12 });
  ctx.world.spawn({ component: SkyboxBackground, data: { cubemap: cubemapRes.value, mode: SKYBOX_MODE_CUBEMAP } });
}

async function instantiateScenePack(
  pack: ScenePack,
  ctx: Parameters<GameEntry>[0],
): Promise<{ mapping: ReadonlyMap<number, Entity>; nodes: PackNode[] } | null> {
  const sceneEntry = pack.assets.find((a) => a.kind === 'scene');
  if (!sceneEntry) { console.error('[cowhell] no scene asset in pack'); return null; }
  const scenePayload = sceneEntry.payload as { kind: 'scene'; entities?: PackNode[]; nodes?: PackNode[] };
  const packNodes = scenePayload.entities ?? scenePayload.nodes ?? [];
  const refs = sceneEntry.refs ?? [];
  console.info(`[cowhell] scene pack: ${packNodes.length} nodes, ${refs.length} refs, guid=${sceneEntry.guid}`);

  for (const a of pack.assets) {
    if (a.kind !== 'material') continue;
    const g = AssetGuid.parse(a.guid);
    if (!g.ok) { console.error(`[cowhell] material guid parse failed: ${a.guid}`, g.error); continue; }
    const matRes = ctx.assets.catalog<MaterialAsset>(g.value, a.payload as MaterialAsset);
    if (!matRes.ok) console.error(`[cowhell] catalog(material ${a.guid}) failed`, matRes.error);
  }
  const cylG = AssetGuid.parse(CYLINDER_GUID);
  const cylGeo = createCylinderGeometry(0.5, 0.5, 1, 18);
  if (!cylG.ok) console.error('[cowhell] cylinder guid parse failed', cylG.error);
  if (!cylGeo.ok) console.error('[cowhell] createCylinderGeometry failed', cylGeo.error);
  if (cylG.ok && cylGeo.ok) {
    const cylRes = ctx.assets.catalog(cylG.value, cylGeo.value);
    if (!cylRes.ok) console.error('[cowhell] catalog(cylinder) failed', cylRes.error);
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
          resolved[field] = (hf === field && typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < refs.length)
            ? refs[value]
            : value;
        }
        if (name === 'MeshRenderer' && 'material' in resolved) {
          const single = resolved.material;
          delete resolved.material;
          resolved.materials = single === undefined || single === null ? [] : [single];
        }
        // engine #387 (CSM) replaced DirectionalLightShadow's single-cascade
        // `orthoHalfExtent` with cascade fields. Old packs still carry it;
        // strip + map to `cascadeCount: 1` so the additionalProperties:false
        // schema validator accepts the node instead of failing the whole
        // scene instantiate (which would drop us to the lightless fallback).
        if (name === 'DirectionalLightShadow' && 'orthoHalfExtent' in resolved) {
          delete resolved.orthoHalfExtent;
          if (!('cascadeCount' in resolved)) resolved.cascadeCount = 1;
        }
        components[name] = resolved;
      }
      return { localId: n.localId as LocalNodeId, components };
    }),
  };

  const sceneGuid = AssetGuid.parse(sceneEntry.guid);
  if (!sceneGuid.ok) { console.error('[cowhell] scene guid parse failed', sceneGuid.error); return null; }
  // engine #330 (feat-20260608-scene-nesting-ecs-fication) removed the
  // standalone `world.sceneInstances` container: `assets.instantiate` now
  // auto-wires the World-level SceneAsset resolver and returns the synthetic
  // root Entity directly. Read the localId -> Entity table off the new
  // `SceneInstance` ECS component on that root (`mapping` is a Uint32Array
  // indexed positionally by the authored localId).
  const catRes = ctx.assets.catalog<SceneAsset>(sceneGuid.value, sceneAsset);
  if (!catRes.ok) { console.error('[cowhell] catalog(scene) failed', catRes.error); return null; }
  // loadByGuid returns the payload (D-17, recursively cataloguing refs); mint a
  // user-tier column handle before instantiate.
  const payloadRes = await ctx.assets.loadByGuid<SceneAsset>(sceneGuid.value);
  if (!payloadRes.ok) { console.error('[cowhell] scene loadByGuid failed', payloadRes.error); return null; }
  const sceneHandle = ctx.world.allocSharedRef<'SceneAsset', SceneAsset>('SceneAsset', payloadRes.value);
  const instRes = ctx.assets.instantiate<SceneAsset>(sceneHandle, ctx.world);
  if (!instRes.ok) { console.error('[cowhell] scene instantiate failed', instRes.error); return null; }
  const sceneInst = ctx.world.get(instRes.value, SceneInstance);
  if (!sceneInst.ok) { console.error('[cowhell] SceneInstance lookup on synthetic root failed', sceneInst.error); return null; }
  // mapping is a Uint32Array sized totalSlots (= entities.length), indexed by
  // localId: mapping[localId] = entity. The engine requires localIds to be the
  // dense range [0, entities.length); a sparse / out-of-range localId silently
  // overflows the typed array and drops the entity (player not found -> no
  // update loop). scene.pack.json keeps localIds dense 0..N-1 for this reason.
  // Project the array into the Map<localId, Entity> the callers read from,
  // skipping unspawned slots (ENTITY_NULL_RAW = 0xffffffff) and 0.
  const mappingArr = sceneInst.value.mapping as unknown as { length: number; [i: number]: number };
  const mapping = new Map<number, Entity>();
  for (let localId = 0; localId < mappingArr.length; localId++) {
    const e = mappingArr[localId];
    if (e !== undefined && e !== 0xffffffff && e !== 0) mapping.set(localId, e as Entity);
  }
  return { mapping, nodes: packNodes };
}

function spawnGroundCollider(ctx: Parameters<GameEntry>[0]): void {
  ctx.world.spawn(
    { component: Transform, data: { posX: 0, posY: -5, posZ: 0 } },
    { component: RigidBody, data: { type: RigidBodyTypeValue.static } },
    { component: Collider, data: { shape: ColliderShapeValue.cuboid, halfExtentsX: 42, halfExtentsY: 5, halfExtentsZ: 42, friction: 0.95, restitution: 0 } },
  );
}

function setupPlayer(
  ctx: Parameters<GameEntry>[0],
  root: Entity,
  loaded: { mapping: ReadonlyMap<number, Entity>; nodes: PackNode[] },
): void {
  const rt = ctx.world.get(root, Transform);
  const rx = rt.ok ? rt.value.posX : 0, ry = rt.ok ? rt.value.posY : 0.8, rz = rt.ok ? rt.value.posZ : 0;
  const rsx = rt.ok ? rt.value.scaleX || 1 : 1;
  const rsy = rt.ok ? rt.value.scaleY || 1 : 1;
  const rsz = rt.ok ? rt.value.scaleZ || 1 : 1;
  for (const node of loaded.nodes) {
    const nm = (node.components.Name as { value?: string } | undefined)?.value;
    if (!nm || nm === 'Player' || !nm.startsWith('Player')) continue;
    const e = loaded.mapping.get(node.localId);
    if (e === undefined) continue;
    const t = ctx.world.get(e, Transform);
    if (!t.ok) continue;
    const alreadyParented = node.components.ChildOf !== undefined;
    if (!alreadyParented) {
      ctx.world.addComponent(e, { component: ChildOf, data: { parent: root } });
      ctx.world.set(e, Transform, {
        posX: (t.value.posX - rx) / rsx,
        posY: (t.value.posY - ry) / rsy,
        posZ: (t.value.posZ - rz) / rsz,
        scaleX: (t.value.scaleX || 1) / rsx,
        scaleY: (t.value.scaleY || 1) / rsy,
        scaleZ: (t.value.scaleZ || 1) / rsz,
      });
    }
  }
  ctx.world.addComponent(root, { component: RigidBody, data: { type: RigidBodyTypeValue.kinematic } });
  ctx.world.addComponent(root, { component: Collider, data: { shape: ColliderShapeValue.capsule, radius: 0.35, halfHeight: 0.48, friction: 0.8 } });
}

function attachPackPhysics(ctx: Parameters<GameEntry>[0], loaded: { mapping: ReadonlyMap<number, Entity>; nodes: PackNode[] }): void {
  for (const node of loaded.nodes) {
    const name = (node.components.Name as { value?: string } | undefined)?.value ?? '';
    const e = loaded.mapping.get(node.localId);
    if (e === undefined || name === 'Player' || name.startsWith('Player')) continue;
    const t = (node.components.Transform ?? {}) as Record<string, number>;
    const sx = t.scaleX ?? 1, sy = t.scaleY ?? 1, sz = t.scaleZ ?? 1;
    if (name === 'Ground') continue;
    if (name.startsWith('Fence') || name.startsWith('Stone') || name.startsWith('Portal') || name.startsWith('Torch')) {
      ctx.world.addComponent(e, { component: RigidBody, data: { type: RigidBodyTypeValue.static } });
      ctx.world.addComponent(e, { component: Collider, data: { shape: ColliderShapeValue.cuboid, halfExtentsX: sx * 0.5, halfExtentsY: sy * 0.5, halfExtentsZ: sz * 0.5, friction: 0.8, restitution: 0.05 } });
    }
    if (name.startsWith('Barrel') || name.startsWith('BonePile')) {
      ctx.world.addComponent(e, { component: RigidBody, data: { type: RigidBodyTypeValue.dynamic, mass: 1.6, linearDamping: 0.35, angularDamping: 0.4, ccdEnabled: true } });
      ctx.world.addComponent(e, { component: Collider, data: { shape: ColliderShapeValue.cuboid, halfExtentsX: sx * 0.5, halfExtentsY: sy * 0.5, halfExtentsZ: sz * 0.5, friction: 0.65, restitution: 0.25 } });
    }
  }
}

function spawnFallbackScene(ctx: Parameters<GameEntry>[0]): void {
  const mat = ctx.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({ baseColor: [0.18, 0.08, 0.08, 1], roughness: 0.95 }));
  ctx.world.spawn(
    { component: Transform, data: { posY: -0.08, scaleX: 36, scaleY: 0.16, scaleZ: 36 } },
    { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
    { component: MeshRenderer, data: { materials: [mat] } },
  );
}

const start: GameEntry = async (ctx) => {
  const { world, registerUpdate } = ctx;
  const canvas = document.querySelector<HTMLCanvasElement>('#app')!;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  const aspect = canvas.width / canvas.height || 1;

  let loaded: { mapping: ReadonlyMap<number, Entity>; nodes: PackNode[] } | null = null;
  try {
    const res = await fetch(new URL('./scene.pack.json', import.meta.url), { cache: 'no-store' });
    if (!res.ok) throw new Error(`scene.pack.json ${res.status}`);
    loaded = await instantiateScenePack(await res.json() as ScenePack, ctx);
  } catch (err) {
    console.error('[cowhell] scene pack unavailable (threw)', err);
  }
  if (!loaded) {
    console.error('[cowhell] FALLBACK scene active — only ground will render (scene pack returned null or threw)');
    spawnFallbackScene(ctx);
  }
  spawnGroundCollider(ctx);
  void installHdrSky(ctx);

  let player: Entity | undefined;
  let px = 0, pz = 0;
  if (loaded) {
    attachPackPhysics(ctx, loaded);
    const node = loaded.nodes.find((n) => (n.components.Name as { value?: string } | undefined)?.value === 'Player');
    if (node) {
      const t = (node.components.Transform ?? {}) as Record<string, number>;
      px = t.posX ?? 0; pz = t.posZ ?? 0;
      player = loaded.mapping.get(node.localId);
      if (player !== undefined) setupPlayer(ctx, player, loaded);
    }
  }
  if (player === undefined) console.error('[cowhell] Player entity not resolved — game loop will not start (check scene.pack.json localIds are dense 0..N-1)');

  const topPitch = -Math.atan2(15, 10);
  const topQ = quat.create();
  quat.fromAxisAngle(topQ, [1, 0, 0], topPitch);
  let camX = px, camZ = pz + 10;
  const camera = world.spawn(
    { component: Transform, data: { posX: camX, posY: 15, posZ: camZ, quatX: topQ[0]!, quatY: topQ[1]!, quatZ: topQ[2]!, quatW: topQ[3]! } },
    // engine #387 (CSM) changed the swap-chain attachment format; the FXAA +
    // bloom post path (@location(0) -> swap-chain) then raises "RenderPipeline
    // not compatible with RenderPassEncoder" every frame (stray pixels / black
    // flashes on refresh). Match cow-survivor's verified-stable combo: MSAA +
    // bloom off + ACES tonemap, which renders through the engine's default urp
    // pipeline cleanly.
    // clearR/G/B = visible sky on WebKit (the desktop app can't render the
    // cubemap skybox; without this the background is black). Dark night-blue;
    // linear/pre-ACES. On Chromium the cubemap skybox draws over it.
    { component: Camera, data: { ...perspective({ fov: Math.PI / 3, aspect, near: 0.1, far: 220 }), tonemap: TONEMAP_ACES_FILMIC, bloom: BLOOM_DISABLED, antialias: ANTIALIAS_MSAA, clearR: 0.05, clearG: 0.07, clearB: 0.13 } },
  ).unwrap();
  world.spawn({ component: Transform, data: { posX: -4, posY: 6, posZ: 2 } }, { component: PointLight, data: { colorR: 1, colorG: 0.18, colorB: 0.08, intensity: 65, range: 24 } });
  world.spawn({ component: Transform, data: { posX: 6, posY: 4.5, posZ: -5 } }, { component: PointLight, data: { colorR: 0.55, colorG: 0.18, colorB: 1, intensity: 45, range: 18 } });

  const enemyMats = new Map<string, MatHandle>();
  for (const t of ENEMY_TYPES) {
    enemyMats.set(t.id, world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({ baseColor: t.color, roughness: 0.7, metallic: 0.05, emissive: t.boss ? [1, 0.45, 0.05] : undefined, emissiveIntensity: t.boss ? 1.8 : undefined })));
  }
  const mkMat = (m: MaterialAsset): MatHandle =>
    world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', m);
  const hornMat = mkMat(Materials.standard({ baseColor: [0.9, 0.82, 0.66, 1], roughness: 0.55 }));
  const hoofMat = mkMat(Materials.standard({ baseColor: [0.08, 0.05, 0.045, 1], roughness: 0.75 }));
  const flashMat = mkMat(Materials.standard({ baseColor: [1, 1, 0.9, 1], roughness: 0.3, emissive: [1, 0.78, 0.25], emissiveIntensity: 6 }));
  const xpMat = mkMat(Materials.unlit([0.25, 1, 0.48, 1], { castShadow: false }));
  const bloodMat = mkMat(Materials.unlit([1, 0.04, 0.08, 1], { castShadow: false }));
  const stakeMat = mkMat(Materials.standard({ baseColor: [1, 0.85, 0.42, 1], roughness: 0.35, emissive: [1, 0.62, 0.1], emissiveIntensity: 4, castShadow: false }));
  const boneMat = mkMat(Materials.standard({ baseColor: [0.88, 0.86, 0.74, 1], roughness: 0.45, castShadow: false }));
  const fireMat = mkMat(Materials.unlit([1, 0.25, 0.05, 1], { castShadow: false }));
  const iceMat = mkMat(Materials.unlit([0.35, 0.9, 1, 1], { castShadow: false }));
  const orbitMat = mkMat(Materials.unlit([1, 0.05, 0.14, 1], { castShadow: false }));
  const sparkMat = mkMat(Materials.unlit([1, 0.58, 0.12, 1], { castShadow: false }));
  const smallSphere = createSphereGeometry(0.16, 10, 6);
  const bulletMesh = smallSphere.ok ? world.allocSharedRef('MeshAsset', smallSphere.value) : HANDLE_SPHERE;
  const tinySphere = createSphereGeometry(0.08, 8, 5);
  const sparkMesh = tinySphere.ok ? world.allocSharedRef('MeshAsset', tinySphere.value) : HANDLE_SPHERE;
  const cyl = createCylinderGeometry(0.35, 0.35, 1, 14);
  const cylinderMesh = cyl.ok ? world.allocSharedRef('MeshAsset', cyl.value) : HANDLE_CUBE;

  const hud = installHud({
    initialMode: 'topdown',
    onToggle: () => setMode(mode === 'fps' ? 'topdown' : 'fps'),
    onChoose: (id) => chooseUpgrade(id),
    onRestart: () => window.location.reload(),
  });

  let mode: ViewMode = 'topdown';
  let locked = false;
  let lookYaw = 0;
  let lookPitch = 0;
  let faceX = 0, faceZ = -1;
  let playerY = 0.82;
  let invuln = 0;
  let time = 0;
  let kills = 0;
  let score = 0;
  let level = 1;
  let xp = 0;
  let nextXp = 12;
  let paused = false;
  let gameOver = false;
  let bossSpawned = false;
  let shake = 0;
  const playerStats = { hp: 115, maxHp: 115, speed: 5.8, magnet: 4.2, regen: 0.45, might: 1, fireRate: 1, armor: 0 };
  const weapons = {
    stake: { level: 1, cd: 0, interval: 0.34 },
    bones: { level: 1, cd: 0, interval: 1.1 },
    orbit: { level: 1, t: 0, hitCd: new Map<Entity, number>() },
    fire: { level: 0, cd: 0, interval: 1.9 },
    frost: { level: 0, cd: 0, interval: 2.6 },
  };
  const enemies: Enemy[] = [];
  const bullets: Bullet[] = [];
  const sparks: Spark[] = [];
  const pickups: Pickup[] = [];
  const keys: Record<string, boolean> = {};

  const setMode = (m: ViewMode) => {
    mode = m;
    hud.setMode(m);
    canvas.style.cursor = m === 'fps' ? 'crosshair' : '';
    if (m !== 'fps' && locked) releasePointer();
  };
  const setLocked = (v: boolean) => {
    locked = v;
    canvas.style.cursor = v ? 'none' : (mode === 'fps' ? 'crosshair' : '');
    hud.setLockStatus(v ? '鼠标已锁定 · ESC 释放' : '点击画面锁定鼠标');
  };
  const releasePointer = () => {
    try { document.exitPointerLock?.(); } catch { /* ignore */ }
    try { window.parent.postMessage({ type: 'fx-pointer-capture', capture: false }, '*'); } catch { /* ignore */ }
    setLocked(false);
  };
  const realRequestLock = HTMLElement.prototype.requestPointerLock;
  // requestPointerLock() returns a Promise that REJECTS asynchronously when the
  // window lacks focus (`WrongDocumentError` — common in WKWebView desktop).
  // try/catch can't catch a rejected Promise → unhandled rejection. Wrap: focus-
  // gate (skip if unfocused; next focused click re-locks) + swallow rejection.
  const safeRequestLock = (el: HTMLElement): void => {
    try {
      if (!document.hasFocus()) { try { window.focus(); } catch { /* ignore */ } }
      if (!document.hasFocus()) return;
      const r = realRequestLock.call(el) as unknown;
      if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {});
    } catch { /* pointerlockerror handles fallback */ }
  };
  const isTauri = !!(window as unknown as { __TAURI__?: unknown }).__TAURI__ || !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  document.addEventListener('pointerlockchange', () => setLocked(document.pointerLockElement === canvas));
  document.addEventListener('pointerlockerror', () => {
    if (mode === 'fps') {
      try { window.parent.postMessage({ type: 'fx-pointer-capture', capture: true }, '*'); } catch { /* ignore */ }
      setLocked(true);
    }
  });
  canvas.addEventListener('mousedown', () => {
    if (mode !== 'fps' || locked) return;
    if (isTauri) {
      try { window.parent.postMessage({ type: 'fx-pointer-capture', capture: true }, '*'); } catch { /* ignore */ }
      setLocked(true);
    } else {
      safeRequestLock(canvas);
    }
  });
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Escape' && locked) releasePointer();
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });
  window.addEventListener('mousemove', (e) => {
    if (mode !== 'fps' || !locked || paused || gameOver) return;
    lookYaw -= e.movementX * 0.0022;
    lookPitch = Math.max(-1.15, Math.min(1.05, lookPitch - e.movementY * 0.0022));
  });

  function screenPopup(text: string, wx: number, wy: number, wz: number, kind: Parameters<typeof hud.popup>[3]): void {
    const cam = world.get(camera, Transform);
    if (!cam.ok) return;
    const qx = -cam.value.quatX, qy = -cam.value.quatY, qz = -cam.value.quatZ, qw = cam.value.quatW;
    const dx = wx - cam.value.posX, dy = wy - cam.value.posY, dz = wz - cam.value.posZ;
    const tx = 2 * (qy * dz - qz * dy), ty = 2 * (qz * dx - qx * dz), tz = 2 * (qx * dy - qy * dx);
    const lx = dx + qw * tx + (qy * tz - qz * ty);
    const ly = dy + qw * ty + (qz * tx - qx * tz);
    const lz = dz + qw * tz + (qx * ty - qy * tx);
    if (lz >= -0.05) return;
    const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
    const f = 1 / Math.tan(Math.PI / 6);
    const sx = ((lx * f) / (-lz * (cssW / cssH)) + 1) * 0.5 * cssW;
    const sy = (1 - (ly * f) / -lz) * 0.5 * cssH;
    if (sx > -80 && sx < cssW + 80 && sy > -80 && sy < cssH + 80) hud.popup(text, sx, sy, kind);
  }

  function nearestEnemy(max = 999): Enemy | null {
    let best: Enemy | null = null, bestD = max * max;
    for (const en of enemies) {
      const dx = en.x - px, dz = en.z - pz, d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = en; }
    }
    return best;
  }

  function spawnEnemy(type: EnemyType, angle: number, dist: number): void {
    const x = px + Math.cos(angle) * dist;
    const z = pz + Math.sin(angle) * dist;
    const y = type.scale * 0.55;
    const mat = enemyMats.get(type.id)!;
    const root = world.spawn(
      { component: Transform, data: { posX: x, posY: y, posZ: z } },
      { component: RigidBody, data: { type: RigidBodyTypeValue.kinematic } },
      { component: Collider, data: { shape: ColliderShapeValue.capsule, radius: type.radius, halfHeight: type.scale * 0.34, friction: 0.75, restitution: 0.1 } },
    ).unwrap();
    const part = (ox: number, oy: number, oz: number, sx: number, sy: number, sz: number, mesh: unknown, pm: MatHandle) => {
      const e = world.spawn(
        { component: Transform, data: { posX: ox, posY: oy, posZ: oz, scaleX: sx, scaleY: sy, scaleZ: sz } },
        { component: MeshFilter, data: { assetHandle: mesh as Handle<'MeshAsset', 'shared'> } },
        { component: MeshRenderer, data: { materials: [pm] } },
        { component: ChildOf, data: { parent: root } },
      ).unwrap();
      return e;
    };
    const s = type.scale;
    const parts = [
      part(0, 0.05 * s, 0, 0.9 * s, 0.58 * s, 1.15 * s, HANDLE_CUBE, mat),
      part(0, 0.36 * s, -0.58 * s, 0.52 * s, 0.46 * s, 0.45 * s, HANDLE_CUBE, mat),
      part(-0.27 * s, -0.36 * s, -0.35 * s, 0.18 * s, 0.52 * s, 0.18 * s, HANDLE_CUBE, hoofMat),
      part(0.27 * s, -0.36 * s, -0.35 * s, 0.18 * s, 0.52 * s, 0.18 * s, HANDLE_CUBE, hoofMat),
      part(-0.27 * s, -0.36 * s, 0.36 * s, 0.18 * s, 0.52 * s, 0.18 * s, HANDLE_CUBE, hoofMat),
      part(0.27 * s, -0.36 * s, 0.36 * s, 0.18 * s, 0.52 * s, 0.18 * s, HANDLE_CUBE, hoofMat),
      part(-0.22 * s, 0.68 * s, -0.72 * s, 0.13 * s, 0.32 * s, 0.13 * s, cylinderMesh, hornMat),
      part(0.22 * s, 0.68 * s, -0.72 * s, 0.13 * s, 0.32 * s, 0.13 * s, cylinderMesh, hornMat),
    ];
    enemies.push({ e: root, parts, type, hp: type.hp, maxHp: type.hp, x, z, y, radius: type.radius, slow: 0, burn: 0, burnTick: 0, knockX: 0, knockZ: 0, flash: 0, hitPulse: 0 });
    if (type.boss) hud.banner('牛王降临', '暗黑牧场开始震动');
  }

  function spawnBullet(kind: Bullet['kind'], x: number, y: number, z: number, dx: number, dy: number, dz: number, speed: number, damage: number, life: number, radius: number, pierce: number): void {
    const len = Math.hypot(dx, dy, dz) || 1;
    const mat = kind === 'fire' ? fireMat : kind === 'ice' ? iceMat : kind === 'bone' ? boneMat : stakeMat;
    const e = world.spawn(
      { component: Transform, data: { posX: x, posY: y, posZ: z, scaleX: radius / 0.16, scaleY: radius / 0.16, scaleZ: radius / 0.16 } },
      { component: MeshFilter, data: { assetHandle: bulletMesh } },
      { component: MeshRenderer, data: { materials: [mat] } },
      { component: RigidBody, data: { type: RigidBodyTypeValue.kinematic } },
      { component: Collider, data: { shape: ColliderShapeValue.sphere, radius: Math.max(0.18, radius * 1.9), friction: 0, restitution: 0.35 } },
    ).unwrap();
    bullets.push({ e, x, y, z, vx: dx / len * speed, vy: dy / len * speed, vz: dz / len * speed, age: 0, life, radius: Math.max(0.22, radius * 1.8), damage: damage * playerStats.might, pierce, kind, hit: new Set<Entity>() });
  }

  function spawnSparks(x: number, y: number, z: number, count: number, mat = sparkMat): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 4;
      const e = world.spawn(
        { component: Transform, data: { posX: x, posY: y, posZ: z } },
        { component: MeshFilter, data: { assetHandle: sparkMesh } },
        { component: MeshRenderer, data: { materials: [mat] } },
      ).unwrap();
      sparks.push({ e, x, y, z, vx: Math.cos(a) * sp, vy: 1.5 + Math.random() * 3, vz: Math.sin(a) * sp, age: 0, life: 0.25 + Math.random() * 0.28 });
    }
  }

  function damageEnemy(en: Enemy, amount: number, kind: 'dmg' | 'crit' | 'burn' = 'dmg', kx = 0, kz = 0): void {
    const crit = kind !== 'burn' && Math.random() < 0.13;
    const dmg = Math.ceil(amount * (crit ? 1.9 : 1));
    en.hp -= dmg;
    en.knockX += kx; en.knockZ += kz;
    en.flash = 0.08; en.hitPulse = 0.11;
    for (const p of en.parts.slice(0, 2)) world.set(p, MeshRenderer, { materials: [flashMat] });
    screenPopup(String(dmg), en.x, en.y + en.type.scale * 0.9, en.z, crit ? 'crit' : kind);
    if (kind !== 'burn') spawnSparks(en.x, en.y + 0.25, en.z, crit ? 8 : 4, kind === 'crit' ? fireMat : sparkMat);
    shake = Math.max(shake, crit ? 0.16 : 0.08);
  }

  function killEnemy(index: number): void {
    const en = enemies[index]!;
    for (const p of en.parts) world.despawn(p);
    world.despawn(en.e);
    enemies.splice(index, 1);
    kills++;
    score += en.type.score;
    spawnSparks(en.x, en.y + 0.2, en.z, en.type.boss ? 26 : 10, bloodMat);
    const gem = world.spawn(
      { component: Transform, data: { posX: en.x, posY: 0.2, posZ: en.z, scaleX: 0.32, scaleY: 0.32, scaleZ: 0.32 } },
      { component: MeshFilter, data: { assetHandle: HANDLE_SPHERE } },
      { component: MeshRenderer, data: { materials: [xpMat] } },
      { component: RigidBody, data: { type: RigidBodyTypeValue.dynamic, mass: 0.2, linearDamping: 0.85 } },
      { component: Collider, data: { shape: ColliderShapeValue.sphere, radius: 0.18, restitution: 0.2 } },
    ).unwrap();
    pickups.push({ e: gem, x: en.x, z: en.z, xp: en.type.xp, age: 0 });
  }

  function gainXp(v: number): void {
    xp += v;
    while (xp >= nextXp) {
      xp -= nextXp;
      level++;
      nextXp = Math.floor(nextXp * 1.28 + 8);
      paused = true;
      hud.banner('升级', '选择一项强化');
      hud.showLevelUp(makeChoices());
    }
  }

  function makeChoices(): UpgradeChoice[] {
    const pool: UpgradeChoice[] = [
      { id: 'stake', icon: '†', title: `木桩齐射 Lv.${weapons.stake.level + 1}`, desc: '主武器更快，伤害提升。' },
      { id: 'bones', icon: '骨', title: `骨矛散射 Lv.${weapons.bones.level + 1}`, desc: '额外骨矛追踪最近的牛群。' },
      { id: 'orbit', icon: '血', title: `鲜血光环 Lv.${weapons.orbit.level + 1}`, desc: '环绕血刃范围和伤害提高。' },
      { id: 'fire', icon: '炎', title: weapons.fire.level ? `地狱火 Lv.${weapons.fire.level + 1}` : '解锁地狱火', desc: '爆燃弹造成灼烧和小范围伤害。' },
      { id: 'frost', icon: '霜', title: weapons.frost.level ? `寒霜符文 Lv.${weapons.frost.level + 1}` : '解锁寒霜符文', desc: '周期性冰弹减速一整片牛群。' },
      { id: 'heart', icon: '心', title: '血瓶加固', desc: '最大生命 +24，并立刻治疗。' },
      { id: 'boots', icon: '靴', title: '轻盈皮靴', desc: '移动速度 +9%，拾取范围增加。' },
      { id: 'fang', icon: '牙', title: '吸血獠牙', desc: '伤害 +14%，每秒缓慢回血。' },
    ];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i]!;
      pool[i] = pool[j]!;
      pool[j] = tmp;
    }
    return pool.slice(0, 3);
  }

  function chooseUpgrade(id: string): void {
    if (id === 'stake') { weapons.stake.level++; weapons.stake.interval *= 0.88; playerStats.might *= 1.04; }
    if (id === 'bones') { weapons.bones.level++; weapons.bones.interval *= 0.92; }
    if (id === 'orbit') weapons.orbit.level++;
    if (id === 'fire') { weapons.fire.level++; weapons.fire.interval *= 0.9; }
    if (id === 'frost') { weapons.frost.level++; weapons.frost.interval *= 0.9; }
    if (id === 'heart') { playerStats.maxHp += 24; playerStats.hp = Math.min(playerStats.maxHp, playerStats.hp + 44); }
    if (id === 'boots') { playerStats.speed *= 1.09; playerStats.magnet += 0.7; }
    if (id === 'fang') { playerStats.might *= 1.14; playerStats.regen += 0.35; }
    paused = false;
    hud.hideLevelUp();
    updateHud();
  }

  function updateHud(): void {
    hud.setHp(playerStats.hp, playerStats.maxHp);
    hud.setXp(xp, nextXp, level);
    hud.setStats({ time, kills, score, enemies: enemies.length });
    hud.setWeapons([
      { icon: '†', level: weapons.stake.level },
      { icon: '骨', level: weapons.bones.level },
      { icon: '血', level: weapons.orbit.level },
      ...(weapons.fire.level ? [{ icon: '炎', level: weapons.fire.level }] : []),
      ...(weapons.frost.level ? [{ icon: '霜', level: weapons.frost.level }] : []),
    ]);
  }

  let spawnTimer = 0;
  function spawnWave(dt: number): void {
    spawnTimer -= dt;
    if (!bossSpawned && time > 120) {
      bossSpawned = true;
      spawnEnemy(ENEMY_TYPES[5]!, Math.random() * Math.PI * 2, 18);
    }
    const maxEnemies = Math.min(120, 32 + Math.floor(time / 6) * 3);
    if (spawnTimer > 0 || enemies.length >= maxEnemies) return;
    spawnTimer = Math.max(0.18, 1.0 - time * 0.006);
    const count = 1 + Math.floor(time / 25) + (Math.random() < 0.35 ? 1 : 0);
    for (let i = 0; i < count && enemies.length < maxEnemies; i++) {
      const r = Math.random();
      const idx = time > 95 && r > 0.91 ? 4 : time > 60 && r > 0.78 ? 3 : time > 38 && r > 0.62 ? 2 : time > 15 && r > 0.36 ? 1 : 0;
      spawnEnemy(ENEMY_TYPES[idx]!, Math.random() * Math.PI * 2, 16 + Math.random() * 8);
    }
  }

  function fireWeapons(dt: number): void {
    const target = nearestEnemy(28);
    if (!target) return;
    const tx = target.x - px, tz = target.z - pz;
    const tl = Math.hypot(tx, tz) || 1;
    faceX = tx / tl; faceZ = tz / tl;
    weapons.stake.cd -= dt * playerStats.fireRate;
    if (weapons.stake.cd <= 0) {
      weapons.stake.cd = weapons.stake.interval;
      const spread = Math.min(5, weapons.stake.level) - 1;
      for (let i = 0; i <= spread; i++) {
        const off = (i - spread / 2) * 0.13;
        const c = Math.cos(off), s = Math.sin(off);
        spawnBullet('stake', px + faceX * 0.65, playerY + 0.35, pz + faceZ * 0.65, faceX * c - faceZ * s, 0, faceX * s + faceZ * c, 24, 18 + weapons.stake.level * 5, 1.2, 0.17, 1 + Math.floor(weapons.stake.level / 3));
      }
    }
    weapons.bones.cd -= dt;
    if (weapons.bones.cd <= 0) {
      weapons.bones.cd = weapons.bones.interval;
      const n = 2 + weapons.bones.level;
      for (let i = 0; i < n; i++) {
        const a = Math.atan2(faceZ, faceX) + (i - (n - 1) / 2) * 0.22;
        spawnBullet('bone', px, playerY + 0.25, pz, Math.cos(a), 0.04, Math.sin(a), 18, 12 + weapons.bones.level * 4, 1.55, 0.13, 2);
      }
    }
    if (weapons.fire.level > 0) {
      weapons.fire.cd -= dt;
      if (weapons.fire.cd <= 0) {
        weapons.fire.cd = weapons.fire.interval;
        spawnBullet('fire', px, playerY + 0.55, pz, faceX, 0.08, faceZ, 14, 24 + weapons.fire.level * 8, 1.65, 0.22, 1);
      }
    }
    if (weapons.frost.level > 0) {
      weapons.frost.cd -= dt;
      if (weapons.frost.cd <= 0) {
        weapons.frost.cd = weapons.frost.interval;
        for (let i = 0; i < 6; i++) {
          const a = i / 6 * Math.PI * 2 + time * 0.3;
          spawnBullet('ice', px, playerY + 0.35, pz, Math.cos(a), 0, Math.sin(a), 12, 10 + weapons.frost.level * 5, 1.6, 0.16, 2);
        }
      }
    }
  }

  function updateOrbit(dt: number): void {
    weapons.orbit.t += dt * (1.6 + weapons.orbit.level * 0.18);
    const blades = 2 + Math.floor(weapons.orbit.level / 2);
    const radius = 1.65 + weapons.orbit.level * 0.18;
    for (const [e, cd] of weapons.orbit.hitCd) {
      const nt = cd - dt;
      if (nt <= 0) weapons.orbit.hitCd.delete(e); else weapons.orbit.hitCd.set(e, nt);
    }
    for (let i = 0; i < blades; i++) {
      const a = weapons.orbit.t + i * Math.PI * 2 / blades;
      const ox = px + Math.cos(a) * radius;
      const oz = pz + Math.sin(a) * radius;
      if (Math.random() < 0.5) spawnSparks(ox, playerY + 0.2, oz, 1, orbitMat);
      for (const en of enemies) {
        if (weapons.orbit.hitCd.has(en.e)) continue;
        const d = Math.hypot(en.x - ox, en.z - oz);
        if (d < en.radius + 0.45) {
          weapons.orbit.hitCd.set(en.e, 0.42);
          damageEnemy(en, 13 + weapons.orbit.level * 5, 'dmg', (en.x - px) * 1.5, (en.z - pz) * 1.5);
        }
      }
    }
  }

  updateHud();
  hud.banner('暗黑奶牛关', '活下去，收割牛群');

  if (player !== undefined) {
    registerUpdate((rawDt: number) => {
      const dt = Math.min(0.05, rawDt);
      if (gameOver) return;
      if (paused) {
        updateHud();
        return;
      }
      time += dt;
      invuln = Math.max(0, invuln - dt);
      playerStats.hp = Math.min(playerStats.maxHp, playerStats.hp + playerStats.regen * dt);
      spawnWave(dt);

      const am = mode !== 'fps';
      if (mode === 'fps') {
        const turn = 2.4;
        if (keys.ArrowLeft) lookYaw += turn * dt;
        if (keys.ArrowRight) lookYaw -= turn * dt;
        if (keys.ArrowUp) lookPitch = Math.min(1.05, lookPitch + turn * 0.55 * dt);
        if (keys.ArrowDown) lookPitch = Math.max(-1.15, lookPitch - turn * 0.55 * dt);
      }
      const f = ((keys.KeyW || (am && keys.ArrowUp)) ? 1 : 0) - ((keys.KeyS || (am && keys.ArrowDown)) ? 1 : 0);
      const s = ((keys.KeyD || (am && keys.ArrowRight)) ? 1 : 0) - ((keys.KeyA || (am && keys.ArrowLeft)) ? 1 : 0);
      let mvx = 0, mvz = 0;
      if (mode === 'fps') {
        const fwdX = -Math.sin(lookYaw), fwdZ = -Math.cos(lookYaw);
        const rgtX = -fwdZ, rgtZ = fwdX;
        faceX = fwdX; faceZ = fwdZ;
        mvx = fwdX * f + rgtX * s; mvz = fwdZ * f + rgtZ * s;
      } else {
        mvx = s; mvz = -f;
      }
      if (mvx || mvz) {
        const l = Math.hypot(mvx, mvz) || 1;
        px = Math.max(-18.5, Math.min(18.5, px + mvx / l * playerStats.speed * dt));
        pz = Math.max(-18.5, Math.min(18.5, pz + mvz / l * playerStats.speed * dt));
      }

      fireWeapons(dt);
      updateOrbit(dt);

      const yaw = Math.atan2(-faceX, -faceZ);
      const pq = quat.eulerY(yaw);
      world.set(player!, Transform, { posX: px, posY: playerY, posZ: pz, quatX: pq[0]!, quatY: pq[1]!, quatZ: pq[2]!, quatW: pq[3]! });

      for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i]!;
        b.age += dt;
        if (b.age >= b.life || b.pierce < 0) {
          world.despawn(b.e);
          bullets.splice(i, 1);
          continue;
        }
        b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
        world.set(b.e, Transform, { posX: b.x, posY: b.y, posZ: b.z });
        for (const en of enemies) {
          if (b.hit.has(en.e)) continue;
          const dx = en.x - b.x, dy = (en.y + 0.15) - b.y, dz = en.z - b.z;
          if (dx * dx + dy * dy + dz * dz <= (en.radius + b.radius) * (en.radius + b.radius)) {
            b.hit.add(en.e);
            b.pierce--;
            const l = Math.hypot(dx, dz) || 1;
            damageEnemy(en, b.damage, b.kind === 'fire' ? 'burn' : 'dmg', dx / l * 4.5, dz / l * 4.5);
            if (b.kind === 'fire') {
              en.burn = Math.max(en.burn, 2.4 + weapons.fire.level * 0.35);
              for (const other of enemies) {
                const od = Math.hypot(other.x - en.x, other.z - en.z);
                if (other !== en && od < 2.0 + weapons.fire.level * 0.15) damageEnemy(other, b.damage * 0.45, 'burn', (other.x - en.x) * 1.2, (other.z - en.z) * 1.2);
              }
            }
            if (b.kind === 'ice') en.slow = Math.max(en.slow, 2.2 + weapons.frost.level * 0.2);
            if (b.pierce < 0) break;
          }
        }
      }

      for (let i = enemies.length - 1; i >= 0; i--) {
        const en = enemies[i]!;
        if (en.hp <= 0) { killEnemy(i); continue; }
        if (en.flash > 0) {
          en.flash -= dt;
          if (en.flash <= 0) for (const p of en.parts.slice(0, 2)) world.set(p, MeshRenderer, { materials: [enemyMats.get(en.type.id)!] });
        }
        if (en.burn > 0) {
          en.burn -= dt; en.burnTick -= dt;
          if (en.burnTick <= 0) { en.burnTick = 0.35; damageEnemy(en, 5 + weapons.fire.level * 2, 'burn'); }
        }
        en.slow = Math.max(0, en.slow - dt);
        const dx = px - en.x, dz = pz - en.z;
        const d = Math.hypot(dx, dz) || 1;
        const speed = en.type.speed * (en.slow > 0 ? 0.46 : 1) * (1 + Math.min(1.1, time / 180));
        en.x += dx / d * speed * dt + en.knockX * dt;
        en.z += dz / d * speed * dt + en.knockZ * dt;
        en.knockX *= Math.exp(-8 * dt); en.knockZ *= Math.exp(-8 * dt);
        const yawE = Math.atan2(-(dx / d), -(dz / d));
        const q = quat.eulerY(yawE);
        const pulse = en.hitPulse > 0 ? 1 + en.hitPulse * 1.7 : 1;
        en.hitPulse = Math.max(0, en.hitPulse - dt);
        world.set(en.e, Transform, { posX: en.x, posY: en.y, posZ: en.z, scaleX: pulse, scaleY: pulse, scaleZ: pulse, quatX: q[0]!, quatY: q[1]!, quatZ: q[2]!, quatW: q[3]! });
        if (d < en.radius + 0.44 && invuln <= 0) {
          const dmg = Math.max(1, en.type.damage - playerStats.armor);
          playerStats.hp -= dmg;
          invuln = 0.42;
          shake = Math.max(shake, 0.3);
          hud.flashHurt();
          screenPopup('-' + Math.ceil(dmg), px, playerY + 1.2, pz, 'hurt');
          if (playerStats.hp <= 0) {
            gameOver = true;
            hud.showGameOver({ time, kills, score, level });
            releasePointer();
          }
        }
      }

      for (let i = pickups.length - 1; i >= 0; i--) {
        const p = pickups[i]!;
        p.age += dt;
        const dx = px - p.x, dz = pz - p.z;
        const d = Math.hypot(dx, dz);
        if (d < playerStats.magnet) {
          const pull = Math.min(18, 5 + (playerStats.magnet - d) * 5);
          p.x += dx / Math.max(0.01, d) * pull * dt;
          p.z += dz / Math.max(0.01, d) * pull * dt;
          world.set(p.e, Transform, { posX: p.x, posY: 0.22 + Math.sin(time * 8 + p.age) * 0.05, posZ: p.z });
        }
        if (d < 0.65) {
          world.despawn(p.e);
          pickups.splice(i, 1);
          gainXp(p.xp);
          screenPopup('+' + p.xp + ' XP', px, playerY + 1.4, pz, 'xp');
        }
      }

      for (let i = sparks.length - 1; i >= 0; i--) {
        const sp = sparks[i]!;
        sp.age += dt;
        if (sp.age >= sp.life) {
          world.despawn(sp.e);
          sparks.splice(i, 1);
          continue;
        }
        sp.vy -= 8 * dt;
        sp.x += sp.vx * dt; sp.y += sp.vy * dt; sp.z += sp.vz * dt;
        const k = 1 - sp.age / sp.life;
        world.set(sp.e, Transform, { posX: sp.x, posY: Math.max(0.05, sp.y), posZ: sp.z, scaleX: k, scaleY: k, scaleZ: k });
      }

      shake = Math.max(0, shake - dt);
      const sx = shake > 0 ? (Math.random() - 0.5) * shake : 0;
      const sz = shake > 0 ? (Math.random() - 0.5) * shake : 0;
      if (mode === 'fps') {
        const qy = quat.create(); quat.fromAxisAngle(qy, [0, 1, 0], lookYaw);
        const qx = quat.create(); quat.fromAxisAngle(qx, [1, 0, 0], lookPitch);
        const cq = quat.create(); quat.multiply(cq, qy, qx);
        world.set(camera, Transform, { posX: px + sx, posY: playerY + 0.62, posZ: pz + sz, quatX: cq[0]!, quatY: cq[1]!, quatZ: cq[2]!, quatW: cq[3]! });
      } else {
        const a = 1 - Math.exp(-8 * dt);
        camX += (px - camX) * a;
        camZ += (pz + 10 - camZ) * a;
        world.set(camera, Transform, { posX: camX + sx, posY: 15, posZ: camZ + sz, quatX: topQ[0]!, quatY: topQ[1]!, quatZ: topQ[2]!, quatW: topQ[3]! });
      }
      updateHud();
    });
  }
};

export default start;
