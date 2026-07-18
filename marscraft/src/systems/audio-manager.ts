/**
 * MarsCraft -> forgeax-engine — AudioManager (Milestone M16: BGM + music)
 * =============================================================================
 * Port of the Three.js `web/systems/AudioManager.ts` (dynamic BGM manager).
 *
 * Design (SC2-style dynamic score):
 *   - Three phases: menu -> economy:<race> -> battle:<race> -> gameover.
 *   - Per-race tracks (terran/zerg/protoss economy+battle) with a general
 *     economy/battle fallback + the main-menu theme.
 *   - Battle vs economy is DRIVEN BY COMBAT: subscribe to the M9 EventBus combat
 *     events (`combat:attack_hit`/`combat:damage`/`combat:kill`); any local-player
 *     combat within a recent window flips to battle music, quiet flips back to
 *     economy — a real state machine off real gameplay, not a timer stub.
 *   - Crossfade: fade the old track out + the new track in over ~1s via a volume
 *     ramp advanced from the ECS `Time` resource each frame (the source used a
 *     standalone rAF; here the engine already drives a frame loop, so the tick is
 *     an ECS system — no second clock).
 *   - master * bgm volume, looping tracks.
 *
 * forgeax adaptations vs the source:
 *   - Uses HTMLAudioElement (`new Audio(url)`) instead of Web Audio API — the
 *     preview page serves the mp3s directly and HTMLAudio's `.volume` ramp is
 *     enough for crossfade; no AudioContext/decode plumbing needed.
 *   - Track URLs resolve via `new URL('../../assets/music/<file>', import.meta.url)`
 *     — the Vite-native scheme (confirmed working in luo-sai-ya's audio-system)
 *     that maps to the served `/preview/.forgeax/games/marscraft/assets/music/*`.
 *   - The combat-activity signal comes from the EventBus (M9), not a per-frame
 *     Faction scan: cheap, and already the SSOT of "a hit landed this frame".
 *
 * Browser-API safety (REQUIRED — runs in the preview page, but must no-op
 * cleanly headless / where Audio is unavailable, and NEVER throw on a blocked
 * autoplay `.play()`):
 *   - Every `window`/`document`/`Audio` access is `typeof`-guarded.
 *   - If `Audio` is unavailable the whole manager is inert (tracks the desired
 *     phase in memory, plays nothing).
 *   - Browsers block autoplay until a user gesture: nothing calls `.play()`
 *     until the first `pointerdown`/`keydown`; `.play()` rejections are swallowed.
 */

import type { World, EntityHandle } from '@forgeax/engine-ecs';
import { EventBus } from '../core/event-bus';
import { Faction, PLAYER_ID, RACE, type RaceCode } from '../components';

export type AudioPhase = 'menu' | 'economy' | 'battle' | 'gameover';

export type RaceName = 'terran' | 'zerg' | 'protoss';

/** Crossfade length in seconds (fade old out + new in). */
const CROSSFADE_DURATION = 1.0;
/** Keep battle music for this long after the last local combat activity. */
const BATTLE_HOLD_SEC = 5.0;
/** Re-evaluate battle/economy at most this often. */
const BATTLE_CHECK_INTERVAL = 0.5;

/** phase-key -> served track file (relative to this module's dir). */
const BGM_FILES: Record<string, string> = {
  'menu': 'bgm_main_menu.mp3',
  'economy:general': 'bgm_economy_general.mp3',
  'battle:general': 'bgm_battle_general.mp3',
  'economy:terran': 'bgm_terran_economy.mp3',
  'battle:terran': 'bgm_terran_battle.mp3',
  'economy:zerg': 'bgm_zerg_economy.mp3',
  'battle:zerg': 'bgm_zerg_battle.mp3',
  'economy:protoss': 'bgm_protoss_economy.mp3',
  'battle:protoss': 'bgm_protoss_battle.mp3',
};

