import type { AudioBackend } from '@forgeax/engine-audio';
import type { World } from '@forgeax/engine-ecs';
import type { GameplayAudio } from './gameplay-audio';

export const GAME_DEFAULT_AUDIO_EVIDENCE_KEY = '__forgeaxGameDefaultAudioEvidence';

export type GameDefaultAudioEvidence = {
  readonly setMusicSettings: (volume: number, muted: boolean) => void;
  readonly reset: () => void;
  readonly snapshot: () => {
    readonly music: ReturnType<GameplayAudio['musicSnapshot']>;
    readonly backend: ReturnType<AudioBackend['getState']> | null;
  };
};

export function installAudioEvidence(args: {
  readonly world: World;
  readonly gameplayAudio: GameplayAudio | undefined;
  readonly registerCleanup?: (cleanup: () => void) => void;
}): void {
  if (args.gameplayAudio === undefined || typeof location === 'undefined') return;
  if (!new URLSearchParams(location.search).has('audio-evidence')) return;
  const audio = args.world.hasResource('AudioEngine')
    ? args.world.getResource<AudioBackend>('AudioEngine')
    : undefined;
  const evidence: GameDefaultAudioEvidence = {
    setMusicSettings: (volume, muted) => args.gameplayAudio?.setMusicSettings(volume, muted),
    reset: () => args.gameplayAudio?.reset(),
    snapshot: () => ({ music: args.gameplayAudio!.musicSnapshot(), backend: audio?.getState() ?? null }),
  };
  const host = globalThis as unknown as Record<string, unknown>;
  host[GAME_DEFAULT_AUDIO_EVIDENCE_KEY] = evidence;
  args.registerCleanup?.(() => {
    if (host[GAME_DEFAULT_AUDIO_EVIDENCE_KEY] === evidence) delete host[GAME_DEFAULT_AUDIO_EVIDENCE_KEY];
  });
}
