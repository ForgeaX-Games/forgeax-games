// Hellforge skills — the witch's active-cast kit (original names; ARPG-style
// elemental slots, no direct D2 borrowings).
//
// Design contract (PLAY_EXPERIENCE.md §Combat): every hit comes from an
// explicit cast — no auto-attack. press key → instant projectile → attack
// clip plays once → cooldown → ready. Mana gates slot variety.
//
// Slots (unlock by level so early play stays readable):
//   1 熔火弹 Magma Bolt L1 — mid damage + small AoE splash
//   2 霜牙   Frost Fang L2 — pierces, slows
//   3 电弧涌 Arc Surge  L3 — 3 erratic lightning bolts
//   4 影踏   Shadowstep L4 — short blink toward the aim point
//
// Projectiles are cow-survivor-style: invisible root entity + lowpoly
// ChildOf parts, integrated manually, distance hit-tests vs monsters (no
// physics). Every despawn walks root + parts — ChildOf does NOT cascade.

import {
  Transform, MeshFilter, MeshRenderer, ChildOf, Materials,
  quat,
  type MaterialAsset,
} from '@forgeax/engine-runtime';
import { HANDLE_CUBE, HANDLE_SPHERE } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { Handle } from '@forgeax/engine-types';

import type { FxSystem, MatHandle } from './fx';
import type { Monster, MonsterManager } from './monsters';
import { MONSTERS } from './monsters';
import type { PlayerStats } from './state';

export type SkillId = 'magma' | 'frost' | 'arc' | 'blink';

export interface SkillDef {
  id: SkillId;
  name: string;
  icon: string;
  desc: string;
  manaCost: number;
  cooldown: number;
  unlockLevel: number;
  // projectile stats (teleport has none)
  damage?: number;
  speed?: number;
  life?: number;
  count?: number;          // bolts per cast (charged bolt = 3)
  aoeRadius?: number;      // splash on hit
  slowSec?: number;
  knockback?: number;      // impulse (m/s) applied along the flight direction
  pierce?: boolean;
  erratic?: boolean;       // charged-bolt wander
  blinkRange?: number;     // teleport
}

export const SKILLS: SkillDef[] = [
  {
    id: 'magma', name: '熔火弹', icon: '🔥',
    desc: '发射一枚熔火弹，命中小范围溅射',
    manaCost: 6, cooldown: 0.45, unlockLevel: 1,
    damage: 16, speed: 15, life: 1.5, aoeRadius: 1.7, knockback: 4.5,
  },
  {
    id: 'frost', name: '霜牙', icon: '❄️',
    desc: '穿透冰箭，命中减速 2.2 秒',
    manaCost: 7, cooldown: 0.6, unlockLevel: 2,
    damage: 11, speed: 19, life: 1.2, slowSec: 2.2, pierce: true, knockback: 2.4,
  },
  {
    id: 'arc', name: '电弧涌', icon: '⚡',
    desc: '释放 3 道游走的闪电',
    manaCost: 9, cooldown: 0.8, unlockLevel: 3,
    damage: 8, speed: 10, life: 1.6, count: 3, erratic: true, knockback: 3.0,
  },
  {
    id: 'blink', name: '影踏', icon: '🌀',
    desc: '向目标方向瞬移（影踏步）',
    manaCost: 12, cooldown: 3.0, unlockLevel: 4,
    blinkRange: 6.5,
  },
];

interface Projectile {
  e: EntityHandle;
  skill: SkillDef;
  /** Rolled damage (base × equipment dmgMul, frozen at cast time). */
  damage: number;
  x: number; y: number; z: number;
  dx: number; dz: number;
  age: number;
  jitterT: number;         // next erratic-steer time
  hits: Set<Monster>;
  parts: EntityHandle[];
}

type PartBlueprint = {
  shape: 'cube' | 'sphere';
  px: number; py: number; pz: number;
  sx: number; sy: number; sz: number;
  rotY?: number;
  mat: 'main' | 'accent';
};

