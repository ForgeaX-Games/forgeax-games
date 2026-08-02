import { describe, expect, test } from 'bun:test';
import { getLocalization } from '../src/localization';
import { get } from '../src/localization-runtime';

describe('localization catalog', () => {
  test('exposes stable dialogue and trash-talk domains', () => {
    const catalog = getLocalization();
    expect(catalog.dialogue.NPC_DIALOGUE).toHaveProperty('pudding');
    expect(catalog.dialogue.NPC_DIALOGUE).toHaveProperty('strawberry');
    expect(catalog.trashTalk.ENEMY_NAMES).toHaveLength(3);
  });

  test('renders localized menu labels and fails loudly for missing keys', () => {
    const keys = [
      'paopaotang.main.ts:53298:ab9cb6579d',
      'paopaotang.main.ts:56208:8e3ce667e6',
      'paopaotang.main.ts:56243:9114d9adae',
    ];
    for (const key of keys) {
      expect(get(key)).not.toBe('');
      expect(get(key)).not.toBe(key);
    }
    expect(() => get('paopaotang.missing:0:missing')).toThrow('Missing localization key');
  });
});
