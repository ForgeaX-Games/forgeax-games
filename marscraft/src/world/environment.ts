// MarsCraft environment / atmosphere decor — ported from the Three.js
// `web/world/Environment.ts` (atmosphere) + the world-geometry decor in
// `web/world/Terrain.ts` (`_buildDecorations`, the rock/boulder branch) to the
// forgeax-engine (WebGPU ECS).
//
// ── What this ports vs. what it skips ────────────────────────────────────────
// The Three.js `Environment.ts` is *pure atmosphere*: a canvas sky-gradient
// background, `THREE.Fog`, `AmbientLight`, `DirectionalLight` (with shadows) and
// a `HemisphereLight`. None of that is WORLD GEOMETRY:
//   - sky gradient (CanvasTexture background)  → SKIPPED: forgeax has no
//     scene-background texture analogue; main.ts already sets a Mars clear color
//     on the Camera, which is the closest equivalent.
//   - THREE.Fog                                → SKIPPED: no forgeax fog analogue
//     (would need a post/shader feature the engine doesn't expose here).
//   - AmbientLight / DirectionalLight / HemisphereLight → SKIPPED: main.ts
//     already spawns a Skylight + DirectionalLight (the forgeax equivalents).
//   - shadow config / postprocessing          → SKIPPED: not exposed; main.ts
//     keeps castShadow:false for the WebKit path.
//
// The ACTUAL Mars-ambience world geometry (scattered rocks / boulders / ground
// detail) lives in Terrain.ts's `_buildDecorations`. We port the rock decor
// style here as a DETERMINISTIC ambient scatter across the open map, built from
// forgeax procedural primitives (sphere → rocks, box → boulders, cone → spires),
// tinted with theme-appropriate Mars rock colors, and placed on the heightfield
// surface — avoiding pathable corridors, spawn points and mineral/geyser areas
// so the decor never blocks gameplay.

import {
  Transform,
  MeshFilter,
  MeshRenderer,
  quat,
  type Handle,
} from '@forgeax/engine-runtime';
import { type MeshAsset } from '@forgeax/engine-assets-runtime';
import {
  createBoxGeometry,
  createSphereGeometry,
  createConeGeometry,
} from '@forgeax/engine-geometry';
import type { World } from '@forgeax/engine-ecs';
import type { AssetGuid } from '@forgeax/engine-pack/guid';
import type { MapConfig } from '../mapgen/types';
import {
  getThemePalette,
  DEFAULT_THEME,
  type TerrainThemePalette,
} from './terrain-themes';

type RGB = [number, number, number];

/** Mints a tinted child of the lit PBR base material (same closure main.ts builds). */
type TintFn = (rgb: RGB, opts?: { metallic?: number; roughness?: number }) => Handle<'MaterialAsset', 'shared'>;

// ── deterministic RNG (mulberry32) ───────────────────────────────────────────
// Seeded so the scatter is byte-stable across runs (stable screenshots). The
// seed is derived from map size + name so different maps scatter differently but
// the same map always reproduces the same layout.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ── pathing / gameplay avoidance ─────────────────────────────────────────────
// A scatter candidate is rejected if it sits on an unpathable cell (cliffs,
// trenches, borders, walls — pathingGrid==1), near a spawn point, or near a
// mineral patch / geyser. Mirrors the source intent that ambient decor never
// blocks bases or pathable corridors.

/** True if the world XZ cell is flagged unpathable (cliffs/trenches/borders). */
function isUnpathable(map: MapConfig, worldX: number, worldZ: number): boolean {
  const res = map.gridResolution;
  const col = Math.round(((worldX + map.width / 2) / map.width) * (res - 1));
  const row = Math.round(((worldZ + map.height / 2) / map.height) * (res - 1));
  if (col < 0 || col >= res || row < 0 || row >= res) return true; // off-map
  return map.pathingGrid[row * res + col] > 0;
}

