// Enemies — lowpoly cow-level bestiary.
//
// ARCHITECTURE
// ────────────
// Each enemy owns a kinematic ROOT entity (rigid body + collider) and an
// authored native SceneAsset instance parented beneath it. The root carries all
// gameplay physics; the instance carries every visual mesh/material/hierarchy.
// Rapier therefore sees one body per enemy while art remains editable as a
// standard scene pack.
//
// DIFFICULTY TIERS
// ────────────────
// Day (level 1):
//   T1 (early)    GrassCalf, RagingCow
//   T2 (escalate) SparkCalf, BloodCow
//   T3 (late)     StoneBull, ToxicCow, ShadowStalker
//   BOSS          CowKing
// Night (level 2):
//   T1            Batling
//   T2            GraveWalker, NightHowler
//   BOSS          VampireLord
//
// All enemies share:
//   - same root primitive (a kinematic-bodied cuboid hidden inside the
//     visible parts) sized by tier
//   - authored material hierarchy remains inside the native scene instance
//   - timestamped status: flashUntil / slowUntil / poisonUntil
//
// SPAWN MIX
// ─────────
// `tickSpawn` rolls each spawn against the ACTIVE LevelSpawnConfig's
// time-phased weight tables (src/levels.ts). main.ts calls `setLevel`
// on every stage transition; boss kind/cadence also come from the config.

import {
  Transform,
} from '@forgeax/engine-scene';
import {
  quat,
} from '@forgeax/engine-runtime';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { Collider, ColliderShapeValue, RigidBody, RigidBodyTypeValue } from '@forgeax/engine-physics';
import type { EntityHandle } from '@forgeax/engine-ecs';
import type { SceneAsset } from '@forgeax/engine-types';
import type { GameEntry } from '@forgeax/engine-app';
import type { LevelSpawnConfig } from './levels';

type Ctx = Parameters<GameEntry>[0];

// (cylinder mesh deliberately not used — see file header. shadowstalker's
// torso, the only previous cylinder user, is now a thin tall cube.)

// ─── Enemy taxonomy ────────────────────────────────────────────────────────
export type EnemyKind =
  | 'grasscalf'      // T1 — weak, fast-spawn mooks
  | 'ragingcow'      // T1+ — classic D2 cow-man, charges
  | 'sparkcalf'      // T2 — fast, fragile, suicide-bomber
  | 'bloodcow'       // T2 — fat, slow, splits on death
  | 'stonebull'      // T3 — armored bruiser
  | 'toxiccow'       // T3 — slows player on touch (poison aura)
  | 'shadowstalker'  // T3 — fast, semi-transparent, low HP
  | 'cowking'        // BOSS (day)
  | 'batling'        // T1 night — small fast flyer
  | 'gravewalker'    // T2 night — shambling undead cow-man
  | 'nighthowler'    // T2 night — fast lunging wolf
  | 'vampirelord';   // BOSS (night)

export type Tier = 'T1' | 'T2' | 'T3' | 'BOSS';

export type DeathFx =
  | 'gibs'           // generic red gibs
  | 'split'          // spawn 2 sparkcalves
  | 'explode'        // self-AoE damage to nearby enemies (NOT player)
  | 'shatter'        // gray rock chunks
  | 'cloud'          // green poison puff
  | 'wisp'           // purple wisps
  | 'gem';           // boss: spawn xp gem cluster

const MONSTER_SCENE_GUIDS: Record<EnemyKind, string> = {
  grasscalf: '7fda2583-2d08-49ba-9ffc-9526305c0c65',
  ragingcow: 'ac264459-af2e-48ef-9caa-299c07b85664',
  sparkcalf: '18d139c4-20b6-4700-abae-af0ceaf03070',
  bloodcow: '283e27ad-09a0-488f-9f07-f75b679eec3c',
  stonebull: '01eff887-1f8a-4827-9548-2889bd8936c7',
  toxiccow: 'eae8943a-b9e3-48e3-9e50-baf97c3235c3',
  shadowstalker: '2f459a8e-c4df-4064-8864-fc0e6115f667',
  cowking: '798dc4f3-4bfc-4a0d-97ee-d0033709b656',
  batling: '291910c6-9f1a-48ab-bde0-2a16088478d3',
  gravewalker: 'd45f41e8-71ba-4c86-909d-2548f68b7b05',
  nighthowler: 'c02c10fe-77a2-4619-8023-ded51a681f58',
  vampirelord: '143bcd1d-54c1-4cf9-b85a-72085aac6da0',
};

