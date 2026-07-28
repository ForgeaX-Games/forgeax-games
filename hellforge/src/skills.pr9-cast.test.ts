import { describe, expect, test } from 'bun:test';

// Register shared engine mocks before importing skills.ts (engine-touching).
import '../tools/engine-test-mocks';

import type { Monster, MonsterManager } from './monsters';
import { resolveSkill } from './skill-resolver';
import { isSkillAvailable } from './skill-availability';
import type { PlayerStats } from './state';
import { skillIconUrl } from './ui-icons';

const { SKILLS, SkillSystem } = await import('./skills');
type SkillDef = (typeof SKILLS)[number];

function stubWorld() {
  let next = 1;
  return {
    spawn: () => ({ ok: true as const, value: next++ }),
    despawn: () => {},
    set: () => {},
    allocSharedRef: (_k: string, v: unknown) => v ?? {},
  };
}

function stubFx() {
  const plays: string[] = [];
  return {
    plays,
    fireBoltMaterial: () => null,
    frostVfx: () => null,
    playEffect: (def: { emitters: { id: string }[] }) => {
      plays.push(def.emitters.map((e) => e.id).join('+'));
      return null;
    },
    frostCastCue: () => {},
    frostImpact: () => {},
    shatterFragments: () => {},
    flightBody: () => ({ primary: 0, glow: 0 }),
    releaseFlightBody: () => {},
    moveFlightBody: () => {},
    flightTrailPuff: () => {},
    noteProjectiles: () => {},
    pop: () => ({}),
    novaTelegraph: () => ({ ring: 0, fill: 0, center: 0 }),
    moveNovaTelegraph: () => {},
    releaseNovaTelegraph: () => {},
    novaChargePuff: () => {},
    novaShockRing: () => {},
    novaScorch: () => {},
    gibs: () => {},
    syncSlowStatus: () => {},
  };
}

function player(mana = 100): PlayerStats {
  return {
    hp: 100, maxHp: 100, mana, maxMana: 100,
    manaRegen: 0, hpRegen: 0, kills: 0, dead: false, hurtCooldown: 0,
  };
}

function fakeMonster(overrides: Partial<Monster> = {}): Monster {
  return {
    id: 'm-1',
    e: 1 as never,
    kind: 'imp',
    hp: 100,
    maxHp: 100,
    x: 1, z: 0,
    yaw: 0,
    attackCd: 0,
    rangedCd: 0,
    slowUntil: 0,
    flashUntil: 0,
    burnUntil: 0,
    burnDps: 0,
    enraged: false,
    bobPhase: 0,
    matState: 'normal',
    zone: 'wild',
    parts: [],
    skinEnt: null,
    instEntities: [],
    clip: 'idle',
    clipUntil: 0,
    strikeAt: 0,
    strikeRanged: false,
    kbX: 0, kbZ: 0,
    animBase: 1,
    contactShadow: null,
    ...overrides,
  } as Monster;
}

function stubMonsters(list: Monster[] = []): MonsterManager {
  let now = 0;
  const mgr = {
    monsters: list,
    clock: () => now,
    isSlowed(m: Monster) { return m.slowUntil > now; },
    isBurning(m: Monster) { return m.burnUntil > now && m.burnDps > 0; },
    refreshSlow(m: Monster, extra: number) {
      if (extra > 0 && m.slowUntil > now) m.slowUntil += extra;
    },
    applyBurn(m: Monster, total: number, dur: number) {
      if (total <= 0 || dur <= 0) return;
      m.burnUntil = now + dur;
      m.burnDps = total / dur;
    },
    damage(m: Monster, dmg: number, slowSec = 0, _kdx = 0, _kdz = 0, kbForce = 0) {
      m.hp -= dmg;
      if (slowSec > 0) m.slowUntil = Math.max(m.slowUntil, now + slowSec);
      if (kbForce > 0) { m.kbX += _kdx * kbForce; m.kbZ += _kdz * kbForce; }
      return m.hp <= 0;
    },
  };
  return mgr as unknown as MonsterManager;
}

function makeSystem(defs: SkillDef[] = SKILLS) {
  const fx = stubFx();
  const sys = new SkillSystem(
    stubWorld() as never,
    fx as never,
    { tryBlink: () => true, onHit: () => {} },
    defs,
  );
  return { sys, fx };
}

