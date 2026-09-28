import { describe, expect, test } from 'bun:test';
import {
  advanceGameClock,
  advanceCoatPosition,
  advanceMobility,
  applySliceEvent,
  attemptLowStep,
  bearingFromPlayer,
  beginShotgunReload,
  clampKitchenRetreat,
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
  getMobilityHudCountdowns,
  getPlayerMoveSpeed,
  HALL_SMG_COUNT,
  isLineOfSightClear,
  killKitchenRusher,
  phaseTransitionPlacement,
  receiveEnemyContact,
  receiveEnemyHits,
  resetAlleyEncounter,
  isRespawnProtected,
  RESPAWN_GRACE_SECONDS,
  resetHallEncounter,
  selectFiringSlot,
  resetKitchenEncounter,
  requestSlowMotion,
  requestSprint,
  moveEnemyTowardPlayer,
  resolveShotgunHit,
  SEGMENT_KILL_TARGETS,
  SHOTGUN_RELOAD_SECONDS,
  SLICE_TARGET_DURATION_MINUTES,
  resolveCameraRelativeMovement,
  scaledGameDelta,
  tickEnemyCombatant,
  tickShotgun,
} from '../src/rules';

describe('rain-alley game clock', () => {
  test('tracks gameplay time separately from real presentation time', () => {
    const start = createGameClock();
    const frame = advanceGameClock(start, {
      realDelta: 1 / 30,
      gameDelta: 1 / 60,
    });

    expect(frame.realElapsed).toBeCloseTo(1 / 30);
    expect(frame.gameElapsed).toBeCloseTo(1 / 60);
    expect(frame.realDelta).toBeCloseTo(1 / 30);
    expect(frame.gameDelta).toBeCloseTo(1 / 60);
  });

  test('ignores invalid or negative frame deltas', () => {
    const frame = advanceGameClock(createGameClock(), {
      realDelta: Number.NaN,
      gameDelta: -1,
    });

    expect(frame).toEqual(createGameClock());
  });
});

describe('rain-alley camera-relative movement', () => {
  test('moves forward in the camera facing direction', () => {
    expect(resolveCameraRelativeMovement(0, 1, 0, 5)).toEqual({
      velocityX: 0,
      velocityZ: -5,
      magnitude: 1,
    });
  });

  test('rotates forward movement with camera yaw', () => {
    const movement = resolveCameraRelativeMovement(0, 1, Math.PI / 2, 5);

    expect(movement.velocityX).toBeCloseTo(-5);
    expect(movement.velocityZ).toBeCloseTo(0);
  });

  test('normalizes diagonal keyboard input to walking speed', () => {
    const movement = resolveCameraRelativeMovement(1, 1, 0, 5);

    expect(Math.hypot(movement.velocityX, movement.velocityZ)).toBeCloseTo(5);
    expect(movement.magnitude).toBe(1);
  });

  test('stops when no movement input is held', () => {
    expect(resolveCameraRelativeMovement(0, 0, Math.PI, 5)).toEqual({
      velocityX: 0,
      velocityZ: 0,
      magnitude: 0,
    });
  });
});

