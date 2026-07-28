import { StubMinigame } from '../../impl/StubMinigame';
import { minigameContentRoot } from '../../../narrative/content/assetPath';
import { tags, type MinigameLibraryEntry } from '../types';

/** Mexico Demo pool M1–M6 — stubs today, swap `create` when shipped. */
export const CHAPTER_MX_MINIGAMES: MinigameLibraryEntry[] = [
  {
    id: 'm1_marigold_escort',
    title: '金盏花护送',
    chapterIds: ['chapter_mx'],
    nodeId: 'M1',
    tags: tags('coop', ['ofrenda'], ['carry']),
    status: 'stub',
    oneLiner: '四人合力把金盏花送到供坛，别掉队。',
    contentRoot: minigameContentRoot('m1_marigold_escort'),
    targetDurationSec: 60,
    priority: 'P0',
    create: () =>
      new StubMinigame('m1_marigold_escort', tags('coop', ['ofrenda'], ['carry']), 6),
  },
  {
    id: 'm2_sugar_skull_sync',
    title: '糖颅彩绘对拍',
    chapterIds: ['chapter_mx'],
    nodeId: 'M2',
    tags: tags('coop', ['skull'], ['observe']),
    status: 'stub',
    oneLiner: '对照影游线索，同步画对额纹。',
    contentRoot: minigameContentRoot('m2_sugar_skull_sync'),
    targetDurationSec: 50,
    priority: 'P0',
    create: () =>
      new StubMinigame('m2_sugar_skull_sync', tags('coop', ['skull'], ['observe']), 6),
  },
  {
    id: 'm3_papel_bridge',
    title: '剪纸廊桥',
    chapterIds: ['chapter_mx'],
    nodeId: 'M3',
    tags: tags('ffa', ['bridge'], ['survive']),
    status: 'stub',
    oneLiner: '站对格，纸桥碎了就掉下去。',
    contentRoot: minigameContentRoot('m3_papel_bridge'),
    targetDurationSec: 70,
    priority: 'P2',
    create: () =>
      new StubMinigame('m3_papel_bridge', tags('ffa', ['bridge'], ['survive']), 6),
  },
  {
    id: 'm4_altar_serve',
    title: '供坛上菜',
    chapterIds: ['chapter_mx'],
    nodeId: 'M4',
    tags: tags('coop', ['altar'], ['craft']),
    status: 'stub',
    oneLiner: '按线索分工：花烛骨甜，一次摆齐。',
    contentRoot: minigameContentRoot('m4_altar_serve'),
    targetDurationSec: 70,
    priority: 'P1',
    create: () =>
      new StubMinigame('m4_altar_serve', tags('coop', ['altar'], ['craft']), 6),
  },
  {
    id: 'm5_candle_chase',
    title: '烛火热区追逐',
    chapterIds: ['chapter_mx'],
    nodeId: 'M5',
    tags: tags('ffa', ['candle'], ['bait']),
    status: 'stub',
    oneLiner: '热区在扩，用诱饵把火引开。',
    contentRoot: minigameContentRoot('m5_candle_chase'),
    targetDurationSec: 75,
    priority: 'P2',
    create: () =>
      new StubMinigame('m5_candle_chase', tags('ffa', ['candle'], ['bait']), 6),
  },
  {
    id: 'm6_claw_parade',
    title: '清扫爪大游行',
    chapterIds: ['chapter_mx'],
    nodeId: 'M6',
    tags: tags('ffa', ['parade'], ['evacuate']),
    status: 'stub',
    oneLiner: '高潮撤离：抢缝隙下沉，末位罚糖衣。',
    contentRoot: minigameContentRoot('m6_claw_parade'),
    targetDurationSec: 90,
    priority: 'P1',
    create: () =>
      new StubMinigame('m6_claw_parade', tags('ffa', ['parade'], ['evacuate']), 8),
  },
];

/** Future Russia pool — planned only, not registered into runtime yet. */
export const CHAPTER_RU_MINIGAMES_PLANNED: MinigameLibraryEntry[] = [
  {
    id: 'ru_snow_relay',
    title: '雪糖接力（占位）',
    chapterIds: ['chapter_ru'],
    tags: tags('coop', ['snow'], ['relay']),
    status: 'planned',
    oneLiner: '待俄罗斯章解锁后实装。',
    contentRoot: minigameContentRoot('ru_snow_relay'),
    targetDurationSec: 60,
    priority: 'P2',
  },
];
