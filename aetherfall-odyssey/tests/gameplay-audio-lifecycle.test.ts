import { describe, expect, it, vi } from 'vitest';
import { AudioSource } from '@forgeax/engine-audio';
import { World, type EntityHandle } from '@forgeax/engine-ecs';
import type { AudioClipAsset, Handle } from '@forgeax/engine-types';
import { installGameplayAudio } from '../assets/plugins/gameplay-audio';

describe('Gameplay audio resource ownership', () => {
  it('proves same-handle World.set needs an independent owner grant', () => {
    const world = new World();
    const routedErrors: Array<{ code?: string }> = [];
    world.setErrorHandler((error) => routedErrors.push(error as { code?: string }));
    const entity = world.spawn({ component: AudioSource, data: { clip: 0 as Handle<'AudioClipAsset', 'shared'> } }).unwrap();
    const handle = world.allocSharedRef('AudioClipAsset', {
      kind: 'audio-clip', duration: 1, sampleRate: 48_000, channels: 2,
    } as unknown as AudioClipAsset);

    world.set(entity, AudioSource, { clip: handle, playing: false }).unwrap();
    expect(world.sharedRefs.refcount(handle)).toBe(2);
    world.set(entity, AudioSource, { clip: handle, playing: true }).unwrap();
    expect(world.sharedRefs.refcount(handle)).toBe(2);
    expect(routedErrors).toEqual([]);

    // Reproduce the reported failure shape: without the alloc-grant, set
    // releases the component's last holder before retaining the same numeric
    // handle, so its generation becomes stale in the middle of the write.
    world.sharedRefs.release(handle).unwrap();
    world.set(entity, AudioSource, { clip: handle, playing: false }).unwrap();
    expect(routedErrors.map(({ code }) => code)).toEqual(['shared-ref-stale']);
  });

  it('transfers clip grants to AudioSource owners and releases them on cleanup', async () => {
    const world = new World();
    const routedErrors: unknown[] = [];
    world.setErrorHandler((error) => routedErrors.push(error));
    const player = world.spawn().unwrap();
    const spawnSpy = vi.spyOn(world, 'spawn');
    const assets = {
      loadByGuid: vi.fn(async () => ({
        ok: true,
        value: { kind: 'audio-clip', duration: 1, sampleRate: 48_000, channels: 2 } as unknown as AudioClipAsset,
      })),
    };

    const audio = await installGameplayAudio(world, player, assets);
    const musicSpawn = spawnSpy.mock.results[0]?.value as ReturnType<World['spawn']> | undefined;
    const musicEntity = musicSpawn?.unwrap() as EntityHandle;
    const sfx = world.get(player, AudioSource).unwrap();
    const music = world.get(musicEntity, AudioSource).unwrap();
    expect(sfx.loop).toBe(false);
    expect(music.loop).toBe(true);
    // Each clip has two independent holders: the GameplayAudio owner grant
    // and the AudioSource component retain. The owner grant keeps a same-
    // handle World.set alive across release-old -> retain-new ordering.
    expect(world.sharedRefs.refcount(sfx.clip)).toBe(2);
    expect(world.sharedRefs.refcount(music.clip)).toBe(2);

    for (let cycle = 0; cycle < 3; cycle += 1) {
      audio.triggerHit();
      expect(world.get(player, AudioSource).unwrap().playing).toBe(true);
      audio.rearm();
      expect(world.get(player, AudioSource).unwrap().playing).toBe(false);
      audio.setMusicPlaying(true);
      expect(world.get(musicEntity, AudioSource).unwrap().playing).toBe(true);
      audio.reset();
      expect(world.get(musicEntity, AudioSource).unwrap().playing).toBe(false);
      expect(world.sharedRefs.refcount(sfx.clip)).toBe(2);
      expect(world.sharedRefs.refcount(music.clip)).toBe(2);
    }
    expect(routedErrors).toEqual([]);

    audio.dispose();
    audio.dispose();
    expect(world.sharedRefs.refcount(sfx.clip)).toBe(0);
    expect(world.sharedRefs.refcount(music.clip)).toBe(0);
    expect(world.get(player, AudioSource).ok).toBe(false);
    expect(world.get(musicEntity, AudioSource).ok).toBe(false);
    expect(routedErrors).toEqual([]);
  });
});