describe('rain-alley pump shotgun', () => {
  test('resolves one clustered hitscan as exactly eight pellets', () => {
    const hit = resolveShotgunHit(4, 100);

    expect(hit.pelletHits).toHaveLength(8);
    expect(hit.damage).toBe(100);
    expect(hit.remainingHealth).toBe(0);
  });

  test('kills a regular target up close but needs a follow-up at half-alley', () => {
    const close = resolveShotgunHit(4, 100);
    const distantFirst = resolveShotgunHit(14, 100);
    const distantSecond = resolveShotgunHit(14, distantFirst.remainingHealth);

    expect(close.killed).toBe(true);
    expect(distantFirst.killed).toBe(false);
    expect(distantFirst.remainingHealth).toBe(50);
    expect(distantSecond.killed).toBe(true);
  });

  test('only applies pellets whose rays reached the target', () => {
    const blocked = resolveShotgunHit(4, 100, 0);
    const partial = resolveShotgunHit(4, 100, 3);

    expect(blocked).toMatchObject({
      pelletHits: [],
      damage: 0,
      remainingHealth: 100,
      killed: false,
    });
    expect(partial.pelletHits).toHaveLength(3);
    expect(partial.damage).toBe(37.5);
  });

  test('holds eight shells and pump-throttles follow-up shots', () => {
    let shotgun = createShotgun();
    expect(shotgun.shells).toBe(8);

    const first = fireShotgun(shotgun, 0, true);
    shotgun = first.shotgun;
    expect(first.fired).toBe(true);
    expect(shotgun.shells).toBe(7);
    expect(fireShotgun(shotgun, 0.84, true).fired).toBe(false);

    const followUp = fireShotgun(shotgun, 0.85, true);
    expect(followUp.fired).toBe(true);
    expect(followUp.shotgun.shells).toBe(6);
  });

  test('locks firing and sprint for the full 2.6 second magazine reload', () => {
    let shotgun = fireShotgun(createShotgun(), 0, true).shotgun;
    shotgun = beginShotgunReload(shotgun, 1);

    expect(shotgun.reloading).toBe(true);
    expect(shotgun.canSprint).toBe(false);
    expect(fireShotgun(shotgun, 3.59, true).fired).toBe(false);

    shotgun = tickShotgun(shotgun, 3.6);
    expect(shotgun.shells).toBe(8);
    expect(shotgun.reloading).toBe(false);
    expect(shotgun.canSprint).toBe(true);
    expect(fireShotgun(shotgun, 3.6, true).fired).toBe(true);
  });

  test('cannot fire an empty magazine until reload completes', () => {
    let shotgun = createShotgun();
    for (let shot = 0; shot < 8; shot += 1) {
      shotgun = fireShotgun(shotgun, shot * 0.85, true).shotgun;
    }

    expect(shotgun.shells).toBe(0);
    expect(fireShotgun(shotgun, 8, true).fired).toBe(false);

    shotgun = beginShotgunReload(shotgun, 8);
    expect(fireShotgun(shotgun, 10.59, true).fired).toBe(false);
    shotgun = tickShotgun(shotgun, 10.6);
    expect(fireShotgun(shotgun, 10.6, true).fired).toBe(true);
  });

  test('cannot fire while not grounded and does not consume a shell', () => {
    const result = fireShotgun(createShotgun(), 0, false);

    expect(result.fired).toBe(false);
    expect(result.shotgun.shells).toBe(8);
  });

  test('pump and reload advance on slowed game time, not real time', () => {
    const slow = requestSlowMotion(createMobilityState());
    let clock = advanceGameClock(createGameClock(), {
      realDelta: SHOTGUN_RELOAD_SECONDS,
      gameDelta: scaledGameDelta(SHOTGUN_RELOAD_SECONDS, slow),
    });
    let shotgun = fireShotgun(createShotgun(), 0, true).shotgun;
    shotgun = beginShotgunReload(shotgun, 0);

    expect(clock.realElapsed).toBe(SHOTGUN_RELOAD_SECONDS);
    expect(clock.gameElapsed).toBe(SHOTGUN_RELOAD_SECONDS / 2);
    expect(tickShotgun(shotgun, clock.gameElapsed).reloading).toBe(true);

    clock = advanceGameClock(clock, {
      realDelta: SHOTGUN_RELOAD_SECONDS,
      gameDelta: scaledGameDelta(SHOTGUN_RELOAD_SECONDS, slow),
    });
    shotgun = tickShotgun(shotgun, clock.gameElapsed);
    expect(shotgun.reloading).toBe(false);
    expect(fireShotgun(shotgun, clock.gameElapsed, true).fired).toBe(true);
  });
});

