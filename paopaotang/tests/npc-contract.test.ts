import { describe, expect, test } from 'bun:test';
import { collectGameNpcContract, checkGameNpcContract } from '../../../../scripts/check-game-npc-contract';

describe('game NPC contract gate', () => {
  test('enumerates the brain, every NPC index, guide, registry, and Soul manifest', () => {
    const report = collectGameNpcContract();
    expect(report.channels.ts.some((file) => file === 'src/npc-brain.ts')).toBe(true);
    expect(report.channels.ts.some((file) => file === 'src/npcs/index.ts')).toBe(true);
    expect(report.channels.ts.some((file) => file === 'src/npcs/guide/index.ts')).toBe(true);
    expect(report.channels.manifests).toContain('souls/paopaotang.guide/agent.json');
    expect(report.guideRegistered).toBe(true);
  });

  test('fails a report that exceeds G1 or contains an anti-pattern', () => {
    const failures = checkGameNpcContract({
      files: [], businessLines: 401, antiPatternHits: ['src/npc-brain.ts: fetch'], guideRegistered: true,
      channels: { ts: [], fixtures: [], manifests: [] },
    });
    expect(failures).toHaveLength(2);
  });
});
