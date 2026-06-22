/**
 * Multi-Zone Terrain Background — 多地形区域 (无 Z-fighting 版)
 *
 * 所有元素都有足够体积，不使用薄片平面，彻底避免闪烁。
 * 5 种区域: 城市 / 工业 / 河流 / 公园 / 高速
 *
 * // 飞过不同的风景，不再闪啦~ ♪
 */
import { Transform, MeshFilter, MeshRenderer } from '@forgeax/engine-runtime';
import { defineComponent } from '@forgeax/engine-ecs';
import type { World } from '@forgeax/engine-ecs';
import type { Geo, Mat } from './setup';

export const Star = defineComponent('Star', { speed: 'f32' });

const ARENA_W = 26;
const ARENA_H = 26;
const BASE_Y = -4; // city far below to avoid any conflict with gameplay
const SCROLL_SPEED = 3.5;
const ZONE_DEPTH = 8;

type Zone = 'city' | 'industrial' | 'river' | 'park' | 'highway';
const ZONES: Zone[] = ['city', 'industrial', 'river', 'park', 'highway'];

export function spawnBackground(world: World, geo: Geo, mat: Mat) {
  const totalDepth = ARENA_H * 2;
  const zoneCount = Math.ceil(totalDepth / ZONE_DEPTH) + 2;

  for (let zi = 0; zi < zoneCount; zi++) {
    const startZ = -ARENA_H - zi * ZONE_DEPTH;
    const zone = ZONES[Math.floor(Math.random() * ZONES.length)]!;
    spawnZone(world, geo, mat, zone, startZ);
  }

  // Distant stars (deep below, no overlap possible)
  for (let i = 0; i < 30; i++) {
    const s = 0.03 + Math.random() * 0.05;
    world.spawn(
      { component: Transform, data: {
        posX: (Math.random() - 0.5) * ARENA_W * 2.2,
        posY: -12 - Math.random() * 5,
        posZ: (Math.random() - 0.5) * totalDepth,
        scaleX: s, scaleY: s, scaleZ: s,
      }},
      { component: MeshFilter, data: { assetHandle: geo.sphereTiny } },
      { component: MeshRenderer, data: { materials: [Math.random() > 0.3 ? mat.starD : mat.starW] } },
      { component: Star, data: { speed: 1 + Math.random() * 1.5 } },
    );
  }
}

