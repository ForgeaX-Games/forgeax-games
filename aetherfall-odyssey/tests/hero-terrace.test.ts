import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  heroTerraceMesh,
  heroTerraceTopContains,
  islandMesh,
  lastLightCausewayMesh,
  lastLightCausewayTopContains,
} from "../assets/plugins/procedural-world";
import {
  EXPLORATION_INTERACTION_APRONS,
  EXPLORATION_ROUTE_FOOTPRINTS,
  LAST_LIGHT_CAUSEWAY,
  LAST_LIGHT_TERRACE,
  LAST_LIGHT_TERRACE_COLLIDER,
} from "../assets/plugins/environment-layout";

describe("Last Light hero terrace", () => {
  it("keeps stable route and interaction footprints in the environment layout contract", () => {
    const lastRoute = EXPLORATION_ROUTE_FOOTPRINTS.at(-1)!;
    expect(lastRoute).toEqual({
      start: [-0.2, -8.15],
      end: [1.8, -15.15],
      halfWidth: 1.28,
    });
    expect(EXPLORATION_INTERACTION_APRONS).toEqual([
      { position: [0, 3.1], radius: 2.15 },
      { position: [-6.2, -4.9], radius: 1.8 },
      { position: [6.05, -6.3], radius: 1.8 },
      { position: [-2.65, -11.2], radius: 1.72 },
      { position: [1.8, -16.4], radius: 4.95 },
    ]);
    expect(
      Math.abs(lastRoute.end[0] - LAST_LIGHT_TERRACE.position[0]),
    ).toBeLessThan(LAST_LIGHT_TERRACE.radiusX);
    expect(
      Math.abs(lastRoute.end[1] - LAST_LIGHT_TERRACE.position[2]),
    ).toBeLessThan(LAST_LIGHT_TERRACE.radiusZ);
  });

  it("backs every collider corner with visible terrace top geometry", () => {
    const [halfX, halfY, halfZ] = LAST_LIGHT_TERRACE_COLLIDER.halfExtents;
    for (const x of [-halfX, halfX]) {
      for (const z of [-halfZ, halfZ]) {
        expect(heroTerraceTopContains(x, z)).toBe(true);
      }
    }
    expect(LAST_LIGHT_TERRACE_COLLIDER.position).toEqual([1.8, -halfY, -16.8]);
    expect(LAST_LIGHT_TERRACE_COLLIDER.halfExtents).toBe(
      LAST_LIGHT_TERRACE.colliderHalfExtents,
    );
    expect(LAST_LIGHT_TERRACE_COLLIDER.yaw).toBe(0);
    expect(heroTerraceTopContains(5.21, 0)).toBe(false);
    expect(heroTerraceTopContains(0, 3.26)).toBe(false);
  });

  it("backs the continuous causeway collider and visibly overlaps both land masses", () => {
    const [halfX, , halfZ] = LAST_LIGHT_CAUSEWAY.halfExtents;
    for (const x of [-halfX, halfX]) {
      for (const z of [-halfZ, halfZ]) {
        expect(lastLightCausewayTopContains(x, z)).toBe(true);
      }
    }
    const causeway = lastLightCausewayMesh();
    const island = islandMesh();
    const terrace = heroTerraceMesh();
    const causewayMinZ = LAST_LIGHT_CAUSEWAY.position[2] + causeway.aabb![2]!;
    const causewayMaxZ = LAST_LIGHT_CAUSEWAY.position[2] + causeway.aabb![5]!;
    const islandSouthZ = island.aabb![2]!;
    const terraceNorthZ =
      LAST_LIGHT_TERRACE_COLLIDER.position[2] + terrace.aabb![5]!;
    expect(causewayMaxZ).toBeGreaterThan(islandSouthZ);
    expect(causewayMinZ).toBeLessThan(terraceNorthZ);
    expect(causeway.aabb![1]).toBeLessThan(-0.6);
    expect(causeway.aabb![4]).toBe(0);
  });

  it("is a finite, tapered, indexed mesh that reaches below its flat walkable top", () => {
    const mesh = heroTerraceMesh();
    const aabb = Array.from(mesh.aabb ?? []);
    expect(aabb).toHaveLength(6);
    expect(aabb.every(Number.isFinite)).toBe(true);
    expect(aabb[0]).toBeLessThanOrEqual(-5.2);
    expect(aabb[2]).toBeLessThanOrEqual(-3.25);
    expect(aabb[3]).toBeGreaterThanOrEqual(5.2);
    expect(aabb[5]).toBeGreaterThanOrEqual(3.25);
    expect(aabb[1]).toBeLessThan(-2.1);
    expect(aabb[4]).toBe(0);
    expect(mesh.indices.length).toBeGreaterThan(0);
    expect(mesh.vertices.every(Number.isFinite)).toBe(true);
  });

  it("keeps the terrace and causeway authorities while retiring duplicate perimeter supports", () => {
    const source = readFileSync(
      new URL("../assets/plugins/procedural-world.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("LAST_LIGHT_PERIMETER_SUPPORTS");
    expect(source).not.toMatch(/queueStaticInstance\(\s*["']ruin-column["']/);
    expect(source).toMatch(/queueStaticInstance\(\s*["']hero-terrace["']/);
    expect(source).toMatch(/["']last-light-causeway["']/);
    expect(source).toContain("LAST_LIGHT_TERRACE_COLLIDER.position");
    expect(source).toContain("LAST_LIGHT_TERRACE_COLLIDER.halfExtents");
  });
});
