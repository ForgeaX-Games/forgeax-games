import { describe, expect, test } from 'bun:test';
import {
  VISUAL_POLISH_CONTRACT_VERSION,
  VISUAL_POLISH_IMPLEMENTATION_BASE_SHA,
  VISUAL_POLISH_Z,
  assertForgeRevealDuration,
  assetAllowsLogicProgress,
  assetAllowsVisualFinish,
  automapAfterPanelOpen,
  automapToggleExpanded,
  createIntroCompletionLatch,
  forgePhaseAfterRevealAck,
  forgePhaseAfterRevealTimer,
  forgePhaseAfterSettlement,
  nextAudioOwner,
  pointerPolicyFor,
  unitBaselineAcceptable,
} from './visual-polish-contracts';
import { Z } from './ui-theme';

describe('visual-polish-contracts F0', () => {
  test('pins contract version and frozen implementation base', () => {
    expect(VISUAL_POLISH_CONTRACT_VERSION).toBe('f0.1.0');
    expect(VISUAL_POLISH_IMPLEMENTATION_BASE_SHA).toBe(
      '24f38a27cd2e44fae167f70c5732b3a533daad3d',
    );
  });

  test('intro completion is exactly-once', () => {
    const latch = createIntroCompletionLatch();
    expect(latch.isCompleted()).toBe(false);
    const first = latch.complete('skipped');
    expect(first).toEqual({ reason: 'skipped', alreadyCompleted: false });
    const second = latch.complete('ended');
    expect(second.alreadyCompleted).toBe(true);
    expect(second.reason).toBe('skipped');
    expect(latch.isCompleted()).toBe(true);
  });

  test('audio arbitration keeps intro primary until disposed', () => {
    let s = { primary: 'none' as const, introDisposed: false };
    s = nextAudioOwner(s, { type: 'introStart' });
    expect(s.primary).toBe('introVideo');
    s = nextAudioOwner(s, { type: 'bgmArm' });
    expect(s.primary).toBe('introVideo');
    s = nextAudioOwner(s, { type: 'introDispose' });
    expect(s.introDisposed).toBe(true);
    s = nextAudioOwner(s, { type: 'bgmArm' });
    expect(s.primary).toBe('bgm');
  });

  test('visual polish Z slots sit in documented bands', () => {
    expect(VISUAL_POLISH_Z.minimap).toBeGreaterThan(Z.hud);
    expect(VISUAL_POLISH_Z.minimap).toBeLessThan(Z.inventory);
    expect(VISUAL_POLISH_Z.lootCelebration).toBeGreaterThan(Z.cube);
    expect(VISUAL_POLISH_Z.lootCelebration).toBeLessThan(Z.dialogue);
    expect(VISUAL_POLISH_Z.introVideo).toBeGreaterThan(Z.shell);
    expect(VISUAL_POLISH_Z.introVideo).toBeLessThan(Z.fatal);
  });

  test('pointer policies match non-blocking vs modal popups', () => {
    expect(pointerPolicyFor('lootCelebration')).toBe('card-only');
    expect(pointerPolicyFor('forgeReveal')).toBe('card-only');
    expect(pointerPolicyFor('deleteCharConfirm')).toBe('auto');
    expect(pointerPolicyFor('deathOrSaveError')).toBe('auto');
  });

  test('forge phases: fail stays idle; success resolving→reveal→idle', () => {
    expect(forgePhaseAfterSettlement(false)).toBe('idle');
    expect(forgePhaseAfterSettlement(true)).toBe('resolving');
    expect(forgePhaseAfterRevealTimer()).toBe('reveal');
    expect(forgePhaseAfterRevealAck()).toBe('idle');
    expect(assertForgeRevealDuration(1200)).toBe(true);
    expect(assertForgeRevealDuration(1800)).toBe(true);
    expect(assertForgeRevealDuration(1199)).toBe(false);
    expect(assertForgeRevealDuration(1801)).toBe(false);
  });

  test('automap expanded collapses on panel open; minimap persists', () => {
    const open = { minimapVisible: true, expanded: true };
    const after = automapAfterPanelOpen(open);
    expect(after).toEqual({ minimapVisible: true, expanded: false });
    expect(automapToggleExpanded(after).expanded).toBe(true);
  });

  test('asset gate: awaiting allows logic, only accepted finishes visuals', () => {
    const awaiting = { id: 'A1_introVideo' as const, disposition: 'awaiting' as const };
    const accepted = { id: 'A1_introVideo' as const, disposition: 'accepted' as const };
    const fallback = { id: 'A1_introVideo' as const, disposition: 'fallback' as const };
    expect(assetAllowsLogicProgress(awaiting)).toBe(true);
    expect(assetAllowsVisualFinish(awaiting)).toBe(false);
    expect(assetAllowsVisualFinish(accepted)).toBe(true);
    expect(assetAllowsLogicProgress(fallback)).toBe(true);
    expect(assetAllowsVisualFinish(fallback)).toBe(false);
  });

  test('unit baseline gate matches review narrative', () => {
    expect(unitBaselineAcceptable(807, 0)).toBe(true);
    expect(unitBaselineAcceptable(806, 0)).toBe(false);
    expect(unitBaselineAcceptable(900, 1)).toBe(false);
  });
});