describe('rain-alley enemy archetype rules', () => {
  test('drives combat from a shared archetype contract rather than peeker branches', () => {
    const fixture = {
      maxHealth: 70,
      movementSpeed: 0,
      contactDamage: 0,
      shotDamage: 9,
      magazineSize: 2,
      shotInterval: 0.2,
      exposedSeconds: 0.6,
      coveredSeconds: 0.3,
      reloadSeconds: 1.4,
      attackRange: 12,
    } as const;
    let enemy = createEnemyCombatant(fixture);

    // Popping out costs one aim interval, so emptying a two-round magazine
    // takes three ticks: expose, first shot, last shot.
    for (const gameDelta of [0.3, 0.21]) {
      enemy = tickEnemyCombatant(fixture, enemy, {
        gameDelta,
        distance: 5,
        lineOfSight: true,
      }).enemy;
    }
    const volley = tickEnemyCombatant(fixture, enemy, {
      gameDelta: 0.21,
      distance: 5,
      lineOfSight: true,
    });

    expect(volley.shotsFired).toBe(1);
    expect(volley.enemy.ammo).toBe(0);
    expect(volley.enemy.mode).toBe('covered');
    expect(volley.enemy.modeRemaining).toBeCloseTo(fixture.reloadSeconds);
  });

  test('configures pistol peekers as three-hit threats', () => {
    const peeker = ENEMY_ARCHETYPES['pistol-peeker'];
    let player = createPlayerVitality();

    player = receiveEnemyHits(player, peeker, 2);
    expect(player.health).toBeGreaterThan(0);
    expect(player.dead).toBe(false);

    player = receiveEnemyHits(player, peeker, 1);
    expect(player.health).toBe(0);
    expect(player.dead).toBe(true);
  });

  test('uses game time and cannot fire through blocked line of sight', () => {
    const peeker = ENEMY_ARCHETYPES['pistol-peeker'];
    const exposed = tickEnemyCombatant(
      peeker,
      createEnemyCombatant(peeker),
      { gameDelta: peeker.coveredSeconds, distance: 8, lineOfSight: true },
    ).enemy;

    expect(
      tickEnemyCombatant(peeker, exposed, {
        gameDelta: peeker.shotInterval,
        distance: 8,
        lineOfSight: false,
      }).shotsFired,
    ).toBe(0);
    expect(
      tickEnemyCombatant(peeker, exposed, {
        gameDelta: peeker.shotInterval,
        distance: peeker.attackRange + 1,
        lineOfSight: true,
      }).shotsFired,
    ).toBe(0);
  });

  test('treats the alley corner blocker as safe line-of-sight cover', () => {
    const corner = { minX: 3.5, maxX: 4.9, minZ: -16.4, maxZ: -15.2 };

    expect(isLineOfSightClear([2.8, -14], [7, -14], [corner])).toBe(true);
    expect(isLineOfSightClear([2.8, -14], [7, -18], [corner])).toBe(false);
  });

  test('restarts alley combat with five live enemies and full player health', () => {
    const reset = resetAlleyEncounter(5);

    expect(reset.player).toEqual(createPlayerVitality());
    expect(reset.enemies).toHaveLength(5);
    expect(reset.enemies.every((enemy) => enemy.health > 0)).toBe(true);
  });

  test('six tuxedo SMGs kill in about one second after actual fire starts', () => {
    const smg = ENEMY_ARCHETYPES['tuxedo-smg'];
    let enemies = Array.from(
      { length: HALL_SMG_COUNT },
      () => createEnemyCombatant(smg),
    );
    let player = createPlayerVitality();
    let elapsed = 0;
    let firstFireAt: number | null = null;

    while (!player.dead) {
      elapsed += smg.shotInterval;
      let shots = 0;
      enemies = enemies.map((enemy) => {
        const result = tickEnemyCombatant(smg, enemy, {
          gameDelta: smg.shotInterval,
          distance: 12,
          lineOfSight: true,
        });
        shots += result.shotsFired;
        return result.enemy;
      });
      if (shots > 0 && firstFireAt === null) firstFireAt = elapsed;
      player = receiveEnemyHits(player, smg, shots);
    }

    expect(firstFireAt).not.toBeNull();
    expect(firstFireAt!).toBeGreaterThanOrEqual(smg.coveredSeconds);
    expect(elapsed - firstFireAt!).toBeCloseTo(0.8);
    expect(elapsed - firstFireAt!).toBeLessThanOrEqual(1.2);
  });

  test('hall side corners block SMG hitscan for a full reload window', () => {
    const leftCorner = {
      minX: 44.9,
      maxX: 47.1,
      minZ: -8.65,
      maxZ: -7.35,
    };
    const rightCorner = {
      minX: 44.9,
      maxX: 47.1,
      minZ: -20.65,
      maxZ: -19.35,
    };

    expect(isLineOfSightClear([56, -14], [44, -8], [leftCorner])).toBe(false);
    expect(isLineOfSightClear([56, -14], [44, -20], [rightCorner])).toBe(false);
    const smg = ENEMY_ARCHETYPES['tuxedo-smg'];
    const exposed = {
      ...createEnemyCombatant(smg),
      mode: 'exposed' as const,
      modeRemaining: smg.exposedSeconds,
    };
    expect(
      tickEnemyCombatant(smg, exposed, {
        gameDelta: 2.6,
        distance: 12,
        lineOfSight: false,
      }).shotsFired,
    ).toBe(0);
  });

  test('spawns exactly six SMGs before the coat and only one coat after', () => {
    const hall = createHallEncounter('hall');
    const coat = createHallEncounter('coat-standoff');

    expect(hall.enemies).toHaveLength(HALL_SMG_COUNT);
    expect(hall.enemies.every((enemy) => enemy.archetype === 'tuxedo-smg'))
      .toBe(true);
    expect(hall.enemies.some((enemy) => enemy.archetype === 'long-coat'))
      .toBe(false);
    expect(coat.enemies).toHaveLength(1);
    expect(coat.enemies[0]?.archetype).toBe('long-coat');
  });

  test('hall death resets six SMGs without spawning the coat', () => {
    const reset = resetHallEncounter('hall');

    expect(reset.player).toEqual(createPlayerVitality());
    expect(reset.enemies).toHaveLength(HALL_SMG_COUNT);
    expect(reset.enemies.every((enemy) =>
      enemy.archetype === 'tuxedo-smg' && enemy.combat.health > 0
    )).toBe(true);
    expect(reset.enemies.some((enemy) => enemy.archetype === 'long-coat'))
      .toBe(false);
  });

  test('the long coat dies in five close shotgun blasts', () => {
    let health = ENEMY_ARCHETYPES['long-coat'].maxHealth;

    for (let blast = 1; blast <= 4; blast += 1) {
      const hit = resolveShotgunHit(4, health);
      health = hit.remainingHealth;
      expect(hit.killed).toBe(false);
    }

    expect(resolveShotgunHit(4, health).killed).toBe(true);
  });

  test('coat entry forces a reload window before its fifth close blast', () => {
    let shotgun = createCoatShotgun();
    let health = ENEMY_ARCHETYPES['long-coat'].maxHealth;
    for (let blast = 0; blast < 4; blast += 1) {
      const fire = fireShotgun(shotgun, blast * 0.85, true);
      expect(fire.fired).toBe(true);
      shotgun = fire.shotgun;
      health = resolveShotgunHit(4, health).remainingHealth;
    }

    expect(health).toBe(50);
    expect(shotgun.shells).toBe(0);
    expect(fireShotgun(shotgun, 4, true).fired).toBe(false);

    shotgun = beginShotgunReload(shotgun, 4);
    expect(fireShotgun(shotgun, 6.59, true).fired).toBe(false);
    shotgun = tickShotgun(shotgun, 6.6);
    expect(fireShotgun(shotgun, 6.6, true).fired).toBe(true);
    expect(resolveShotgunHit(4, health).killed).toBe(true);
  });

  test('the long coat pushes slowly using game-clock delta', () => {
    expect(advanceCoatPosition([61.5, -14], [43, -14], 2)).toEqual([
      59.2,
      -14,
    ]);
    expect(advanceCoatPosition([50, -14], [43, -14], 2)).toEqual([50, -14]);
  });

  test('coat death resets only the coat encounter with a fresh boss', () => {
    const reset = resetHallEncounter('coat-standoff');

    expect(reset.player).toEqual(createPlayerVitality());
    expect(reset.enemies).toHaveLength(1);
    expect(reset.enemies[0]).toMatchObject({
      archetype: 'long-coat',
      combat: { health: ENEMY_ARCHETYPES['long-coat'].maxHealth },
    });
  });
});

