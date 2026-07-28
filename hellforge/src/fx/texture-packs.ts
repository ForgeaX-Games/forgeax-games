// CC0 pack upgrades for the sprite sheets (PR8 T9a — plan §4 L2).
//
// Data: which shipped Kenney Particle Pack files compose which registry
// sheet's flipbook (array order = flipbook frame order, packed row-major by
// loadPngSheet). The loader + registry swap live in fx/textures.ts; main.ts
// wires upgradeFxSheetsFromPacks at boot. Every sheet keeps its procedural
// generate() as the per-sheet fallback (plan §9 L2 fallback path).

import { loadPngSheet, spriteSheetById, upgradeSheetFromPng } from './textures';

/** Sheet id → pack frame files (Kenney Particle Pack, CC0-1.0 — provenance
 * in assets/vfx/provenance.json). The atlas grid comes from the registry
 * entry (the SSOT); files.length must equal the sheet's `frames`. */
const PACK_UPGRADES: ReadonlyArray<{
  readonly id: string;
  readonly files: readonly string[];
}> = [
  // flame — campfire / torch / brazier ambient bodies: irregular fire mass
  // alternating with tall tongues (denser, more organic than muzzle rounds).
  {
    id: 'flame',
    files: ['fire_01.png', 'flame_05.png', 'fire_02.png', 'flame_06.png'],
  },
  // fireball — Magma Bolt flight body + trail: tall tongues only (never a
  // round muzzle frame — the bolt must read as a moving flame, not a ball).
  {
    id: 'fireball',
    files: ['flame_05.png', 'flame_06.png'],
  },
  // impact — 16f @24fps one-shot: muzzle flash → fire burst → smoke dissolve.
  {
    id: 'impact',
    files: [
      'muzzle_03.png', 'muzzle_05.png', 'muzzle_01.png', 'muzzle_02.png',
      'fire_01.png', 'fire_02.png',
      'smoke_01.png', 'smoke_02.png', 'smoke_03.png', 'smoke_04.png',
      'smoke_05.png', 'smoke_06.png', 'smoke_07.png', 'smoke_08.png',
      'smoke_09.png', 'smoke_10.png',
    ],
  },
  // smoke — realistic puffs for the premult wisps (reuses impact's files).
  {
    id: 'smoke',
    files: ['smoke_01.png', 'smoke_05.png', 'smoke_07.png', 'smoke_10.png'],
  },
];

/**
 * Boot hook (main.ts): load every pack sheet and swap it into the registry.
 * `packBaseUrl` is the resolved URL of the pack directory. Never throws —
 * a per-sheet failure warns and leaves the procedural fallback in place, so
 * a missing pack file can never stall boot.
 */
export async function upgradeFxSheetsFromPacks(packBaseUrl: string): Promise<void> {
  await Promise.all(PACK_UPGRADES.map(async (u) => {
    try {
      const spec = spriteSheetById(u.id);
      if (!spec) throw new Error(`unknown sheet id "${u.id}"`);
      const sheet = await loadPngSheet(
        u.files.map((f) => `${packBaseUrl}/${f}`),
        { cols: spec.cols, rows: spec.rows, frames: spec.frames },
      );
      if (!upgradeSheetFromPng(u.id, sheet)) {
        throw new Error(`registry refused sheet id "${u.id}"`);
      }
      console.info(`[hellforge/fx] sheet "${u.id}" upgraded from kenney-particle-pack (CC0)`);
    } catch (e) {
      // Plan §9 L2 fallback: the procedural sheet stays authoritative.
      console.warn(
        `[hellforge/fx] CC0 pack load failed for "${u.id}" — keeping procedural sheet:`,
        (e as Error)?.message ?? e,
      );
    }
  }));
}
