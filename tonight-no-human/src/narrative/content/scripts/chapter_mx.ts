import type { NarrativeScript } from '../types';

const media = (file: string) => `content/narrative/chapter_mx/media/${file}`;

/** Opening narrative after role reveal. */
export const MX_OPEN: NarrativeScript = {
  id: 'mx_open',
  chapterId: 'chapter_mx',
  title: '坠入万灵糖境',
  durationSec: 45,
  mediaRoot: 'content/narrative/chapter_mx/media',
  assets: {
    master: { kind: 'master', path: media('mx_open_master.webp'), label: '开场主片' },
    dmPortrait: { kind: 'dmPortrait', path: media('dm_katrina.webp'), label: '卡特里娜糖' },
    privateStills: [0, 1, 2, 3].map((i) => ({
      kind: 'privateStill' as const,
      path: media(`mx_open_private_${i}.webp`),
      label: `私密特写 ${i}`,
    })),
  },
  beats: [
    { id: 'b0', atSec: 0, kind: 'title', text: '欢迎落入万灵糖境——今晚，别变回人。' },
    { id: 'b1', atSec: 8, kind: 'line', text: '糖神说：光看主片，拿不全线索。' },
    { id: 'b2', atSec: 18, kind: 'ruleIcon', text: '每人一条私密特征 · 语音拼合' },
    { id: 'b3', atSec: 28, kind: 'clueBeat', text: '私密线索已发到你的糖纸里' },
    { id: 'b4', atSec: 38, kind: 'line', text: '篮子在下沉。第一层：金盏花。' },
  ],
  clues: [
    { clueId: 'mx_open_0', body: '你看见供坛缺了一支金盏花——别告诉别人位置。', stillPath: media('mx_open_private_0.webp') },
    { clueId: 'mx_open_1', body: '糖颅左眼眶有道裂痕，像爪痕。', stillPath: media('mx_open_private_1.webp') },
    { clueId: 'mx_open_2', body: '剪纸廊桥第三扇窗后面有缝隙。', stillPath: media('mx_open_private_2.webp') },
    { clueId: 'mx_open_3', body: '清扫爪今晚会提早巡游一圈。', stillPath: media('mx_open_private_3.webp') },
  ],
  votes: [
    {
      id: 'mx_open_vote',
      prompt: '要不要先跟紧金盏花队伍？',
      options: [
        { id: 'follow', label: '跟上' },
        { id: 'scout', label: '分头探路' },
      ],
      openAtSec: 22,
      durationSec: 10,
    },
  ],
};

export const MX_N2: NarrativeScript = {
  id: 'mx_n2',
  chapterId: 'chapter_mx',
  title: '糖颅低语',
  durationSec: 20,
  mediaRoot: 'content/narrative/chapter_mx/media',
  assets: {
    master: { kind: 'master', path: media('mx_n2_master.webp') },
  },
  beats: [
    { id: 'b0', atSec: 0, kind: 'line', text: '彩绘未干。对拍时，看清对方额上的纹。' },
  ],
  clues: [
    { clueId: 'mx_n2_0', body: '对方额心有一朵金盏——那是今晚的标记。' },
    { clueId: 'mx_n2_1', body: '你的颅纹少了一笔，像被人舔走。' },
    { clueId: 'mx_n2_2', body: '供桌左侧多了一碟没点名的糖。' },
    { clueId: 'mx_n2_3', body: '廊桥纸屑写成「往下」。' },
  ],
};

export const MX_N3: NarrativeScript = {
  id: 'mx_n3',
  chapterId: 'chapter_mx',
  title: '纸桥风',
  durationSec: 18,
  mediaRoot: 'content/narrative/chapter_mx/media',
  assets: { master: { kind: 'master', path: media('mx_n3_master.webp') } },
  beats: [{ id: 'b0', atSec: 0, kind: 'line', text: '站错格，纸桥会碎。' }],
  clues: [],
};

export const MX_N4: NarrativeScript = {
  id: 'mx_n4',
  chapterId: 'chapter_mx',
  title: '上菜之前',
  durationSec: 20,
  mediaRoot: 'content/narrative/chapter_mx/media',
  assets: { master: { kind: 'master', path: media('mx_n4_master.webp') } },
  beats: [{ id: 'b0', atSec: 0, kind: 'line', text: '供坛要四样：花、烛、骨、甜。分工。' }],
  clues: [
    { clueId: 'mx_n4_0', body: '你负责花——但花在刚才那层被拿走了。' },
    { clueId: 'mx_n4_1', body: '烛芯要用融糖舔过才亮。' },
    { clueId: 'mx_n4_2', body: '骨碟只能硬糖端，软了会化。' },
    { clueId: 'mx_n4_3', body: '甜面包屑撒成螺旋，才算完工。' },
  ],
};

export const MX_N5: NarrativeScript = {
  id: 'mx_n5',
  chapterId: 'chapter_mx',
  title: '热区',
  durationSec: 18,
  mediaRoot: 'content/narrative/chapter_mx/media',
  assets: { master: { kind: 'master', path: media('mx_n5_master.webp') } },
  beats: [{ id: 'b0', atSec: 0, kind: 'line', text: '烛火会追人。诱饵不是你。' }],
  clues: [],
};

export const MX_N6: NarrativeScript = {
  id: 'mx_n6',
  chapterId: 'chapter_mx',
  title: '爪影',
  durationSec: 22,
  mediaRoot: 'content/narrative/chapter_mx/media',
  assets: { master: { kind: 'master', path: media('mx_n6_master.webp') } },
  beats: [{ id: 'b0', atSec: 0, kind: 'line', text: '清扫爪来了。往缝隙钻。' }],
  clues: [],
};

export const MX_FINALE: NarrativeScript = {
  id: 'mx_finale',
  chapterId: 'chapter_mx',
  title: '天亮前的钩子',
  durationSec: 35,
  mediaRoot: 'content/narrative/chapter_mx/media',
  assets: {
    master: { kind: 'master', path: media('mx_finale_master.webp') },
    dmPortrait: { kind: 'dmPortrait', path: media('dm_katrina.webp') },
  },
  beats: [
    { id: 'b0', atSec: 0, kind: 'line', text: '线索拼合。你们还认得彼此吗？' },
    { id: 'b1', atSec: 20, kind: 'hook', text: '北方有雪糖在落……' },
  ],
  clues: [],
  hookLine: '俄罗斯·糖果雪原——通关后解锁（Demo 仅揭示）。',
};

/** Short interstitial when a node has no dedicated script. */
export const MX_GAP: NarrativeScript = {
  id: 'mx_gap',
  chapterId: 'chapter_mx',
  title: '下沉',
  durationSec: 12,
  mediaRoot: 'content/narrative/chapter_mx/media',
  assets: {},
  beats: [{ id: 'b0', atSec: 0, kind: 'line', text: '篮子又沉了一层。' }],
  clues: [],
};

export const CHAPTER_MX_SCRIPTS: NarrativeScript[] = [
  MX_OPEN,
  MX_N2,
  MX_N3,
  MX_N4,
  MX_N5,
  MX_N6,
  MX_FINALE,
  MX_GAP,
];
