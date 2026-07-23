// SkillResolver — sole owner of active-skill numbers (Spec §5.2 + §7.2).
// Tree ranks fold in here; SkillSystem must not keep a parallel constants table.

import type { ActiveSkillId, SkillNodeId } from './content-ids';

export interface ResolvedActiveSkill {
  damage: number;
  manaCost: number;
  cooldown: number;
  projectileSpeed: number;
  projectileLifetime: number;
  projectileCount: number;
  splashRadius: number;
  splashRatio: number;
  slowMagnitude: number;
  slowDuration: number;
  /** Frost pierce is a count (0 base; Piercing Ice → 1). */
  pierceCount: number;
  blinkRange: number;
  erratic: boolean;
  knockback: number;
}

/**
 * On-hit / cast-side effects from the same resolve pass as damage.
 * Scorch/Shatter/Hellfire ratios apply to the direct hit at impact time.
 */
export type SkillEffect =
  | {
      readonly kind: 'scorch';
      readonly fraction: number;
      readonly durationSec: number;
    }
  | {
      readonly kind: 'hellfire-explosion';
      readonly damageRatio: number;
      readonly radius: number;
    }
  | {
      readonly kind: 'shatter-shards';
      readonly count: number;
      readonly damageRatio: number;
      readonly rangeM: number;
    }
  | {
      readonly kind: 'overcharge-cdr';
      readonly perHitSec: number;
      readonly capPerCastSec: number;
    }
  | {
      readonly kind: 'phase-echo-grant';
      readonly windowSec: number;
      readonly damageMul: number;
    };

export interface ResolvedSkill extends ResolvedActiveSkill {
  readonly onHit: readonly SkillEffect[];
  /** Winter's Grasp multiplier to apply at hit when the target is slowed. */
  readonly slowedTargetMul: number;
  /** Phase Echo multiplier already baked into damage when charge was active. */
  readonly phaseEchoApplied: boolean;
  /** Display lines from the same numbers gameplay uses. */
  readonly tooltipLines: readonly string[];
}

export interface SkillResolveContext {
  readonly skillRanks: Readonly<Partial<Record<SkillNodeId, number>>>;
  /** Winter's Grasp: target already slowed before this hit resolves. */
  readonly targetSlowed?: boolean;
  /** Phase Echo charge from a recent Phase Step. */
  readonly phaseEchoActive?: boolean;
}

/** Spec §5.2 initial active-skill base data (shared table — do not duplicate). */
const BASE: Readonly<Record<ActiveSkillId, ResolvedActiveSkill>> = {
  magma: {
    damage: 16,
    manaCost: 6,
    cooldown: 0.45,
    projectileSpeed: 15,
    projectileLifetime: 1.5,
    projectileCount: 1,
    splashRadius: 1.7,
    splashRatio: 0.5,
    slowMagnitude: 0,
    slowDuration: 0,
    pierceCount: 0,
    blinkRange: 0,
    erratic: false,
    knockback: 4.5,
  },
  frost: {
    damage: 11,
    manaCost: 7,
    cooldown: 0.6,
    projectileSpeed: 19,
    projectileLifetime: 1.2,
    projectileCount: 1,
    splashRadius: 0,
    splashRatio: 0,
    slowMagnitude: 0.35,
    slowDuration: 2.2,
    pierceCount: 0,
    blinkRange: 0,
    erratic: false,
    knockback: 2.4,
  },
  arc: {
    damage: 8,
    manaCost: 9,
    cooldown: 0.8,
    projectileSpeed: 10,
    projectileLifetime: 1.6,
    projectileCount: 3,
    splashRadius: 0,
    splashRatio: 0,
    slowMagnitude: 0,
    slowDuration: 0,
    pierceCount: 0,
    blinkRange: 0,
    erratic: true,
    knockback: 3.0,
  },
  blink: {
    damage: 0,
    manaCost: 12,
    cooldown: 3.0,
    projectileSpeed: 0,
    projectileLifetime: 0,
    projectileCount: 0,
    splashRadius: 0,
    splashRatio: 0,
    slowMagnitude: 0,
    slowDuration: 0,
    pierceCount: 0,
    blinkRange: 6.5,
    erratic: false,
    knockback: 0,
  },
  /** PR2a L5 finisher — ground-target fire AOE; no projectile. */
  'inferno-nova': {
    damage: 52,
    manaCost: 25,
    cooldown: 20,
    projectileSpeed: 0,
    projectileLifetime: 0,
    projectileCount: 0,
    splashRadius: 4,
    splashRatio: 1,
    slowMagnitude: 0,
    slowDuration: 0,
    pierceCount: 0,
    blinkRange: 0,
    erratic: false,
    knockback: 5.5,
  },
};

