// Hellforge skills — the witch's active-cast kit (original names; ARPG-style
// elemental slots, no direct D2 borrowings).
//
// Design contract (PLAY_EXPERIENCE.md §Combat): every hit comes from an
// explicit cast — no auto-attack. press key → instant projectile → attack
// clip plays once → cooldown → ready. Mana gates slot variety.
//
// Combat numbers come ONLY from SkillResolver (Spec §5.2). Active identity
// (magma/frost/arc/blink/inferno-nova) is stable; ranks/prereqs live in
// skill-tree.ts. Display metadata (name/icon/desc/unlockLevel) lives here;
// unlockLevel is legacy HUD copy only — cast rights use learned ranks /
// level unlocks (finisher).

import {
  Transform, MeshFilter, MeshRenderer, ChildOf, Materials,
  quat,
  type MaterialAsset,
} from '@forgeax/engine-runtime';
import { HANDLE_CUBE, HANDLE_QUAD, HANDLE_SPHERE } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { Handle } from '@forgeax/engine-types';

import type { ActiveSkillId, SkillNodeId } from './content-ids';
import { isSkillAvailable } from './skill-availability';
import type { FxSystem, MatHandle } from './fx';
import type { Monster, MonsterManager } from './monsters';
import { MONSTERS } from './monsters';
import type { CombatStats } from './combat-stats';
import type { PlayerStats } from './state';
import {
  resolveSkill,
  shatterShardCount,
  type ResolvedSkill,
} from './skill-resolver';
import {
  commitFinisher,
  createFinisherState,
  FINISHER_ID,
  FINISHER_RADIUS_M,
  isFinisherInputLocked,
  tickFinisher,
  type FinisherState,
} from './finisher';

import type { ActiveKitSkillId } from './skill-availability';
export type SkillId = ActiveKitSkillId;
export { SKILL_NODE_BY_ACTIVE, isSkillAvailable } from './skill-availability';
export { ACTIVE_BY_SKILL_NODE } from './skill-tree';
export type { FinisherHooks } from './finisher';

export interface SkillDef {
  id: SkillId;
  name: string;
  /** Icon key resolved by ui-icons.skillIconImg (PNG art) — not a text glyph. */
  icon: string;
  desc: string;
  /**
   * @deprecated Cast rights use learned active-node ranks via isSkillAvailable.
   * Kept for HUD layout slots only — do not gate casts on this field.
   */
  unlockLevel: number;
  /** Derived from resolveSkill() for HUD / tooling; runtime cast re-resolves. */
  manaCost: number;
  cooldown: number;
  damage?: number;
  speed?: number;
  life?: number;
  count?: number;
  aoeRadius?: number;
  splashRatio?: number;
  slowSec?: number;
  slowMagnitude?: number;
  knockback?: number;
  pierceCount?: number;
  erratic?: boolean;
  blinkRange?: number;
  /** Same resolved tooltip lines gameplay numbers use. */
  tooltipLines?: readonly string[];
}

type DisplayMeta = Pick<SkillDef, 'id' | 'name' | 'icon' | 'desc' | 'unlockLevel'>;

const DISPLAY: Record<SkillId, DisplayMeta> = {
  magma: {
    id: 'magma', name: '熔火弹', icon: 'magma',
    desc: '发射一枚熔火弹，命中小范围溅射',
    unlockLevel: 0,
  },
  frost: {
    id: 'frost', name: '霜牙', icon: 'frost',
    desc: '冰箭，命中减速',
    unlockLevel: 0,
  },
  arc: {
    id: 'arc', name: '电弧涌', icon: 'arc',
    desc: '释放游走的闪电',
    unlockLevel: 0,
  },
  blink: {
    id: 'blink', name: '影踏', icon: 'blink',
    desc: '向目标方向瞬移（影踏步）',
    unlockLevel: 0,
  },
  'inferno-nova': {
    id: 'inferno-nova', name: '狱火新星', icon: 'inferno-nova',
    desc: '锁定地面目标，短暂蓄力后引爆狱火新星',
    unlockLevel: 3,
  },
};

