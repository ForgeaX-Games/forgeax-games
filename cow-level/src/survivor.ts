// ════════════════════════════════════════════════════════════════════════════
//  Cow Hell — survivor-like roguelike gameplay engine (PCG runtime layer)
// ════════════════════════════════════════════════════════════════════════════
//
//  Everything in this module is PROCEDURALLY generated at runtime (enemy swarms,
//  bullets, beams, particles, XP gems) — exactly the kind of indeterminate-count
//  content the charter says `main.ts`/runtime code MAY spawn. The STATIC arena
//  (ground, sun, stone pillars, the Player box-man) lives in scene.pack.json.
//
//  Design choices that matter:
//   • The swarm is CODE-DRIVEN (not rapier-simulated). The engine exposes no
//     impulse/velocity API and kinematic-vs-kinematic gives no response, so a
//     reliable Vampire-Survivors swarm + knockback is integrated by hand here.
//     Real rapier physics is still used by main.ts (player capsule, ground &
//     pillar colliders) and by the dynamic death-debris chunks below.
//   • Bullets are visual entities moved in code; hit detection is a distance
//     test against enemies. Fast, deterministic, juicy.
//   • Damage numbers / crit text / banners are a DOM overlay (HUD) — never
//     world-space meshes (the engine's shadow-caster projects every triangle
//     mesh; a billboard popup would cast a ground shadow — bug-20260610).
//
import {
  Transform, MeshFilter, MeshRenderer, Materials, quat,
  HANDLE_CUBE,
  type MaterialAsset, type Handle,
} from '@forgeax/engine-runtime';
import { Collider, ColliderShapeValue, RigidBody, RigidBodyTypeValue } from '@forgeax/engine-physics';
import type { Entity } from '@forgeax/engine-ecs';
import type { GameEntry } from '@forgeax/engine-app';
import type { HudHandle, UpgradeChoice } from './hud';

type Ctx = Parameters<GameEntry>[0];
type WorldT = Ctx['world'];
type AssetsT = Ctx['assets'];
type MatHandle = Handle<'MaterialAsset', 'shared'>;

// What main.ts feeds the engine every frame.
export interface FrameInput {
  px: number; py: number; pz: number;     // player root world position
  faceX: number; faceZ: number;           // player facing (for muzzle origin)
  aimX: number; aimY: number; aimZ: number; // normalized aim dir (cursor / look)
  mode: 'topdown' | 'fps';
}
export interface FrameResult {
  shake: number;   // additive screen-shake amplitude main applies to the camera
  hurt: boolean;   // player took damage this frame (red flash)
}

// ── tuning ──────────────────────────────────────────────────────────────────
const ARENA_HALF = 23.5;          // enemies clamp inside the visual ground
const SPAWN_RING_MIN = 15;
const SPAWN_RING_MAX = 22;
const MAX_ENEMIES = 72;
const PLAYER_HIT_R = 0.55;        // contact radius for enemy melee

type EnemyKind = 'cow' | 'runner' | 'brute' | 'spitter' | 'boss';
interface EnemyCfg {
  hp: number; speed: number; r: number;          // r = body half-width (XZ)
  sx: number; sy: number; sz: number;            // cube scale
  color: [number, number, number]; emissive?: [number, number, number]; ei?: number;
  dmg: number; knockResist: number; xp: number; score: number;
}
const ENEMY: Record<EnemyKind, EnemyCfg> = {
  cow:     { hp: 30,   speed: 2.6, r: 0.5,  sx: 0.95, sy: 1.0, sz: 0.95, color: [0.52, 0.13, 0.11], dmg: 9,  knockResist: 1,   xp: 4,   score: 10 },
  runner:  { hp: 14,   speed: 5.4, r: 0.34, sx: 0.55, sy: 0.6, sz: 0.55, color: [0.86, 0.42, 0.12], emissive: [0.5, 0.18, 0.02], ei: 0.8, dmg: 6,  knockResist: 0.7, xp: 3,   score: 8 },
  brute:   { hp: 130,  speed: 1.7, r: 0.9,  sx: 1.7,  sy: 1.7, sz: 1.7,  color: [0.36, 0.09, 0.12], dmg: 17, knockResist: 3.2, xp: 14,  score: 45 },
  spitter: { hp: 42,   speed: 2.3, r: 0.5,  sx: 0.85, sy: 0.95, sz: 0.85, color: [0.18, 0.55, 0.16], emissive: [0.1, 0.7, 0.12], ei: 1.4, dmg: 11, knockResist: 1.2, xp: 8,   score: 22 },
  boss:    { hp: 1800, speed: 1.9, r: 1.5,  sx: 2.8,  sy: 2.8, sz: 2.8,  color: [0.62, 0.05, 0.05], emissive: [0.7, 0.05, 0.03], ei: 1.2, dmg: 32, knockResist: 9,   xp: 130, score: 600 },
};

interface Enemy {
  e: Entity; kind: EnemyKind; cfg: EnemyCfg;
  x: number; z: number; y: number;
  hp: number; maxHp: number;
  kx: number; kz: number;            // knockback velocity (decays)
  slowUntil: number; burnUntil: number; burnDps: number; burnTick: number;
  flash: number; punch: number;      // hit-feedback timers
  touchCd: number;                   // contact-damage tick
}

