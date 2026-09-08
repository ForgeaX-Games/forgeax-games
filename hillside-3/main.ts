// hillside-3:第一人称山坡旅店场景(参考 goal/view_01..03)。
// 入口契约:host 调 bootstrap(world, ctx);ctx.renderer 可用(editor-play-runtime)。
import { Update, type World } from '@forgeax/engine-ecs';
import {
  ANTIALIAS_FXAA, BLOOM_ENABLED, Camera, perspective, TONEMAP_NEUTRAL,
} from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import { quat } from '@forgeax/engine-math';
import {
  CharacterController, Collider, ColliderShapeValue, RigidBody, RigidBodyTypeValue,
  type PhysicsWorld,
} from '@forgeax/engine-physics';
import { INPUT_SNAPSHOT_RESOURCE_KEY, type InputSnapshot } from '@forgeax/engine-input';
import { TRI_COUNT } from './lib';
import { clampToBounds, groundHeight } from './terrain';
import { stairsRampHeight } from './building';
import { buildSceneSync, buildSky, type SceneStats } from './scene';
import { buildTextures, type TexSet } from './textures';

// view_01 参考位姿(由 REFERENCE.md §1 相机解算反推;渲染校正的是这里,不是文档)
const REF_POSE = { x: 0, z: 0, yaw: 0.0, pitch: -0.05, eye: 1.62 };
const CAP_R = 0.34, CAP_HH = 0.46;            // 胶囊:静置中心 = 地面 + 0.80
const CAP_CENTER = CAP_R + CAP_HH;
const WALK_SPEED = 4.2, RUN_SPEED = 7.5, TURN_SPEED = 1.6, PITCH_SPEED = 1.0;

function walkHeight(x: number, z: number): number {
  const ramp = stairsRampHeight(x, z);
  const g = groundHeight(x, z);
  return ramp !== null ? Math.max(g, ramp) : g;
}

interface Ctx {
  renderer?: {
    store: { uploadTexture?: (h: unknown, pod: unknown, dec: unknown) => Promise<{ ok: boolean }> };
  };
  setPointerLockAllowed?: (b: boolean) => void;
}

