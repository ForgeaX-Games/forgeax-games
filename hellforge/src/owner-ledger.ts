// Lightweight install/registration ledger for Stop→Play owner assertions (PR 0).

export type OwnerSnapshot = {
  systems: Record<string, number>;
  uiActive: string | null;
  bgm: number;
  sfx: number;
};

export type OwnerAssertResult = {
  ok: boolean;
  failures: string[];
  snapshot: OwnerSnapshot;
};

export type OwnerLedger = {
  trackSystem(name: string): () => void;
  trackBgm(): () => void;
  trackSfx(): () => void;
  snapshot(uiActive: string | null): OwnerSnapshot;
  assertSingleOwners(uiActive: string | null, requiredSystems: readonly string[]): OwnerAssertResult;
};

export function createOwnerLedger(): OwnerLedger {
  const systems: Record<string, number> = {};
  let bgm = 0;
  let sfx = 0;

  return {
    trackSystem(name) {
      systems[name] = (systems[name] ?? 0) + 1;
      return () => {
        systems[name] = (systems[name] ?? 1) - 1;
      };
    },
    trackBgm() {
      bgm += 1;
      return () => { bgm = Math.max(0, bgm - 1); };
    },
    trackSfx() {
      sfx += 1;
      return () => { sfx = Math.max(0, sfx - 1); };
    },
    snapshot(uiActive) {
      return { systems: { ...systems }, uiActive, bgm, sfx };
    },
    assertSingleOwners(uiActive, requiredSystems) {
      const snapshot = this.snapshot(uiActive);
      const failures: string[] = [];
      for (const [name, n] of Object.entries(snapshot.systems)) {
        if (n > 1) failures.push(`system ${name}: expected ≤1, got ${n}`);
      }
      for (const name of requiredSystems) {
        const n = snapshot.systems[name] ?? 0;
        if (n !== 1) failures.push(`system ${name}: expected 1, got ${n}`);
      }
      if (snapshot.bgm !== 1) failures.push(`bgm owners: expected 1, got ${snapshot.bgm}`);
      if (snapshot.sfx !== 1) failures.push(`sfx owners: expected 1, got ${snapshot.sfx}`);
      // uiActive may be null (world) or a single panel name — duplicates are not
      // representable by UiLayerManager; just surface the current owner.
      return { ok: failures.length === 0, failures, snapshot };
    },
  };
}

/**
 * Named Hellforge Update systems that must exist exactly once after Play.
 * `hellforge-shell-update` is title-path only (absent on den-direct) — still
 * tracked, and any count > 1 fails via the duplicate scan.
 */
export const HELLFORGE_UPDATE_SYSTEMS = [
  'hellforge-bgm-update',
  'hellforge-runtime-update',
] as const;
