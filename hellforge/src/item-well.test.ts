// Shared well chrome unit tests — itemWellCss / itemWellShadow (N2R
// extraction from inventory-ui, now shared with the forge cube). Assert the
// contract surface: gold-brown metal bezel + inset depth, quality color only
// as an inner ring / faint glow, empties sink deeper.

import { describe, expect, test } from 'bun:test';
import { itemWellCss, itemWellShadow } from './item-well';
import { RARITY_META } from './items';
import { Ui } from './ui-theme';

describe('itemWellCss', () => {
  test('empty well: dimmed gold-brown bezel + deep pit, no quality ring', () => {
    const css = itemWellCss({ rarity: null, filled: false });
    expect(css).toContain('border:1px solid rgba(168,132,64,0.45)');
    expect(css).toContain('inset 0 6px 16px rgba(0,0,0,0.75)'); // deeper pit
    expect(css).toContain('0 0 0 1px rgba(0,0,0,0.7)'); // dark outer ring
    expect(css).not.toContain('inset 0 0 0 1.5px'); // never a quality ring
    expect(css).not.toContain('#8a6828');
  });

  test('filled common well: goldMetal bezel + gold-brown wash, quality ring on top', () => {
    const css = itemWellCss({ rarity: 'common', filled: true });
    expect(css).toContain(`border:1px solid ${Ui.goldMetal}`);
    expect(css).toContain('linear-gradient(180deg,#a884400a,#a884400f)'); // D3 card-back wash
    expect(css).toContain(`inset 0 0 0 1.5px ${RARITY_META.common.color}cc`);
  });

  test('filled magic/rare wells: quality stays an inner ring + faint glow, edge stays metal', () => {
    const magic = itemWellCss({ rarity: 'magic', filled: true });
    expect(magic).toContain(`border:1px solid ${Ui.goldMetal}`);
    expect(magic).toContain(`inset 0 0 0 1.5px ${RARITY_META.magic.color}cc`);
    expect(magic).toContain(`inset 0 0 12px ${RARITY_META.magic.color}33`);
    const rare = itemWellCss({ rarity: 'rare', filled: true });
    expect(rare).toContain(`border:1px solid ${Ui.goldMetal}`);
    expect(rare).toContain(`inset 0 0 0 1.5px ${RARITY_META.rare.color}cc`);
  });

  test('filled well uses seated depth, not the empty-pit shadow', () => {
    const css = itemWellCss({ rarity: 'magic', filled: true });
    expect(css).toContain('inset 0 3px 8px rgba(0,0,0,0.75)');
    expect(css).not.toContain('inset 0 6px 16px rgba(0,0,0,0.75)');
  });
});

describe('itemWellShadow (hover base)', () => {
  test('null rarity → empty-pit layers only', () => {
    expect(itemWellShadow(null)).not.toContain('inset 0 0 0 1.5px');
    expect(itemWellShadow(null)).toContain('inset 0 6px 16px rgba(0,0,0,0.75)');
  });

  test('seated rarity → quality ring included', () => {
    expect(itemWellShadow('rare')).toContain(`inset 0 0 0 1.5px ${RARITY_META.rare.color}cc`);
  });
});