// ── weapons ──────────────────────────────────────────────────────────────────
type WeaponId = 'flame' | 'scatter' | 'frost' | 'chain' | 'orbit' | 'rail';
type AimKind = 'cursor' | 'nearest' | 'orbit';
interface WeaponCfg {
  id: WeaponId; name: string; icon: string; aim: AimKind;
  cd: number; dmg: number; speed: number; count: number; spread: number;
  pierce: number; knock: number; color: [number, number, number];
  radius: number;       // bullet collision radius
  burn?: number;        // burn dps applied on hit
  slow?: number;        // slow factor (0..1) on hit
  chains?: number;      // chain-lightning bounce count
  range?: number;       // hitscan / chain range
  maxLevel: number;
}
const WEAPONS: Record<WeaponId, WeaponCfg> = {
  flame:   { id: 'flame',   name: '熔火弹',   icon: '🔥', aim: 'cursor',  cd: 0.42, dmg: 13, speed: 28, count: 1, spread: 0,    pierce: 0, knock: 4,  color: [1, 0.55, 0.12], radius: 0.28, burn: 6, maxLevel: 6 },
  scatter: { id: 'scatter', name: '地狱霰弹', icon: '💥', aim: 'cursor',  cd: 0.85, dmg: 8,  speed: 23, count: 6, spread: 0.62, pierce: 0, knock: 9,  color: [1, 0.85, 0.3],  radius: 0.24, maxLevel: 6 },
  frost:   { id: 'frost',   name: '寒冰矢',   icon: '❄️', aim: 'nearest', cd: 0.55, dmg: 10, speed: 26, count: 1, spread: 0,    pierce: 1, knock: 3,  color: [0.45, 0.8, 1],  radius: 0.26, slow: 0.5, maxLevel: 6 },
  chain:   { id: 'chain',   name: '闪电链',   icon: '⚡', aim: 'nearest', cd: 1.1,  dmg: 18, speed: 0,  count: 1, spread: 0,    pierce: 0, knock: 5,  color: [0.7, 0.5, 1],   radius: 0,    chains: 4, range: 6.5, maxLevel: 6 },
  orbit:   { id: 'orbit',   name: '环刃',     icon: '🌀', aim: 'orbit',   cd: 0,    dmg: 10, speed: 0,  count: 2, spread: 0,    pierce: 0, knock: 6,  color: [0.6, 1, 0.85],  radius: 0.5,  maxLevel: 6 },
  rail:    { id: 'rail',    name: '轨道炮',   icon: '🔫', aim: 'cursor',  cd: 2.0,  dmg: 65, speed: 0,  count: 1, spread: 0,    pierce: 999, knock: 14, color: [0.6, 0.9, 1], radius: 0, range: 34, maxLevel: 6 },
};

interface OwnedWeapon { cfg: WeaponCfg; level: number; cd: number; }

interface Bullet {
  e: Entity; x: number; y: number; z: number; dx: number; dy: number; dz: number;
  speed: number; age: number; life: number; dmg: number; pierce: number; knock: number;
  radius: number; burn: number; slow: number; hits: Set<Entity>; trail: number; mat: MatHandle;
}
interface OrbitBlade { e: Entity; angle: number; }
interface Particle { e: Entity; x: number; y: number; z: number; vx: number; vy: number; vz: number; age: number; life: number; s: number; grav: number; }
interface Beam { e: Entity; age: number; life: number; }
interface Gem { e: Entity; x: number; z: number; y: number; xp: number; mat: MatHandle; phase: number; }

// ── player stats (mutated by roguelike upgrades) ─────────────────────────────
interface Stats {
  maxHp: number; hp: number; regen: number;
  moveSpeed: number; damageMult: number; fireRateMult: number;
  projBonus: number; pierceBonus: number; pickupRange: number; crit: number;
}

export interface SurvivorDeps {
  world: WorldT; assets: AssetsT; hud: HudHandle;
  project: (wx: number, wy: number, wz: number) => { x: number; y: number } | null;
}

export class Survivor {
  private w: WorldT; private hud: HudHandle;
  private project: SurvivorDeps['project'];

  private enemies: Enemy[] = [];
  private bullets: Bullet[] = [];
  private blades: OrbitBlade[] = [];
  private particles: Particle[] = [];
  private beams: Beam[] = [];
  private gems: Gem[] = [];
  private weapons = new Map<WeaponId, OwnedWeapon>();
  private bladeHitCd = new Map<Entity, number>();   // orbit blade per-enemy cooldown

  private stats: Stats = {
    maxHp: 100, hp: 100, regen: 0,
    moveSpeed: 6, damageMult: 1, fireRateMult: 1,
    projBonus: 0, pierceBonus: 0, pickupRange: 2.4, crit: 0.08,
  };
  private level = 1; private xp = 0; private xpNext = 6;
  private kills = 0; private score = 0; private time = 0;
  private spawnTimer = 0; private bossTimer = 0; private nextBoss = 35;
  private shake = 0;
  private pendingLevels = 0;
  private _paused = false; private _dead = false;

  // material / mesh palette
  private mats: Record<string, MatHandle> = {};
  private px = 0; private pz = 0; private py = 0.75;

