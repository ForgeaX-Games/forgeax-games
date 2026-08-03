/**
 * Intro / PV boot gate (N1).
 *
 * Owns: click-gate → optional <video> → exactly-once completion → title handoff.
 * Does NOT own ShellState. Uses visual-polish-contracts intro latch + Z.
 *
 * Asset fallback (A1 missing): after gesture, complete with `missingAsset`
 * (poster-only / skip path) — never invent a fake MP4.
 *
 * Visual: ceremonial gate cover, then cinematic PV chrome during playback
 * (letterbox, wordmark, ember progress, carved skip). Behavior (probe /
 * latch / skip / teardown / dispose) is unchanged.
 */

import {
  VISUAL_POLISH_Z,
  createIntroCompletionLatch,
  type IntroTerminalReason,
} from './visual-polish-contracts';
import { ShellArt } from './shell-art';
import {
  FONT_DISPLAY,
  FONT_UI,
  Ui,
  forgeEmblemSvg,
  goldDividerHtml,
  metalGoldTextStyle,
} from './ui-theme';

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
    `display:flex;flex-direction:column;align-items:center;justify-content:center;` +
    `background:${Ui.ink};pointer-events:auto;overflow:hidden;font-family:${FONT_DISPLAY};`;

  // A1 cache-bust — bump when intro.mp4 / poster is replaced.
  const A1_REV = 'a1-15s';
  const withRev = (url: string | null): string | null =>
    url ? `${url}${url.includes('?') ? '&' : '?'}${A1_REV}` : null;
  const posterUrl = cb.posterUrl !== undefined
    ? cb.posterUrl
    : withRev(resolveAssetUrl('../assets/ui/intro-poster.jpg')
      ?? resolveAssetUrl('../assets/ui/intro-poster.webp')
      ?? resolveAssetUrl('../assets/ui/title_bg.jpg'));
  const videoUrl = cb.videoUrl !== undefined
    ? cb.videoUrl
    : withRev(resolveAssetUrl('../assets/ui/intro.mp4'));
  const probe = cb.probeUrl ?? urlLooksAvailable;

  // Atmosphere layers — the shell.ts title recipe verbatim (same gradient
  // stops) so the latch → title transition keeps one continuous mood.
  const bg = document.createElement('div');
  bg.style.cssText =
    'position:absolute;inset:0;pointer-events:none;' +
    (posterUrl
      ? `background:url('${posterUrl}') center/cover no-repeat;filter:brightness(0.55) saturate(0.8);`
      : // No poster: ember glow over the ink base instead of dead black.
        'background:radial-gradient(ellipse 62% 52% at 50% 42%,rgba(96,54,22,0.32) 0%,rgba(40,24,12,0.22) 46%,transparent 76%);');
  root.appendChild(bg);

  const vignette = document.createElement('div');
  vignette.style.cssText =
    'position:absolute;inset:0;pointer-events:none;' +
    'background:radial-gradient(ellipse 70% 60% at 50% 40%,transparent 0%,rgba(0,0,0,0.4) 50%,rgba(0,0,0,0.85) 100%);';
  root.appendChild(vignette);

  const topFade = document.createElement('div');
  topFade.style.cssText =
    'position:absolute;top:0;left:0;right:0;height:30%;pointer-events:none;' +
    'background:linear-gradient(180deg,rgba(5,4,4,0.7) 0%,transparent 100%);';
  root.appendChild(topFade);

  const bottomFade = document.createElement('div');
  bottomFade.style.cssText =
    'position:absolute;bottom:0;left:0;right:0;height:25%;pointer-events:none;' +
    'background:linear-gradient(0deg,rgba(5,4,4,0.8) 0%,transparent 100%);';
  root.appendChild(bottomFade);

  // ── ceremony column ──────────────────────────────────────────────────────
  // All direct children of root; `position:relative` (z-index:auto) lifts them
  // above the atmosphere layers while the later-appended <video> still paints
  // over them during playback (positioned siblings stack in DOM order).
  const emblem = document.createElement('div');
  emblem.style.cssText =
    'position:relative;width:96px;height:96px;margin-bottom:14px;opacity:0.92;pointer-events:none;';
  emblem.innerHTML = forgeEmblemSvg(96);
  root.appendChild(emblem);

  const wordmark = document.createElement('div');
  // metalGoldTextStyle already carries position:relative.
  wordmark.style.cssText = metalGoldTextStyle('clamp(30px,4.5vw,44px)') + 'pointer-events:none;';
  wordmark.textContent = 'HELLFORGE';
  root.appendChild(wordmark);

  const divider = document.createElement('div');
  divider.style.cssText = 'position:relative;width:min(280px,60vw);pointer-events:none;';
  divider.innerHTML = goldDividerHtml(12);
  root.appendChild(divider);

  // Gate latch — S4 three-state plates. Direct-child <button>, label 点击进入;
  // mousedown/mouseup/mouseleave press + reset semantics preserved.
  const gate = document.createElement('button');
  gate.type = 'button';
  gate.textContent = '点击进入';
  gate.style.cssText =
    'position:relative;margin-top:8px;width:min(360px,78vw);height:clamp(78px,12vh,110px);box-sizing:border-box;' +
    'display:flex;align-items:center;justify-content:center;padding:0;' +
    'border:none;pointer-events:auto;cursor:pointer;' +
    `font:700 17px ${FONT_DISPLAY};letter-spacing:6px;` +
    `color:${Ui.goldBright};text-shadow:0 1px 3px rgba(0,0,0,0.9),0 0 12px rgba(0,0,0,0.55);` +
    `background:url('${ShellArt.latchIdle()}') center/100% 100% no-repeat;` +
    'transition:transform .06s;';

  gate.addEventListener('mouseenter', () => {
    gate.style.backgroundImage = `url('${ShellArt.latchHover()}')`;
  });
  gate.addEventListener('mouseleave', () => {
    gate.style.backgroundImage = `url('${ShellArt.latchIdle()}')`;
    gate.style.transform = '';
  });
  gate.addEventListener('mousedown', () => {
    gate.style.backgroundImage = `url('${ShellArt.latchPressed()}')`;
    gate.style.transform = 'scale(0.98)';
  });
  gate.addEventListener('mouseup', () => {
    gate.style.backgroundImage = `url('${ShellArt.latchHover()}')`;
    gate.style.transform = '';
  });
  root.appendChild(gate);

  const gateHint = document.createElement('div');
  gateHint.textContent = '余烬之门静待开启';
  gateHint.style.cssText =
    'position:relative;margin-top:16px;pointer-events:none;' +
    `font:600 12px ${FONT_UI};color:${Ui.textDim};letter-spacing:2px;`;
  root.appendChild(gateHint);

  const ceremony = [emblem, wordmark, divider, gateHint];

  // ── playback chrome (shown only while <video> is live) ───────────────────
  const playChrome = document.createElement('div');
  playChrome.style.cssText =
    'display:none;position:absolute;inset:0;z-index:6;pointer-events:none;';

  const letterTop = document.createElement('div');
  letterTop.style.cssText =
    'position:absolute;top:0;left:0;right:0;height:clamp(42px,8vh,72px);' +
    'background:linear-gradient(180deg,#050404 0%,rgba(5,4,4,0.92) 70%,transparent 100%);' +
    `box-shadow:inset 0 -1px 0 ${Ui.goldDeep}88;`;
  playChrome.appendChild(letterTop);

  const letterBot = document.createElement('div');
  letterBot.style.cssText =
    'position:absolute;bottom:0;left:0;right:0;height:clamp(52px,10vh,88px);' +
    'background:linear-gradient(0deg,#050404 0%,rgba(5,4,4,0.94) 68%,transparent 100%);' +
    `box-shadow:inset 0 1px 0 ${Ui.goldDeep}88;`;
  playChrome.appendChild(letterBot);

  const playVignette = document.createElement('div');
  playVignette.style.cssText =
    'position:absolute;inset:0;' +
    'background:radial-gradient(ellipse 78% 70% at 50% 48%,transparent 0%,rgba(0,0,0,0.22) 58%,rgba(0,0,0,0.55) 100%);' +
    'box-shadow:inset 0 0 120px 40px rgba(0,0,0,0.35);';
  playChrome.appendChild(playVignette);

  const playBrand = document.createElement('div');
  playBrand.style.cssText =
    'position:absolute;top:clamp(10px,2.2vh,22px);left:50%;transform:translateX(-50%);' +
    'display:flex;flex-direction:column;align-items:center;gap:4px;';
  const playWord = document.createElement('div');
  playWord.style.cssText = metalGoldTextStyle('clamp(18px,2.4vw,26px)') + 'pointer-events:none;opacity:0.92;';
  playWord.textContent = 'HELLFORGE';
  playBrand.appendChild(playWord);
  const playTag = document.createElement('div');
  playTag.textContent = '开场影章';
  playTag.style.cssText =
    `font:600 11px ${FONT_UI};letter-spacing:6px;color:${Ui.textDim};` +
    'text-shadow:0 1px 3px rgba(0,0,0,0.9);';
  playBrand.appendChild(playTag);
  playChrome.appendChild(playBrand);

  // Progress rail — S7 track + fill; width driven by timeupdate only.
  const progressTrack = document.createElement('div');
  progressTrack.style.cssText =
    'position:absolute;left:8%;right:8%;bottom:clamp(12px,2.8vh,24px);height:clamp(18px,3.2vh,28px);' +
    `background:url('${ShellArt.pvTrack()}') center/100% 100% no-repeat;overflow:hidden;`;
  const progressFill = document.createElement('div');
  progressFill.style.cssText =
    'position:absolute;left:0;top:0;bottom:0;width:0%;' +
    `background:url('${ShellArt.pvFill()}') left center/auto 100% no-repeat;` +
    'transition:width .12s linear;';
  progressTrack.appendChild(progressFill);
  playChrome.appendChild(progressTrack);

  // Skip — S6 plate + DOM copy. Plain <div>, pointer-events:none (not a button).
  const skipHint = document.createElement('div');
  skipHint.style.cssText =
    'position:absolute;right:clamp(16px,2.5vw,28px);bottom:clamp(36px,6vh,56px);' +
    'display:flex;align-items:center;justify-content:center;' +
    'width:min(220px,42vw);height:clamp(40px,6vh,52px);pointer-events:none;' +
    `background:url('${ShellArt.skipIdle()}') center/100% 100% no-repeat;`;
  const skipText = document.createElement('div');
  skipText.textContent = '跳过  ·  Esc / 点击';
  skipText.style.cssText =
    `font:700 12px ${FONT_UI};letter-spacing:2px;color:${Ui.goldBright};` +
    'text-shadow:0 1px 3px rgba(0,0,0,0.9);';
  skipHint.appendChild(skipText);
  playChrome.appendChild(skipHint);
  root.appendChild(playChrome);

  let video: HTMLVideoElement | null = null;
  let disposed = false;
  let onTimeUpdate: (() => void) | null = null;

  const finish = (reason: IntroTerminalReason): void => {
    if (disposed) return;
    const result = latch.complete(reason);
    if (result.alreadyCompleted) return;
    tearDownMedia();
    root.style.display = 'none';
    cb.onComplete(result.reason);
  };

  const tearDownMedia = (): void => {
    if (video && onTimeUpdate) {
      video.removeEventListener('timeupdate', onTimeUpdate);
      onTimeUpdate = null;
    }
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
    playChrome.style.display = 'none';
    progressFill.style.width = '0%';
  };

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Escape' || ev.key === 'Esc') {
      ev.preventDefault();
      finish('skipped');
    }
  };

  const attachSkip = (): void => {
    playChrome.style.display = '';
    root.addEventListener('click', onSkipClick);
    root.addEventListener('keydown', onKey);
    root.focus({ preventScroll: true });
  };

  const onSkipClick = (): void => {
    finish('skipped');
  };

  const startPlayback = async (): Promise<void> => {
    gate.remove();
    for (const el of ceremony) el.style.display = 'none';
    // Gate-phase atmosphere stays under the video as a soft bed.
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
      'position:absolute;inset:0;z-index:1;width:100%;height:100%;' +
      'object-fit:cover;background:#000;';
    if (posterUrl) video.poster = posterUrl;
    root.insertBefore(video, playChrome);

    const onEnded = (): void => finish('ended');
    const onError = (): void => finish('error');
    video.addEventListener('ended', onEnded);
    video.addEventListener('error', onError);
    onTimeUpdate = () => {
      if (!video) return;
      const dur = video.duration;
      if (!Number.isFinite(dur) || dur <= 0) return;
      const t = Math.min(1, Math.max(0, video.currentTime / dur));
      progressFill.style.width = `${(t * 100).toFixed(2)}%`;
    };
    video.addEventListener('timeupdate', onTimeUpdate);

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