const RACE_NAME: Record<RaceCode, RaceName> = {
  [RACE.TERRAN]: 'terran',
  [RACE.PROTOSS]: 'protoss',
  [RACE.ZERG]: 'zerg',
};

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** True when the browser audio API is usable in this environment. */
function audioAvailable(): boolean {
  return typeof window !== 'undefined' && typeof (globalThis as { Audio?: unknown }).Audio !== 'undefined';
}

/**
 * Resolve a phase-key to its served mp3 URL, or null if unknown / no Audio.
 * `battle:<race>` / `economy:<race>` fall back to the `:general` track when the
 * per-race file is missing (defensive; all 9 exist here).
 */
function resolveUrl(key: string): string | null {
  let file = BGM_FILES[key];
  if (!file) {
    const fb = key.startsWith('battle:') ? 'battle:general'
      : key.startsWith('economy:') ? 'economy:general' : null;
    if (fb && fb !== key) file = BGM_FILES[fb];
  }
  if (!file) return null;
  try {
    // Vite-native asset URL (same scheme as luo-sai-ya's audio-system) → maps to
    // /preview/.forgeax/games/marscraft/assets/music/<file> when served.
    return new URL(`../../assets/music/${file}`, import.meta.url).href;
  } catch {
    return null;
  }
}

interface Track {
  key: string;
  el: HTMLAudioElement;
  /** Desired gain 0..1 (crossfade target); scaled by effective master*bgm. */
  targetVolume: number;
  /** Whether `.play()` has been requested on this element. */
  playRequested: boolean;
}

export interface AudioManagerHandle {
  /** Set the local player's race so per-race tracks are chosen. */
  setLocalRace(race: RaceName): void;
  /** master/bgm volume (0..1 each). */
  setVolume(master: number, bgm: number): void;
  /** Switch to the menu theme. */
  playMenuBGM(): void;
  /** Enter in-game: economy:<race> (battle auto-triggers off combat). */
  startGameBGM(race?: RaceName): void;
  /** Game over: stop everything (fade all out). */
  gameOver(): void;
  /** Force-arm as if a user gesture happened (test / simulate). */
  arm(): void;
  /** Live snapshot for verify hooks. */
  state(): {
    phase: AudioPhase;
    desiredKey: string | null;
    desiredUrl: string | null;
    isPlaying: boolean;
    armed: boolean;
    audioAvailable: boolean;
    masterVolume: number;
    bgmVolume: number;
    effectiveVolume: number;
    localRace: RaceName;
    lastCombatAgo: number | null;
  };
}

export class AudioManager implements AudioManagerHandle {
  private _world: World | null = null;

  private _tracks = new Map<string, Track>();
  private _activeKey: string | null = null;
  private _phase: AudioPhase = 'menu';

  private _masterVolume = 0.8;
  private _bgmVolume = 0.6;

  private _localRace: RaceName = 'terran';

  private _gameTime = 0;
  private _lastCombatTime = -Infinity;
  private _battleCheckTimer = 0;
  /** desired phase decided pre-gesture; applied on arm. */
  private _armed = false;

  private _installed = false;
  /** the gesture-unlock listener, so we can remove it on destroy. */
  private _unlock: (() => void) | null = null;

  // Bound combat handlers (stable refs for on/off).
  private _onCombat = (data: { attacker: number; target: number }) => {
    if (this._involvesLocalPlayer(data.attacker, data.target)) {
      this._lastCombatTime = this._gameTime;
    }
  };
  private _onKill = (data: { killer: number; victim: number }) => {
    if (this._involvesLocalPlayer(data.killer, data.victim)) {
      this._lastCombatTime = this._gameTime;
    }
  };

  install(world: World): AudioManagerHandle {
    this._world = world;
    if (this._installed) return this;
    this._installed = true;

    // Combat activity → battle music (M9 EventBus). attack_hit + damage are the
    // "a blow landed" signal; kill also counts as combat.
    EventBus.instance.on('combat:attack_hit', this._onCombat);
    EventBus.instance.on('combat:damage', this._onCombat);
    EventBus.instance.on('combat:kill', this._onKill);

    this._listenForGesture();

    world.addSystem({
      name: 'mc-audio-manager',
      queries: [],
      resources: ['Time'],
      fn: () => {
        const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;
        this._tick(dt);
      },
    });

    return this;
  }

