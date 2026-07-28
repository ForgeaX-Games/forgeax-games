import { describe, expect, test } from 'bun:test';
import { emptySkillRanks } from './skill-tree';
import {
  COMBAT_CAPS,
  projectileCastRange,
  resolveSkill,
  type ResolvedSkill,
  type SkillResolveContext,
} from './skill-resolver';
import type { SkillNodeId } from './content-ids';

function ranks(partial: Partial<Record<SkillNodeId, number>>): SkillResolveContext {
  return { skillRanks: { ...emptySkillRanks(), ...partial } };
}

function snapshotSkill(r: ResolvedSkill) {
  return {
    damage: Number(r.damage.toFixed(4)),
    manaCost: r.manaCost,
    cooldown: r.cooldown,
    projectileSpeed: r.projectileSpeed,
    projectileLifetime: r.projectileLifetime,
    projectileCount: r.projectileCount,
    splashRadius: Number(r.splashRadius.toFixed(4)),
    splashRatio: Number(r.splashRatio.toFixed(4)),
    slowMagnitude: r.slowMagnitude,
    slowDuration: Number(r.slowDuration.toFixed(4)),
    pierceCount: r.pierceCount,
    blinkRange: r.blinkRange,
    slowedTargetMul: r.slowedTargetMul,
    phaseEchoApplied: r.phaseEchoApplied,
    onHit: r.onHit,
    tooltipLines: r.tooltipLines,
  };
}

describe('resolveSkill — Spec §5.2 base table + caps', () => {
  test('Magma Bolt 16 / 6 / 0.45 with 1.7 m splash at 50%', () => {
    const r = resolveSkill('magma');
    expect(r.damage).toBe(16);
    expect(r.manaCost).toBe(6);
    expect(r.cooldown).toBe(0.45);
    expect(r.splashRadius).toBe(1.7);
    expect(r.splashRatio).toBe(0.5);
    expect(r.pierceCount).toBe(0);
  });

  test('Frost Fang 11 / 7 / 0.60, slow 35%/2.2s, pierce count 0', () => {
    const r = resolveSkill('frost', ranks({ 'frost-fang': 1 }));
    expect(r.damage).toBe(11);
    expect(r.manaCost).toBe(7);
    expect(r.cooldown).toBe(0.6);
    expect(r.slowMagnitude).toBe(0.35);
    expect(r.slowDuration).toBe(2.2);
    expect(r.pierceCount).toBe(0);
  });

  test('Arc Surge 8×3 / 9 / 0.80 erratic', () => {
    const r = resolveSkill('arc');
    expect(r.damage).toBe(8);
    expect(r.manaCost).toBe(9);
    expect(r.cooldown).toBe(0.8);
    expect(r.projectileCount).toBe(3);
    expect(r.erratic).toBe(true);
  });

  test('Phase Step (blink) mana 12 / cd 3.0 / range 6.5 m', () => {
    const r = resolveSkill('blink');
    expect(r.manaCost).toBe(12);
    expect(r.cooldown).toBe(3.0);
    expect(r.blinkRange).toBe(6.5);
  });

  test('Inferno Nova (finisher) 52 / 25 mana / 20 s cd / 4 m AOE + scorch', () => {
    const r = resolveSkill('inferno-nova');
    expect(r.damage).toBe(52);
    expect(r.manaCost).toBe(25);
    expect(r.cooldown).toBe(20);
    expect(r.splashRadius).toBe(4);
    expect(r.splashRatio).toBe(1);
    expect(r.projectileCount).toBe(0);
    expect(r.onHit).toContainEqual({ kind: 'scorch', fraction: 0.3, durationSec: 2 });
  });

  test('shared caps: class crit 5%/1.5×, CDR 45%, move 40%', () => {
    expect(COMBAT_CAPS.classCritChance).toBe(0.05);
    expect(COMBAT_CAPS.classCritMultiplier).toBe(1.5);
    expect(COMBAT_CAPS.cdrCap).toBe(0.45);
    expect(COMBAT_CAPS.moveBonusCap).toBe(0.4);
  });

  test('returns a fresh object', () => {
    const a = resolveSkill('frost');
    const b = resolveSkill('frost');
    expect(a).not.toBe(b);
    expect(a.damage).toBe(b.damage);
  });

  test('projectileCastRange uses speed × lifetime', () => {
    expect(projectileCastRange(resolveSkill('frost'))).toBeCloseTo(19 * 1.2, 6);
    expect(projectileCastRange(resolveSkill('blink'))).toBe(6.5);
  });

  test('tooltip lines come from the same resolved numbers', () => {
    const r = resolveSkill('frost', ranks({ 'frost-fang': 3, 'permafrost': 2 }));
    expect(r.tooltipLines[0]).toContain(r.damage.toFixed(1));
    expect(r.tooltipLines[0]).toContain(r.slowDuration.toFixed(1));
  });
});