export interface EnemyDef {
  kind: EnemyKind;
  tier: Tier;
  hp: number;
  speed: number;          // units/s
  /** Collider half-extents (cuboid). Not necessarily the visual size. */
  colliderHX: number;
  colliderHY: number;
  colliderHZ: number;
  /** Anchor height (root Transform.pos[1] = colliderHY + 0.05 → bottom rests at y=0.05). */
  damage: number;         // contact damage / s? — applied as a single discrete
                          //   hit during the player's i-frame window
  score: number;
  xp: number;
  knockback: number;      // bullet impulse multiplier (1 = standard)
  deathFx: DeathFx;
  /** Special combat traits, all opt-in. */
  contactSlow?: number;       // toxic — applies slow on player contact
  selfDestructOnContact?: boolean;
  bossPhase2HpFraction?: number; // boss enrages below this hp ratio
}

// ─── Bestiary ──────────────────────────────────────────────────────────────
// Behavior and physics live here. Every visual hierarchy is authored in the
// corresponding native SceneAsset identified by MONSTER_SCENE_GUIDS below.

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  // ── T1 GrassCalf — small, slow-ish, white with black spots, two stub legs.
  grasscalf: {
    kind: 'grasscalf', tier: 'T1',
    hp: 22, speed: 3.0,
    colliderHX: 0.40, colliderHY: 0.35, colliderHZ: 0.55,
    damage: 6, score: 8, xp: 2, knockback: 1.1, deathFx: 'gibs',
    // 4-legged little cow, broadside silhouette. py is LOCAL to root center.
    // Root center sits at ground+colliderHY+0.05; legs reach down to py=-0.30.
  },

  // ── T1+ RagingCow — D2's iconic cow-man: bipedal, red eyes, big shoulders.
  ragingcow: {
    kind: 'ragingcow', tier: 'T1',
    hp: 45, speed: 3.6,
    colliderHX: 0.45, colliderHY: 0.70, colliderHZ: 0.40,
    damage: 12, score: 18, xp: 4, knockback: 1.0, deathFx: 'gibs',
    // Bipedal D2 cow-man. py LOCAL range [-0.70, +0.70].
  },

  // ── T2 SparkCalf — small, electric, all-emissive blue, hovers slightly.
  sparkcalf: {
    kind: 'sparkcalf', tier: 'T2',
    hp: 14, speed: 6.0,
    colliderHX: 0.30, colliderHY: 0.40, colliderHZ: 0.30,
    damage: 14, score: 18, xp: 4, knockback: 1.6, deathFx: 'explode',
    selfDestructOnContact: true,
    // A floating CUBE core wrapped in lightning arcs — no body sphere.
    // py LOCAL range [-0.40, +0.40].
  },

  // ── T2 BloodCow — bloated, dark red, splits into 2 sparkcalves on death.
  bloodcow: {
    kind: 'bloodcow', tier: 'T2',
    hp: 95, speed: 1.9,
    colliderHX: 0.70, colliderHY: 0.60, colliderHZ: 0.85,
    damage: 16, score: 35, xp: 7, knockback: 0.55, deathFx: 'split',
    // Big bloated quadruped — cube body (NOT sphere), with tumors and legs.
    // py LOCAL range [-0.60, +0.60].
  },

  // ── T3 StoneBull — tank, gray armor, oversized horns, glowing red eye line.
  stonebull: {
    kind: 'stonebull', tier: 'T3',
    hp: 240, speed: 1.7,
    colliderHX: 0.65, colliderHY: 0.80, colliderHZ: 0.55,
    damage: 22, score: 80, xp: 14, knockback: 0.20, deathFx: 'shatter',
    // Bipedal heavy bruiser. py LOCAL range [-0.80, +0.80].
  },

  // ── T3 ToxicCow — plague-green, swollen sacs on the back, slows on touch.
  toxiccow: {
    kind: 'toxiccow', tier: 'T3',
    hp: 110, speed: 2.3,
    colliderHX: 0.50, colliderHY: 0.55, colliderHZ: 0.70,
    damage: 10, score: 60, xp: 12, knockback: 0.7, deathFx: 'cloud',
    contactSlow: 1.5,
    // Quadruped with massive tumor sacs on the back. py LOCAL range [-0.55, +0.55].
  },

  // ── T3 ShadowStalker — slim, hovering, two purple eyes, faint translucent
  //    body. Fast, low HP, designed to flank.
  shadowstalker: {
    kind: 'shadowstalker', tier: 'T3',
    hp: 65, speed: 5.5,
    colliderHX: 0.32, colliderHY: 0.75, colliderHZ: 0.32,
    damage: 16, score: 55, xp: 9, knockback: 1.3, deathFx: 'wisp',
    // Tall, hovering, NO legs. py LOCAL range [-0.75, +0.75].
  },

  // ── BOSS CowKing — golden-red colossus, jagged crown, glowing core,
  //    wingspan via cape cubes. Phase-2 enrage at 40% HP (handled in tickAI).
  cowking: {
    kind: 'cowking', tier: 'BOSS',
    hp: 1500, speed: 2.6,
    colliderHX: 1.10, colliderHY: 1.35, colliderHZ: 1.00,
    damage: 38, score: 800, xp: 60, knockback: 0.10, deathFx: 'gem',
    bossPhase2HpFraction: 0.4,
    // Bipedal giant. py LOCAL range [-1.35, +1.35].
  },

  // ── NIGHT T1 Batling — small dark flyer, hovers, swept wings, red eyes.
  batling: {
    kind: 'batling', tier: 'T1',
    hp: 16, speed: 4.6,
    colliderHX: 0.35, colliderHY: 0.30, colliderHZ: 0.30,
    damage: 7, score: 10, xp: 2, knockback: 1.5, deathFx: 'wisp',
    // Hovering — no legs. py LOCAL range [-0.30, +0.30].
  },

  // ── NIGHT T2 GraveWalker — shambling undead cow-man, exposed glowing ribs.
  gravewalker: {
    kind: 'gravewalker', tier: 'T2',
    hp: 80, speed: 2.1,
    colliderHX: 0.45, colliderHY: 0.70, colliderHZ: 0.40,
    damage: 15, score: 30, xp: 6, knockback: 0.8, deathFx: 'cloud',
    // Bipedal like ragingcow but hunched forward, asymmetric. py LOCAL [-0.70, +0.70].
  },

  // ── NIGHT T2 NightHowler — lean fast wolf, yellow eyes, raised hackles.
  nighthowler: {
    kind: 'nighthowler', tier: 'T2',
    hp: 48, speed: 5.2,
    colliderHX: 0.35, colliderHY: 0.40, colliderHZ: 0.60,
    damage: 17, score: 40, xp: 8, knockback: 1.2, deathFx: 'gibs',
    // Lean quadruped, long low body. py LOCAL range [-0.40, +0.40].
  },

  // ── NIGHT BOSS VampireLord — tall caped figure, crimson core, bat-wing
  //    blades. Phase-2 enrage at 50% HP.
  vampirelord: {
    kind: 'vampirelord', tier: 'BOSS',
    hp: 2000, speed: 2.9,
    colliderHX: 1.00, colliderHY: 1.40, colliderHZ: 0.90,
    damage: 42, score: 1000, xp: 70, knockback: 0.10, deathFx: 'gem',
    bossPhase2HpFraction: 0.5,
    // Tall slim giant. py LOCAL range [-1.40, +1.40].
  },
};

