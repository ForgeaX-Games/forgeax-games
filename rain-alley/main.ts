import type { GameHost } from '@forgeax/engine-app';
import { HANDLE_CUBE } from '@forgeax/engine-assets-runtime';
import { Time, Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  createInputSnapshot,
  FRAME_START_SCAN_SYSTEM_NAME,
  INPUT_MAP_KEY,
  INPUT_SNAPSHOT_RESOURCE_KEY,
  type ActionConfig,
  type InputSnapshot,
} from '@forgeax/engine-input';
import { vec3 } from '@forgeax/engine-math';
import {
  CharacterController,
  Collider,
  ColliderShapeValue,
  type PhysicsWorld,
  RigidBody,
  RigidBodyTypeValue,
} from '@forgeax/engine-physics';
import {
  MeshFilter,
  MeshRenderer,
} from '@forgeax/engine-render';
import { quat } from '@forgeax/engine-runtime';
import { ChildOf, Transform } from '@forgeax/engine-scene';
import type { Handle } from '@forgeax/engine-types';
import {
  advanceCoatPosition,
  advanceGameClock,
  advanceMobility,
  applySliceEvent,
  attemptLowStep,
  bearingFromPlayer,
  beginShotgunReload,
  isRespawnProtected,
  RESPAWN_GRACE_SECONDS,
  selectFiringSlot,
  createCoatShotgun,
  createEnemyCombatant,
  createGameClock,
  createHallEncounter,
  createKitchenEncounter,
  createMobilityState,
  createPlayerVitality,
  createShotgun,
  createSliceState,
  ENEMY_ARCHETYPES,
  fireShotgun,
  GAMEPLAY_TUNING,
  getPlayerMoveSpeed,
  killKitchenRusher,
  moveEnemyTowardPlayer,
  phaseTransitionPlacement,
  receiveEnemyContact,
  receiveEnemyHits,
  resetAlleyEncounter,
  resetHallEncounter,
  resetKitchenEncounter,
  type EnemyCombatant,
  requestSlowMotion,
  requestSprint,
  resolveShotgunHit,
  type SlicePhase,
  resolveCameraRelativeMovement,
  scaledGameDelta,
  tickEnemyCombatant,
  tickShotgun,
} from './src/rules';
import {
  createRainAlleyPresentation,
  createWhiteboxMaterial,
} from './src/presentation';
import {
  installStreetCollision,
  instantiateStreetScene,
  type StreetAssets,
} from './src/street';
import {
  STREET_COAT_SPAWN,
  STREET_DOOR_Z,
  STREET_HALL_PLACEMENTS,
  STREET_KNIFE_PLACEMENTS,
  STREET_PEEKER_PLACEMENTS,
  STREET_PHASE_STARTS,
  STREET_PLAYER_SPAWN,
} from './src/street-layout';

/** Street physics playtest: death resets teleport the player back to spawn. */
const PLAYER_DEATH_ENABLED = false;

type MaterialHandle = Handle<'MaterialAsset', 'shared'>;

const PLAYER_RADIUS = 0.38;
const PLAYER_HALF_HEIGHT = 0.5;
const PLAYER_Y = PLAYER_RADIUS + PLAYER_HALF_HEIGHT;
const GRAVITY = 18;
const CURB_HEIGHT = 0.35;
const INTRO_PLACEHOLDER_SECONDS = 2.5;

type Target = {
  readonly entity: EntityHandle;
  readonly gun: EntityHandle;
  /** Bright cube above the head; only visible while the enemy is shootable. */
  readonly marker: EntityHandle;
  readonly bodyMaterial: MaterialHandle;
  readonly archetype: keyof typeof ENEMY_ARCHETYPES;
  readonly coveredPosition: [number, number, number];
  readonly exposedPosition: [number, number, number];
  position: [number, number, number];
  combat: EnemyCombatant;
};

type KnifeRusher = {
  readonly entity: EntityHandle;
  readonly cleaver: EntityHandle;
  readonly bodyMaterial: MaterialHandle;
  readonly spawnPosition: [number, number, number];
  readonly wave: 1 | 2;
  position: [number, number, number];
  combat: EnemyCombatant;
  active: boolean;
};

const PHASE_STARTS: Record<Exclude<SlicePhase, 'intro-flashback' | 'victory-flashback'>, [number, number, number]> = {
  alley: [...STREET_PHASE_STARTS.alley],
  kitchen: [...STREET_PHASE_STARTS.kitchen],
  hall: [...STREET_PHASE_STARTS.hall],
  'coat-standoff': [...STREET_PHASE_STARTS['coat-standoff']],
};

type RainAlleyContext = GameHost & {
  readonly registerCleanup?: (cleanup: () => void) => void;
  readonly assets?: StreetAssets;
};