function defFromResolved(id: SkillId, r: ResolvedSkill): SkillDef {
  return {
    ...DISPLAY[id],
    manaCost: r.manaCost,
    cooldown: r.cooldown,
    damage: r.damage || undefined,
    speed: r.projectileSpeed || undefined,
    life: r.projectileLifetime || undefined,
    count: r.projectileCount || undefined,
    aoeRadius: r.splashRadius || undefined,
    splashRatio: r.splashRatio || undefined,
    slowSec: r.slowDuration || undefined,
    slowMagnitude: r.slowMagnitude || undefined,
    knockback: r.knockback || undefined,
    pierceCount: r.pierceCount,
    erratic: r.erratic || undefined,
    blinkRange: r.blinkRange || undefined,
    tooltipLines: r.tooltipLines,
  };
}

/** Kit sheet at base ranks — prefer skillDefForRanks() for live tooltips. */
export const SKILLS: SkillDef[] = (
  ['magma', 'frost', 'arc', 'blink', 'inferno-nova'] as const
).map((id) => defFromResolved(id, resolveSkill(id)));

/** Build a SkillDef from the same resolveSkill() data used by combat. */
export function skillDefForRanks(
  id: SkillId,
  skillRanks: Readonly<Partial<Record<SkillNodeId, number>>>,
): SkillDef {
  return defFromResolved(id, resolveSkill(id, { skillRanks }));
}

interface CastRuntime {
  /** Overcharge CDR already applied this cast (seconds). */
  overchargeReduced: number;
  /** True once Phase Echo charge was consumed for this cast. */
  phaseEchoConsumed: boolean;
}

interface Projectile {
  e: EntityHandle;
  resolved: ResolvedSkill;
  skillId: SkillId;
  /** Rolled damage (resolver × equipment dmgMul, frozen at cast time). */
  damage: number;
  x: number; y: number; z: number;
  dx: number; dz: number;
  age: number;
  jitterT: number;
  pierceLeft: number;
  hits: Set<Monster>;
  parts: EntityHandle[];
  cast: CastRuntime;
  /** First valid hit on this projectile already applied Overcharge. */
  overchargeHitDone: boolean;
}

type PartBlueprint = {
  shape: 'cube' | 'sphere';
  px: number; py: number; pz: number;
  sx: number; sy: number; sz: number;
  rotY?: number;
  mat: 'main' | 'accent';
};

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
  tryBlink(dirX: number, dirZ: number, range: number): boolean;
  onHit(x: number, y: number, z: number, damage: number, killed: boolean, crit: boolean): void;
  /**
   * T5 Hero Shot seam — called at finisher commit with target XZ.
   * Presentation only; gameplay damage does not wait on this callback.
   */
  onFinisherHeroShot?(targetXZ: readonly [number, number]): void;
}

/** Combat multipliers supplied from CombatStats — not an independent authority. */
export interface SkillCombatMods {
  dmgMul: number;
  cdrMul: number;
  fireMul: number;
  frostMul: number;
  arcMul: number;
  /** Absolute crit chance (already includes class base + equipment, capped). */
  critChance: number;
  /** Absolute crit damage multiplier. */
  critMultiplier: number;
}

const DEFAULT_COMBAT_MODS: Readonly<SkillCombatMods> = Object.freeze({
  dmgMul: 1,
  cdrMul: 1,
  fireMul: 1,
  frostMul: 1,
  arcMul: 1,
  critChance: 0.05,
  critMultiplier: 1.5,
});

export interface SkillCaster {
  cast(
    skillId: ActiveSkillId,
    aim: readonly [number, number],
    opts?: { groundXZ?: readonly [number, number] },
  ): CastResult;
}

export class SkillSystem {
  private projectiles: Projectile[] = [];
  private mats = new Map<SkillId, { main: MatHandle; accent: MatHandle }>();
  readonly cooldowns: number[];
  /** Frozen snapshot from last applyCombatStats(); not an independent authority. */
  #mods: Readonly<SkillCombatMods> = DEFAULT_COMBAT_MODS;
  /** Phase Echo charge window (performance.now()/1000). */
  #phaseEchoUntil = 0;
  #finisher: FinisherState = createFinisherState();
  #finisherResolved: ResolvedSkill | null = null;
  #telegraph: EntityHandle | null = null;
  #telegraphMat: MatHandle | null = null;
  #telegraphFlatQ: [number, number, number, number] | null = null;

