/**
 * 3D Space Shooter (飞机大战) — ForgeAX Engine
 *
 * Controls: WASD/Arrows = 移动, Space = 射击, R = 重新开始
 * // 让每一次飞行都像冒险一样精彩~ ♪
 */
import {
  Transform, Camera, perspective, DirectionalLight, Skylight, quat,
  MeshFilter, MeshRenderer,
} from '@forgeax/engine-runtime';
import { Entity, type EntityHandle } from '@forgeax/engine-ecs';
import type { World } from '@forgeax/engine-ecs';
import type { BootstrapContext } from '@forgeax/engine-app';

import { registerMaterials, registerGeometry, type Geo, type Mat } from './setup';
import { Player, Thruster, spawnPlayer, type PlayerShip } from './player';
import { Enemy, loadEnemyScenes, spawnFighter, spawnBomber, spawnInterceptor, spawnDreadnought, spawnScout, spawnCarrier, spawnAssassin, spawnSpiral, type EnemySpawnResult, type EnemyScenes } from './enemies';
import { Particle, Trail, Bullet, spawnExplosion, spawnTrail, spawnBullet, spawnHomingMissile, spawnSpreadBullet, spawnLaserShot, spawnPlasma } from './effects';
import { Star, spawnBackground } from './background';
import { PowerUp, Obstacle, spawnPowerUp, spawnObstacle, shouldDropPowerUp, getPowerUpType } from './powerups';
import { createStoryUi, STORY_BEATS, VICTORY_SCORE, type StoryBeat } from './story';

// ─── Constants ───────────────────────────────────────────────────────────

const ARENA_W = 26;
const ARENA_H = 26;
const PLAYER_SPEED = 13;
const SHOOT_CD = 0.11;
const HIT_R = 0.9;
const BUL_R = 0.35;
const BANK_ANGLE = 0.35;
const BANK_SMOOTH = 8;
const MAX_HP = 3;
const COMBO_WINDOW = 1.2;
const VISIBLE_TOP_Z = -8;          // 屏幕上沿：z < 此值的敌人不受子弹伤害
const PLAYER_BULLET_KILL_Z = -9;   // 玩家子弹越过此线就消失
const BOSS_TRIGGER_SCORE = 22000;  // 到达此分数召唤 boss
const BOSS_HIT_R = 2.0;            // boss 较大的击中半径
const BOSS_HOVER_Z = -3.5;         // boss 悬停 Z 位置
const BOSS_MAX_HP = 200;           // boss 总 HP

// ─── Entry ───────────────────────────────────────────────────────────────

