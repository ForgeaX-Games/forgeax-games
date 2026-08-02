import { describe, expect, test } from 'bun:test';
import baseline from './scale-baseline.json';

describe('NPC render acceptance baseline', () => {
  test('keeps real-engine scale evidence inside PRD thresholds', () => {
    expect(baseline.body.bodyCount).toBe(5_000);
    expect(baseline.body.renderEntities).toBe(3);
    expect(baseline.spotlight.spotlightCount).toBe(30);
    expect(baseline.prdGate.spotlightSessionLoaded).toBe(30);
    expect(baseline.prdGate.maxCallsPerMinute).toBeLessThanOrEqual(10);
    expect(baseline.fpsDifferencePct).toBeLessThan(10);
  });
});