describe('rain-alley kitchen knife rushers', () => {
  test('spawns four cooks as two waves of two and gates wave two on clearing wave one', () => {
    let kitchen = createKitchenEncounter();

    expect(kitchen).toMatchObject({
      wave: 1,
      activeRushers: 2,
      queuedRushers: 2,
      defeatedRushers: 0,
      complete: false,
    });

    kitchen = killKitchenRusher(kitchen);
    expect(kitchen.activeRushers).toBe(1);
    expect(kitchen.wave).toBe(1);
    kitchen = killKitchenRusher(kitchen);
    expect(kitchen).toMatchObject({
      wave: 2,
      activeRushers: 2,
      queuedRushers: 0,
      defeatedRushers: 2,
      complete: false,
    });

    kitchen = killKitchenRusher(killKitchenRusher(kitchen));
    expect(kitchen).toMatchObject({
      activeRushers: 0,
      defeatedRushers: 4,
      complete: true,
    });
  });

  test('uses the shared enemy archetype for faster-than-sprint contact death', () => {
    const rusher = ENEMY_ARCHETYPES['knife-rusher'];
    const player = receiveEnemyContact(createPlayerVitality(), rusher);

    expect(rusher.movementSpeed).toBe(GAMEPLAY_TUNING.knifeRusherSpeed);
    expect(rusher.movementSpeed).toBeGreaterThan(GAMEPLAY_TUNING.sprintSpeed);
    expect(player).toEqual({ health: 0, dead: true });
  });

  test('slows knife movement proportionally with gameplay time', () => {
    const rusher = ENEMY_ARCHETYPES['knife-rusher'];
    const normal = moveEnemyTowardPlayer(
      [30, -14],
      [20, -14],
      rusher,
      1,
    );
    const slow = moveEnemyTowardPlayer(
      [30, -14],
      [20, -14],
      rusher,
      GAMEPLAY_TUNING.slowMotionScale,
    );

    expect(normal[0]).toBeCloseTo(30 - rusher.movementSpeed);
    expect(slow[0]).toBeCloseTo(
      30 - rusher.movementSpeed * GAMEPLAY_TUNING.slowMotionScale,
    );
  });

  test('slow motion leaves enough doorway distance to finish a full reload', () => {
    const rusher = ENEMY_ARCHETYPES['knife-rusher'];
    const slowedTravel =
      rusher.movementSpeed *
      scaledGameDelta(
        SHOTGUN_RELOAD_SECONDS,
        requestSlowMotion(createMobilityState()),
      );

    expect(slowedTravel).toBeLessThan(13.5 - 0.82);
  });

  test('blocks retreat into the alley once the kitchen encounter starts', () => {
    expect(clampKitchenRetreat(19)).toBe(22);
    expect(clampKitchenRetreat(27)).toBe(27);
  });

  test('death resets player, shotgun, and both kitchen waves', () => {
    let kitchen = createKitchenEncounter();
    kitchen = killKitchenRusher(killKitchenRusher(kitchen));
    const reset = resetKitchenEncounter();

    expect(reset.player).toEqual(createPlayerVitality());
    expect(reset.shotgun).toEqual(createShotgun());
    expect(reset.encounter).toEqual(createKitchenEncounter());
  });
});

