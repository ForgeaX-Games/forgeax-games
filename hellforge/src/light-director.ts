/**
 * Hellforge lighting director — pure seat / ambient helpers (PR2c T2–T3).
 *
 * URP caps: 4 PointLight + 4 SpotLight. Re-seat on area change; never raise caps.
 * Spot L5 budget (locked §4): 2 den fixtures + 1 camp moon (T3) + 1 combat (PR2a G1).
 */

export type Vec3 = { x: number; y: number; z: number };

export type AreaKind = 'den' | 'camp' | 'wild';

/** §4 L5 spot-slot accounting — den fixtures + camp moon seated; combat reserved. */
export const SPOT_SLOT_BUDGET = {
  denFixtures: 2,
  campMoon: 1,
  combatReserved: 1,
  total: 4,
} as const;

/** Park unused point/spot casters below the floor (range ≪ burial → no contribution). */
export const PARKED_LIGHT_POS: readonly [number, number, number] = [0, -60, 0];

/** Max distance (m) for den fixture re-seat around the player. */
export const DEN_FIXTURE_SEAT_RADIUS_M = 26;

/**
 * Pekla-grade den ambient floor (near-black). T2 locked — T3 must not re-darken.
 * Effective intensity ≈ these × F10 `ambientMul` (default 0.42).
 */
export const DEN_AMBIENT = {
  ibl: { color: [0.42, 0.20, 0.12] as [number, number, number], intensity: 0.012 },
  solid: { color: [0.32, 0.14, 0.08] as [number, number, number], intensity: 0.022 },
} as const;

/**
 * Camp dusk ambient (L2: legible dusk, not night). Cooler/dimmer than pre-T3
 * outdoor table; campfire + moon spot carry local read.
 */
export const CAMP_AMBIENT = {
  ibl: { color: [0.52, 0.28, 0.22] as [number, number, number], intensity: 0.034 },
  solid: { color: [0.45, 0.24, 0.16] as [number, number, number], intensity: 0.095 },
} as const;

/**
 * Wilderness outdoor ambient — sun kept; IBL lifted vs camp dusk for open-ground
 * readability (still below pre-T3 camp 0.055 IBL wash).
 */
export const WILD_AMBIENT = {
  ibl: { color: [0.60, 0.34, 0.22] as [number, number, number], intensity: 0.050 },
  solid: { color: [0.50, 0.28, 0.18] as [number, number, number], intensity: 0.125 },
} as const;

/**
 * Area exposure scale on F10 base (`RENDER_SETTINGS_DEFAULTS.exposure` = 0.42).
 * Den stays 1.0 (no re-darken); wild lifts outdoor midtones; camp slight dusk lift.
 */
export const AREA_EXPOSURE_MUL: Record<AreaKind, number> = {
  den: 1.0,
  camp: 1.05,
  wild: 1.18,
};

/** Den fixture SpotLight look — warm downward pools; castShadow false (no public caster pass). */
export const DEN_FIXTURE_SPOT = {
  color: [1.0, 0.48, 0.16] as [number, number, number],
  intensity: 16,
  range: 12,
  innerConeDeg: 28,
  outerConeDeg: 48,
  direction: [0, -1, 0] as [number, number, number],
  castShadow: false as const,
};

/**
 * Camp moon / key SpotLight (L5 slot 3). Direction matches blood-moon sun travel
 * (`bake-sky.ts` BLOOD_MOON_SUN_DIR / `SUN_LOOK.camp.direction`). Unshadowed —
 * same custom-pipeline barrel gap as den fixtures.
 */
export const CAMP_MOON_LIGHT_DIR = [-0.3853, -0.4258, -0.8187] as const;

export const CAMP_MOON_SPOT = {
  color: [1.0, 0.32, 0.18] as [number, number, number],
  intensity: 11,
  range: 32,
  innerConeDeg: 20,
  outerConeDeg: 38,
  direction: [-0.3853, -0.4258, -0.8187] as [number, number, number],
  castShadow: false as const,
  /** Meters from camp origin toward the celestial moon (opposite light travel). */
  altitudeM: 16,
} as const;

/** Campfire point base intensity when seated at camp (dusk pool). */
export const CAMP_CAMPFIRE_BASE = 14;
/** Gate torch point bases outdoors (camp + wild). */
export const CAMP_TORCH_BASE = 9.5;

export type AmbientTint = {
  color: [number, number, number];
  intensity: number;
};

export function ambientForArea(area: AreaKind, iblReady: boolean): AmbientTint {
  if (area === 'den') {
    return iblReady ? { ...DEN_AMBIENT.ibl } : { ...DEN_AMBIENT.solid };
  }
  if (area === 'wild') {
    return iblReady ? { ...WILD_AMBIENT.ibl } : { ...WILD_AMBIENT.solid };
  }
  return iblReady ? { ...CAMP_AMBIENT.ibl } : { ...CAMP_AMBIENT.solid };
}

