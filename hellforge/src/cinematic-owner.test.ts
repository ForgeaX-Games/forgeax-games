// PR4a T1 — CinematicOwner acquire/release core.

import { describe, expect, test } from 'bun:test';
import {
  CinematicOwner,
  type CinematicChannel,
  type WorldPolicy,
} from './cinematic-owner';

const IDLE_POLICY: WorldPolicy = {
  freezeAi: false,
  playerInvulnerable: false,
  playerInputLocked: false,
};

function spyChannels(order: CinematicChannel[]) {
  const events: string[] = [];
  const make = (name: CinematicChannel) => ({
    acquire: () => {
      events.push(`acquire:${name}`);
      order.push(name);
    },
    release: () => {
      events.push(`release:${name}`);
    },
  });
  return {
    events,
    channels: {
      input: make('input'),
      camera: make('camera'),
      ui: make('ui'),
      world: make('world'),
      audio: make('audio'),
    },
  };
}

describe('CinematicOwner', () => {
  test('acquire/release happy path sets active, beatId, policy', () => {
    const owner = new CinematicOwner();
    expect(owner.active).toBe(false);
    expect(owner.beatId).toBe(null);
    expect(owner.policy).toBe(null);

    const policy: WorldPolicy = {
      freezeAi: true,
      playerInvulnerable: true,
      playerInputLocked: true,
    };
    owner.acquire({
      beatId: 'boss-entrance',
      policy,
      channels: {},
    });

    expect(owner.active).toBe(true);
    expect(owner.beatId).toBe('boss-entrance');
    expect(owner.policy).toEqual(policy);

    expect(owner.release()).toBe(true);
    expect(owner.active).toBe(false);
    expect(owner.beatId).toBe(null);
    expect(owner.policy).toBe(null);
  });

  test('release is idempotent — four calls yield one effect', () => {
    const owner = new CinematicOwner();
    let releases = 0;
    owner.acquire({
      beatId: 'camp-intro',
      policy: IDLE_POLICY,
      channels: {
        ui: {
          acquire: () => {},
          release: () => {
            releases += 1;
          },
        },
      },
    });

    expect(owner.release()).toBe(true);
    expect(owner.release()).toBe(false);
    expect(owner.release()).toBe(false);
    expect(owner.release()).toBe(false);
    expect(releases).toBe(1);
  });

  test('double-acquire while active throws', () => {
    const owner = new CinematicOwner();
    owner.acquire({
      beatId: 'quest-accept',
      policy: IDLE_POLICY,
      channels: {},
    });

    expect(() =>
      owner.acquire({
        beatId: 'boss-defeat',
        policy: IDLE_POLICY,
        channels: {},
      }),
    ).toThrow(/already active/);

    expect(owner.beatId).toBe('quest-accept');
    expect(owner.release()).toBe(true);

    // After release, acquire is allowed again.
    owner.acquire({
      beatId: 'boss-defeat',
      policy: IDLE_POLICY,
      channels: {},
    });
    expect(owner.beatId).toBe('boss-defeat');
    expect(owner.release()).toBe(true);
  });

  test('release channel order is reverse of acquire', () => {
    const owner = new CinematicOwner();
    const acquiredOrder: CinematicChannel[] = [];
    const { events, channels } = spyChannels(acquiredOrder);

    owner.acquire({
      beatId: 'order-check',
      policy: IDLE_POLICY,
      channels,
    });

    expect(events).toEqual([
      'acquire:input',
      'acquire:camera',
      'acquire:ui',
      'acquire:world',
      'acquire:audio',
    ]);
    expect(acquiredOrder).toEqual(['input', 'camera', 'ui', 'world', 'audio']);

    owner.release();
    expect(events.slice(5)).toEqual([
      'release:audio',
      'release:world',
      'release:ui',
      'release:camera',
      'release:input',
    ]);
  });

  test('omitted channels are skipped in both directions', () => {
    const owner = new CinematicOwner();
    const events: string[] = [];
    owner.acquire({
      beatId: 'partial',
      policy: IDLE_POLICY,
      channels: {
        input: {
          acquire: () => events.push('acquire:input'),
          release: () => events.push('release:input'),
        },
        world: {
          acquire: () => events.push('acquire:world'),
          release: () => events.push('release:world'),
        },
      },
    });
    expect(events).toEqual(['acquire:input', 'acquire:world']);
    owner.release();
    expect(events).toEqual([
      'acquire:input',
      'acquire:world',
      'release:world',
      'release:input',
    ]);
  });

  test('mid-acquire throw unwinds already-acquired channels in reverse and stays inactive', () => {
    const owner = new CinematicOwner();
    const events: string[] = [];
    const boom = new Error('camera acquire failed');

    expect(() =>
      owner.acquire({
        beatId: 'fail-mid',
        policy: IDLE_POLICY,
        channels: {
          input: {
            acquire: () => events.push('acquire:input'),
            release: () => events.push('release:input'),
          },
          camera: {
            acquire: () => {
              events.push('acquire:camera');
              throw boom;
            },
            release: () => events.push('release:camera'),
          },
          ui: {
            acquire: () => events.push('acquire:ui'),
            release: () => events.push('release:ui'),
          },
        },
      }),
    ).toThrow(boom);

    expect(owner.active).toBe(false);
    expect(owner.beatId).toBe(null);
    expect(owner.policy).toBe(null);
    // Failing channel is claimed before acquire → reverse-unwind includes it
    // (release must be idempotent even if acquire threw mid-side-effect).
    expect(events).toEqual([
      'acquire:input',
      'acquire:camera',
      'release:camera',
      'release:input',
    ]);
    // Failed acquire must not count as an active release, and a fresh acquire works.
    expect(owner.release()).toBe(false);
    owner.acquire({
      beatId: 'after-fail',
      policy: IDLE_POLICY,
      channels: {},
    });
    expect(owner.beatId).toBe('after-fail');
    expect(owner.release()).toBe(true);
  });

  test('audio duck-then-throw on acquire still unducks (no duck leak)', () => {
    const owner = new CinematicOwner();
    let ducked = false;
    const boom = new Error('audio acquire failed after duck');

    expect(() =>
      owner.acquire({
        beatId: 'duck-leak',
        policy: IDLE_POLICY,
        channels: {
          world: {
            acquire: () => {},
            release: () => {},
          },
          audio: {
            acquire: () => {
              ducked = true;
              throw boom;
            },
            release: () => {
              ducked = false;
            },
          },
        },
      }),
    ).toThrow(boom);

    expect(owner.active).toBe(false);
    expect(ducked).toBe(false);
    expect(owner.release()).toBe(false);
  });

  test('policy getter is a snapshot — caller mutation after acquire is ignored', () => {
    const owner = new CinematicOwner();
    const policy: WorldPolicy = {
      freezeAi: true,
      playerInvulnerable: false,
      playerInputLocked: true,
    };
    owner.acquire({
      beatId: 'policy-snap',
      policy,
      channels: {},
    });
    policy.freezeAi = false;
    policy.playerInvulnerable = true;
    expect(owner.policy).toEqual({
      freezeAi: true,
      playerInvulnerable: false,
      playerInputLocked: true,
    });
    owner.release();
  });

  test('release does not observe channel map mutations after acquire', () => {
    const owner = new CinematicOwner();
    const events: string[] = [];
    const channels = {
      input: {
        acquire: () => events.push('acquire:input'),
        release: () => events.push('release:input'),
      },
      world: {
        acquire: () => events.push('acquire:world'),
        release: () => events.push('release:world'),
      },
    };
    owner.acquire({
      beatId: 'channel-snap',
      policy: IDLE_POLICY,
      channels,
    });
    // Mutate the caller's map after ownership committed.
    delete (channels as { world?: unknown }).world;
    (channels as { audio?: typeof channels.input }).audio = {
      acquire: () => events.push('acquire:audio'),
      release: () => events.push('release:audio'),
    };
    owner.release();
    expect(events).toEqual([
      'acquire:input',
      'acquire:world',
      'release:world',
      'release:input',
    ]);
  });
});