describe('rain-alley single firing slot', () => {
  const peeker = ENEMY_ARCHETYPES['pistol-peeker'];
  const covered = (modeRemaining: number, health = 100): EnemyCombatant => ({
    health,
    ammo: peeker.magazineSize,
    mode: 'covered',
    modeRemaining,
    nextShotRemaining: 0,
  });
  const exposed = (health = 100): EnemyCombatant => ({
    health,
    ammo: peeker.magazineSize,
    mode: 'exposed',
    modeRemaining: peeker.exposedSeconds,
    nextShotRemaining: 0,
  });

  test('keeps a ready peeker behind cover while another holds the slot', () => {
    const result = tickEnemyCombatant(peeker, covered(0.01), {
      gameDelta: 0.02,
      distance: 6,
      lineOfSight: true,
      mayExpose: false,
    });
    expect(result.enemy.mode).toBe('covered');
    expect(result.enemy.modeRemaining).toBe(0);
    expect(result.shotsFired).toBe(0);
  });

  test('promotes that same peeker the moment the slot opens', () => {
    const result = tickEnemyCombatant(peeker, covered(0), {
      gameDelta: 0.02,
      distance: 6,
      lineOfSight: true,
      mayExpose: true,
    });
    expect(result.enemy.mode).toBe('exposed');
  });

  test('a peeker cannot shoot on the frame it pops out', () => {
    // Without the aim delay the next peeker's first shot lands on the same
    // frame the previous one ran dry, which reads as unbroken fire.
    const promoted = tickEnemyCombatant(peeker, covered(0), {
      gameDelta: 0.02,
      distance: 6,
      lineOfSight: true,
      mayExpose: true,
    });
    expect(promoted.shotsFired).toBe(0);
    expect(promoted.enemy.nextShotRemaining).toBe(peeker.shotInterval);
  });

  test('the holder keeps the slot until it leaves cover or dies', () => {
    const enemies = [exposed(), covered(0), covered(0)];
    expect(selectFiringSlot(0, enemies)).toBe(0);
    expect(selectFiringSlot(0, [covered(0), exposed(), covered(0)])).toBe(1);
    expect(selectFiringSlot(0, [exposed(0), covered(0), covered(0)])).toBe(1);
  });

  test('hands the slot to whoever is ready, and to nobody when none are', () => {
    expect(selectFiringSlot(null, [covered(0.5), covered(0), covered(0.9)])).toBe(1);
    expect(selectFiringSlot(null, [covered(0.5), covered(0.2)])).toBeNull();
    expect(selectFiringSlot(null, [exposed(0), covered(0.4)])).toBeNull();
  });

  test('leaves every other segment free to expose in parallel', () => {
    const smg = ENEMY_ARCHETYPES['tuxedo-smg'];
    const result = tickEnemyCombatant(
      smg,
      { ...covered(0), ammo: smg.magazineSize },
      { gameDelta: 0.02, distance: 8, lineOfSight: true },
    );
    expect(result.enemy.mode).toBe('exposed');
  });
});