export async function bootstrap(world: World, ctx?: BootstrapContext) {
  const { assets } = ctx ?? {};
  // Play/Stop hygiene: mount UI into the host's controlled container (removed
  // whole on ■ Stop) instead of document.body, and register non-DOM teardown
  // (key listeners) so an embedded-editor Stop returns to a clean initial state.
  const uiMount: HTMLElement = ctx?.uiRoot ?? (typeof document !== 'undefined' ? document.body : (undefined as never));
  const onCleanup = ctx?.registerCleanup ?? (() => {});

  // Components self-register globally via defineComponent (feat-20260602); the
  // old per-world world.registerComponent(...) API was removed. Referencing the
  // tokens here keeps the imports live and documents the component set in use.
  void [Player, Thruster, Enemy, Bullet, Particle, Trail, Star, PowerUp, Obstacle];

  const mat = await registerMaterials(assets, world);
  const geo = registerGeometry(assets, world);
  const enemyScenes: EnemyScenes = await loadEnemyScenes(assets, world);

  // ═══════════════════════════════════════════════════════════════════════
  //  LIGHTING
  // ═══════════════════════════════════════════════════════════════════════

  // Engine first-slice cap: at most 1 DirectionalLight (todo-125 multi-light-pack
  // unlocks N>1). Fill+rim of the original 3-point rig dropped until then.
  // Shadow config merged into DirectionalLight (engine #479 feat-20260621):
  // castShadow defaults true, so the 9 shadow fields live on the same component.
  world.spawn(
    { component: DirectionalLight, data: {
      directionX: 0.15, directionY: -0.85, directionZ: -0.35,
      colorR: 0.92, colorG: 0.94, colorB: 1.0, intensity: 2.2,
      cascadeCount: 3, mapSize: 2048, farPlane: 60, nearPlane: 0.1,
    }},
  );

  // Ambient: the forgeax PBR shader computes ambient=0 without a Skylight, so a
  // lone DirectionalLight leaves shaded faces black ("天光没了") — especially on
  // WebKit/WKWebView (the desktop app), which can't run the IBL precompute. A
  // cubemap-less Skylight binds the engine's 1×1 white irradiance cube → flat
  // ambient live on the first frame, no async GPU work, renders everywhere.
  world.spawn({ component: Skylight, data: { colorR: 0.78, colorG: 0.85, colorB: 1.0, intensity: 0.4 } });

  // ═══════════════════════════════════════════════════════════════════════
  //  CAMERA — top-down with 180° roll (proven working setup)
  //  Result: player (+Z) at screen bottom, enemies (-Z) from screen top
  // ═══════════════════════════════════════════════════════════════════════

  const qDown = quat.create();
  quat.fromAxisAngle(qDown, [1, 0, 0], -Math.PI / 2); // look down
  const qRoll = quat.create();
  quat.fromAxisAngle(qRoll, [0, 0, 1], Math.PI); // 180° roll
  const camQ = quat.create();
  quat.multiply(camQ, qDown, qRoll); // pitch then roll
  world.spawn(
    { component: Transform, data: { posX: 0, posY: 18, posZ: 2, quatX: camQ[0], quatY: camQ[1], quatZ: camQ[2], quatW: camQ[3] } },
    // clearR/G/B = visible sky on WebKit (the desktop app can't render a
    // cubemap skybox; without this the background is black). Deep space-blue.
    { component: Camera, data: { ...perspective({ fov: 62, aspect: 16 / 9 }), clearR: 0.04, clearG: 0.06, clearB: 0.16 } },
  );

  spawnBackground(world, geo, mat);

  // ═══════════════════════════════════════════════════════════════════════
  //  GAME STATE
  // ═══════════════════════════════════════════════════════════════════════

  let player: PlayerShip | null = null;
  let currentBank = 0;
  const bullets: EntityHandle[] = [];
  const enemies: EntityHandle[] = [];
  // Each enemy is a scene instance: container (carrying Enemy) -> synthetic
  // root (carrying SceneInstance). Map the container to its synth so
  // `world.despawnScene(synth)` tears down root + container + body parts in
  // one call. Movement of parts is automatic via propagateTransforms.
  const enemyInstances: Map<Entity, Entity> = new Map();
  const particles: EntityHandle[] = [];
  const trails: EntityHandle[] = [];
  const powerups: EntityHandle[] = [];
  const obstacles: EntityHandle[] = [];
  const obstacleParts: Map<EntityHandle, EntityHandle[]> = new Map();

  // ── BOSS 状态 ──
  let bossEntity: EntityHandle | null = null;
  let bossInstanceId: EntityHandle | null = null;

  // Weapon types: 0=Normal 1=Homing 2=Spread 3=Laser 4=Plasma
  const WEAPON_NAMES = ['⚡ Normal', '🎯 Homing', '🌸 Spread', '⚡ Laser', '🔮 Plasma'];
  const WEAPON_CDS = [0.11, 0.35, 0.18, 0.06, 0.55]; // fire cooldowns per weapon

  const gs = {
    score: 0, alive: true, shootCd: 0,
    spawnTimer: 0, spawnInterval: 1.1,
    difficulty: 0, time: 0, trailTimer: 0,
    obstacleTimer: 0,
    hp: MAX_HP, hasShield: false, shieldTimer: 0,
    tripleShot: false, tripleTimer: 0,
    comboCount: 0, comboTimer: 0, comboMultiplier: 1,
    invulnTimer: 0,
    started: false, victory: false,
    bossSpawned: false, bossDescending: false, bossShootTimer: 0,
    weapon: 0, // current weapon index (0-4)
    keys: new Set<string>(),
  };

  // 剧情节奏：从只读模板克隆出可变副本（保留 fired 状态）
  const beats: StoryBeat[] = STORY_BEATS.map(b => ({ ...b, fired: false }));

  function resetPlayer() {
    player = spawnPlayer(world, geo, mat, 9); // +Z = bottom of screen
    currentBank = 0;
  }
  resetPlayer();

  // ═══════════════════════════════════════════════════════════════════════
  //  HUD
  // ═══════════════════════════════════════════════════════════════════════

  const onKeyDown = (e: KeyboardEvent) => gs.keys.add(e.code);
  const onKeyUp = (e: KeyboardEvent) => gs.keys.delete(e.code);
  globalThis.addEventListener('keydown', onKeyDown);
  globalThis.addEventListener('keyup', onKeyUp);
  onCleanup(() => {
    globalThis.removeEventListener('keydown', onKeyDown);
    globalThis.removeEventListener('keyup', onKeyUp);
  });

  let hud: HTMLDivElement | null = null;
  let hudCombo: HTMLDivElement | null = null;
  let hudHP: HTMLDivElement | null = null;
  let hudPower: HTMLDivElement | null = null;
  let hudBoss: HTMLDivElement | null = null;
  let hudBossFill: HTMLDivElement | null = null;

  // 剧情 UI（开场 / Wave 横幅 / 通关结局）
  const storyUi = createStoryUi(uiMount);
  storyUi.showIntro();

  if (typeof document !== 'undefined') {
    hud = document.createElement('div');
    hud.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);font-family:"Orbitron","Courier New",monospace;font-size:22px;color:#0ff;text-shadow:0 0 8px #0ff,0 0 20px #06f;pointer-events:none;z-index:9999;text-align:center;background:linear-gradient(180deg,rgba(0,10,30,0.6),rgba(0,5,15,0.4));padding:8px 24px;border-radius:10px;border:1px solid rgba(0,200,255,0.4);backdrop-filter:blur(4px)';
    uiMount.appendChild(hud);

    hudHP = document.createElement('div');
    hudHP.style.cssText = 'position:fixed;top:12px;left:16px;font-size:20px;pointer-events:none;z-index:9999;text-shadow:0 0 6px #f55';
    uiMount.appendChild(hudHP);

    hudCombo = document.createElement('div');
    hudCombo.style.cssText = 'position:fixed;top:54px;left:50%;transform:translateX(-50%);font-family:"Orbitron","Courier New",monospace;font-size:16px;color:#ff0;text-shadow:0 0 6px #ff0;pointer-events:none;z-index:9999;opacity:0;transition:opacity 0.3s';
    uiMount.appendChild(hudCombo);

    hudPower = document.createElement('div');
    hudPower.style.cssText = 'position:fixed;top:12px;right:16px;font-size:18px;pointer-events:none;z-index:9999;text-shadow:0 0 6px #0ff';
    uiMount.appendChild(hudPower);

    // BOSS HP 条（默认隐藏）
    hudBoss = document.createElement('div');
    hudBoss.style.cssText = 'position:fixed;top:88px;left:50%;transform:translateX(-50%);width:min(560px,80vw);height:18px;background:rgba(0,0,15,0.7);border:2px solid #c46bff;border-radius:9px;box-shadow:0 0 16px #c46bff,inset 0 0 8px #320a4a;pointer-events:none;z-index:9999;display:none;overflow:hidden;font-family:"Orbitron","Courier New",monospace;';
    hudBossFill = document.createElement('div');
    hudBossFill.style.cssText = 'position:absolute;top:0;left:0;height:100%;width:100%;background:linear-gradient(90deg,#ff3388,#c46bff,#9cffb1);box-shadow:0 0 12px currentColor;transition:width 0.18s ease-out;';
    hudBoss.appendChild(hudBossFill);
    const hudBossLabel = document.createElement('div');
    hudBossLabel.textContent = '黑日母舰 · BLACK SUN';
    hudBossLabel.style.cssText = 'position:absolute;top:-22px;left:50%;transform:translateX(-50%);color:#ff3388;font-size:14px;letter-spacing:6px;text-shadow:0 0 8px #ff3388;font-weight:bold;white-space:nowrap;';
    hudBoss.appendChild(hudBossLabel);
    uiMount.appendChild(hudBoss);
  }

  function updateHud() {
    if (hud) hud.textContent = `⚡ SCORE: ${gs.score}`;
    if (hudHP) hudHP.textContent = '❤️'.repeat(gs.hp) + '🖤'.repeat(MAX_HP - gs.hp) + (gs.hasShield ? ' 🛡️' : '');
    if (hudCombo) {
      if (gs.comboCount > 1) { hudCombo.textContent = `🔥 COMBO ×${gs.comboMultiplier} (${gs.comboCount} hits)`; hudCombo.style.opacity = '1'; }
      else { hudCombo.style.opacity = '0'; }
    }
    if (hudPower) {
      const parts: string[] = [];
      parts.push(WEAPON_NAMES[gs.weapon]!);
      if (gs.tripleShot) parts.push(`🔫 ${gs.tripleTimer.toFixed(1)}s`);
      if (gs.hasShield) parts.push('🛡️');
      hudPower.textContent = parts.join('  ');
    }
  }

  function updateBossHud() {
    if (!hudBoss || !hudBossFill) return;
    if (bossEntity != null) {
      const er = world.get(bossEntity, Enemy);
      if (er.ok) {
        const pct = Math.max(0, er.value.hp / er.value.maxHp);
        hudBossFill.style.width = (pct * 100).toFixed(1) + '%';
        hudBoss.style.display = 'block';
        return;
      }
    }
    hudBoss.style.display = 'none';
  }
  updateHud();

  function setHud(t: string, c = '#0ff', s = '0 0 8px #0ff,0 0 20px #06f') {
    if (hud) { hud.textContent = t; hud.style.color = c; hud.style.textShadow = s; }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  ECS SYSTEMS
  // ═══════════════════════════════════════════════════════════════════════

  // Background scrolls in +Z direction (toward player = bottom of screen)
  world.addSystem({ name: 'star-scroll', queries: [{ with: [Entity, Transform, Star] }], fn: (_w, qr) => {
    const dt = world.getResource<{dt:number}>('Time').dt;
    for (const b of qr[0]) for (let i = 0; i < b.Entity.self.length; i++) {
      b.Transform.posZ[i]! += b.Star.speed[i]! * dt;
      if (b.Transform.posZ[i]! > ARENA_H / 2 + 8) {
        b.Transform.posZ[i] = -ARENA_H / 2 - 8;
        b.Transform.posX[i] = (Math.random() - 0.5) * ARENA_W * 2;
      }
    }
  }});

  world.addSystem({ name: 'particle-tick', queries: [{ with: [Entity, Transform, Particle] }], fn: (_w, qr) => {
    const dt = world.getResource<{dt:number}>('Time').dt;
    for (const b of qr[0]) for (let i = 0; i < b.Entity.self.length; i++) {
      b.Transform.posX[i]! += b.Particle.velX[i]! * dt;
      b.Transform.posY[i]! += b.Particle.velY[i]! * dt;
      b.Transform.posZ[i]! += b.Particle.velZ[i]! * dt;
      b.Particle.velY[i]! -= 6 * dt;
      b.Particle.life[i]! -= dt;
      const r = Math.max(0, b.Particle.life[i]! / b.Particle.maxLife[i]!) * 0.6;
      b.Transform.scaleX[i] = r; b.Transform.scaleY[i] = r; b.Transform.scaleZ[i] = r;
    }
  }});

  world.addSystem({ name: 'thruster-pulse', queries: [{ with: [Entity, Transform, Thruster] }], fn: (_w, qr) => {
    const dt = world.getResource<{dt:number}>('Time').dt;
    for (const b of qr[0]) for (let i = 0; i < b.Entity.self.length; i++) {
      b.Thruster.phase[i]! += dt * 14;
      const p = 0.85 + 0.15 * Math.sin(b.Thruster.phase[i]!);
      b.Transform.scaleX[i]! *= p; b.Transform.scaleZ[i]! *= p;
    }
  }});

  world.addSystem({ name: 'trail-fade', queries: [{ with: [Entity, Transform, Trail] }], fn: (_w, qr) => {
    const dt = world.getResource<{dt:number}>('Time').dt;
    for (const b of qr[0]) for (let i = 0; i < b.Entity.self.length; i++) {
      b.Trail.life[i]! -= dt;
      const r = Math.max(0, b.Trail.life[i]! / 0.35) * 0.12;
      b.Transform.scaleX[i] = r; b.Transform.scaleY[i] = r; b.Transform.scaleZ[i] = r;
      b.Transform.posZ[i]! += 2 * dt; // trails drift toward +Z (behind player visually)
    }
  }});

  world.addSystem({ name: 'powerup-bob', queries: [{ with: [Entity, Transform, PowerUp] }], fn: (_w, qr) => {
    const dt = world.getResource<{dt:number}>('Time').dt;
    for (const b of qr[0]) for (let i = 0; i < b.Entity.self.length; i++) {
      b.PowerUp.bobPhase[i]! += dt * 5;
      b.Transform.posY[i] = 0.3 + Math.sin(b.PowerUp.bobPhase[i]!) * 0.15;
      b.Transform.posZ[i]! += b.PowerUp.speed[i]! * dt; // drift toward player (+Z)
      const pulse = 0.45 + 0.08 * Math.sin(b.PowerUp.bobPhase[i]! * 1.5);
      b.Transform.scaleX[i] = pulse; b.Transform.scaleY[i] = pulse; b.Transform.scaleZ[i] = pulse;
    }
  }});

  // ═══════════════════════════════════════════════════════════════════════
  //  ENEMY SPAWNER
  // ═══════════════════════════════════════════════════════════════════════

  const spawnCtx = { world, assets, scenes: enemyScenes };

  function spawnEnemyWave() {
    if (bossEntity != null) return; // BOSS 期间不刷小怪
    const x = (Math.random() - 0.5) * ARENA_W;
    const z = -ARENA_H / 2 - 2;
    const roll = Math.random();
    let result: EnemySpawnResult;

    if (gs.difficulty > 5 && roll < 0.04) {
      // Carrier (very rare, late game)
      result = spawnCarrier(spawnCtx, x * 0.5, z, gs.difficulty);
    } else if (gs.difficulty > 4 && roll < 0.09) {
      // Dreadnought
      result = spawnDreadnought(spawnCtx, x * 0.7, z, gs.difficulty);
    } else if (gs.difficulty > 3 && roll < 0.15) {
      // Spiral (circles around)
      result = spawnSpiral(spawnCtx, x, z, gs.difficulty);
    } else if (gs.difficulty > 2 && roll < 0.22) {
      // Assassin (teleports sideways)
      result = spawnAssassin(spawnCtx, x, z, gs.difficulty);
    } else if (gs.difficulty > 1 && roll < 0.32) {
      // Interceptor (fast, sine-wave)
      result = spawnInterceptor(spawnCtx, x, z, gs.difficulty);
    } else if (roll < 0.44) {
      // Scout — spawn in V-formation (2-3 together)
      const count = 2 + (gs.difficulty > 2 ? 1 : 0);
      for (let i = 0; i < count; i++) {
        const fx = x + (i - (count - 1) / 2) * 2.5;
        const fz = z - i * 1.2;
        const r = spawnScout(spawnCtx, fx, fz, gs.difficulty);
        enemies.push(r.entity); enemyInstances.set(r.entity, r.instanceId);
      }
      return; // already pushed all
    } else if (roll < 0.6) {
      // Bomber
      result = spawnBomber(spawnCtx, x, z, gs.difficulty);
    } else {
      // Fighter (most common)
      result = spawnFighter(spawnCtx, x, z, gs.difficulty);
    }

    enemies.push(result.entity);
    enemyInstances.set(result.entity, result.instanceId);
  }

  // ──────────────────────────────────────────────────────────────────────────
  //  BOSS — 黑日母舰·BLACK SUN
  // ──────────────────────────────────────────────────────────────────────────

  function spawnBoss() {
    // 以 carrier 外形作为 boss 机体，后面覆写 hp/maxHp/speed。入存点在屏幕上沿之上
    const result: EnemySpawnResult = spawnCarrier(spawnCtx, 0, -ARENA_H / 2 - 1, 6);
    bossEntity = result.entity;
    bossInstanceId = result.instanceId;
    enemies.push(bossEntity);
    enemyInstances.set(bossEntity, result.instanceId);
    // 覆写为 boss 参数：缓降、kind=6、高 HP
    const er = world.get(bossEntity, Enemy);
    if (er.ok) {
      world.set(bossEntity, Enemy, {
        ...er.value, speed: 1.4, kind: 6,
        hp: BOSS_MAX_HP, maxHp: BOSS_MAX_HP, hitFlash: 0,
        shootTimer: 1.6,
      });
    }
    gs.bossDescending = true;
    gs.bossShootTimer = 1.6;
    // 清场现有小怪，让 boss 单独上场
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i]!;
      if (e === bossEntity) continue;
      const tr = world.get(e, Transform);
      if (tr.ok) spawnExplosion(world, geo, mat, tr.value.posX, tr.value.posZ, 8, particles);
      despawnEnemy(e);
      enemies.splice(i, 1);
    }
    updateBossHud();
  }

  function bossUpdate(dt: number) {
    if (bossEntity == null) return;
    const tr = world.get(bossEntity, Transform);
    const er = world.get(bossEntity, Enemy);
    if (!tr.ok || !er.ok) return;

    // 阶段下降→悬停
    if (gs.bossDescending) {
      const newZ = tr.value.posZ + 1.4 * dt;
      world.set(bossEntity, Transform, { ...tr.value, posZ: newZ });
      if (newZ >= BOSS_HOVER_Z) {
        gs.bossDescending = false;
        world.set(bossEntity, Enemy, { ...er.value, speed: 0 });
      }
      // 下降阶段不让主环节的 enemy-move 重复推进（在外部逻辑处理）
    }

    // 击中闪烁衰减
    if (er.value.hitFlash > 0) {
      world.set(bossEntity, Enemy, { ...er.value, hitFlash: Math.max(0, er.value.hitFlash - dt * 3) });
    }

    // 如果还在下降，不开火
    if (gs.bossDescending) return;

    // 三阶段攻击模式
    const pct = er.value.hp / er.value.maxHp;
    gs.bossShootTimer -= dt;
    if (gs.bossShootTimer <= 0) {
      const bx = tr.value.posX, bz = tr.value.posZ + 1.5;
      if (pct > 0.66) {
        // Phase 1：父模块 — 双炮齐射
        spawnBullet(world, geo, mat, bx - 1.2, bz, 1, true, bullets, 0);
        spawnBullet(world, geo, mat, bx + 1.2, bz, 1, true, bullets, 0);
        gs.bossShootTimer = 0.7;
      } else if (pct > 0.33) {
        // Phase 2：三道扣弩扣 + 侧翼炮
        spawnBullet(world, geo, mat, bx, bz, 1, true, bullets, 0);
        spawnBullet(world, geo, mat, bx, bz, 1, true, bullets, -0.35);
        spawnBullet(world, geo, mat, bx, bz, 1, true, bullets, 0.35);
        spawnBullet(world, geo, mat, bx - 2.4, bz - 0.3, 1, true, bullets, -0.15);
        spawnBullet(world, geo, mat, bx + 2.4, bz - 0.3, 1, true, bullets, 0.15);
        gs.bossShootTimer = 0.55;
      } else {
        // Phase 3：狂暴暮色 — 五方向扣弩
        for (let k = -2; k <= 2; k++) {
          spawnBullet(world, geo, mat, bx, bz, 1, true, bullets, k * 0.28);
        }
        spawnBullet(world, geo, mat, bx - 2.4, bz - 0.3, 1, true, bullets, -0.4);
        spawnBullet(world, geo, mat, bx + 2.4, bz - 0.3, 1, true, bullets, 0.4);
        gs.bossShootTimer = 0.45;
      }
    }
  }

  function onBossDeath() {
    if (bossEntity == null) return;
    const tr = world.get(bossEntity, Transform);
    if (tr.ok) {
      // 崩裂三连爆
      spawnExplosion(world, geo, mat, tr.value.posX, tr.value.posZ, 30, particles);
      spawnExplosion(world, geo, mat, tr.value.posX - 1.5, tr.value.posZ - 0.5, 18, particles);
      spawnExplosion(world, geo, mat, tr.value.posX + 1.5, tr.value.posZ + 0.5, 18, particles);
    }
    despawnEnemy(bossEntity);
    const idx = enemies.indexOf(bossEntity);
    if (idx >= 0) enemies.splice(idx, 1);
    bossEntity = null;
    bossInstanceId = null;
    gs.bossDescending = false;
    updateBossHud();
    // 进入通关结局
    if (!gs.victory) { gs.victory = true; triggerVictory(); }
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  MAIN GAME LOOP
  // ═══════════════════════════════════════════════════════════════════════

  ctx.registerUpdate((dt: number) => {
    gs.time += dt;
    storyUi.tick(dt);

    // ── 开场门禁：等玩家按空格 ──
    if (!gs.started) {
      if (gs.keys.has('Space')) {
        gs.started = true;
        storyUi.hideIntro();
      }
      return;
    }

    if (!gs.alive) {
      if (gs.keys.has('KeyR')) {
        gs.score = 0; gs.alive = true; gs.difficulty = 0;
        gs.spawnInterval = 1.1; gs.shootCd = 0; gs.spawnTimer = 0;
        gs.hp = MAX_HP; gs.hasShield = false; gs.shieldTimer = 0;
        gs.tripleShot = false; gs.tripleTimer = 0;
        gs.comboCount = 0; gs.comboTimer = 0; gs.comboMultiplier = 1;
        gs.invulnTimer = 0; gs.obstacleTimer = 0;
        // 复位 BOSS 状态
        if (bossEntity != null) { despawnEnemy(bossEntity); const ix = enemies.indexOf(bossEntity); if (ix >= 0) enemies.splice(ix, 1); bossEntity = null; bossInstanceId = null; }
        gs.bossSpawned = false; gs.bossDescending = false;
        updateBossHud();
        if (hud) hud.style.opacity = '1';
        // 复位剧情：通关后再来一局也走一遍 wave 节奏
        if (gs.victory) { gs.victory = false; storyUi.hideEnding(); }
        for (const b of beats) b.fired = false;
        resetPlayer(); updateHud();
      }
      return;
    }
    if (!player) return;
    const pr = world.get(player.entity, Transform);
    if (!pr.ok) return;
    const pv = pr.value;

    // Timers
    gs.invulnTimer = Math.max(0, gs.invulnTimer - dt);
    gs.comboTimer -= dt;
    if (gs.comboTimer <= 0 && gs.comboCount > 0) { gs.comboCount = 0; gs.comboMultiplier = 1; updateHud(); }
    if (gs.tripleShot) { gs.tripleTimer -= dt; if (gs.tripleTimer <= 0) { gs.tripleShot = false; updateHud(); } }
    if (gs.hasShield) { gs.shieldTimer -= dt; if (gs.shieldTimer <= 0) { gs.hasShield = false; updateHud(); } }

    // ── Player Movement ──
    let mx = 0, mz = 0;
    if (gs.keys.has('KeyA') || gs.keys.has('ArrowLeft'))  mx -= 1;
    if (gs.keys.has('KeyD') || gs.keys.has('ArrowRight')) mx += 1;
    if (gs.keys.has('KeyW') || gs.keys.has('ArrowUp'))    mz -= 1; // W = up on screen = -Z
    if (gs.keys.has('KeyS') || gs.keys.has('ArrowDown'))  mz += 1; // S = down on screen = +Z
    const mLen = Math.hypot(mx, mz) || 1;
    const nx = Math.max(-ARENA_W / 2, Math.min(ARENA_W / 2, pv.posX + (mx / mLen) * PLAYER_SPEED * dt));
    const nz = Math.max(-4, Math.min(ARENA_H / 2 - 1, pv.posZ + (mz / mLen) * PLAYER_SPEED * dt));

    // Banking
    const targetBank = -mx * BANK_ANGLE;
    currentBank += (targetBank - currentBank) * Math.min(1, BANK_SMOOTH * dt);
    const qPitch = quat.create(); quat.fromAxisAngle(qPitch, [1, 0, 0], Math.PI / 2);
    const qBR = quat.create(); quat.fromAxisAngle(qBR, [0, 0, 1], currentBank);
    const qF = quat.create(); quat.multiply(qF, qBR, qPitch);
    world.set(player.entity, Transform, { ...pv, posX: nx, posZ: nz, quatX: qF[0], quatY: qF[1], quatZ: qF[2], quatW: qF[3] });

    for (const [ent, ox, , oz] of player.parts) {
      const r = world.get(ent, Transform);
      if (r.ok) world.set(ent, Transform, { ...r.value, posX: nx + ox, posZ: nz + oz });
    }

    // ── Trails (behind player = +Z offset) ──
    gs.trailTimer -= dt;
    if (gs.trailTimer <= 0) {
      spawnTrail(world, geo, mat, nx - 0.45, nz + 1.9, trails);
      spawnTrail(world, geo, mat, nx + 0.45, nz + 1.9, trails);
      gs.trailTimer = 0.025;
    }

    // ── Weapon switching (keys 1-5) ──
    if (gs.keys.has('Digit1')) gs.weapon = 0;
    else if (gs.keys.has('Digit2')) gs.weapon = 1;
    else if (gs.keys.has('Digit3')) gs.weapon = 2;
    else if (gs.keys.has('Digit4')) gs.weapon = 3;
    else if (gs.keys.has('Digit5')) gs.weapon = 4;

    // ── Shooting (weapon-based) ──
    gs.shootCd -= dt;
    if (gs.keys.has('Space') && gs.shootCd <= 0) {
      const w = gs.weapon;
      switch (w) {
        case 0: // Normal — dual straight shots (+ triple if powerup)
          if (gs.tripleShot) {
            spawnBullet(world, geo, mat, nx, nz - 0.3, -1, false, bullets);
            spawnBullet(world, geo, mat, nx - 0.7, nz - 0.1, -1, false, bullets);
            spawnBullet(world, geo, mat, nx + 0.7, nz - 0.1, -1, false, bullets);
          } else {
            spawnBullet(world, geo, mat, nx - 0.9, nz - 0.2, -1, false, bullets);
            spawnBullet(world, geo, mat, nx + 0.9, nz - 0.2, -1, false, bullets);
          }
          break;
        case 1: // Homing — fires a tracking missile
          spawnHomingMissile(world, geo, mat, nx, nz - 0.3, bullets);
          if (gs.tripleShot) {
            spawnHomingMissile(world, geo, mat, nx - 1, nz, bullets);
            spawnHomingMissile(world, geo, mat, nx + 1, nz, bullets);
          }
          break;
        case 2: // Spread — 5-way fan
          for (let k = -2; k <= 2; k++) {
            spawnSpreadBullet(world, geo, mat, nx, nz - 0.2, k * 0.2, -1, bullets);
          }
          break;
        case 3: // Laser — rapid narrow piercing
          spawnLaserShot(world, geo, mat, nx - 0.4, nz - 0.3, bullets);
          spawnLaserShot(world, geo, mat, nx + 0.4, nz - 0.3, bullets);
          break;
        case 4: // Plasma — slow big piercing ball
          spawnPlasma(world, geo, mat, nx, nz - 0.5, bullets);
          break;
      }
      gs.shootCd = WEAPON_CDS[w]! * (gs.tripleShot ? 0.7 : 1);
      updateHud();
    }

    // ── Enemy Spawning ──
    gs.spawnTimer -= dt;
    if (gs.spawnTimer <= 0) { spawnEnemyWave(); gs.spawnTimer = gs.spawnInterval; }
    gs.difficulty += dt * 0.04;
    gs.spawnInterval = Math.max(0.28, 1.1 - gs.difficulty * 0.08);

    // ── Obstacle Spawning（BOSS 不刷障碍）──
    gs.obstacleTimer -= dt;
    if (bossEntity == null && gs.obstacleTimer <= 0 && gs.difficulty > 1) {
      const ox = (Math.random() - 0.5) * ARENA_W * 0.8;
      const oz = -ARENA_H / 2 - 2;
      const obs = spawnObstacle(world, geo, mat, ox, oz, obstacles);
      obstacleParts.set(obs.entity, obs.parts);
      gs.obstacleTimer = 4 + Math.random() * 5;
    }

    // ── BOSS 召唤（首次越过阈值）──
    if (!gs.bossSpawned && gs.score >= BOSS_TRIGGER_SCORE) {
      gs.bossSpawned = true;
      spawnBoss();
    }

    // ── BOSS 逻辑 ──
    if (bossEntity != null) bossUpdate(dt);

    // ── Move Bullets (with homing + life decay) ──
    for (let i = bullets.length - 1; i >= 0; i--) {
      const e = bullets[i]!;
      const tr = world.get(e, Transform); const br = world.get(e, Bullet);
      if (!tr.ok || !br.ok) { bullets.splice(i, 1); continue; }

      let bdx = br.value.dirX || 0;
      let bdz = br.value.dirZ;

      // Homing logic: steer toward nearest enemy
      if (br.value.homing > 0 && br.value.isEnemy === 0) {
        let bestDist = 999;
        let bestX = tr.value.posX, bestZ = tr.value.posZ - 5;
        for (const eE of enemies) {
          const etr = world.get(eE, Transform);
          if (!etr.ok) continue;
          const d = Math.hypot(etr.value.posX - tr.value.posX, etr.value.posZ - tr.value.posZ);
          if (d < bestDist) { bestDist = d; bestX = etr.value.posX; bestZ = etr.value.posZ; }
        }
        // Steer toward target
        const toX = bestX - tr.value.posX;
        const toZ = bestZ - tr.value.posZ;
        const toLen = Math.hypot(toX, toZ) || 1;
        const steer = 4.0; // steering strength per second
        bdx += (toX / toLen) * steer * dt;
        bdz += (toZ / toLen) * steer * dt;
        // Normalize direction
        const dLen = Math.hypot(bdx, bdz) || 1;
        bdx /= dLen; bdz /= dLen;
        // Update direction in component
        world.set(e, Bullet, { ...br.value, dirX: bdx, dirZ: bdz, life: br.value.life - dt });
      } else {
        // Decay life for all bullets
        world.set(e, Bullet, { ...br.value, life: br.value.life - dt });
      }

      // Life timeout
      if (br.value.life <= 0) { world.despawn(e); bullets.splice(i, 1); continue; }

      const newZ = tr.value.posZ + bdz * br.value.speed * dt;
      const newX = tr.value.posX + bdx * br.value.speed * dt;
      const isPlayerBullet = br.value.isEnemy === 0;
      if (isPlayerBullet && newZ < PLAYER_BULLET_KILL_Z) { world.despawn(e); bullets.splice(i, 1); continue; }
      if (newZ < -ARENA_H / 2 - 4 || newZ > ARENA_H / 2 + 4) { world.despawn(e); bullets.splice(i, 1); continue; }
      if (Math.abs(newX) > ARENA_W / 2 + 4) { world.despawn(e); bullets.splice(i, 1); continue; }
      world.set(e, Transform, { ...tr.value, posX: newX, posZ: newZ });
    }

    // ── Move Enemies (complex behavior based on kind) ──
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i]!;
      if (e === bossEntity) continue;
      const tr = world.get(e, Transform); const er = world.get(e, Enemy);
      if (!tr.ok || !er.ok) { enemies.splice(i, 1); enemyInstances.delete(e); continue; }

      let eNewX = tr.value.posX;
      let eNewZ = tr.value.posZ + er.value.speed * dt;
      const kind = er.value.kind;

      // Kind-specific movement patterns
      switch (kind) {
        case 2: // Interceptor — sine wave horizontal
          eNewX += Math.sin(gs.time * 4 + tr.value.posZ * 0.5) * 6 * dt;
          break;
        case 4: // Scout — zigzag (sharp turns)
          eNewX += (Math.floor(gs.time * 3 + i) % 2 === 0 ? 1 : -1) * 4 * dt;
          break;
        case 7: // Assassin — random teleport sideways every ~2s
          if (Math.random() < dt * 0.5 && eNewZ > VISIBLE_TOP_Z) {
            eNewX = (Math.random() - 0.5) * ARENA_W * 0.8; // teleport!
            spawnExplosion(world, geo, mat, tr.value.posX, tr.value.posZ, 4, particles);
          }
          break;
        case 8: // Spiral — circular orbit while descending
          const radius = 3;
          const angle = gs.time * 2 + i * 1.5;
          eNewX = tr.value.posX + Math.cos(angle) * radius * dt * 2;
          eNewZ = tr.value.posZ + er.value.speed * dt; // still moves forward
          break;
      }

      // Clamp X to arena
      eNewX = Math.max(-ARENA_W / 2, Math.min(ARENA_W / 2, eNewX));

      if (eNewZ > ARENA_H / 2 + 4) { despawnEnemy(e); enemies.splice(i, 1); continue; }
      // Move only the container root; parts follow via propagateTransforms.
      world.set(e, Transform, { ...tr.value, posX: eNewX, posZ: eNewZ });

      // Hit flash decay
      const flash = Math.max(0, er.value.hitFlash - dt * 3);
      if (eNewZ < VISIBLE_TOP_Z) {
        world.set(e, Enemy, { ...er.value, shootTimer: er.value.shootTimer, hitFlash: flash });
        continue;
      }

      // Shooting behavior (kind-specific patterns)
      const nt = er.value.shootTimer - dt;
      if (nt <= 0) {
        switch (kind) {
          case 7: // Assassin — fires aimed burst toward player
            if (player) {
              const pr2 = world.get(player.entity, Transform);
              if (pr2.ok) {
                const toX = pr2.value.posX - eNewX;
                const toZ = pr2.value.posZ - eNewZ;
                const len = Math.hypot(toX, toZ) || 1;
                spawnBullet(world, geo, mat, eNewX, eNewZ + 0.3, toZ / len, true, bullets, toX / len);
              }
            }
            world.set(e, Enemy, { ...er.value, shootTimer: 1.5 + Math.random(), hitFlash: flash });
            break;
          case 8: // Spiral — ring burst (4 directions)
            for (let k = 0; k < 4; k++) {
              const a = (k / 4) * Math.PI * 2 + gs.time;
              spawnBullet(world, geo, mat, eNewX, eNewZ, Math.sin(a), true, bullets, Math.cos(a));
            }
            world.set(e, Enemy, { ...er.value, shootTimer: 1.8 + Math.random(), hitFlash: flash });
            break;
          default: // Normal single shot toward player
            spawnBullet(world, geo, mat, eNewX, eNewZ + 0.6, 1, true, bullets);
            world.set(e, Enemy, { ...er.value, shootTimer: 1 + Math.random() * 2, hitFlash: flash });
        }
      } else {
        world.set(e, Enemy, { ...er.value, shootTimer: nt, hitFlash: flash });
      }
    }

    // ── Move Obstacles ──
    for (let i = obstacles.length - 1; i >= 0; i--) {
      const e = obstacles[i]!;
      const tr = world.get(e, Transform); const ob = world.get(e, Obstacle);
      if (!tr.ok || !ob.ok) { obstacles.splice(i, 1); obstacleParts.delete(e); continue; }
      const newZ = tr.value.posZ + ob.value.speed * dt;
      if (newZ > ARENA_H / 2 + 4) { despawnObstacle(e); obstacles.splice(i, 1); continue; }
      world.set(e, Transform, { ...tr.value, posZ: newZ });
      const pts = obstacleParts.get(e);
      if (pts) for (const p of pts) { const r = world.get(p, Transform); if (r.ok) world.set(p, Transform, { ...r.value, posX: tr.value.posX, posZ: newZ }); }
    }

    // ── Move PowerUps ──
    for (let i = powerups.length - 1; i >= 0; i--) {
      const e = powerups[i]!;
      const tr = world.get(e, Transform);
      if (!tr.ok) { powerups.splice(i, 1); continue; }
      if (tr.value.posZ > ARENA_H / 2 + 4) { world.despawn(e); powerups.splice(i, 1); continue; }
    }

    // ── Collision: player bullets → enemies（屏外不受伤 + HP 扣血）──
    for (let bi = bullets.length - 1; bi >= 0; bi--) {
      const bE = bullets[bi]!;
      const btr = world.get(bE, Transform); const bbr = world.get(bE, Bullet);
      if (!btr.ok || !bbr.ok) { bullets.splice(bi, 1); continue; }
      if (bbr.value.isEnemy > 0) continue;
      const bx = btr.value.posX, bz = btr.value.posZ;
      for (let ei = enemies.length - 1; ei >= 0; ei--) {
        const eE = enemies[ei]!;
        const etr = world.get(eE, Transform); const er = world.get(eE, Enemy);
        if (!etr.ok || !er.ok) { enemies.splice(ei, 1); continue; }
        // 屏外敌人不受伤（BOSS 除外 — boss 总是可被击中，因为它下降过程中也会靠近屏幕）
        if (eE !== bossEntity && etr.value.posZ < VISIBLE_TOP_Z) continue;
        const radius = (eE === bossEntity) ? BOSS_HIT_R : HIT_R;
        if (Math.hypot(bx - etr.value.posX, bz - etr.value.posZ) < BUL_R + radius) {
          // Handle pierce bullets (laser/plasma pass through)
          const pierceLeft = bbr.value.pierce;
          if (pierceLeft <= 0) {
            world.despawn(bE); bullets.splice(bi, 1);
          } else {
            // Reduce pierce count, bullet continues
            world.set(bE, Bullet, { ...bbr.value, pierce: pierceLeft - 1 });
          }
          const newHp = er.value.hp - 1;
          if (newHp <= 0) {
            if (eE === bossEntity) {
              onBossDeath();
            } else {
              despawnEnemy(eE); enemies.splice(ei, 1);
              spawnExplosion(world, geo, mat, etr.value.posX, etr.value.posZ, 16, particles);
              gs.comboCount++; gs.comboTimer = COMBO_WINDOW;
              gs.comboMultiplier = Math.min(8, Math.floor(gs.comboCount / 2) + 1);
              gs.score += 100 * gs.comboMultiplier;
              if (shouldDropPowerUp()) spawnPowerUp(world, geo, mat, etr.value.posX, etr.value.posZ, powerups);
              updateHud();
            }
          } else {
            world.set(eE, Enemy, { ...er.value, hp: newHp, hitFlash: 1 });
            spawnExplosion(world, geo, mat, btr.value.posX, btr.value.posZ, 3, particles);
            if (eE === bossEntity) {
              gs.score += 25; updateHud(); updateBossHud();
            }
          }
          if (pierceLeft <= 0) break; // non-pierce bullet stops here
        }
      }
    }

    // ── Collision: player bullets → obstacles ──
    for (let bi = bullets.length - 1; bi >= 0; bi--) {
      const bE = bullets[bi]!;
      const btr = world.get(bE, Transform); const bbr = world.get(bE, Bullet);
      if (!btr.ok || !bbr.ok) { bullets.splice(bi, 1); continue; }
      if (bbr.value.isEnemy > 0) continue;
      const bx = btr.value.posX, bz = btr.value.posZ;
      for (let oi = obstacles.length - 1; oi >= 0; oi--) {
        const oE = obstacles[oi]!;
        const otr = world.get(oE, Transform); const ob = world.get(oE, Obstacle);
        if (!otr.ok || !ob.ok) { obstacles.splice(oi, 1); continue; }
        if (Math.hypot(bx - otr.value.posX, bz - otr.value.posZ) < BUL_R + 0.7) {
          world.despawn(bE); bullets.splice(bi, 1);
          const newHp = ob.value.hp - 1;
          if (newHp <= 0) {
            spawnExplosion(world, geo, mat, otr.value.posX, otr.value.posZ, 10, particles);
            despawnObstacle(oE); obstacles.splice(oi, 1);
            gs.score += 50 * gs.comboMultiplier; updateHud();
          } else { world.set(oE, Obstacle, { ...ob.value, hp: newHp }); }
          break;
        }
      }
    }

    // ── Damage to player ──
    if (gs.invulnTimer <= 0) {
      for (let bi = bullets.length - 1; bi >= 0; bi--) {
        const bE = bullets[bi]!;
        const btr = world.get(bE, Transform); const bbr = world.get(bE, Bullet);
        if (!btr.ok || !bbr.ok) { bullets.splice(bi, 1); continue; }
        if (bbr.value.isEnemy === 0) continue;
        if (Math.hypot(btr.value.posX - nx, btr.value.posZ - nz) < BUL_R + HIT_R) {
          world.despawn(bE); bullets.splice(bi, 1);
          takeDamage(nx, nz); break;
        }
      }
      if (gs.alive) for (let ei = enemies.length - 1; ei >= 0; ei--) {
        const eE = enemies[ei]!;
        const etr = world.get(eE, Transform);
        if (!etr.ok) { enemies.splice(ei, 1); continue; }
        if (Math.hypot(etr.value.posX - nx, etr.value.posZ - nz) < HIT_R * 2) {
          despawnEnemy(eE); enemies.splice(ei, 1);
          takeDamage(nx, nz); break;
        }
      }
      if (gs.alive) for (let oi = obstacles.length - 1; oi >= 0; oi--) {
        const oE = obstacles[oi]!;
        const otr = world.get(oE, Transform);
        if (!otr.ok) { obstacles.splice(oi, 1); continue; }
        if (Math.hypot(otr.value.posX - nx, otr.value.posZ - nz) < 0.7 + HIT_R) {
          despawnObstacle(oE); obstacles.splice(oi, 1);
          spawnExplosion(world, geo, mat, otr.value.posX, otr.value.posZ, 8, particles);
          takeDamage(nx, nz); break;
        }
      }
    }

    // ── Power-up pickup ──
    for (let pi = powerups.length - 1; pi >= 0; pi--) {
      const pE = powerups[pi]!;
      const ptr = world.get(pE, Transform); const pur = world.get(pE, PowerUp);
      if (!ptr.ok || !pur.ok) { powerups.splice(pi, 1); continue; }
      if (Math.hypot(ptr.value.posX - nx, ptr.value.posZ - nz) < 1.2) {
        const type = getPowerUpType(pur.value.type);
        world.despawn(pE); powerups.splice(pi, 1);
        applyPowerUp(type);
      }
    }

    // ── Cleanup ──
    for (let i = particles.length - 1; i >= 0; i--) { const e = particles[i]!; const r = world.get(e, Particle); if (!r.ok || r.value.life <= 0) { world.despawn(e); particles.splice(i, 1); } }
    for (let i = trails.length - 1; i >= 0; i--) { const e = trails[i]!; const r = world.get(e, Trail); if (!r.ok || r.value.life <= 0) { world.despawn(e); trails.splice(i, 1); } }

    // ── 剧情节拍触发 ──
    for (const b of beats) {
      if (!b.fired && gs.score >= b.scoreThreshold) {
        b.fired = true;
        storyUi.showBeat(b);
      }
    }

    // ── 通关条件：仅在 BOSS 击杀后触发（以防万一作为 fallback） ──
    if (!gs.victory && bossEntity == null && gs.bossSpawned && gs.score >= VICTORY_SCORE) {
      gs.victory = true;
      triggerVictory();
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════════════════════

  function despawnEnemy(e: Entity) {
    // Tear down the whole scene instance (synth root + container + parts) in
    // one call. Engine 5dfeb0b6 ECS-fied SceneInstance: `world.despawnScene`
    // walks Children/SceneInstance.mapping starting from the synth root.
    const synth = enemyInstances.get(e);
    if (synth !== undefined) { world.despawnScene(synth); enemyInstances.delete(e); }
    else world.despawn(e);
  }

  function despawnObstacle(e: Entity) {
    const pts = obstacleParts.get(e);
    if (pts) { for (const p of pts) world.despawn(p); obstacleParts.delete(e); }
    world.despawn(e);
  }

  function takeDamage(px: number, pz: number) {
    if (gs.hasShield) {
      gs.hasShield = false; gs.shieldTimer = 0; gs.invulnTimer = 0.5;
      spawnExplosion(world, geo, mat, px, pz, 6, particles);
      updateHud(); return;
    }
    gs.hp--;
    gs.invulnTimer = 1.5;
    spawnExplosion(world, geo, mat, px, pz, 12, particles);
    if (gs.hp <= 0) gameOver(px, pz); else updateHud();
  }

  function applyPowerUp(type: string) {
    switch (type) {
      case 'shield': gs.hasShield = true; gs.shieldTimer = 12; break;
      case 'triple': gs.tripleShot = true; gs.tripleTimer = 8; break;
      case 'bomb':
        // 炸弹：BOSS 不秒杀、只扣 30 点 HP；其他敌人一发清场
        for (let i = enemies.length - 1; i >= 0; i--) {
          const eE = enemies[i]!;
          if (eE === bossEntity) {
            const er = world.get(eE, Enemy);
            if (er.ok) {
              const newHp = Math.max(0, er.value.hp - 30);
              if (newHp <= 0) onBossDeath();
              else { world.set(eE, Enemy, { ...er.value, hp: newHp, hitFlash: 1 }); updateBossHud(); }
            }
            continue;
          }
          const etr = world.get(eE, Transform);
          if (etr.ok) spawnExplosion(world, geo, mat, etr.value.posX, etr.value.posZ, 8, particles);
          despawnEnemy(eE); gs.score += 50;
          enemies.splice(i, 1);
        }
        for (let i = obstacles.length - 1; i >= 0; i--) {
          const oE = obstacles[i]!; const otr = world.get(oE, Transform);
          if (otr.ok) spawnExplosion(world, geo, mat, otr.value.posX, otr.value.posZ, 6, particles);
          despawnObstacle(oE);
        }
        obstacles.length = 0;
        break;
      case 'heal': gs.hp = Math.min(MAX_HP, gs.hp + 1); break;
    }
    updateHud();
  }

  function gameOver(px: number, pz: number) {
    spawnExplosion(world, geo, mat, px, pz, 30, particles);
    if (player) { world.despawn(player.entity); for (const [ent] of player.parts) world.despawn(ent); player = null; }
    gs.alive = false;
    setHud(`💥 GAME OVER — ${gs.score}pts  [R] Restart`, '#f55', '0 0 10px #f44,0 0 24px #a00');
    if (hudHP) hudHP.textContent = '';
    if (hudCombo) hudCombo.style.opacity = '0';
    if (hudPower) hudPower.textContent = '';
  }

  function triggerVictory() {
    // 在屏幕中央放一束庆祝爆炸
    if (player) {
      const pr = world.get(player.entity, Transform);
      if (pr.ok) spawnExplosion(world, geo, mat, pr.value.posX, pr.value.posZ, 24, particles);
    }
    // 清场所有敌人 / 障碍 / 子弹 ——欢迎黎明
    for (const eE of enemies) despawnEnemy(eE);
    enemies.length = 0;
    for (const oE of obstacles) despawnObstacle(oE);
    obstacles.length = 0;
    for (const bE of bullets) world.despawn(bE);
    bullets.length = 0;
    // 冻结主流程（复用 alive=false 的循环短路），但保留玩家飞机展示
    gs.alive = false;
    // 隐藏战斗 HUD，让结局界面登台
    if (hud) hud.style.opacity = '0';
    if (hudHP) hudHP.textContent = '';
    if (hudCombo) hudCombo.style.opacity = '0';
    if (hudPower) hudPower.textContent = '';
    if (hudBoss) hudBoss.style.display = 'none';
    storyUi.showEnding(gs.score);
  }
}
