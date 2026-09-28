export type GameClock = {
  readonly realDelta: number;
  readonly gameDelta: number;
  readonly realElapsed: number;
  readonly gameElapsed: number;
};

export type ClockStep = {
  readonly realDelta: number;
  readonly gameDelta: number;
};

export function createGameClock(): GameClock {
  return {
    realDelta: 0,
    gameDelta: 0,
    realElapsed: 0,
    gameElapsed: 0,
  };
}

function validDelta(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Keeps gameplay time independent from presentation time.
 * Runtime currently advances both at the same rate; later gameplay policy may
 * provide a different gameDelta without changing camera or HUD timing.
 */
export function advanceGameClock(clock: GameClock, step: ClockStep): GameClock {
  const realDelta = validDelta(step.realDelta);
  const gameDelta = validDelta(step.gameDelta);
  return {
    realDelta,
    gameDelta,
    realElapsed: clock.realElapsed + realDelta,
    gameElapsed: clock.gameElapsed + gameDelta,
  };
}

export type PlanarMovement = {
  readonly velocityX: number;
  readonly velocityZ: number;
  readonly magnitude: number;
};

export const GAMEPLAY_TUNING = {
  walkSpeed: 4.8,
  sprintSpeed: 7.2,
  knifeRusherSpeed: 8.6,
  sprintDuration: 1.5,
  sprintCooldown: 3,
  lowStepMinHeight: 0.3,
  lowStepMaxHeight: 0.4,
  // 0.75 game seconds at half speed is 1.5 seconds on the real-time clock.
  slowMotionDuration: 0.75,
  slowMotionCooldown: 9,
  slowMotionScale: 0.5,
} as const;

export type MobilityState = {
  readonly sprintRemaining: number;
  readonly sprintCooldownRemaining: number;
  readonly slowMotionRemaining: number;
  readonly slowMotionCooldownRemaining: number;
};

export type MobilityHudCountdowns = MobilityState;

export function createMobilityState(): MobilityState {
  return {
    sprintRemaining: 0,
    sprintCooldownRemaining: 0,
    slowMotionRemaining: 0,
    slowMotionCooldownRemaining: 0,
  };
}

export function requestSprint(state: MobilityState): MobilityState {
  if (state.sprintRemaining > 0 || state.sprintCooldownRemaining > 0) {
    return state;
  }
  return { ...state, sprintRemaining: GAMEPLAY_TUNING.sprintDuration };
}

export function requestSlowMotion(state: MobilityState): MobilityState {
  if (
    state.slowMotionRemaining > 0 ||
    state.slowMotionCooldownRemaining > 0
  ) {
    return state;
  }
  return {
    ...state,
    slowMotionRemaining: GAMEPLAY_TUNING.slowMotionDuration,
  };
}

function advanceTimedAction(
  active: number,
  cooldown: number,
  duration: number,
  delta: number,
): readonly [number, number] {
  if (active > 0) {
    const nextActive = Math.max(0, active - delta);
    if (nextActive > 0) return [nextActive, cooldown];
    const overflow = Math.max(0, delta - active);
    return [0, Math.max(0, duration - overflow)];
  }
  return [0, Math.max(0, cooldown - delta)];
}

export function advanceMobility(
  state: MobilityState,
  gameDelta: number,
): MobilityState {
  const delta = validDelta(gameDelta);
  const [sprintRemaining, sprintCooldownRemaining] = advanceTimedAction(
    state.sprintRemaining,
    state.sprintCooldownRemaining,
    GAMEPLAY_TUNING.sprintCooldown,
    delta,
  );
  const [slowMotionRemaining, slowMotionCooldownRemaining] =
    advanceTimedAction(
      state.slowMotionRemaining,
      state.slowMotionCooldownRemaining,
      GAMEPLAY_TUNING.slowMotionCooldown,
      delta,
    );
  return {
    sprintRemaining,
    sprintCooldownRemaining,
    slowMotionRemaining,
    slowMotionCooldownRemaining,
  };
}

export function getPlayerMoveSpeed(state: MobilityState): number {
  return state.sprintRemaining > 0
    ? GAMEPLAY_TUNING.sprintSpeed
    : GAMEPLAY_TUNING.walkSpeed;
}

export function scaledGameDelta(
  realDelta: number,
  state: MobilityState,
): number {
  const delta = validDelta(realDelta);
  return state.slowMotionRemaining > 0
    ? delta * GAMEPLAY_TUNING.slowMotionScale
    : delta;
}

/** Convert game-time ability state into the real seconds shown to players. */
export function getMobilityHudCountdowns(
  state: MobilityState,
): MobilityHudCountdowns {
  const gameTimeScale =
    state.slowMotionRemaining > 0 ? GAMEPLAY_TUNING.slowMotionScale : 1;
  return {
    sprintRemaining: state.sprintRemaining / gameTimeScale,
    sprintCooldownRemaining: state.sprintCooldownRemaining / gameTimeScale,
    slowMotionRemaining: state.slowMotionRemaining / gameTimeScale,
    slowMotionCooldownRemaining:
      state.slowMotionCooldownRemaining / gameTimeScale,
  };
}

export type LowStepAttempt = {
  readonly grounded: boolean;
  readonly obstacleHeight: number;
  readonly enemyAhead: boolean;
};

export type LowStepResult = {
  readonly accepted: boolean;
  readonly snapHeight: number;
};

/**
 * A low-step is a bounded grounded displacement, never a vertical launch.
 * Callers must supply enemy occupancy so this cannot become a vault.
 */
export function attemptLowStep(input: LowStepAttempt): LowStepResult {
  const height = validDelta(input.obstacleHeight);
  const accepted =
    input.grounded &&
    !input.enemyAhead &&
    height >= GAMEPLAY_TUNING.lowStepMinHeight &&
    height <= GAMEPLAY_TUNING.lowStepMaxHeight;
  return { accepted, snapHeight: accepted ? height : 0 };
}

/**
 * A segment restart drops the player back inside the enemies' firing lines, so
 * damage is ignored for this long while the player re-reads the fight.
 */
export const RESPAWN_GRACE_SECONDS = 1.6;

/** True while the post-restart grace window is still open. */
export function isRespawnProtected(graceEndsAt: number, now: number): boolean {
  return Number.isFinite(graceEndsAt) && now < graceEndsAt;
}

/**
 * Screen-space bearing of a world point relative to where the player is facing,
 * in degrees clockwise from straight ahead. Drives the damage direction arc.
 */
export function bearingFromPlayer(
  sourceX: number,
  sourceZ: number,
  playerX: number,
  playerZ: number,
  yaw: number,
): number {
  const dx = sourceX - playerX;
  const dz = sourceZ - playerZ;
  if (dx === 0 && dz === 0) return 0;
  // Player forward is (-sin yaw, -cos yaw); right is (cos yaw, -sin yaw).
  const forward = dx * -Math.sin(yaw) + dz * -Math.cos(yaw);
  const right = dx * Math.cos(yaw) + dz * -Math.sin(yaw);
  return (Math.atan2(right, forward) * 180) / Math.PI;
}

/** Resolve WASD input into camera-relative planar velocity. */
export function resolveCameraRelativeMovement(
  inputX: number,
  inputForward: number,
  cameraYaw: number,
  speed: number,
): PlanarMovement {
  const x = Number.isFinite(inputX) ? inputX : 0;
  const forward = Number.isFinite(inputForward) ? inputForward : 0;
  const rawMagnitude = Math.hypot(x, forward);
  if (rawMagnitude <= Number.EPSILON) {
    return { velocityX: 0, velocityZ: 0, magnitude: 0 };
  }

  const magnitude = Math.min(1, rawMagnitude);
  const normalizedX = x / rawMagnitude;
  const normalizedForward = forward / rawMagnitude;
  const yaw = Number.isFinite(cameraYaw) ? cameraYaw : 0;
  const movementSpeed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
  const sinYaw = Math.sin(yaw);
  const cosYaw = Math.cos(yaw);

  return {
    velocityX:
      (cosYaw * normalizedX - sinYaw * normalizedForward) *
      movementSpeed *
      magnitude,
    velocityZ:
      (-sinYaw * normalizedX - cosYaw * normalizedForward) *
      movementSpeed *
      magnitude,
    magnitude,
  };
}
export const SHOTGUN_CAPACITY = 8;
export const SHOTGUN_PELLET_COUNT = 8;
export const SHOTGUN_PUMP_SECONDS = 0.85;
export const SHOTGUN_RELOAD_SECONDS = 2.6;

export type ShotgunState = {
  readonly shells: number;
  readonly nextFireAt: number;
  readonly reloadEndsAt: number | null;
  readonly reloading: boolean;
  readonly canSprint: boolean;
};

export type ShotgunFireResult = {
  readonly fired: boolean;
  readonly shotgun: ShotgunState;
};

export type ShotgunHit = {
  readonly pelletHits: readonly number[];
  readonly damage: number;
  readonly remainingHealth: number;
  readonly killed: boolean;
};

export function createShotgun(): ShotgunState {
  return {
    shells: SHOTGUN_CAPACITY,
    nextFireAt: 0,
    reloadEndsAt: null,
    reloading: false,
    canSprint: true,
  };
}

export function createCoatShotgun(): ShotgunState {
  return {
    ...createShotgun(),
    shells: 4,
  };
}

export function tickShotgun(
  shotgun: ShotgunState,
  now: number,
): ShotgunState {
  if (shotgun.reloadEndsAt === null || now < shotgun.reloadEndsAt) {
    return shotgun;
  }
  return {
    shells: SHOTGUN_CAPACITY,
    nextFireAt: now,
    reloadEndsAt: null,
    reloading: false,
    canSprint: true,
  };
}

export function beginShotgunReload(
  shotgun: ShotgunState,
  now: number,
): ShotgunState {
  const current = tickShotgun(shotgun, now);
  if (current.reloading || current.shells === SHOTGUN_CAPACITY) return current;
  return {
    ...current,
    reloadEndsAt: now + SHOTGUN_RELOAD_SECONDS,
    reloading: true,
    canSprint: false,
  };
}

export function fireShotgun(
  shotgun: ShotgunState,
  now: number,
  grounded: boolean,
): ShotgunFireResult {
  const current = tickShotgun(shotgun, now);
  if (
    !grounded ||
    current.reloading ||
    current.shells === 0 ||
    now < current.nextFireAt
  ) {
    return { fired: false, shotgun: current };
  }
  return {
    fired: true,
    shotgun: {
      ...current,
      shells: current.shells - 1,
      nextFireAt: now + SHOTGUN_PUMP_SECONDS,
    },
  };
}

/** Deterministic whitebox spread; each number is one pellet's damage. */
export function resolveShotgunHit(
  distance: number,
  targetHealth: number,
  pelletHitCount = SHOTGUN_PELLET_COUNT,
): ShotgunHit {
  const safeDistance = Number.isFinite(distance) ? Math.max(0, distance) : 0;
  const safePelletHitCount = Number.isFinite(pelletHitCount)
    ? Math.max(0, Math.min(SHOTGUN_PELLET_COUNT, Math.floor(pelletHitCount)))
    : 0;
  const damagePerPellet = safeDistance <= 6 ? 12.5 : safeDistance <= 16 ? 6.25 : 3;
  const pelletHits = Array.from(
    { length: safePelletHitCount },
    () => damagePerPellet,
  );
  const damage = pelletHits.reduce((sum, pellet) => sum + pellet, 0);
  const remainingHealth = Math.max(0, targetHealth - damage);
  return {
    pelletHits,
    damage,
    remainingHealth,
    killed: remainingHealth === 0,
  };
}

export type EnemyArchetypeRule = {
  readonly maxHealth: number;
  readonly movementSpeed: number;
  readonly contactDamage: number;
  readonly shotDamage: number;
  readonly magazineSize: number;
  readonly shotInterval: number;
  readonly exposedSeconds: number;
  readonly coveredSeconds: number;
  readonly reloadSeconds: number;
  readonly attackRange: number;
};

export const PLAYER_MAX_HEALTH = 100;

export const ENEMY_ARCHETYPES = {
  'pistol-peeker': {
    maxHealth: 100,
    movementSpeed: 0,
    contactDamage: 0,
    shotDamage: 34,
    magazineSize: 3,
    shotInterval: 0.72,
    exposedSeconds: 1.8,
    coveredSeconds: 1.1,
    reloadSeconds: 2.6,
    attackRange: 18,
  },
  'knife-rusher': {
    maxHealth: 100,
    movementSpeed: GAMEPLAY_TUNING.knifeRusherSpeed,
    contactDamage: PLAYER_MAX_HEALTH,
    shotDamage: 0,
    magazineSize: 0,
    shotInterval: 0,
    exposedSeconds: 0,
    coveredSeconds: 0,
    reloadSeconds: 0,
    attackRange: 0,
  },
  'tuxedo-smg': {
    maxHealth: 100,
    movementSpeed: 0,
    contactDamage: 0,
    shotDamage: 4,
    magazineSize: 12,
    shotInterval: 0.2,
    exposedSeconds: 2.4,
    coveredSeconds: 0.8,
    reloadSeconds: 2.6,
    attackRange: 22,
  },
  'long-coat': {
    maxHealth: 450,
    movementSpeed: 0,
    contactDamage: 0,
    shotDamage: 18,
    magazineSize: 2,
    shotInterval: 1.2,
    exposedSeconds: 8,
    coveredSeconds: 0.6,
    reloadSeconds: 1.8,
    attackRange: 15,
  },
} as const satisfies Record<string, EnemyArchetypeRule>;

export type EnemyCombatant = {
  readonly health: number;
  readonly ammo: number;
  readonly mode: 'covered' | 'exposed';
  readonly modeRemaining: number;
  readonly nextShotRemaining: number;
};

export type EnemyCombatTick = {
  readonly gameDelta: number;
  readonly distance: number;
  readonly lineOfSight: boolean;
  /**
   * False holds a ready enemy behind cover. The alley uses it to let only one
   * peeker fire at a time, so the player always has a single answer to give.
   * Omitted means the enemy may expose freely.
   */
  readonly mayExpose?: boolean;
};

export type EnemyCombatResult = {
  readonly enemy: EnemyCombatant;
  readonly shotsFired: number;
};

/**
 * Pick which enemy owns the single firing slot. The current holder keeps it
 * until it dies or returns to cover, so exposure never ping-pongs mid-burst.
 * Returns null when nobody is out of cover or waiting to be let out.
 */
export function selectFiringSlot(
  holder: number | null,
  enemies: readonly EnemyCombatant[],
): number | null {
  const held = holder === null ? undefined : enemies[holder];
  if (held !== undefined && held.health > 0 && held.mode === 'exposed') {
    return holder;
  }
  const exposed = enemies.findIndex(
    (enemy) => enemy.health > 0 && enemy.mode === 'exposed',
  );
  if (exposed !== -1) return exposed;
  const ready = enemies.findIndex(
    (enemy) =>
      enemy.health > 0 && enemy.mode === 'covered' && enemy.modeRemaining === 0,
  );
  return ready === -1 ? null : ready;
}

export function createEnemyCombatant(
  archetype: EnemyArchetypeRule,
): EnemyCombatant {
  return {
    health: archetype.maxHealth,
    ammo: archetype.magazineSize,
    mode: 'covered',
    modeRemaining: archetype.coveredSeconds,
    nextShotRemaining: 0,
  };
}

export function tickEnemyCombatant(
  archetype: EnemyArchetypeRule,
  enemy: EnemyCombatant,
  input: EnemyCombatTick,
): EnemyCombatResult {
  if (enemy.health <= 0) return { enemy, shotsFired: 0 };
  const delta = validDelta(input.gameDelta);
  let current = enemy;

  if (current.mode === 'covered') {
    const remaining = Math.max(0, current.modeRemaining - delta);
    if (remaining > 0) {
      return {
        enemy: { ...current, modeRemaining: remaining },
        shotsFired: 0,
      };
    }
    if (input.mayExpose === false) {
      // Ready but waiting for the slot: a zero timer means "promote me next".
      return { enemy: { ...current, modeRemaining: 0 }, shotsFired: 0 };
    }
    current = {
      ...current,
      ammo:
        current.ammo === 0 ? archetype.magazineSize : current.ammo,
      mode: 'exposed',
      modeRemaining: archetype.exposedSeconds,
      // An enemy that has just popped out must acquire the target before it
      // fires. Without this the next peeker's first shot lands on the same
      // frame the previous one ran dry, leaving the player no gap to use.
      nextShotRemaining: archetype.shotInterval,
    };
  } else {
    current = {
      ...current,
      modeRemaining: Math.max(0, current.modeRemaining - delta),
      nextShotRemaining: Math.max(0, current.nextShotRemaining - delta),
    };
    if (current.modeRemaining === 0) {
      return {
        enemy: {
          ...current,
          mode: 'covered',
          modeRemaining: archetype.coveredSeconds,
        },
        shotsFired: 0,
      };
    }
  }

  if (
    current.ammo === 0 ||
    current.nextShotRemaining > 0 ||
    !input.lineOfSight ||
    input.distance > archetype.attackRange
  ) {
    return { enemy: current, shotsFired: 0 };
  }

  const ammo = current.ammo - 1;
  return {
    enemy: ammo === 0
      ? {
          ...current,
          ammo,
          mode: 'covered',
          modeRemaining: archetype.reloadSeconds,
          nextShotRemaining: 0,
        }
      : {
          ...current,
          ammo,
          nextShotRemaining: archetype.shotInterval,
        },
    shotsFired: 1,
  };
}

export type PlayerVitality = {
  readonly health: number;
  readonly dead: boolean;
};

export function createPlayerVitality(): PlayerVitality {
  return { health: PLAYER_MAX_HEALTH, dead: false };
}

export function receiveEnemyHits(
  player: PlayerVitality,
  archetype: EnemyArchetypeRule,
  hitCount: number,
): PlayerVitality {
  const hits = Number.isFinite(hitCount) ? Math.max(0, Math.floor(hitCount)) : 0;
  const health = Math.max(0, player.health - archetype.shotDamage * hits);
  return { health, dead: health === 0 };
}

export function receiveEnemyContact(
  player: PlayerVitality,
  archetype: EnemyArchetypeRule,
): PlayerVitality {
  const health = Math.max(0, player.health - archetype.contactDamage);
  return { health, dead: health === 0 };
}

export function moveEnemyTowardPlayer(
  enemy: readonly [number, number],
  player: readonly [number, number],
  archetype: EnemyArchetypeRule,
  gameDelta: number,
): readonly [number, number] {
  const dx = player[0] - enemy[0];
  const dz = player[1] - enemy[1];
  const distance = Math.hypot(dx, dz);
  if (distance <= Number.EPSILON) return enemy;
  const step = Math.min(distance, archetype.movementSpeed * validDelta(gameDelta));
  return [
    enemy[0] + (dx / distance) * step,
    enemy[1] + (dz / distance) * step,
  ];
}

export type SightBlocker = {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
};

function segmentIntersectsBlocker(
  from: readonly [number, number],
  to: readonly [number, number],
  blocker: SightBlocker,
): boolean {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  let enter = 0;
  let exit = 1;
  for (const [origin, direction, min, max] of [
    [from[0], dx, blocker.minX, blocker.maxX],
    [from[1], dz, blocker.minZ, blocker.maxZ],
  ] as const) {
    if (Math.abs(direction) <= Number.EPSILON) {
      if (origin < min || origin > max) return false;
      continue;
    }
    const first = (min - origin) / direction;
    const second = (max - origin) / direction;
    enter = Math.max(enter, Math.min(first, second));
    exit = Math.min(exit, Math.max(first, second));
    if (enter > exit) return false;
  }
  return exit >= 0 && enter <= 1;
}

export function isLineOfSightClear(
  from: readonly [number, number],
  to: readonly [number, number],
  blockers: readonly SightBlocker[],
): boolean {
  return !blockers.some((blocker) =>
    segmentIntersectsBlocker(from, to, blocker),
  );
}

export type AlleyEncounterReset = {
  readonly player: PlayerVitality;
  readonly enemies: readonly EnemyCombatant[];
};

export function resetAlleyEncounter(enemyCount: number): AlleyEncounterReset {
  const count = Number.isFinite(enemyCount)
    ? Math.max(0, Math.floor(enemyCount))
    : 0;
  const peeker = ENEMY_ARCHETYPES['pistol-peeker'];
  return {
    player: createPlayerVitality(),
    enemies: Array.from({ length: count }, () =>
      createEnemyCombatant(peeker),
    ),
  };
}

export type KitchenEncounter = {
  readonly wave: 1 | 2;
  readonly activeRushers: number;
  readonly queuedRushers: number;
  readonly defeatedRushers: number;
  readonly complete: boolean;
};

export function createKitchenEncounter(): KitchenEncounter {
  return {
    wave: 1,
    activeRushers: 2,
    queuedRushers: 2,
    defeatedRushers: 0,
    complete: false,
  };
}

export function killKitchenRusher(
  encounter: KitchenEncounter,
): KitchenEncounter {
  if (encounter.complete || encounter.activeRushers === 0) return encounter;
  const activeRushers = encounter.activeRushers - 1;
  const defeatedRushers = encounter.defeatedRushers + 1;
  if (activeRushers > 0) {
    return { ...encounter, activeRushers, defeatedRushers };
  }
  if (encounter.queuedRushers > 0) {
    return {
      wave: 2,
      activeRushers: encounter.queuedRushers,
      queuedRushers: 0,
      defeatedRushers,
      complete: false,
    };
  }
  return {
    ...encounter,
    activeRushers: 0,
    defeatedRushers,
    complete: true,
  };
}

export const KITCHEN_RETREAT_LIMIT_X = 22;

export function clampKitchenRetreat(positionX: number): number {
  const safePosition = Number.isFinite(positionX)
    ? positionX
    : KITCHEN_RETREAT_LIMIT_X;
  return Math.max(KITCHEN_RETREAT_LIMIT_X, safePosition);
}

export type KitchenEncounterReset = {
  readonly player: PlayerVitality;
  readonly shotgun: ShotgunState;
  readonly encounter: KitchenEncounter;
};

export function resetKitchenEncounter(): KitchenEncounterReset {
  return {
    player: createPlayerVitality(),
    shotgun: createShotgun(),
    encounter: createKitchenEncounter(),
  };
}

export const HALL_SMG_COUNT = 6;

export type HallEnemyArchetype = 'tuxedo-smg' | 'long-coat';

export type HallEncounterEnemy = {
  readonly archetype: HallEnemyArchetype;
  readonly combat: EnemyCombatant;
};

export type HallEncounterReset = {
  readonly player: PlayerVitality;
  readonly enemies: readonly HallEncounterEnemy[];
};

export function createHallEncounter(
  phase: 'hall' | 'coat-standoff',
): HallEncounterReset {
  const archetype: HallEnemyArchetype =
    phase === 'hall' ? 'tuxedo-smg' : 'long-coat';
  const count = phase === 'hall' ? HALL_SMG_COUNT : 1;
  return {
    player: createPlayerVitality(),
    enemies: Array.from({ length: count }, () => ({
      archetype,
      combat: createEnemyCombatant(ENEMY_ARCHETYPES[archetype]),
    })),
  };
}

export function resetHallEncounter(
  phase: 'hall' | 'coat-standoff',
): HallEncounterReset {
  return createHallEncounter(phase);
}

export const COAT_PUSH_SPEED = 1.15;
export const COAT_STANDOFF_RANGE = 7;

export function advanceCoatPosition(
  from: readonly [number, number],
  player: readonly [number, number],
  gameDelta: number,
): [number, number] {
  const dx = player[0] - from[0];
  const dz = player[1] - from[1];
  const distance = Math.hypot(dx, dz);
  if (distance <= COAT_STANDOFF_RANGE) return [from[0], from[1]];
  const travel = Math.min(
    distance - COAT_STANDOFF_RANGE,
    COAT_PUSH_SPEED * validDelta(gameDelta),
  );
  return [
    from[0] + (dx / distance) * travel,
    from[1] + (dz / distance) * travel,
  ];
}

export const SLICE_TARGET_DURATION_MINUTES = {
  min: 8,
  max: 12,
} as const;

export const SEGMENT_KILL_TARGETS = {
  alley: 5,
  kitchen: 4,
  hall: 6,
  'coat-standoff': 1,
} as const;

export type SlicePhase =
  | 'intro-flashback'
  | 'alley'
  | 'kitchen'
  | 'hall'
  | 'coat-standoff'
  | 'victory-flashback';

export type SliceState = {
  readonly phase: SlicePhase;
  readonly kills: number;
  readonly doorUnlocked: boolean;
  readonly restartCount: number;
};

export type SliceEvent =
  | { readonly type: 'flashback-finished' }
  | { readonly type: 'enemy-killed' }
  | { readonly type: 'enter-door' }
  | { readonly type: 'player-died' };

export function createSliceState(): SliceState {
  return {
    phase: 'intro-flashback',
    kills: 0,
    doorUnlocked: false,
    restartCount: 0,
  };
}

function combatTarget(
  phase: SlicePhase,
): number | undefined {
  return phase in SEGMENT_KILL_TARGETS
    ? SEGMENT_KILL_TARGETS[phase as keyof typeof SEGMENT_KILL_TARGETS]
    : undefined;
}

function startPhase(phase: SlicePhase, restartCount: number): SliceState {
  return { phase, kills: 0, doorUnlocked: false, restartCount };
}

export function phaseTransitionPlacement(
  previous: SlicePhase,
  next: SlicePhase,
): 'phase-start' | 'preserve-player' {
  return previous === 'hall' && next === 'coat-standoff'
    ? 'preserve-player'
    : 'phase-start';
}

export function applySliceEvent(
  state: SliceState,
  event: SliceEvent,
): SliceState {
  if (
    event.type === 'flashback-finished' &&
    state.phase === 'intro-flashback'
  ) {
    return startPhase('alley', state.restartCount);
  }

  if (event.type === 'player-died') {
    const target = combatTarget(state.phase);
    return target === undefined
      ? state
      : startPhase(state.phase, state.restartCount + 1);
  }

  if (event.type === 'enemy-killed') {
    const target = combatTarget(state.phase);
    if (target === undefined || state.kills >= target) return state;
    const kills = state.kills + 1;
    if (state.phase === 'coat-standoff' && kills === target) {
      return startPhase('victory-flashback', state.restartCount);
    }
    return {
      ...state,
      kills,
      doorUnlocked: kills === target,
    };
  }

  if (event.type === 'enter-door' && state.doorUnlocked) {
    if (state.phase === 'alley') {
      return startPhase('kitchen', state.restartCount);
    }
    if (state.phase === 'kitchen') {
      return startPhase('hall', state.restartCount);
    }
    if (state.phase === 'hall') {
      return startPhase('coat-standoff', state.restartCount);
    }
  }

  return state;
}
