// Distant lava-cone mountains — irregular baked cones (prop-volcano-*) with
// 熔渣/熔岩 textures. Used for both the encampment horizon and the den
// (熔渣深窟) cavern rim. Fixed seed per site; per-peak RNG for variety.

import {
  Materials,
  MeshFilter,
  MeshRenderer,
} from '@forgeax/engine-render';
import {
  Transform,
} from '@forgeax/engine-scene';
import {
  quat,
} from '@forgeax/engine-runtime';
import {
  type MaterialAsset,
} from '@forgeax/engine-types';
import { HANDLE_CUBE, type AssetRegistry } from '@forgeax/engine-assets-runtime';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { Handle, MeshAsset } from '@forgeax/engine-types';

import { mulberry32 } from './dungeon-layout';
import { SLAG_MATERIAL_GUID, VOLCANO_VARIANTS, type VolcanoVariant } from './volcano-assets';

/** Re-export seeded PRNG — wilderness generation never uses Math.random(). */
export { mulberry32 };

/** Matches bake-ground.ts GROUND_SIZE / 2 (camp apron). */
export const GROUND_HALF = 60;

/**
 * Playable wild / camp rim used by NavigationQuery.
 * Keep in sync with `assets/scenes/ashen-reach.layout.json` + main walk bounds
 * (authored 2D blockers — not inferred from volcano meshes).
 */
export const ASHEN_REACH_BOUNDS = { x0: -52, x1: 52, z0: -48, z1: 58 } as const;

/** Yaw + lean (tilt away from vertical) as a single quaternion. */
function mountainQuat(yaw: number, lean: number, leanHeading: number): [number, number, number, number] {
  const qYaw = quat.create();
  quat.fromAxisAngle(qYaw, [0, 1, 0], yaw);
  const qLean = quat.create();
  const ax = Math.cos(leanHeading);
  const az = -Math.sin(leanHeading);
  quat.fromAxisAngle(qLean, [ax, 0, az], lean);
  const out = quat.create();
  quat.multiply(out, qYaw, qLean);
  return [out[0]!, out[1]!, out[2]!, out[3]!];
}

export type InstallWildTerrainOpts = {
  /** Ring centre in world space. */
  origin?: { x: number; z: number };
  seed?: number;
  /**
   * Inner half-extent of the playable floor this ring wraps.
   * Camp ≈ 60 (prop-ground); den ≈ CELLS*CELL/2 (~53) so peaks sit outside walls.
   */
  half?: number;
  /** Soft void-fill plane under the site (default true). */
  apron?: boolean;
  /** Log label — camp | den. */
  label?: string;
  /** PR11 T2 — fires once per settled peak-bank load (first install only). */
  onItem?: () => void;
};

type PeakBank = {
  mesh: Handle<'MeshAsset', 'shared'>;
  mat: Handle<'MaterialAsset', 'shared'>;
};

/** Shared across camp + den installs in one boot (meshes loaded once). */
let peakBank: PeakBank[] | null = null;

async function ensurePeakBank(
  world: World,
  assets: AssetRegistry,
  onItem?: () => void,
): Promise<PeakBank[] | null> {
  if (peakBank !== null) return peakBank;
  const note = (): void => { onItem?.(); };

  const slagGuid = AssetGuid.parse(SLAG_MATERIAL_GUID);
  if (!slagGuid.ok) {
    console.warn('[hellforge] wild-terrain: slag material guid invalid');
    // Settle all 9 items (material + 8 meshes) so a bad constant can't stall the
    // determinate bar below 100% — the load is done (failed), not pending.
    for (let i = 0; i < 1 + VOLCANO_VARIANTS.length; i++) note();
    return null;
  }
  // Slag material + all 8 cone meshes race together (PR11 T3); onItem fires
  // once per settled load (1 material + 8 meshes = 9 items) for the tracker.
  const slagP = assets.loadByGuid<MaterialAsset>(slagGuid.value).then((r) => { note(); return r; });
  const meshPs = VOLCANO_VARIANTS.map((v) => {
    const mg = AssetGuid.parse(v.mesh);
    if (!mg.ok) { note(); return Promise.resolve<{ v: VolcanoVariant; payload: MeshAsset | null }>({ v, payload: null }); }
    return assets.loadByGuid<MeshAsset>(mg.value)
      .then((mr): { v: VolcanoVariant; payload: MeshAsset | null } => { note(); return { v, payload: mr.ok && mr.value ? mr.value : null }; });
  });
  const [slagRes, meshResults] = await Promise.all([slagP, Promise.all(meshPs)]);
  if (!slagRes.ok) {
    console.warn('[hellforge] wild-terrain: slag material load failed');
    return null;
  }
  const slagMat = world.allocSharedRef<'MaterialAsset', MaterialAsset>(
    'MaterialAsset',
    slagRes.value,
  );

  const bank: PeakBank[] = [];
  for (const { v, payload } of meshResults) {
    if (payload === null) {
      console.warn(`[hellforge] wild-terrain: failed to load ${v.name}`);
      continue;
    }
    bank.push({
      mesh: world.allocSharedRef<'MeshAsset', MeshAsset>('MeshAsset', payload),
      mat: slagMat,
    });
  }
  if (bank.length === 0) {
    console.warn('[hellforge] wild-terrain: all volcano loads failed');
    return null;
  }
  peakBank = bank;
  return bank;
}

