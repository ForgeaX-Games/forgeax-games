import { Update, type EntityHandle, type World } from "@forgeax/engine-ecs";
import type { InputSnapshot } from "@forgeax/engine-input";
import { Transform } from "@forgeax/engine-scene";
import {
  MEMORY_TEMPLE_IDS,
  createExplorationState,
  interactWithExploration,
  resetExplorationState,
  snapshotExplorationState,
  type ExplorationOutcome,
  type ExplorationSnapshot,
  type ExplorationTargetId,
  type ExplorationTransition,
  type MemoryTempleId,
} from "./exploration-state";

export const EXPLORATION_STATE_RESOURCE_KEY = "aetherfallExplorationState";
export const DEFAULT_EXPLORATION_INTERACT_ACTION = "interact";
export const EXPLORATION_HEADINGS = [
  "N",
  "NE",
  "E",
  "SE",
  "S",
  "SW",
  "W",
  "NW",
] as const;

export type ExplorationHeading = (typeof EXPLORATION_HEADINGS)[number];

/** Convert a player-to-objective world-space vector into the nearest compass octant. */
export function explorationHeadingFromWorldPositions(
  playerX: number,
  playerZ: number,
  targetX: number,
  targetZ: number,
): ExplorationHeading {
  const deltaX = targetX - playerX;
  const deltaZ = targetZ - playerZ;
  if (
    ![deltaX, deltaZ].every(Number.isFinite) ||
    (deltaX === 0 && deltaZ === 0)
  )
    return "N";
  const clockwiseFromNorth = Math.atan2(deltaX, -deltaZ);
  const octant = Math.round(clockwiseFromNorth / (Math.PI / 4));
  return EXPLORATION_HEADINGS[
    (octant + EXPLORATION_HEADINGS.length) % EXPLORATION_HEADINGS.length
  ]!;
}

export interface ExplorationAnchor {
  readonly entity: EntityHandle;
  readonly interactionRadius: number;
}

export interface ExplorationSystemContext {
  readonly world: World;
  readonly player: EntityHandle;
  readonly readInput: () => InputSnapshot;
  readonly temples: Readonly<Record<MemoryTempleId, ExplorationAnchor>>;
  readonly beacon: ExplorationAnchor;
  readonly sanctuary: ExplorationAnchor;
  /** Must name an action supplied by the existing game InputSnapshot map. */
  readonly interactionAction?: string;
}

export interface ExplorationSystemHandle {
  snapshot(): ExplorationSnapshot;
  reset(): ExplorationSnapshot;
  interact(): ExplorationTransition;
  lastOutcome(): ExplorationOutcome | null;
  nearestActionable():
    | { readonly targetId: ExplorationTargetId; readonly distance: number }
    | undefined;
  nearestLocked():
    | { readonly targetId: ExplorationTargetId; readonly distance: number }
    | undefined;
  nearestObjective():
    | {
        readonly targetId: ExplorationTargetId;
        readonly distance: number;
        readonly heading: ExplorationHeading;
      }
    | undefined;
}

/** Cache key for world-space landmark feedback; HUD-only distance is excluded. */
export function explorationWorldFeedbackSignature(
  snapshot: ExplorationSnapshot,
): string {
  return JSON.stringify({
    phase: snapshot.phase,
    activatedTempleIds: snapshot.activatedTempleIds,
  });
}

interface Candidate {
  readonly targetId: ExplorationTargetId;
  readonly anchor: ExplorationAnchor;
}

function distanceBetween(
  world: World,
  player: EntityHandle,
  target: EntityHandle,
): number | undefined {
  const playerTransform = world.get(player, Transform);
  const targetTransform = world.get(target, Transform);
  if (!playerTransform.ok || !targetTransform.ok) return undefined;
  const [px, , pz] = playerTransform.value.pos;
  const [tx, , tz] = targetTransform.value.pos;
  // Landmarks use their visual centre as the authored Transform. Tall shrines
  // and the beacon must therefore measure player reach on the walkable plane,
  // rather than making an elevated mesh origin impossible to interact with.
  const distance = Math.hypot(px - tx, pz - tz);
  return Number.isFinite(distance) ? distance : undefined;
}

function closestCandidate(
  world: World,
  player: EntityHandle,
  candidates: readonly Candidate[],
  requireInteractionRange = true,
):
  | {
      readonly candidate: Candidate;
      readonly distance: number;
      readonly heading: ExplorationHeading;
    }
  | undefined {
  let nearest:
    | { candidate: Candidate; distance: number; heading: ExplorationHeading }
    | undefined;
  for (const candidate of candidates) {
    const distance = distanceBetween(world, player, candidate.anchor.entity);
    if (distance === undefined) continue;
    if (
      requireInteractionRange &&
      distance > candidate.anchor.interactionRadius
    )
      continue;
    if (nearest === undefined || distance < nearest.distance) {
      const playerTransform = world.get(player, Transform);
      const targetTransform = world.get(candidate.anchor.entity, Transform);
      if (!playerTransform.ok || !targetTransform.ok) continue;
      nearest = {
        candidate,
        distance,
        heading: explorationHeadingFromWorldPositions(
          playerTransform.value.pos[0] ?? 0,
          playerTransform.value.pos[2] ?? 0,
          targetTransform.value.pos[0] ?? 0,
          targetTransform.value.pos[2] ?? 0,
        ),
      };
    }
  }
  return nearest;
}

