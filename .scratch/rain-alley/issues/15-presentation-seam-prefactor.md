# 15 — Presentation 接缝预整

**What to build:** The Whitebox gunfight still plays in Studio Play, but cameras, sockets, HUD, and audio now sit behind one Presentation adapter in front of the Rules kernel. A later ticket can swap a skinned hero or an Authored Beat without growing the mixed bootstrap.

**Blocked by:** None — can start immediately.

**Status:** closed

**Parent:** [Vertical Slice spec](../spec.md)

- [x] Studio Play of rain-alley still boots and the existing Whitebox fight is controllable
- [x] Rules kernel tests stay green with no behaviour change
- [x] Presentation (what the player sees and hears) is reachable through one adapter, not a second AI framework

## Resolution

`main.ts` keeps gameplay ownership: the player capsule, rigid body, character
controller, combat state, movement, raycasts, and phase transitions. The single
`RainAlleyPresentation` adapter owns the whitebox body and weapon, camera, HUD,
procedural gunshot, enemy markers, hit flashes, muzzle flash, shell, tracer, sparks,
and corpse pools.

Verified with 57 Rules tests, TypeScript typecheck, and the real Studio Play host at
`/preview/?game=rain-alley`; the game booted, reset from death, and accepted pointer
lock without a console error storm.