  constructor(private world: World, private fx: FxSystem, private hooks: SkillHooks, private skills: SkillDef[]) {
    this.cooldowns = skills.map(() => 0);
    const mk = (color: [number, number, number, number], emissive: [number, number, number], i: number) =>
      world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
        baseColor: color, roughness: 0.35, metallic: 0.1,
        emissive, emissiveIntensity: i,
      }));
    const fireMain = fx.fireBoltMaterial() ?? mk([1, 0.30, 0.06, 1], [1, 0.28, 0.05], 1.2);
    this.mats.set('magma', { main: fireMain, accent: mk([1, 0.45, 0.10, 1], [1, 0.40, 0.08], 0.8) });
    // Frost Fang: custom crystal shaders when registered; Edit-runtime falls
    // back to the same emissive ice mats used before the quality slice.
    const frost = fx.frostVfx();
    const frostMain = frost?.projectile ?? mk([0.40, 0.75, 1, 1], [0.30, 0.60, 1], 1.2);
    const frostAccent = frost?.impact ?? mk([0.55, 0.85, 1, 1], [0.45, 0.78, 1], 0.9);
    this.mats.set('frost', { main: frostMain, accent: frostAccent });
    this.mats.set('arc', { main: mk([0.85, 0.65, 1, 1], [0.70, 0.50, 1], 1.8), accent: mk([0.60, 0.35, 1, 1], [0.55, 0.30, 1], 1.2) });
    // Finisher telegraph — contact-shadow-style flat quad, fire-tinted (L7: 1 decal).
    const tq = quat.create();
    quat.fromAxisAngle(tq, [1, 0, 0], -Math.PI / 2);
    this.#telegraphFlatQ = [tq[0]!, tq[1]!, tq[2]!, tq[3]!];
    this.#telegraphMat = world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
      baseColor: [1.0, 0.22, 0.05, 0.42],
      roughness: 0.9,
      metallic: 0.0,
      emissive: [1.0, 0.28, 0.06],
      emissiveIntensity: 0.85,
    }));
  }

  /** L5: windup locks move/cast; aftermath does not. */
  isFinisherInputLocked(): boolean {
    return isFinisherInputLocked(this.#finisher);
  }

  finisherPhase(): FinisherState['phase'] {
    return this.#finisher.phase;
  }

  /**
   * Live ground-target preview while finisher is selected (pre-commit).
   * No-op during an active commit (telegraph stays at the committed point).
   */
  updateFinisherPreview(x: number, z: number): void {
    if (this.#finisher.phase !== 'idle') return;
    this.#setTelegraph(x, z, FINISHER_RADIUS_M);
  }

  clearFinisherPreview(): void {
    if (this.#finisher.phase !== 'idle') return;
    this.#clearTelegraph();
  }

  /** Read-only combat multipliers; mutate only via applyCombatStats. */
  get mods(): Readonly<SkillCombatMods> {
    return this.#mods;
  }

  /** Replace cast/hit multipliers from derived CombatStats (sole supplier). */
  applyCombatStats(stats: CombatStats): void {
    this.#mods = Object.freeze({
      dmgMul: stats.globalDamageMul,
      cdrMul: stats.cooldownMul,
      fireMul: stats.fireDamageMul,
      frostMul: stats.frostDamageMul,
      arcMul: stats.arcDamageMul,
      critChance: stats.critChance,
      critMultiplier: stats.critMultiplier,
    });
  }

  indexOf(id: SkillId): number {
    return this.skills.findIndex((s) => s.id === id);
  }

  unlocked(
    idx: number,
    level: number,
    skillRanks: Readonly<Partial<Record<SkillNodeId, number>>> = {},
  ): boolean {
    const def = this.skills[idx];
    return !!def && isSkillAvailable(def, level, skillRanks);
  }

  /**
   * Cast kit index — resolves numbers via SkillResolver then delegates.
   * Prefer SkillCaster.cast(skillId, aim) from gameplay input.
   */
  cast(
    idx: number,
    ox: number,
    oz: number,
    aimX: number,
    aimZ: number,
    player: PlayerStats,
    level: number,
    skillRanks: Readonly<Partial<Record<SkillNodeId, number>>> = {},
  ): CastResult {
    const def = this.skills[idx];
    if (!def) return 'locked';
    const phaseEchoActive = this.#phaseEchoUntil > performance.now() / 1000;
    const resolved = resolveSkill(def.id, { skillRanks, phaseEchoActive });
    return this.castResolved(def.id, ox, oz, aimX, aimZ, player, level, skillRanks, resolved);
  }

  castResolved(
    skillId: SkillId,
    ox: number,
    oz: number,
    aimX: number,
    aimZ: number,
    player: PlayerStats,
    level: number,
    skillRanks: Readonly<Partial<Record<SkillNodeId, number>>>,
    resolved: ResolvedSkill,
    groundXZ?: readonly [number, number],
  ): CastResult {
    const idx = this.indexOf(skillId);
    if (idx < 0) return 'locked';
    const def = this.skills[idx]!;
    if (player.dead) return 'dead';
    // Cast rights: learned active-node rank / level unlock (not unlockLevel alone).
    if (!isSkillAvailable(def, level, skillRanks)) return 'locked';
    if (this.cooldowns[idx]! > 0) return 'cooldown';
    if (player.mana < resolved.manaCost) return 'mana';
    if (this.isFinisherInputLocked()) return 'cooldown';

    if (skillId === 'blink') {
      if (!this.hooks.tryBlink(aimX, aimZ, resolved.blinkRange)) return 'cooldown';
      player.mana -= resolved.manaCost;
      this.cooldowns[idx] = resolved.cooldown * this.mods.cdrMul;
      for (const fx of resolved.onHit) {
        if (fx.kind === 'phase-echo-grant') {
          this.#phaseEchoUntil = performance.now() / 1000 + fx.windowSec;
        }
      }
      return 'ok';
    }

    if (skillId === FINISHER_ID) {
      if (this.#finisher.phase !== 'idle') return 'cooldown';
      // L5: commit target must be walkable-clamped by the caller (main groundAimXZ).
      if (!groundXZ) return 'cooldown';
      const tx = groundXZ[0];
      const tz = groundXZ[1];
      player.mana -= resolved.manaCost;
      this.cooldowns[idx] = resolved.cooldown * this.mods.cdrMul;
      if (resolved.phaseEchoApplied) this.#phaseEchoUntil = 0;
      this.#finisherResolved = resolved;
      this.#finisher = commitFinisher(this.#finisher, [tx, tz], {
        onFinisherHeroShot: (target) => this.hooks.onFinisherHeroShot?.(target),
      });
      this.#setTelegraph(tx, tz, resolved.splashRadius || FINISHER_RADIUS_M);
      this.fx.pop(ox + aimX * 0.5, 1.0, oz + aimZ * 0.5, 'fire', 0.28);
      return 'ok';
    }

    player.mana -= resolved.manaCost;
    this.cooldowns[idx] = resolved.cooldown * this.mods.cdrMul;
    if (resolved.phaseEchoApplied) {
      this.#phaseEchoUntil = 0;
    }
    const fxColor = skillId === 'magma' ? 'fire' : skillId === 'frost' ? 'ice' : 'lightning';
    if (skillId === 'frost') {
      this.fx.frostCastCue(ox + aimX * 0.7, 1.0, oz + aimZ * 0.7);
    } else {
      this.fx.pop(ox + aimX * 0.7, 1.0, oz + aimZ * 0.7, fxColor, 0.22);
    }
    const cast: CastRuntime = { overchargeReduced: 0, phaseEchoConsumed: resolved.phaseEchoApplied };
    const count = Math.max(1, resolved.projectileCount);
    for (let i = 0; i < count; i++) {
      const spread = count > 1 ? (i / (count - 1) - 0.5) * 0.5 : 0;
      const cos = Math.cos(spread), sin = Math.sin(spread);
      const dx = aimX * cos - aimZ * sin;
      const dz = aimX * sin + aimZ * cos;
      this.spawnProjectile(skillId, resolved, ox + dx * 0.6, oz + dz * 0.6, dx, dz, cast);
    }
    return 'ok';
  }

  private spawnProjectile(
    skillId: SkillId,
    resolved: ResolvedSkill,
    x: number,
    z: number,
    dx: number,
    dz: number,
    cast: CastRuntime,
  ): void {
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
    const pair = this.mats.get(skillId)!;
    const parts: EntityHandle[] = [];
    for (const p of VISUALS[skillId] ?? []) {
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
    const elemMul = skillId === 'magma' ? this.mods.fireMul : skillId === 'frost' ? this.mods.frostMul : this.mods.arcMul;
    this.projectiles.push({
      e: root, resolved, skillId,
      damage: resolved.damage * this.mods.dmgMul * elemMul,
      x, y, z, dx, dz,
      age: 0, jitterT: 0.12,
      pierceLeft: resolved.pierceCount,
      hits: new Set(), parts,
      cast,
      overchargeHitDone: false,
    });
  }

  /** Apply tree onHit effects. Shatter/Hellfire never recurse into skill effects. */
  private applyOnHit(
    p: Projectile,
    m: Monster,
    directDmg: number,
    crit: boolean,
    monsters: MonsterManager,
  ): void {
    for (const fx of p.resolved.onHit) {
      if (fx.kind === 'scorch') {
        monsters.applyBurn(m, directDmg * fx.fraction, fx.durationSec);
      } else if (fx.kind === 'hellfire-explosion' && crit) {
        const boom = directDmg * fx.damageRatio;
        for (const m2 of [...monsters.monsters]) {
          if (m2 === m || p.hits.has(m2)) continue;
          const adx = m2.x - m.x, adz = m2.z - m.z;
          if (adx * adx + adz * adz > fx.radius * fx.radius) continue;
          p.hits.add(m2);
          const ad = Math.hypot(adx, adz) || 1;
          const k2 = monsters.damage(m2, boom, 0, adx / ad, adz / ad, (p.resolved.knockback ?? 0) * 0.5);
          this.hooks.onHit(m2.x, 1.0, m2.z, boom, k2, false);
        }
        this.fx.pop(m.x, 1.0, m.z, 'fire', 0.8);
        this.fx.burst(m.x, 1.0, m.z, 'fire', 12, 4.5);
      } else if (fx.kind === 'shatter-shards') {
        // Shatter VFX only when the learned node resolved shards (count > 0).
        const shards = shatterShardCount(p.resolved);
        if (shards > 0) this.fx.shatterFragments(m.x, 1.0, m.z, shards);
        const shardDmg = directDmg * fx.damageRatio;
        const candidates = monsters.monsters
          .filter((m2) => m2 !== m)
          .map((m2) => {
            const dx = m2.x - m.x, dz = m2.z - m.z;
            return { m2, d2: dx * dx + dz * dz };
          })
          .filter((c) => c.d2 <= fx.rangeM * fx.rangeM)
          .sort((a, b) => a.d2 - b.d2)
          .slice(0, fx.count);
        for (const { m2 } of candidates) {
          const adx = m2.x - m.x, adz = m2.z - m.z;
          const ad = Math.hypot(adx, adz) || 1;
          const k2 = monsters.damage(m2, shardDmg, 0, adx / ad, adz / ad, 1.2);
          this.hooks.onHit(m2.x, 1.0, m2.z, shardDmg, k2, false);
          this.fx.pop(m2.x, 1.0, m2.z, 'ice', 0.28);
        }
      } else if (fx.kind === 'overcharge-cdr' && !p.overchargeHitDone) {
        p.overchargeHitDone = true;
        const room = fx.capPerCastSec - p.cast.overchargeReduced;
        if (room > 0) {
          const reduce = Math.min(fx.perHitSec, room);
          p.cast.overchargeReduced += reduce;
          const blinkIdx = this.indexOf('blink');
          if (blinkIdx >= 0) {
            this.cooldowns[blinkIdx] = Math.max(0, this.cooldowns[blinkIdx]! - reduce);
          }
        }
      }
    }
  }

  tick(dt: number, monsters: MonsterManager): void {
    for (let i = 0; i < this.cooldowns.length; i++) {
      if (this.cooldowns[i]! > 0) this.cooldowns[i] = Math.max(0, this.cooldowns[i]! - dt);
    }
    this.#tickFinisher(dt, monsters);
    const kill = (p: Projectile) => {
      this.world.despawn(p.e);
      for (const pe of p.parts) this.world.despawn(pe);
      p.parts.length = 0;
    };
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      const r = p.resolved;
      p.age += dt;
      if (p.age > (r.projectileLifetime || 1)) {
        kill(p);
        this.projectiles.splice(i, 1);
        continue;
      }
      if (r.erratic) {
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
      p.x += p.dx * (r.projectileSpeed || 10) * dt;
      p.z += p.dz * (r.projectileSpeed || 10) * dt;

      let dead = false;
      for (const m of monsters.monsters) {
        if (p.hits.has(m)) continue;
        const mdx = m.x - p.x, mdz = m.z - p.z;
        const hitR = MONSTERS[m.kind].radius + 0.35;
        if (mdx * mdx + mdz * mdz > hitR * hitR) continue;
        p.hits.add(m);
        // Winter's Grasp: check slow BEFORE this hit's damage/slow resolves.
        const winterMul = r.slowedTargetMul > 1 && monsters.isSlowed(m) ? r.slowedTargetMul : 1;
        const crit = Math.random() < this.mods.critChance;
        const dmg = p.damage * winterMul * (crit ? this.mods.critMultiplier : 1);
        const kb = (r.knockback ?? 0) * (crit ? 1.4 : 1);
        const killed = monsters.damage(m, dmg, r.slowDuration, p.dx, p.dz, kb);
        this.hooks.onHit(m.x, 1.0, m.z, dmg, killed, crit);
        this.applyOnHit(p, m, dmg, crit, monsters);
        if (p.skillId === 'magma') {
          this.fx.pop(p.x, p.y, p.z, 'fire', crit ? 0.65 : 0.5);
          this.fx.burst(p.x, p.y, p.z, 'fire', 8, 3.8);
        } else if (p.skillId === 'frost') {
          // Collision-aligned impact (shader mats shared via frostVfx();
          // particle pop/burst carry the readable flash in Edit fallback).
          this.fx.frostImpact(p.x, p.y, p.z, crit);
        } else {
          this.fx.pop(p.x, p.y, p.z, 'lightning', crit ? 0.55 : 0.42);
          this.fx.burst(p.x, p.y, p.z, 'lightning', 5, 3.0);
        }
        if (r.splashRadius > 0) {
          const splashMul = r.splashRatio > 0 ? r.splashRatio : 0.5;
          for (const m2 of [...monsters.monsters]) {
            if (m2 === m || p.hits.has(m2)) continue;
            const adx = m2.x - p.x, adz = m2.z - p.z;
            const ad2 = adx * adx + adz * adz;
            if (ad2 < r.splashRadius * r.splashRadius) {
              p.hits.add(m2);
              const ad = Math.sqrt(ad2) || 1;
              const k2 = monsters.damage(m2, dmg * splashMul, 0, adx / ad, adz / ad, (r.knockback ?? 0) * 0.7);
              this.hooks.onHit(m2.x, 1.0, m2.z, dmg * splashMul, k2, false);
            }
          }
        }
        if (p.pierceLeft > 0) {
          p.pierceLeft -= 1;
        } else {
          dead = true;
          break;
        }
      }
      if (dead) {
        kill(p);
        this.projectiles.splice(i, 1);
        continue;
      }
      const yaw = Math.atan2(p.dx, p.dz);
      const h = yaw * 0.5;
      this.world.set(p.e, Transform, {
        pos: [p.x, p.y, p.z],
        quat: [0, Math.sin(h), 0, Math.cos(h)],
        scale: [1, 1, 1],
      });
    }
    // Keep __hf / lifecycle projectile count in sync after expiry & hits.
    this.fx.noteProjectiles(this.projectiles.length);
  }

  activeCount(): number { return this.projectiles.length; }

  isPhaseEchoActive(): boolean {
    return this.#phaseEchoUntil > performance.now() / 1000;
  }

  /** Clear projectiles + cooldowns + Phase Echo + finisher (combat-run reset seam). */
  clearProjectilesAndCooldowns(): void {
    for (const p of this.projectiles) {
      this.world.despawn(p.e);
      for (const pe of p.parts) this.world.despawn(pe);
    }
    this.projectiles.length = 0;
    this.fx.noteProjectiles(0);
    for (let i = 0; i < this.cooldowns.length; i++) this.cooldowns[i] = 0;
    this.#phaseEchoUntil = 0;
    this.#finisher = createFinisherState();
    this.#finisherResolved = null;
    this.#clearTelegraph();
  }

  #setTelegraph(x: number, z: number, radius: number): void {
    if (!this.#telegraphMat || !this.#telegraphFlatQ) return;
    const scale = radius * 2;
    const q = this.#telegraphFlatQ;
    if (this.#telegraph) {
      this.world.set(this.#telegraph, Transform, {
        pos: [x, 0.03, z],
        quat: q,
        scale: [scale, scale, scale],
      });
      return;
    }
    const spawned = this.world.spawn(
      {
        component: Transform,
        data: { pos: [x, 0.03, z], quat: q, scale: [scale, scale, scale] },
      },
      { component: MeshFilter, data: { assetHandle: HANDLE_QUAD } },
      { component: MeshRenderer, data: { materials: [this.#telegraphMat] } },
    );
    if (spawned.ok) this.#telegraph = spawned.value as EntityHandle;
  }

  #clearTelegraph(): void {
    if (!this.#telegraph) return;
    try { this.world.despawn(this.#telegraph); } catch { /* */ }
    this.#telegraph = null;
  }

  #tickFinisher(dt: number, monsters: MonsterManager): void {
    if (this.#finisher.phase === 'idle') return;
    this.#finisher = tickFinisher(this.#finisher, dt, {
      // Apply inside the hook so a large dt that ends the cast still hits the
      // committed target (state may reset to idle in the same tick).
      onDamage: (targetXZ) => this.#applyFinisherDamageAt(monsters, targetXZ[0], targetXZ[1]),
    });
    if (this.#finisher.phase === 'idle') {
      this.#finisherResolved = null;
      this.#clearTelegraph();
    } else {
      this.#setTelegraph(
        this.#finisher.targetX,
        this.#finisher.targetZ,
        this.#finisherResolved?.splashRadius || FINISHER_RADIUS_M,
      );
    }
  }

  /** Big fire AOE + scorch burn at the fixed damage timestamp (L5). */
  #applyFinisherDamageAt(monsters: MonsterManager, tx: number, tz: number): void {
    const resolved = this.#finisherResolved;
    if (!resolved) return;
    const radius = resolved.splashRadius || FINISHER_RADIUS_M;
    const dmg = resolved.damage * this.mods.dmgMul * this.mods.fireMul;
    const crit = Math.random() < this.mods.critChance;
    const hitDmg = dmg * (crit ? this.mods.critMultiplier : 1);
    // L7 budgets: 1 pop + 1 burst (~10) + 1 rise — ≤3 emitters, modest particles.
    this.fx.pop(tx, 1.0, tz, 'fire', 1.1);
    this.fx.burst(tx, 1.0, tz, 'fire', 10, 4.2);
    this.fx.rise(tx, 0.2, tz, 'fire', 6, radius * 0.35);
    const proxy: Projectile = {
      e: 0 as unknown as EntityHandle,
      resolved,
      skillId: FINISHER_ID,
      damage: hitDmg,
      x: tx, y: 1, z: tz,
      dx: 0, dz: 0,
      age: 0, jitterT: 0,
      pierceLeft: 0,
      hits: new Set(),
      parts: [],
      cast: { overchargeReduced: 0, phaseEchoConsumed: resolved.phaseEchoApplied },
      overchargeHitDone: false,
    };
    for (const m of [...monsters.monsters]) {
      const adx = m.x - tx;
      const adz = m.z - tz;
      if (adx * adx + adz * adz > radius * radius) continue;
      const ad = Math.hypot(adx, adz) || 1;
      const killed = monsters.damage(m, hitDmg, 0, adx / ad, adz / ad, resolved.knockback);
      this.hooks.onHit(m.x, 1.0, m.z, hitDmg, killed, crit);
      this.applyOnHit(proxy, m, hitDmg, crit, monsters);
    }
  }
}

