/**
 * STORY — 极光骑士团 · AURORA KNIGHTS
 *
 * 飞机大战的剧情数据 + 叙事 UI（开场 / Wave 横幅 / 通关结局）。
 * // 让游戏不只是打飞机，而是真的在保卫一座城~ ♪
 */

export interface StoryBeat {
  /** 当 score >= threshold 时触发 */
  scoreThreshold: number;
  /** 旗号（小标题） */
  tag: string;
  /** 主标题 */
  title: string;
  /** 描述文字 */
  body: string;
  /** 主色调 */
  color: string;
  /** 横幅停留秒数（默认 4.5） */
  duration?: number;
  /** 已触发？（运行时态） */
  fired?: boolean;
}

// ─── 内容 ────────────────────────────────────────────────────────────────

const INTRO_TITLE = '极光骑士团 · AURORA KNIGHTS';
const INTRO_SUB = 'PROLOGUE — 黎明前的最后一架战机';
const INTRO_BODY = [
  '新苍穹市，2087 年深夜。',
  '轨道上沉睡了三十年的「残烬军团」突然觉醒，',
  '钢铁尸群从云层撕裂处倾泻而下，',
  '城市的霓虹一盏接一盏被吞没……',
  '',
  '你是「极光骑士团」最后的现役飞行员，',
  '驾驶量产前的原型战机「苍鹰」起飞。',
  '如果你撑不住——这座城就完了。',
];
const INTRO_CTRLS = '［WASD / 方向键］移动　　［空格］射击　　［R］重开';
const INTRO_HINT = '［ 按 空 格 键 起 飞 ］';

export const STORY_BEATS: ReadonlyArray<StoryBeat> = [
  {
    scoreThreshold: 2000,
    color: '#00e5ff',
    tag: '▸ INCOMING ◂',
    title: 'WAVE 01 · 突破外环封锁',
    body: '余烬侦察机群已撕开外环防线，灰隼战机正涌入主城——稳住航向，骑士。',
  },
  {
    scoreThreshold: 6000,
    color: '#ff8a00',
    tag: '▸ ALERT ◂',
    title: 'WAVE 02 · 钢铁之雨',
    body: '重锤轰炸机抵达工业区上空，炼钢厂告急。当心空降的废铁货柜！',
  },
  {
    scoreThreshold: 12000,
    color: '#ff3388',
    tag: '▸ CRITICAL ◂',
    title: 'WAVE 03 · 红河之战',
    body: '尖啸截击机沿红河推进，钢墓无畏舰浮出云海——绕开主炮，从侧翼穿插！',
  },
  {
    scoreThreshold: 22000,
    color: '#c46bff',
    tag: '▸ BOSS WAVE ◂',
    title: 'WAVE 04 · 黑日降临',
    body: '黑日母舰投下了它的影子。残烬军团的核心指令官就在那艘船上。',
  },
  {
    scoreThreshold: 35000,
    color: '#9cffb1',
    tag: '▸ FINALE ◂',
    title: 'FINALE · 极光破晓',
    body: '母舰外壳已现裂痕——再一次，再一次就行了！把黎明带回来！',
  },
];

/** 通关阈值 —— score 达到此值即触发通关结局 */
export const VICTORY_SCORE = 50000;

const ENDING_TITLE = '✦ 极光破晓 ✦';
const ENDING_BODY = [
  '黑日母舰在初阳里崩成了铁屑雨，',
  '新苍穹市的霓虹一盏接一盏重新亮起。',
  '',
  '塔台里有人哭着喊你的呼号——',
  '「苍鹰，欢迎回家。」',
];
const ENDING_HINT = '［R］再 来 一 局';

// ─── UI ──────────────────────────────────────────────────────────────────

export interface StoryUi {
  showIntro(): void;
  hideIntro(): void;
  showBeat(beat: StoryBeat): void;
  showEnding(score: number): void;
  hideEnding(): void;
  /** 每帧调用，推进横幅淡出计时 */
  tick(dt: number): void;
  /** 通关时把游戏内 HUD 隐藏给结局让位（可选） */
}

