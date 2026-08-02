import { describe, expect, test } from 'bun:test';
import { TownSim, type ResidentDef, type TownApi } from '../src/town';

const resident: ResidentDef = {
  key: 'pudding',
  prefix: 'NpcA',
  name: 'Pudding',
  home: 'HOUSE_A',
  workTalk: 'Working.',
};

const api: TownApi = {
  chat: () => {},
  matchRunning: () => false,
};

function town(): TownSim {
  return new TownSim([resident], [['Hello.']]);
}

describe('TownSim Brain body intents', () => {
  test('applies goto and returns control to needs behavior after TTL', () => {
    const sim = town();

    expect(sim.applyBodyIntent('pudding', { action: 'goto', waypoint: 'PLAZA' }, 1)).toBe(true);
    expect(sim.residents[0]!.activity).toBe('brain');

    sim.update(1.1, api, { x: 0, z: 14 });

    expect(sim.residents[0]!.brainIntent).toBeNull();
    expect(sim.residents[0]!.activity).not.toBe('brain');
  });

  test('follows the player without replacing local movement permanently', () => {
    const sim = town();
    const before = { x: sim.residents[0]!.x, z: sim.residents[0]!.z };

    expect(sim.applyBodyIntent('pudding', { action: 'follow', target: 'player' }, 5)).toBe(true);
    sim.update(0.5, api, { x: 0, z: 14 });

    expect(sim.residents[0]!.x).not.toBe(before.x);
    expect(sim.residents[0]!.z).not.toBe(before.z);
    expect(sim.residents[0]!.moving).toBe(true);
  });

  test('bounds emotes and accepts SDK-driven early expiration', () => {
    const sim = town();

    expect(sim.applyBodyIntent('pudding', { action: 'emote', emote: 'cheer' }, 30)).toBe(true);
    sim.update(0.5, api);
    expect(sim.residents[0]!.moving).toBe(false);

    expect(sim.expireBodyIntent('pudding')).toBe(true);
    expect(sim.residents[0]!.brainIntent).toBeNull();
    expect(sim.residents[0]!.activity).toBe('idle');
  });

  test('rejects unknown waypoints and follow targets', () => {
    const sim = town();

    expect(sim.applyBodyIntent('pudding', { action: 'goto', waypoint: 'MISSING' }, 5)).toBe(false);
    expect(sim.applyBodyIntent('pudding', { action: 'follow', target: 'missing' }, 5)).toBe(false);
  });

  test('goto during player dialogue leads the player to the destination', () => {
    const sim = town();
    const r = sim.residents[0]!;

    // Start a player talk (NPC freezes)
    sim.beginPlayerTalk(r);
    expect(r.activity).toBe('talkPlayer');
    expect(r.moving).toBe(false);

    // Brain issues the existing goto affordance to guide player to the gate.
    expect(sim.applyBodyIntent('pudding', { action: 'goto', waypoint: 'GATE' }, 30)).toBe(true);
    expect(r.activity).toBe('talkLeading');
    expect(r.leadTarget).toBe('GATE');
    expect(r.leadArrived).toBe(false);

    // NPC should start walking toward the gate
    const before = { x: r.x, z: r.z };
    sim.update(0.5, api, { x: r.x, z: r.z });
    // After update, NPC should be moving toward GATE
    expect(r.moving).toBe(true);

    // Keep updating until arrival (GATE is at x=9.2, z=9.4)
    // Route: HOUSE_A -> HOUSE_B -> W_JUNC -> PLAZA_W -> PLAZA -> PLAZA_E -> E_JUNC -> BOOTH_N -> GATE
    // Distance is roughly 40+ units, walking speed is 2.3, so about 18+ seconds
    for (let i = 0; i < 100 && !r.leadArrived; i++) {
      sim.update(0.5, api, { x: r.x, z: r.z });
    }
    expect(r.leadArrived).toBe(true);

    // Ending player talk cleans up lead state
    sim.endPlayerTalk(r);
    expect(r.activity).toBe('idle');
    expect(r.leadTarget).toBeNull();
    expect(r.leadArrived).toBe(false);
  });

  test('dialogue goto is rejected for unknown waypoints', () => {
    const sim = town();
    const r = sim.residents[0]!;
    sim.beginPlayerTalk(r);

    expect(sim.applyBodyIntent('pudding', { action: 'goto', waypoint: 'MISSING' }, 30)).toBe(false);
    expect(r.activity).toBe('talkPlayer'); // unchanged
  });

  test('goto outside dialogue remains a normal bounded Brain intent', () => {
    const sim = town();
    expect(sim.applyBodyIntent('pudding', { action: 'goto', waypoint: 'GATE' }, 30)).toBe(true);
    expect(sim.residents[0]!.activity).toBe('brain');
  });
});
