export interface AudioApi {
  startBgm(): void;
  playClick(): void;
  dispose(): void;
}

interface ManifestTrack {
  file: string;
  kind: 'bgm' | 'sfx';
}

interface AudioManifest {
  tracks: ManifestTrack[];
}

export function installAudio(): AudioApi {
  let bgm: HTMLAudioElement | null = null;
  let clickSfx: HTMLAudioElement | null = null;
  let started = false;

  async function loadManifest(): Promise<void> {
    try {
      const res = await fetch(new URL('../audio/manifest.json', import.meta.url));
      if (!res.ok) return;
      const manifest = (await res.json()) as AudioManifest;
      for (const t of manifest.tracks) {
        const url = new URL('../' + t.file, import.meta.url).href;
        if (t.kind === 'bgm' && !bgm) {
          bgm = new Audio(url);
          bgm.loop = true;
          bgm.volume = 0.35;
        }
        if (t.kind === 'sfx' && !clickSfx) {
          clickSfx = new Audio(url);
          clickSfx.volume = 0.5;
        }
      }
    } catch {
      /* no audio */
    }
  }

  void loadManifest();

  const tryBgm = () => {
    if (started || !bgm) return;
    started = true;
    bgm.play().catch(() => { started = false; });
  };

  // { once: true } auto-removes after firing, but Stop may happen before the
  // first gesture — so dispose() must also removeEventListener explicitly.
  window.addEventListener('pointerdown', tryBgm, { once: true });
  window.addEventListener('keydown', tryBgm, { once: true });

  return {
    startBgm() { tryBgm(); },
    playClick() { clickSfx?.cloneNode().play().catch(() => {}); },
    dispose() {
      window.removeEventListener('pointerdown', tryBgm);
      window.removeEventListener('keydown', tryBgm);
      bgm?.pause();
    },
  };
}
