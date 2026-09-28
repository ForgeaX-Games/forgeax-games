---
id: W15
title: Play与性能验收门写到什么程度
labels: [wayfinder:grilling]
status: closed
parent: W00
blocked_by: [W16, W10]
assignee: null
---

# Play与性能验收门写到什么程度

## Parent

[从白盒到如龙式雨夜切片](../MAP.md)

## Question

Given [Studio与游戏包里现有的性能验收合同是什么](./W16-play-performance-contracts.md): `forgeax.metrics` is an Engine opt-out declaration, not a Studio FPS gate. Hellforge, FPS, Rain Alley, and game templates all disable the five kinds. Studio CI Play smoke only checks console errors on `game-default` — no GPU frame or FPS requirement. Rain Alley’s `gate` reason already says Studio Play owns acceptance, but every metric is still off; automation is `bun test` only.

After [一个蒙皮主角加武器插座在Play里能不能站住](./W10-skinned-hero-weapon-socket-prototype.md): which Play path is the hard door (embedded `:18920` vs standalone), which human-visible checks count, and do we invent a slice-owned smoke (not Engine fps metrics) rather than flipping flags that nobody else uses? Also decide where cinematic beats are accepted — same Play host as combat.

## Blocked by

- [Studio与游戏包里现有的性能验收合同是什么](./W16-play-performance-contracts.md)
- [一个蒙皮主角加武器插座在Play里能不能站住](./W10-skinned-hero-weapon-socket-prototype.md)

## Resolution

The hard door is real Studio Play, and the W10 probe showed what that costs: the
game must first be adopted through `POST /api/projects/link` and made active
through `PUT /api/projects/active`, after which it runs in the engine Play host
at `/preview/?game=<slug>`. Combat and Authored Beats are accepted in that same
host — there is no separate cinematic runner.

Acceptance is human-visible, not a metric threshold:

- start overlay appears and pointer lock engages on click;
- the hero renders skinned with the weapon in hand, never a T-pose or an
  untextured mesh;
- one full gunfight beat is fair — enemies cannot shoot through the blockers;
- the three Authored Beats cut and return to the Gameplay Camera;
- the console carries no error storm.

Do not flip the Engine `fps` / `gate` / `bench` metric flags: every game in the
tree disables them and Studio's Play smoke only checks console errors on
`game-default`. Slice-owned automation stays `bun test` on the Rules kernel,
plus this Play checklist run by a human.
