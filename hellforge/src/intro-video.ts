/**
 * Intro / PV boot gate (N1).
 *
 * Owns: click-gate → optional <video> → exactly-once completion → title handoff.
 * Does NOT own ShellState. Uses visual-polish-contracts intro latch + Z.
 *
 * Asset fallback (A1 missing): after gesture, complete with `missingAsset`
 * (poster-only / skip path) — never invent a fake MP4.
 */

import {
  VISUAL_POLISH_Z,
  createIntroCompletionLatch,
  type IntroTerminalReason,
} from './visual-polish-contracts';
import { FONT_DISPLAY, FONT_UI, Ui } from './ui-theme';

const INTRO_ROOT_ID = 'hellforge-intro-video';

export type IntroVideoCallbacks = {
  onComplete: (reason: IntroTerminalReason) => void;
  /** Test / override hooks — production leaves these unset. */
  videoUrl?: string | null;
  posterUrl?: string | null;
  probeUrl?: (url: string) => Promise<boolean>;
};

export type IntroVideoHandle = {
  dispose(): void;
};

function resolveAssetUrl(relativeFromSrc: string): string | null {
  try {
    return new URL(relativeFromSrc, import.meta.url).href;
  } catch {
    return null;
  }
}

/** Probe whether a URL is likely fetchable (HEAD/GET). */
async function urlLooksAvailable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' });
    if (res.ok) return true;
    // Some hosts reject HEAD — try a ranged GET.
    const get = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0' } });
    return get.ok || get.status === 206;
  } catch {
    return false;
  }
}

export function installIntroVideo(
  mount: HTMLElement,
  cb: IntroVideoCallbacks,
): IntroVideoHandle {
  document.getElementById(INTRO_ROOT_ID)?.remove();
  const latch = createIntroCompletionLatch();
  const scoped = mount !== document.body;

  const root = document.createElement('div');
  root.id = INTRO_ROOT_ID;
  root.tabIndex = -1;
  root.style.cssText =
    `position:${scoped ? 'absolute' : 'fixed'};inset:0;z-index:${VISUAL_POLISH_Z.introVideo};` +
    `display:flex;align-items:center;justify-content:center;background:${Ui.ink};` +
    'pointer-events:auto;overflow:hidden;';

  const posterUrl = cb.posterUrl !== undefined
    ? cb.posterUrl
    : (resolveAssetUrl('../assets/ui/intro-poster.jpg')
      ?? resolveAssetUrl('../assets/ui/intro-poster.webp')
      ?? resolveAssetUrl('../assets/ui/title_bg.jpg'));
  const videoUrl = cb.videoUrl !== undefined
    ? cb.videoUrl
    : resolveAssetUrl('../assets/ui/intro.mp4');
  const probe = cb.probeUrl ?? urlLooksAvailable;

  if (posterUrl) {
    root.style.backgroundImage = `url('${posterUrl}')`;
    root.style.backgroundSize = 'cover';
    root.style.backgroundPosition = 'center';
  }

  const gate = document.createElement('button');
  gate.type = 'button';
  gate.textContent = '点击进入';
  gate.style.cssText =
    `pointer-events:auto;cursor:pointer;padding:16px 36px;border-radius:8px;` +
    `font:700 18px ${FONT_DISPLAY};letter-spacing:6px;color:${Ui.goldBright};` +
    `background:rgba(20,14,10,0.82);border:1px solid ${Ui.goldLine};` +
    'box-shadow:0 0 24px rgba(0,0,0,0.55);';

  const skipHint = document.createElement('div');
  skipHint.textContent = '播放中可 Esc / 点击跳过';
  skipHint.style.cssText =
    `display:none;position:absolute;right:20px;bottom:18px;font:600 12px ${FONT_UI};` +
    `color:${Ui.textDim};letter-spacing:1px;pointer-events:none;`;

  let video: HTMLVideoElement | null = null;
  let disposed = false;

  const finish = (reason: IntroTerminalReason): void => {
    if (disposed) return;
    const result = latch.complete(reason);
    if (result.alreadyCompleted) return;
    tearDownMedia();
    root.style.display = 'none';
    cb.onComplete(result.reason);
  };

  const tearDownMedia = (): void => {
    if (!video) return;
    try {
      video.pause();
    } catch { /* */ }
    video.removeAttribute('src');
    try {
      video.load();
    } catch { /* */ }
    video.remove();
    video = null;
  };

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape' || ev.key === 'Esc') {
      ev.preventDefault();
      finish('skipped');
    }
  };

  const attachSkip = (): void => {
    skipHint.style.display = '';
    root.addEventListener('click', onSkipClick);
    root.addEventListener('keydown', onKey);
    root.focus({ preventScroll: true });
  };

  const onSkipClick = (): void => {
    finish('skipped');
  };

  const startPlayback = async (): Promise<void> => {
    gate.remove();
    if (!videoUrl || !(await probe(videoUrl))) {
      finish('missingAsset');
      return;
    }

    video = document.createElement('video');
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = 'auto';
    video.src = videoUrl;
    video.style.cssText =
      'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;background:#000;';
    if (posterUrl) video.poster = posterUrl;
    root.insertBefore(video, skipHint);

    const onEnded = (): void => finish('ended');
    const onError = (): void => finish('error');
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);

    try {
      video.muted = false;
      const playPromise = video.play();
      if (playPromise && typeof playPromise.then === 'function') {
        await playPromise.catch(() => {
          // Autoplay with sound blocked even after gesture — try muted then fail soft.
          if (!video) return;
          video.muted = true;
          return video.play().catch(() => finish('error'));
        });
      }
    } catch {
      finish('error');
      return;
    }
    if (!disposed && !latch.isCompleted()) attachSkip();
  };

  gate.addEventListener('click', () => {
    void startPlayback();
  });

  root.append(gate, skipHint);
  mount.appendChild(root);

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      root.removeEventListener('keydown', onKey);
      root.removeEventListener('click', onSkipClick);
      tearDownMedia();
      root.remove();
    },
  };
}
