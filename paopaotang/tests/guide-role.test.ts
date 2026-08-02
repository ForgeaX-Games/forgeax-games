import { get } from "../src/localization";
import { describe, expect, test } from 'bun:test';
import { TownSim, type ResidentDef, type TownApi } from '../src/town';

// Mirrors the wiring in src/npcs/guide: a resident tagged role:'guide' that
// homes at PLAZA_E and is only supposed to greet — never work, never brawl.
const guide: ResidentDef = {
  key: 'guide',
  prefix: 'Guide',
  name: 'Guide',
  home: 'PLAZA_E',
  workTalk: get("paopaotang.tests/guide-role.test.ts:389:22791f77ef"),
  role: 'guide',
};

const brawlerA: ResidentDef = {
  key: 'pudding',
  prefix: 'NpcA',
  name: 'Pudding',
  home: 'HOUSE_A',
  workTalk: 'Working.',
};

const brawlerB: ResidentDef = {
  key: 'soda',
  prefix: 'NpcB',
  name: 'Soda',
  home: 'HOUSE_B',
  workTalk: 'Working.',
};

const api: TownApi = {
  chat: () => {},
  matchRunning: () => false,
};

function town(): TownSim {
  return new TownSim([guide, brawlerA, brawlerB], [['Hello.'], ['Hi.'], ['Hey.']]);
}

describe('Guide (digital-life plaza greeter)', () => {
  test('the guide is a patient, stationary greeter — never wanders off post', () => {
    const sim = town();
    const g = sim.residents.find((r) => r.def.key === 'guide')!;
    // idle it forward through many decide ticks with a live match running:
    // ordinary residents would leave to heckle from the stands; the guide stays.
    const busy: TownApi = { chat: () => {}, matchRunning: () => true };
    for (let i = 0; i < 40; i++) sim.update(0.5, busy, { x: 0, z: 14 });
    expect(g.def.role).toBe('guide');
    expect(g.activity).toBe('idle');
    expect(g.moving).toBe(false);
  });

  test(get("paopaotang.tests/guide-role.test.ts:1538:de3fb53aa3"), () => {
    const sim = town();
    // with the guide + two brawlers free, the match must draw the two brawlers
    // and never the guide.
    const pair = sim.requestContestants();
    expect(pair).not.toBeNull();
    const keys = pair!.map((r) => r.def.key);
    expect(keys).not.toContain('guide');
    expect(keys.sort()).toEqual(['pudding', 'soda']);
  });

  test('the Brain can still steer the guide via goto + wave intents', () => {
    const sim = town();
    const g = sim.residents.find((r) => r.def.key === 'guide')!;

    // goto: an authored waypoint is accepted and takes over as a brain override.
    expect(sim.applyBodyIntent('guide', { action: 'goto', waypoint: 'GATE' }, 5)).toBe(true);
    expect(g.activity).toBe('brain');

    // wave: the only emote the guide's affordance allows.
    expect(sim.applyBodyIntent('guide', { action: 'emote', emote: 'wave' }, 3)).toBe(true);
    expect(g.brainIntent?.action).toBe('emote');
    sim.update(0.5, api);
    expect(g.moving).toBe(false);
  });
});