// Local +Z = flight direction (root yaw carries it).
const VISUALS: Partial<Record<SkillId, PartBlueprint[]>> = {
  magma: [
    { shape: 'sphere', px: 0, py: 0, pz: 0, sx: 0.5, sy: 0.5, sz: 0.5, mat: 'main' },
  ],
  frost: [
    { shape: 'cube', px: 0, py: 0, pz: 0,     sx: 0.13, sy: 0.13, sz: 0.55, mat: 'main' },
    { shape: 'cube', px: 0, py: 0, pz: 0.30,  sx: 0.08, sy: 0.08, sz: 0.18, mat: 'accent' },
    { shape: 'cube', px: 0, py: 0, pz: -0.24, sx: 0.18, sy: 0.04, sz: 0.10, mat: 'accent' },
  ],
  arc: [
    { shape: 'cube', px:  0.10, py: 0.05,  pz:  0.30, sx: 0.07, sy: 0.07, sz: 0.42, mat: 'main', rotY: 0.5 },
    { shape: 'cube', px:  0.00, py: 0.00,  pz:  0.02, sx: 0.07, sy: 0.07, sz: 0.36, mat: 'main', rotY: -0.6 },
    { shape: 'cube', px: -0.10, py: -0.05, pz: -0.24, sx: 0.07, sy: 0.07, sz: 0.42, mat: 'main', rotY: 0.5 },
    { shape: 'cube', px:  0.05, py: 0.03,  pz:  0.14, sx: 0.11, sy: 0.11, sz: 0.11, mat: 'accent' },
  ],
};

export type CastResult = 'ok' | 'cooldown' | 'mana' | 'locked' | 'dead';

export interface SkillHooks {
  /** Teleport asks main.ts to move the player (main owns walkability). */
  tryBlink(dirX: number, dirZ: number, range: number): boolean;
  /** A projectile damaged a monster (for float text / shake / sfx). */
  onHit(x: number, y: number, z: number, damage: number, killed: boolean, crit: boolean): void;
}

/** Base crit — equipment affixes add on top (skills.mods). */
const CRIT_CHANCE = 0.08;
const CRIT_MUL = 1.6;

export class SkillSystem {
  private projectiles: Projectile[] = [];
  private mats = new Map<SkillId, { main: MatHandle; accent: MatHandle }>();
  /** Cooldown remaining per skill index (HUD reads this). */
  readonly cooldowns: number[] = SKILLS.map(() => 0);
  /** Equipment-driven modifiers (main.ts recomputes on equip change).
   *  dmgMul is global; fire/frost/arc multiply their own skill only;
   *  critChance/critMul ADD to the base crit numbers. */
  mods = { dmgMul: 1, cdrMul: 1, fireMul: 1, frostMul: 1, arcMul: 1, critChance: 0, critMul: 0 };

