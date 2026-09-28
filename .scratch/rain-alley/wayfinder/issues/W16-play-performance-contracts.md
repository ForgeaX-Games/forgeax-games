---
id: W16
title: Studio与游戏包里现有的性能验收合同是什么
labels: [wayfinder:research]
status: closed
parent: W00
blocked_by: []
assignee: research-subagent
---

# Studio与游戏包里现有的性能验收合同是什么

## Parent

[从白盒到如龙式雨夜切片](../MAP.md)

## Question

What fps, bundle-size, gate, and Play-smoke contracts exist for games in this Studio pin? How did FPS Gym or Hellforge declare them? What does Rain Alley’s `package.json` currently disable? Facts for later acceptance-gate grilling — do not write the gates yet.

## Blocked by

None - can start immediately

## Resolution

Closed. Game `forgeax.metrics` is an Engine five-kind opt-out declaration, not a Studio FPS gate: Hellforge, FPS Gym, Rain Alley, and all `templates/game-*` disable bundle-size/fps/bench/gate/spike-report. Studio CI Play smoke checks console errors on `game-default` and does not require GPU frames or FPS. Rain Alley currently disables all five (`gate` reason: Studio Play owns runtime acceptance) with only `bun test` as automation.

Research: [W16 play performance contracts](../research/W16-play-performance-contracts.md).