export async function bootstrap(world: World, ctx?: Ctx): Promise<void> {
  const renderer = ctx?.renderer ?? (globalThis as { __forgeax?: { renderer?: Ctx['renderer'] } }).__forgeax?.renderer;
  const tex: TexSet = renderer ? await buildTextures(world, renderer as never) : { failures: ['no-renderer'] };
  const stats: SceneStats = buildSceneSync(world, renderer as never, tex);
  stats.texFailures = tex.failures.join(',') || 'none';

  // ---- 相机 + 玩家 ----
  const spawnG = walkHeight(REF_POSE.x, REF_POSE.z);
  const camQ = quat.create();
  const camera = world.spawn(
    { component: Transform, data: { pos: [REF_POSE.x, spawnG + REF_POSE.eye, REF_POSE.z] } },
    {
      component: Camera,
      data: {
        ...perspective({ fov: 0.85, aspect: 16 / 9, near: 0.25, far: 1700 }),
        tonemap: TONEMAP_NEUTRAL, exposure: 1.0, whitePoint: 4,
        antialias: ANTIALIAS_FXAA,
        bloom: BLOOM_ENABLED, bloomThreshold: 0.92, bloomIntensity: 0.38,
        clearColor: [0.47, 0.75, 0.97, 1],
      },
    },
  ).unwrap();

  const player = world.spawn(
    { component: Transform, data: { pos: [REF_POSE.x, spawnG + CAP_CENTER, REF_POSE.z] } },
    { component: RigidBody, data: { type: RigidBodyTypeValue.kinematic } },
    { component: Collider, data: { shape: ColliderShapeValue.capsule, radius: CAP_R, halfHeight: CAP_HH } },
    { component: CharacterController, data: {} },
  ).unwrap();

  let yaw = REF_POSE.yaw, pitch = REF_POSE.pitch;
  let simTime = 0;
  let freecam = false;
  const moveVec = new Float32Array(3);

  ctx?.setPointerLockAllowed?.(true);

  // 鼠标视角:点击画布锁定指针,mousemove 自积累增量(引擎 InputSnapshot 的
  // mouse.movementDelta 不可靠,且此前无人调用 requestPointerLock —— 鼠标才一直失灵)
  let mouseDX = 0, mouseDY = 0;
  if (typeof document !== 'undefined') {
    const canvas = document.querySelector('canvas');
    canvas?.addEventListener('click', () => {
      (canvas as { requestPointerLock?: () => void }).requestPointerLock?.();
    });
    document.addEventListener('mousemove', (e: MouseEvent) => {
      if (document.pointerLockElement) { mouseDX += e.movementX; mouseDY += e.movementY; }
    });
  }

  world.addSystem(Update, {
    name: 'village-player',
    queries: [],
    fn: (w: World) => {
      const dt = Math.min(0.05, (w.getResource('Time' as never) as { delta: number } | undefined)?.delta ?? 1 / 60);
      simTime += dt;
      const input = w.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY);
      let fwd = 0, strafe = 0;
      if (input) {
        const kb = input.keyboard;
        if (kb.down('w') || kb.downCode('KeyW')) fwd += 1;
        if (kb.down('s') || kb.downCode('KeyS')) fwd -= 1;
        if (kb.down('a') || kb.downCode('KeyA')) strafe -= 1;
        if (kb.down('d') || kb.downCode('KeyD')) strafe += 1;
        if (kb.down('ArrowLeft')) yaw -= TURN_SPEED * dt;
        if (kb.down('ArrowRight')) yaw += TURN_SPEED * dt;
        if (kb.down('ArrowUp')) pitch = Math.min(1.2, pitch + PITCH_SPEED * dt);
        if (kb.down('ArrowDown')) pitch = Math.max(-1.2, pitch - PITCH_SPEED * dt);
        if (mouseDX !== 0 || mouseDY !== 0) {
          yaw += mouseDX * 0.0024;
          pitch = Math.max(-1.2, Math.min(1.2, pitch + mouseDY * 0.0022));
          mouseDX = 0; mouseDY = 0;
        }
        const speed = kb.down('Shift') || kb.downCode('ShiftLeft') ? RUN_SPEED : WALK_SPEED;
        fwd *= speed; strafe *= speed;
      }
      const trR = w.get(player, Transform);
      if (!trR.ok) return;
      const tr = trR.value as { pos: Float32Array };
      const px = tr.pos[0], py = tr.pos[1], pz = tr.pos[2];
      const sy = Math.sin(yaw), cy = Math.cos(yaw);
      let dx = (sy * fwd + cy * strafe) * dt;
      let dz = (-cy * fwd + sy * strafe) * dt;
      // 可探索收边
      const [bx, bz] = clampToBounds(px + dx, pz + dz);
      dx = bx - px; dz = bz - pz;
      const targetY = walkHeight(px + dx, pz + dz) + CAP_CENTER;
      const dy = Math.max(-8 * dt, Math.min(8 * dt, targetY - py));
      const pw = w.hasResource('PhysicsWorld') ? w.getResource<PhysicsWorld>('PhysicsWorld') : undefined;
      if (pw && pw.hasBody(player as never)) {
        moveVec[0] = dx; moveVec[1] = dy; moveVec[2] = dz;
        pw.moveAndSlide(player as never, moveVec as never);
      } else {
        w.set(player, Transform, { pos: [px + dx, targetY, pz + dz] });
      }
      // 相机跟随(必须走 world.set;freecam 评审机位时不跟随)
      if (freecam) return;
      const tr2 = w.get(player, Transform);
      const p2 = tr2.ok ? (tr2.value as { pos: Float32Array }).pos : tr.pos;
      quat.fromEuler(camQ, -pitch, -yaw, 0, 'YXZ'); // 引擎 X 正角=低头;约定 pitch>0=抬头
      w.set(camera, Transform, {
        pos: [p2[0], p2[1] - CAP_CENTER + REF_POSE.eye, p2[2]],
        quat: [camQ[0], camQ[1], camQ[2], camQ[3]],
      });
    },
  }).unwrap();

  // ---- 诊断 / 抓帧接口(tools/shoot.mjs 契约) ----
  const setPose = (x: number, z: number, yw: number, pt: number): void => {
    const y = walkHeight(x, z) + CAP_CENTER;
    const pw = world.hasResource('PhysicsWorld') ? world.getResource<PhysicsWorld>('PhysicsWorld') : undefined;
    if (pw && pw.hasBody(player as never)) {
      // KCC 的物理体才是位置权威;只写 Transform 会被 moveAndSlide 顶回去
      const v = new Float32Array([x, y, z]);
      pw.teleport(player as never, v as never);
    }
    world.set(player, Transform, { pos: [x, y, z] });
    yaw = yw; pitch = pt;
    // 相机立即落位(rAF 帧间隔可达数秒,不等下个 tick)
    quat.fromEuler(camQ, -pitch, -yaw, 0, 'YXZ');
    world.set(camera, Transform, {
      pos: [x, y - CAP_CENTER + REF_POSE.eye, z],
      quat: [camQ[0], camQ[1], camQ[2], camQ[3]],
    });
  };
  (globalThis as Record<string, unknown>).__village = {
    referencePose: () => {
      freecam = false;
      setPose(REF_POSE.x, REF_POSE.z, REF_POSE.yaw, REF_POSE.pitch);
      return { ...REF_POSE };
    },
    flyTo: (x: number, y: number, z: number, yw = 0, pt = 0) => {
      freecam = true;
      quat.fromEuler(camQ, -pt, -yw, 0, 'YXZ');
      world.set(camera, Transform, { pos: [x, y, z], quat: [camQ[0], camQ[1], camQ[2], camQ[3]] });
    },
    pose: () => {
      const r = world.get(player, Transform);
      const p = r.ok ? (r.value as { pos: Float32Array }).pos : new Float32Array(3);
      const cc = world.get(player, CharacterController);
      return {
        x: p[0], y: p[1], z: p[2], yaw, pitch,
        grounded: cc.ok ? (cc.value as { grounded?: boolean }).grounded === true : false,
      };
    },
    teleport: (x: number, z: number, yw = 0, pt = 0) => setPose(x, z, yw, pt),
    camPose: () => {
      const cr = world.get(camera, Transform);
      if (!cr.ok) return null;
      const c = cr.value as { pos: Float32Array; quat: Float32Array; world: Float32Array };
      return { pos: [...c.pos], quat: [...c.quat], world: [...c.world].map((v) => +v.toFixed(2)) };
    },
    stats: () => ({
      meshTris: TRI_COUNT,
      instancedTris: stats.instancedTris,
      entities: stats.entities,
      skyTex: stats.skyTex,
      texFailures: stats.texFailures,
      simTime: +simTime.toFixed(1),
      ground: ((): number => {
        const r = world.get(player, Transform);
        const p = r.ok ? (r.value as { pos: Float32Array }).pos : new Float32Array(3);
        return +walkHeight(p[0], p[2]).toFixed(2);
      })(),
    }),
  };

  // 天空(异步贴图,失败自动降级) —— 不阻塞 bootstrap 主体
  if (renderer) await buildSky(world, renderer as never, stats);
}

export default bootstrap;