// ─── runtime ───────────────────────────────────────────────────────────────

export interface Enemy {
  /** Kinematic physics root. */
  e: EntityHandle;
  /** Native SceneAsset instance root, parented under `e`. */
  visualRoot: EntityHandle;
  kind: EnemyKind;
  hp: number;
  maxHp: number;
  /** Cached XZ for AI / queries (synced from Transform each tick). */
  x: number; z: number;
  /** Status timers (seconds remaining). */
  flashUntil: number;
  slowUntil: number;
  poisonUntil: number;
  /** Phase-2 latch for boss (kicks once below bossPhase2HpFraction). */
  enraged: boolean;
  /** True after lethal damage; collision queries ignore it until teardown. */
  dead: boolean;
}

export class EnemyManager {
  enemies: Enemy[] = [];
  private readonly visuals = new Map<EnemyKind, SceneAsset>();
  /** Active level's spawn tables — set via setLevel before the first tick. */
  private cfg: LevelSpawnConfig | null = null;
  private elapsed = 0;
  private spawnTimer = 0;
  private bossTimer = 60;
  private bossWarned = false;     // edge-trigger for the "boss incoming" warning
  private maxAlive = 30;
  private worldRadius = 26;
  private playArea = 28;
  /** Difficulty knob — bumped when player levels (callable from main.ts). */
  difficultyTier = 0;