function spawnZone(world: World, geo: Geo, mat: Mat, zone: Zone, startZ: number) {
  switch (zone) {
    case 'city': spawnCityZone(world, geo, mat, startZ); break;
    case 'industrial': spawnIndustrialZone(world, geo, mat, startZ); break;
    case 'river': spawnRiverZone(world, geo, mat, startZ); break;
    case 'park': spawnParkZone(world, geo, mat, startZ); break;
    case 'highway': spawnHighwayZone(world, geo, mat, startZ); break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  CITY ZONE — Neon buildings (only volumetric objects, no flat planes)
// ═══════════════════════════════════════════════════════════════════════════
function spawnCityZone(world: World, geo: Geo, mat: Mat, startZ: number) {
  const buildingMats = [mat.cityDark, mat.cityMid, mat.cityLight];
  const neonMats = [mat.neonCyan, mat.neonPink, mat.neonPurple, mat.neonGreen];

  const cols = 9;
  const spacing = ARENA_W * 2.2 / cols;

  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < 3; row++) {
      if (Math.random() < 0.12) continue;
      const bx = (col - cols / 2) * spacing + (Math.random() - 0.5) * 0.8;
      const bz = startZ + row * (ZONE_DEPTH / 3) + (Math.random() - 0.5) * 1.2;
      const height = 0.5 + Math.random() * 3.0;
      const width = 0.5 + Math.random() * 1.2;
      const depth = 0.5 + Math.random() * 1.0;
      const bMat = buildingMats[Math.floor(Math.random() * buildingMats.length)]!;

      // Building body (solid box with volume)
      world.spawn(
        { component: Transform, data: { posX: bx, posY: BASE_Y - height / 2, posZ: bz, scaleX: width, scaleY: height, scaleZ: depth }},
        { component: MeshFilter, data: { assetHandle: geo.CUBE } },
        { component: MeshRenderer, data: { materials: [bMat] } },
        { component: Star, data: { speed: SCROLL_SPEED } },
      );

      // Neon sign (volumetric bar, not flat)
      if (Math.random() < 0.2) {
        const nMat = neonMats[Math.floor(Math.random() * neonMats.length)]!;
        const side = Math.random() > 0.5 ? 1 : -1;
        world.spawn(
          { component: Transform, data: {
            posX: bx + side * (width / 2 + 0.08),
            posY: BASE_Y - height * 0.6,
            posZ: bz,
            scaleX: 0.06, scaleY: 0.2 + Math.random() * 0.2, scaleZ: 0.4 + Math.random() * 0.3,
          }},
          { component: MeshFilter, data: { assetHandle: geo.CUBE } },
          { component: MeshRenderer, data: { materials: [nMat] } },
          { component: Star, data: { speed: SCROLL_SPEED } },
        );
      }

      // Antenna on tall buildings
      if (height > 2.0 && Math.random() < 0.4) {
        world.spawn(
          { component: Transform, data: { posX: bx, posY: BASE_Y - height - 0.3, posZ: bz, scaleX: 0.04, scaleY: 0.5, scaleZ: 0.04 }},
          { component: MeshFilter, data: { assetHandle: geo.CUBE } },
          { component: MeshRenderer, data: { materials: [mat.antenna] } },
          { component: Star, data: { speed: SCROLL_SPEED } },
        );
        // Blinking light sphere at top
        world.spawn(
          { component: Transform, data: { posX: bx, posY: BASE_Y - height - 0.6, posZ: bz, scaleX: 0.06, scaleY: 0.06, scaleZ: 0.06 }},
          { component: MeshFilter, data: { assetHandle: geo.sphereTiny } },
          { component: MeshRenderer, data: { materials: [mat.neonCyan] } },
          { component: Star, data: { speed: SCROLL_SPEED } },
        );
      }

      // Rooftop equipment
      if (Math.random() < 0.25 && height > 1.2) {
        world.spawn(
          { component: Transform, data: {
            posX: bx + (Math.random() - 0.5) * width * 0.4,
            posY: BASE_Y - height - 0.12,
            posZ: bz + (Math.random() - 0.5) * depth * 0.3,
            scaleX: 0.2, scaleY: 0.2, scaleZ: 0.2,
          }},
          { component: MeshFilter, data: { assetHandle: geo.CUBE } },
          { component: MeshRenderer, data: { materials: [mat.rooftop] } },
          { component: Star, data: { speed: SCROLL_SPEED } },
        );
      }
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  INDUSTRIAL ZONE — Factories, smokestacks, pipes (all volumetric)
// ═══════════════════════════════════════════════════════════════════════════
function spawnIndustrialZone(world: World, geo: Geo, mat: Mat, startZ: number) {
  const cols = 5;
  const spacing = ARENA_W * 2.2 / cols;

  for (let col = 0; col < cols; col++) {
    const bx = (col - cols / 2) * spacing + (Math.random() - 0.5) * 2;
    const bz = startZ + Math.random() * ZONE_DEPTH;

    // Factory (wide, low building)
    const w = 1.8 + Math.random() * 2.5;
    const h = 0.5 + Math.random() * 1.2;
    const d = 1.5 + Math.random() * 2.0;
    world.spawn(
      { component: Transform, data: { posX: bx, posY: BASE_Y - h / 2, posZ: bz, scaleX: w, scaleY: h, scaleZ: d }},
      { component: MeshFilter, data: { assetHandle: geo.CUBE } },
      { component: MeshRenderer, data: { materials: [mat.factory] } },
      { component: Star, data: { speed: SCROLL_SPEED } },
    );

    // Smokestacks (cylinders with volume)
    const stacks = 1 + Math.floor(Math.random() * 3);
    for (let s = 0; s < stacks; s++) {
      const sx = bx + (s - stacks / 2) * 0.7;
      const stackH = 1.0 + Math.random() * 1.8;
      world.spawn(
        { component: Transform, data: { posX: sx, posY: BASE_Y - h - stackH / 2, posZ: bz, scaleX: 0.25, scaleY: stackH, scaleZ: 0.25 }},
        { component: MeshFilter, data: { assetHandle: geo.cylinder } },
        { component: MeshRenderer, data: { materials: [mat.smokestack] } },
        { component: Star, data: { speed: SCROLL_SPEED } },
      );
      // Glow sphere at top (not flat)
      world.spawn(
        { component: Transform, data: { posX: sx, posY: BASE_Y - h - stackH - 0.1, posZ: bz, scaleX: 0.18, scaleY: 0.18, scaleZ: 0.18 }},
        { component: MeshFilter, data: { assetHandle: geo.sphereTiny } },
        { component: MeshRenderer, data: { materials: [mat.steamGlow] } },
        { component: Star, data: { speed: SCROLL_SPEED } },
      );
    }

    // Pipes (horizontal bars with volume)
    if (Math.random() < 0.6) {
      const pipeLen = 2 + Math.random() * 3;
      world.spawn(
        { component: Transform, data: { posX: bx, posY: BASE_Y - h * 0.4, posZ: bz + d / 2 + 0.3, scaleX: pipeLen, scaleY: 0.12, scaleZ: 0.12 }},
        { component: MeshFilter, data: { assetHandle: geo.CUBE } },
        { component: MeshRenderer, data: { materials: [mat.pipe] } },
        { component: Star, data: { speed: SCROLL_SPEED } },
      );
    }

    // Rusty tank (sphere - definitely no z-fighting)
    if (Math.random() < 0.4) {
      const tankS = 0.4 + Math.random() * 0.5;
      world.spawn(
        { component: Transform, data: { posX: bx + w * 0.4, posY: BASE_Y - tankS, posZ: bz + (Math.random() - 0.5) * d, scaleX: tankS, scaleY: tankS * 0.7, scaleZ: tankS }},
        { component: MeshFilter, data: { assetHandle: geo.sphereSm } },
        { component: MeshRenderer, data: { materials: [mat.rust] } },
        { component: Star, data: { speed: SCROLL_SPEED } },
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  RIVER ZONE — Bridge pillars, bank buildings (no flat water plane)
// ═══════════════════════════════════════════════════════════════════════════
function spawnRiverZone(world: World, geo: Geo, mat: Mat, startZ: number) {
  const riverWidth = 4 + Math.random() * 3;
  const riverX = (Math.random() - 0.5) * 4;

  // River bank buildings on both sides
  for (const side of [-1, 1]) {
    for (let b = 0; b < 5; b++) {
      const bx = riverX + side * (riverWidth / 2 + 1 + Math.random() * 3);
      const bz = startZ + b * (ZONE_DEPTH / 5) + Math.random() * 1.2;
      const h = 0.4 + Math.random() * 1.8;
      const w = 0.5 + Math.random() * 1.0;
      const d = 0.5 + Math.random() * 0.8;
      world.spawn(
        { component: Transform, data: { posX: bx, posY: BASE_Y - h / 2, posZ: bz, scaleX: w, scaleY: h, scaleZ: d }},
        { component: MeshFilter, data: { assetHandle: geo.CUBE } },
        { component: MeshRenderer, data: { materials: [mat.cityMid] } },
        { component: Star, data: { speed: SCROLL_SPEED } },
      );
    }

    // River bank wall (volumetric, not flat)
    world.spawn(
      { component: Transform, data: { posX: riverX + side * (riverWidth / 2), posY: BASE_Y - 0.2, posZ: startZ + ZONE_DEPTH / 2, scaleX: 0.3, scaleY: 0.4, scaleZ: ZONE_DEPTH }},
      { component: MeshFilter, data: { assetHandle: geo.CUBE } },
      { component: MeshRenderer, data: { materials: [mat.riverBank] } },
      { component: Star, data: { speed: SCROLL_SPEED } },
    );
  }

  // Glowing water ripple orbs (spheres floating in the river gap — represent water reflections)
  for (let i = 0; i < 10; i++) {
    const rx = riverX + (Math.random() - 0.5) * riverWidth * 0.7;
    const rz = startZ + Math.random() * ZONE_DEPTH;
    const s = 0.1 + Math.random() * 0.15;
    world.spawn(
      { component: Transform, data: { posX: rx, posY: BASE_Y + 0.5, posZ: rz, scaleX: s * 3, scaleY: s, scaleZ: s * 2 }},
      { component: MeshFilter, data: { assetHandle: geo.sphereTiny } },
      { component: MeshRenderer, data: { materials: [mat.waterGlow] } },
      { component: Star, data: { speed: SCROLL_SPEED + 0.5 } },
    );
  }

  // Bridges (thick box, definitely volumetric)
  const bridgeCount = 1 + Math.floor(Math.random() * 2);
  for (let i = 0; i < bridgeCount; i++) {
    const bz = startZ + (i + 1) * ZONE_DEPTH / (bridgeCount + 1);
    // Bridge deck (thick)
    world.spawn(
      { component: Transform, data: { posX: riverX, posY: BASE_Y - 0.6, posZ: bz, scaleX: riverWidth + 2, scaleY: 0.3, scaleZ: 1.0 }},
      { component: MeshFilter, data: { assetHandle: geo.CUBE } },
      { component: MeshRenderer, data: { materials: [mat.bridge] } },
      { component: Star, data: { speed: SCROLL_SPEED } },
    );
    // Bridge pillars
    for (const px of [-riverWidth / 3, 0, riverWidth / 3]) {
      world.spawn(
        { component: Transform, data: { posX: riverX + px, posY: BASE_Y - 0.15, posZ: bz, scaleX: 0.2, scaleY: 0.6, scaleZ: 0.2 }},
        { component: MeshFilter, data: { assetHandle: geo.cylinder } },
        { component: MeshRenderer, data: { materials: [mat.bridge] } },
        { component: Star, data: { speed: SCROLL_SPEED } },
      );
    }
    // Bridge lamps (spheres)
    for (const lx of [-riverWidth / 2 - 0.5, riverWidth / 2 + 0.5]) {
      world.spawn(
        { component: Transform, data: { posX: riverX + lx, posY: BASE_Y - 0.9, posZ: bz, scaleX: 0.08, scaleY: 0.08, scaleZ: 0.08 }},
        { component: MeshFilter, data: { assetHandle: geo.sphereTiny } },
        { component: MeshRenderer, data: { materials: [mat.waterGlow] } },
        { component: Star, data: { speed: SCROLL_SPEED } },
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  PARK ZONE — Trees, holo-billboards, fountain (all volumetric)
// ═══════════════════════════════════════════════════════════════════════════
function spawnParkZone(world: World, geo: Geo, mat: Mat, startZ: number) {
  // Trees (clusters of trunk cylinders + canopy spheres)
  for (let i = 0; i < 16; i++) {
    const tx = (Math.random() - 0.5) * ARENA_W * 2;
    const tz = startZ + Math.random() * ZONE_DEPTH;
    const treeH = 0.4 + Math.random() * 0.6;
    // Trunk (cylinder with visible thickness)
    world.spawn(
      { component: Transform, data: { posX: tx, posY: BASE_Y - treeH / 2, posZ: tz, scaleX: 0.1, scaleY: treeH, scaleZ: 0.1 }},
      { component: MeshFilter, data: { assetHandle: geo.cylinder } },
      { component: MeshRenderer, data: { materials: [mat.treeTrunk] } },
      { component: Star, data: { speed: SCROLL_SPEED } },
    );
    // Canopy (sphere)
    const canopy = 0.35 + Math.random() * 0.45;
    world.spawn(
      { component: Transform, data: { posX: tx, posY: BASE_Y - treeH - canopy * 0.4, posZ: tz, scaleX: canopy, scaleY: canopy * 0.6, scaleZ: canopy }},
      { component: MeshFilter, data: { assetHandle: geo.sphereSm } },
      { component: MeshRenderer, data: { materials: [mat.tree] } },
      { component: Star, data: { speed: SCROLL_SPEED } },
    );
  }

  // Holographic billboards (thick panels, not flush)
  for (let i = 0; i < 3; i++) {
    const hx = (Math.random() - 0.5) * ARENA_W * 1.6;
    const hz = startZ + Math.random() * ZONE_DEPTH;
    // Billboard panel (thick enough to not z-fight)
    world.spawn(
      { component: Transform, data: { posX: hx, posY: BASE_Y - 1.5, posZ: hz, scaleX: 1.2, scaleY: 0.1, scaleZ: 0.7 }},
      { component: MeshFilter, data: { assetHandle: geo.CUBE } },
      { component: MeshRenderer, data: { materials: [mat.holoBillboard] } },
      { component: Star, data: { speed: SCROLL_SPEED } },
    );
    // Support pole
    world.spawn(
      { component: Transform, data: { posX: hx, posY: BASE_Y - 0.7, posZ: hz, scaleX: 0.06, scaleY: 1.2, scaleZ: 0.06 }},
      { component: MeshFilter, data: { assetHandle: geo.cylinder } },
      { component: MeshRenderer, data: { materials: [mat.highwayRail] } },
      { component: Star, data: { speed: SCROLL_SPEED } },
    );
  }

  // Fountain (sphere + cylinder, fully volumetric)
  if (Math.random() < 0.6) {
    const fx = (Math.random() - 0.5) * 4;
    const fz = startZ + ZONE_DEPTH / 2;
    // Pool basin (thick cylinder)
    world.spawn(
      { component: Transform, data: { posX: fx, posY: BASE_Y - 0.15, posZ: fz, scaleX: 1.0, scaleY: 0.3, scaleZ: 1.0 }},
      { component: MeshFilter, data: { assetHandle: geo.cylinder } },
      { component: MeshRenderer, data: { materials: [mat.bridge] } },
      { component: Star, data: { speed: SCROLL_SPEED } },
    );
    // Water jet glow (cylinder)
    world.spawn(
      { component: Transform, data: { posX: fx, posY: BASE_Y - 0.7, posZ: fz, scaleX: 0.08, scaleY: 0.8, scaleZ: 0.08 }},
      { component: MeshFilter, data: { assetHandle: geo.cylinder } },
      { component: MeshRenderer, data: { materials: [mat.fountain] } },
      { component: Star, data: { speed: SCROLL_SPEED } },
    );
  }

  // Some bushes (small spheres scattered)
  for (let i = 0; i < 8; i++) {
    const bx = (Math.random() - 0.5) * ARENA_W * 1.8;
    const bz = startZ + Math.random() * ZONE_DEPTH;
    const s = 0.15 + Math.random() * 0.2;
    world.spawn(
      { component: Transform, data: { posX: bx, posY: BASE_Y - s * 0.5, posZ: bz, scaleX: s, scaleY: s * 0.6, scaleZ: s }},
      { component: MeshFilter, data: { assetHandle: geo.sphereTiny } },
      { component: MeshRenderer, data: { materials: [mat.tree] } },
      { component: Star, data: { speed: SCROLL_SPEED } },
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  HIGHWAY ZONE — Elevated highway (thick deck + pillars + side buildings)
// ═══════════════════════════════════════════════════════════════════════════
function spawnHighwayZone(world: World, geo: Geo, mat: Mat, startZ: number) {
  const laneCount = 2 + Math.floor(Math.random() * 2);
  const totalW = laneCount * 2.5;

  // Highway deck (THICK box — 0.4 height, no z-fighting possible)
  world.spawn(
    { component: Transform, data: { posX: 0, posY: BASE_Y - 1.0, posZ: startZ + ZONE_DEPTH / 2, scaleX: totalW, scaleY: 0.4, scaleZ: ZONE_DEPTH }},
    { component: MeshFilter, data: { assetHandle: geo.CUBE } },
    { component: MeshRenderer, data: { materials: [mat.highway] } },
    { component: Star, data: { speed: SCROLL_SPEED } },
  );

  // Guard rails (volumetric boxes on each side)
  for (const side of [-1, 1]) {
    world.spawn(
      { component: Transform, data: { posX: side * (totalW / 2 + 0.12), posY: BASE_Y - 1.35, posZ: startZ + ZONE_DEPTH / 2, scaleX: 0.12, scaleY: 0.3, scaleZ: ZONE_DEPTH }},
      { component: MeshFilter, data: { assetHandle: geo.CUBE } },
      { component: MeshRenderer, data: { materials: [mat.highwayRail] } },
      { component: Star, data: { speed: SCROLL_SPEED } },
    );
  }

  // Support pillars (thick cylinders)
  for (let p = 0; p < 4; p++) {
    const pz = startZ + (p + 0.5) * ZONE_DEPTH / 4;
    for (const px of [-totalW / 3, totalW / 3]) {
      world.spawn(
        { component: Transform, data: { posX: px, posY: BASE_Y - 0.4, posZ: pz, scaleX: 0.25, scaleY: 0.8, scaleZ: 0.25 }},
        { component: MeshFilter, data: { assetHandle: geo.cylinder } },
        { component: MeshRenderer, data: { materials: [mat.bridge] } },
        { component: Star, data: { speed: SCROLL_SPEED } },
      );
    }
  }

  // Traffic lights (spheres moving along highway — no flat surfaces)
  for (let i = 0; i < 10; i++) {
    const lane = Math.floor(Math.random() * laneCount);
    const tx = -totalW / 2 + lane * 2.5 + 1.25;
    const tz = startZ + Math.random() * ZONE_DEPTH;
    const isRed = Math.random() > 0.5;
    world.spawn(
      { component: Transform, data: { posX: tx, posY: BASE_Y - 1.25, posZ: tz, scaleX: 0.15, scaleY: 0.08, scaleZ: 0.25 }},
      { component: MeshFilter, data: { assetHandle: geo.sphereTiny } },
      { component: MeshRenderer, data: { materials: [isRed ? mat.trafficB : mat.trafficA] } },
      { component: Star, data: { speed: SCROLL_SPEED + 3 + Math.random() * 4 } },
    );
  }

  // Highway lamps (pole + sphere)
  for (let i = 0; i < 4; i++) {
    const lz = startZ + (i + 0.5) * ZONE_DEPTH / 4;
    const side = i % 2 === 0 ? -1 : 1;
    world.spawn(
      { component: Transform, data: { posX: side * (totalW / 2 + 0.6), posY: BASE_Y - 1.4, posZ: lz, scaleX: 0.05, scaleY: 0.8, scaleZ: 0.05 }},
      { component: MeshFilter, data: { assetHandle: geo.cylinder } },
      { component: MeshRenderer, data: { materials: [mat.highwayRail] } },
      { component: Star, data: { speed: SCROLL_SPEED } },
    );
    world.spawn(
      { component: Transform, data: { posX: side * (totalW / 2 + 0.6), posY: BASE_Y - 1.85, posZ: lz, scaleX: 0.1, scaleY: 0.1, scaleZ: 0.1 }},
      { component: MeshFilter, data: { assetHandle: geo.sphereTiny } },
      { component: MeshRenderer, data: { materials: [mat.highwayLight] } },
      { component: Star, data: { speed: SCROLL_SPEED } },
    );
  }

  // Side buildings (alongside highway)
  for (let i = 0; i < 6; i++) {
    const side = Math.random() > 0.5 ? -1 : 1;
    const bx = side * (totalW / 2 + 2 + Math.random() * 4);
    const bz = startZ + Math.random() * ZONE_DEPTH;
    const h = 0.4 + Math.random() * 1.5;
    world.spawn(
      { component: Transform, data: { posX: bx, posY: BASE_Y - h / 2, posZ: bz, scaleX: 0.7 + Math.random() * 1, scaleY: h, scaleZ: 0.5 + Math.random() * 0.8 }},
      { component: MeshFilter, data: { assetHandle: geo.CUBE } },
      { component: MeshRenderer, data: { materials: [mat.cityDark] } },
      { component: Star, data: { speed: SCROLL_SPEED } },
    );
  }
}