export function createSkillCaster(deps: {
  skills: SkillSystem;
  getOrigin: () => readonly [number, number];
  getPlayer: () => PlayerStats;
  getLevel: () => number;
  getSkillRanks: () => Readonly<Partial<Record<SkillNodeId, number>>>;
  /** Optional ground aim for ground-target skills (finisher). */
  getGroundXZ?: () => readonly [number, number] | null;
}): SkillCaster {
  return {
    cast(skillId, aim, opts) {
      const [ox, oz] = deps.getOrigin();
      const len = Math.hypot(aim[0], aim[1]);
      const ax = len > 1e-6 ? aim[0] / len : 0;
      const az = len > 1e-6 ? aim[1] / len : 1;
      const ranks = deps.getSkillRanks();
      const resolved = resolveSkill(skillId, {
        skillRanks: ranks,
        phaseEchoActive: deps.skills.isPhaseEchoActive(),
      });
      let groundXZ = opts?.groundXZ;
      if (!groundXZ && skillId === FINISHER_ID) {
        groundXZ = deps.getGroundXZ?.() ?? undefined;
      }
      return deps.skills.castResolved(
        skillId,
        ox,
        oz,
        ax,
        az,
        deps.getPlayer(),
        deps.getLevel(),
        ranks,
        resolved,
        groundXZ,
      );
    },
  };
}
