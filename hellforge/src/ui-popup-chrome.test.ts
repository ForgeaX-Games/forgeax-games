import { describe, expect, test } from 'bun:test';
import { popupChromeStyles } from './ui-popup-chrome';
import { pointerPolicyFor, VISUAL_POLISH_Z } from './visual-polish-contracts';

describe('popupChromeStyles (N2)', () => {
  test('loot celebration is card-only non-blocking side card', () => {
    expect(pointerPolicyFor('lootCelebration')).toBe('card-only');
    const s = popupChromeStyles('lootCelebration', { scoped: true, side: 'right' });
    expect(s.policy).toBe('card-only');
    expect(s.zIndex).toBe(VISUAL_POLISH_Z.lootCelebration);
    expect(s.rootCss).toContain('pointer-events:none');
    expect(s.rootCss).not.toContain('0.82');
    expect(s.cardCss).toContain('pointer-events:auto');
  });

  test('confirm kinds block with auto policy', () => {
    expect(pointerPolicyFor('salvageConfirm')).toBe('auto');
    const s = popupChromeStyles('deleteCharConfirm', { scoped: true });
    expect(s.policy).toBe('auto');
    expect(s.rootCss).toContain('pointer-events:auto');
    expect(s.rootCss).toContain('0.72');
  });
});