  destroy(): void {
    EventBus.instance.off('combat:attack_hit', this._onCombat);
    EventBus.instance.off('combat:damage', this._onCombat);
    EventBus.instance.off('combat:kill', this._onKill);
    this._removeGestureListener();
    for (const t of this._tracks.values()) {
      try { t.el.pause(); } catch { /* ignore */ }
      t.el.src = '';
    }
    this._tracks.clear();
    this._activeKey = null;
  }

  // ── public API ────────────────────────────────────────────────────────────

  setLocalRace(race: RaceName): void {
    this._localRace = race;
  }

  setVolume(master: number, bgm: number): void {
    this._masterVolume = clamp01(master);
    this._bgmVolume = clamp01(bgm);
    // Apply immediately to whatever is currently ramping (next tick also handles it).
    const ev = this._effectiveVolume();
    for (const t of this._tracks.values()) {
      if (t.playRequested) t.el.volume = clamp01(t.el.volume === 0 ? 0 : t.targetVolume * ev);
    }
  }

  playMenuBGM(): void {
    this._phase = 'menu';
    this._play('menu');
  }

  startGameBGM(race?: RaceName): void {
    if (race) this._localRace = race;
    this._phase = 'economy';
    this._lastCombatTime = -Infinity;
    this._play(`economy:${this._localRace}`);
  }

  gameOver(): void {
    this._phase = 'gameover';
    // Fade everything out.
    for (const t of this._tracks.values()) t.targetVolume = 0;
    this._activeKey = null;
  }

  arm(): void {
    this._doArm();
  }

  state() {
    const desiredKey = this._activeKey;
    return {
      phase: this._phase,
      desiredKey,
      desiredUrl: desiredKey ? resolveUrl(desiredKey) : null,
      isPlaying: this._isPlaying(),
      armed: this._armed,
      audioAvailable: audioAvailable(),
      masterVolume: this._masterVolume,
      bgmVolume: this._bgmVolume,
      effectiveVolume: this._effectiveVolume(),
      localRace: this._localRace,
      lastCombatAgo: this._lastCombatTime === -Infinity
        ? null
        : Number((this._gameTime - this._lastCombatTime).toFixed(2)),
    };
  }

  // ── phase / playback ───────────────────────────────────────────────────────

  private _effectiveVolume(): number {
    return clamp01(this._masterVolume * this._bgmVolume);
  }

  private _isPlaying(): boolean {
    if (!this._activeKey) return false;
    const t = this._tracks.get(this._activeKey);
    return !!t && t.playRequested && !t.el.paused;
  }

  /** Set the desired active track; fade the old one out, fade the new one in. */
  private _play(key: string): void {
    if (key === this._activeKey) return;

    // Fade out the previous active track.
    if (this._activeKey) {
      const old = this._tracks.get(this._activeKey);
      if (old) old.targetVolume = 0;
    }

    this._activeKey = key;

    if (!audioAvailable()) return; // inert headless — desired phase still tracked

    const track = this._getOrCreateTrack(key);
    if (!track) return;
    track.targetVolume = 1;

    // Only actually start playback once the user has interacted (autoplay policy).
    if (this._armed) this._startTrack(track);
  }

  private _getOrCreateTrack(key: string): Track | null {
    let track = this._tracks.get(key);
    if (track) return track;

    const url = resolveUrl(key);
    if (!url) return null;

    let el: HTMLAudioElement;
    try {
      el = new (globalThis as unknown as { Audio: new (src?: string) => HTMLAudioElement }).Audio(url);
    } catch {
      return null;
    }
    el.loop = true;
    el.preload = 'auto';
    el.volume = 0;

    track = { key, el, targetVolume: 0, playRequested: false };
    this._tracks.set(key, track);
    return track;
  }