/** True if (worldX,worldZ) is within `radius` of any spawn point. */
function nearSpawn(map: MapConfig, worldX: number, worldZ: number, radius: number): boolean {
  const r2 = radius * radius;
  for (const s of map.spawnPoints) {
    const dx = worldX - s.x;
    const dz = worldZ - s.z;
    if (dx * dx + dz * dz < r2) return true;
  }
  return false;
}

/** True if (worldX,worldZ) is within `radius` of any mineral patch or geyser. */
function nearResource(map: MapConfig, worldX: number, worldZ: number, radius: number): boolean {
  const r2 = radius * radius;
  for (const m of map.minerals) {
    const dx = worldX - m.x;
    const dz = worldZ - m.z;
    if (dx * dx + dz * dz < r2) return true;
  }
  for (const g of map.geysers) {
    const dx = worldX - g.x;
    const dz = worldZ - g.z;
    if (dx * dx + dz * dz < r2) return true;
  }
  // Also keep clear of predefined base CC locations.
  for (const b of map.baseLocations) {
    const dx = worldX - b.x;
    const dz = worldZ - b.z;
    if (dx * dx + dz * dz < r2) return true;
  }
  return false;
}

/**
 * Build the Mars ambience decor (scattered rocks / boulders / spires) into
 * `world`, placed on the terrain surface via `heightAt`. Deterministic.
 *
 * @param world    the ECS world
 * @param _baseGuid the lit PBR base-material GUID (kept for signature symmetry
 *                  with buildTerrain; tinting goes through `tint`)
 * @param tint     factory that mints a tinted child of the base material
 * @param map      the generated MapConfig (pathingGrid / spawnPoints / minerals)
 * @param heightAt surface-height sampler (from buildTerrain) for surface placement
 */
