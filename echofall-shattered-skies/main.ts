import type { BootstrapContext, GameProjectionValue } from '@forgeax/engine-app';
import { AudioListener } from '@forgeax/engine-audio';
import { Time, Update, defineSystem, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  INPUT_MAP_KEY, INPUT_SNAPSHOT_RESOURCE_KEY, createInputSnapshot,
  type ActionConfig, type InputSnapshot,
} from '@forgeax/engine-input';
import { quat, vec3 } from '@forgeax/engine-math';
import {
  CharacterController, Collider, ColliderShapeValue, RigidBody, RigidBodyTypeValue,
  type PhysicsWorld,
} from '@forgeax/engine-physics';
import {
  ANTIALIAS_FXAA, BLOOM_ENABLED, Camera,
  SceneInstance, TONEMAP_REINHARD_EXTENDED, perspective,
} from '@forgeax/engine-render';
import { Name, Transform } from '@forgeax/engine-scene';
import {
  ParticleEffectPlayer,
  VFX_GPU_RUNTIME_RESOURCE_KEY,
  type VfxGpuRuntime,
} from '@forgeax/engine-vfx';
import {
  BEACON_ORDER,
  canAttune,
  checkpointLabel,
  explorationObjective,
  regionForPosition,
  requiredShards,
} from './src/echofall-rules';
import { installEchofallHud } from './src/echofall-hud';
import { createEchofallAvatar } from './src/echofall-avatar';
import { cinematicCameraTarget } from './src/echofall-camera';
import { landmarkVfxState } from './src/echofall-landmark-vfx';

type SceneRow = {
  entity: EntityHandle;
  name: string;
  originalPos: [number, number, number];
  originalScale: [number, number, number];
  hasCollider: boolean;
  hasParticleEffect: boolean;
};
type EventRow = { seq: number; type: string; entityId?: string; at: number };

const KEY = (key: string) => ({ type: 'key', key } as const);
const INPUT_MAP: readonly ActionConfig[] = [
  { action: 'forward', bindings: [KEY('w'), KEY('W'), KEY('ArrowUp')] },
  { action: 'back', bindings: [KEY('s'), KEY('S'), KEY('ArrowDown')] },
  { action: 'left', bindings: [KEY('a'), KEY('A'), KEY('ArrowLeft')] },
  { action: 'right', bindings: [KEY('d'), KEY('D'), KEY('ArrowRight')] },
  { action: 'jump', bindings: [KEY(' ')] },
  { action: 'interact', bindings: [KEY('e'), KEY('E')] },
  { action: 'sprint', bindings: [KEY('Shift')] },
  { action: 'recall', bindings: [KEY('c'), KEY('C')] },
  { action: 'restart', bindings: [KEY('r'), KEY('R')] },
];

