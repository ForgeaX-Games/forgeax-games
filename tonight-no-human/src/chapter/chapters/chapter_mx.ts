import type { ChapterDef, NodeDef } from '../../shared/types';

/** Mexico · Día de Muertos candy realm — Demo chapter. */
export const CHAPTER_MX: ChapterDef = {
  id: 'chapter_mx',
  title: '墨西哥·万灵糖境',
  unlocked: true,
  materialTheme: 'ofrenda',
  dmSkinId: 'katrina_sugar',
  nodes: [
    { id: 'M1', title: '金盏花护送', minigameId: 'm1_marigold_escort', type: 'coop', narrativeId: 'mx_open' },
    { id: 'M2', title: '糖颅彩绘对拍', minigameId: 'm2_sugar_skull_sync', type: 'coop', narrativeId: 'mx_n2' },
    { id: 'M3', title: '剪纸廊桥', minigameId: 'm3_papel_bridge', type: 'ffa', narrativeId: 'mx_n3' },
    { id: 'M4', title: '供坛上菜', minigameId: 'm4_altar_serve', type: 'coop', narrativeId: 'mx_n4' },
    { id: 'M5', title: '烛火热区追逐', minigameId: 'm5_candle_chase', type: 'ffa', narrativeId: 'mx_n5' },
    { id: 'M6', title: '清扫爪大游行', minigameId: 'm6_claw_parade', type: 'ffa', narrativeId: 'mx_n6' },
  ],
};

/** Russia hook — locked in lobby for Demo. */
export const CHAPTER_RU: ChapterDef = {
  id: 'chapter_ru',
  title: '俄罗斯·糖果雪原',
  unlocked: false,
  materialTheme: 'snow_candy',
  dmSkinId: 'frost_dm',
  nodes: [],
};

export const CHAPTER_CATALOG: ChapterDef[] = [CHAPTER_MX, CHAPTER_RU];

export function getChapter(id: string): ChapterDef | undefined {
  return CHAPTER_CATALOG.find((c) => c.id === id);
}

/** Demo minimal slice: M1 / M2 / M4 / M6 */
export function demoNodePlaylist(chapter: ChapterDef): NodeDef[] {
  const keep = new Set(['M1', 'M2', 'M4', 'M6']);
  const filtered = chapter.nodes.filter((n) => keep.has(n.id));
  return filtered.length > 0 ? filtered : chapter.nodes.slice(0, 2);
}
