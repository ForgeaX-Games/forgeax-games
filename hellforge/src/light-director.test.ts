import { describe, expect, test } from 'bun:test';
import {
  AREA_EXPOSURE_MUL,
  CAMP_AMBIENT,
  CAMP_MOON_LIGHT_DIR,
  CAMP_MOON_SPOT,
  DEN_AMBIENT,
  DEN_FIXTURE_SEAT_RADIUS_M,
  DEN_FIXTURE_SPOT,
  PARKED_LIGHT_POS,
  SPOT_SLOT_BUDGET,
  WILD_AMBIENT,
  ambientForArea,
  areaLightSeating,
  campMoonSpotPosition,
  denPointSeatPositions,
  denSpotSeatPositions,
  exposureMulForArea,
  pickNearestFireSeats,
  seatOrPark,
  type AreaKind,
} from './light-director';

describe('SPOT_SLOT_BUDGET (PR2c §4 L5)', () => {
  test('2 den + 1 camp moon + 1 combat reserved = 4', () => {
    expect(SPOT_SLOT_BUDGET.denFixtures).toBe(2);
    expect(SPOT_SLOT_BUDGET.campMoon).toBe(1);
    expect(SPOT_SLOT_BUDGET.combatReserved).toBe(1);
    expect(
      SPOT_SLOT_BUDGET.denFixtures +
        SPOT_SLOT_BUDGET.campMoon +
        SPOT_SLOT_BUDGET.combatReserved,
    ).toBe(SPOT_SLOT_BUDGET.total);
    expect(SPOT_SLOT_BUDGET.total).toBe(4);
  });
});

describe('den ambient darkness floor (PR2c T2 / L2)', () => {
  test('den IBL intensity is near-black and below camp dusk', () => {
    expect(DEN_AMBIENT.ibl.intensity).toBeLessThan(0.02);
    expect(DEN_AMBIENT.ibl.intensity).toBeLessThan(CAMP_AMBIENT.ibl.intensity);
    expect(DEN_AMBIENT.solid.intensity).toBeLessThan(CAMP_AMBIENT.solid.intensity);
  });

  test('ambientForArea picks den vs camp vs wild tables', () => {
    expect(ambientForArea('den', true).intensity).toBe(DEN_AMBIENT.ibl.intensity);
    expect(ambientForArea('den', false).intensity).toBe(DEN_AMBIENT.solid.intensity);
    expect(ambientForArea('camp', true).intensity).toBe(CAMP_AMBIENT.ibl.intensity);
    expect(ambientForArea('camp', false).intensity).toBe(CAMP_AMBIENT.solid.intensity);
    expect(ambientForArea('wild', true).intensity).toBe(WILD_AMBIENT.ibl.intensity);
    expect(ambientForArea('wild', false).intensity).toBe(WILD_AMBIENT.solid.intensity);
  });
});

describe('camp dusk + wild outdoor (PR2c T3 / L2)', () => {
  test('camp IBL is dusk-legible: below wild, well above den night floor', () => {
    expect(CAMP_AMBIENT.ibl.intensity).toBeGreaterThan(DEN_AMBIENT.ibl.intensity * 2);
    expect(CAMP_AMBIENT.ibl.intensity).toBeLessThan(WILD_AMBIENT.ibl.intensity);
    // Not night: dusk floor stays readable (≥0.03 IBL pre-mul).
    expect(CAMP_AMBIENT.ibl.intensity).toBeGreaterThanOrEqual(0.03);
    expect(CAMP_AMBIENT.ibl.intensity).toBeLessThan(0.05);
  });

  test('wild IBL lifts outdoor readability without returning to wash', () => {
    expect(WILD_AMBIENT.ibl.intensity).toBeGreaterThan(CAMP_AMBIENT.ibl.intensity);
    expect(WILD_AMBIENT.ibl.intensity).toBeLessThanOrEqual(0.055);
  });

  test('exposure mul: den unchanged, wild > camp > den baseline', () => {
    expect(exposureMulForArea('den')).toBe(1.0);
    expect(AREA_EXPOSURE_MUL.den).toBe(1.0);
    expect(exposureMulForArea('wild')).toBeGreaterThan(exposureMulForArea('camp'));
    expect(exposureMulForArea('camp')).toBeGreaterThan(exposureMulForArea('den'));
  });
});

describe('DEN_FIXTURE_SPOT (unshadowed pools)', () => {
  test('castShadow is false — custom pipeline omits spot shadow pass', () => {
    expect(DEN_FIXTURE_SPOT.castShadow).toBe(false);
    expect(DEN_FIXTURE_SPOT.outerConeDeg).toBeGreaterThan(DEN_FIXTURE_SPOT.innerConeDeg);
    expect(DEN_FIXTURE_SPOT.outerConeDeg).toBeLessThanOrEqual(90);
  });
});

