// Boss antechamber layout — pure, engine-free placement of the PR1 kit.
//
// Bake (`scripts/bake-antechamber.ts`) writes LOCAL coords (room centre = origin).
// Runtime (`dungeon.ts`) parents the pack at DUNGEON_ORIGIN + bossAt so Studio
// Play reaches the quality room on the den vertical-slice path.

import type { ProbeBlocker } from './camera-probe';

/** Scene-asset GUID of assets/scenes/boss-antechamber.pack.json — fixed identity. */
export const ANTECHAMBER_SCENE_GUID = 'a3c8e1f0-6b2d-4f79-9e15-8d4c0a7b2f61';

/** Kit grid language (metres) — matches assets/kit README. */
export const ANTECHAMBER_TILE = 2;

export type KitModuleId =
  | 'kit-floor'
  | 'kit-wall'
  | 'kit-corner'
  | 'kit-doorframe'
  | 'kit-pillar'
  | 'kit-trim'
  | 'kit-rubble';

/** Den-prop accents (N4 #17B) — camp scatter assets, dungeon-ified by scale. */
export type DenPropId = 'den-log' | 'den-boulder' | 'den-fence';

export type AntechamberPiece = {
  readonly moduleId: KitModuleId | DenPropId;
  /** Entity Name — Doorframe* prefixes feed fade/probe registry. */
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Y rotation radians. */
  readonly rotY: number;
  readonly sx: number;
  readonly sy: number;
  readonly sz: number;
};

export type AntechamberPlacement = {
  readonly widthM: number;
  readonly depthM: number;
  /** Vector from room centre toward the approach (entry) — door faces this way. */
  readonly doorTowardX: number;
  readonly doorTowardZ: number;
};

export type AntechamberLayout = {
  readonly tilesX: number;
  readonly tilesZ: number;
  readonly pieces: readonly AntechamberPiece[];
  readonly lightSeats: ReadonlyArray<{ x: number; y: number; z: number }>;
  readonly probeBlockers: readonly ProbeBlocker[];
};

/** Yaw so the doorframe opening faces the approach target (entry). */
export function doorYawToward(
  fromX: number,
  fromZ: number,
  toX: number,
  toZ: number,
): number {
  const dx = toX - fromX;
  const dz = toZ - fromZ;
  // Engine Y-up: yaw 0 → local +Z; negate X so east target → −π/2.
  // Normalize −π → +π so south is stable across signed-zero atan2 quirks.
  const yaw = Math.atan2(-dx, dz);
  return yaw <= -Math.PI + 1e-12 ? Math.PI : yaw;
}

function snapTiles(metres: number): number {
  return Math.max(4, Math.round(metres / ANTECHAMBER_TILE));
}

function quatAxisWall(
  side: 'n' | 's' | 'e' | 'w',
): number {
  // Wall mesh long axis = local X; face outward.
  if (side === 'n') return 0;
  if (side === 's') return Math.PI;
  if (side === 'e') return -Math.PI / 2;
  return Math.PI / 2;
}

/**
 * Build a rectangular antechamber from kit modules.
 * Origin = room centre on the walk plane (y=0). Door on the wall facing approach.
 */