/**
 * Spawn outer apron + seeded irregular lava cones around `origin`.
 * Call for camp and again for the den (different origin/seed/half).
 */
export async function installWildTerrain(
  world: World,
  assets: AssetRegistry | null | undefined,
  opts: InstallWildTerrainOpts = {},
): Promise<void> {
  const origin = opts.origin ?? { x: 0.17, z: 4.78 };
  const half = opts.half ?? GROUND_HALF;
  const rng = mulberry32(opts.seed ?? 0xc1de301);
  const label = opts.label ?? 'site';
  const wantApron = opts.apron !== false;

  if (wantApron) {
    const apronMat = world.allocSharedRef<'MaterialAsset', MaterialAsset>(
      'MaterialAsset',
      Materials.standard({
        baseColor: [0.12, 0.08, 0.07, 1],
        roughness: 0.98,
        metallic: 0.02,
      }),
    );
    const apron = Math.max(180, half * 3.2);
    world.spawn(
      {
        component: Transform,
        data: { pos: [origin.x, -0.55, origin.z], scale: [apron, 0.4, apron] },
      },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [apronMat] } },
    );
  }

  if (!assets || VOLCANO_VARIANTS.length === 0) {
    console.warn(`[hellforge] wild-terrain(${label}): no volcano assets — apron only`);
    return;
  }

  const bank = await ensurePeakBank(world, assets, opts.onItem);
  if (!bank) return;

  const spawnPeak = (
    x: number, z: number,
    height: number, base: number,
    yaw: number, lean: number,
    variant: PeakBank,
  ): EntityHandle => {
    const leanHeading = yaw + Math.PI / 2;
    return world.spawn(
      {
        component: Transform,
        data: {
          pos: [x, 0, z],
          quat: mountainQuat(yaw, lean, leanHeading),
          scale: [base, height, base * (0.75 + rng() * 0.55)],
        },
      },
      { component: MeshFilter, data: { assetHandle: variant.mesh } },
      { component: MeshRenderer, data: { materials: [variant.mat] } },
    ).unwrap() as EntityHandle;
  };

  // Keep peaks outside the playable floor. Den corners sit at ~half*√2 —
  // start mid ring past that so cones don't punch through rooms.
  const midInner = half * 1.45 + 4;
  const midCount = 22;
  for (let i = 0; i < midCount; i++) {
    const ang = (i / midCount) * Math.PI * 2 + (rng() - 0.5) * 0.7;
    const r = midInner + rng() * 16;
    const x = origin.x + Math.cos(ang) * r;
    const z = origin.z + Math.sin(ang) * r;
    const v = bank[Math.floor(rng() * bank.length)]!;
    const height = 6 + rng() * 16;
    const base = height * (1.15 + rng() * 1.1) + rng() * 6;
    const yaw = rng() * Math.PI * 2;
    const lean = (rng() - 0.5) * 0.32;
    spawnPeak(x, z, height, base, yaw, lean, v);
    if (rng() < 0.4) {
      const v2 = bank[Math.floor(rng() * bank.length)]!;
      const ox = Math.cos(ang + 0.25) * (4 + rng() * 7);
      const oz = Math.sin(ang + 0.25) * (4 + rng() * 7);
      const h2 = height * (0.4 + rng() * 0.55);
      spawnPeak(
        x + ox, z + oz,
        h2,
        h2 * (1.0 + rng() * 1.2),
        yaw + rng() * 1.5,
        lean + (rng() - 0.5) * 0.2,
        v2,
      );
    }
  }

  const rimCount = 26;
  for (let i = 0; i < rimCount; i++) {
    const ang = (i / rimCount) * Math.PI * 2 + (rng() - 0.5) * 0.65;
    const r = half + 18 + rng() * 30;
    const x = origin.x + Math.cos(ang) * r;
    const z = origin.z + Math.sin(ang) * r;
    const v = bank[Math.floor(rng() * bank.length)]!;
    const height = 10 + rng() * 24;
    const base = height * (1.2 + rng() * 1.3);
    spawnPeak(x, z, height, base, rng() * Math.PI * 2, (rng() - 0.5) * 0.38, v);
  }

  for (let i = 0; i < 14; i++) {
    const ang = rng() * Math.PI * 2;
    const r = half + 36 + rng() * 48;
    const x = origin.x + Math.cos(ang) * r;
    const z = origin.z + Math.sin(ang) * r;
    const v = bank[Math.floor(rng() * bank.length)]!;
    const height = 14 + rng() * 28;
    spawnPeak(
      x, z,
      height,
      height * (1.1 + rng() * 1.4),
      rng() * Math.PI * 2,
      (rng() - 0.5) * 0.42,
      v,
    );
  }

  console.log(`[hellforge] wild-terrain(${label}): ${bank.length} lava-cone variants @ (${origin.x.toFixed(0)},${origin.z.toFixed(0)}) half=${half.toFixed(0)}`);
}