  /** Optional callbacks main.ts can wire up for boss-related cinematic FX. */
  onBossWarning: (() => void) | null = null;
  onBossSpawn: ((x: number, z: number) => void) | null = null;

  constructor(private ctx: Ctx) {}

  /**
   * Spawn the kinematic gameplay root, then attach the authored native monster
   * SceneAsset beneath it. Scene loading is performed once in `prepare()` so
   * frame-time spawning never performs network work.
   */
  spawn(kind: EnemyKind, x: number, z: number): Enemy | null {
    const def = ENEMIES[kind];
    const scene = this.visuals.get(kind);
    if (scene === undefined) {
      console.error('[cow] monster visual was not prepared:', kind);
      return null;
    }
    const { world, assets } = this.ctx;
    const rootY = def.colliderHY + 0.05;
    const root = world.spawn(
      { component: Transform, data: { pos: [x, rootY, z] } },
      { component: RigidBody, data: { type: RigidBodyTypeValue.kinematic } },
      { component: Collider, data: {
        shape: ColliderShapeValue.cuboid,
        halfExtents: [def.colliderHX, def.colliderHY, def.colliderHZ],
        friction: 0.6, restitution: 0.05,
      } },
    ).unwrap();

    const handle = world.allocSharedRef<'SceneAsset', SceneAsset>('SceneAsset', scene);
    const visual = assets.instantiate(handle, world, root);
    if (!visual.ok) {
      world.despawn(root);
      console.error('[cow] monster SceneAsset instantiate failed:', kind, visual.error);
      return null;
    }

    const enemy: Enemy = {
      e: root,
      visualRoot: visual.value,
      kind,
      hp: def.hp,
      maxHp: def.hp,
      x,
      z,
      flashUntil: 0,
      slowUntil: 0,
      poisonUntil: 0,
      enraged: false,
      dead: false,
    };
    this.enemies.push(enemy);
    return enemy;
  }

  private spawnAtRing(kind: EnemyKind, centerX: number, centerZ: number): Enemy | null {
    const angle = Math.random() * Math.PI * 2;
    const radius = this.worldRadius + Math.random() * 4;
    const x = Math.max(-this.playArea, Math.min(this.playArea, centerX + Math.cos(angle) * radius));
    const z = Math.max(-this.playArea, Math.min(this.playArea, centerZ + Math.sin(angle) * radius));
    return this.spawn(kind, x, z);
  }

