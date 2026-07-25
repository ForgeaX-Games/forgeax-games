// CharacterController terrain showcase — authored scene for ✎ Edit, physics + KCC on ▶ Play.

import {
  Transform,
  ChildOf,
} from '@forgeax/engine-scene';
import {
  Camera,
  perspective,
  Materials,
  MeshFilter,
  MeshRenderer,
  SceneInstance,
} from '@forgeax/engine-render';
import {
  quat,
} from '@forgeax/engine-runtime';
import {
  type MaterialAsset,
  type Handle,
} from '@forgeax/engine-types';
import { HANDLE_CUBE, HANDLE_SPHERE } from '@forgeax/engine-assets-runtime';
import { vec3 } from '@forgeax/engine-math';
import {
  CharacterController,
  Collider,
  ColliderShapeValue,
  type PhysicsWorld,
  RigidBody,
  RigidBodyTypeValue,
} from '@forgeax/engine-physics';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { Time, Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
import type { BootstrapContext } from '@forgeax/engine-app';
import type { SceneAsset } from '@forgeax/engine-types';
import {
  createInputSnapshot,
  FRAME_START_SCAN_SYSTEM_NAME,
  INPUT_MAP_KEY,
  INPUT_SNAPSHOT_RESOURCE_KEY,
  type ActionConfig,
  type InputSnapshot,
} from '@forgeax/engine-input';
import { installDemoHud } from './src/hud';

type MatHandle = Handle<'MaterialAsset', 'shared'>;
type Rgb = [number, number, number, number];

const SCENE_GUID = 'c7e4a1b2-3d5f-4a8e-9c1b-2f6e8d4a7b30';
const CHAR_RADIUS = 0.42;
const CHAR_HALF_HEIGHT = 0.45;
/** Capsule center when feet rest on ground top y=0 (matches visible body width). */
const CHAR_REST_Y = CHAR_RADIUS + CHAR_HALF_HEIGHT;
const SPAWN_X = -4;
const SPAWN_Y = CHAR_REST_Y;
const SPAWN_Z = 0;
const MOVE_SPEED = 5;
const GRAVITY = -14;
const JUMP_SPEED = 6.5;

interface PackNode { localId: number; components: Record<string, Record<string, unknown>> }

type LoadedScene = { mapping: ReadonlyMap<number, EntityHandle>; nodes: PackNode[] };

async function loadScene(ctx: { world: World; assets?: BootstrapContext['assets'] }): Promise<LoadedScene | null> {
  const { world, assets } = ctx;
  if (!assets) return null;
  const guid = AssetGuid.parse(SCENE_GUID);
  if (!guid.ok) return null;
  const loadRes = await assets.loadByGuid<SceneAsset>(guid.value);
  if (!loadRes.ok) return null;
  const handle = world.allocSharedRef('SceneAsset', loadRes.value);
  const inst = assets.instantiate<SceneAsset>(handle, world);
  if (!inst.ok) return null;
  const sceneInst = world.get(inst.value, SceneInstance);
  if (!sceneInst.ok) return null;
  const mappingArr = sceneInst.value.mapping as unknown as { length: number; [i: number]: number };
  const mapping = new Map<number, EntityHandle>();
  for (let localId = 0; localId < mappingArr.length; localId++) {
    const e = mappingArr[localId];
    if (e !== undefined && e !== 0xffffffff && e !== 0) mapping.set(localId, e as EntityHandle);
  }
  return { mapping, nodes: loadRes.value.entities as unknown as PackNode[] };
}

function adoptHostScene(world: World, ctx: BootstrapContext): LoadedScene | null {
  const hostRoot = ctx.defaultSceneRoot;
  if (hostRoot === undefined || ctx.defaultScene === undefined) return null;
  const sceneInst = world.get(hostRoot, SceneInstance);
  if (!sceneInst.ok) return null;
  const mappingArr = sceneInst.value.mapping as unknown as { length: number; [i: number]: number };
  const mapping = new Map<number, EntityHandle>();
  for (let localId = 0; localId < mappingArr.length; localId++) {
    const e = mappingArr[localId];
    if (e !== undefined && e !== 0xffffffff && e !== 0) mapping.set(localId, e as EntityHandle);
  }
  return { mapping, nodes: ctx.defaultScene.entities as unknown as PackNode[] };
}

/** Play bootstrap — terrain Collider/RigidBody are authored in scene.pack.json (editable in ✎ Edit). */
function setupPlayer(world: World, player: EntityHandle): void {
  const tr = world.get(player, Transform);
  const faceQ = quat.create();
  quat.fromAxisAngle(faceQ, [0, 1, 0], Math.PI / 2);
  if (tr.ok) {
    const px = tr.value.pos[0] ?? -4;
    const pz = tr.value.pos[2] ?? 0;
    world.set(player, Transform, {
      pos: [px, tr.value.pos[1] ?? CHAR_REST_Y, pz],
      quat: [faceQ[0]!, faceQ[1]!, faceQ[2]!, faceQ[3]!],
      scale: [1, 1, 1],
    });
  }
  if (!world.get(player, RigidBody).ok) {
    world.addComponent(player, {
      component: RigidBody,
      data: { type: RigidBodyTypeValue.kinematic, ccdEnabled: true },
    });
  }
  if (!world.get(player, Collider).ok) {
    world.addComponent(player, {
      component: Collider,
      data: { shape: ColliderShapeValue.capsule, radius: CHAR_RADIUS, halfHeight: CHAR_HALF_HEIGHT },
    });
  }
  if (!world.get(player, CharacterController).ok) {
    world.addComponent(player, {
      component: CharacterController,
      data: {
        offset: 0.01,
        maxSlopeClimbDeg: 45,
        minSlopeSlideDeg: 30,
        autoStepMaxHeight: 0.35,
        autoStepMinWidth: 0.15,
        snapToGroundDist: 0.12,
      },
    });
  }
}

const matCache = new Map<string, MatHandle>();

function tint(world: World, key: string, baseColor: Rgb, roughness = 0.72): MatHandle {
  const hit = matCache.get(key);
  if (hit !== undefined) return hit;
  const mat = world.allocSharedRef(
    'MaterialAsset',
    Materials.standard({ baseColor, roughness, metallic: 0 }),
  );
  matCache.set(key, mat);
  return mat;
}

/** Remove pack-authored player mesh parts (may not render) before spawning runtime body. */
function stripPackPlayerVisuals(world: World, loaded: LoadedScene, playerLocalId: number): void {
  for (const node of loaded.nodes) {
    const name = (node.components.Name as { value?: string } | undefined)?.value ?? '';
    if (!/^Player(Torso|Head|Arm|Leg)/.test(name)) continue;
    const parent = (node.components.ChildOf as { parent?: number } | undefined)?.parent;
    if (parent !== playerLocalId) continue;
    const e = loaded.mapping.get(node.localId);
    if (e !== undefined) world.despawn(e);
  }
}

/** Runtime box-man — sphere head + box torso/limbs, always visible in Play. */
function spawnBoxMan(world: World, player: EntityHandle): void {
  const body = tint(world, 'body', [0.12, 0.42, 0.82, 1]);
  const skin = tint(world, 'skin', [0.9, 0.7, 0.55, 1]);
  const pants = tint(world, 'pants', [0.18, 0.22, 0.38, 1]);

  const part = (
    pos: [number, number, number],
    scale: [number, number, number],
    mesh: typeof HANDLE_CUBE,
    mat: MatHandle,
  ): void => {
    world.spawn(
      { component: Transform, data: { pos, scale } },
      { component: MeshFilter, data: { assetHandle: mesh } },
      { component: MeshRenderer, data: { materials: [mat] } },
      { component: ChildOf, data: { parent: player } },
    ).unwrap();
  };

  part([0, 0.08, 0], [0.52, 0.62, 0.3], HANDLE_CUBE, body);
  part([0, 0.62, 0], [0.38, 0.38, 0.38], HANDLE_SPHERE, skin);
  part([-0.38, 0.05, 0], [0.16, 0.52, 0.16], HANDLE_CUBE, skin);
  part([0.38, 0.05, 0], [0.16, 0.52, 0.16], HANDLE_CUBE, skin);
  part([-0.14, -0.52, 0], [0.2, 0.52, 0.2], HANDLE_CUBE, pants);
  part([0.14, -0.52, 0], [0.2, 0.52, 0.2], HANDLE_CUBE, pants);
}

function ensurePlayerVisuals(
  world: World,
  player: EntityHandle,
  loaded: LoadedScene | null,
  playerLocalId?: number,
): void {
  if (loaded !== null && playerLocalId !== undefined) {
    stripPackPlayerVisuals(world, loaded, playerLocalId);
  }
  spawnBoxMan(world, player);
}

/** Fallback when scene.pack.json is missing — code-only terrain for Play. */
function spawnStaticBox(world: World, pos: [number, number, number], scale: [number, number, number], color: Rgb): void {
  const mat: MatHandle = world.allocSharedRef(
    'MaterialAsset',
    Materials.standard({ baseColor: color, roughness: 0.88, metallic: 0 }),
  );
  world.spawn(
    { component: Transform, data: { pos, scale } },
    { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
    { component: MeshRenderer, data: { materials: [mat] } },
    { component: RigidBody, data: { type: RigidBodyTypeValue.static } },
    {
      component: Collider,
      data: {
        shape: ColliderShapeValue.cuboid,
        halfExtents: [0.5, 0.5, 0.5],
        friction: 0.85,
        restitution: 0,
      },
    },
  ).unwrap();
}

function buildFallbackTerrain(world: World): EntityHandle {
  spawnStaticBox(world, [0, -0.08, 0], [110, 0.16, 16], [0.52, 0.36, 0.2, 1]);
  spawnStaticBox(world, [-2, 0.02, 0], [14, 0.04, 10], [0.28, 0.52, 0.22, 1]);
  spawnStaticBox(world, [79, 1.65, 0], [1.4, 3.3, 10], [0.5, 0.5, 0.46, 1]);
  return world.spawn(
    { component: Transform, data: { pos: [-4, CHAR_REST_Y, 0], scale: [1, 1, 1] } },
  ).unwrap();
}

function zoneInfo(x: number): { zone: string; detail: string } {
  if (x < 6) return { zone: '① 木地板平地', detail: '基准行走区域' };
  if (x < 16) return { zone: '② 矮台阶 (+0.2m)', detail: 'autoStepMaxHeight=0.35 → 应自动迈上' };
  if (x < 28) return { zone: '③ 高台阶 (+0.5m)', detail: '6 级小台阶 → 应连续走上去' };
  if (x < 44) return { zone: '④ 缓坡 ~22°', detail: '阶梯式坡道 → 应自然走上去' };
  if (x < 58) return { zone: '⑤ 陡坡 ~40°', detail: '接近 maxSlopeClimbDeg=45°' };
  if (x < 72) return { zone: '⑥ 滑坡 ~58°', detail: '超过 maxSlopeClimbDeg → 无法走上' };
  if (x < 82) return { zone: '⑦ 挡墙', detail: 'static 碰撞 → 无法穿过' };
  return { zone: '⑧ 下坡', detail: '阶梯式下坡 → 贴地下降' };
}

function readGrounded(world: World, entity: EntityHandle): boolean {
  const r = world.get(entity, CharacterController);
  return r.ok && r.value.grounded === true;
}

function readPos(world: World, entity: EntityHandle): { x: number; y: number; z: number } {
  const r = world.get(entity, Transform);
  if (!r.ok) return { x: 0, y: 0, z: 0 };
  return { x: r.value.pos[0] ?? 0, y: r.value.pos[1] ?? 0, z: r.value.pos[2] ?? 0 };
}

export async function bootstrap(world: World, ctx?: BootstrapContext): Promise<void> {
  const { registerCleanup } = ctx ?? {};
  const canvas = document.querySelector<HTMLCanvasElement>('#app');
  const aspect = canvas
    ? canvas.width / Math.max(canvas.height, 1)
    : window.innerWidth / Math.max(window.innerHeight, 1);

  let loaded: LoadedScene | null = null;
  if (ctx) loaded = adoptHostScene(world, ctx);
  if (!loaded) {
    try {
      loaded = await loadScene({ world, assets: ctx?.assets });
    } catch {
      /* fall through */
    }
  }

  let character: EntityHandle;
  let playerLocalId: number | undefined;
  if (loaded) {
    const playerNode = loaded.nodes.find(
      (n) => (n.components.Name as { value?: string } | undefined)?.value === 'Player',
    );
    playerLocalId = playerNode?.localId;
    const mapped = playerNode ? loaded.mapping.get(playerNode.localId) : undefined;
    if (mapped !== undefined) {
      character = mapped;
      setupPlayer(world, character);
      ensurePlayerVisuals(world, character, loaded, playerLocalId);
    } else {
      character = buildFallbackTerrain(world);
      setupPlayer(world, character);
      ensurePlayerVisuals(world, character, null);
    }
  } else {
    character = buildFallbackTerrain(world);
    setupPlayer(world, character);
    ensurePlayerVisuals(world, character, null);
  }

  const CAM_BACK = 10;
  const CAM_HEIGHT = 5.5;
  const CAM_LOOK_AHEAD = 14;
  const camQ = quat.create();

  const updateFollowCamera = (px: number, py: number, pz: number): void => {
    const eye = [px - CAM_BACK, py + CAM_HEIGHT, pz] as const;
    const target = [px + CAM_LOOK_AHEAD, py + 1.2, pz] as const;
    quat.fromLookAt(camQ, eye, target, [0, 1, 0]);
    world.set(camera, Transform, {
      pos: [eye[0], eye[1], eye[2]],
      quat: [camQ[0]!, camQ[1]!, camQ[2]!, camQ[3]!],
    });
  };

  const camera = world.spawn(
    { component: Transform, data: { pos: [-4 - CAM_BACK, CHAR_REST_Y + CAM_HEIGHT, 0], quat: [0, 0, 0, 1] } },
    {
      component: Camera,
      data: {
        ...perspective({ fov: Math.PI / 3.2, aspect, near: 0.1, far: 200 }),
        clearColor: [0.52, 0.72, 0.95, 1],
      },
    },
  ).unwrap();
  updateFollowCamera(-4, CHAR_REST_Y, 0);

  const hudHost = ctx?.uiRoot ?? canvas?.parentElement ?? undefined;
  const hud = installDemoHud(hudHost);
  registerCleanup?.(() => hud.dispose());

  const KEY = (key: string) => ({ type: 'key', key }) as const;
  world.insertResource(INPUT_MAP_KEY, [
    { action: 'moveForward', bindings: [KEY('w'), KEY('W')] },
    { action: 'moveBack', bindings: [KEY('s'), KEY('S')] },
    { action: 'moveLeft', bindings: [KEY('a'), KEY('A')] },
    { action: 'moveRight', bindings: [KEY('d'), KEY('D')] },
    { action: 'jump', bindings: [KEY(' ')] },
  ] satisfies readonly ActionConfig[]);
  const EMPTY_SNAP = createInputSnapshot();
  const readInput = (): InputSnapshot =>
    world.hasResource(INPUT_SNAPSHOT_RESOURCE_KEY)
      ? world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY)
      : EMPTY_SNAP;

  let verticalVel = 0;
  let snapFrames = 0;
  /** After respawn, physics teleport applies next sync — snap down before accepting input. */
  let respawnGrace = 0;
  const updatePlayer = (): void => {
    const dt = world.getResource(Time).delta;
    let pw: PhysicsWorld;
    try {
      pw = world.getResource<PhysicsWorld>('PhysicsWorld');
    } catch {
      return;
    }
    if (!pw.hasBody(character)) return;

    const faceSpawnQ = quat.create();
    quat.fromAxisAngle(faceSpawnQ, [0, 1, 0], Math.PI / 2);

    const p0 = readPos(world, character);
    const fellOff = Math.abs(p0.z) > 5.5 || p0.y < SPAWN_Y - 0.35;
    if (fellOff) {
      pw.teleport(character, vec3.create(SPAWN_X, SPAWN_Y, SPAWN_Z));
      world.set(character, Transform, {
        pos: [SPAWN_X, SPAWN_Y, SPAWN_Z],
        quat: [faceSpawnQ[0]!, faceSpawnQ[1]!, faceSpawnQ[2]!, faceSpawnQ[3]!],
        scale: [1, 1, 1],
      });
      verticalVel = 0;
      snapFrames = 0;
      respawnGrace = 4;
      updateFollowCamera(SPAWN_X, SPAWN_Y, SPAWN_Z);
      hud.setZone('↺ 已回到起点  ·  x=-4.0');
      hud.setStatus('从赛道外掉落 → 传送回出生点');
      return;
    }

    if (respawnGrace > 0) {
      respawnGrace--;
      pw.moveAndSlide(character, vec3.create(0, -0.25, 0));
      verticalVel = 0;
      const pSnap = readPos(world, character);
      updateFollowCamera(pSnap.x, pSnap.y, pSnap.z);
      hud.setZone('↺ 着陆中…');
      hud.setStatus('贴地复位，稍候即可移动');
      return;
    }

    // First frames: extra downward snap so capsule lands on floor (fixes hover).
    if (snapFrames < 8) {
      snapFrames++;
      pw.moveAndSlide(character, vec3.create(0, -0.15, 0));
      verticalVel = 0;
    }

    const snap = readInput();
    // Camera looks down +X: W/S = ±X (along track), A/D = ±Z (strafe).
    const move = snap.getVector('moveLeft', 'moveRight', 'moveBack', 'moveForward');
    const dx = move.y * MOVE_SPEED * dt;
    const dz = move.x * MOVE_SPEED * dt;

    const grounded = readGrounded(world, character);
    if (grounded && snap.action('jump').justPressed()) verticalVel = JUMP_SPEED;
    verticalVel += GRAVITY * dt;
    const dy = grounded ? verticalVel * dt - 0.015 : verticalVel * dt;

    pw.moveAndSlide(character, vec3.create(dx, dy, dz));
    if (readGrounded(world, character)) verticalVel = 0;

    if (Math.hypot(dx, dz) > 1e-5) {
      const yaw = Math.atan2(dx, dz);
      const faceQ = quat.create();
      quat.fromAxisAngle(faceQ, [0, 1, 0], yaw);
      const tr = world.get(character, Transform);
      if (tr.ok) {
        world.set(character, Transform, {
          pos: [tr.value.pos[0] ?? 0, tr.value.pos[1] ?? 0, tr.value.pos[2] ?? 0],
          quat: [faceQ[0]!, faceQ[1]!, faceQ[2]!, faceQ[3]!],
        });
      }
    }

    const pAfter = readPos(world, character);
    updateFollowCamera(pAfter.x, pAfter.y, pAfter.z);

    const info = zoneInfo(pAfter.x);
    const groundedNow = readGrounded(world, character);
    hud.setZone(`${info.zone}  ·  x=${pAfter.x.toFixed(1)}`);
    hud.setStatus(
      groundedNow ? `✓ 接地 (grounded)  ·  ${info.detail}` : `↑ 空中  ·  ${info.detail}`,
    );
  };
  world.addSystem(Update, {
    name: 'cc-terrain-player-control',
    after: [FRAME_START_SCAN_SYSTEM_NAME],
    queries: [],
    fn: updatePlayer,
  }).unwrap();
}