describe('resolveSkill — 15 node effect snapshots (Spec §7.2)', () => {
  test('1 Magma Bolt rank scaling +12%/rank above 1', () => {
    expect(snapshotSkill(resolveSkill('magma', ranks({ 'magma-bolt': 1 }))).damage).toBe(16);
    expect(snapshotSkill(resolveSkill('magma', ranks({ 'magma-bolt': 5 }))).damage).toBe(
      Number((16 * (1 + 0.12 * 4)).toFixed(4)),
    );
  });

  test('2 Kindling +6% fire damage/rank', () => {
    const r = resolveSkill('magma', ranks({ 'magma-bolt': 1, kindling: 3 }));
    expect(snapshotSkill(r).damage).toBe(Number((16 * (1 + 0.06 * 3)).toFixed(4)));
    expect(r.onHit).toEqual([]);
  });

  test('3 Scorch DoT fractions 20/30/40% over 2s (one stack template)', () => {
    const r1 = resolveSkill('magma', ranks({ 'magma-bolt': 2, scorch: 1 }));
    const r3 = resolveSkill('magma', ranks({ 'magma-bolt': 2, scorch: 3 }));
    expect(r1.onHit).toContainEqual({ kind: 'scorch', fraction: 0.2, durationSec: 2 });
    expect(r3.onHit).toContainEqual({ kind: 'scorch', fraction: 0.4, durationSec: 2 });
  });

  test('4 Volatile Core splash radius/ratio per rank', () => {
    const r = resolveSkill('magma', ranks({ 'magma-bolt': 2, kindling: 2, 'volatile-core': 2 }));
    expect(r.splashRadius).toBeCloseTo(1.7 + 0.35 * 2, 6);
    expect(r.splashRatio).toBeCloseTo(0.5 + 0.1 * 2, 6);
  });

  test('5 Hellfire Catalyst crit explosion template', () => {
    const r = resolveSkill('magma', ranks({
      'magma-bolt': 2, kindling: 2, 'volatile-core': 2, 'hellfire-catalyst': 1,
    }));
    expect(r.onHit).toContainEqual({
      kind: 'hellfire-explosion', damageRatio: 0.5, radius: 1.5,
    });
  });

  test('6 Frost Fang rank scaling +10%/rank above 1', () => {
    expect(resolveSkill('frost', ranks({ 'frost-fang': 1 })).damage).toBe(11);
    expect(resolveSkill('frost', ranks({ 'frost-fang': 5 })).damage).toBeCloseTo(
      11 * (1 + 0.1 * 4), 6,
    );
  });

  test('7 Permafrost +0.4s slow duration/rank', () => {
    const r = resolveSkill('frost', ranks({ 'frost-fang': 2, permafrost: 3 }));
    expect(r.slowDuration).toBeCloseTo(2.2 + 0.4 * 3, 6);
    expect(r.slowMagnitude).toBe(0.35);
  });

  test('8 Piercing Ice sets pierceCount to 1', () => {
    const base = resolveSkill('frost', ranks({ 'frost-fang': 2 }));
    const pierced = resolveSkill('frost', ranks({ 'frost-fang': 2, 'piercing-ice': 1 }));
    expect(base.pierceCount).toBe(0);
    expect(pierced.pierceCount).toBe(1);
  });

  test('9 Shatter shard counts 2/3/4 at 15% within 3m', () => {
    const r2 = resolveSkill('frost', ranks({ 'frost-fang': 2, 'piercing-ice': 1, shatter: 2 }));
    const r3 = resolveSkill('frost', ranks({ 'frost-fang': 2, 'piercing-ice': 1, shatter: 3 }));
    expect(r2.onHit).toContainEqual({
      kind: 'shatter-shards', count: 3, damageRatio: 0.15, rangeM: 3,
    });
    expect(r3.onHit).toContainEqual({
      kind: 'shatter-shards', count: 4, damageRatio: 0.15, rangeM: 3,
    });
  });

  test('10 Winter\'s Grasp slowed-target mul 1.30 (applied at hit)', () => {
    const r = resolveSkill('frost', ranks({
      'frost-fang': 2, 'piercing-ice': 1, shatter: 3, 'winters-grasp': 1,
    }));
    expect(r.slowedTargetMul).toBe(1.3);
    expect(r.damage).toBeCloseTo(11 * 1.1, 6); // not baked at cast
    const preview = resolveSkill('frost', {
      ...ranks({ 'frost-fang': 2, 'winters-grasp': 1 }),
      targetSlowed: true,
    });
    expect(preview.tooltipLines.some((l) => l.includes('1.30'))).toBe(true);
  });

  test('11 Arc Surge rank scaling +10%/rank above 1', () => {
    expect(resolveSkill('arc', ranks({ 'arc-surge': 1 })).damage).toBe(8);
    expect(resolveSkill('arc', ranks({ 'arc-surge': 5 })).damage).toBeCloseTo(
      8 * (1 + 0.1 * 4), 6,
    );
  });

  test('12 Conduction bolt count + per-bolt mul (+8% total/rank)', () => {
    const r = resolveSkill('arc', ranks({ 'arc-surge': 2, conduction: 2 }));
    expect(r.projectileCount).toBe(5);
    const rankMul = 1 + 0.1 * (2 - 1);
    const perBolt = (3 / 5) * (1 + 0.08 * 2);
    expect(r.damage).toBeCloseTo(8 * rankMul * perBolt, 6);
    // Total theoretical vs 3-bolt baseline at same arc rank
    const total = r.damage * r.projectileCount;
    const baseline = 8 * rankMul * 3;
    expect(total / baseline).toBeCloseTo(1 + 0.08 * 2, 6);
  });

  test('13 Phase Step grants Phase Echo charge template', () => {
    const r = resolveSkill('blink', ranks({ 'arc-surge': 2, 'phase-step': 1, 'phase-echo': 2 }));
    expect(r.onHit).toContainEqual({
      kind: 'phase-echo-grant', windowSec: 2, damageMul: 1.2,
    });
    expect(r.manaCost).toBe(12);
    expect(r.cooldown).toBe(3);
    expect(r.blinkRange).toBe(6.5);
  });

  test('14 Phase Echo multiplies damaging cast when active', () => {
    const cold = resolveSkill('frost', ranks({ 'frost-fang': 1, 'phase-echo': 3 }));
    const hot = resolveSkill('frost', {
      ...ranks({ 'frost-fang': 1, 'phase-echo': 3 }),
      phaseEchoActive: true,
    });
    expect(cold.phaseEchoApplied).toBe(false);
    expect(hot.phaseEchoApplied).toBe(true);
    expect(hot.damage).toBeCloseTo(cold.damage * 1.3, 6);
  });

  test('15 Overcharge CDR template 0.25s/hit capped 1s/cast', () => {
    const r = resolveSkill('arc', ranks({
      'arc-surge': 2, conduction: 3, 'phase-step': 1, 'phase-echo': 2, overcharge: 1,
    }));
    expect(r.onHit).toContainEqual({
      kind: 'overcharge-cdr', perHitSec: 0.25, capPerCastSec: 1,
    });
  });
});

