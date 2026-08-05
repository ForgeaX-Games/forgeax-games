// game-default gameplay audio: GUID-loaded spatial SFX plus looping music bus controls.

import { AUDIO_ENGINE_RESOURCE_KEY, AudioSource, type AudioBackend } from '@forgeax/engine-audio';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import type { AudioClipAsset, Handle } from '@forgeax/engine-types';

/** SSOT: forgeax-engine-assets/sfx/dragon-studio-correct-472358.mp3.meta.json. */
export const HIT_SFX_GUID = '019e7535-5e5e-75fe-a328-0b08e3a72744';
/** SSOT: forgeax-engine-assets/collectathon-audio/bgm-loop.wav.meta.json. */
export const MUSIC_GUID = '3b298083-a2bc-496f-91fb-80e5bb8cfe48';

type ClipHandle = Handle<'AudioClipAsset', 'shared'>;
const HANDLE_NONE = 0 as unknown as ClipHandle;

interface AudioRegistry {
  loadByGuid<T>(guid: AssetGuid): Promise<
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: { readonly code: string; readonly hint: string } }
  >;
}

export interface GameplayAudio {
  rearm(): void;
  reset(): void;
  triggerHit(): void;
  setMusicPlaying(playing: boolean): void;
  setMusicSettings(volume: number, muted: boolean): void;
  musicSnapshot(): { readonly clipLoaded: boolean; readonly playing: boolean; readonly volume: number; readonly muted: boolean };
}

const setSource = (world: World, player: EntityHandle, clip: ClipHandle, playing: boolean): void => {
  const result = world.set(player, AudioSource, {
    clip, playing, loop: false, volume: 0.8, spatialBlend: 1, bus: 'sfx',
  });
  if (!result.ok) console.warn('[game] gameplay AudioSource update failed:', result.error.code, result.error.hint);
};

/** Attach the player source and resolve the clip through the normal GUID path. */
export async function installGameplayAudio(
  world: World,
  player: EntityHandle,
  assets: AudioRegistry | undefined,
): Promise<GameplayAudio> {
  world.addComponent(player, { component: AudioSource, data: { clip: HANDLE_NONE } }).unwrap();
  setSource(world, player, HANDLE_NONE, false);
  let clip = HANDLE_NONE;
  let armed = false;

  const musicEntity = world.spawn({
    component: AudioSource,
    data: { clip: HANDLE_NONE, playing: false, loop: true, volume: 1, spatialBlend: 0, bus: 'music' },
  }).unwrap();
  let musicClip = HANDLE_NONE;
  let musicPlaying = false;
  let musicVolume = 0.7;
  let musicMuted = false;
  const audio = world.hasResource(AUDIO_ENGINE_RESOURCE_KEY)
    ? world.getResource<AudioBackend>(AUDIO_ENGINE_RESOURCE_KEY)
    : undefined;

  if (!assets) {
    console.warn('[game] gameplay SFX unavailable: AssetRegistry is unavailable');
  } else {
    const parsed = AssetGuid.parse(HIT_SFX_GUID);
    if (!parsed.ok) {
      console.error('[game] gameplay SFX unavailable: invalid GUID', HIT_SFX_GUID);
    } else {
      const loaded = await assets.loadByGuid<AudioClipAsset>(parsed.value);
      if (loaded.ok) {
        clip = world.allocSharedRef('AudioClipAsset', loaded.value);
        setSource(world, player, clip, false);
      } else {
        console.warn('[game] gameplay SFX unavailable:', loaded.error.code, loaded.error.hint);
      }
    }
  }

  if (assets) {
    const parsed = AssetGuid.parse(MUSIC_GUID);
    if (!parsed.ok) {
      console.error('[game] background music unavailable: invalid GUID', MUSIC_GUID);
    } else {
      const loaded = await assets.loadByGuid<AudioClipAsset>(parsed.value);
      if (loaded.ok) {
        musicClip = world.allocSharedRef('AudioClipAsset', loaded.value);
        world.set(musicEntity, AudioSource, { clip: musicClip, playing: false, loop: true, volume: 1, spatialBlend: 0, bus: 'music' });
      } else {
        console.warn('[game] background music unavailable:', loaded.error.code, loaded.error.hint);
      }
    }
  } else {
    console.warn('[game] background music unavailable: AssetRegistry is unavailable');
  }

  const writeMusic = (): void => {
    if (musicClip === HANDLE_NONE) return;
    world.set(musicEntity, AudioSource, { clip: musicClip, playing: musicPlaying, loop: true, volume: 1, spatialBlend: 0, bus: 'music' });
  };

  return {
    rearm() {
      if (!armed) return;
      setSource(world, player, clip, false);
      armed = false;
    },
    reset() {
      setSource(world, player, clip, false);
      armed = false;
      musicPlaying = false;
      writeMusic();
    },
    triggerHit() {
      if (clip === HANDLE_NONE) return;
      setSource(world, player, clip, true);
      armed = true;
    },
    setMusicPlaying(playing) {
      if (musicPlaying === playing) return;
      musicPlaying = playing;
      writeMusic();
    },
    setMusicSettings(volume, muted) {
      musicVolume = Math.max(0, Math.min(1, volume));
      musicMuted = muted;
      audio?.setBusVolume('music', musicVolume);
      audio?.setBusMute('music', muted);
    },
    musicSnapshot() {
      return { clipLoaded: musicClip !== HANDLE_NONE, playing: musicPlaying, volume: musicVolume, muted: musicMuted };
    },
  };
}
