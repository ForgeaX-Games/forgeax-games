// PR4a T3 — Boss beat once-fire / climax-consume policy.

import { describe, expect, test } from 'bun:test';
import {
  takeBossDefeatTrigger,
  takeBossEntranceTrigger,
} from './cinematic-triggers';

describe('takeBossEntranceTrigger', () => {
  test('first idle opportunity → play + latch', () => {
    expect(
      takeBossEntranceTrigger({ alreadyPlayed: false, finisherClimaxBusy: false }),
    ).toEqual({ played: true, shouldPlay: true });
  });

  test('climax busy → latch without play (no strand after CU queue)', () => {
    expect(
      takeBossEntranceTrigger({ alreadyPlayed: false, finisherClimaxBusy: true }),
    ).toEqual({ played: true, shouldPlay: false });
  });

  test('already latched → noop', () => {
    expect(
      takeBossEntranceTrigger({ alreadyPlayed: true, finisherClimaxBusy: false }),
    ).toEqual({ played: true, shouldPlay: false });
    expect(
      takeBossEntranceTrigger({ alreadyPlayed: true, finisherClimaxBusy: true }),
    ).toEqual({ played: true, shouldPlay: false });
  });
});

describe('takeBossDefeatTrigger', () => {
  test('death while idle → play + latch', () => {
    expect(
      takeBossDefeatTrigger({ alreadyPlayed: false, finisherClimaxBusy: false }),
    ).toEqual({ played: true, shouldPlay: true });
  });

  test('death during Hero Shot / face CU → latch without play', () => {
    expect(
      takeBossDefeatTrigger({ alreadyPlayed: false, finisherClimaxBusy: true }),
    ).toEqual({ played: true, shouldPlay: false });
  });

  test('second death opportunity → noop', () => {
    expect(
      takeBossDefeatTrigger({ alreadyPlayed: true, finisherClimaxBusy: false }),
    ).toEqual({ played: true, shouldPlay: false });
  });
});
