import type { GameHost } from '@forgeax/engine-app';
import { HANDLE_CUBE } from '@forgeax/engine-assets-runtime';
import {
  Time,
  Update,
  type World,
  type EntityHandle,
} from '@forgeax/engine-ecs';
import {
  createInputSnapshot,
  FRAME_START_SCAN_SYSTEM_NAME,
  INPUT_SNAPSHOT_RESOURCE_KEY,
  type InputSnapshot,
} from '@forgeax/engine-input';
import { vec3 } from '@forgeax/engine-math';
import {
  CharacterController,
  Collider,
  ColliderShapeValue,
  RigidBody,
  RigidBodyTypeValue,
  type PhysicsWorld,
} from '@forgeax/engine-physics';
import {
  Materials,
  MeshFilter,
  MeshRenderer,
  Visibility,
  VisibilityStateValue,
} from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import { createWhiteboxMaterial } from './src/presentation';
import type { StreetAssets } from './src/street';
import { installCityCollision, CITY_COLLIDERS } from './src/fps/city-collision';
import {
  createNavigation,
  damageAfterCover,
  type EnemyState,
  type Point,
} from './src/fps/enemy-ai';
import { createCityLife } from './src/fps/city-life';
import { createEnemyLod } from './src/fps/enemy-lod';
import { createInjuryHud } from './src/fps/injury';
import { loadModel, animateEnemy, type Model } from './src/fps/models';
import { STREET_COLLISION_PROXIES } from './src/street-layout';
import { createFpsPresentation } from './src/fps/presentation';
import {
  WEAPONS,
  createArsenal,
  selectWeapon,
  reload,
  tickWeapon,
  spreadDegrees,
  follow,
} from './src/fps/weapons';

type V = [number, number, number];
type Host = GameHost & {
  assets?: StreetAssets;
  registerCleanup?: (fn: () => void) => void;
};
const INTERIORS = STREET_COLLISION_PROXIES.filter(
  (p) => p.name.startsWith('COL_INT_') && p.name.endsWith('_Floor'),
);
const SHOT_GROUPS = 0x0001_fffd; // World/target layer 1; exclude player membership layer 2.