describe('resolveSkill — PR9 18 node effect snapshots', () => {
  test('16 Flame Burst rank scaling +10%/rank above 1', () => {
    expect(resolveSkill('flame-burst', ranks({ 'flame-burst': 1 })).damage).toBe(28);
    expect(resolveSkill('flame-burst', ranks({ 'flame-burst': 5 })).damage).toBeCloseTo(
      28 * (1 + 0.10 * 4), 6,
    );
    const r = resolveSkill('flame-burst', ranks({ 'flame-burst': 1 }));
    expect(r.manaCost).toBe(14);
    expect(r.cooldown).toBe(4);
    expect(r.splashRadius).toBe(2.5);
    expect(r.knockback).toBe(5);
    expect(r.projectileCount).toBe(0);
  });

  test('17 Ember extends scorch duration +0.5s/rank', () => {
    const r = resolveSkill('magma', ranks({ 'magma-bolt': 2, scorch: 2, ember: 3 }));
    expect(r.onHit).toContainEqual({ kind: 'scorch', fraction: 0.3, durationSec: 2 + 0.5 * 3 });
  });

  test('18 Searing burn-crit chance +5%/rank', () => {
    const r = resolveSkill('magma', ranks({ 'magma-bolt': 1, kindling: 2, searing: 3 }));
    expect(r.burnCritChanceBonus).toBeCloseTo(0.05 * 3, 6);
  });

  test('19 Wildfire splash-scorch fractions 50/100%', () => {
    const r1 = resolveSkill('magma', ranks({
      'magma-bolt': 2, kindling: 2, 'volatile-core': 2, wildfire: 1,
    }));
    const r2 = resolveSkill('magma', ranks({
      'magma-bolt': 2, kindling: 2, 'volatile-core': 2, wildfire: 2,
    }));
    expect(r1.onHit).toContainEqual({ kind: 'splash-scorch', fraction: 0.5 });
    expect(r2.onHit).toContainEqual({ kind: 'splash-scorch', fraction: 1.0 });
  });

  test('20 Heat Shimmer magma projectile speed +15%/rank', () => {
    const r = resolveSkill('magma', ranks({
      'magma-bolt': 2, kindling: 2, 'volatile-core': 1, 'heat-shimmer': 2,
    }));
    expect(r.projectileSpeed).toBeCloseTo(15 * (1 + 0.15 * 2), 6);
  });

  test('21 Furnace Heart burn-kill detonate 50% / 2 m', () => {
    const r = resolveSkill('magma', ranks({
      'magma-bolt': 2, kindling: 2, 'volatile-core': 2, 'hellfire-catalyst': 1, 'furnace-heart': 1,
    }));
    expect(r.onHit).toContainEqual({
      kind: 'burn-kill-detonate', ratio: 0.5, radius: 2,
    });
  });

  test('22 Frost Nova rank scaling +10%/rank above 1', () => {
    expect(resolveSkill('frost-nova', ranks({ 'frost-nova': 1 })).damage).toBe(22);
    expect(resolveSkill('frost-nova', ranks({ 'frost-nova': 5 })).damage).toBeCloseTo(
      22 * (1 + 0.10 * 4), 6,
    );
    const r = resolveSkill('frost-nova', ranks({ 'frost-nova': 1 }));
    expect(r.manaCost).toBe(14);
    expect(r.cooldown).toBe(4);
    expect(r.splashRadius).toBe(3);
    expect(r.slowMagnitude).toBe(0.35);
    expect(r.slowDuration).toBe(2.2);
  });

  test('22b Frost Nova inherits frost slow/bonus folds', () => {
    const r = resolveSkill('frost-nova', ranks({
      'frost-nova': 1, permafrost: 2, rime: 3, 'winters-grasp': 1, 'deep-freeze': 1,
    }));
    expect(r.slowDuration).toBeCloseTo(2.2 + 0.4 * 2, 6);
    expect(r.slowMagnitude).toBeCloseTo(0.35 + 0.05 * 3, 6);
    expect(r.slowedTargetMul).toBeCloseTo(1.3 * 1.15, 6);
    expect(r.refreshSlowSec).toBe(0.5);
    // winters attributed as +30%; deep-freeze keeps its own +15% line (not ×1.49 / +49%)
    expect(r.tooltipLines.some((l) => l.includes('冬之握 +30%'))).toBe(true);
    expect(r.tooltipLines.some((l) => /冬之握 \+49%|×1\.49/.test(l))).toBe(false);
    const preview = resolveSkill('frost-nova', {
      ...ranks({ 'frost-nova': 1, 'winters-grasp': 1, 'deep-freeze': 1 }),
      targetSlowed: true,
    });
    expect(preview.tooltipLines.some((l) => l.includes('×1.50'))).toBe(true);
  });

  test('23 Rime slow magnitude +5%/rank', () => {
    const r = resolveSkill('frost', ranks({ 'frost-fang': 2, permafrost: 2, rime: 3 }));
    expect(r.slowMagnitude).toBeCloseTo(0.35 + 0.05 * 3, 6);
  });

  test('24 Piercing Cold adds pierce (stacks with Piercing Ice)', () => {
    const ice = resolveSkill('frost', ranks({ 'frost-fang': 2, 'piercing-ice': 1 }));
    const both = resolveSkill('frost', ranks({
      'frost-fang': 2, 'piercing-ice': 1, 'piercing-cold': 1,
    }));
    expect(ice.pierceCount).toBe(1);
    expect(both.pierceCount).toBe(2);
  });

  test('25 Glacier Shards shatter count +1/rank', () => {
    const base = resolveSkill('frost', ranks({
      'frost-fang': 2, 'piercing-ice': 1, shatter: 3,
    }));
    const g1 = resolveSkill('frost', ranks({
      'frost-fang': 2, 'piercing-ice': 1, shatter: 3, 'glacier-shards': 1,
    }));
    const g2 = resolveSkill('frost', ranks({
      'frost-fang': 2, 'piercing-ice': 1, shatter: 3, 'glacier-shards': 2,
    }));
    expect(base.onHit).toContainEqual({
      kind: 'shatter-shards', count: 4, damageRatio: 0.15, rangeM: 3,
    });
    expect(g1.onHit).toContainEqual({
      kind: 'shatter-shards', count: 5, damageRatio: 0.15, rangeM: 3,
    });
    expect(g2.onHit).toContainEqual({
      kind: 'shatter-shards', count: 6, damageRatio: 0.15, rangeM: 3,
    });
  });

  test('26 Frozen Focus frost mana −0.5/rank', () => {
    const r = resolveSkill('frost', ranks({ 'frost-fang': 3, 'frozen-focus': 3 }));
    expect(r.manaCost).toBeCloseTo(7 - 0.5 * 3, 6);
  });

  test('27 Deep Freeze +15% vs slowed + refresh 0.5s', () => {
    const r = resolveSkill('frost', ranks({
      'frost-fang': 2, 'piercing-ice': 1, shatter: 3, 'winters-grasp': 1, 'deep-freeze': 1,
    }));
    expect(r.slowedTargetMul).toBeCloseTo(1.3 * 1.15, 6);
    expect(r.refreshSlowSec).toBe(0.5);
    expect(r.tooltipLines.some((l) => l.includes('冬之握 +30%'))).toBe(true);
    expect(r.tooltipLines.some((l) => l.includes('深度冻结 +15%'))).toBe(true);
    expect(r.tooltipLines.some((l) => /冬之握 \+49%|×1\.49/.test(l))).toBe(false);
  });

  test('28 Discharge bolts 6+rank, +10%/rank above 1, conduction-style split', () => {
    const r1 = resolveSkill('discharge', ranks({ discharge: 1 }));
    expect(r1.projectileCount).toBe(7);
    expect(r1.damage).toBeCloseTo(8 * (6 / 7), 6);

    const r5 = resolveSkill('discharge', ranks({ discharge: 5 }));
    expect(r5.projectileCount).toBe(11);
    const rankMul = 1 + 0.10 * 4;
    expect(r5.damage).toBeCloseTo(8 * rankMul * (6 / 11), 6);
    // Total theoretical ≈ base×rankMul×6
    expect(r5.damage * r5.projectileCount).toBeCloseTo(8 * rankMul * 6, 6);
  });

  test('29 Resonance +6% arc damage/rank', () => {
    const r = resolveSkill('arc', ranks({ 'arc-surge': 3, resonance: 3 }));
    expect(r.damage).toBeCloseTo(8 * (1 + 0.1 * 2) * (1 + 0.06 * 3), 6);
  });

  test('29b Resonance also boosts discharge damage', () => {
    const base = resolveSkill('discharge', ranks({ discharge: 2 }));
    const boosted = resolveSkill('discharge', ranks({ discharge: 2, resonance: 3 }));
    const rankMul = 1 + 0.10 * 1;
    const bolts = 6 + 2;
    expect(base.damage).toBeCloseTo(8 * rankMul * (6 / bolts), 6);
    expect(boosted.damage).toBeCloseTo(8 * rankMul * (6 / bolts) * (1 + 0.06 * 3), 6);
    expect(boosted.damage).toBeCloseTo(base.damage * (1 + 0.06 * 3), 6);
  });

  test('30 Swift Phases blink cooldown −0.5s/rank', () => {
    const r = resolveSkill('blink', ranks({
      'arc-surge': 2, 'phase-step': 1, 'swift-phases': 2,
    }));
    expect(r.cooldown).toBeCloseTo(3.0 - 0.5 * 2, 6);
  });

  test('31 Echo Mastery Phase Echo window +0.5s and +5% damage/rank', () => {
    const r = resolveSkill('blink', ranks({
      'arc-surge': 2, 'phase-step': 1, 'phase-echo': 2, 'echo-mastery': 2,
    }));
    expect(r.onHit).toContainEqual({
      kind: 'phase-echo-grant', windowSec: 2 + 0.5 * 2, damageMul: 1 + 0.1 * 2 + 0.05 * 2,
    });
    const hot = resolveSkill('frost', {
      ...ranks({ 'frost-fang': 1, 'phase-echo': 2, 'echo-mastery': 2 }),
      phaseEchoActive: true,
    });
    expect(hot.damage).toBeCloseTo(11 * (1 + 0.1 * 2 + 0.05 * 2), 6);
  });

  test('32 Overcast arc cooldown −8%/rank', () => {
    const r = resolveSkill('arc', ranks({ 'arc-surge': 2, conduction: 1, overcast: 2 }));
    expect(r.cooldown).toBeCloseTo(0.8 * (1 - 0.08 * 2), 6);
  });

  test('33 Tempest Conduit Overcharge cap 2s + applies to Discharge', () => {
    const r = resolveSkill('arc', ranks({
      'arc-surge': 2, conduction: 3, 'phase-step': 1, 'phase-echo': 2, overcharge: 1,
      'tempest-conduit': 1,
    }));
    expect(r.onHit).toContainEqual({
      kind: 'overcharge-cdr',
      perHitSec: 0.25,
      capPerCastSec: 2,
      alsoAppliesTo: 'discharge',
    });
  });
});