export function createStoryUi(): StoryUi {
  // SSR / 无 DOM 环境的空实现
  if (typeof document === 'undefined') {
    return {
      showIntro() {}, hideIntro() {},
      showBeat() {}, showEnding() {}, hideEnding() {}, tick() {},
    };
  }

  // 一次性注入 keyframes（避免页面里重复添加）
  if (!document.getElementById('story-anim-styles')) {
    const s = document.createElement('style');
    s.id = 'story-anim-styles';
    s.textContent = `
      @keyframes storyFadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes storyPulse { 0%,100% { opacity: 0.55; } 50% { opacity: 1; } }
      @keyframes storyBeatIn { 0% { opacity: 0; transform: translateX(-50%) scale(0.85); } 60% { opacity: 1; transform: translateX(-50%) scale(1.05); } 100% { opacity: 1; transform: translateX(-50%) scale(1); } }
    `;
    document.head.appendChild(s);
  }

  // ── 开场全屏 ──
  const intro = document.createElement('div');
  intro.style.cssText = [
    'position:fixed', 'inset:0',
    'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
    'background:radial-gradient(ellipse at center,rgba(5,15,40,0.88),rgba(0,0,10,0.96))',
    'backdrop-filter:blur(6px)',
    'z-index:99999',
    'font-family:"Orbitron","Courier New",monospace',
    'color:#cfe',
    'text-align:center',
    'padding:24px',
    'animation:storyFadeIn 0.7s ease-out',
  ].join(';');
  intro.innerHTML = `
    <div style="font-size:clamp(28px,5vw,46px);font-weight:bold;color:#9cf;text-shadow:0 0 16px #08f,0 0 36px #06f;letter-spacing:6px;margin-bottom:6px;">${INTRO_TITLE}</div>
    <div style="font-size:clamp(13px,1.6vw,18px);color:#7af;letter-spacing:4px;margin-bottom:32px;text-shadow:0 0 8px #08f;">${INTRO_SUB}</div>
    <div style="font-size:clamp(14px,1.6vw,18px);line-height:1.95;color:#cde;max-width:680px;margin-bottom:30px;text-shadow:0 0 4px rgba(0,180,255,0.4);">
      ${INTRO_BODY.map(l => l ? `<div>${l}</div>` : '<div style="height:10px;"></div>').join('')}
    </div>
    <div style="font-size:13px;color:#7aa;letter-spacing:3px;margin-bottom:24px;">${INTRO_CTRLS}</div>
    <div style="font-size:clamp(18px,2.2vw,24px);color:#ffd76b;text-shadow:0 0 12px #fa0,0 0 28px #f80;animation:storyPulse 1.4s ease-in-out infinite;letter-spacing:6px;">${INTRO_HINT}</div>
  `;
  intro.style.display = 'none';
  document.body.appendChild(intro);

  // ── Wave 横幅（瞬时） ──
  const beat = document.createElement('div');
  beat.style.cssText = [
    'position:fixed', 'top:22%', 'left:50%', 'transform:translateX(-50%)',
    'font-family:"Orbitron","Courier New",monospace',
    'text-align:center', 'z-index:99998', 'pointer-events:none',
    'opacity:0', 'transition:opacity 0.5s ease-out',
    'max-width:80vw',
  ].join(';');
  document.body.appendChild(beat);

  // ── 通关结局 ──
  const ending = document.createElement('div');
  ending.style.cssText = [
    'position:fixed', 'inset:0',
    'display:flex', 'flex-direction:column', 'align-items:center', 'justify-content:center',
    'background:radial-gradient(ellipse at center,rgba(40,60,80,0.88),rgba(5,5,20,0.96))',
    'backdrop-filter:blur(8px)',
    'z-index:99999',
    'font-family:"Orbitron","Courier New",monospace',
    'color:#9cffb1', 'text-align:center', 'padding:24px',
  ].join(';');
  ending.style.display = 'none';
  document.body.appendChild(ending);

  let beatTimer = 0;

  return {
    showIntro() {
      intro.style.display = 'flex';
      intro.style.opacity = '1';
    },
    hideIntro() {
      intro.style.transition = 'opacity 0.6s ease-out';
      intro.style.opacity = '0';
      setTimeout(() => { intro.style.display = 'none'; }, 650);
    },
    showBeat(b) {
      beat.innerHTML = `
        <div style="font-size:14px;color:${b.color};letter-spacing:8px;margin-bottom:8px;text-shadow:0 0 10px ${b.color};font-weight:bold;">${b.tag}</div>
        <div style="font-size:clamp(22px,3.4vw,36px);font-weight:bold;color:${b.color};text-shadow:0 0 14px ${b.color},0 0 30px ${b.color};letter-spacing:3px;margin-bottom:14px;">${b.title}</div>
        <div style="font-size:clamp(13px,1.5vw,17px);color:#fff;line-height:1.6;background:rgba(0,5,20,0.65);padding:10px 22px;border-radius:8px;border:1px solid ${b.color};display:inline-block;text-shadow:0 0 4px ${b.color};">${b.body}</div>
      `;
      beat.style.animation = 'storyBeatIn 0.5s ease-out';
      beat.style.opacity = '1';
      beatTimer = b.duration ?? 4.5;
    },
    showEnding(score) {
      ending.innerHTML = `
        <div style="font-size:clamp(36px,6vw,56px);font-weight:bold;color:#9cffb1;text-shadow:0 0 18px #4fa,0 0 40px #2c6;letter-spacing:10px;margin-bottom:30px;animation:storyFadeIn 1.2s ease-out;">${ENDING_TITLE}</div>
        <div style="font-size:clamp(15px,1.8vw,20px);line-height:2;color:#dfe;max-width:680px;margin-bottom:22px;text-shadow:0 0 6px rgba(80,255,150,0.4);animation:storyFadeIn 1.6s ease-out;">
          ${ENDING_BODY.map(l => l ? `<div>${l}</div>` : '<div style="height:10px;"></div>').join('')}
        </div>
        <div style="font-size:clamp(14px,1.5vw,17px);color:#7aa;letter-spacing:3px;margin-bottom:14px;">最 终 得 分</div>
        <div style="font-size:clamp(36px,5vw,52px);color:#ffd76b;text-shadow:0 0 14px #fa0,0 0 30px #f80;letter-spacing:4px;margin-bottom:32px;font-weight:bold;">${score} pts</div>
        <div style="font-size:clamp(16px,1.8vw,20px);color:#ffd76b;text-shadow:0 0 10px #fa0;letter-spacing:4px;animation:storyPulse 1.4s ease-in-out infinite;">${ENDING_HINT}</div>
      `;
      ending.style.display = 'flex';
    },
    hideEnding() {
      ending.style.display = 'none';
    },
    tick(dt) {
      if (beatTimer > 0) {
        beatTimer -= dt;
        if (beatTimer <= 0) beat.style.opacity = '0';
      }
    },
  };
}