  /** Preload every native enemy SceneAsset before the first spawn wave. */
  async prepare(): Promise<boolean> {
    const loaded = await Promise.all((Object.keys(MONSTER_SCENE_GUIDS) as EnemyKind[]).map(async (kind) => {
      const guid = AssetGuid.parse(MONSTER_SCENE_GUIDS[kind]);
      if (!guid.ok) return { kind, scene: undefined };
      const result = await this.ctx.assets.loadByGuid<SceneAsset>(guid.value);
      return { kind, scene: result.ok ? result.value : undefined };
    }));
    for (const { kind, scene } of loaded) {
      if (scene === undefined) {
        console.error('[cow] monster SceneAsset loadByGuid failed:', kind);
        return false;
      }
      this.visuals.set(kind, scene);
    }
    return true;
  }

  // ─── difficulty / spawn ────────────────────────────────────────────────

  /** Switch the spawner to a level's tables and reset all pacing clocks.
   *  main.ts calls this on game start and on every stage transition. */
  setLevel(cfg: LevelSpawnConfig): void {
    this.cfg = cfg;
    this.elapsed = 0;
    this.spawnTimer = 0;
    this.bossTimer = cfg.bossFirstAt;
    this.bossWarned = false;
    this.maxAlive = cfg.aliveBase;
  }

  /** Despawn every alive enemy (no drops, no death FX) — stage transition. */
  killAll(): void {
    for (const enemy of this.enemies) {
      this.ctx.world.despawnScene(enemy.visualRoot);
      this.ctx.world.despawn(enemy.e);
    }
    this.enemies.length = 0;
  }

  /** Pick a kind for THIS spawn from the active level's time-phased
   *  cumulative-weight tables. The last phase is the open-ended tail. */
  private rollKind(): EnemyKind {
    const phases = this.cfg!.phases;
    let phase = phases[phases.length - 1]!;
    for (const p of phases) {
      if (this.elapsed < p.until) { phase = p; break; }
    }
    const r = Math.random();
    for (const [kind, cum] of phase.weights) {
      if (r < cum) return kind;
    }
    return phase.weights[phase.weights.length - 1]![0];
  }

  tickSpawn(dt: number, playerX: number, playerZ: number): void {
    const cfg = this.cfg;
    if (!cfg) return;
    this.elapsed += dt;
    this.spawnTimer -= dt;
    this.bossTimer -= dt;
    this.maxAlive = Math.min(cfg.aliveCap, cfg.aliveBase + Math.floor(this.elapsed / 10) * cfg.alivePer10s);

    // Boss approach warning — fire 4s before the boss spawns so main.ts can
    // play the banner + red screen shake. Edge-trigger via the bossWarned
    // latch so we don't fire every frame.
    const bossAlive = this.enemies.some((e) => ENEMIES[e.kind].tier === 'BOSS');
    if (this.bossTimer <= 4 && !this.bossWarned && !bossAlive) {
      this.bossWarned = true;
      this.onBossWarning?.();
    }

    // Boss
    if (this.bossTimer <= 0 && !bossAlive) {
      const ang = Math.random() * Math.PI * 2;
      const r = this.worldRadius + 2;
      const bx = playerX + Math.cos(ang) * r;
      const bz = playerZ + Math.sin(ang) * r;
      this.spawn(cfg.boss, bx, bz);
      this.onBossSpawn?.(bx, bz);
      this.bossTimer = cfg.bossInterval;
      this.bossWarned = false;
    }

    if (this.spawnTimer > 0) return;
    if (this.enemies.length >= this.maxAlive) {
      this.spawnTimer = 0.6;
      return;
    }
    const waveSize = cfg.waveBase + Math.floor(Math.random() * (cfg.waveRand + 1))
      + Math.min(cfg.waveGrowthCap, Math.floor(this.elapsed / 25));
    for (let i = 0; i < waveSize; i++) {
      if (this.enemies.length >= this.maxAlive) break;
      this.spawnAtRing(this.rollKind(), playerX, playerZ);
    }
    // Spawn cadence accelerates over time, but never below the floor (so the
    // run feels relentless without melting the solver).
    this.spawnTimer = Math.max(cfg.intervalMin, cfg.intervalStart - this.elapsed * cfg.intervalAccel);
  }

