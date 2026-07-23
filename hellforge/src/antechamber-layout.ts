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

export type AntechamberPiece = {
  readonly moduleId: KitModuleId;
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
    moduleId: KitModuleId,
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

  // Sparse rubble
  for (const [x, z, rot] of [
    [-2.2, -1.4, 0.4],
    [2.5, 1.8, -0.9],
    [0.8, -2.6, 1.2],
    [-1.5, 2.3, 0.2],
  ] as const) {
    if (Math.abs(x) < halfX - 1 && Math.abs(z) < halfZ - 1) {
      push('kit-rubble', `Antechamber_rubble_${++n}`, x, 0, z, rot);
    }
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
  moduleId: KitModuleId,
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