export function buildAntechamberLayout(p: AntechamberPlacement): AntechamberLayout {
  const tilesX = snapTiles(p.widthM);
  const tilesZ = snapTiles(p.depthM);
  const halfX = (tilesX * ANTECHAMBER_TILE) / 2;
  const halfZ = (tilesZ * ANTECHAMBER_TILE) / 2;
  const pieces: AntechamberPiece[] = [];
  let n = 0;
  const push = (
    moduleId: KitModuleId | DenPropId,
    name: string,
    x: number,
    y: number,
    z: number,
    rotY: number,
    scale: readonly [number, number, number] = [1, 1, 1],
  ): void => {
    pieces.push({
      moduleId,
      name,
      x: +x.toFixed(4),
      y: +y.toFixed(4),
      z: +z.toFixed(4),
      rotY,
      sx: scale[0],
      sy: scale[1],
      sz: scale[2],
    });
  };

  // Floors — 2×2 slabs, top at y=0 (mesh minY = -0.12).
  for (let iz = 0; iz < tilesZ; iz++) {
    for (let ix = 0; ix < tilesX; ix++) {
      const x = -halfX + ANTECHAMBER_TILE * (ix + 0.5);
      const z = -halfZ + ANTECHAMBER_TILE * (iz + 0.5);
      push('kit-floor', `Antechamber_floor_${++n}`, x, 0, z, 0);
    }
  }

  // Which wall gets the door — dominant approach axis.
  const adx = Math.abs(p.doorTowardX);
  const adz = Math.abs(p.doorTowardZ);
  const doorSide: 'n' | 's' | 'e' | 'w' = adx > adz
    ? (p.doorTowardX >= 0 ? 'e' : 'w')
    : (p.doorTowardZ >= 0 ? 'n' : 's');

  const wallY = 0;
  const placeWallRun = (
    side: 'n' | 's' | 'e' | 'w',
    count: number,
    skipMid: boolean,
  ): void => {
    for (let i = 0; i < count; i++) {
      const isMid = i === Math.floor(count / 2);
      if (skipMid && isMid) continue;
      let x = 0;
      let z = 0;
      if (side === 'n' || side === 's') {
        x = -halfX + ANTECHAMBER_TILE * (i + 0.5);
        z = side === 'n' ? halfZ - 0.175 : -halfZ + 0.175;
      } else {
        z = -halfZ + ANTECHAMBER_TILE * (i + 0.5);
        x = side === 'e' ? halfX - 0.175 : -halfX + 0.175;
      }
      push('kit-wall', `Antechamber_wall_${side}_${++n}`, x, wallY, z, quatAxisWall(side));
      // Cornice trim on top of wall run
      push(
        'kit-trim',
        `Antechamber_trim_${side}_${n}`,
        x,
        3.05,
        z + (side === 'n' ? -0.05 : side === 's' ? 0.05 : 0),
        quatAxisWall(side),
      );
    }
  };

  placeWallRun('n', tilesX, doorSide === 'n');
  placeWallRun('s', tilesX, doorSide === 's');
  placeWallRun('e', tilesZ, doorSide === 'e');
  placeWallRun('w', tilesZ, doorSide === 'w');

  // Corners
  const corners: Array<readonly [number, number, number]> = [
    [-halfX + 0.4, halfZ - 0.4, Math.PI / 2],
    [halfX - 0.4, halfZ - 0.4, 0],
    [halfX - 0.4, -halfZ + 0.4, -Math.PI / 2],
    [-halfX + 0.4, -halfZ + 0.4, Math.PI],
  ];
  for (const [x, z, rot] of corners) {
    push('kit-corner', `Antechamber_corner_${++n}`, x, wallY, z, rot);
  }

  // Doorframe on the approach wall (opening toward entry).
  let doorX = 0;
  let doorZ = 0;
  if (doorSide === 'n') { doorZ = halfZ - 0.14; }
  else if (doorSide === 's') { doorZ = -halfZ + 0.14; }
  else if (doorSide === 'e') { doorX = halfX - 0.14; }
  else { doorX = -halfX + 0.14; }
  const doorYaw = doorYawToward(0, 0, p.doorTowardX, p.doorTowardZ);
  push('kit-doorframe', 'Doorframe1', doorX, wallY, doorZ, doorYaw);

  // Pillars inset from corners
  const inset = 1.6;
  for (const [x, z] of [
    [-halfX + inset, -halfZ + inset],
    [halfX - inset, -halfZ + inset],
    [-halfX + inset, halfZ - inset],
    [halfX - inset, halfZ - inset],
  ] as const) {
    push('kit-pillar', `Antechamber_pillar_${++n}`, x, wallY, z, 0);
  }

  // ── N4 #17B: two-layer decor (owner Play contract 2026-08-04) ────────────
  // Layer 1 wall band: 14–18 pieces hugging the outer walls (every piece
  // within 1.2 m of a wall). Layer 2 second ring: 12–16 pieces inside the
  // combat ring (3.5 ≤ r ≤ 7.0 m) as 4 uneven low clusters of 3–4 — the layer
  // the fight camera actually sees (wall-only placement played as "no change").
  // Hard clearances: centre disc r<2.8 and the 3.6 m doorway channel hold ZERO
  // decor; fence stays in the wall band (never crosses the battlefield).
  // Pillar/corner-block footprints are avoided with the REAL mesh extents
  // (kit-pillar half-width 0.65 m, kit-corner solid block reaches half−1.4
  // inward — the literal corner is un-placeable). Fully deterministic (no rng).
  const wallInset = 0.8;   // piece centre → outer wall distance
  // band end = pillar centre (half−1.6) + pillar half (0.65) + decor half (0.75)
  const bandEnd = Math.min(halfX, halfZ) - 3.0;
  const propCycle: Array<KitModuleId | DenPropId> = [
    'kit-rubble', 'kit-rubble', 'den-log', 'kit-rubble', 'den-boulder',
    'kit-rubble', 'den-fence', 'kit-rubble',
  ];
  const denPropScale: Record<DenPropId, number> = {
    'den-log': 0.5,      // top = 0.657·s = 0.33 m ≤ 0.50 (wood discipline)
    'den-boulder': 0.3,  // top = 1.764·s = 0.53 m ≤ 0.55 (stone discipline)
    'den-fence': 0.4,    // top = 1.2·s = 0.48 m
  };
  const wallSlots = (n: number): number[] => {
    if (n <= 1) return [0];
    const out: number[] = [];
    for (let k = 0; k < n; k++) out.push(-bandEnd + (2 * bandEnd * k) / (n - 1));
    return out;
  };
  const placeBand = (side: 'n' | 's' | 'e' | 'w', isDoorSide: boolean): void => {
    const alongX = side === 'n' || side === 's';
    const wallCoord = side === 'n' || side === 's'
      ? (side === 'n' ? halfZ - wallInset : -halfZ + wallInset)
      : (side === 'e' ? halfX - wallInset : -halfX + wallInset);
    const slots = wallSlots(Math.min(4, Math.max(3, Math.round(bandEnd / 2))));
    for (const coord of slots) {
      if (isDoorSide && Math.abs(coord) <= 1.8) continue; // doorway channel stays clear
      const x = alongX ? coord : wallCoord;
      const z = alongX ? wallCoord : coord;
      const alongWall = alongX ? 0 : Math.PI / 2;
      const mod = propCycle[decorSlot++ % propCycle.length];
      if (mod === 'kit-rubble') {
        push('kit-rubble', `Antechamber_rubble_${++n}`, x, 0, z, alongWall + 0.35, [0.7, 0.7, 0.7]);
      } else {
        const s = denPropScale[mod as DenPropId];
        push(mod, `Antechamber_${mod}_${++n}`, x, 0, z, alongWall, [s, s, s]);
      }
    }
  };
  let decorSlot = 0;
  placeBand('n', doorSide === 'n');
  placeBand('s', doorSide === 's');
  placeBand('e', doorSide === 'e');
  placeBand('w', doorSide === 'w');

  // Layer 2 — second ring. Cluster bearings are door-relative (|phi| ≥ 100°
  // off the doorway axis → the 3.6 m channel is untouched). Offsets are
  // absolute (not rotated per door side), so radii must hold the ring band
  // under ANY door bearing: max offset magnitude is 0.9434 m, hence every
  // rho stays inside [3.5 + 0.9434, 7.0 − 0.9434] ≈ [4.44, 6.06] and each
  // piece keeps 3.5 ≤ r ≤ 7.0 m for n/e/s/w alike. rubble/log/boulder only.
  const doorBearing = doorSide === 'n' ? 0
    : doorSide === 'e' ? Math.PI / 2
    : doorSide === 's' ? Math.PI
    : -Math.PI / 2;
  // Ring needs half ≥ ~8.75 m (rho 6.06 + offset 0.95 + decor half 0.75 + wall);
  // smaller rooms keep the wall band only.
  if (Math.min(halfX, halfZ) >= 9) {
    const clusters: ReadonlyArray<{ phi: number; rho: number; size: number }> = [
      { phi: 1.9, rho: 4.55, size: 4 },
      { phi: -1.75, rho: 5.8, size: 3 },
      { phi: 3.05, rho: 5.95, size: 4 },
      { phi: -2.55, rho: 5.1, size: 3 },
    ];
    const ringOffsets: ReadonlyArray<readonly [number, number]> = [
      [0, 0], [0.85, 0.35], [-0.5, 0.8], [-0.75, -0.55],
    ];
    const ringCycle: Array<KitModuleId | DenPropId> = [
      'kit-rubble', 'den-boulder', 'kit-rubble', 'den-log',
    ];
    let ringIdx = 0;
    clusters.forEach((c, ci) => {
      const theta = doorBearing + c.phi;
      const cx = c.rho * Math.sin(theta);
      const cz = c.rho * Math.cos(theta);
      for (let k = 0; k < c.size; k++) {
        const [ox, oz] = ringOffsets[k]!;
        const x = cx + ox;
        const z = cz + oz;
        const mod = ringCycle[ringIdx % ringCycle.length];
        // Golden-angle yaw spread — deterministic variety, no rng.
        const rotY = (ringIdx * 2.399963) % (Math.PI * 2);
        if (mod === 'kit-rubble') {
          push('kit-rubble', `Antechamber_ringC${ci}_rubble_${++n}`, x, 0, z, rotY, [0.7, 0.7, 0.7]);
        } else {
          const s = denPropScale[mod as DenPropId];
          push(mod, `Antechamber_ringC${ci}_${mod}_${++n}`, x, 0, z, rotY, [s, s, s]);
        }
        ringIdx++;
      }
    });
  }

  // Light seats (runtime PointLight pool) — factor glow, no emissive textures.
  const lightSeats = [
    { x: -halfX + 2.2, y: 2.1, z: -halfZ + 2.2 },
    { x: halfX - 2.2, y: 2.1, z: halfZ - 2.2 },
    { x: -halfX + 2.2, y: 2.1, z: halfZ - 2.2 },
    { x: halfX - 2.2, y: 2.1, z: -halfZ + 2.2 },
  ];

  // Probe + fade: doorframe + major occluders that can sit between camera and
  // player (walls / corners / pillars). Labels match piece Names so the fade
  // registry can bind pack entities. Floor / trim / rubble stay visual-only.
  const probeBlockers: ProbeBlocker[] = [];
  for (const piece of pieces) {
    const fp = occluderFootprint(piece.moduleId, piece.x, piece.z, piece.rotY);
    if (!fp) continue;
    probeBlockers.push({
      type: 'aabb',
      label: piece.name,
      min: fp.min,
      max: fp.max,
      probeHeight: fp.height,
      probePad: 0.15,
    });
  }

  return { tilesX, tilesZ, pieces, lightSeats, probeBlockers };
}