describe('rain-alley respawn grace', () => {
  test('protects the player for the whole grace window and not one tick more', () => {
    const graceEndsAt = 10 + RESPAWN_GRACE_SECONDS;
    expect(isRespawnProtected(graceEndsAt, 10)).toBe(true);
    expect(isRespawnProtected(graceEndsAt, graceEndsAt - 0.01)).toBe(true);
    expect(isRespawnProtected(graceEndsAt, graceEndsAt)).toBe(false);
    expect(isRespawnProtected(graceEndsAt, graceEndsAt + 5)).toBe(false);
  });

  test('is long enough to outlast a peeker opening burst', () => {
    // A peeker empties three shots at 0.72s spacing; grace must cover the
    // reaction window, not the whole magazine.
    const peeker = ENEMY_ARCHETYPES['pistol-peeker'];
    expect(RESPAWN_GRACE_SECONDS).toBeGreaterThan(peeker.shotInterval * 2);
    expect(RESPAWN_GRACE_SECONDS).toBeLessThan(peeker.reloadSeconds);
  });
});

describe('rain-alley damage bearing', () => {
  const bearing = (
    sourceX: number,
    sourceZ: number,
    yaw: number,
    // `|| 0` folds -0 into 0 so the assertions read as plain angles.
  ): number => Math.round(bearingFromPlayer(sourceX, sourceZ, 0, 0, yaw)) || 0;

  test('reads 0 straight ahead and flips sign left versus right', () => {
    // Facing yaw 0 means looking down -Z.
    expect(bearing(0, -5, 0)).toBe(0);
    expect(bearing(5, 0, 0)).toBe(90);
    expect(bearing(-5, 0, 0)).toBe(-90);
    expect(Math.abs(bearing(0, 5, 0))).toBe(180);
  });

  test('rotates with the player so the arc tracks the camera', () => {
    // Yaw pi/2 faces -X, so the source that was dead ahead is now on the right
    // and the one that was on the right is now behind.
    expect(bearing(0, -5, Math.PI / 2)).toBe(90);
    expect(Math.abs(bearing(5, 0, Math.PI / 2))).toBe(180);
    expect(bearing(-5, 0, Math.PI / 2)).toBe(0);
  });

  test('collapses to straight ahead when the source is on the player', () => {
    expect(bearing(0, 0, 1.2)).toBe(0);
  });
});

