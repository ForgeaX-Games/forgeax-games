---
id: W11
title: 白盒代码哪些留下哪些扔掉
labels: [wayfinder:grilling]
status: closed
parent: W00
blocked_by: [W07, W10]
assignee: null
---

# 白盒代码哪些留下哪些扔掉

## Parent

[从白盒到如龙式雨夜切片](../MAP.md)

## Question

After geography and the skinned-hero prototype: which of the current Whitebox stays (Rules kernel, Game Clock, KCC, shotgun numbers, object pools, pointer-lock intent) and which Presentation is deleted (cube bodies, cube gun, procedural corridor, DOM HUD as product, LOS-unwired combat loop, private kinematic teleport)? Draw the Presentation seam; do not design a generic AI framework.

## Blocked by

- [一条街是否取代巷厨厅三段地理](./W07-one-street-vs-three-segments.md)
- [一个蒙皮主角加武器插座在Play里能不能站住](./W10-skinned-hero-weapon-socket-prototype.md)

## Resolution

The prototype held, so the intent stands as written.

**Keep** — Rules kernel (`src/rules.ts`) with its 49 tests, Game Clock,
CharacterController movement, shotgun numbers and reload timing, object pools,
and the pointer-lock *intent*.

**Replace** — cube hero and cube gun as the product look (they survive only as
Stand-ins behind the seam), the procedural alley/kitchen/hall corridor, the DOM
HUD as product chrome, and the private `setKinematicPosition` teleport wherever
a public API exists.

**Fix rather than keep** — combat currently passes `lineOfSight: true`, so the
built `sightBlockers` are dead and enemies shoot through walls; the slice must
wire real line of sight. Pointer lock must actually be requested at runtime the
way `fps/main.ts` does with `safeRequestLock`, not merely declared in
`forge.json`.

One Presentation adapter seam between the Rules kernel and the engine: the
skinned hero, Weapon Socket, Authored Beats, and Wet Look all live on the
Presentation side. No generic AI framework.