export function exposureMulForArea(area: AreaKind): number {
  return AREA_EXPOSURE_MUL[area];
}

/**
 * Pure area → light seating plan (PR2c T5 / closes T3 Important).
 *
 * Mirrors `applyAreaLighting` in `main.ts`: which spot slots live vs park,
 * how point fixtures are placed, and the exposure mul. Quality room / boss
 * antechamber share the den runtime tag — no separate ambient bypass.
 */
export type AreaLightSeatingPlan = {
  denSpots: 'seat-nearest' | 'park';
  campMoon: 'seat' | 'park';
  pointFixtures: 'den-nearest' | 'outdoor-fixed';
  exposureMul: number;
  /** Deterministic after apply: moon is either seated (1) or parked (0). */
  expectCampMoonLive: 0 | 1;
  /**
   * Max den fixture spots that may be live after apply.
   * Outdoor areas always 0; den is 0..SPOT_SLOT_BUDGET.denFixtures by proximity.
   */
  expectDenSpotsMax: number;
};

export function areaLightSeating(area: AreaKind): AreaLightSeatingPlan {
  if (area === 'den') {
    return {
      denSpots: 'seat-nearest',
      campMoon: 'park',
      pointFixtures: 'den-nearest',
      exposureMul: AREA_EXPOSURE_MUL.den,
      expectCampMoonLive: 0,
      expectDenSpotsMax: SPOT_SLOT_BUDGET.denFixtures,
    };
  }
  if (area === 'camp') {
    return {
      denSpots: 'park',
      campMoon: 'seat',
      pointFixtures: 'outdoor-fixed',
      exposureMul: AREA_EXPOSURE_MUL.camp,
      expectCampMoonLive: 1,
      expectDenSpotsMax: 0,
    };
  }
  return {
    denSpots: 'park',
    campMoon: 'park',
    pointFixtures: 'outdoor-fixed',
    exposureMul: AREA_EXPOSURE_MUL.wild,
    expectCampMoonLive: 0,
    expectDenSpotsMax: 0,
  };
}

/**
 * Place the moon spot emitter toward the celestial moon (= opposite light travel)
 * so the cone washes the camp origin along `CAMP_MOON_SPOT.direction`.
 */
export function campMoonSpotPosition(
  origin: Readonly<{ x: number; y: number; z: number }> = { x: 0, y: 0, z: 0 },
): readonly [number, number, number] {
  const d = CAMP_MOON_LIGHT_DIR;
  const alt = CAMP_MOON_SPOT.altitudeM;
  return [
    origin.x - d[0] * alt,
    origin.y - d[1] * alt,
    origin.z - d[2] * alt,
  ];
}

/**
 * Pick up to `count` nearest fire fixtures within `maxDist` of the player.
 * Unused slots are omitted (caller parks them).
 */
export function pickNearestFireSeats(
  firePoints: readonly Vec3[],
  player: Readonly<{ x: number; z: number }>,
  count: number,
  maxDist: number = DEN_FIXTURE_SEAT_RADIUS_M,
): Vec3[] {
  if (count <= 0) return [];
  return firePoints
    .map((p) => ({ p, d: Math.hypot(p.x - player.x, p.z - player.z) }))
    .filter((e) => e.d < maxDist)
    .sort((a, b) => a.d - b.d)
    .slice(0, count)
    .map((e) => e.p);
}

/**
 * Map N light slots → seats or park. Index i gets `near[i]` or PARKED.
 */
export function seatOrPark(
  near: readonly Vec3[],
  slotCount: number,
): Array<readonly [number, number, number]> {
  const out: Array<readonly [number, number, number]> = [];
  for (let i = 0; i < slotCount; i++) {
    const seat = near[i];
    out.push(seat ? [seat.x, seat.y, seat.z] : PARKED_LIGHT_POS);
  }
  return out;
}

/**
 * Den point-slot choreography: 3 fixture pools (campfire + 2 torches) + player
 * fill kept separate. Spots use the same nearest-N pick with count=2.
 */
export function denPointSeatPositions(
  firePoints: readonly Vec3[],
  player: Readonly<{ x: number; z: number }>,
): Array<readonly [number, number, number]> {
  return seatOrPark(pickNearestFireSeats(firePoints, player, 3), 3);
}

export function denSpotSeatPositions(
  firePoints: readonly Vec3[],
  player: Readonly<{ x: number; z: number }>,
): Array<readonly [number, number, number]> {
  return seatOrPark(
    pickNearestFireSeats(firePoints, player, SPOT_SLOT_BUDGET.denFixtures),
    SPOT_SLOT_BUDGET.denFixtures,
  );
}