  constructor(private world: World, private fx: FxSystem, private hooks: SkillHooks) {
    const mk = (color: [number, number, number, number], emissive: [number, number, number], i: number) =>
      world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
        baseColor: color, roughness: 0.35, metallic: 0.1,
        emissive, emissiveIntensity: i,
      }));
    // Fire Bolt body prefers the custom living-flame shader; falls back to
    // plain emissive when the shader registry is unavailable (Edit runtime).
    const fireMain = fx.fireBoltMaterial() ?? mk([1, 0.30, 0.06, 1], [1, 0.28, 0.05], 1.2);
    this.mats.set('magma', { main: fireMain, accent: mk([1, 0.45, 0.10, 1], [1, 0.40, 0.08], 0.8) });
    this.mats.set('frost', { main: mk([0.40, 0.75, 1, 1], [0.30, 0.60, 1], 1.2), accent: mk([0.55, 0.85, 1, 1], [0.45, 0.78, 1], 0.9) });
    this.mats.set('arc', { main: mk([0.85, 0.65, 1, 1], [0.70, 0.50, 1], 1.8), accent: mk([0.60, 0.35, 1, 1], [0.55, 0.30, 1], 1.2) });
  }

  unlocked(idx: number, level: number): boolean {
    const def = SKILLS[idx];
    return !!def && level >= def.unlockLevel;
  }

  /**
   * Cast slot `idx` from (ox, oz) toward unit aim (aimX, aimZ).
   * Deducts mana + starts the cooldown on success; the caller plays the
   * attack clip and turns the witch.
   */
  cast(idx: number, ox: number, oz: number, aimX: number, aimZ: number, player: PlayerStats): CastResult {
    const def = SKILLS[idx];
    if (!def) return 'locked';
    if (player.dead) return 'dead';
    if (player.level < def.unlockLevel) return 'locked';
    if (this.cooldowns[idx]! > 0) return 'cooldown';
    if (player.mana < def.manaCost) return 'mana';

    if (def.id === 'blink') {
      if (!this.hooks.tryBlink(aimX, aimZ, def.blinkRange!)) return 'cooldown';
      player.mana -= def.manaCost;
      this.cooldowns[idx] = def.cooldown * this.mods.cdrMul;
      return 'ok';
    }

    player.mana -= def.manaCost;
    this.cooldowns[idx] = def.cooldown * this.mods.cdrMul;
    // Muzzle flash at the casting hand.
    const fxColor = def.id === 'magma' ? 'fire' : def.id === 'frost' ? 'ice' : 'lightning';
    this.fx.pop(ox + aimX * 0.7, 1.0, oz + aimZ * 0.7, fxColor, 0.22);
    const count = def.count ?? 1;
    for (let i = 0; i < count; i++) {
      // Charged bolt fans out slightly; single bolts fly straight.
      const spread = count > 1 ? (i / (count - 1) - 0.5) * 0.5 : 0;
      const cos = Math.cos(spread), sin = Math.sin(spread);
      const dx = aimX * cos - aimZ * sin;
      const dz = aimX * sin + aimZ * cos;
      this.spawnProjectile(def, ox + dx * 0.6, oz + dz * 0.6, dx, dz);
    }
    return 'ok';
  }

  private spawnProjectile(def: SkillDef, x: number, z: number, dx: number, dz: number): void {
    const y = 1.0;
    const yaw = Math.atan2(dx, dz);
    const q = quat.eulerY(yaw);
    const rootRes = this.world.spawn(
      { component: Transform, data: {
        pos: [x, y, z],
        quat: [q[0]!, q[1]!, q[2]!, q[3]!],
        scale: [1, 1, 1],
      } },
    );
    if (!rootRes.ok) return;
    const root = rootRes.value as EntityHandle;
    const pair = this.mats.get(def.id)!;
    const parts: EntityHandle[] = [];
    for (const p of VISUALS[def.id] ?? []) {
      const tform: { pos: number[]; scale: number[]; quat?: number[] } = {
        pos: [p.px, p.py, p.pz],
        scale: [p.sx, p.sy, p.sz],
      };
      if (p.rotY !== undefined) {
        const pq = quat.eulerY(p.rotY);
        tform.quat = [pq[0]!, pq[1]!, pq[2]!, pq[3]!];
      }
      const partRes = this.world.spawn(
        { component: Transform, data: tform },
        { component: MeshFilter, data: { assetHandle: p.shape === 'cube' ? HANDLE_CUBE : HANDLE_SPHERE } },
        { component: MeshRenderer, data: { materials: [p.mat === 'main' ? pair.main : pair.accent] } },
        { component: ChildOf, data: { parent: root } },
      );
      if (partRes.ok) parts.push(partRes.value as EntityHandle);
    }
    const elemMul = def.id === 'magma' ? this.mods.fireMul : def.id === 'frost' ? this.mods.frostMul : this.mods.arcMul;
    this.projectiles.push({
      e: root, skill: def, damage: (def.damage ?? 0) * this.mods.dmgMul * elemMul,
      x, y, z, dx, dz,
      age: 0, jitterT: 0.12, hits: new Set(), parts,
    });
  }

  /** Advance projectiles + hit-test vs monsters. */
  tick(dt: number, monsters: MonsterManager): void {
    for (let i = 0; i < this.cooldowns.length; i++) {
      if (this.cooldowns[i]! > 0) this.cooldowns[i] = Math.max(0, this.cooldowns[i]! - dt);
    }
    const kill = (p: Projectile) => {
      this.world.despawn(p.e);
      for (const pe of p.parts) this.world.despawn(pe);
      p.parts.length = 0;
    };
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      const def = p.skill;
      p.age += dt;
      if (p.age > (def.life ?? 1)) {
        kill(p);
        this.projectiles.splice(i, 1);
        continue;
      }
      // Charged bolt wanders: random small steering every ~0.12 s.
      if (def.erratic) {
        p.jitterT -= dt;
        if (p.jitterT <= 0) {
          p.jitterT = 0.10 + Math.random() * 0.08;
          const a = (Math.random() - 0.5) * 0.9;
          const cos = Math.cos(a), sin = Math.sin(a);
          const ndx = p.dx * cos - p.dz * sin;
          p.dz = p.dx * sin + p.dz * cos;
          p.dx = ndx;
        }
      }
      p.x += p.dx * (def.speed ?? 10) * dt;
      p.z += p.dz * (def.speed ?? 10) * dt;

      // Hit-test: nearest monster within its body radius + bolt radius.
      let dead = false;
      for (const m of monsters.monsters) {
        if (p.hits.has(m)) continue;
        const mdx = m.x - p.x, mdz = m.z - p.z;
        const r = MONSTERS[m.kind].radius + 0.35;
        if (mdx * mdx + mdz * mdz > r * r) continue;
        p.hits.add(m);
        // Crit roll per target; knockback rides the flight direction.
        const crit = Math.random() < CRIT_CHANCE + this.mods.critChance;
        const dmg = p.damage * (crit ? CRIT_MUL + this.mods.critMul : 1);
        const kb = (def.knockback ?? 0) * (crit ? 1.4 : 1);
        const killed = monsters.damage(m, dmg, def.slowSec ?? 0, p.dx, p.dz, kb);
        this.hooks.onHit(m.x, 1.0, m.z, dmg, killed, crit);
        // Impact flash + debris — the pop is the punch, the burst is dressing.
        if (def.id === 'magma') {
          this.fx.pop(p.x, p.y, p.z, 'fire', crit ? 0.65 : 0.5);
          this.fx.burst(p.x, p.y, p.z, 'fire', 8, 3.8);
        } else if (def.id === 'frost') {
          this.fx.pop(p.x, p.y, p.z, 'ice', crit ? 0.5 : 0.38);
          this.fx.burst(p.x, p.y, p.z, 'ice', 5, 2.6);
        } else {
          this.fx.pop(p.x, p.y, p.z, 'lightning', crit ? 0.55 : 0.42);
          this.fx.burst(p.x, p.y, p.z, 'lightning', 5, 3.0);
        }
        // AoE splash (magma bolt) — damage every other monster in radius,
        // knocked radially away from the impact point.
        if (def.aoeRadius) {
          for (const m2 of [...monsters.monsters]) {
            if (m2 === m || p.hits.has(m2)) continue;
            const adx = m2.x - p.x, adz = m2.z - p.z;
            const ad2 = adx * adx + adz * adz;
            if (ad2 < def.aoeRadius * def.aoeRadius) {
              p.hits.add(m2);
              const ad = Math.sqrt(ad2) || 1;
              const k2 = monsters.damage(m2, dmg * 0.6, 0, adx / ad, adz / ad, (def.knockback ?? 0) * 0.7);
              this.hooks.onHit(m2.x, 1.0, m2.z, dmg * 0.6, k2, false);
            }
          }
        }
        if (!def.pierce) { dead = true; break; }
      }
      if (dead) {
        kill(p);
        this.projectiles.splice(i, 1);
        continue;
      }
      // Face the (possibly steered) travel direction.
      const yaw = Math.atan2(p.dx, p.dz);
      const h = yaw * 0.5;
      this.world.set(p.e, Transform, {
        pos: [p.x, p.y, p.z],
        quat: [0, Math.sin(h), 0, Math.cos(h)],
        scale: [1, 1, 1],
      });
    }
  }

  activeCount(): number { return this.projectiles.length; }
}