  /** Kick off `.play()` on a track (autoplay-safe: swallow the rejection). */
  private _startTrack(track: Track): void {
    if (track.playRequested && !track.el.paused) return;
    track.playRequested = true;
    try {
      const p = track.el.play();
      if (p && typeof p.then === 'function') p.catch(() => { /* autoplay blocked — stay silent */ });
    } catch {
      /* never throw on a rejected play */
    }
  }

  // ── per-frame tick (crossfade ramp + battle detection) ──────────────────────

  private _tick(dt: number): void {
    this._gameTime += dt;

    // Battle vs economy state machine (only meaningful once in-game).
    if (this._phase === 'economy' || this._phase === 'battle') {
      this._battleCheckTimer += dt;
      if (this._battleCheckTimer >= BATTLE_CHECK_INTERVAL) {
        this._battleCheckTimer = 0;
        this._checkBattle();
      }
    }

    if (!audioAvailable()) return;

    // Crossfade ramp: move each track's element volume toward target*effective.
    const ev = this._effectiveVolume();
    const step = dt / CROSSFADE_DURATION; // volume units per second = 1/duration
    for (const track of this._tracks.values()) {
      const target = track.targetVolume * ev;
      const cur = track.el.volume;
      if (Math.abs(cur - target) <= 0.01) {
        track.el.volume = clamp01(target);
        // Fully faded out → pause + rewind so a re-entry restarts cleanly.
        if (target === 0 && track.playRequested && !track.el.paused) {
          try { track.el.pause(); track.el.currentTime = 0; } catch { /* ignore */ }
          track.playRequested = false;
        }
        continue;
      }
      track.el.volume = clamp01(cur < target ? cur + step : cur - step);
    }
  }

  private _checkBattle(): void {
    const inCombat = (this._gameTime - this._lastCombatTime) < BATTLE_HOLD_SEC;
    if (inCombat && this._phase !== 'battle') {
      this._phase = 'battle';
      this._play(`battle:${this._localRace}`);
    } else if (!inCombat && this._phase === 'battle') {
      this._phase = 'economy';
      this._play(`economy:${this._localRace}`);
    }
  }

  private _involvesLocalPlayer(a: number, b: number): boolean {
    const w = this._world;
    if (!w) return false;
    return this._isLocal(w, a) || this._isLocal(w, b);
  }

  private _isLocal(w: World, rawEntity: number): boolean {
    if (!rawEntity) return false; // 0 = no attributable entity
    const f = w.get(rawEntity as unknown as EntityHandle, Faction);
    return f.ok && f.value.playerId === PLAYER_ID.PLAYER;
  }

  // ── autoplay unlock ─────────────────────────────────────────────────────────

  private _listenForGesture(): void {
    if (typeof document === 'undefined' || this._unlock) return;
    const unlock = () => this._doArm();
    this._unlock = unlock;
    document.addEventListener('pointerdown', unlock, { capture: true, once: false });
    document.addEventListener('keydown', unlock, { capture: true, once: false });
  }

  private _removeGestureListener(): void {
    if (typeof document === 'undefined' || !this._unlock) return;
    document.removeEventListener('pointerdown', this._unlock, true);
    document.removeEventListener('keydown', this._unlock, true);
    this._unlock = null;
  }

  private _doArm(): void {
    if (this._armed) return;
    this._armed = true;
    this._removeGestureListener();
    // Start whatever the desired active track is (set pre-gesture).
    if (this._activeKey && audioAvailable()) {
      const track = this._getOrCreateTrack(this._activeKey);
      if (track) { track.targetVolume = 1; this._startTrack(track); }
    }
  }
}

/** Map a Faction race code to the phase-key race name (for local-player race). */
export function raceNameFromCode(code: number): RaceName {
  return RACE_NAME[code as RaceCode] ?? 'terran';
}