describe('rain-alley mobility rules', () => {
  test('sprint lasts 1.5 game seconds, then enters cooldown', () => {
    const sprinting = requestSprint(createMobilityState());
    expect(sprinting.sprintRemaining).toBe(GAMEPLAY_TUNING.sprintDuration);
    expect(getPlayerMoveSpeed(sprinting)).toBe(GAMEPLAY_TUNING.sprintSpeed);

    const finished = advanceMobility(
      sprinting,
      GAMEPLAY_TUNING.sprintDuration,
    );
    expect(finished.sprintRemaining).toBe(0);
    expect(finished.sprintCooldownRemaining).toBe(
      GAMEPLAY_TUNING.sprintCooldown,
    );
    expect(getPlayerMoveSpeed(finished)).toBe(GAMEPLAY_TUNING.walkSpeed);
    expect(requestSprint(finished)).toEqual(finished);
  });

  test('sprint remains slower than the future knife rusher', () => {
    expect(GAMEPLAY_TUNING.sprintSpeed).toBeLessThan(
      GAMEPLAY_TUNING.knifeRusherSpeed,
    );
  });

  test('Space only steps grounded players onto 30-40 cm curbs', () => {
    expect(attemptLowStep({ grounded: true, obstacleHeight: 0.35, enemyAhead: false }))
      .toEqual({ accepted: true, snapHeight: 0.35 });
    expect(attemptLowStep({ grounded: false, obstacleHeight: 0.35, enemyAhead: false }).accepted)
      .toBe(false);
    expect(attemptLowStep({ grounded: true, obstacleHeight: 0.5, enemyAhead: false }).accepted)
      .toBe(false);
    expect(attemptLowStep({ grounded: true, obstacleHeight: 0.35, enemyAhead: true }).accepted)
      .toBe(false);
  });

  test('slow motion lasts 1.5 real seconds while its rule advances in game time', () => {
    const active = requestSlowMotion(createMobilityState());
    expect(active.slowMotionRemaining).toBe(
      GAMEPLAY_TUNING.slowMotionDuration,
    );

    const cooling = advanceMobility(
      active,
      scaledGameDelta(1.5, active),
    );
    expect(cooling.slowMotionRemaining).toBe(0);
    expect(cooling.slowMotionCooldownRemaining).toBe(
      GAMEPLAY_TUNING.slowMotionCooldown,
    );
    expect(requestSlowMotion(cooling)).toEqual(cooling);
  });

  test('slow motion can be used again after every cooldown', () => {
    const first = requestSlowMotion(createMobilityState());
    const cooling = advanceMobility(
      first,
      GAMEPLAY_TUNING.slowMotionDuration,
    );
    const ready = advanceMobility(
      cooling,
      GAMEPLAY_TUNING.slowMotionCooldown,
    );
    const second = requestSlowMotion(ready);

    expect(second.slowMotionRemaining).toBe(
      GAMEPLAY_TUNING.slowMotionDuration,
    );
  });

  test('shows every ability countdown in real seconds without changing gameplay state', () => {
    const gameplayState = {
      sprintRemaining: 1.5,
      sprintCooldownRemaining: 0,
      slowMotionRemaining: 0.75,
      slowMotionCooldownRemaining: 0,
    };

    expect(getMobilityHudCountdowns(gameplayState)).toEqual({
      sprintRemaining: 3,
      sprintCooldownRemaining: 0,
      slowMotionRemaining: 1.5,
      slowMotionCooldownRemaining: 0,
    });
    expect(gameplayState).toEqual({
      sprintRemaining: 1.5,
      sprintCooldownRemaining: 0,
      slowMotionRemaining: 0.75,
      slowMotionCooldownRemaining: 0,
    });

    expect(
      getMobilityHudCountdowns({
        sprintRemaining: 0,
        sprintCooldownRemaining: 2.5,
        slowMotionRemaining: 0,
        slowMotionCooldownRemaining: 8,
      }),
    ).toMatchObject({
      sprintCooldownRemaining: 2.5,
      slowMotionCooldownRemaining: 8,
    });
  });
});