/**
 * Install the exploration loop into the existing Play World. Wiring owns
 * choosing the scene entities and the InputSnapshot reader; this module owns
 * only the progression resource and its one Update system.
 */
export function installExplorationSystem(
  ctx: ExplorationSystemContext,
): ExplorationSystemHandle {
  ctx.world.insertResource(
    EXPLORATION_STATE_RESOURCE_KEY,
    createExplorationState(),
  );
  const action = ctx.interactionAction ?? DEFAULT_EXPLORATION_INTERACT_ACTION;
  let lastOutcome: ExplorationOutcome | null = null;

  const readState = (): ExplorationSnapshot =>
    ctx.world.getResource<ExplorationSnapshot>(EXPLORATION_STATE_RESOURCE_KEY);
  const writeState = (state: ExplorationSnapshot): ExplorationSnapshot => {
    ctx.world.insertResource(EXPLORATION_STATE_RESOURCE_KEY, state);
    return state;
  };
  const candidates: readonly Candidate[] = [
    ...MEMORY_TEMPLE_IDS.map((targetId) => ({
      targetId,
      anchor: ctx.temples[targetId],
    })),
    { targetId: "last-light-beacon", anchor: ctx.beacon },
    { targetId: "sanctuary", anchor: ctx.sanctuary },
  ];

  const actionableCandidates = (
    state: ExplorationSnapshot,
  ): readonly Candidate[] =>
    state.phase === "exploring"
      ? candidates.filter(
          (candidate) =>
            candidate.targetId.startsWith("memory-temple-") &&
            !state.activatedTempleIds.includes(
              candidate.targetId as MemoryTempleId,
            ),
        )
      : state.phase === "beacon-unlocked"
        ? candidates.filter(
            (candidate) => candidate.targetId === "last-light-beacon",
          )
        : state.phase === "returning"
          ? candidates.filter((candidate) => candidate.targetId === "sanctuary")
          : [];
  const lockedCandidates = (state: ExplorationSnapshot): readonly Candidate[] =>
    candidates.filter(
      (candidate) =>
        (candidate.targetId === "last-light-beacon" && !state.beaconUnlocked) ||
        (candidate.targetId === "sanctuary" && !state.beaconAttuned),
    );

  const nearestActionable = ():
    | { readonly targetId: ExplorationTargetId; readonly distance: number }
    | undefined => {
    const nearest = closestCandidate(
      ctx.world,
      ctx.player,
      actionableCandidates(readState()),
    );
    return nearest === undefined
      ? undefined
      : { targetId: nearest.candidate.targetId, distance: nearest.distance };
  };
  const nearestLocked = ():
    | { readonly targetId: ExplorationTargetId; readonly distance: number }
    | undefined => {
    const nearest = closestCandidate(
      ctx.world,
      ctx.player,
      lockedCandidates(readState()),
    );
    return nearest === undefined
      ? undefined
      : { targetId: nearest.candidate.targetId, distance: nearest.distance };
  };
  const nearestObjective = ():
    | {
        readonly targetId: ExplorationTargetId;
        readonly distance: number;
        readonly heading: ExplorationHeading;
      }
    | undefined => {
    const nearest = closestCandidate(
      ctx.world,
      ctx.player,
      actionableCandidates(readState()),
      false,
    );
    return nearest === undefined
      ? undefined
      : {
          targetId: nearest.candidate.targetId,
          distance: nearest.distance,
          heading: nearest.heading,
        };
  };

  const interact = (): ExplorationTransition => {
    const state = readState();
    const actionable = actionableCandidates(state);
    const nearest =
      closestCandidate(ctx.world, ctx.player, actionable) ??
      closestCandidate(ctx.world, ctx.player, lockedCandidates(state));
    if (nearest === undefined) {
      const transition: ExplorationTransition = {
        accepted: false,
        outcome: "out-of-range",
        snapshot: snapshotExplorationState(state),
      };
      lastOutcome = transition.outcome;
      return transition;
    }
    const transition = interactWithExploration(state, {
      targetId: nearest.candidate.targetId,
      distance: nearest.distance,
      interactionRadius: nearest.candidate.anchor.interactionRadius,
    });
    if (transition.accepted) writeState(transition.snapshot);
    lastOutcome = transition.outcome;
    return transition;
  };

  ctx.world
    .addSystem(Update, {
      name: "aetherfall-exploration-interaction",
      queries: [],
      after: ["input-frame-start-scan", "game-player-movement"],
      before: ["propagateTransforms"],
      fn: () => {
        if (ctx.readInput().action(action).justPressed()) interact();
      },
    })
    .unwrap();

  return {
    snapshot: () => snapshotExplorationState(readState()),
    reset: () => {
      lastOutcome = null;
      return snapshotExplorationState(writeState(resetExplorationState()));
    },
    interact,
    lastOutcome: () => lastOutcome,
    nearestActionable,
    nearestLocked,
    nearestObjective,
  };
}
