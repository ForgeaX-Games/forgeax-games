import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ECHOFALL_CHARACTER_ROOT,
  FOX_CLIP_GUIDS,
  FOX_SCENE_GUID,
  blendAvatarWeights,
} from './echofall-avatar';
import { cinematicCameraTarget } from './echofall-camera';

const gameRoot = resolve(import.meta.dir, '..');
const packageJson = JSON.parse(readFileSync(resolve(gameRoot, 'package.json'), 'utf8')) as {
  forgeax: { assets: { roots: string[] } };
};
const sharedMeta = JSON.parse(readFileSync(resolve(
  gameRoot,
  '../../../packages/editor/forgeax-editor-assets/characters/Fox.glb.meta.json',
), 'utf8')) as { subAssets: Array<{ guid: string; kind: string; sourceKey: string }> };
const avatarSource = readFileSync(resolve(import.meta.dir, 'echofall-avatar.ts'), 'utf8');
const mainSource = readFileSync(resolve(gameRoot, 'main.ts'), 'utf8');

describe('Echofall shared skinned avatar contract', () => {
  test('declares the Studio shared character root and resolves every authored Fox subasset', () => {
    expect(packageJson.forgeax.assets.roots).toContain(ECHOFALL_CHARACTER_ROOT);
    const guids = new Set(sharedMeta.subAssets.map((row) => row.guid));
    expect(guids.has(FOX_SCENE_GUID)).toBeTrue();
    expect(Object.values(FOX_CLIP_GUIDS).every((guid) => guids.has(guid))).toBeTrue();
  });

  test('crossfades normalized survey, walk, and run weights', () => {
    const walk = blendAvatarWeights([1, 0, 0], [0, 1, 0], 0.1);
    expect(walk[0]).toBeLessThan(1);
    expect(walk[1]).toBeGreaterThan(0);
    expect(walk[0] + walk[1] + walk[2]).toBeCloseTo(1, 6);
    const run = blendAvatarWeights(walk, [0, 0, 1], 0.2);
    expect(run[2]).toBeGreaterThan(0);
    expect(run[0] + run[1] + run[2]).toBeCloseTo(1, 6);
  });

  test('binds the imported skin and exposes truthful fallback state in the runtime snapshot', () => {
    expect(avatarSource).toContain('bindAnimationTargets(world, sceneRoot, collected.targets)');
    expect(avatarSource).toContain("mode: 'procedural-warden'");
    expect(avatarSource).toContain('loadError');
    expect(mainSource).toContain('avatar: avatar.snapshot()');
  });

  test('widens and eases the camera for sprint without losing the shoulder composition', () => {
    const idle = cinematicCameraTarget(false, false, true);
    const sprint = cinematicCameraTarget(true, true, true);
    const airborne = cinematicCameraTarget(true, true, false);
    expect(sprint.distance).toBeGreaterThan(idle.distance);
    expect(sprint.fov).toBeGreaterThan(idle.fov);
    expect(sprint.shoulder).toBeGreaterThan(0.6);
    expect(airborne.height).toBeGreaterThan(sprint.height);
    expect(sprint.followRate).toBeLessThan(idle.followRate);
  });
});