  constructor(deps: SurvivorDeps) {
    this.w = deps.world; this.hud = deps.hud; this.project = deps.project;
    this.buildPalette();
    // starting loadout: the flamebolt
    this.weapons.set('flame', { cfg: WEAPONS.flame, level: 1, cd: 0 });
    this.refreshHud();
    this.hud.banner('生存吧！', '消灭涌来的地狱牛魔群');
  }

  get paused(): boolean { return this._paused; }
  get dead(): boolean { return this._dead; }
  get moveSpeed(): number { return this.stats.moveSpeed; }

  private mk(rgb: [number, number, number], rough = 0.6, emis?: [number, number, number], ei = 0): MatHandle {
    return this.w.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
      baseColor: [rgb[0], rgb[1], rgb[2], 1], metallic: 0, roughness: rough,
      ...(emis ? { emissive: emis, emissiveIntensity: ei } : {}),
    }));
  }

  private buildPalette(): void {
    // enemy body materials
    (Object.keys(ENEMY) as EnemyKind[]).forEach((k) => {
      const c = ENEMY[k];
      this.mats['e_' + k] = this.mk(c.color, 0.7, c.emissive, c.ei ?? 0);
    });
    // hit flash (bright white) reused by every enemy
    this.mats.flash = this.mk([1, 1, 1], 0.4, [1, 1, 0.9], 7);
    // weapon bullet materials (emissive → bloom)
    (Object.keys(WEAPONS) as WeaponId[]).forEach((id) => {
      const c = WEAPONS[id].color;
      this.mats['b_' + id] = this.mk(c, 0.35, c, 6);
    });
    // particles + gem
    this.mats.spark = this.mk([1, 0.7, 0.25], 0.4, [1, 0.6, 0.2], 7);
    this.mats.blood = this.mk([0.7, 0.08, 0.08], 0.5, [0.5, 0.04, 0.04], 3);
    this.mats.gem = this.mk([0.4, 1, 0.6], 0.3, [0.3, 1, 0.5], 7);
    this.mats.debris = this.mk([0.3, 0.07, 0.08], 0.8);
  }

  // ── spawn helpers ───────────────────────────────────────────────────────────
  private cube(mat: MatHandle, x: number, y: number, z: number, sx: number, sy: number, sz: number, q?: [number, number, number, number]): Entity {
    return this.w.spawn(
      { component: Transform, data: { posX: x, posY: y, posZ: z, scaleX: sx, scaleY: sy, scaleZ: sz, ...(q ? { quatX: q[0], quatY: q[1], quatZ: q[2], quatW: q[3] } : {}) } },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [mat] } },
    ).unwrap();
  }

  private spawnEnemy(kind: EnemyKind): void {
    if (this.enemies.length >= MAX_ENEMIES && kind !== 'boss') return;
    const cfg = ENEMY[kind];
    const ang = Math.random() * Math.PI * 2;
    const dist = SPAWN_RING_MIN + Math.random() * (SPAWN_RING_MAX - SPAWN_RING_MIN);
    let x = this.px + Math.cos(ang) * dist;
    let z = this.pz + Math.sin(ang) * dist;
    x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, x));
    z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, z));
    const y = cfg.sy / 2;
    // hp scales gently with elapsed time → escalating difficulty
    const hp = Math.round(cfg.hp * (1 + this.time / 90));
    const e = this.cube(this.mats['e_' + kind]!, x, y, z, cfg.sx, cfg.sy, cfg.sz);
    this.enemies.push({
      e, kind, cfg, x, z, y, hp, maxHp: hp,
      kx: 0, kz: 0, slowUntil: 0, burnUntil: 0, burnDps: 0, burnTick: 0,
      flash: 0, punch: 0, touchCd: 0,
    });
    if (kind === 'boss') {
      this.hud.banner('⚠ 牛魔王降临 ⚠', '巨兽踏地而来');
      this.shake = Math.max(this.shake, 0.5);
    }
  }

  // weighted random enemy kind by elapsed time
  private rollKind(): EnemyKind {
    const t = this.time;
    const pool: [EnemyKind, number][] = [['cow', 5], ['runner', t > 12 ? 3 : 1]];
    if (t > 30) pool.push(['spitter', 2]);
    if (t > 45) pool.push(['brute', 1.5]);
    const total = pool.reduce((s, p) => s + p[1], 0);
    let r = Math.random() * total;
    for (const [k, wgt] of pool) { if ((r -= wgt) <= 0) return k; }
    return 'cow';
  }

  // ── per-frame update ─────────────────────────────────────────────────────────
  update(dt: number, inp: FrameInput): FrameResult {
    this.px = inp.px; this.pz = inp.pz; this.py = inp.py;
    let hurt = false;
    this.shake = Math.max(0, this.shake - dt * 1.8);

    if (this._dead) return { shake: this.shake, hurt };
    if (this._paused) return { shake: this.shake, hurt };

    this.time += dt;

    // regen
    if (this.stats.regen > 0 && this.stats.hp < this.stats.maxHp) {
      this.stats.hp = Math.min(this.stats.maxHp, this.stats.hp + this.stats.regen * dt);
    }

    // ── spawning ──
    this.spawnTimer -= dt;
    const interval = Math.max(0.22, 1.1 - this.time * 0.006);
    if (this.spawnTimer <= 0) {
      this.spawnTimer = interval;
      const burst = 1 + Math.floor(this.time / 35) + (Math.random() < 0.3 ? 1 : 0);
      for (let i = 0; i < burst; i++) this.spawnEnemy(this.rollKind());
    }
    this.bossTimer += dt;
    if (this.bossTimer >= this.nextBoss) { this.bossTimer = 0; this.nextBoss = 45; this.spawnEnemy('boss'); }

    // ── enemies: swarm movement + separation + contact damage ──
    const dmgToPlayer = this.updateEnemies(dt);
    if (dmgToPlayer > 0) {
      this.stats.hp -= dmgToPlayer;
      hurt = true;
      this.shake = Math.max(this.shake, Math.min(0.35, dmgToPlayer * 0.05));
      if (this.stats.hp <= 0) { this.die(); return { shake: this.shake, hurt }; }
    }

    // ── weapons ──
    this.updateWeapons(dt, inp);

    // ── projectiles / fx ──
    this.updateBullets(dt);
    this.updateBlades(dt);
    this.updateBeams(dt);
    this.updateParticles(dt);
    this.updateGems(dt);

    // ── level up ──
    while (this.xp >= this.xpNext) { this.xp -= this.xpNext; this.level++; this.xpNext = Math.round(this.xpNext * 1.32 + 4); this.pendingLevels++; }
    if (this.pendingLevels > 0 && !this._paused) this.openLevelUp();

    this.refreshHud();
    return { shake: this.shake, hurt };
  }

  private updateEnemies(dt: number): number {
    let dmg = 0;
    const arr = this.enemies;
    for (let i = arr.length - 1; i >= 0; i--) {
      const en = arr[i]!;
      // burn DoT
      if (en.burnUntil > this.time) {
        en.burnTick -= dt;
        if (en.burnTick <= 0) {
          en.burnTick = 0.25;
          this.hurtEnemy(en, en.burnDps * 0.25, 0, 0, false, 'burn');
          if (en.hp <= 0) { arr.splice(i, 1); continue; }
        }
      }
      const slow = en.slowUntil > this.time ? 0.5 : 1;
      // dir to player
      let dx = this.px - en.x, dz = this.pz - en.z;
      const d = Math.hypot(dx, dz) || 1;
      dx /= d; dz /= d;
      // separation from neighbours (cheap O(n²), capped enemy count)
      let sxp = 0, szp = 0;
      for (let j = 0; j < arr.length; j++) {
        if (j === i) continue;
        const o = arr[j]!;
        const ox = en.x - o.x, oz = en.z - o.z;
        const od = ox * ox + oz * oz;
        const minD = en.cfg.r + o.cfg.r;
        if (od < minD * minD && od > 1e-4) { const id = 1 / Math.sqrt(od); sxp += ox * id; szp += oz * id; }
      }
      const sp = en.cfg.speed * slow;
      let nx = en.x + (dx * sp + sxp * 1.6 + en.kx) * dt;
      let nz = en.z + (dz * sp + szp * 1.6 + en.kz) * dt;
      // knockback decay
      en.kx *= Math.exp(-7 * dt); en.kz *= Math.exp(-7 * dt);
      // don't walk inside the player — stop at contact ring (then deal melee)
      const pd = Math.hypot(nx - this.px, nz - this.pz);
      const stopD = PLAYER_HIT_R + en.cfg.r;
      if (pd < stopD) {
        const k = stopD / (pd || 1);
        nx = this.px + (nx - this.px) * k; nz = this.pz + (nz - this.pz) * k;
        en.touchCd -= dt;
        if (en.touchCd <= 0) { en.touchCd = 0.4; dmg += en.cfg.dmg * 0.4; }
      }
      nx = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, nx));
      nz = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, nz));
      en.x = nx; en.z = nz;
      // visual: face player + hit-flash material + punch scale + tiny bob
      en.flash = Math.max(0, en.flash - dt);
      en.punch = Math.max(0, en.punch - dt * 6);
      const bob = Math.sin((this.time + i) * 9) * 0.03 * (en.kind === 'runner' ? 2 : 1);
      const pf = 1 + en.punch * 0.35;
      const yaw = Math.atan2(-dx, -dz);
      const q = quat.eulerY(yaw);
      this.w.set(en.e, Transform, {
        posX: en.x, posY: en.y + bob, posZ: en.z,
        scaleX: en.cfg.sx * pf, scaleY: en.cfg.sy * pf, scaleZ: en.cfg.sz * pf,
        quatX: q[0]!, quatY: q[1]!, quatZ: q[2]!, quatW: q[3]!,
      });
      if (en.flash > 0) this.w.set(en.e, MeshRenderer, { materials: [this.mats.flash!] });
      else this.w.set(en.e, MeshRenderer, { materials: [this.mats['e_' + en.kind]!] });
    }
    return dmg;
  }

  private nearestEnemy(x: number, z: number, maxR = 999): Enemy | null {
    let best: Enemy | null = null; let bd = maxR * maxR;
    for (const en of this.enemies) {
      const d = (en.x - x) ** 2 + (en.z - z) ** 2;
      if (d < bd) { bd = d; best = en; }
    }
    return best;
  }

  // ── weapons firing ──
  private updateWeapons(dt: number, inp: FrameInput): void {
    const muzzleY = this.py + 0.45;
    for (const ow of this.weapons.values()) {
      const cfg = ow.cfg;
      if (cfg.aim === 'orbit') continue;  // continuous, handled in updateBlades
      ow.cd -= dt;
      const cd = cfg.cd / this.stats.fireRateMult;
      if (ow.cd > 0) continue;

      // resolve aim direction
      let ax = inp.aimX, ay = inp.aimY, az = inp.aimZ;
      if (cfg.aim === 'nearest') {
        const t = this.nearestEnemy(this.px, this.pz, cfg.range ?? 30);
        if (!t) continue;
        ax = t.x - this.px; ay = 0; az = t.z - this.pz;
        const l = Math.hypot(ax, az) || 1; ax /= l; az /= l;
      }
      ow.cd = cd;
      const dmg = cfg.dmg * (1 + 0.25 * (ow.level - 1)) * this.stats.damageMult;

      if (cfg.id === 'chain') { this.fireChain(ax, az, dmg, ow.level); continue; }
      if (cfg.id === 'rail') { this.fireRail(ax, ay, az, muzzleY, dmg, cfg); continue; }

      // projectile weapons: fan `count` bullets in the XZ plane
      const count = cfg.count + this.stats.projBonus + (cfg.id === 'scatter' ? ow.level - 1 : 0);
      const baseYaw = Math.atan2(ax, az);
      for (let k = 0; k < count; k++) {
        const off = count > 1 ? (k - (count - 1) / 2) * (cfg.spread / Math.max(1, count - 1)) : 0;
        const yaw = baseYaw + off + (cfg.id === 'flame' ? 0 : (Math.random() - 0.5) * 0.05);
        const dx = Math.sin(yaw), dz = Math.cos(yaw);
        this.spawnBullet(this.px, muzzleY, this.pz, dx, ay, dz, cfg, dmg);
      }
    }
  }

  private spawnBullet(x: number, y: number, z: number, dx: number, dy: number, dz: number, cfg: WeaponCfg, dmg: number): void {
    const bx = x + dx * 0.6, bz = z + dz * 0.6;
    const s = cfg.radius;
    const e = this.cube(this.mats['b_' + cfg.id]!, bx, y, bz, s * 1.6, s * 1.6, s * 1.6);
    this.bullets.push({
      e, x: bx, y, z: bz, dx, dy, dz, speed: cfg.speed, age: 0, life: 1.4,
      dmg, pierce: cfg.pierce + this.stats.pierceBonus, knock: cfg.knock,
      radius: cfg.radius, burn: cfg.burn ?? 0, slow: cfg.slow ?? 0,
      hits: new Set(), trail: 0, mat: this.mats['b_' + cfg.id]!,
    });
  }

  private updateBullets(dt: number): void {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i]!;
      b.age += dt;
      if (b.age > b.life) { this.w.despawn(b.e); this.bullets.splice(i, 1); continue; }
      b.x += b.dx * b.speed * dt; b.y += b.dy * b.speed * dt; b.z += b.dz * b.speed * dt;
      this.w.set(b.e, Transform, { posX: b.x, posY: b.y, posZ: b.z });
      // light trail for flame bullets
      b.trail -= dt;
      if (b.burn > 0 && b.trail <= 0) { b.trail = 0.03; this.spawnParticle(b.x, b.y, b.z, this.mats.spark!, 0, 0, 0, 0.18, 0.12, 0); }
      // hits
      for (const en of this.enemies) {
        if (b.hits.has(en.e)) continue;
        const rr = (b.radius + en.cfg.r);
        if ((b.x - en.x) ** 2 + (b.z - en.z) ** 2 < rr * rr && Math.abs(b.y - en.y) < 1.4) {
          b.hits.add(en.e);
          const crit = Math.random() < this.stats.crit;
          this.hurtEnemy(en, b.dmg * (crit ? 2.2 : 1), b.dx * b.knock, b.dz * b.knock, crit);
          if (b.burn > 0) { en.burnUntil = this.time + 2; en.burnDps = b.burn; }
          if (b.slow > 0) { en.slowUntil = this.time + 1.6; }
          this.spawnHitSpark(b.x, b.y, b.z, b.mat);
          if (en.hp <= 0) this.killEnemy(en);
          if (b.pierce <= 0) { this.w.despawn(b.e); this.bullets.splice(i, 1); break; }
          b.pierce--;
        }
      }
    }
    // remove dead enemies that died from bullets this frame
    this.cullDeadEnemies();
  }

  private fireChain(ax: number, az: number, dmg: number, level: number): void {
    let cur = this.nearestEnemy(this.px, this.pz, WEAPONS.chain.range);
    if (!cur) return;
    const hit = new Set<Entity>();
    let fromX = this.px, fromZ = this.pz;
    const bounces = (WEAPONS.chain.chains ?? 4) + Math.floor(level / 2);
    const range = WEAPONS.chain.range ?? 6.5;
    for (let n = 0; n <= bounces && cur; n++) {
      hit.add(cur.e);
      this.beam(fromX, fromZ, cur.x, cur.z, this.py + 0.5, [0.7, 0.5, 1], 0.07);
      const crit = Math.random() < this.stats.crit;
      this.hurtEnemy(cur, dmg * (crit ? 2.2 : 1), 0, 0, crit);
      this.spawnHitSpark(cur.x, cur.y + 0.3, cur.z, this.mats['b_chain']!);
      if (cur.hp <= 0) this.killEnemy(cur);
      fromX = cur.x; fromZ = cur.z;
      // next nearest unhit within range
      let nx: Enemy | null = null; let bd = range * range;
      for (const en of this.enemies) {
        if (hit.has(en.e)) continue;
        const d = (en.x - fromX) ** 2 + (en.z - fromZ) ** 2;
        if (d < bd) { bd = d; nx = en; }
      }
      cur = nx;
    }
    this.shake = Math.max(this.shake, 0.08);
    this.cullDeadEnemies();
  }

  private fireRail(ax: number, ay: number, az: number, y: number, dmg: number, cfg: WeaponCfg): void {
    const range = cfg.range ?? 30;
    const halfW = 0.6;
    const yaw = Math.atan2(ax, az);
    const q = quat.eulerY(yaw);
    // thick beam visual
    const e = this.cube(this.mats['b_rail']!, this.px + ax * range / 2, y, this.pz + az * range / 2, halfW * 1.5, halfW * 1.5, range, [q[0]!, q[1]!, q[2]!, q[3]!]);
    this.beams.push({ e, age: 0, life: 0.16 });
    // hit every enemy inside the corridor
    for (const en of this.enemies) {
      const rx = en.x - this.px, rz = en.z - this.pz;
      const along = rx * ax + rz * az;
      if (along < 0 || along > range) continue;
      const perp = Math.abs(rx * az - rz * ax);
      if (perp < halfW + en.cfg.r) {
        const crit = Math.random() < this.stats.crit;
        this.hurtEnemy(en, dmg * (crit ? 2.2 : 1), ax * cfg.knock, az * cfg.knock, crit);
        this.spawnHitSpark(en.x, en.y + 0.3, en.z, this.mats['b_rail']!);
        if (en.hp <= 0) this.killEnemy(en);
      }
    }
    this.shake = Math.max(this.shake, 0.22);
    this.cullDeadEnemies();
  }

  // ── orbit blades ──
  private rebuildBlades(): void {
    for (const b of this.blades) this.w.despawn(b.e);
    this.blades = [];
    const ow = this.weapons.get('orbit'); if (!ow) return;
    const count = ow.cfg.count + (ow.level - 1) + this.stats.projBonus;
    for (let i = 0; i < count; i++) {
      const e = this.cube(this.mats['b_orbit']!, this.px, this.py + 0.4, this.pz, 0.32, 0.32, 0.7);
      this.blades.push({ e, angle: (i / count) * Math.PI * 2 });
    }
  }

  private updateBlades(dt: number): void {
    const ow = this.weapons.get('orbit'); if (!ow) return;
    const dmg = ow.cfg.dmg * (1 + 0.25 * (ow.level - 1)) * this.stats.damageMult;
    const R = 2.3, spin = 2.6;
    for (const [e, t] of this.bladeHitCd) { const nt = t - dt; if (nt <= 0) this.bladeHitCd.delete(e); else this.bladeHitCd.set(e, nt); }
    for (const bl of this.blades) {
      bl.angle += spin * dt;
      const bx = this.px + Math.cos(bl.angle) * R, bz = this.pz + Math.sin(bl.angle) * R;
      const q = quat.eulerY(-bl.angle);
      this.w.set(bl.e, Transform, { posX: bx, posY: this.py + 0.4, posZ: bz, quatX: q[0]!, quatY: q[1]!, quatZ: q[2]!, quatW: q[3]! });
      for (const en of this.enemies) {
        if (this.bladeHitCd.has(en.e)) continue;
        const rr = 0.5 + en.cfg.r;
        if ((bx - en.x) ** 2 + (bz - en.z) ** 2 < rr * rr) {
          this.bladeHitCd.set(en.e, 0.35);
          const dxk = en.x - this.px, dzk = en.z - this.pz; const l = Math.hypot(dxk, dzk) || 1;
          const crit = Math.random() < this.stats.crit;
          this.hurtEnemy(en, dmg * (crit ? 2.2 : 1), (dxk / l) * ow.cfg.knock, (dzk / l) * ow.cfg.knock, crit);
          this.spawnHitSpark(en.x, en.y + 0.3, en.z, this.mats['b_orbit']!);
          if (en.hp <= 0) this.killEnemy(en);
        }
      }
    }
    this.cullDeadEnemies();
  }

  // ── damage / death ──
  private hurtEnemy(en: Enemy, dmg: number, kx: number, kz: number, crit: boolean, kind: 'dmg' | 'crit' | 'burn' = crit ? 'crit' : 'dmg'): void {
    en.hp -= dmg;
    en.kx += kx / en.cfg.knockResist; en.kz += kz / en.cfg.knockResist;
    en.flash = 0.07; en.punch = 1;
    // floating damage number
    const p = this.project(en.x + (Math.random() - 0.5) * 0.3, en.y + en.cfg.sy * 0.6, en.z);
    if (p) this.hud.popup(crit ? '暴击 ' + Math.round(dmg) : '' + Math.round(dmg), p.x, p.y, kind);
  }

  private killEnemy(en: Enemy): void {
    // already flagged hp<=0; mark by setting hp very negative + schedule cull
    en.hp = -9999;
    this.kills++; this.score += en.cfg.score;
    this.spawnGem(en.x, en.z, en.cfg.xp);
    this.spawnDeathBurst(en);
    if (en.kind === 'boss') { this.hud.banner('牛魔王 已诛灭！', '+' + en.cfg.score); this.shake = Math.max(this.shake, 0.6); }
  }

  // removes enemies whose hp dropped to/below zero (despawns the entity once)
  private cullDeadEnemies(): void {
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const en = this.enemies[i]!;
      if (en.hp <= 0) {
        if (en.hp !== -9999) { /* killed via burn path without killEnemy */ this.kills++; this.score += en.cfg.score; this.spawnGem(en.x, en.z, en.cfg.xp); this.spawnDeathBurst(en); }
        this.w.despawn(en.e);
        this.enemies.splice(i, 1);
      }
    }
  }

  private die(): void {
    this._dead = true;
    this.hud.showGameOver({ time: this.time, kills: this.kills, score: this.score, level: this.level });
  }

  // ── particles & fx ──
  private spawnParticle(x: number, y: number, z: number, mat: MatHandle, vx: number, vy: number, vz: number, s: number, life: number, grav: number): void {
    if (this.particles.length > 220) return;
    const e = this.cube(mat, x, y, z, s, s, s);
    this.particles.push({ e, x, y, z, vx, vy, vz, age: 0, life, s, grav });
  }

  private spawnHitSpark(x: number, y: number, z: number, mat: MatHandle): void {
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2, sp = 2 + Math.random() * 3;
      this.spawnParticle(x, y, z, mat, Math.cos(a) * sp, 1 + Math.random() * 3, Math.sin(a) * sp, 0.12 + Math.random() * 0.08, 0.25, 9);
    }
  }

  private spawnDeathBurst(en: Enemy): void {
    const n = en.kind === 'boss' ? 26 : en.kind === 'brute' ? 12 : 7;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 5;
      this.spawnParticle(en.x, en.y + 0.2, en.z, this.mats.blood!, Math.cos(a) * sp, 2 + Math.random() * 5, Math.sin(a) * sp, 0.14 + Math.random() * 0.12, 0.5, 12);
    }
    // BOSS death drops REAL dynamic-physics debris chunks (rapier-simulated)
    if (en.kind === 'boss' || en.kind === 'brute') {
      const chunks = en.kind === 'boss' ? 8 : 3;
      for (let i = 0; i < chunks; i++) {
        const ox = (Math.random() - 0.5) * en.cfg.sx, oz = (Math.random() - 0.5) * en.cfg.sz;
        this.w.spawn(
          { component: Transform, data: { posX: en.x + ox, posY: en.y + 0.6 + Math.random(), posZ: en.z + oz, scaleX: 0.4, scaleY: 0.4, scaleZ: 0.4 } },
          { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
          { component: MeshRenderer, data: { materials: [this.mats.debris!] } },
          { component: RigidBody, data: { type: RigidBodyTypeValue.dynamic, mass: 1, linearDamping: 0.1, angularDamping: 0.2 } },
          { component: Collider, data: { shape: ColliderShapeValue.cuboid, halfExtentsX: 0.2, halfExtentsY: 0.2, halfExtentsZ: 0.2, restitution: 0.4, friction: 0.8 } },
        );
      }
    }
  }

  private updateParticles(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i]!;
      p.age += dt;
      if (p.age > p.life) { this.w.despawn(p.e); this.particles.splice(i, 1); continue; }
      p.vy -= p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.4; p.vx *= 0.6; p.vz *= 0.6; }
      const k = 1 - p.age / p.life;
      const s = p.s * (0.4 + 0.6 * k);
      this.w.set(p.e, Transform, { posX: p.x, posY: p.y, posZ: p.z, scaleX: s, scaleY: s, scaleZ: s });
    }
  }

  private beam(ax: number, az: number, bx: number, bz: number, y: number, _color: [number, number, number], life: number): void {
    const dx = bx - ax, dz = bz - az; const len = Math.hypot(dx, dz) || 0.01;
    const yaw = Math.atan2(dx, dz); const q = quat.eulerY(yaw);
    const e = this.cube(this.mats['b_chain']!, (ax + bx) / 2, y, (az + bz) / 2, 0.12, 0.12, len, [q[0]!, q[1]!, q[2]!, q[3]!]);
    this.beams.push({ e, age: 0, life });
  }

  private updateBeams(dt: number): void {
    for (let i = this.beams.length - 1; i >= 0; i--) {
      const b = this.beams[i]!;
      b.age += dt;
      if (b.age > b.life) { this.w.despawn(b.e); this.beams.splice(i, 1); }
    }
  }

  // ── XP gems ──
  private spawnGem(x: number, z: number, xp: number): void {
    if (this.gems.length > 120) { // overflow: just bank the xp
      this.xp += xp; return;
    }
    const e = this.cube(this.mats.gem!, x, 0.4, z, 0.22, 0.22, 0.22, quat.eulerY(0.7) as [number, number, number, number]);
    this.gems.push({ e, x, z, y: 0.4, xp, mat: this.mats.gem!, phase: Math.random() * 6 });
  }

  private updateGems(dt: number): void {
    const pr = this.stats.pickupRange;
    for (let i = this.gems.length - 1; i >= 0; i--) {
      const g = this.gems[i]!;
      g.phase += dt * 4;
      const dx = this.px - g.x, dz = this.pz - g.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6) {
        this.xp += g.xp; this.score += 1;
        this.spawnParticle(g.x, g.y, g.z, this.mats.gem!, 0, 2, 0, 0.2, 0.25, 6);
        this.w.despawn(g.e); this.gems.splice(i, 1); continue;
      }
      if (d < pr) { const k = (1 - d / pr) * 12 * dt; g.x += dx * k; g.z += dz * k; }
      const q = quat.eulerY(g.phase);
      this.w.set(g.e, Transform, { posX: g.x, posY: g.y + Math.sin(g.phase) * 0.08, posZ: g.z, scaleX: 0.22, scaleY: 0.22, scaleZ: 0.22, quatX: q[0]!, quatY: q[1]!, quatZ: q[2]!, quatW: q[3]! });
    }
  }

  // ── roguelike level-up ──
  private openLevelUp(): void {
    this._paused = true;
    this.hud.banner('升级！LV ' + this.level, '选择一项强化');
    this.hud.showLevelUp(this.rollChoices());
  }

  chooseUpgrade(id: string): void {
    this.applyUpgrade(id);
    this.pendingLevels--;
    if (this.pendingLevels > 0) { this.hud.showLevelUp(this.rollChoices()); }
    else { this._paused = false; this.hud.hideLevelUp(); }
  }

  private rollChoices(): UpgradeChoice[] {
    const pool: UpgradeChoice[] = [];
    // unlock new weapons
    (Object.keys(WEAPONS) as WeaponId[]).forEach((id) => {
      if (this.weapons.has(id)) {
        const ow = this.weapons.get(id)!;
        if (ow.level < ow.cfg.maxLevel) pool.push({ id: 'wlvl:' + id, icon: ow.cfg.icon, title: ow.cfg.name + ' Lv' + (ow.level + 1), desc: '伤害 +25% · 数量/效果增强' });
      } else {
        pool.push({ id: 'wnew:' + id, icon: WEAPONS[id].icon, title: '解锁 ' + WEAPONS[id].name, desc: this.weaponDesc(id) });
      }
    });
    // stat boosts (always available)
    const stat: UpgradeChoice[] = [
      { id: 'hp', icon: '❤️', title: '生命强化', desc: '最大生命 +25 并回复' },
      { id: 'dmg', icon: '⚔️', title: '杀意', desc: '全武器伤害 +20%' },
      { id: 'rate', icon: '⏱️', title: '急速', desc: '攻击频率 +18%' },
      { id: 'spd', icon: '🥾', title: '疾风之靴', desc: '移动速度 +14%' },
      { id: 'proj', icon: '✳️', title: '多重投射', desc: '弹丸数量 +1' },
      { id: 'pierce', icon: '➤', title: '贯穿', desc: '子弹穿透 +1' },
      { id: 'pickup', icon: '🧲', title: '磁石', desc: '拾取范围 +45%' },
      { id: 'crit', icon: '✦', title: '致命', desc: '暴击率 +8%' },
      { id: 'regen', icon: '✚', title: '再生', desc: '每秒回复 +1.5' },
    ];
    pool.push(...stat);
    // shuffle, take 3
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
    return pool.slice(0, 3);
  }

  private weaponDesc(id: WeaponId): string {
    const d: Record<WeaponId, string> = {
      flame: '朝准星速射 · 灼烧',
      scatter: '扇形散射 · 强力击退',
      frost: '自动索敌 · 减速穿透',
      chain: '自动索敌 · 闪电跳跃',
      orbit: '环绕飞刃 · 近身绞杀',
      rail: '蓄力轨道炮 · 穿透重击',
    };
    return d[id];
  }

  private applyUpgrade(id: string): void {
    if (id.startsWith('wnew:')) {
      const wid = id.slice(5) as WeaponId;
      this.weapons.set(wid, { cfg: WEAPONS[wid], level: 1, cd: 0 });
      if (wid === 'orbit') this.rebuildBlades();
      this.hud.banner('获得 ' + WEAPONS[wid].name + ' ' + WEAPONS[wid].icon);
      return;
    }
    if (id.startsWith('wlvl:')) {
      const wid = id.slice(5) as WeaponId;
      const ow = this.weapons.get(wid); if (ow) { ow.level++; if (wid === 'orbit') this.rebuildBlades(); }
      return;
    }
    const s = this.stats;
    switch (id) {
      case 'hp': s.maxHp += 25; s.hp = Math.min(s.maxHp, s.hp + 25); break;
      case 'dmg': s.damageMult *= 1.2; break;
      case 'rate': s.fireRateMult *= 1.18; break;
      case 'spd': s.moveSpeed *= 1.14; break;
      case 'proj': s.projBonus += 1; if (this.weapons.has('orbit')) this.rebuildBlades(); break;
      case 'pierce': s.pierceBonus += 1; break;
      case 'pickup': s.pickupRange *= 1.45; break;
      case 'crit': s.crit += 0.08; break;
      case 'regen': s.regen += 1.5; break;
    }
  }

  private refreshHud(): void {
    this.hud.setHp(this.stats.hp, this.stats.maxHp);
    this.hud.setXp(this.xp, this.xpNext, this.level);
    this.hud.setStats({ time: this.time, kills: this.kills, score: this.score, enemies: this.enemies.length });
    this.hud.setWeapons([...this.weapons.values()].map((o) => ({ icon: o.cfg.icon, level: o.level })));
  }
}