function rankOf(
  ranks: Readonly<Partial<Record<SkillNodeId, number>>>,
  id: SkillNodeId,
): number {
  return Math.max(0, ranks[id] ?? 0);
}

function normalizeContext(
  context: SkillResolveContext | Readonly<Partial<Record<SkillNodeId, number>>> = {},
): SkillResolveContext {
  if (context && typeof context === 'object' && 'skillRanks' in context) {
    return context as SkillResolveContext;
  }
  return { skillRanks: context as Readonly<Partial<Record<SkillNodeId, number>>> };
}

/**
 * Resolve combat numbers for an active skill from the base table + tree ranks.
 * Tooltip lines are generated from the same resolved fields.
 */
export function resolveSkill(
  skillId: ActiveSkillId,
  context: SkillResolveContext | Readonly<Partial<Record<SkillNodeId, number>>> = {},
): ResolvedSkill {
  const ctx = normalizeContext(context);
  const ranks = ctx.skillRanks;
  const base = BASE[skillId];
  const out: ResolvedActiveSkill = { ...base };
  const onHit: SkillEffect[] = [];
  let slowedTargetMul = 1;
  let phaseEchoApplied = false;
  const tips: string[] = [];

  if (skillId === 'magma') {
    const magmaRank = Math.max(1, rankOf(ranks, 'magma-bolt') || 1);
    out.damage = base.damage * (1 + 0.12 * (magmaRank - 1));

    const kindling = rankOf(ranks, 'kindling');
    if (kindling > 0) {
      out.damage *= 1 + 0.06 * kindling;
      tips.push(`引火 +${(kindling * 6).toFixed(0)}% 火焰伤害`);
    }

    const volatile = rankOf(ranks, 'volatile-core');
    if (volatile > 0) {
      out.splashRadius = 1.7 + 0.35 * volatile;
      out.splashRatio = 0.5 + 0.1 * volatile;
      tips.push(`溅射 ${out.splashRadius.toFixed(2)} m · ${(out.splashRatio * 100).toFixed(0)}%`);
    } else {
      tips.push(`溅射 ${out.splashRadius.toFixed(1)} m · ${(out.splashRatio * 100).toFixed(0)}%`);
    }

    const scorch = rankOf(ranks, 'scorch');
    if (scorch > 0) {
      const fractions = [0.2, 0.3, 0.4] as const;
      const fraction = fractions[Math.min(scorch, 3) - 1]!;
      onHit.push({ kind: 'scorch', fraction, durationSec: 2 });
      tips.push(`灼烧 ${(fraction * 100).toFixed(0)}% / 2 秒`);
    }

    if (rankOf(ranks, 'hellfire-catalyst') > 0) {
      onHit.push({ kind: 'hellfire-explosion', damageRatio: 0.5, radius: 1.5 });
      tips.push('暴击狱火爆发 50% · 1.5 m');
    }

    tips.unshift(`伤害 ${out.damage.toFixed(1)} · 蓝耗 ${out.manaCost} · CD ${out.cooldown.toFixed(2)}s`);
  } else if (skillId === 'frost') {
    const frostRank = Math.max(1, rankOf(ranks, 'frost-fang') || 1);
    out.damage = base.damage * (1 + 0.1 * (frostRank - 1));

    const perma = rankOf(ranks, 'permafrost');
    if (perma > 0) {
      out.slowDuration = base.slowDuration + 0.4 * perma;
      tips.push(`减速 +${(0.4 * perma).toFixed(1)}s`);
    }

    out.pierceCount = rankOf(ranks, 'piercing-ice') > 0 ? 1 : 0;
    if (out.pierceCount > 0) tips.push(`穿透 ${out.pierceCount}`);

    const shatter = rankOf(ranks, 'shatter');
    if (shatter > 0) {
      const counts = [2, 3, 4] as const;
      const count = counts[Math.min(shatter, 3) - 1]!;
      onHit.push({
        kind: 'shatter-shards',
        count,
        damageRatio: 0.15,
        rangeM: 3,
      });
      tips.push(`碎冰 ${count}×15%`);
    }

    if (rankOf(ranks, 'winters-grasp') > 0) {
      slowedTargetMul = 1.3;
      // Optional preview when caller already knows the target is slowed.
      const preview = ctx.targetSlowed ? out.damage * slowedTargetMul : out.damage;
      tips.push(
        ctx.targetSlowed
          ? `冬之握 ×1.30 → ${preview.toFixed(1)}`
          : '冬之握 +30% vs 减速',
      );
    }

    tips.unshift(
      `伤害 ${out.damage.toFixed(1)} · 减速 ${(out.slowMagnitude * 100).toFixed(0)}%/${out.slowDuration.toFixed(1)}s`,
    );
  } else if (skillId === 'arc') {
    const arcLearned = rankOf(ranks, 'arc-surge');
    const arcRank = Math.max(1, arcLearned || 1);
    const rankMul = 1 + 0.1 * (arcRank - 1);
    const conduction = rankOf(ranks, 'conduction');
    const bolts = 3 + conduction;
    // Per-bolt mul: total theoretical = base×rankMul×3×(1+0.08×rank)
    const perBoltMul = conduction > 0
      ? (3 / bolts) * (1 + 0.08 * conduction)
      : 1;
    out.projectileCount = bolts;
    out.damage = base.damage * rankMul * perBoltMul;

    if (conduction > 0) {
      tips.push(`电弧 ${bolts} 道 · 总量 +${(conduction * 8).toFixed(0)}%`);
    }

    if (rankOf(ranks, 'overcharge') > 0) {
      onHit.push({ kind: 'overcharge-cdr', perHitSec: 0.25, capPerCastSec: 1.0 });
      tips.push('过载：击中减影踏 CD（最多 1s/次）');
    }

    tips.unshift(`每道 ${out.damage.toFixed(1)} · ×${out.projectileCount} · CD ${out.cooldown.toFixed(2)}s`);
  } else if (skillId === 'blink') {
    const echo = rankOf(ranks, 'phase-echo');
    if (echo > 0) {
      onHit.push({
        kind: 'phase-echo-grant',
        windowSec: 2,
        damageMul: 1 + 0.1 * echo,
      });
      tips.push(`相位回响 +${(echo * 10).toFixed(0)}% · 2 秒`);
    }
    tips.unshift(`蓝耗 ${out.manaCost} · CD ${out.cooldown.toFixed(1)}s · 距离 ${out.blinkRange} m`);
  } else if (skillId === 'inferno-nova') {
    // Brief burn via the same scorch path magma uses (skills.applyOnHit).
    onHit.push({ kind: 'scorch', fraction: 0.3, durationSec: 2 });
    tips.push(`灼烧 30% / 2 秒`);
    tips.unshift(
      `伤害 ${out.damage.toFixed(1)} · 蓝耗 ${out.manaCost} · CD ${out.cooldown.toFixed(0)}s · ${out.splashRadius.toFixed(0)} m`,
    );
  }

  // Phase Echo multiplies the entire damaging cast when charge is active.
  if (skillId !== 'blink' && ctx.phaseEchoActive && out.damage > 0) {
    const echo = rankOf(ranks, 'phase-echo');
    if (echo > 0) {
      const mul = 1 + 0.1 * echo;
      out.damage *= mul;
      phaseEchoApplied = true;
      tips.push(`相位回响 ×${mul.toFixed(2)}`);
    }
  }

  return {
    ...out,
    onHit,
    slowedTargetMul,
    phaseEchoApplied,
    tooltipLines: tips,
  };
}

/** Max pursuit / cast distance for a projectile skill (speed × lifetime). */
export function projectileCastRange(resolved: ResolvedActiveSkill): number {
  if (resolved.blinkRange > 0) return resolved.blinkRange;
  return resolved.projectileSpeed * resolved.projectileLifetime;
}

/**
 * Shatter fragment count from a resolved skill (0 when Shatter is unlearned).
 * VFX and damage both gate on this — no parallel rank check in SkillSystem.
 */
export function shatterShardCount(resolved: ResolvedSkill): number {
  for (const fx of resolved.onHit) {
    if (fx.kind === 'shatter-shards') return fx.count;
  }
  return 0;
}

/** Spec §5.2 shared combat caps (asserted by tests; derivation lives in combat-stats). */
export const COMBAT_CAPS = {
  classCritChance: 0.05,
  classCritMultiplier: 1.5,
  cdrCap: 0.45,
  moveBonusCap: 0.4,
} as const;
