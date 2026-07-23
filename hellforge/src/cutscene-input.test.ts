import { describe, expect, test } from 'bun:test';
import { cutsceneBlocksChromeKey } from './cutscene-input';

describe('cutsceneBlocksChromeKey', () => {
  test('blocks chrome while cutscene owns the UI layer', () => {
    expect(cutsceneBlocksChromeKey('cutscene')).toBe(true);
    expect(cutsceneBlocksChromeKey('inventory')).toBe(false);
    expect(cutsceneBlocksChromeKey(null)).toBe(false);
  });
});
