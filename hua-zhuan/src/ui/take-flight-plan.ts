import { ROW_CAPACITIES } from '../core/constants';
import type { GameState, TakeAction, TileColor, PlayerState } from '../core/types';

export type FlightDestKind = 'pattern' | 'floor' | 'center';

export interface FlightDestination {
  kind: FlightDestKind;
  row: number;
  /** Pattern slot / floor slot / center array index */
  slotIndex: number;
}

export interface FactoryRestTile {
  factoryIndex: number;
  tileIndex: number;
  color: TileColor;
  centerArrayIndex: number;
}

/** First take from center while +1 is still there → +1 also goes to floor line */
export function willClaimPlusOne(state: GameState, action: TakeAction): boolean {
  return (
    action.source.kind === 'center' &&
    state.hasPlusOneInCenter &&
    state.plusOneHolder === null
  );
}

/** +1 floor slot: after tiles already on floor when it was (or will be) claimed */
export function plusOneFloorSlotIndex(player: PlayerState): number {
  if (player.plusOneOnFloor) return player.plusOneFloorSlot;
  return player.floorLine.length;
}

/** Next vacant floor slot for overflow this take */
export function nextFloorSlotBase(state: GameState, action: TakeAction): number {
  const player = state.players[state.currentPlayer]!;
  if (willClaimPlusOne(state, action) || player.plusOneOnFloor) {
    return player.floorLine.length + 1;
  }
  return player.floorLine.length;
}

/** Which tiles leave the source (indices in factory/center array) */
export function pickedSourceIndices(state: GameState, action: TakeAction): number[] {
  const tiles =
    action.source.kind === 'factory'
      ? state.factories[action.source.index]!
      : state.center;
  const out: number[] = [];
  tiles.forEach((t, i) => {
    if (t === action.color) out.push(i);
  });
  return out;
}

/** Resolve landing slot for each picked tile (pattern row overflow → floor) */
export function flightDestinations(state: GameState, action: TakeAction): FlightDestination[] {
  const player = state.players[state.currentPlayer]!;
  const row = player.patternRows[action.targetRow]!;
  const cap = ROW_CAPACITIES[action.targetRow]!;
  const indices = pickedSourceIndices(state, action);

  let nextPatternSlot = row.tiles.length;
  let nextFloorSlot = nextFloorSlotBase(state, action);
  let simRowColor = row.color;

  const dests: FlightDestination[] = [];
  for (let i = 0; i < indices.length; i++) {
    const canPattern =
      nextPatternSlot < cap && (simRowColor === null || simRowColor === action.color);
    if (canPattern) {
      dests.push({
        kind: 'pattern',
        row: action.targetRow,
        slotIndex: nextPatternSlot,
      });
      nextPatternSlot++;
      if (simRowColor === null) simRowColor = action.color;
    } else {
      dests.push({
        kind: 'floor',
        row: action.targetRow,
        slotIndex: nextFloorSlot,
      });
      nextFloorSlot++;
    }
  }
  return dests;
}

/** Non-picked tiles on a factory plate → upcoming center array slots */
export function factoryRestTiles(state: GameState, action: TakeAction): FactoryRestTile[] {
  if (action.source.kind !== 'factory') return [];
  const factory = state.factories[action.source.index]!;
  const out: FactoryRestTile[] = [];
  let centerInsert = state.center.length;
  for (let tileIndex = 0; tileIndex < factory.length; tileIndex++) {
    const color = factory[tileIndex]!;
    if (color === action.color) continue;
    out.push({
      factoryIndex: action.source.index,
      tileIndex,
      color,
      centerArrayIndex: centerInsert++,
    });
  }
  return out;
}

export interface ScreenPoint {
  cx: number;
  cy: number;
  size: number;
}

export type FlightSpriteKind = 'tile' | 'first-player';

export interface FlightLeg {
  color: TileColor;
  from: ScreenPoint;
  to: ScreenPoint;
  sprite?: FlightSpriteKind;
}

export interface FlightPlan {
  legs: FlightLeg[];
}