export async function bootstrap(world: World, ctx?: Host): Promise<void> {
  const canvas =
    ctx?.canvas ??
    document.querySelector<HTMLCanvasElement>('#app canvas, canvas#app');
  if (!canvas || !ctx?.assets)
    throw new Error('[rain-fps] canvas and host assets are required');
  ctx.setPointerLockAllowed?.(true);
  installCityCollision(world);
  const perfOptions = new URLSearchParams(location.search);
  const optimizedScene = perfOptions.get('perfScene') !== 'original';
  const enemyLodEnabled = optimizedScene && perfOptions.get('enemyLod') !== 'off';
  const district = await loadModel(
    world,
    ctx.assets,
    optimizedScene ? 'district-batched' : 'district-lived',
    undefined,
    true,
  );
  world.set(district.root, Transform, { pos: [0, 0, 0] });
  const player = world
    .spawn(
      { component: Transform, data: { pos: [0, 0.9, -3] } },
      {
        component: RigidBody,
        data: { type: RigidBodyTypeValue.kinematic, ccdEnabled: true },
      },
      {
        component: Collider,
        data: {
          shape: ColliderShapeValue.capsule,
          radius: 0.32,
          halfHeight: 0.55,
          collisionGroups: 0x0002_ffff,
        },
      },
      {
        component: CharacterController,
        data: {
          offset: 0.01,
          autoStepMaxHeight: 0.38,
          autoStepMinWidth: 0.2,
          maxSlopeClimbDeg: 45,
          minSlopeSlideDeg: 30,
          snapToGroundDist: 0.16,
        },
      },
    )
    .unwrap();
  const presentation = await createFpsPresentation(
    world,
    canvas,
    ctx.uiRoot ?? canvas.parentElement ?? document.body,
    ctx.assets,
  );
  const cityLife = await createCityLife(world, ctx.assets);
  const injury = createInjuryHud(
    ctx.uiRoot ?? canvas.parentElement ?? document.body,
  );
  const navigation = createNavigation(CITY_COLLIDERS);
  const enemyFlashMaterial = world.internSharedRef(
    'MaterialAsset',
    Materials.unlit([4, 1.3, 0.25, 1], { castShadow: false }),
  );
  const white = createWhiteboxMaterial(world, [1, 0.93, 0.65, 1]);
  const targetBases = [
    [-1.35, 0, -13],
    [1.25, 0, -20],
    [7, 0, -28],
    [9.3, 0, -36],
    [7, 0, -54],
    [-13, 0, -44],
    [20, 0, -44],
    [27.8, 0, -58],
    [-9, 0.35, -12],
    [-1, 0.35, -31.5],
    [19, 0.35, -53.5],
    [35, 0.35, -52],
  ] as V[];
  const targets: {
    entity: EntityHandle;
    model: Model;
    lod?: Awaited<ReturnType<typeof createEnemyLod>>;
    base: V;
    pos: V;
    health: number;
    respawnAt: number;
    flashUntil: number;
    moving: boolean;
    poseAt: number;
    gear: Model;
    muzzle: EntityHandle;
    melee: boolean;
    state: EnemyState;
    path: Point[];
    pathAt: number;
    patrolIndex: number;
    lastSeen: V;
    seenUntil: number;
    windupUntil: number;
    cooldownUntil: number;
    facing: number;
    attacks: number;
    resolvedDamage: number;
    visible: boolean;
  }[] = [];
  for (const [index, base] of targetBases.entries()) {
    const pos: V = [base[0], base[1] + 0.96, base[2]];
    const entity = world
      .spawn(
        { component: Transform, data: { pos } },
        { component: RigidBody, data: { type: RigidBodyTypeValue.kinematic } },
        {
          component: Collider,
          data: {
            shape: ColliderShapeValue.capsule,
            radius: 0.24,
            halfHeight: 0.63,
          },
        },
      )
      .unwrap();
    world
      .addComponent(entity, { component: CharacterController, data: {} })
      .unwrap();
    world.set(entity, CharacterController, {
      offset: 0.02,
      autoStepMaxHeight: 0.35,
      autoStepMinWidth: 0.2,
      snapToGroundDist: 0.2,
    });
    const model = await loadModel(
      world,
      ctx.assets,
      ['lookout', 'enforcer', 'boss'][index % 3],
    );
    world.set(model.root, Transform, { pos: [base[0], base[1], base[2]] });
    const lod = enemyLodEnabled
      ? await createEnemyLod(
          world, ctx.assets, model, ['lookout', 'enforcer', 'boss'][index % 3],
        )
      : undefined;
    const melee = index % 3 === 1;
    const gear = await loadModel(
      world,
      ctx.assets,
      melee ? 'cleaver' : 'pistol',
      model.root,
    );
    world.set(gear.root, Visibility, { state: VisibilityStateValue.visible });
    world.set(gear.root, Transform, { pos: [0.23, 1.29, -0.47] });
    const muzzle = world
      .spawn(
        {
          component: Transform,
          data: { pos: [0, -50, 0], scale: [0.08, 0.08, 0.16] },
        },
        { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
        { component: MeshRenderer, data: { materials: [enemyFlashMaterial] } },
      )
      .unwrap();
    targets.push({
      entity,
      model,
      lod,
      base: pos,
      pos: [...pos] as V,
      health: 100,
      respawnAt: 0,
      flashUntil: 0,
      moving: index === 1 || index === 4,
      poseAt: 0,
      gear,
      muzzle,
      melee,
      state: 'patrol',
      path: [],
      pathAt: 0,
      patrolIndex: 0,
      lastSeen: [...pos] as V,
      seenUntil: 0,
      windupUntil: 0,
      cooldownUntil: 0,
      facing: 0,
      attacks: 0,
      resolvedDamage: 0,
      visible: false,
    });
  }
  const byEntity = new Map(targets.map((t) => [t.entity as number, t]));
  const sparks = Array.from({ length: 12 }, () => ({
    entity: world
      .spawn(
        {
          component: Transform,
          data: { pos: [0, -50, 0], scale: [0.04, 0.04, 0.04] },
        },
        { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
        { component: MeshRenderer, data: { materials: [white] } },
      )
      .unwrap(),
    until: 0,
  }));
  let relocation: V | null = null;
  let health = 100,
    lastHurt = -100,
    invulnerableUntil = 4,
    climbing = 0;
  const hurt = (damage: number, source: V) => {
    if (elapsed < invulnerableUntil || health <= 0) return;
    health = Math.max(0, health - damage);
    lastHurt = elapsed;
    presentation.hurt();
    injury.hit(
      elapsed,
      Math.atan2(-(source[0] - currentEye[0]), -(source[2] - currentEye[2])),
    );
    recoilPitch = Math.min(0.18, recoilPitch + 0.025);
    if (health === 0) document.exitPointerLock();
  };
  let currentEye: V = [0, 1.62, -3];
  let sparkIndex = 0,
    elapsed = 0,
    yaw = 0,
    pitch = 0,
    recoilPitch = 0,
    recoilYaw = 0;
  let aimBlend = 0,
    eyeHeight = 1.62,
    coyoteUntil = 0,
    jumpBufferedUntil = 0;
  let vx = 0,
    vz = 0,
    vy = 0,
    kills = 0,
    shots = 0,
    hits = 0,
    wheelReady = 0;
  const arsenal = createArsenal(),
    empty = createInputSnapshot();
  const frameTimes: number[] = [];
  let previousTime = performance.now();
  let lastRay: {
    entity: number | null;
    distance: number;
    target: boolean;
  } | null = null;
  const fire = (physics: PhysicsWorld, eye: V, aim: number, speed: number) => {
    const w = WEAPONS[arsenal.selected];
    shots++;
    const spread =
      (spreadDegrees(w, aim, speed, arsenal.bloom) * Math.PI) / 180;
    let didHit = false,
      headHit = false,
      killed = false;
    for (let i = 0; i < w.pellets; i++) {
      const angle = Math.random() * Math.PI * 2,
        radius = Math.sqrt(Math.random()) * spread;
      const shotYaw = yaw + recoilYaw + Math.cos(angle) * radius;
      const shotPitch = pitch + recoilPitch + Math.sin(angle) * radius;
      const direction = vec3.create(
        -Math.sin(shotYaw) * Math.cos(shotPitch),
        Math.sin(shotPitch),
        -Math.cos(shotYaw) * Math.cos(shotPitch),
      );
      const hit = physics.raycast(
        vec3.create(...eye),
        direction,
        w.range,
        SHOT_GROUPS,
      );
      lastRay = {
        entity: hit?.entity ?? null,
        distance: hit?.timeOfImpact ?? w.range,
        target: !!hit && byEntity.has(hit.entity),
      };
      if (!hit) continue;
      const spark = sparks[sparkIndex++ % sparks.length];
      spark.until = elapsed + 0.08;
      world.set(spark.entity, Transform, {
        pos: [hit.point[0], hit.point[1], hit.point[2]],
      });
      const target = byEntity.get(hit.entity);
      if (!target || target.health <= 0) continue;
      const head = hit.point[1] > target.pos[1] + 0.48;
      target.health -=
        w.damage *
        (head ? 1.8 : 1) *
        (w.family === 'shotgun'
          ? Math.max(0.25, 1 - (hit.timeOfImpact / w.range) * 0.65)
          : 1);
      target.flashUntil = elapsed + 0.09;
      didHit = true;
      headHit ||= head;
      if (target.health <= 0) {
        kills++;
        killed = true;
        target.respawnAt = elapsed + 12;
        target.state = 'dead';
        target.windupUntil = 0;
        world.set(target.entity, Transform, {
          pos: [target.pos[0], -30, target.pos[2]],
        });
        physics.teleport(
          target.entity,
          vec3.create(target.pos[0], -30, target.pos[2]),
        );
      }
    }
    if (didHit) {
      hits++;
      presentation.hit(elapsed, killed, headHit);
    }
    const degrees = Math.PI / 180;
    recoilPitch = Math.min(
      0.16,
      recoilPitch + w.recoil * (0.75 - aim * 0.27) * degrees,
    );
    recoilYaw +=
      Math.sin(arsenal.shotIndex * 0.65) *
      w.recoil *
      (0.3 - aim * 0.15) *
      degrees;
    presentation.shot(arsenal.selected, elapsed);
  };
  world
    .addSystem(Update, {
      name: 'rain-fps',
      after: [FRAME_START_SCAN_SYSTEM_NAME],
      queries: [],
      fn: () => {
        const now = performance.now();
        frameTimes.push(now - previousTime);
        previousTime = now;
        if (frameTimes.length > 600) frameTimes.shift();
        const dt = Math.min(world.getResource(Time).delta, 0.05);
        elapsed += dt;
        const input = world.hasResource(INPUT_SNAPSHOT_RESOURCE_KEY)
          ? world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY)
          : empty;
        const key = (code: string) => input.keyboard.downCode(code);
        const pressed = (code: string) => input.keyboard.justPressedCode(code);
        const rawLocked = input.mouse.pointerLocked;
        if (health <= 0 && (pressed('Enter') || injury.takeRestart())) {
          health = 100;
          Object.assign(arsenal, createArsenal());
          kills = shots = hits = 0;
          lastHurt = -100;
          invulnerableUntil = elapsed + 4;
          const pw = world.getResource<PhysicsWorld>('PhysicsWorld');
          relocation = [0, 0.9, -3];
          vx = vz = vy = 0;
          yaw = pitch = 0;
          climbing = 0;
          for (const t of targets) {
            t.health = 100;
            t.pos = [...t.base] as V;
            t.path = [];
            t.pathAt = 0;
            t.seenUntil = 0;
            t.windupUntil = 0;
            t.cooldownUntil = elapsed + 3;
            world.set(t.entity, Transform, { pos: [...t.base] });
            pw.teleport(t.entity, vec3.create(...t.base));
          }
          void canvas.requestPointerLock()?.catch(() => {});
        }
        const locked = rawLocked && health > 0;
        if (health > 0 && elapsed - lastHurt > 7)
          health = Math.min(100, health + dt * 7);
        if (pressed('KeyB')) presentation.toggleArmory();
        if (pressed('KeyM')) presentation.toggleSound();
        let selection = presentation.takeSelection();
        if (locked) {
          if (pressed('KeyQ')) selection = arsenal.selected - 1;
          if (pressed('KeyE')) selection = arsenal.selected + 1;
          if (input.mouse.wheelDelta && elapsed > wheelReady) {
            selection = arsenal.selected + Math.sign(input.mouse.wheelDelta);
            wheelReady = elapsed + 0.14;
          }
          for (let i = 0; i < 10; i++)
            if (pressed(`Digit${(i + 1) % 10}`)) selection = i;
        }
        if (selection !== null) selectWeapon(arsenal, selection, elapsed);
        const aim = locked && input.mouse.button(2);
        const sprint =
          locked &&
          key('ShiftLeft') &&
          !aim &&
          !input.mouse.button(0) &&
          !arsenal.reloadEnd;
        aimBlend = follow(
          aimBlend,
          aim && !arsenal.reloadEnd ? 1 : 0,
          4 / WEAPONS[arsenal.selected].adsTime,
          dt,
        );
        const sensitivity =
          0.0021 * (1 + (WEAPONS[arsenal.selected].zoom / 80 - 1) * aimBlend);
        if (locked) {
          yaw -= input.mouse.movementDelta.x * sensitivity;
          pitch = Math.max(
            -1.45,
            Math.min(1.45, pitch - input.mouse.movementDelta.y * sensitivity),
          );
        }
        recoilPitch = follow(
          recoilPitch,
          0,
          WEAPONS[arsenal.selected].recovery,
          dt,
        );
        recoilYaw = follow(
          recoilYaw,
          0,
          WEAPONS[arsenal.selected].recovery,
          dt,
        );
        const physics = world.getResource<PhysicsWorld>('PhysicsWorld');
        if (!physics.hasBody(player)) return;
        let x = locked ? Number(key('KeyD')) - Number(key('KeyA')) : 0;
        let z = locked ? Number(key('KeyW')) - Number(key('KeyS')) : 0;
        const norm = Math.max(1, Math.hypot(x, z));
        x /= norm;
        z /= norm;
        const speed = aim ? 2.5 : sprint ? 7.8 : 4.7;
        const grounded = world
          .get(player, CharacterController)
          .unwrap().grounded;
        vx = follow(
          vx,
          (Math.cos(yaw) * x - Math.sin(yaw) * z) * speed,
          grounded ? (x || z ? 32 : 42) : 6,
          dt,
        );
        vz = follow(
          vz,
          (-Math.sin(yaw) * x - Math.cos(yaw) * z) * speed,
          grounded ? (x || z ? 32 : 42) : 6,
          dt,
        );
        if (grounded && vy < 0) vy = -0.6;
        if (grounded) coyoteUntil = elapsed + 0.08;
        if (locked && pressed('Space')) jumpBufferedUntil = elapsed + 0.1;
        if (jumpBufferedUntil > elapsed && coyoteUntil > elapsed) {
          vy = 5.4;
          jumpBufferedUntil = 0;
          coyoteUntil = 0;
        }
        vy -= 18 * dt;
        const warp = relocation;
        relocation = null;
        if (warp) {
          world.set(player, Transform, { pos: warp });
          physics.teleport(player, vec3.create(...warp));
          vx = vz = vy = 0;
        }
        const beforePos = world.get(player, Transform).unwrap().pos;
        const ladderNear =
          Math.abs(beforePos[0] - 1.1) < 1.0 &&
          Math.abs(beforePos[2] + 10) < 0.7 &&
          beforePos[1] < 1.7;
        if (locked && pressed('KeyF') && ladderNear) climbing = elapsed;
        if (warp) {
          /* Fixed physics consumes the matching ECS pose before movement resumes. */
        } else if (climbing && health > 0) {
          const t = Math.min(1, (elapsed - climbing) / 2.4);
          // Authored clear ladder shaft, exclusive of the normal controller for this action.
          const desired: V = [
            t < 0.8 ? 1.05 : 1.05 + ((t - 0.8) / 0.2) * 1.2,
            0.9 + 3.35 * Math.min(1, t / 0.8),
            -10,
          ];
          physics.moveAndSlide(
            player,
            vec3.create(
              ...(desired.map((v, i) =>
                Math.max(-2 * dt, Math.min(2 * dt, v - beforePos[i])),
              ) as V),
            ),
          );
          vx = vz = vy = 0;
          if (
            t >= 1 &&
            Math.hypot(...desired.map((v, i) => v - beforePos[i])) < 0.12
          )
            climbing = 0;
          if (elapsed - climbing > 5) climbing = 0;
        } else
          physics.moveAndSlide(player, vec3.create(vx * dt, vy * dt, vz * dt));
        const pos = world.get(player, Transform).unwrap().pos;
        if (pos[1] < -8) {
          relocation = [0, 0.9, -3];
          vx = vz = vy = 0;
        }
        eyeHeight =
          Math.abs(eyeHeight - pos[1] - 0.74) > 1
            ? pos[1] + 0.74
            : follow(eyeHeight, pos[1] + 0.74, grounded ? 28 : 45, dt);
        const eye: V = [pos[0], eyeHeight, pos[2]];
        currentEye = eye;
        const eligible = targets
          .filter((t) => t.health > 0)
          .sort(
            (a, b) =>
              Math.hypot(a.pos[0] - eye[0], a.pos[2] - eye[2]) -
              Math.hypot(b.pos[0] - eye[0], b.pos[2] - eye[2]),
          )
          .slice(0, 3);
        for (const [i, target] of targets.entries()) {
          if (!physics.hasBody(target.entity)) continue;
          target.lod?.update(
            Math.hypot(target.pos[0] - eye[0], target.pos[2] - eye[2]),
            elapsed,
            target.health > 0 && target.moving,
          );
          world.set(target.muzzle, Transform, { pos: [0, -50, 0] });
          if (target.health <= 0) {
            if (elapsed < target.respawnAt) {
              animateEnemy(
                world,
                target.model,
                elapsed,
                false,
                0,
                Math.min(1, (elapsed - (target.respawnAt - 12)) / 0.55),
              );
              world.set(target.model.root, Transform, {
                pos: [target.pos[0], target.pos[1] - 0.96, target.pos[2]],
              });
              continue;
            }
            target.health = 100;
            target.pos = [...target.base] as V;
            target.path = [];
            target.pathAt = 0;
            target.windupUntil = 0;
            target.seenUntil = 0;
            world.set(target.entity, Transform, { pos: [...target.base] });
            physics.teleport(target.entity, vec3.create(...target.base));
            continue;
          }
          const delta: V = [
            eye[0] - target.pos[0],
            eye[1] - target.pos[1] - 0.45,
            eye[2] - target.pos[2],
          ];
          const distance = Math.hypot(...delta),
            dir = delta.map((v) => v / Math.max(0.001, distance)) as V;
          const origin = vec3.create(
            target.pos[0] + dir[0] * 0.45,
            target.pos[1] + 0.45 + dir[1] * 0.45,
            target.pos[2] + dir[2] * 0.45,
          );
          const line =
            distance < 27
              ? physics.raycast(
                  origin,
                  vec3.create(...dir),
                  Math.max(0.01, distance - 0.45),
                  0x0001ffff,
                )
              : undefined;
          const visible =
            locked &&
            distance < 27 &&
            (!line || line.entity === (player as number));
          target.visible = visible;
          if (visible) {
            target.lastSeen = [...eye] as V;
            target.seenUntil = elapsed + 5;
          }
          let attacking = false;
          if (locked && target.windupUntil && elapsed >= target.windupUntil) {
            const damage = damageAfterCover(visible, distance, target.melee);
            if (damage) hurt(damage, target.pos);
            target.resolvedDamage += damage;
            presentation.enemyAttack(
              distance,
              Math.sin(target.facing - yaw),
              target.melee,
            );
            target.attacks++;
            target.windupUntil = 0;
            target.cooldownUntil = elapsed + (target.melee ? 1.5 : 1.8);
          }
          if (
            locked &&
            visible &&
            eligible.includes(target) &&
            elapsed > invulnerableUntil &&
            elapsed >= target.cooldownUntil &&
            !target.windupUntil &&
            distance <= (target.melee ? 1.8 : 19)
          ) {
            target.windupUntil = elapsed + (target.melee ? 0.7 : 0.85);
            target.state = 'windup';
          }
          attacking = target.windupUntil > elapsed;
          if (!locked) {
            target.windupUntil = 0;
            target.cooldownUntil = Math.max(
              target.cooldownUntil,
              elapsed + 0.5,
            );
          }
          const pursuing = locked && target.seenUntil > elapsed;
          target.state = attacking
            ? 'windup'
            : elapsed < target.cooldownUntil
              ? 'recover'
              : pursuing
                ? 'chase'
                : 'patrol';
          const canMove =
            locked &&
            !attacking &&
            !(visible && !target.melee && distance < 16);
          if (canMove && elapsed >= target.pathAt) {
            const patrol: Point = [
              target.base[0] + (i >= 8 ? 0 : i % 2 ? -0.75 : 0.75),
              target.base[2] + (target.patrolIndex % 2 ? -1.3 : 1.3),
            ];
            const goal: Point = pursuing
              ? [target.lastSeen[0], target.lastSeen[2]]
              : patrol;
            target.path = navigation.path([target.pos[0], target.pos[2]], goal);
            target.pathAt = elapsed + 1.2 + i * 0.017;
            if (
              !pursuing &&
              Math.hypot(target.pos[0] - goal[0], target.pos[2] - goal[1]) < 0.8
            )
              target.patrolIndex++;
          }
          let dx = 0,
            dz = 0;
          if (canMove && target.path.length) {
            const next = target.path[0],
              dist = Math.hypot(
                next[0] - target.pos[0],
                next[1] - target.pos[2],
              );
            if (dist < 0.18) target.path.shift();
            else {
              const step = Math.min(dist, (pursuing ? 1.8 : 0.75) * dt);
              dx = ((next[0] - target.pos[0]) / dist) * step;
              dz = ((next[1] - target.pos[2]) / dist) * step;
            }
          }
          if (locked)
            physics.moveAndSlide(target.entity, vec3.create(dx, -3 * dt, dz));
          const updated = world.get(target.entity, Transform).unwrap().pos;
          target.pos = [...updated] as V;
          target.moving = Math.hypot(dx, dz) > 0.001;
          if (visible) target.facing = Math.atan2(-delta[0], -delta[2]);
          else if (target.moving) target.facing = Math.atan2(-dx, -dz);
          if (elapsed >= target.poseAt) {
            target.poseAt = elapsed + (distance < 20 ? 1 / 30 : 1 / 10);
            animateEnemy(
              world,
              target.model,
              elapsed,
              target.moving,
              Math.max(0, (target.flashUntil - elapsed) / 0.09),
              0,
            );
            world.set(target.model.root, Transform, {
              pos: [target.pos[0], target.pos[1] - 0.96, target.pos[2]],
              quat: [
                0,
                Math.sin(target.facing / 2),
                0,
                Math.cos(target.facing / 2),
              ],
            });
            const swing =
              attacking && target.melee
                ? Math.sin(((target.windupUntil - elapsed) / 0.7) * Math.PI) *
                  0.9
                : 0;
            const arm = target.model.parts.get('ARM_R'),
              forearm = target.model.parts.get('FOREARM_R');
            if (arm)
              world.set(arm.entity, Transform, {
                quat: [
                  Math.sin((-2.14 - swing) / 2),
                  0,
                  0,
                  Math.cos((-2.14 - swing) / 2),
                ],
              });
            if (forearm)
              world.set(forearm.entity, Transform, {
                quat: [Math.sin(0.4), 0, 0, Math.cos(0.4)],
              });
            world.set(target.gear.root, Transform, {
              pos: [0.23, 1.29 + swing * 0.18, -0.47 + swing * 0.12],
              quat: [0, Math.cos(swing / 2), Math.sin(swing / 2), 0],
            });
          }
          if (
            !target.melee &&
            elapsed > target.cooldownUntil - 1.8 &&
            elapsed < target.cooldownUntil - 1.68 &&
            target.attacks > 0
          )
            world.set(target.muzzle, Transform, {
              pos: [
                target.pos[0] - Math.sin(target.facing) * 0.65,
                target.pos[1] + 0.34,
                target.pos[2] - Math.cos(target.facing) * 0.65,
              ],
            });
        }
        cityLife.update(elapsed, eye);
        injury.update(
          health,
          elapsed,
          yaw,
          climbing
            ? '攀爬中…'
            : ladderNear
              ? 'F · 攀上檢修梯'
              : health < 35 && health > 0
                ? '重傷 · 躲入掩體恢復'
                : '',
        );
        for (const spark of sparks)
          if (spark.until && elapsed > spark.until) {
            world.set(spark.entity, Transform, { pos: [0, -50, 0] });
            spark.until = 0;
          }
        if (locked && pressed('KeyR')) reload(arsenal, elapsed);
        if (!locked) arsenal.burstLeft = 0;
        if (
          tickWeapon(
            arsenal,
            elapsed,
            dt,
            locked && input.mouse.button(0),
            locked && input.mouse.justPressed(0),
          )
        )
          fire(physics, eye, aimBlend, Math.hypot(vx, vz));
        const wall = physics.raycast(
          vec3.create(...eye),
          vec3.create(
            -Math.sin(yaw) * Math.cos(pitch),
            Math.sin(pitch),
            -Math.cos(yaw) * Math.cos(pitch),
          ),
          0.85,
          SHOT_GROUPS,
        );
        const obstruction = wall
          ? Math.max(0, 1 - wall.timeOfImpact / 0.85)
          : 0;
        presentation.movement(
          elapsed,
          Math.hypot(vx, vz),
          grounded,
          INTERIORS.some(
            (p) =>
              Math.abs(pos[0] - p.center[0]) < p.size[0] / 2 &&
              Math.abs(pos[2] - p.center[2]) < p.size[2] / 2 &&
              pos[1] < 3,
          ),
        );
        presentation.update(
          arsenal,
          elapsed,
          dt,
          eye,
          yaw + recoilYaw,
          pitch + recoilPitch,
          aimBlend,
          Math.hypot(vx, vz),
          sprint,
          input.mouse.movementDelta.x,
          input.mouse.movementDelta.y,
          locked || health <= 0,
          kills,
          hits,
          shots,
          obstruction,
        );
      },
    })
    .unwrap();
  const debug = {
    /** Validation relocation goes through the same queued ECS/physics spawn path as restart. */
    relocate: (pos: V) => {
      relocation = [...pos] as V;
    },
    snapshot: () => ({
      sceneVariant: optimizedScene ? 'batched' : 'original',
      gameTime: elapsed,
      health,
      lastHurt,
      climbing,
      ambient: cityLife.counts,
      readyAt: arsenal.readyAt,
      canvasConnected: canvas.isConnected,
      canvasId: canvas.id,
      playerEntity: player,
      yaw,
      pitch,
      weapon: WEAPONS[arsenal.selected].id,
      ammo: [...arsenal.ammo],
      reloadEnd: arsenal.reloadEnd,
      shots,
      hits,
      kills,
      lastRay,
      player: Array.from(world.get(player, Transform).unwrap().pos),
      targets: targets.map((t) => ({
        entity: t.entity,
        position: t.pos,
        health: t.health,
        state: t.state,
        attacks: t.attacks,
        resolvedDamage: t.resolvedDamage,
        visible: t.visible,
        melee: t.melee,
        pathLength: t.path.length,
        lod: t.lod?.snapshot(),
      })),
      frameMs: (() => {
        const sorted = [...frameTimes].sort((a, b) => a - b);
        return {
          samples: sorted.length,
          median: sorted[Math.floor(sorted.length * 0.5)],
          p95: sorted[Math.floor(sorted.length * 0.95)],
        };
      })(),
    }),
  };
  Object.assign(window, { __rainFps: debug });
  ctx.registerCleanup?.(() => {
    presentation.dispose();
    injury.dispose();
    ctx.setPointerLockAllowed?.(false);
    delete (window as Window & { __rainFps?: typeof debug }).__rainFps;
  });
}
