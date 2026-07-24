// PR4a T3 — Beat script shape / duration / L1 id conformance.

import { describe, expect, test } from 'bun:test';
import { degToRad, type CameraRigState } from './camera-rig';
import {
  buildBossDefeatBeat,
  buildBossEntranceBeat,
  buildCampArrivalBeat,
  buildQuestAcceptanceBeat,
} from './cinematic-beats';
import {
  BEAT_BOSS_DEFEAT,
  BEAT_BOSS_ENTRANCE,
  BEAT_CAMP_ARRIVAL,
  BEAT_QUEST_ACCEPTANCE,
  L1_WORLD_POLICY,
} from './cinematic-policy';
import { sampleCutscene } from './cutscene';

function rig(distance = 12): CameraRigState {
  return {
    mode: 'arpg',
    focus: [0, 0, 0],
    eye: [0, distance, distance],
    yaw: 0,
    pitch: -degToRad(52),
    distance,
    verticalFovRad: degToRad(45),
    shake: [0, 0, 0],
  };
}

describe('PR4a T3 narrative beats', () => {
  test('camp-arrival id matches L1 camp policy key; skippable', () => {
    const beat = buildCampArrivalBeat({
      camera: rig(12),
      playerXZ: [0, 5],
    });
    expect(beat.id).toBe(BEAT_CAMP_ARRIVAL);
    expect(beat.id).toBe('camp-intro');
    expect(L1_WORLD_POLICY[beat.id]).toBeDefined();
    expect(L1_WORLD_POLICY[beat.id]!.freezeAi).toBe(false);
    expect(beat.skippable).toBe(true);
    expect(beat.duration).toBeGreaterThan(0);
    expect(sampleCutscene(beat, beat.duration).done).toBe(true);
  });

  test('quest-acceptance ≤3 s, L1 camp policy id, skippable', () => {
    const beat = buildQuestAcceptanceBeat({
      camera: rig(),
      playerXZ: [0, 5],
      veyraXZ: [3.2, 2],
    });
    expect(beat.id).toBe(BEAT_QUEST_ACCEPTANCE);
    expect(L1_WORLD_POLICY[beat.id]!.freezeAi).toBe(false);
    expect(beat.skippable).toBe(true);
    expect(beat.duration).toBeLessThanOrEqual(3);
    expect(sampleCutscene(beat, beat.duration).done).toBe(true);
  });

  test('boss-entrance / boss-defeat use den L1 ids and are skippable', () => {
    const entrance = buildBossEntranceBeat({
      camera: rig(),
      playerXZ: [0, 0],
      bossXZ: [8, -4],
    });
    const defeat = buildBossDefeatBeat({
      camera: rig(),
      playerXZ: [0, 0],
      bossXZ: [8, -4],
    });
    expect(entrance.id).toBe(BEAT_BOSS_ENTRANCE);
    expect(defeat.id).toBe(BEAT_BOSS_DEFEAT);
    expect(L1_WORLD_POLICY[entrance.id]!.freezeAi).toBe(true);
    expect(L1_WORLD_POLICY[defeat.id]!.playerInvulnerable).toBe(true);
    expect(entrance.skippable).toBe(true);
    expect(defeat.skippable).toBe(true);
    expect(entrance.duration).toBeGreaterThan(0);
    expect(defeat.duration).toBeGreaterThan(0);
    expect(sampleCutscene(entrance, entrance.duration).done).toBe(true);
    expect(sampleCutscene(defeat, defeat.duration).done).toBe(true);
  });

  test('boss-entrance camera drifts toward boss XZ', () => {
    const beat = buildBossEntranceBeat({
      camera: rig(),
      playerXZ: [0, 0],
      bossXZ: [10, -6],
    });
    const end = sampleCutscene(beat, beat.duration).camera.focus;
    expect(end[0]).toBeCloseTo(10, 0);
    expect(end[2]).toBeCloseTo(-6, 0);
  });

  test('major beats open letterbox chrome at t=0 (cutscene-ui surface)', () => {
    const beats = [
      buildCampArrivalBeat({ camera: rig(), playerXZ: [0, 5] }),
      buildQuestAcceptanceBeat({ camera: rig(), playerXZ: [0, 5], veyraXZ: [2, 1] }),
      buildBossEntranceBeat({ camera: rig(), playerXZ: [0, 0], bossXZ: [8, -4] }),
      buildBossDefeatBeat({ camera: rig(), playerXZ: [0, 0], bossXZ: [8, -4] }),
    ];
    for (const beat of beats) {
      expect(sampleCutscene(beat, 0).letterbox).toBe(1);
    }
  });
});