export function buildEnvironment(
  world: World,
  _baseGuid: AssetGuid,
  tint: TintFn,
  map: MapConfig,
  heightAt: (worldX: number, worldZ: number) => number,
): void {
  const palette = getThemePalette(map.theme ?? DEFAULT_THEME);

  // Reusable unit meshes (1-unit) — scaled per instance via Transform.scale.
  // - rock  : low-poly sphere (Mars boulder; the source uses a perturbed
  //           dodecahedron — a coarse sphere is the closest forgeax primitive).
  // - chunk : box (angular rubble / fractured slab).
  // - spire : cone (small rock pinnacle / ground-detail spike).
  const rockRes = createSphereGeometry(1, 8, 6);
  const chunkRes = createBoxGeometry(1, 1, 1, 1, 1, 1);
  const spireRes = createConeGeometry(1, 1, 6);
  if (!rockRes.ok || !chunkRes.ok || !spireRes.ok) {
    console.warn('[marscraft] environment: primitive geometry failed; skipping decor');
    return;
  }
  const rockMesh: Handle<'MeshAsset', 'shared'> = world.allocSharedRef('MeshAsset', rockRes.value as MeshAsset);
  const chunkMesh: Handle<'MeshAsset', 'shared'> = world.allocSharedRef('MeshAsset', chunkRes.value as MeshAsset);
  const spireMesh: Handle<'MeshAsset', 'shared'> = world.allocSharedRef('MeshAsset', spireRes.value as MeshAsset);

  // Theme rock-tone material variants (mirrors Terrain.ts's brown 0x8b4a23 rock
  // material, but driven by the theme palette so each Mars theme looks right).
  // Three shared materials → cheap; per-instance variety comes from scale/rot.
  const rockBase: RGB = palette.rock;
  const matRockA = tint([clamp01(rockBase[0] * 1.15), clamp01(rockBase[1] * 1.1), clamp01(rockBase[2] * 1.05)], { roughness: 1.0, metallic: 0.02 });
  const matRockB = tint([clamp01(rockBase[0] * 0.85), clamp01(rockBase[1] * 0.85), clamp01(rockBase[2] * 0.9)], { roughness: 1.0, metallic: 0.02 });
  const matRockC = tint([clamp01(palette.regolith[0] * 0.7), clamp01(palette.regolith[1] * 0.7), clamp01(palette.regolith[2] * 0.7)], { roughness: 0.95, metallic: 0.03 });
  const rockMats = [matRockA, matRockB, matRockC];

  // ── deterministic scatter ───────────────────────────────────────────────────
  // Cap total entities at a few hundred so the frame stays smooth. Candidate
  // budget scales loosely with map area but is bounded; each candidate may be
  // rejected by the gameplay-avoidance checks, so we draw extra candidates.
  const W = map.width;
  const H = map.height;
  const MAX_PROPS = 280;
  const CANDIDATES = 1200; // attempts; placed ones bounded by MAX_PROPS

  const rng = mulberry32(hashStr(`${map.name}:${W}x${H}:env`));

  // Margin so nothing spawns right on the map border (the dark border band).
  const marginX = W * 0.06;
  const marginZ = H * 0.06;

  let placed = 0;
  for (let i = 0; i < CANDIDATES && placed < MAX_PROPS; i++) {
    const x = -W / 2 + marginX + rng() * (W - 2 * marginX);
    const z = -H / 2 + marginZ + rng() * (H - 2 * marginZ);

    // Gameplay-area avoidance.
    if (isUnpathable(map, x, z)) continue;          // skip cliffs/trenches/borders
    if (nearSpawn(map, x, z, 9)) continue;          // keep spawns clear
    if (nearResource(map, x, z, 7)) continue;       // keep mineral/geyser/CC clear

    const y = heightAt(x, z);

    // Prop-type selection (weighted: mostly rocks, some chunks, few spires).
    const roll = rng();
    let mesh: Handle<'MeshAsset', 'shared'>;
    let scaleX: number;
    let scaleY: number;
    let scaleZ: number;
    let yOffset: number;

    if (roll < 0.6) {
      // Rounded boulder — squashed sphere, half-buried look.
      mesh = rockMesh;
      const s = 0.5 + rng() * 1.3;             // base radius 0.5..1.8
      scaleX = s * (0.85 + rng() * 0.4);
      scaleZ = s * (0.85 + rng() * 0.4);
      scaleY = s * (0.6 + rng() * 0.5);        // flatter than wide
      yOffset = scaleY * 0.45;                  // sink ~half into ground
    } else if (roll < 0.88) {
      // Angular rubble chunk — box.
      mesh = chunkMesh;
      const s = 0.4 + rng() * 1.1;
      scaleX = s * (0.7 + rng() * 0.8);
      scaleZ = s * (0.7 + rng() * 0.8);
      scaleY = s * (0.5 + rng() * 0.9);
      yOffset = scaleY * 0.4;
    } else {
      // Small rock spire / ground spike — cone.
      mesh = spireMesh;
      const s = 0.4 + rng() * 0.9;
      scaleX = s * (0.5 + rng() * 0.4);
      scaleZ = s * (0.5 + rng() * 0.4);
      scaleY = s * (1.4 + rng() * 1.4);         // tall
      yOffset = scaleY * 0.45;
    }

    // Random yaw + slight tilt (a few degrees) for a natural strewn look.
    const yaw = rng() * Math.PI * 2;
    const tilt = (rng() - 0.5) * 0.3; // ±~0.15 rad
    const tiltAxis = rng() * Math.PI * 2;
    const q = quat.create();
    const qYaw = quat.create();
    quat.fromAxisAngle(qYaw, [0, 1, 0], yaw);
    const qTilt = quat.create();
    quat.fromAxisAngle(qTilt, [Math.cos(tiltAxis), 0, Math.sin(tiltAxis)], tilt);
    quat.multiply(q, qYaw, qTilt);

    const mat = rockMats[(placed + i) % rockMats.length];

    world.spawn(
      {
        component: Transform,
        data: {
          pos: [x, y + yOffset, z],
          quat: [q[0], q[1], q[2], q[3]],
          scale: [scaleX, scaleY, scaleZ],
        },
      },
      { component: MeshFilter, data: { assetHandle: mesh } },
      { component: MeshRenderer, data: { materials: [mat] } },
    );
    placed++;
  }

  console.info(`[marscraft] environment: scattered ${placed} ambient props (rocks/chunks/spires)`);
}