type KinematicPhysicsWorld = PhysicsWorld & {
  setKinematicPosition(
    entity: number,
    position: { x: number; y: number; z: number },
  ): void;
};

function spawnBox(
  world: World,
  material: MaterialHandle,
  position: [number, number, number],
  scale: [number, number, number],
  collision: boolean,
): EntityHandle {
  const components = [
    { component: Transform, data: { pos: position, scale } },
    { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
    { component: MeshRenderer, data: { materials: [material] } },
  ] as const;
  if (!collision) return world.spawn(...components).unwrap();
  return world.spawn(
    ...components,
    { component: RigidBody, data: { type: RigidBodyTypeValue.static } },
    {
      component: Collider,
      data: {
        shape: ColliderShapeValue.cuboid,
        halfExtents: [0.5, 0.5, 0.5],
        friction: 0.9,
        restitution: 0,
      },
    },
  ).unwrap();
}


type CreateEnemyMarker = (parent: EntityHandle, height: number) => EntityHandle;

function spawnTargets(world: World, createEnemyMarker: CreateEnemyMarker): Target[] {
  const shirt = createWhiteboxMaterial(world, [0.92, 0.16, 0.14, 1], 0.6);
  const gunMaterial = createWhiteboxMaterial(world, [0.08, 0.09, 0.11, 1], 0.42);
  const placements = STREET_PEEKER_PLACEMENTS;
  const peeker = ENEMY_ARCHETYPES['pistol-peeker'];
  return placements.map(({ covered, exposed }, index) => {
    const coveredPos: [number, number, number] = [covered[0], covered[1], covered[2]];
    const exposedPos: [number, number, number] = [exposed[0], exposed[1], exposed[2]];
    const entity = spawnBox(world, shirt, coveredPos, [0.72, 1.8, 0.62], true);
    const gun = world.spawn(
      {
        component: Transform,
        data: { pos: [0.48, 0.15, -0.38], scale: [0.14, 0.16, 0.48] },
      },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [gunMaterial] } },
      { component: ChildOf, data: { parent: entity } },
    ).unwrap();
    return {
      entity,
      gun,
      marker: createEnemyMarker(entity, 0.78),
      bodyMaterial: shirt,
      archetype: 'pistol-peeker',
      coveredPosition: coveredPos,
      exposedPosition: exposedPos,
      position: coveredPos,
      combat: {
        ...createEnemyCombatant(peeker),
        modeRemaining: peeker.coveredSeconds + index * 0.32,
      },
    };
  });
}

function spawnKnifeRushers(world: World): KnifeRusher[] {
  const apron = createWhiteboxMaterial(world, [0.88, 0.84, 0.72, 1], 0.86);
  // Magenta, not red: the melee threat must be told apart at a glance.
  const shirt = createWhiteboxMaterial(world, [0.95, 0.12, 0.6, 1], 0.6);
  const steel = createWhiteboxMaterial(world, [0.56, 0.61, 0.66, 1], 0.3);
  const placements = STREET_KNIFE_PLACEMENTS;
  const archetype = ENEMY_ARCHETYPES['knife-rusher'];
  return placements.map(({ wave, position }) => {
    const active = wave === 1;
    const entity = spawnBox(
      world,
      shirt,
      active ? [...position] : [position[0], -20, position[2]],
      [0.76, 1.8, 0.66],
      true,
    );
    world.spawn(
      { component: Transform, data: { pos: [0, 0.05, -0.35], scale: [0.64, 1.1, 0.08] } },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [apron] } },
      { component: ChildOf, data: { parent: entity } },
    ).unwrap();
    const cleaver = world.spawn(
      { component: Transform, data: { pos: [0.52, 0.18, -0.28], scale: [0.12, 0.48, 0.34] } },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [steel] } },
      { component: ChildOf, data: { parent: entity } },
    ).unwrap();
    return {
      entity,
      cleaver,
      bodyMaterial: shirt,
      spawnPosition: [...position],
      wave,
      position: [...position],
      combat: createEnemyCombatant(archetype),
      active,
    };
  });
}