describe('PR9 active cast rights', () => {
  test('new actives are tree-gated (locked without ranks)', () => {
    for (const id of ['flame-burst', 'frost-nova', 'discharge'] as const) {
      const def = { id, unlockLevel: 4 };
      expect(isSkillAvailable(def, 99, {})).toBe(false);
      expect(isSkillAvailable(def, 4, { [id]: 1 })).toBe(true);
    }
  });

  test('SKILLS kit includes the three PR9 actives', () => {
    const ids = SKILLS.map((s) => s.id);
    expect(ids).toContain('flame-burst');
    expect(ids).toContain('frost-nova');
    expect(ids).toContain('discharge');
  });

  test('icons reuse sibling-element PNGs', () => {
    expect(skillIconUrl('flame-burst')).toContain('magma.png');
    expect(skillIconUrl('frost-nova')).toContain('frost.png');
    expect(skillIconUrl('discharge')).toContain('arc.png');
  });
});

describe('PR9 castResolved happy-path / gates', () => {
  test('flame-burst locked without rank; ok with rank + mana', () => {
    const { sys, fx } = makeSystem();
    const p = player(100);
    const ranks = {};
    const resolved = resolveSkill('flame-burst', { skillRanks: { 'flame-burst': 1 } });
    expect(sys.castResolved('flame-burst', 0, 0, 1, 0, p, 4, ranks, resolved))
      .toBe('locked');
    const learned = { 'flame-burst': 1 };
    expect(sys.castResolved('flame-burst', 0, 0, 1, 0, p, 4, learned, resolved))
      .toBe('ok');
    expect(p.mana).toBe(100 - resolved.manaCost);
    expect(sys.cooldowns[sys.indexOf('flame-burst')]!).toBeGreaterThan(0);
    expect(fx.plays.some((s) => s.includes('hellfire'))).toBe(true);
  });

  test('frost-nova mana / cooldown gates', () => {
    const { sys } = makeSystem();
    const ranks = { 'frost-nova': 1 };
    const resolved = resolveSkill('frost-nova', { skillRanks: ranks });
    expect(sys.castResolved(
      'frost-nova', 0, 0, 0, 1, player(resolved.manaCost - 1), 4, ranks, resolved,
    )).toBe('mana');
    const p = player(100);
    expect(sys.castResolved('frost-nova', 0, 0, 0, 1, p, 4, ranks, resolved)).toBe('ok');
    expect(sys.castResolved('frost-nova', 0, 0, 0, 1, p, 4, ranks, resolved)).toBe('cooldown');
  });

  test('discharge spawns radial bolts (projectileCount)', () => {
    const { sys } = makeSystem();
    const ranks = { discharge: 1 };
    const resolved = resolveSkill('discharge', { skillRanks: ranks });
    expect(resolved.projectileCount).toBe(7);
    const p = player(100);
    expect(sys.castResolved('discharge', 0, 0, 1, 0, p, 4, ranks, resolved)).toBe('ok');
    expect(sys.activeCount()).toBe(7);
  });

  test('PBAOE damages nearby monsters on next tick', () => {
    const { sys } = makeSystem();
    const m = fakeMonster({ x: 1, z: 0, hp: 200, maxHp: 200 });
    const monsters = stubMonsters([m]);
    const ranks = { 'flame-burst': 1 };
    const resolved = resolveSkill('flame-burst', { skillRanks: ranks });
    const p = player(100);
    expect(sys.castResolved('flame-burst', 0, 0, 1, 0, p, 4, ranks, resolved)).toBe('ok');
    const hpBefore = m.hp;
    sys.tick(0, monsters);
    expect(m.hp).toBeLessThan(hpBefore);
    expect(m.kbX !== 0 || m.kbZ !== 0).toBe(true);
  });

  test('frost-nova applies slow on tick stamp', () => {
    const { sys } = makeSystem();
    const m = fakeMonster({ x: 0.5, z: 0.5 });
    const monsters = stubMonsters([m]);
    const ranks = { 'frost-nova': 1 };
    const resolved = resolveSkill('frost-nova', { skillRanks: ranks });
    sys.castResolved('frost-nova', 0, 0, 1, 0, player(100), 4, ranks, resolved);
    sys.tick(0, monsters);
    expect(monsters.isSlowed(m)).toBe(true);
  });
});