describe('rain-alley slice FSM', () => {
  test('follows the complete slice order without allowing skips', () => {
    let state = createSliceState();
    expect(state.phase).toBe('intro-flashback');

    state = applySliceEvent(state, { type: 'enter-door' });
    expect(state.phase).toBe('intro-flashback');

    state = applySliceEvent(state, { type: 'flashback-finished' });
    expect(state.phase).toBe('alley');

    for (let i = 0; i < SEGMENT_KILL_TARGETS.alley; i += 1) {
      state = applySliceEvent(state, { type: 'enemy-killed' });
    }
    expect(state.doorUnlocked).toBe(true);
    state = applySliceEvent(state, { type: 'enter-door' });
    expect(state.phase).toBe('kitchen');

    for (let i = 0; i < SEGMENT_KILL_TARGETS.kitchen; i += 1) {
      state = applySliceEvent(state, { type: 'enemy-killed' });
    }
    state = applySliceEvent(state, { type: 'enter-door' });
    expect(state.phase).toBe('hall');

    for (let i = 0; i < SEGMENT_KILL_TARGETS.hall; i += 1) {
      state = applySliceEvent(state, { type: 'enemy-killed' });
    }
    expect(state.phase).toBe('hall');
    state = applySliceEvent(state, { type: 'enter-door' });
    expect(state.phase).toBe('coat-standoff');

    for (let i = 0; i < SEGMENT_KILL_TARGETS['coat-standoff']; i += 1) {
      state = applySliceEvent(state, { type: 'enemy-killed' });
    }
    expect(state.phase).toBe('victory-flashback');
  });

  test('keeps a door locked until the exact segment kill target is met', () => {
    let state = applySliceEvent(createSliceState(), {
      type: 'flashback-finished',
    });
    for (let i = 1; i < SEGMENT_KILL_TARGETS.alley; i += 1) {
      state = applySliceEvent(state, { type: 'enemy-killed' });
    }

    expect(state).toMatchObject({
      phase: 'alley',
      kills: SEGMENT_KILL_TARGETS.alley - 1,
      doorUnlocked: false,
    });
    expect(applySliceEvent(state, { type: 'enter-door' })).toEqual(state);

    state = applySliceEvent(state, { type: 'enemy-killed' });
    expect(state.doorUnlocked).toBe(true);
  });

  test('death restarts only the current segment', () => {
    let kitchen = applySliceEvent(createSliceState(), {
      type: 'flashback-finished',
    });
    for (let i = 0; i < SEGMENT_KILL_TARGETS.alley; i += 1) {
      kitchen = applySliceEvent(kitchen, { type: 'enemy-killed' });
    }
    kitchen = applySliceEvent(kitchen, { type: 'enter-door' });
    kitchen = applySliceEvent(kitchen, { type: 'enemy-killed' });

    expect(applySliceEvent(kitchen, { type: 'player-died' })).toMatchObject({
      phase: 'kitchen',
      kills: 0,
      doorUnlocked: false,
      restartCount: 1,
    });
  });

  test('coat death restarts the standoff and never returns to hall', () => {
    const coat = {
      phase: 'coat-standoff',
      kills: 0,
      doorUnlocked: false,
      restartCount: 0,
    } as const;

    expect(applySliceEvent(coat, { type: 'player-died' })).toMatchObject({
      phase: 'coat-standoff',
      kills: 0,
      restartCount: 1,
    });
  });

  test('entering the hall far doors starts the coat standoff in place', () => {
    const hall = {
      phase: 'hall',
      kills: SEGMENT_KILL_TARGETS.hall,
      doorUnlocked: true,
      restartCount: 0,
    } as const;
    const coat = applySliceEvent(hall, { type: 'enter-door' });

    expect(coat.phase).toBe('coat-standoff');
    expect(phaseTransitionPlacement(hall.phase, coat.phase)).toBe(
      'preserve-player',
    );
    expect(phaseTransitionPlacement('kitchen', 'hall')).toBe('phase-start');
  });

  test('the sixth hall kill only unlocks the far door', () => {
    let hall = {
      phase: 'hall',
      kills: SEGMENT_KILL_TARGETS.hall - 1,
      doorUnlocked: false,
      restartCount: 0,
    } as const;

    hall = applySliceEvent(hall, { type: 'enemy-killed' });
    expect(hall).toMatchObject({
      phase: 'hall',
      kills: SEGMENT_KILL_TARGETS.hall,
      doorUnlocked: true,
    });
    expect(applySliceEvent(hall, { type: 'enter-door' }).phase).toBe(
      'coat-standoff',
    );
  });

  test('exports target duration as configuration, not measured sign-off', () => {
    expect(SLICE_TARGET_DURATION_MINUTES).toEqual({ min: 8, max: 12 });
  });
});
