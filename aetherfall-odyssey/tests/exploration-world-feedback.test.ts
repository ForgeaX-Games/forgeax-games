import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  explorationLandmarkVisualState,
  landmarkPulseScale,
  packProceduralInstanceTransforms,
  PROCEDURAL_MATERIAL_IDENTITY,
  proceduralInstanceBatchAabb,
  buildRouteRibbonLayout,
  steppingStoneMesh,
  wornRouteRibbonMesh,
} from "../assets/plugins/procedural-world";
import { EXPLORATION_ROUTE_FOOTPRINTS } from "../assets/plugins/environment-layout";
import { createExplorationState } from "../assets/plugins/exploration-state";

describe("Aetherfall landmark world feedback", () => {
  it("gives dormant, ready, and attuned beacons distinct world signals", () => {
    const dormant = explorationLandmarkVisualState(createExplorationState());
    expect(dormant.stage).toBe("seeking-memories");
    expect(dormant.beaconOrbitalEnabled).toBe(false);
    expect(dormant.beaconScale[0]).toBeLessThan(0.5);

    const ready = explorationLandmarkVisualState({
      ...createExplorationState(),
      phase: "beacon-unlocked",
      activatedTempleIds: [
        "memory-temple-1",
        "memory-temple-2",
        "memory-temple-3",
      ],
    });
    expect(ready.stage).toBe("beacon-ready");
    expect(ready.beaconOrbitalEnabled).toBe(true);
    expect(ready.beaconScale[0]).toBeGreaterThan(1);

    const attuned = explorationLandmarkVisualState({
      ...createExplorationState(),
      phase: "returning",
      beaconUnlocked: true,
      beaconAttuned: true,
      activatedTempleIds: [
        "memory-temple-1",
        "memory-temple-2",
        "memory-temple-3",
      ],
    });
    expect(attuned.stage).toBe("beacon-attuned");
    expect(attuned.beaconOrbitalAnchor).toBe("beacon");
    expect(attuned.beaconScale).not.toEqual(ready.beaconScale);
    expect(attuned.beaconOrbitalRadius).not.toBe(ready.beaconOrbitalRadius);
    expect(attuned.beaconOrbitalSpeed).not.toBe(ready.beaconOrbitalSpeed);
  });

  it("projects sanctuary return as a terminal world signal without a new carrier", () => {
    const complete = explorationLandmarkVisualState({
      ...createExplorationState(),
      phase: "complete",
      beaconUnlocked: true,
      beaconAttuned: true,
      returnedToSanctuary: true,
      activatedTempleIds: [
        "memory-temple-1",
        "memory-temple-2",
        "memory-temple-3",
      ],
    });
    expect(complete).toMatchObject({
      stage: "sanctuary-returned",
      beaconOrbitalEnabled: true,
      beaconOrbitalAnchor: "sanctuary",
      sanctuarySignalEnabled: true,
    });
  });

  it("dims only completed memory cores and preserves unvisited landmarks", () => {
    const visual = explorationLandmarkVisualState({
      ...createExplorationState(),
      activatedTempleIds: ["memory-temple-2"],
    });
    expect(visual.templeOrbitalEnabled).toEqual([false, true, false]);
    expect(visual.templeScales[1]).not.toEqual(visual.templeScales[0]);
    expect(visual.templeScales[1]).not.toEqual(visual.templeScales[2]);
  });

  it("gives every objective family a non-color transform signature", () => {
    const initial = explorationLandmarkVisualState(createExplorationState());
    const ready = explorationLandmarkVisualState({
      ...createExplorationState(),
      phase: "beacon-unlocked",
      beaconUnlocked: true,
    });
    const returned = explorationLandmarkVisualState({
      ...createExplorationState(),
      phase: "complete",
      beaconUnlocked: true,
      beaconAttuned: true,
      returnedToSanctuary: true,
    });
    const signatures = initial.templeScales.map((scale, index) => [
      scale,
      initial.templeOrbitalRadii[index],
      initial.templeOrbitalSpeeds[index],
      initial.templeOrbitalStretches[index],
    ]);
    signatures.push([
      ready.beaconScale,
      ready.beaconOrbitalRadius,
      ready.beaconOrbitalSpeed,
      1.65,
    ]);
    signatures.push([
      returned.beaconScale,
      returned.beaconOrbitalRadius,
      returned.beaconOrbitalSpeed,
      returned.beaconOrbitalAnchor,
    ]);
    expect(new Set(signatures.map((signature) => JSON.stringify(signature))).size).toBe(5);
    expect(returned.sanctuarySignalEnabled).toBe(true);
  });

  it("keeps landmark pulse bounded and rejects non-finite input", () => {
    const samples = Array.from({ length: 120 }, (_, index) =>
      landmarkPulseScale(0.2, index / 30, 0.7),
    );
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0.185);
    expect(Math.max(...samples)).toBeLessThanOrEqual(0.215);
    expect(landmarkPulseScale(0.2, Number.NaN)).toBe(0);
  });

  it("packs visual-equivalent Y-rotated instance transforms", () => {
    const transforms = packProceduralInstanceTransforms([
      { pos: [3, 4, 5], scale: [2, 3, 4], yaw: Math.PI / 2 },
    ]);
    expect(transforms).toHaveLength(16);
    expect(transforms[0]).toBeCloseTo(0, 6);
    expect(transforms[2]).toBeCloseTo(-2, 6);
    expect(transforms[5]).toBe(3);
    expect(transforms[8]).toBeCloseTo(4, 6);
    expect(transforms[10]).toBeCloseTo(0, 6);
    expect([...transforms.slice(12, 16)]).toEqual([3, 4, 5, 1]);
  });

  it("expands an instanced mesh AABB across every transformed copy", () => {
    const aabb = proceduralInstanceBatchAabb(
      new Float32Array([-1, -1, -1, 1, 1, 1]),
      [
        { pos: [10, 0, 0], scale: [2, 1, 1], yaw: 0 },
        { pos: [0, 3, -5], scale: [1, 2, 3], yaw: Math.PI / 2 },
      ],
    );
    expect([...aabb]).toEqual([-3, -1, -6, 12, 5, 1]);
  });

  it("builds a worn route stone with a buried skirt and controlled top wear", () => {
    const mesh = steppingStoneMesh();
    expect(mesh.indices.length).toBeGreaterThan(120);
    expect(mesh.attributes.tangent?.length).toBe(
      ((mesh.attributes.position?.length ?? 0) / 3) * 4,
    );
    expect([...mesh.vertices, ...mesh.aabb].every(Number.isFinite)).toBe(true);
    expect(mesh.aabb[1]).toBeLessThan(-1);
    expect(mesh.aabb[4]).toBeGreaterThan(0.04);
    expect(mesh.aabb[4]).toBeLessThan(0.08);

    const pathBottomWorldY = 0.08 + mesh.aabb[1]! * 0.08;
    const pathTopWorldY = 0.08 + mesh.aabb[4]! * 0.08;
    expect(pathBottomWorldY).toBeGreaterThan(-0.02);
    expect(pathBottomWorldY).toBeLessThanOrEqual(0.005);
    expect(pathTopWorldY).toBeLessThan(0.09);
    const topYs = [...(mesh.attributes.position ?? [])].filter(
      (_, index) => index % 3 === 1 && _ > -0.2,
    );
    expect(
      new Set(topYs.map((value) => value.toFixed(3))).size,
    ).toBeGreaterThan(8);
  });

  it("builds one continuous route ribbon with buried side skirts and a stable local extent", () => {
    const mesh = wornRouteRibbonMesh();
    expect(mesh.aabb).toBeInstanceOf(Float32Array);
    const expectedAabb = [-1, -0.18, -1, 1, 0.045, 1] as const;
    expectedAabb.forEach((value, index) =>
      expect(mesh.aabb![index]).toBeCloseTo(value, 6),
    );
    expect(mesh.indices.length).toBe(156);
    expect(mesh.attributes?.position).toBeInstanceOf(Float32Array);
    expect(mesh.attributes?.normal).toBeInstanceOf(Float32Array);
    expect(mesh.attributes?.uv).toBeInstanceOf(Float32Array);
    const positions = mesh.attributes!.position as Float32Array;
    const topZ = Array.from(
      { length: positions.length / 3 },
      (_, index) => positions[index * 3 + 2]!,
    ).filter((_, index) => index < 18);
    expect(Math.min(...topZ)).toBeCloseTo(-1, 6);
    expect(Math.max(...topZ)).toBeCloseTo(1, 6);
  });

  it("clips branch ribbons against continuous junction surfaces without coplanar overlap", () => {
    const layout = buildRouteRibbonLayout(EXPLORATION_ROUTE_FOOTPRINTS);
    expect(layout.junctions).toHaveLength(2);
    expect(layout.segments.length).toBeGreaterThan(
      EXPLORATION_ROUTE_FOOTPRINTS.length,
    );
    for (const segment of layout.segments) {
      expect(
        Math.hypot(
          segment.end[0] - segment.start[0],
          segment.end[1] - segment.start[1],
        ),
      ).toBeGreaterThan(0.05);
      for (let sample = 0; sample <= 20; sample += 1) {
        const t = sample / 20;
        const point = [
          segment.start[0] + (segment.end[0] - segment.start[0]) * t,
          segment.start[1] + (segment.end[1] - segment.start[1]) * t,
        ] as const;
        for (const junction of layout.junctions) {
          expect(
            Math.hypot(
              point[0] - junction.center[0],
              point[1] - junction.center[1],
            ),
          ).toBeGreaterThanOrEqual(junction.radius - 1e-5);
        }
      }
    }
    expect(
      layout.segments.some(({ start }) => start[0] === 0 && start[1] === 2.35),
    ).toBe(true);
    expect(
      layout.segments.some(({ end }) => end[0] === 1.8 && end[1] === -15.15),
    ).toBe(true);
  });

  it("keeps material families rough, non-metallic, and color-separated", () => {
    const identities = Object.values(PROCEDURAL_MATERIAL_IDENTITY);
    expect(Object.keys(PROCEDURAL_MATERIAL_IDENTITY)).toEqual([
      "ground",
      "cliff",
      "ruin",
      "route",
    ]);
    expect(identities.map(({ roughness }) => roughness)).toEqual([
      0.84, 0.96, 0.76, 0.62,
    ]);
    expect(new Set(identities.map(({ roughness }) => roughness)).size).toBe(4);
    expect(identities.every(({ metallic }) => metallic <= 0.06)).toBe(true);
    const colorDistance = (
      a: readonly number[],
      b: readonly number[],
    ): number => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
    expect(
      colorDistance(
        PROCEDURAL_MATERIAL_IDENTITY.ground.baseColor,
        PROCEDURAL_MATERIAL_IDENTITY.route.baseColor,
      ),
    ).toBeGreaterThan(0.16);
    expect(
      colorDistance(
        PROCEDURAL_MATERIAL_IDENTITY.ruin.baseColor,
        PROCEDURAL_MATERIAL_IDENTITY.cliff.baseColor,
      ),
    ).toBeGreaterThan(0.16);
    const luminance = (color: readonly number[]): number =>
      color[0]! * 0.2126 + color[1]! * 0.7152 + color[2]! * 0.0722;
    expect(
      luminance(PROCEDURAL_MATERIAL_IDENTITY.cliff.baseColor),
    ).toBeLessThan(luminance(PROCEDURAL_MATERIAL_IDENTITY.ground.baseColor));
    expect(
      luminance(PROCEDURAL_MATERIAL_IDENTITY.route.baseColor),
    ).toBeGreaterThan(luminance(PROCEDURAL_MATERIAL_IDENTITY.ground.baseColor));
  });

  it("retires duplicate procedural art families while retaining gameplay visual authorities", () => {
    const source = readFileSync(
      new URL("../assets/plugins/procedural-world.ts", import.meta.url),
      "utf8",
    );
    for (const retired of [
      "GroundDressingInstance",
      "createGroundDressingLayout",
      "OPENING_TREE_SPECS",
      "RUIN_SUPPORT_SPECS",
      "SHRINE_ARCH_SPECS",
      "bark-trunk",
      "foliage-grass",
      "[-8.4, -2.25, -23.5]",
      "[-0.6, -2.65, -26.5]",
      "[8.5, -2.45, -24.8]",
    ]) {
      expect(source).not.toContain(retired);
    }
    expect(source).toMatch(
      /["']StonePath01["'],\s*["']StonePath02["'],\s*["']StonePath03["']/,
    );
    expect(source).toMatch(
      /["']StormBridgeDeckA["'],\s*["']StormBridgeDeckB["'],\s*["']StormBridgeDeckC["']/,
    );
    expect(source).toMatch(/queueStaticInstance\(\s*["']hero-terrace["']/);
    expect(source).toMatch(
      /queueStaticInstance\(\s*["']last-light-causeway["']/,
    );
    expect(source).toContain("const rockSpecs:");
    expect(source).toContain("const beaconCrystalEntity = spawnRenderable");
    expect(source).not.toContain("PointLight");
    expect(source).not.toContain("const lightSpecs:");
    expect(source).not.toContain("landmarkLights");
  });
});