function spawnHallTarget(
  world: World,
  archetype: 'tuxedo-smg' | 'long-coat',
  position: [number, number, number],
  createEnemyMarker: CreateEnemyMarker,
  hidden = false,
): Target {
  const tuxedo = createWhiteboxMaterial(
    world,
    archetype === 'long-coat' ? [0.72, 0.1, 0.85, 1] : [0.86, 0.1, 0.28, 1],
    0.6,
  );
  const shirt = createWhiteboxMaterial(world, [0.82, 0.84, 0.86, 1], 0.72);
  const gunMaterial = createWhiteboxMaterial(world, [0.09, 0.1, 0.12, 1], 0.38);
  const scale: [number, number, number] =
    archetype === 'long-coat' ? [0.86, 2.35, 0.72] : [0.76, 1.9, 0.66];
  const entity = spawnBox(
    world,
    tuxedo,
    hidden ? [position[0], -20, position[2]] : position,
    scale,
    true,
  );
  const gun = world.spawn(
    {
      component: Transform,
      data: {
        pos: [0.5, 0.15, -0.48],
        scale:
          archetype === 'long-coat'
            ? [0.17, 0.2, 1.05]
            : [0.16, 0.19, 0.64],
      },
    },
    { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
    { component: MeshRenderer, data: { materials: [gunMaterial] } },
    { component: ChildOf, data: { parent: entity } },
  ).unwrap();
  world.spawn(
    {
      component: Transform,
      data: {
        pos: [0, 0.18, -0.35],
        scale: [0.28, archetype === 'long-coat' ? 0.62 : 0.48, 0.08],
      },
    },
    { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
    { component: MeshRenderer, data: { materials: [shirt] } },
    { component: ChildOf, data: { parent: entity } },
  ).unwrap();
  return {
    entity,
    gun,
    marker: createEnemyMarker(entity, archetype === 'long-coat' ? 0.62 : 0.72),
    bodyMaterial: tuxedo,
    archetype,
    coveredPosition: position,
    exposedPosition: position,
    position,
    combat: createEnemyCombatant(ENEMY_ARCHETYPES[archetype]),
  };
}

function spawnHallSmgs(
  world: World,
  createEnemyMarker: CreateEnemyMarker,
): Target[] {
  const placements = STREET_HALL_PLACEMENTS;
  return placements.map((position) =>
    spawnHallTarget(
      world,
      'tuxedo-smg',
      [position[0], position[1], position[2]],
      createEnemyMarker,
      true,
    ),
  );
}

function spawnPlayerRoot(world: World): EntityHandle {
  return world.spawn(
    {
      component: Transform,
      data: { pos: [...STREET_PLAYER_SPAWN], quat: [0, 0, 0, 1] },
    },
    {
      component: RigidBody,
      data: { type: RigidBodyTypeValue.kinematic, ccdEnabled: true },
    },
    {
      component: Collider,
      data: {
        shape: ColliderShapeValue.capsule,
        radius: PLAYER_RADIUS,
        halfHeight: PLAYER_HALF_HEIGHT,
      },
    },
    {
      component: CharacterController,
      data: {
        offset: 0.01,
        maxSlopeClimbDeg: 45,
        minSlopeSlideDeg: 30,
        snapToGroundDist: 0.14,
      },
    },
  ).unwrap();
}

export async function bootstrap(world: World, ctx?: RainAlleyContext): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#app');
  if (!canvas) throw new Error('[rain-alley] #app canvas is required');
  ctx?.setPointerLockAllowed?.(true);
  ctx?.registerCleanup?.(() => ctx.setPointerLockAllowed?.(false));

  installStreetCollision(world);
  if (ctx?.assets === undefined) {
    throw new Error('[rain-alley] host did not inject assets; cannot instantiate the street scene');
  }
  await instantiateStreetScene(world, ctx.assets);
  const player = spawnPlayerRoot(world);
  const presentation = createRainAlleyPresentation(world, canvas, player, ctx);
  const targets = spawnTargets(world, presentation.createEnemyMarker);
  const knifeRushers = spawnKnifeRushers(world);
  const hallTargets = spawnHallSmgs(world, presentation.createEnemyMarker);
  let coatTarget: Target | null = null;
  // Every living enemy carries a beacon so it can be found over cover; the
  // beacon grows when the enemy is actually shootable.
  const syncMarker = (target: Target): void => {
    const next =
      target.combat.health <= 0
        ? 'off'
        : target.archetype === 'pistol-peeker' &&
            target.combat.mode !== 'exposed'
          ? 'covered'
          : 'exposed';
    presentation.setEnemyMarker(target.marker, next);
  };
  for (const target of targets) syncMarker(target);

  const KEY = (key: string) => ({ type: 'key', key }) as const;
  world.insertResource(INPUT_MAP_KEY, [
    { action: 'moveForward', bindings: [KEY('w'), KEY('W')] },
    { action: 'moveBack', bindings: [KEY('s'), KEY('S')] },
    { action: 'moveLeft', bindings: [KEY('a'), KEY('A')] },
    { action: 'moveRight', bindings: [KEY('d'), KEY('D')] },
    { action: 'sprint', bindings: [KEY('Shift')] },
    { action: 'lowStep', bindings: [KEY(' ')] },
    { action: 'slowMotion', bindings: [KEY('f'), KEY('F')] },
    { action: 'debugKill', bindings: [KEY('k'), KEY('K')] },
    { action: 'debugDeath', bindings: [KEY('x'), KEY('X')] },
  ] satisfies readonly ActionConfig[]);
  const emptyInput = createInputSnapshot();
  const readInput = (): InputSnapshot =>
    world.hasResource(INPUT_SNAPSHOT_RESOURCE_KEY)
      ? world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY)
      : emptyInput;

  let yaw = 0;
  let pitch = -0.08;
  let frameInput = emptyInput;
  let shotgun = createShotgun();
  let playerVitality = createPlayerVitality();
  let clock = createGameClock();
  /** Game-clock deadline before which the player cannot be damaged. */
  let graceEndsAt = RESPAWN_GRACE_SECONDS;
  /** Index into `targets` of the one alley peeker allowed out of cover. */
  let firingSlot: number | null = null;
  const debugEnabled =
    (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env?.DEV === true;
  let slice = createSliceState();
  let kitchenEncounter = createKitchenEncounter();
  let introElapsed = 0;
  const spawnDoor = (_phase: 'alley' | 'kitchen' | 'hall'): void => {
    // Shop mouths are cover. The old green door boxes belonged to the three-room corridor.
  };

  let verticalVelocity = 0;
  let suppressMovementOnce = false;
  const relocatePlayer = (
    position: [number, number, number],
    suppressNextMovement = false,
  ): void => {
    const physics = world.getResource<KinematicPhysicsWorld>('PhysicsWorld');
    if (physics.hasBody(player)) {
      physics.setKinematicPosition(
        player,
        { x: position[0], y: position[1], z: position[2] },
      );
    }
    world.set(player, Transform, { pos: position });
    verticalVelocity = 0;
    suppressMovementOnce ||= suppressNextMovement;
  };

  const teleportToPhaseStart = (phase: SlicePhase): void => {
    if (phase in PHASE_STARTS) {
      relocatePlayer(
        PHASE_STARTS[phase as keyof typeof PHASE_STARTS],
        true,
      );
    }
  };

  const syncDoor = (): void => {};

  const resetAlleyTargets = (): void => {
    const peeker = ENEMY_ARCHETYPES['pistol-peeker'];
    const reset = resetAlleyEncounter(targets.length);
    targets.forEach((target, index) => {
      target.combat = {
        ...reset.enemies[index]!,
        modeRemaining: peeker.coveredSeconds + index * 0.32,
      };
      target.position = target.coveredPosition;
      world.set(target.entity, Transform, {
        pos: target.coveredPosition,
        scale: [0.72, 1.8, 0.62],
      });
      syncMarker(target);
    });
    playerVitality = reset.player;
    shotgun = createShotgun();
    mobility = createMobilityState();
    firingSlot = null;
  };

  const setKnifeWaveActive = (wave: 1 | 2): void => {
    for (const rusher of knifeRushers) {
      if (rusher.wave !== wave || rusher.combat.health <= 0) continue;
      rusher.active = true;
      world.set(rusher.entity, Transform, {
        pos: rusher.position,
        scale: [0.76, 1.8, 0.66],
      });
    }
  };

  const resetKitchenTargets = (): void => {
    const archetype = ENEMY_ARCHETYPES['knife-rusher'];
    const reset = resetKitchenEncounter();
    kitchenEncounter = reset.encounter;
    for (const rusher of knifeRushers) {
      rusher.position = [...rusher.spawnPosition];
      rusher.combat = createEnemyCombatant(archetype);
      rusher.active = rusher.wave === 1;
      world.set(rusher.entity, Transform, {
        pos: rusher.active
          ? rusher.position
          : [rusher.position[0], -20, rusher.position[2]],
        scale: [0.76, 1.8, 0.66],
      });
    }
    playerVitality = reset.player;
    shotgun = reset.shotgun;
    mobility = createMobilityState();
  };

  const showHallTargets = (): void => {
    const encounter = createHallEncounter('hall');
    hallTargets.forEach((target, index) => {
      target.combat = {
        ...encounter.enemies[index]!.combat,
        modeRemaining:
          ENEMY_ARCHETYPES['tuxedo-smg'].coveredSeconds + index * 0.14,
      };
      target.position = target.exposedPosition;
      world.set(target.entity, Transform, {
        pos: target.position,
        scale: [0.76, 1.9, 0.66],
      });
      syncMarker(target);
    });
  };

  const spawnCoat = (): void => {
    const start: [number, number, number] = [...STREET_COAT_SPAWN];
    if (coatTarget === null) {
      coatTarget = spawnHallTarget(
        world,
        'long-coat',
        start,
        presentation.createEnemyMarker,
      );
    } else {
      coatTarget.position = start;
      coatTarget.combat = createEnemyCombatant(
        ENEMY_ARCHETYPES['long-coat'],
      );
      world.set(coatTarget.entity, Transform, {
        pos: start,
        scale: [0.86, 2.35, 0.72],
      });
    }
    coatTarget.combat = {
      ...coatTarget.combat,
      mode: 'exposed',
      modeRemaining: ENEMY_ARCHETYPES['long-coat'].exposedSeconds,
    };
    syncMarker(coatTarget);
  };

  const resetHallTargets = (phase: 'hall' | 'coat-standoff'): void => {
    const reset = resetHallEncounter(phase);
    playerVitality = reset.player;
    shotgun = phase === 'coat-standoff' ? createCoatShotgun() : createShotgun();
    mobility = createMobilityState();
    if (phase === 'hall') showHallTargets();
    else spawnCoat();
  };

  const sendSliceEvent = (
    event: Parameters<typeof applySliceEvent>[1],
  ): void => {
    const previous = slice;
    slice = applySliceEvent(slice, event);
    if (slice === previous) return;
    if (event.type === 'player-died') {
      presentation.showDeath(clock.realElapsed, slice.restartCount);
      graceEndsAt = clock.gameElapsed + RESPAWN_GRACE_SECONDS;
      teleportToPhaseStart(slice.phase);
      if (slice.phase === 'alley') resetAlleyTargets();
      if (slice.phase === 'kitchen') resetKitchenTargets();
      if (slice.phase === 'hall' || slice.phase === 'coat-standoff') {
        resetHallTargets(slice.phase);
      }
    }
    if (
      slice.phase !== previous.phase &&
      phaseTransitionPlacement(previous.phase, slice.phase) === 'phase-start'
    ) {
      teleportToPhaseStart(slice.phase);
      if (slice.phase === 'kitchen' || slice.phase === 'hall') {
        spawnDoor(slice.phase);
      }
      if (slice.phase === 'hall') showHallTargets();
    }
    if (
      previous.phase === 'hall' &&
      slice.phase === 'coat-standoff'
    ) {
      shotgun = createCoatShotgun();
      spawnCoat();
    }
    syncDoor();
  };

  let mobility = createMobilityState();
  world.addSystem(Update, {
    name: 'rain-alley-game-clock',
    after: [FRAME_START_SCAN_SYSTEM_NAME],
    queries: [],
    fn: () => {
      const realDelta = Math.min(world.getResource(Time).delta, 0.05);
      frameInput = readInput();
      if (
        shotgun.canSprint &&
        frameInput.action('sprint').justPressed()
      ) {
        mobility = requestSprint(mobility);
      }
      if (frameInput.action('slowMotion').justPressed()) {
        mobility = requestSlowMotion(mobility);
      }
      const mouse = frameInput.mouse;
      if (
        mouse.pointerLocked &&
        (mouse.movementDelta.x !== 0 || mouse.movementDelta.y !== 0)
      ) {
        yaw -= mouse.movementDelta.x * 0.0024;
        pitch = Math.max(
          -0.65,
          Math.min(0.55, pitch - mouse.movementDelta.y * 0.002),
        );
      }
      presentation.setPointerLocked(mouse.pointerLocked);
      clock = advanceGameClock(clock, {
        realDelta,
        gameDelta: scaledGameDelta(realDelta, mobility),
      });
      if (slice.phase === 'intro-flashback') {
        introElapsed += clock.gameDelta;
        if (introElapsed >= INTRO_PLACEHOLDER_SECONDS) {
          sendSliceEvent({ type: 'flashback-finished' });
        }
      }
      if (debugEnabled && frameInput.action('debugKill').justPressed()) {
        sendSliceEvent({ type: 'enemy-killed' });
      }
      if (
        PLAYER_DEATH_ENABLED &&
        debugEnabled &&
        frameInput.action('debugDeath').justPressed()
      ) {
        sendSliceEvent({ type: 'player-died' });
      }
    },
  }).unwrap();

  world.addSystem(Update, {
    name: 'rain-alley-gameplay',
    after: ['rain-alley-game-clock'],
    queries: [],
    fn: () => {
      let physics: PhysicsWorld;
      try {
        physics = world.getResource<PhysicsWorld>('PhysicsWorld');
      } catch {
        return;
      }
      if (!physics.hasBody(player)) return;
      const movementSuppressed = suppressMovementOnce;
      suppressMovementOnce = false;

      const movementInput = frameInput.getVector(
        'moveLeft',
        'moveRight',
        'moveBack',
        'moveForward',
      );
      const movement = resolveCameraRelativeMovement(
        movementInput.x,
        movementInput.y,
        yaw,
        shotgun.canSprint
          ? getPlayerMoveSpeed(mobility)
          : GAMEPLAY_TUNING.walkSpeed,
      );
      const controller = world.get(player, CharacterController);
      const grounded = controller.ok && controller.value.grounded === true;
      const playerTransform = world.get(player, Transform);
      const px = playerTransform.ok ? (playerTransform.value.pos[0] ?? 0) : 0;
      const py = playerTransform.ok
        ? (playerTransform.value.pos[1] ?? PLAYER_Y)
        : PLAYER_Y;
      const pz = playerTransform.ok ? (playerTransform.value.pos[2] ?? 0) : 0;
      const atCurb =
        Math.abs(px) >= 2.4 &&
        Math.abs(px) <= 3.3 &&
        py <= PLAYER_Y + 0.05;
      const enemyAhead = targets.some(
        (target) =>
          target.combat.health > 0 &&
          Math.abs(target.position[0] - px) < 0.9 &&
          target.position[2] < pz &&
          target.position[2] >= pz - 2,
      );
      const step = !movementSuppressed && frameInput.action('lowStep').justPressed()
        ? attemptLowStep({
            grounded,
            obstacleHeight: atCurb ? CURB_HEIGHT : 0,
            enemyAhead,
          })
        : { accepted: false, snapHeight: 0 };
      let movementY = 0;
      if (step.accepted) {
        relocatePlayer([px, py + step.snapHeight, pz]);
      } else if (!movementSuppressed) {
        verticalVelocity -= GRAVITY * clock.gameDelta;
        if (grounded && verticalVelocity < 0) verticalVelocity = -0.6;
        movementY = verticalVelocity * clock.gameDelta;
      }
      physics.moveAndSlide(
        player,
        vec3.create(
          movement.velocityX * clock.gameDelta,
          movementY,
          movement.velocityZ * clock.gameDelta,
        ),
      );
      const resolvedController = world.get(player, CharacterController);
      if (
        resolvedController.ok &&
        resolvedController.value.grounded === true
      ) {
        verticalVelocity = 0;
      }

      let movedPlayerTransform = world.get(player, Transform);
      if (movedPlayerTransform.ok && slice.doorUnlocked) {
        const z = movedPlayerTransform.value.pos[2] ?? 0;
        const threshold =
          slice.phase === 'alley'
            ? STREET_DOOR_Z.alley
            : slice.phase === 'kitchen'
              ? STREET_DOOR_Z.kitchen
              : slice.phase === 'hall'
                ? STREET_DOOR_Z.hall
                : Number.NEGATIVE_INFINITY;
        if (z <= threshold) sendSliceEvent({ type: 'enter-door' });
      }

      const facing = quat.create();
      quat.fromAxisAngle(facing, [0, 1, 0], yaw);
      world.set(player, Transform, {
        quat: [facing[0]!, facing[1]!, facing[2]!, facing[3]!],
      });

      const rangedTargets =
        slice.phase === 'alley'
          ? targets
          : slice.phase === 'hall'
            ? hallTargets
            : slice.phase === 'coat-standoff' && coatTarget !== null
              ? [coatTarget]
              : [];
      if (slice.phase === 'coat-standoff' && coatTarget !== null) {
        const [coatX, coatZ] = advanceCoatPosition(
          [coatTarget.position[0], coatTarget.position[2]],
          [px, pz],
          clock.gameDelta,
        );
        coatTarget.position = [
          coatX,
          coatTarget.position[1],
          coatZ,
        ];
        world.set(coatTarget.entity, Transform, {
          pos: coatTarget.position,
        });
      }
      // The alley hands out a single firing slot; every other segment lets its
      // enemies cycle independently.
      if (slice.phase === 'alley') {
        firingSlot = selectFiringSlot(
          firingSlot,
          targets.map((target) => target.combat),
        );
      } else {
        firingSlot = null;
      }
      if (rangedTargets.length > 0) {
        for (const [index, target] of rangedTargets.entries()) {
          if (target.combat.health <= 0) continue;
          const archetype = ENEMY_ARCHETYPES[target.archetype];
          const previousMode = target.combat.mode;
          const distance = Math.hypot(
            target.position[0] - px,
            target.position[2] - pz,
          );
          const result = tickEnemyCombatant(archetype, target.combat, {
            gameDelta: clock.gameDelta,
            distance,
            lineOfSight: true,
            mayExpose: slice.phase !== 'alley' || index === firingSlot,
          });
          target.combat = result.enemy;
          if (result.enemy.mode !== previousMode) {
            target.position =
              result.enemy.mode === 'exposed'
                ? target.exposedPosition
                : target.coveredPosition;
            world.set(target.entity, Transform, { pos: target.position });
            syncMarker(target);
          }
          if (result.shotsFired === 0) continue;

          presentation.showEnemyMuzzle(clock.realElapsed, [
            target.position[0],
            target.position[1] + 0.2,
            target.position[2],
          ]);
          const dx = px - target.position[0];
          const dy = py - (target.position[1] + 0.2);
          const dz = pz - target.position[2];
          const shotDistance = Math.hypot(dx, dy, dz);
          const direction = vec3.create(
            dx / shotDistance,
            dy / shotDistance,
            dz / shotDistance,
          );
          const origin = vec3.create(
            target.position[0] + direction[0]! * 0.7,
            target.position[1] + 0.2 + direction[1]! * 0.7,
            target.position[2] + direction[2]! * 0.7,
          );
          const hit = physics.raycast(origin, direction, shotDistance);
          if (
            PLAYER_DEATH_ENABLED &&
            hit?.entity === player &&
            !isRespawnProtected(graceEndsAt, clock.gameElapsed)
          ) {
            playerVitality = receiveEnemyHits(
              playerVitality,
              archetype,
              result.shotsFired,
            );
            presentation.showDamage(
              clock.realElapsed,
              bearingFromPlayer(target.position[0], target.position[2], px, pz, yaw),
            );
          }
          if (PLAYER_DEATH_ENABLED && playerVitality.dead) {
            sendSliceEvent({ type: 'player-died' });
            return;
          }
        }
      }

      if (slice.phase === 'kitchen') {
        const rusherArchetype = ENEMY_ARCHETYPES['knife-rusher'];
        const currentPlayer = world.get(player, Transform);
        const playerX = currentPlayer.ok
          ? (currentPlayer.value.pos[0] ?? PHASE_STARTS.kitchen[0])
          : PHASE_STARTS.kitchen[0];
        const playerZ = currentPlayer.ok
          ? (currentPlayer.value.pos[2] ?? PHASE_STARTS.kitchen[2])
          : PHASE_STARTS.kitchen[2];
        for (const rusher of knifeRushers) {
          if (!rusher.active || rusher.combat.health <= 0) continue;
          const moved = moveEnemyTowardPlayer(
            [rusher.position[0], rusher.position[2]],
            [playerX, playerZ],
            rusherArchetype,
            clock.gameDelta,
          );
          rusher.position = [moved[0], rusher.position[1], moved[1]];
          world.set(rusher.entity, Transform, { pos: rusher.position });
          if (
            Math.hypot(moved[0] - playerX, moved[1] - playerZ) > 0.82 ||
            isRespawnProtected(graceEndsAt, clock.gameElapsed)
          ) {
            continue;
          }
          if (!PLAYER_DEATH_ENABLED) continue;
          playerVitality = receiveEnemyContact(
            playerVitality,
            rusherArchetype,
          );
          presentation.showDamage(
            clock.realElapsed,
            bearingFromPlayer(moved[0], moved[1], playerX, playerZ, yaw),
          );
          if (playerVitality.dead) {
            sendSliceEvent({ type: 'player-died' });
            return;
          }
        }
      }

      mobility = advanceMobility(mobility, clock.gameDelta);
      shotgun = tickShotgun(shotgun, clock.gameElapsed);
      if (
        frameInput.keyboard.justPressed('r') ||
        frameInput.keyboard.justPressed('R')
      ) {
        shotgun = beginShotgunReload(shotgun, clock.gameElapsed);
      }
      if (!frameInput.mouse.justPressed(0)) return;
      const canFire =
        !step.accepted &&
        resolvedController.ok &&
        resolvedController.value.grounded === true;
      const fire = fireShotgun(shotgun, clock.gameElapsed, canFire);
      shotgun = fire.shotgun;
      if (!fire.fired) return;

      const transform = world.get(player, Transform);
      if (!transform.ok) return;
      const shotX = transform.value.pos[0] ?? 0;
      const shotY = transform.value.pos[1] ?? PLAYER_Y;
      const shotZ = transform.value.pos[2] ?? 0;
      const forwardX = -Math.sin(yaw);
      const forwardY = Math.tan(pitch);
      const forwardZ = -Math.cos(yaw);
      const forwardLength = Math.hypot(forwardX, forwardY, forwardZ);
      const aimX = forwardX / forwardLength;
      const aimY = forwardY / forwardLength;
      const aimZ = forwardZ / forwardLength;

      const shootableTargets: readonly (Target | KnifeRusher)[] =
        slice.phase === 'kitchen' ? knifeRushers : rangedTargets;
      const shootableByEntity = new Map(
        shootableTargets
          .filter((target) =>
            target.combat.health > 0 &&
            ('wave' in target
              ? target.active
              : target.archetype !== 'pistol-peeker' ||
                target.combat.mode === 'exposed'),
          )
          .map((target) => [target.entity, target] as const),
      );
      const pelletOffsets = [
        [-0.075, -0.035],
        [-0.025, -0.045],
        [0.025, -0.045],
        [0.075, -0.035],
        [-0.06, 0.035],
        [-0.02, 0.045],
        [0.02, 0.045],
        [0.06, 0.035],
      ] as const;
      const pelletHits = new Map<Target | KnifeRusher, number>();
      const rayOrigin = vec3.create(shotX, shotY + 1.05, shotZ);
      for (const [horizontal, vertical] of pelletOffsets) {
        const pelletDirection = vec3.create(
          aimX + Math.cos(yaw) * horizontal,
          aimY + vertical,
          aimZ - Math.sin(yaw) * horizontal,
        );
        const pelletLength = Math.hypot(
          pelletDirection[0]!,
          pelletDirection[1]!,
          pelletDirection[2]!,
        );
        pelletDirection[0] /= pelletLength;
        pelletDirection[1] /= pelletLength;
        pelletDirection[2] /= pelletLength;
        const rayHit = physics.raycast(rayOrigin, pelletDirection, 24);
        const target = rayHit === undefined
          ? undefined
          : shootableByEntity.get(rayHit.entity as EntityHandle);
        if (target !== undefined) {
          pelletHits.set(target, (pelletHits.get(target) ?? 0) + 1);
        }
      }

      // One centre ray decides only how far the visible tracer reaches, so the
      // streak stops at the wall the pellets stopped at.
      const centreHit = physics.raycast(
        rayOrigin,
        vec3.create(aimX, aimY, aimZ),
        24,
      );
      const tracerLength = centreHit?.timeOfImpact ?? 24;
      presentation.playShot({
        realElapsed: clock.realElapsed,
        origin: [shotX, shotY, shotZ],
        aim: [aimX, aimY, aimZ],
        yaw,
        tracerLength,
      });

      if (pelletHits.size === 0) return;
      const [aimedTarget, pelletHitCount] = [...pelletHits.entries()]
        .sort((left, right) => right[1] - left[1])[0]!;
      const distance = Math.hypot(
        aimedTarget.position[0] - shotX,
        aimedTarget.position[1] - (shotY + 1.05),
        aimedTarget.position[2] - shotZ,
      );
      const hit = resolveShotgunHit(
        distance,
        aimedTarget.combat.health,
        pelletHitCount,
      );
      aimedTarget.combat = {
        ...aimedTarget.combat,
        health: hit.remainingHealth,
      };
      if (hit.killed) {
        presentation.showEnemyKilled(aimedTarget.position, clock.realElapsed);
        if (!('wave' in aimedTarget)) syncMarker(aimedTarget);
        world.set(aimedTarget.entity, Transform, {
          pos: [
            aimedTarget.position[0],
            -20,
            aimedTarget.position[2],
          ],
        });
        if ('wave' in aimedTarget) {
          aimedTarget.active = false;
          const previousWave = kitchenEncounter.wave;
          kitchenEncounter = killKitchenRusher(kitchenEncounter);
          if (
            !kitchenEncounter.complete &&
            kitchenEncounter.wave !== previousWave
          ) {
            setKnifeWaveActive(kitchenEncounter.wave);
          }
        }
        sendSliceEvent({ type: 'enemy-killed' });
      } else {
        // A survivor must read as hit: it flashes white and is shoved back.
        presentation.showEnemyHit(
          aimedTarget.entity,
          aimedTarget.bodyMaterial,
          clock.realElapsed,
        );
        aimedTarget.position = [
          aimedTarget.position[0] + aimX * 0.16,
          aimedTarget.position[1],
          aimedTarget.position[2] + aimZ * 0.16,
        ];
        world.set(aimedTarget.entity, Transform, { pos: aimedTarget.position });
      }
      presentation.showPelletHits(
        aimedTarget.position,
        hit.pelletHits.length,
        clock.realElapsed,
      );
    },
  }).unwrap();

  world.addSystem(Update, {
    name: 'rain-alley-presentation',
    after: ['rain-alley-gameplay'],
    queries: [],
    fn: () => {
      presentation.update({
        realElapsed: clock.realElapsed,
        realDelta: clock.realDelta,
        gameElapsed: clock.gameElapsed,
        yaw,
        pitch,
        shotgun,
        mobility,
        slice,
        playerVitality,
        graceEndsAt,
        exposedEnemies: targets.filter(
          (target) => target.combat.health > 0 && target.combat.mode === 'exposed',
        ).length,
        debugEnabled,
      });
    },
  }).unwrap();
}