describe('PR9 applyOnHit effect kinds', () => {
  test('splash-scorch burns splash victims (wildfire)', () => {
    const { sys } = makeSystem();
    const primary = fakeMonster({ id: 'p', x: 2, z: 0, hp: 500, maxHp: 500 });
    const splash = fakeMonster({ id: 's', x: 2.8, z: 0, hp: 500, maxHp: 500 });
    const monsters = stubMonsters([primary, splash]);
    const ranks = {
      'magma-bolt': 1, scorch: 1, 'volatile-core': 2, wildfire: 1,
    };
    const resolved = resolveSkill('magma', { skillRanks: ranks });
    expect(resolved.onHit.some((fx) => fx.kind === 'splash-scorch')).toBe(true);
    const p = player(100);
    expect(sys.castResolved('magma', 0, 0, 1, 0, p, 4, ranks, resolved)).toBe('ok');
    for (let i = 0; i < 20; i++) sys.tick(0.05, monsters);
    expect(monsters.isBurning(splash)).toBe(true);
  });

  test('burn-kill-detonate damages neighbors without recursion', () => {
    const { sys } = makeSystem();
    const primary = fakeMonster({
      id: 'p', x: 1.2, z: 0, hp: 5, maxHp: 100,
      burnUntil: 999, burnDps: 2,
    });
    const neighbor = fakeMonster({ id: 'n', x: 2.0, z: 0, hp: 200, maxHp: 200 });
    const monsters = stubMonsters([primary, neighbor]);
    const ranks = {
      'magma-bolt': 1, 'hellfire-catalyst': 1, 'furnace-heart': 1,
    };
    const resolved = resolveSkill('magma', { skillRanks: ranks });
    expect(resolved.onHit.some((fx) => fx.kind === 'burn-kill-detonate')).toBe(true);
    sys.castResolved('magma', 0, 0, 1, 0, player(100), 6, ranks, resolved);
    const neighHp = neighbor.hp;
    for (let i = 0; i < 20; i++) sys.tick(0.05, monsters);
    expect(primary.hp).toBeLessThanOrEqual(0);
    expect(neighbor.hp).toBeLessThan(neighHp);
  });

  test('deep-freeze refreshSlow extends remaining slow', () => {
    const { sys } = makeSystem();
    const m = fakeMonster({ x: 1.5, z: 0, slowUntil: 1.0 });
    const monsters = stubMonsters([m]);
    const ranks = {
      'frost-fang': 1, 'winters-grasp': 1, 'deep-freeze': 1,
    };
    const resolved = resolveSkill('frost', { skillRanks: ranks });
    expect(resolved.refreshSlowSec).toBe(0.5);
    const before = m.slowUntil;
    sys.castResolved('frost', 0, 0, 1, 0, player(100), 6, ranks, resolved);
    for (let i = 0; i < 20; i++) sys.tick(0.05, monsters);
    expect(m.slowUntil).toBeGreaterThan(before);
    expect(m.slowUntil).toBeGreaterThanOrEqual(before + 0.5);
  });

  test('tempest overcharge alsoAppliesTo reduces discharge CD', () => {
    const { sys } = makeSystem();
    const m = fakeMonster({ x: 1.2, z: 0 });
    const monsters = stubMonsters([m]);
    const ranks = {
      'arc-surge': 1, overcharge: 1, 'tempest-conduit': 1, discharge: 1,
    };
    const arc = resolveSkill('arc', { skillRanks: ranks });
    const cdr = arc.onHit.find((fx) => fx.kind === 'overcharge-cdr');
    expect(cdr && cdr.kind === 'overcharge-cdr' && cdr.alsoAppliesTo).toBe('discharge');
    const dIdx = sys.indexOf('discharge');
    sys.cooldowns[dIdx] = 2;
    sys.castResolved('arc', 0, 0, 1, 0, player(100), 6, ranks, arc);
    for (let i = 0; i < 30; i++) sys.tick(0.05, monsters);
    expect(sys.cooldowns[dIdx]!).toBeLessThan(2);
  });
});