  // ─── per-frame AI ──────────────────────────────────────────────────────
  tickAI(dt: number, playerX: number, playerZ: number): void {
    const { world } = this.ctx;
    for (const en of this.enemies) {
      if (en.dead) continue;
      const tr = world.get(en.e, Transform);
      if (!tr.ok) continue;
      en.x = tr.value.pos[0];
      en.z = tr.value.pos[2];
      const rootY = tr.value.pos[1];
      const def = ENEMIES[en.kind];

      // Boss enrage: bump speed once below threshold
      let speed = def.speed;
      if (def.bossPhase2HpFraction !== undefined && !en.enraged && en.hp <= en.maxHp * def.bossPhase2HpFraction) {
        en.enraged = true;
      }
      if (en.enraged) speed *= 1.45;

      // Slow status
      if (en.slowUntil > 0) speed *= 0.45;

      const dx = playerX - en.x;
      const dz = playerZ - en.z;
      const d = Math.hypot(dx, dz) || 1;
      const sp = speed * dt;
      const nx = en.x + (dx / d) * sp;
      const nz = en.z + (dz / d) * sp;
      const yaw = Math.atan2(-dx, -dz);
      const q = quat.eulerY(yaw);
      world.set(en.e, Transform, {
        pos: [nx, rootY, nz],
        quat: [q[0]!, q[1]!, q[2]!, q[3]!],
      });
      en.x = nx; en.z = nz;

      // Status decay
      en.flashUntil = Math.max(0, en.flashUntil - dt);
      en.slowUntil = Math.max(0, en.slowUntil - dt);
      en.poisonUntil = Math.max(0, en.poisonUntil - dt);

    }
  }

  // ─── status / damage / lifecycle ───────────────────────────────────────
  damage(en: Enemy, dmg: number): { score: number; xp: number; kind: EnemyKind; x: number; z: number } | null {
    if (en.dead) return null;
    en.hp -= dmg;
    en.flashUntil = 0.08;
    if (en.hp <= 0) {
      const def = ENEMIES[en.kind];
      en.dead = true;
      return { score: def.score, xp: def.xp, kind: en.kind, x: en.x, z: en.z };
    }
    return null;
  }

  /** Commit a queued kill after callers finish their current enemy traversal. */
  finalizeKill(en: Enemy): void {
    if (!en.dead) return;
    this.kill(en);
  }

  slow(en: Enemy, sec: number): void {
    en.slowUntil = Math.max(en.slowUntil, sec);
  }

  /** Kill + remove. Caller looks at ENEMIES[kind].deathFx for spawn-on-death. */
  kill(en: Enemy): void {
    en.dead = true;
    this.ctx.world.despawnScene(en.visualRoot);
    this.ctx.world.despawn(en.e);
    const index = this.enemies.indexOf(en);
    if (index >= 0) this.enemies.splice(index, 1);
  }

  // ─── queries (for weapons / contact damage) ────────────────────────────
  nearest(x: number, z: number, maxR: number = 30): Enemy | null {
    let best: Enemy | null = null;
    let bestD = maxR * maxR;
    for (const en of this.enemies) {
      if (en.dead) continue;
      const dx = en.x - x, dz = en.z - z;
      const d = dx * dx + dz * dz;
      if (d < bestD) { bestD = d; best = en; }
    }
    return best;
  }

  inRadius(x: number, z: number, r: number): Enemy[] {
    const r2 = r * r;
    const out: Enemy[] = [];
    for (const en of this.enemies) {
      if (en.dead) continue;
      const dx = en.x - x, dz = en.z - z;
      if (dx * dx + dz * dz <= r2) out.push(en);
    }
    return out;
  }
}
