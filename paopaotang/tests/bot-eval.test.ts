import { describe, expect, test } from 'bun:test';
import report from '../docs/evidence/bot-eval-100/report.json';

describe('real-rule Soul bot evaluation', () => {
  test('keeps 100-match behavior statistically distinct', () => {
    expect(report.matches).toBe(100);
    expect(report.meaningful).toBe(true);
    expect(report.stats.aggressive.bubbles).toBeGreaterThan(report.stats.conservative.bubbles);
    expect(report.stats.conservative.items).toBeGreaterThan(report.stats.aggressive.items);
    expect(report.replayEvents).toBeGreaterThan(10_000);
  });
});
