import manifest from '../../audio/manifest.json';

export interface AudioApi {
  startBgm(): void;
  playClick(): void;
  playDice(): void;
}

function trackFile(kind: 'bgm' | 'sfx', namePart: string): string | null {
  const t = manifest.tracks.find((x) => x.kind === kind && x.file.includes(namePart));
  return t?.file ?? null;
}

export function installAudio(): AudioApi {
  let bgm: HTMLAudioElement | null = null;
  const clickFile = trackFile('sfx', 'click');
  const diceFile = trackFile('sfx', 'throw');

  const startBgm = () => {
    const f = trackFile('bgm', 'Turn-based');
    if (!f) return;
    bgm = new Audio(new URL(`../../${f}`, import.meta.url).href);
    bgm.loop = true;
    bgm.volume = 0.35;
    bgm.play().catch(() => {});
    const unlock = () => {
      bgm?.play().catch(() => {});
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
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
  };
}
