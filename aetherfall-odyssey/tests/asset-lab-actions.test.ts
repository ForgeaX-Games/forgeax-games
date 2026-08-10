import { describe, expect, it, vi } from 'vitest';
import { World } from '@forgeax/engine-ecs';
import { applyAssetLabAction, type AssetLabActionContext } from '../assets/plugins/asset-lab-actions';
import { worldScoreFontPresentation } from '../assets/plugins/world-score-text';

function context(
  readScore: () => number,
  spriteAtlasLoop: AssetLabActionContext['spriteAtlasLoop'] = undefined,
  worldScoreText: AssetLabActionContext['worldScoreText'] = undefined,
): AssetLabActionContext {
  return {
    world: new World(),
    meshHandleSwap: undefined,
    fbxMeshSwap: undefined,
    gltfMeshSwap: undefined,
    jpegTextureSwap: undefined,
    videoTexturePanel: undefined,
    fbxSkinnedTarget: undefined,
    targetProfile: undefined,
    readScore,
    toggleProfile: vi.fn(() => ({ available: true, active: 'profile' as const, precisionHits: 0, precisionComplete: false, title: 'Precision target', scoreMultiplier: 2, rotationSpeed: 0.18, swaps: 1, guid: 'profile', baseColor: [0.12, 0.68, 1, 1] as const })),
    spriteAtlasLoop,
    worldScoreText,
    setProjectileVisual: vi.fn(),
  };
}

describe('game-default guided mission gate', () => {
  it('keeps Target profile locked until the ECS score reaches 50', () => {
    const locked = context(() => 40);
    expect(applyAssetLabAction(locked, 'target-profile')).toEqual({ state: 'unavailable', text: 'Target profile unavailable · score 50 required' });
    expect(locked.toggleProfile).not.toHaveBeenCalled();

    const unlocked = context(() => 50);
    expect(applyAssetLabAction(unlocked, 'target-profile')).toEqual({ state: 'active', text: 'Target profile active · Precision target' });
    expect(unlocked.toggleProfile).toHaveBeenCalledOnce();
  });

  it('restores the moving FBX presentation before another guided outcome', () => {
    const companion = {
      companionActive: vi.fn(() => true),
      toggleCompanion: vi.fn(() => false),
    } as unknown as NonNullable<AssetLabActionContext['fbxSkinnedTarget']>;
    const profile = {
      active: 'profile' as const,
      precisionHits: 0,
    } as NonNullable<AssetLabActionContext['targetProfile']>;
    const guided = { ...context(() => 50), fbxSkinnedTarget: companion, targetProfile: profile };

    expect(applyAssetLabAction(guided, 'target-profile')).toEqual({ state: 'active', text: 'Target profile active · Precision target' });
    expect(companion.toggleCompanion).toHaveBeenCalledOnce();
  });

  it('makes the atlas a named guided projectile outcome', () => {
    const atlas = { toggle: vi.fn(() => true), active: true } as unknown as NonNullable<AssetLabActionContext['spriteAtlasLoop']>;
    const guided = context(() => 50, atlas);

    expect(applyAssetLabAction(guided, 'sprite-atlas')).toEqual({ state: 'active', text: 'PNG atlas projectile active · fire to confirm the four-frame hit' });
    expect(atlas.toggle).toHaveBeenCalledOnce();
    expect(guided.setProjectileVisual).toHaveBeenCalledWith('sprite');
  });

  it('makes the imported font a named scored-text outcome', () => {
    const scoreText = {
      toggleFontSource: vi.fn(() => 'ttf-plugin' as const),
    } as unknown as NonNullable<AssetLabActionContext['worldScoreText']>;
    const guided = context(() => 50, undefined, scoreText);

    expect(applyAssetLabAction(guided, 'font-source')).toEqual({ state: 'active', text: 'TTF score text active · imported glyph metrics on next hit' });
    expect(scoreText.toggleFontSource).toHaveBeenCalledOnce();
  });

  it('gives the imported font a visible presentation and keeps legacy as reset baseline', () => {
    const legacy = worldScoreFontPresentation('legacy-pack');
    const ttf = worldScoreFontPresentation('ttf-plugin');
    expect(legacy).toEqual({ fontSize: 0.024, color: [1, 0.8, 0.2, 1] });
    expect(ttf.fontSize).toBeGreaterThan(legacy.fontSize);
    expect(ttf.color).not.toEqual(legacy.color);
    expect(ttf.color[2]).toBeGreaterThan(ttf.color[0]);
  });

  it('keeps the imported FBX companion behind the completed precision mission', () => {
    const companion = { toggleCompanion: vi.fn(() => true) } as unknown as NonNullable<AssetLabActionContext['fbxSkinnedTarget']>;
    const profile = {
      active: 'profile' as const,
      precisionHits: 0,
    } as NonNullable<AssetLabActionContext['targetProfile']>;
    const locked = { ...context(() => 50), fbxSkinnedTarget: companion, targetProfile: profile };
    expect(applyAssetLabAction(locked, 'fbx-companion')).toEqual({ state: 'unavailable', text: 'FBX target companion unavailable · complete the precision mission first' });
    expect(companion.toggleCompanion).not.toHaveBeenCalled();

    profile.precisionHits = 1;
    expect(applyAssetLabAction(locked, 'fbx-companion')).toEqual({ state: 'active', text: 'FBX target companion active · fire to replay the imported run animation' });
    expect(companion.toggleCompanion).toHaveBeenCalledOnce();
  });
});
