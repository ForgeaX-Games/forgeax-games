import type { MaterialCard } from '../shared/types';

/** Per-chapter material deck. Demo: fixed tagged cards (no free text). */
export class CardDeck {
  constructor(readonly cards: MaterialCard[]) {}

  byId(id: string): MaterialCard | undefined {
    return this.cards.find((c) => c.id === id);
  }

  hand(size: number): MaterialCard[] {
    return this.cards.slice(0, Math.min(size, this.cards.length));
  }

  static demoMx(): CardDeck {
    const cards: MaterialCard[] = [
      { id: 'mx_marigold', name: '金盏花胶', element: 'glue', rarity: 2, flavorTags: ['花香', '祭'] },
      { id: 'mx_cocoa', name: '可可脂块', element: 'fat', rarity: 2, flavorTags: ['苦甜'] },
      { id: 'mx_sugar_crystal', name: '糖晶', element: 'crystal', rarity: 1, flavorTags: ['脆'] },
      { id: 'mx_chili_gas', name: '辣椒气雾', element: 'gas', rarity: 3, flavorTags: ['辣', '热'] },
      { id: 'mx_papel', name: '剪纸浆', element: 'glue', rarity: 1, flavorTags: ['彩'] },
      { id: 'mx_candle', name: '烛脂', element: 'fat', rarity: 2, flavorTags: ['暖'] },
      { id: 'mx_skull_glass', name: '糖颅玻渣', element: 'crystal', rarity: 3, flavorTags: ['骨'] },
      { id: 'mx_incense', name: '香氛气', element: 'gas', rarity: 1, flavorTags: ['烟'] },
      { id: 'mx_pan_dulce', name: '甜面包屑', element: 'fat', rarity: 1, flavorTags: ['面'] },
      { id: 'mx_obsidian', name: '黑曜糖核', element: 'crystal', rarity: 3, flavorTags: ['硬'] },
      { id: 'mx_alfeñique', name: '糖塑浆', element: 'glue', rarity: 2, flavorTags: ['塑'] },
      { id: 'mx_spark', name: '焰火粉气', element: 'gas', rarity: 2, flavorTags: ['爆'] },
    ];
    return new CardDeck(cards);
  }
}