export async function bootstrap(world: World, ctx?: BootstrapContext): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#app');
  if (!canvas) throw new Error('ForgeaX game canvas #app is missing');
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  const aspect = canvas.width / canvas.height || 1;
  const hud = await installEchofallHud(ctx);
  ctx?.registerCleanup?.(() => hud.dispose());

  world.insertResource(INPUT_MAP_KEY, INPUT_MAP);
  const emptyInput = createInputSnapshot();
  const readInput = (): InputSnapshot => world.hasResource(INPUT_SNAPSHOT_RESOURCE_KEY)
    ? world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY) : emptyInput;
  const synthetic = new Set<string>();
  const syntheticJust = new Set<string>();
  const pressed = (...keys: string[]) => keys.some((key) => synthetic.has(key));
  const just = (...keys: string[]) => keys.some((key) => syntheticJust.has(key));

  const mapping = new Map<number, EntityHandle>();
  if (ctx?.defaultSceneRoot !== undefined) {
    const instance = world.get(ctx.defaultSceneRoot, SceneInstance);
    if (instance.ok) {
      const values = instance.value.mapping as unknown as { length: number; [index: number]: number };
      for (let index = 0; index < values.length; index += 1) {
        const entity = values[index];
        // Entity handle 0 is valid; only the explicit unmapped sentinel is absent.
        if (entity !== undefined && entity !== 0xffffffff) mapping.set(index, entity as EntityHandle);
      }
    }
  }

  const sceneRows: SceneRow[] = [];
  const byName = new Map<string, SceneRow>();
  for (const node of ctx?.defaultScene?.entities ?? []) {
    const components = node.components as Record<string, Record<string, unknown>>;
    const name = components.Name?.value as string | undefined;
    const transform = components.Transform as { pos?: number[]; scale?: number[] } | undefined;
    const entity = mapping.get(node.localId);
    if (!name || !transform?.pos || entity === undefined) continue;
    const row: SceneRow = {
      entity, name,
      originalPos: [transform.pos[0] ?? 0, transform.pos[1] ?? 0, transform.pos[2] ?? 0],
      originalScale: [transform.scale?.[0] ?? 1, transform.scale?.[1] ?? 1, transform.scale?.[2] ?? 1],
      hasCollider: components.Collider !== undefined,
      hasParticleEffect: components.ParticleEffectPlayer !== undefined,
    };
    sceneRows.push(row); byName.set(name, row);
  }

  const readPhysics = (): PhysicsWorld | undefined => {
    try { return world.getResource<PhysicsWorld>('PhysicsWorld'); }
    catch { return undefined; }
  };
  const readVfxTelemetry = (): GameProjectionValue => {
    if (!world.hasResource(VFX_GPU_RUNTIME_RESOURCE_KEY)) {
      return { status: 'unavailable', players: [], totals: { alive: 0, spawned: 0, dropped: 0, cpuUpdateMs: 0 } };
    }
    const runtime = world.getResource<VfxGpuRuntime>(VFX_GPU_RUNTIME_RESOURCE_KEY);
    const intents = runtime.snapshot();
    const diagnostics = runtime.diagnostics();
    type VfxTelemetryPlayer = {
      player: EntityHandle;
      tick: number;
      playing: boolean;
      timeScale: number;
      emitters: Array<{
        id: string;
        status: string;
        alive: number;
        capacity: number;
        spawned: number;
        dropped: number;
        overflow: number;
      }>;
      telemetry: {
        alive: number;
        spawned: number;
        dropped: number;
        backend: string;
        cpuUpdateMs: number;
        allocatedBytes: number;
      };
      diagnostics: Array<{ code: string }>;
      spaceDiagnostics: Array<{ code: string }>;
    };
    const players: VfxTelemetryPlayer[] = [];
    for (const row of world.query({ read: [ParticleEffectPlayer] }).unwrap()) {
      const player = row.get(ParticleEffectPlayer);
      const playerIntents = intents.filter((intent) => intent.player === row.entity);
      const emitterMap = new Map<string, {
        id: string;
        status: string;
        alive: number;
        capacity: number;
        spawned: number;
        dropped: number;
        overflow: number;
      }>();
      for (const intent of playerIntents) {
        const current = emitterMap.get(intent.emitter.id);
        if (current === undefined) {
          emitterMap.set(intent.emitter.id, {
            id: intent.emitter.id,
            status: 'gpu',
            alive: 0,
            capacity: intent.emitter.capacity,
            spawned: intent.spawnCount,
            dropped: 0,
            overflow: 0,
          });
        } else {
          current.spawned += intent.spawnCount;
        }
      }
      const spawned = [...emitterMap.values()].reduce((total, emitter) => total + emitter.spawned, 0);
      players.push({
        player: row.entity,
        tick: playerIntents.at(-1)?.tick ?? 0,
        playing: player.playing,
        timeScale: player.timeScale,
        emitters: [...emitterMap.values()],
        telemetry: { alive: 0, spawned, dropped: 0, backend: 'gpu', cpuUpdateMs: 0, allocatedBytes: 0 },
        diagnostics: diagnostics
          .filter((diagnostic) => diagnostic.detail.player === row.entity)
          .map((diagnostic) => ({ code: diagnostic.code })),
        spaceDiagnostics: [],
      });
    }
    return {
      status: 'ready',
      players,
      totals: players.reduce((total, playerRow) => ({
        alive: total.alive + playerRow.telemetry.alive,
        spawned: total.spawned + playerRow.telemetry.spawned,
        dropped: total.dropped + playerRow.telemetry.dropped,
        cpuUpdateMs: total.cpuUpdateMs + playerRow.telemetry.cpuUpdateMs,
      }), { alive: 0, spawned: 0, dropped: 0, cpuUpdateMs: 0 }),
    };
  };
  const staticCollisionBodies = sceneRows.filter((row) => row.hasCollider);
  const authoredStaticColliderCount = (ctx?.defaultScene?.entities ?? []).filter((node) =>
    (node.components as Record<string, unknown>).Collider !== undefined).length;

  const authoredSpawn = byName.get('PlayerSpawn')?.originalPos ?? [0, 1.2, 27];
  const spawn: [number, number, number] = [authoredSpawn[0], Math.max(1.2, authoredSpawn[1]), authoredSpawn[2]];
  const player = world.spawn(
    { component: Name, data: { value: 'EchoWardenPlayer' } },
    { component: Transform, data: { pos: [...spawn] } },
    { component: RigidBody, data: { type: RigidBodyTypeValue.kinematic, ccdEnabled: true } },
    { component: Collider, data: { shape: ColliderShapeValue.capsule, radius: 0.32, halfHeight: 0.58, friction: 0.8 } },
    { component: CharacterController, data: {
      offset: 0.01, maxSlopeClimbDeg: 45, minSlopeSlideDeg: 30,
      autoStepMaxHeight: 0.35, autoStepMinWidth: 0.15, snapToGroundDist: 0.12,
    } },
  ).unwrap();
  const avatar = await createEchofallAvatar(world, ctx?.assets, player);

  const CAMERA_INITIAL_YAW = 0.12;
  const CAMERA_PITCH = 0.18;
  const initialCameraTuning = cinematicCameraTarget(false, false, true);
  const camera = world.spawn(
    { component: Name, data: { value: 'EchofallThirdPersonCamera' } },
    { component: Transform, data: { pos: [initialCameraTuning.shoulder, spawn[1] + initialCameraTuning.height, spawn[2] + initialCameraTuning.distance] } },
    { component: Camera, data: {
      ...perspective({ fov: initialCameraTuning.fov, aspect, near: 0.08, far: 220 }),
      tonemap: TONEMAP_REINHARD_EXTENDED, bloom: BLOOM_ENABLED, antialias: ANTIALIAS_FXAA,
      clearColor: [0.025, 0.07, 0.13, 1],
    } },
    { component: AudioListener, data: {} },
  ).unwrap();

  let yaw = CAMERA_INITIAL_YAW;
  let cameraDistance = initialCameraTuning.distance;
  let cameraHeight = initialCameraTuning.height;
  let cameraShoulder = initialCameraTuning.shoulder;
  let cameraFov = initialCameraTuning.fov;
  const cameraPosition: [number, number, number] = [cameraShoulder, spawn[1] + cameraHeight, spawn[2] + cameraDistance];
  let vertical = 0;
  let grounded = false;
  let shards = 0;
  let beacons = 0;
  let deaths = 0;
  let phase: 'exploring' | 'respawning' | 'complete' = 'exploring';
  let checkpoint: [number, number, number] = [...spawn];
  let checkpointId = 'arrival';
  let message = '';
  let messageTimer = 0;
  let elapsed = 0;
  let tickCount = 0;
  let lastMoveCommand: [number, number, number] = [0, 0, 0];
  let lastMoveResult: [number, number, number] = [0, 0, 0];
  let blockedSeconds = 0;
  let nextBlockedHintAt = 0;
  let recalls = 0;
  let seq = 0;
  const events: EventRow[] = [];
  const collected = new Set<string>();
  const activated = new Set<string>();
  const event = (type: string, entityId?: string) => {
    events.push({ seq: ++seq, type, ...(entityId ? { entityId } : {}), at: elapsed });
    if (events.length > 20) events.shift();
  };
  const say = (text: string, seconds = 2.5) => { message = text; messageTimer = seconds; };
  const resetVisuals = () => {
    for (const row of sceneRows) world.set(row.entity, Transform, { pos: row.originalPos, scale: row.originalScale });
  };
  const restart = () => {
    resetVisuals(); collected.clear(); activated.clear(); shards = 0; beacons = 0; deaths = 0;
    phase = 'exploring'; checkpoint = [...spawn]; checkpointId = 'arrival'; vertical = 0; yaw = CAMERA_INITIAL_YAW;
    cameraDistance = initialCameraTuning.distance; cameraHeight = initialCameraTuning.height;
    cameraShoulder = initialCameraTuning.shoulder; cameraFov = initialCameraTuning.fov;
    blockedSeconds = 0; nextBlockedHintAt = 0; recalls = 0;
    readPhysics()?.teleport(player, vec3.create(spawn[0], spawn[1], spawn[2])); world.set(player, Transform, { pos: spawn });
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);
    cameraPosition[0] = spawn[0] - fx * cameraDistance + rx * cameraShoulder;
    cameraPosition[1] = spawn[1] + cameraHeight;
    cameraPosition[2] = spawn[2] - fz * cameraDistance + rz * cameraShoulder;
    event('restart'); say('THE JOURNEY BEGINS AGAIN', 3);
  };
  const recallCheckpoint = (reason: 'fall' | 'manual' | 'invalid') => {
    phase = 'respawning';
    readPhysics()?.teleport(player, vec3.create(checkpoint[0], checkpoint[1], checkpoint[2]));
    world.set(player, Transform, { pos: checkpoint });
    vertical = 0;
    blockedSeconds = 0;
    recalls += 1;
    event(reason === 'fall' ? 'respawn' : 'checkpoint_recall', checkpointId);
    phase = beacons === 3 ? 'complete' : 'exploring';
    say(reason === 'fall'
      ? `THE WIND RETURNS YOU TO ${checkpointLabel(checkpointId)}`
      : `RETURNED TO ${checkpointLabel(checkpointId)}`, 3);
  };

  if (ctx?.gameProjection) {
    const disposers = [
      ctx.gameProjection.registerAction({
        id: 'input', title: 'Control the Echo Warden',
        description: 'Apply the same key state consumed by the live InputMap.',
        argsSchema: { type: 'object', required: ['type', 'key', 'phase'], properties: {
          type: { type: 'string', enum: ['key'] }, key: { type: 'string' }, phase: { type: 'string', enum: ['down', 'up'] },
        } },
        run: (args: GameProjectionValue) => {
          const input = args as { key: string; phase: string };
          if (input.phase === 'down') { if (!synthetic.has(input.key)) syntheticJust.add(input.key); synthetic.add(input.key); }
          else synthetic.delete(input.key);
        },
      }),
      ctx.gameProjection.registerAction({
        id: 'echofall.restart', title: 'Restart Echofall', description: 'Reset all runtime exploration progress.',
        argsSchema: { type: 'object' }, run: () => restart(),
      }),
      ctx.gameProjection.registerRead({
        id: 'echofall.snapshot', title: 'Read Echofall state', description: 'Read movement, progress, checkpoint, and nearby interaction state.',
        read: (): GameProjectionValue => {
          const tr = world.get(player, Transform);
          const position: [number, number, number] = tr.ok
            ? [tr.value.pos[0], tr.value.pos[1], tr.value.pos[2]]
            : [0, 0, 0];
          const physicsState = readPhysics();
          const staticReady = physicsState === undefined ? 0 : staticCollisionBodies.filter((row) => physicsState.hasBody(row.entity)).length;
          const playerReady = physicsState?.hasBody(player) === true;
          const staticRegistered = Math.max(0, (physicsState?.getBodyCount() ?? 0) - (playerReady ? 1 : 0));
          return { phase, position, grounded, velocity: vertical, camera: {
            yaw, pitch: CAMERA_PITCH, distance: cameraDistance, height: cameraHeight,
            shoulder: cameraShoulder, fov: cameraFov, occluded: false,
          },
            shards: { collected: shards, total: 8 }, beacons: { activated: beacons, total: 3, currentId: BEACON_ORDER[beacons] ?? null },
            checkpointId, deaths, recalls, message, inputKeys: Array.from(synthetic),
            physicsAvailable: physicsState !== undefined, physicsRegistered: playerReady,
            physicsBodyCount: physicsState?.getBodyCount() ?? 0,
            staticPhysics: { registered: staticRegistered, total: authoredStaticColliderCount, mapped: staticReady },
            physicsMotion: { tickCount, command: lastMoveCommand, result: lastMoveResult },
            avatar: avatar.snapshot(), runId: 'echofall-runtime-1' } as unknown as GameProjectionValue;
        },
      }),
      ctx.gameProjection.registerRead({
        id: 'echofall.events', title: 'Read Echofall event ledger', description: 'Read the append-only recent exploration events.',
        read: (): GameProjectionValue => ({ events }),
      }),
      ctx.gameProjection.registerRead({
        id: 'echofall.vfx', title: 'Read Echofall native VFX telemetry',
        description: 'Read the latest GPU VFX fixed-tick intents and diagnostics.',
        read: readVfxTelemetry,
      }),
    ];
    ctx.registerCleanup?.(() => disposers.forEach((dispose) => dispose()));
  }

  world.addSystem(Update, defineSystem({
    name: 'echofall-exploration-loop', queries: [] as const, after: ['input-frame-start-scan'],
    fn: () => {
      const dt = Math.min(0.05, world.getResource(Time).delta);
      tickCount += 1;
      const physics = readPhysics();
      elapsed += dt; messageTimer = Math.max(0, messageTimer - dt);
      const input = readInput();
      if (input.action('restart').justPressed() || just('r', 'R')) restart();
      if (input.action('recall').justPressed() || just('c', 'C')) recallCheckpoint('manual');
      const trBefore = world.get(player, Transform);
      let px = trBefore.ok ? trBefore.value.pos[0] ?? 0 : 0;
      let py = trBefore.ok ? trBefore.value.pos[1] ?? 0 : 0;
      let pz = trBefore.ok ? trBefore.value.pos[2] ?? 0 : 0;

      const turn = Number(input.action('right').isPressed() || pressed('d', 'D', 'ArrowRight')) -
        Number(input.action('left').isPressed() || pressed('a', 'A', 'ArrowLeft'));
      const move = Number(input.action('forward').isPressed() || pressed('w', 'W', 'ArrowUp')) -
        Number(input.action('back').isPressed() || pressed('s', 'S', 'ArrowDown'));
      yaw -= turn * dt * 1.85;
      const controller = world.get(player, CharacterController);
      grounded = controller.ok && controller.value.grounded === true;
      if ((input.action('jump').justPressed() || just(' ')) && grounded) { vertical = 7.2; grounded = false; event('jump'); }
      vertical -= 18 * dt;
      if (grounded && vertical < 0) vertical = -0.25;
      const speed = input.action('sprint').isPressed() || pressed('Shift') ? 7.0 : 4.8;
      const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
      const physicsDriven = phase !== 'respawning' && physics?.hasBody(player) === true;
      if (physicsDriven) {
        lastMoveCommand = [fx * move * speed * dt, vertical * dt, fz * move * speed * dt];
        const resolved = physics.moveAndSlide(player, vec3.create(...lastMoveCommand));
        lastMoveResult = [resolved[0] ?? 0, resolved[1] ?? 0, resolved[2] ?? 0];
        const tryingToMove = Math.abs(move) > 0.05;
        const movedHorizontally = Math.hypot(lastMoveResult[0], lastMoveResult[2]) > 0.012;
        blockedSeconds = tryingToMove && !movedHorizontally ? blockedSeconds + dt : 0;
        if (blockedSeconds > 1.35 && elapsed >= nextBlockedHintAt) {
          nextBlockedHintAt = elapsed + 4;
          say(`PATH BLOCKED? PRESS C TO RETURN TO ${checkpointLabel(checkpointId)}`, 3);
        }
      }
      const trAfter = world.get(player, Transform);
      if (trAfter.ok) {
        px = trAfter.value.pos[0] ?? px; py = trAfter.value.pos[1] ?? py; pz = trAfter.value.pos[2] ?? pz;
      }
      const controllerAfter = world.get(player, CharacterController);
      if (controllerAfter.ok && controllerAfter.value.grounded) vertical = 0;
      const playerQ = quat.create(); quat.fromAxisAngle(playerQ, [0, 1, 0], yaw);
      world.set(player, Transform, { quat: [playerQ[0]!, playerQ[1]!, playerQ[2]!, playerQ[3]!] });

      if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) {
        deaths += 1;
        recallCheckpoint('invalid');
        px = checkpoint[0]; py = checkpoint[1]; pz = checkpoint[2];
      } else if (py < -9) {
        deaths += 1;
        recallCheckpoint('fall');
        px = checkpoint[0]; py = checkpoint[1]; pz = checkpoint[2];
      }

      for (const row of sceneRows) {
        if (!row.name.startsWith('EchoShard_') || collected.has(row.name)) continue;
        if (Math.hypot(px - row.originalPos[0], py - row.originalPos[1], pz - row.originalPos[2]) < 1.55) {
          collected.add(row.name); shards += 1; event('shard_collected', row.name);
          const goal = requiredShards(Math.min(beacons, 2));
          world.set(row.entity, Transform, { scale: [0, 0, 0] });
          say(`ECHO SHARD ${Math.min(shards, goal)} / ${goal}`, 2);
        } else {
          const q = quat.create(); quat.fromAxisAngle(q, [0, 1, 0], elapsed * 1.6 + row.originalPos[0]);
          world.set(row.entity, Transform, { pos: [row.originalPos[0], row.originalPos[1] + Math.sin(elapsed * 2 + row.originalPos[2]) * 0.18, row.originalPos[2]], quat: [q[0]!,q[1]!,q[2]!,q[3]!] });
        }
      }

      let interaction = 'WASD MOVE · SHIFT SPRINT · C RECALL TO CHECKPOINT';
      for (let index = 0; index < BEACON_ORDER.length; index += 1) {
        const id = BEACON_ORDER[index]!;
        const trigger = byName.get(`BeaconTrigger_${id}`);
        if (!trigger || activated.has(id)) continue;
        const distance = Math.hypot(px-trigger.originalPos[0], py-trigger.originalPos[1], pz-trigger.originalPos[2]);
        if (distance < 3.2) {
          const needed = requiredShards(index);
          interaction = canAttune(index, beacons, shards) ? `PRESS E · ATTUNE ${id.toUpperCase()} BEACON` :
            index !== beacons ? 'THIS BEACON SLEEPS BEYOND THE CURRENT PATH' : `NEED ${needed - shards} MORE ECHO SHARD${needed - shards === 1 ? '' : 'S'}`;
          if ((input.action('interact').justPressed() || just('e', 'E')) && canAttune(index, beacons, shards)) {
            activated.add(id); beacons += 1; checkpoint = [...trigger.originalPos]; checkpoint[1] += 0.8; checkpointId = id.toLowerCase();
            event('beacon_activated', id); event('checkpoint_set', checkpointId);
            say(`${id.toUpperCase()} BEACON AWAKENED`, 4);
            if (beacons === 3) { phase = 'complete'; event('complete'); say('THE SKY RIFT YIELDS · THE REACH IS RESTORED', 999); }
          }
        }
      }

      const moving = Math.abs(move) > 0.05;
      const sprinting = moving && (input.action('sprint').isPressed() || pressed('Shift'));
      avatar.update({ elapsed, moving, sprinting, grounded, verticalVelocity: vertical }, dt);
      for (const row of sceneRows) {
        if (!row.name.startsWith('WindGrass_')) continue;
        const sway = Math.sin(elapsed * 1.6 + row.originalPos[0] * 0.4) * 0.1;
        const q = quat.create(); quat.fromAxisAngle(q,[0,0,1],sway); world.set(row.entity, Transform, { quat:[q[0]!,q[1]!,q[2]!,q[3]!] });
      }
      for (const row of sceneRows) {
        const beaconMatch = /^Beacon(Core|Halo)_(Dawn|Gale|Aether)$/.exec(row.name);
        if (!beaconMatch) continue;
        const beaconId = beaconMatch[2]!;
        const distance = Math.hypot(px - row.originalPos[0], pz - row.originalPos[2]);
        const state = landmarkVfxState(elapsed, distance, activated.has(beaconId));
        const scale = beaconMatch[1] === 'Core' ? state.coreScale : state.haloScale;
        const rotation = quat.create();
        quat.fromAxisAngle(rotation, [0, 1, 0], state.haloYaw);
        world.set(row.entity, Transform, {
          scale: row.originalScale.map((axis) => axis * scale) as [number, number, number],
          ...(beaconMatch[1] === 'Halo' ? { quat: [rotation[0]!, rotation[1]!, rotation[2]!, rotation[3]!] } : {}),
        });
        if (row.hasParticleEffect) world.set(row.entity, ParticleEffectPlayer, { timeScale: state.particleTimeScale });
      }

      const cameraYaw = quat.create(); quat.fromAxisAngle(cameraYaw, [0, 1, 0], yaw);
      const cameraPitch = quat.create(); quat.fromAxisAngle(cameraPitch, [1, 0, 0], CAMERA_PITCH);
      const cameraQ = quat.create(); quat.multiply(cameraQ, cameraYaw, cameraPitch);
      const cameraTarget = cinematicCameraTarget(moving, sprinting, grounded);
      const cameraBlend = 1 - Math.exp(-7.5 * dt);
      cameraDistance += (cameraTarget.distance - cameraDistance) * cameraBlend;
      cameraHeight += (cameraTarget.height - cameraHeight) * cameraBlend;
      cameraShoulder += (cameraTarget.shoulder - cameraShoulder) * cameraBlend;
      cameraFov += (cameraTarget.fov - cameraFov) * cameraBlend;
      const rightX = Math.cos(yaw), rightZ = -Math.sin(yaw);
      const desiredCamera: [number, number, number] = [
        px - fx * cameraDistance + rightX * cameraShoulder,
        py + cameraHeight,
        pz - fz * cameraDistance + rightZ * cameraShoulder,
      ];
      const follow = 1 - Math.exp(-cameraTarget.followRate * dt);
      cameraPosition[0] += (desiredCamera[0] - cameraPosition[0]) * follow;
      cameraPosition[1] += (desiredCamera[1] - cameraPosition[1]) * follow;
      cameraPosition[2] += (desiredCamera[2] - cameraPosition[2]) * follow;
      world.set(camera, Transform, { pos: cameraPosition, quat: [cameraQ[0]!,cameraQ[1]!,cameraQ[2]!,cameraQ[3]!] });
      world.set(camera, Camera, { fov: cameraFov });

      hud.update({ shards, shardGoal: requiredShards(Math.min(beacons, 2)), beacons, objective: explorationObjective(beacons, shards),
        interaction, message: messageTimer > 0 ? message : '', region: regionForPosition(pz),
        checkpoint: checkpointLabel(checkpointId) });
      syntheticJust.clear();
    },
  })).unwrap();
}
