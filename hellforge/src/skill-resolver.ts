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
      /** Tempest Conduit: also reduce this skill's cooldown. */
      readonly alsoAppliesTo?: ActiveSkillId;
    }
  | {
      readonly kind: 'phase-echo-grant';
      readonly windowSec: number;
      readonly damageMul: number;
    }
  | {
      readonly kind: 'splash-scorch';
      readonly fraction: number;
    }
  | {
      readonly kind: 'burn-kill-detonate';
      readonly ratio: number;
      readonly radius: number;
    };

export interface ResolvedSkill extends ResolvedActiveSkill {
  readonly onHit: readonly SkillEffect[];
  /** Winter's Grasp / Deep Freeze multiplier when the target is slowed. */
  readonly slowedTargetMul: number;
  /** Phase Echo multiplier already baked into damage when charge was active. */
  readonly phaseEchoApplied: boolean;
  /** Searing: bonus crit chance vs burning targets. */
  readonly burnCritChanceBonus: number;
  /** Deep Freeze: refresh remaining slow by this many seconds on hit. */
  readonly refreshSlowSec: number;
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
  /** PR9 — instant PBAOE; rank folds below. */
  'flame-burst': {
    damage: 28,
    manaCost: 14,
    cooldown: 4,
    projectileSpeed: 0,
    projectileLifetime: 0,
    projectileCount: 0,
    splashRadius: 2.5,
    splashRatio: 1,
    slowMagnitude: 0,
    slowDuration: 0,
    pierceCount: 0,
    blinkRange: 0,
    erratic: false,
    knockback: 5,
  },
  /** PR9 — instant PBAOE ring with slow. */
  'frost-nova': {
    damage: 22,
    manaCost: 14,
    cooldown: 4,
    projectileSpeed: 0,
    projectileLifetime: 0,
    projectileCount: 0,
    splashRadius: 3,
    splashRatio: 1,
    slowMagnitude: 0.35,
    slowDuration: 2.2,
    pierceCount: 0,
    blinkRange: 0,
    erratic: false,
    knockback: 2.4,
  },
  /** PR9 — radial bolt burst; rank 1 → 7 bolts (6+rank). */
  discharge: {
    damage: 8,
    manaCost: 12,
    cooldown: 1.2,
    projectileSpeed: 12,
    projectileLifetime: 1.2,
    projectileCount: 7,
    splashRadius: 0,
    splashRatio: 0,
    slowMagnitude: 0,
    slowDuration: 0,
    pierceCount: 0,
    blinkRange: 0,
    erratic: true,
    knockback: 3.0,
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

/** Combined Phase Echo damage mul (phase-echo ranks + echo-mastery ranks). */
function phaseEchoDamageMul(
  ranks: Readonly<Partial<Record<SkillNodeId, number>>>,
): number {
  const echo = rankOf(ranks, 'phase-echo');
  if (echo <= 0) return 1;
  const mastery = rankOf(ranks, 'echo-mastery');
  return 1 + 0.1 * echo + 0.05 * mastery;
}

/** Display mul to 2 decimals without FP ×1.49 for 1.3×1.15. */
function formatMul2(m: number): string {
  return (Math.round(m * 1000) / 1000).toFixed(2);
}

/**
 * Frost-element actives (`frost` / `frost-nova`) share these folds:
 * rime, permafrost, winters-grasp, deep-freeze.
 */
function foldFrostElementPassives(
  ranks: Readonly<Partial<Record<SkillNodeId, number>>>,
  out: ResolvedActiveSkill,
  tips: string[],
  damage: number,
  targetSlowed: boolean | undefined,
): { slowedTargetMul: number; refreshSlowSec: number } {
  let slowedTargetMul = 1;
  let refreshSlowSec = 0;

  const perma = rankOf(ranks, 'permafrost');
  if (perma > 0) {
    out.slowDuration += 0.4 * perma;
    tips.push(`减速 +${(0.4 * perma).toFixed(1)}s`);
  }

  const rime = rankOf(ranks, 'rime');
  if (rime > 0) {
    out.slowMagnitude += 0.05 * rime;
    tips.push(`霜雾减速 +${(rime * 5).toFixed(0)}%`);
  }

  const hasWinters = rankOf(ranks, 'winters-grasp') > 0;
  const hasDeep = rankOf(ranks, 'deep-freeze') > 0;
  if (hasWinters) slowedTargetMul = 1.3;
  if (hasDeep) {
    slowedTargetMul *= 1.15;
    refreshSlowSec = 0.5;
    tips.push('深度冻结 +15% vs 减速 · 刷新 0.5s');
  }
  // Attribute winters as +30%; stacked mul only appears in slowed preview (×1.50).
  if (hasWinters) {
    tips.push(
      targetSlowed
        ? `冬之握 ×${formatMul2(slowedTargetMul)} → ${(damage * slowedTargetMul).toFixed(1)}`
        : '冬之握 +30% vs 减速',
    );
  }

  return { slowedTargetMul, refreshSlowSec };
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
  let burnCritChanceBonus = 0;
  let refreshSlowSec = 0;
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
    const ember = rankOf(ranks, 'ember');
    if (scorch > 0) {
      const fractions = [0.2, 0.3, 0.4] as const;
      const fraction = fractions[Math.min(scorch, 3) - 1]!;
      const durationSec = 2 + 0.5 * ember;
      onHit.push({ kind: 'scorch', fraction, durationSec });
      tips.push(`灼烧 ${(fraction * 100).toFixed(0)}% / ${durationSec.toFixed(1)} 秒`);
    }

    const wildfire = rankOf(ranks, 'wildfire');
    if (wildfire > 0) {
      const fractions = [0.5, 1.0] as const;
      const fraction = fractions[Math.min(wildfire, 2) - 1]!;
      onHit.push({ kind: 'splash-scorch', fraction });
      tips.push(`野火溅射灼烧 ${(fraction * 100).toFixed(0)}%`);
    }

    const shimmer = rankOf(ranks, 'heat-shimmer');
    if (shimmer > 0) {
      out.projectileSpeed = base.projectileSpeed * (1 + 0.15 * shimmer);
      tips.push(`热浪弹速 +${(shimmer * 15).toFixed(0)}%`);
    }

    const searing = rankOf(ranks, 'searing');
    if (searing > 0) {
      burnCritChanceBonus = 0.05 * searing;
      tips.push(`灼热暴击 +${(searing * 5).toFixed(0)}% vs 燃烧`);
    }

    if (rankOf(ranks, 'hellfire-catalyst') > 0) {
      onHit.push({ kind: 'hellfire-explosion', damageRatio: 0.5, radius: 1.5 });
      tips.push('暴击狱火爆发 50% · 1.5 m');
    }

    if (rankOf(ranks, 'furnace-heart') > 0) {
      onHit.push({ kind: 'burn-kill-detonate', ratio: 0.5, radius: 2 });
      tips.push('熔炉之心：击杀燃烧目标爆发 50% · 2 m');
    }

    tips.unshift(`伤害 ${out.damage.toFixed(1)} · 蓝耗 ${out.manaCost} · CD ${out.cooldown.toFixed(2)}s`);
  } else if (skillId === 'frost') {
    const frostRank = Math.max(1, rankOf(ranks, 'frost-fang') || 1);
    out.damage = base.damage * (1 + 0.1 * (frostRank - 1));

    const pierceIce = rankOf(ranks, 'piercing-ice') > 0 ? 1 : 0;
    const pierceCold = rankOf(ranks, 'piercing-cold');
    out.pierceCount = pierceIce + pierceCold;
    if (out.pierceCount > 0) tips.push(`穿透 ${out.pierceCount}`);

    const shatter = rankOf(ranks, 'shatter');
    if (shatter > 0) {
      const counts = [2, 3, 4] as const;
      const glacier = rankOf(ranks, 'glacier-shards');
      const count = counts[Math.min(shatter, 3) - 1]! + glacier;
      onHit.push({
        kind: 'shatter-shards',
        count,
        damageRatio: 0.15,
        rangeM: 3,
      });
      tips.push(`碎冰 ${count}×15%`);
    }

    const focus = rankOf(ranks, 'frozen-focus');
    if (focus > 0) {
      out.manaCost = base.manaCost - 0.5 * focus;
      tips.push(`冰霜专注 蓝耗 −${(0.5 * focus).toFixed(1)}`);
    }

    const frostFolds = foldFrostElementPassives(
      ranks, out, tips, out.damage, ctx.targetSlowed,
    );
    slowedTargetMul = frostFolds.slowedTargetMul;
    refreshSlowSec = frostFolds.refreshSlowSec;

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

    const resonance = rankOf(ranks, 'resonance');
    if (resonance > 0) {
      out.damage *= 1 + 0.06 * resonance;
      tips.push(`共鸣 +${(resonance * 6).toFixed(0)}% 电弧伤害`);
    }

    const overcast = rankOf(ranks, 'overcast');
    if (overcast > 0) {
      out.cooldown = base.cooldown * (1 - 0.08 * overcast);
      tips.push(`超频 CD −${(overcast * 8).toFixed(0)}%`);
    }

    if (rankOf(ranks, 'overcharge') > 0) {
      const tempest = rankOf(ranks, 'tempest-conduit') > 0;
      const cdr: SkillEffect = tempest
        ? {
            kind: 'overcharge-cdr',
            perHitSec: 0.25,
            capPerCastSec: 2.0,
            alsoAppliesTo: 'discharge',
          }
        : { kind: 'overcharge-cdr', perHitSec: 0.25, capPerCastSec: 1.0 };
      onHit.push(cdr);
      tips.push(
        tempest
          ? '过载：击中减影踏/静电 CD（最多 2s/次）'
          : '过载：击中减影踏 CD（最多 1s/次）',
      );
    }

    tips.unshift(`每道 ${out.damage.toFixed(1)} · ×${out.projectileCount} · CD ${out.cooldown.toFixed(2)}s`);
  } else if (skillId === 'blink') {
    const echo = rankOf(ranks, 'phase-echo');
    if (echo > 0) {
      const mastery = rankOf(ranks, 'echo-mastery');
      const windowSec = 2 + 0.5 * mastery;
      const damageMul = phaseEchoDamageMul(ranks);
      onHit.push({
        kind: 'phase-echo-grant',
        windowSec,
        damageMul,
      });
      tips.push(`相位回响 +${((damageMul - 1) * 100).toFixed(0)}% · ${windowSec.toFixed(1)} 秒`);
    }

    const swift = rankOf(ranks, 'swift-phases');
    if (swift > 0) {
      out.cooldown = base.cooldown - 0.5 * swift;
      tips.push(`迅捷相位 CD −${(0.5 * swift).toFixed(1)}s`);
    }

    tips.unshift(`蓝耗 ${out.manaCost} · CD ${out.cooldown.toFixed(1)}s · 距离 ${out.blinkRange} m`);
  } else if (skillId === 'inferno-nova') {
    // Brief burn via the same scorch path magma uses (skills.applyOnHit).
    onHit.push({ kind: 'scorch', fraction: 0.3, durationSec: 2 });
    tips.push(`灼烧 30% / 2 秒`);
    tips.unshift(
      `伤害 ${out.damage.toFixed(1)} · 蓝耗 ${out.manaCost} · CD ${out.cooldown.toFixed(0)}s · ${out.splashRadius.toFixed(0)} m`,
    );
  } else if (skillId === 'flame-burst') {
    const rank = Math.max(1, rankOf(ranks, 'flame-burst') || 1);
    out.damage = base.damage * (1 + 0.10 * (rank - 1));
    tips.unshift(
      `伤害 ${out.damage.toFixed(1)} · 蓝耗 ${out.manaCost} · CD ${out.cooldown.toFixed(0)}s · ${out.splashRadius.toFixed(1)} m`,
    );
  } else if (skillId === 'frost-nova') {
    const rank = Math.max(1, rankOf(ranks, 'frost-nova') || 1);
    out.damage = base.damage * (1 + 0.10 * (rank - 1));
    const frostFolds = foldFrostElementPassives(
      ranks, out, tips, out.damage, ctx.targetSlowed,
    );
    slowedTargetMul = frostFolds.slowedTargetMul;
    refreshSlowSec = frostFolds.refreshSlowSec;
    tips.unshift(
      `伤害 ${out.damage.toFixed(1)} · 减速 ${(out.slowMagnitude * 100).toFixed(0)}%/${out.slowDuration.toFixed(1)}s · ${out.splashRadius.toFixed(0)} m`,
    );
  } else if (skillId === 'discharge') {
    const rank = Math.max(1, rankOf(ranks, 'discharge') || 1);
    const bolts = 6 + rank;
    const rankMul = 1 + 0.10 * (rank - 1);
    // Conduction-style: total ≈ base×rankMul×6, split across bolts.
    out.projectileCount = bolts;
    out.damage = base.damage * rankMul * (6 / bolts);

    const resonance = rankOf(ranks, 'resonance');
    if (resonance > 0) {
      out.damage *= 1 + 0.06 * resonance;
      tips.push(`共鸣 +${(resonance * 6).toFixed(0)}% 电弧伤害`);
    }

    tips.push(`静电 ${bolts} 道`);
    tips.unshift(`每道 ${out.damage.toFixed(1)} · ×${out.projectileCount} · CD ${out.cooldown.toFixed(2)}s`);
  }

  // Phase Echo multiplies the entire damaging cast when charge is active.
  if (skillId !== 'blink' && ctx.phaseEchoActive && out.damage > 0) {
    const echo = rankOf(ranks, 'phase-echo');
    if (echo > 0) {
      const mul = phaseEchoDamageMul(ranks);
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
    burnCritChanceBonus,
    refreshSlowSec,
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
