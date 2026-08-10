import { Update, World, type EntityHandle } from "@forgeax/engine-ecs";
import type { InputSnapshot } from "@forgeax/engine-input";
import { Transform } from "@forgeax/engine-scene";
import { describe, expect, it } from "vitest";
import {
  EXPLORATION_STATE_RESOURCE_KEY,
  explorationHeadingFromWorldPositions,
  installExplorationSystem,
} from "../assets/plugins/exploration-system";

function entityAt(world: World, x: number, y = 0, z = 0): EntityHandle {
  return world
    .spawn({ component: Transform, data: { pos: [x, y, z] } })
    .unwrap();
}

describe("Aetherfall exploration ECS bridge", () => {
  it("derives stable eight-way headings from player and objective world positions", () => {
    expect(explorationHeadingFromWorldPositions(0, 0, 0, -1)).toBe("N");
    expect(explorationHeadingFromWorldPositions(0, 0, 1, -1)).toBe("NE");
    expect(explorationHeadingFromWorldPositions(0, 0, 1, 0)).toBe("E");
    expect(explorationHeadingFromWorldPositions(0, 0, 1, 1)).toBe("SE");
    expect(explorationHeadingFromWorldPositions(0, 0, 0, 1)).toBe("S");
    expect(explorationHeadingFromWorldPositions(0, 0, -1, 1)).toBe("SW");
    expect(explorationHeadingFromWorldPositions(0, 0, -1, 0)).toBe("W");
    expect(explorationHeadingFromWorldPositions(0, 0, -1, -1)).toBe("NW");
    expect(explorationHeadingFromWorldPositions(2, 3, 2, 3)).toBe("N");

    const eastSideOfBoundary = Math.tan(Math.PI / 8);
    expect(
      explorationHeadingFromWorldPositions(0, 0, eastSideOfBoundary - 1e-6, -1),
    ).toBe("N");
    expect(
      explorationHeadingFromWorldPositions(0, 0, eastSideOfBoundary + 1e-6, -1),
    ).toBe("NE");
  });

  it("consumes only the supplied InputSnapshot action and keeps progression in a World resource", () => {
    const world = new World();
    world
      .addSystem(Update, {
        name: "input-frame-start-scan",
        queries: [],
        fn: () => {},
      })
      .unwrap();
    const player = entityAt(world, 0);
    let pressed = false;
    const handle = installExplorationSystem({
      world,
      player,
      readInput: () =>
        ({
          action: () => ({ justPressed: () => pressed }),
        }) as unknown as InputSnapshot,
      interactionAction: "interact",
      temples: {
        "memory-temple-1": { entity: entityAt(world, 0), interactionRadius: 1 },
        "memory-temple-2": {
          entity: entityAt(world, 10),
          interactionRadius: 1,
        },
        "memory-temple-3": {
          entity: entityAt(world, 20),
          interactionRadius: 1,
        },
      },
      beacon: { entity: entityAt(world, 30), interactionRadius: 1 },
      sanctuary: { entity: entityAt(world, 40), interactionRadius: 1 },
    });

    world.update(0).unwrap();
    expect(handle.snapshot().activatedTempleIds).toEqual([]);
    expect(handle.nearestObjective()).toMatchObject({
      targetId: "memory-temple-1",
      distance: 0,
    });

    pressed = true;
    world.update(0).unwrap();
    expect(handle.snapshot().activatedTempleIds).toEqual(["memory-temple-1"]);
    expect(handle.nearestObjective()).toMatchObject({
      targetId: "memory-temple-2",
      distance: 10,
    });
    expect(world.getResource(EXPLORATION_STATE_RESOURCE_KEY)).toEqual(
      handle.snapshot(),
    );

    handle.reset();
    expect(handle.snapshot().phase).toBe("exploring");
    expect(handle.lastOutcome()).toBeNull();
  });

  it("reports the nearest phase objective outside interaction range for HUD navigation", () => {
    const world = new World();
    world
      .addSystem(Update, {
        name: "input-frame-start-scan",
        queries: [],
        fn: () => {},
      })
      .unwrap();
    const player = entityAt(world, 0, 0, 0);
    const handle = installExplorationSystem({
      world,
      player,
      readInput: () =>
        ({
          action: () => ({ justPressed: () => false }),
        }) as unknown as InputSnapshot,
      temples: {
        "memory-temple-1": {
          entity: entityAt(world, 30, 0, 0),
          interactionRadius: 2,
        },
        "memory-temple-2": {
          entity: entityAt(world, 12, 0, 0),
          interactionRadius: 2,
        },
        "memory-temple-3": {
          entity: entityAt(world, 22, 0, 0),
          interactionRadius: 2,
        },
      },
      beacon: { entity: entityAt(world, 40, 0, 0), interactionRadius: 2 },
      sanctuary: { entity: entityAt(world, 50, 0, 0), interactionRadius: 2 },
    });

    expect(handle.nearestActionable()).toBeUndefined();
    expect(handle.nearestObjective()).toMatchObject({
      targetId: "memory-temple-2",
      distance: 12,
      heading: "E",
    });
  });

  it("reports locked landmark interactions without replacing the active objective", () => {
    const world = new World();
    world
      .addSystem(Update, {
        name: "input-frame-start-scan",
        queries: [],
        fn: () => {},
      })
      .unwrap();
    const player = entityAt(world, 0, 0, 0);
    const handle = installExplorationSystem({
      world,
      player,
      readInput: () =>
        ({
          action: () => ({ justPressed: () => false }),
        }) as unknown as InputSnapshot,
      temples: {
        "memory-temple-1": {
          entity: entityAt(world, 12, 0, 0),
          interactionRadius: 2,
        },
        "memory-temple-2": {
          entity: entityAt(world, 20, 0, 0),
          interactionRadius: 2,
        },
        "memory-temple-3": {
          entity: entityAt(world, 30, 0, 0),
          interactionRadius: 2,
        },
      },
      beacon: { entity: entityAt(world, 0, 0, 1), interactionRadius: 2 },
      sanctuary: { entity: entityAt(world, 0, 0, 8), interactionRadius: 2 },
    });

    expect(handle.interact().outcome).toBe("beacon-locked");
    expect(handle.nearestLocked()).toMatchObject({
      targetId: "last-light-beacon",
      distance: 1,
    });
    expect(handle.nearestObjective()).toMatchObject({
      targetId: "memory-temple-1",
      distance: 12,
      heading: "E",
    });

    world.set(player, Transform, { pos: [0, 0, 8] }).unwrap();
    expect(handle.interact().outcome).toBe("sanctuary-locked");
    expect(handle.nearestLocked()).toMatchObject({
      targetId: "sanctuary",
      distance: 0,
    });
    expect(handle.nearestObjective()).toMatchObject({
      targetId: "memory-temple-1",
      heading: "NE",
    });
  });

  it("targets the phase-actionable landmark when completed shrines overlap the beacon", () => {
    const world = new World();
    world
      .addSystem(Update, {
        name: "input-frame-start-scan",
        queries: [],
        fn: () => {},
      })
      .unwrap();
    const player = entityAt(world, 0);
    const handle = installExplorationSystem({
      world,
      player,
      readInput: () =>
        ({
          action: () => ({ justPressed: () => false }),
        }) as unknown as InputSnapshot,
      temples: {
        "memory-temple-1": { entity: entityAt(world, 0), interactionRadius: 2 },
        "memory-temple-2": { entity: entityAt(world, 0), interactionRadius: 2 },
        "memory-temple-3": { entity: entityAt(world, 0), interactionRadius: 2 },
      },
      beacon: { entity: entityAt(world, 0), interactionRadius: 2 },
      sanctuary: { entity: entityAt(world, 0), interactionRadius: 2 },
    });

    expect(handle.interact().outcome).toBe("temple-activated");
    expect(handle.interact().outcome).toBe("temple-activated");
    expect(handle.interact()).toMatchObject({
      outcome: "temple-activated",
      snapshot: { phase: "beacon-unlocked" },
    });
    expect(handle.interact()).toMatchObject({
      outcome: "beacon-attuned",
      snapshot: { phase: "returning" },
    });
    expect(handle.interact()).toMatchObject({
      outcome: "sanctuary-returned",
      snapshot: { phase: "complete" },
    });
  });

  it("measures proximity on the walkable plane for visually elevated landmarks", () => {
    const world = new World();
    world
      .addSystem(Update, {
        name: "input-frame-start-scan",
        queries: [],
        fn: () => {},
      })
      .unwrap();
    const player = entityAt(world, 0, 0.7, 0);
    const handle = installExplorationSystem({
      world,
      player,
      readInput: () =>
        ({
          action: () => ({ justPressed: () => false }),
        }) as unknown as InputSnapshot,
      temples: {
        "memory-temple-1": {
          entity: entityAt(world, 0, 5, 0),
          interactionRadius: 2,
        },
        "memory-temple-2": {
          entity: entityAt(world, 0, 5, 0),
          interactionRadius: 2,
        },
        "memory-temple-3": {
          entity: entityAt(world, 0, 5, 0),
          interactionRadius: 2,
        },
      },
      beacon: { entity: entityAt(world, 0, 12, 0), interactionRadius: 2 },
      sanctuary: { entity: entityAt(world, 0, 8, 0), interactionRadius: 2 },
    });

    expect(handle.interact().outcome).toBe("temple-activated");
    expect(handle.interact().outcome).toBe("temple-activated");
    expect(handle.interact().outcome).toBe("temple-activated");
    expect(handle.interact().outcome).toBe("beacon-attuned");
    expect(handle.interact().outcome).toBe("sanctuary-returned");
  });
});
