import { describe, expect, test } from 'bun:test';
import { createOwnerLedger, HELLFORGE_UPDATE_SYSTEMS } from './owner-ledger';

describe('owner ledger', () => {
  test('assertSingleOwners passes with one of each required system + audio', () => {
    const ledger = createOwnerLedger();
    const cleanups = [
      ledger.trackBgm(),
      ledger.trackSfx(),
      ...HELLFORGE_UPDATE_SYSTEMS.map((n) => ledger.trackSystem(n)),
      ledger.trackSystem('hellforge-shell-update'), // optional title-path system
    ];
    const res = ledger.assertSingleOwners(null, HELLFORGE_UPDATE_SYSTEMS);
    expect(res.ok).toBe(true);
    expect(res.failures).toEqual([]);
    // simulate Stop cleanup
    for (const c of cleanups) c();
    const after = ledger.assertSingleOwners(null, HELLFORGE_UPDATE_SYSTEMS);
    expect(after.ok).toBe(false);
    expect(after.failures.some((f) => f.includes('hellforge-bgm-update'))).toBe(true);
  });

  test('detects duplicate system registration', () => {
    const ledger = createOwnerLedger();
    ledger.trackBgm();
    ledger.trackSfx();
    for (const n of HELLFORGE_UPDATE_SYSTEMS) ledger.trackSystem(n);
    ledger.trackSystem('hellforge-runtime-update'); // leak
    const res = ledger.assertSingleOwners('cutscene', HELLFORGE_UPDATE_SYSTEMS);
    expect(res.ok).toBe(false);
    expect(res.snapshot.uiActive).toBe('cutscene');
    expect(res.failures.join(' ')).toContain('hellforge-runtime-update');
  });
});