describe('CAMP_MOON_SPOT (L5 slot 3, unshadowed)', () => {
  test('castShadow false + cone bounds + direction matches blood-moon sun travel', () => {
    expect(CAMP_MOON_SPOT.castShadow).toBe(false);
    expect(CAMP_MOON_SPOT.outerConeDeg).toBeGreaterThan(CAMP_MOON_SPOT.innerConeDeg);
    expect(CAMP_MOON_SPOT.outerConeDeg).toBeLessThanOrEqual(90);
    expect(CAMP_MOON_SPOT.direction).toEqual([...CAMP_MOON_LIGHT_DIR]);
  });

  test('campMoonSpotPosition sits toward the moon (opposite light travel)', () => {
    const pos = campMoonSpotPosition({ x: 0, y: 0, z: 0 });
    expect(pos[0]).toBeCloseTo(-CAMP_MOON_LIGHT_DIR[0] * CAMP_MOON_SPOT.altitudeM, 4);
    expect(pos[1]).toBeCloseTo(-CAMP_MOON_LIGHT_DIR[1] * CAMP_MOON_SPOT.altitudeM, 4);
    expect(pos[2]).toBeCloseTo(-CAMP_MOON_LIGHT_DIR[2] * CAMP_MOON_SPOT.altitudeM, 4);
    // Emitter is above the camp floor.
    expect(pos[1]).toBeGreaterThan(4);
  });
});

describe('areaLightSeating transition table (PR2c T5 / T3 Important)', () => {
  const AREAS: AreaKind[] = ['camp', 'den', 'wild'];

  test('camp / den / wild live vs park + exposure mul (no cross-leak)', () => {
    const table = Object.fromEntries(AREAS.map((a) => [a, areaLightSeating(a)])) as Record<
      AreaKind,
      ReturnType<typeof areaLightSeating>
    >;

    expect(table.den).toEqual({
      denSpots: 'seat-nearest',
      campMoon: 'park',
      pointFixtures: 'den-nearest',
      exposureMul: 1.0,
      expectCampMoonLive: 0,
      expectDenSpotsMax: 2,
    });
    expect(table.camp).toEqual({
      denSpots: 'park',
      campMoon: 'seat',
      pointFixtures: 'outdoor-fixed',
      exposureMul: 1.05,
      expectCampMoonLive: 1,
      expectDenSpotsMax: 0,
    });
    expect(table.wild).toEqual({
      denSpots: 'park',
      campMoon: 'park',
      pointFixtures: 'outdoor-fixed',
      exposureMul: 1.18,
      expectCampMoonLive: 0,
      expectDenSpotsMax: 0,
    });

    // Moon only in camp — den/wild must not leave it live.
    expect(table.camp.expectCampMoonLive).toBe(1);
    expect(table.den.expectCampMoonLive).toBe(0);
    expect(table.wild.expectCampMoonLive).toBe(0);

    // Den spots only seat in den; outdoor parks both.
    expect(table.den.denSpots).toBe('seat-nearest');
    expect(table.camp.denSpots).toBe('park');
    expect(table.wild.denSpots).toBe('park');
    expect(table.camp.expectDenSpotsMax).toBe(0);
    expect(table.wild.expectDenSpotsMax).toBe(0);

    // Exposure mul matches AREA_EXPOSURE_MUL (single SSOT).
    for (const a of AREAS) {
      expect(table[a].exposureMul).toBe(exposureMulForArea(a));
      expect(table[a].exposureMul).toBe(AREA_EXPOSURE_MUL[a]);
    }
  });

  test('quality-room / boss share den seating (no ambient bypass)', () => {
    // Antechamber + boss are den runtimeTag — same plan as den.
    const den = areaLightSeating('den');
    expect(den.pointFixtures).toBe('den-nearest');
    expect(den.campMoon).toBe('park');
    expect(den.exposureMul).toBe(1.0);
    expect(ambientForArea('den', true).intensity).toBe(DEN_AMBIENT.ibl.intensity);
  });
});

describe('pickNearestFireSeats / seatOrPark', () => {
  const fixtures = [
    { x: 300, y: 2, z: 300 },
    { x: 305, y: 2.2, z: 301 },
    { x: 310, y: 2, z: 300 },
    { x: 400, y: 2, z: 400 }, // far — outside radius from (300,300)
  ];

  test('orders by distance and respects count + radius', () => {
    const near = pickNearestFireSeats(fixtures, { x: 300, z: 300 }, 2, DEN_FIXTURE_SEAT_RADIUS_M);
    expect(near).toHaveLength(2);
    expect(near[0]).toEqual(fixtures[0]);
    expect(near[1]).toEqual(fixtures[1]);
  });

  test('seatOrPark parks unused slots below floor', () => {
    const seats = seatOrPark([{ x: 1, y: 2, z: 3 }], 2);
    expect(seats[0]).toEqual([1, 2, 3]);
    expect(seats[1]).toEqual(PARKED_LIGHT_POS);
  });

  test('denPointSeatPositions seats up to 3 fixture pools', () => {
    const seats = denPointSeatPositions(fixtures, { x: 300, z: 300 });
    expect(seats).toHaveLength(3);
    expect(seats[0]).toEqual([300, 2, 300]);
    expect(seats[1]).toEqual([305, 2.2, 301]);
    expect(seats[2]).toEqual([310, 2, 300]);
  });

  test('denSpotSeatPositions seats exactly L5 den fixture count', () => {
    const seats = denSpotSeatPositions(fixtures, { x: 300, z: 300 });
    expect(seats).toHaveLength(SPOT_SLOT_BUDGET.denFixtures);
    expect(seats[0]).toEqual([300, 2, 300]);
    expect(seats[1]).toEqual([305, 2.2, 301]);
  });

  test('empty / far fixtures park all slots', () => {
    const seats = denSpotSeatPositions([{ x: 0, y: 1, z: 0 }], { x: 300, z: 300 });
    expect(seats.every((p) => p[1] === PARKED_LIGHT_POS[1])).toBe(true);
  });
});