/** Authored kit footprints (metres) for probe/fade AABBs — see assets/kit README. */
function occluderFootprint(
  moduleId: KitModuleId | DenPropId,
  x: number,
  z: number,
  rotY: number,
): { min: [number, number]; max: [number, number]; height: number } | null {
  let halfX: number;
  let halfZ: number;
  let height: number;
  switch (moduleId) {
    case 'kit-wall':
      // 2×3.2×0.35 — long axis local X.
      halfX = 1.0;
      halfZ = 0.175;
      height = 3.2;
      break;
    case 'kit-corner':
      halfX = 0.55;
      halfZ = 0.55;
      height = 3.2;
      break;
    case 'kit-doorframe':
      // Opening ~2.2 m wide; thicken slightly for probe.
      halfX = 1.2;
      halfZ = 0.35;
      height = 3.2;
      break;
    case 'kit-pillar':
      halfX = 0.28;
      halfZ = 0.28;
      height = 3.4;
      break;
    default:
      return null;
  }
  // Yaw near ±π/2 swaps XZ extents (wall long-axis follows local X).
  if (Math.abs(Math.cos(rotY)) < 0.5) {
    const t = halfX;
    halfX = halfZ;
    halfZ = t;
  }
  return {
    min: [+(x - halfX).toFixed(4), +(z - halfZ).toFixed(4)],
    max: [+(x + halfX).toFixed(4), +(z + halfZ).toFixed(4)],
    height,
  };
}
