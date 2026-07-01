import manifest from '../../audio/manifest.json';

export interface AudioApi {
  startBgm(): void;
  playClick(): void;
  playDice(): void;
  dispose(): void;
}

function trackFile(kind: 'bgm' | 'sfx', namePart: string): string | null {
  const t = manifest.tracks.find((x) => x.kind === kind && x.file.includes(namePart));
  return t?.file ?? null;
}

export function installAudio(): AudioApi {
  let bgm: HTMLAudioElement | null = null;
  const clickFile = trackFile('sfx', 'click');
  const diceFile = trackFile('sfx', 'throw');

  // Non-DOM side effects that outlive the ECS world: the BGM/SFX Audio elements
  // and the window unlock listeners. Tracked so ■ Stop can silence + detach them
  // (the controlled uiRoot removal only reaches DOM, never these).
  let unlockHandler: (() => void) | null = null;

  const removeUnlock = () => {
    if (!unlockHandler) return;
    window.removeEventListener('pointerdown', unlockHandler);
    window.removeEventListener('keydown', unlockHandler);
    unlockHandler = null;
  };

  const startBgm = () => {
    const f = trackFile('bgm', 'Turn-based');
    if (!f) return;
    bgm = new Audio(new URL(`../../${f}`, import.meta.url).href);
    bgm.loop = true;
    bgm.volume = 0.35;
    bgm.play().catch(() => {});
    const unlock = () => {
      bgm?.play().catch(() => {});
      removeUnlock();
    };
    unlockHandler = unlock;
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  };

  const playSfx = (file: string | null) => {
    if (!file) return;
    const a = new Audio(new URL(`../../${file}`, import.meta.url).href);
    a.volume = 0.55;
    a.play().catch(() => {});
  };

  return {
    startBgm,
    playClick: () => playSfx(clickFile),
    playDice: () => playSfx(diceFile),
    dispose() {
      removeUnlock();
      if (bgm) {
        bgm.pause();
        bgm = null;
      }
    },
  };
}
