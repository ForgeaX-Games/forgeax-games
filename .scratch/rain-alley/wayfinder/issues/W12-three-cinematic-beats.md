---
id: W12
title: 电影镜头语言选哪三刀
labels: [wayfinder:grilling]
status: closed
parent: W00
blocked_by: [W04, W07]
assignee: laurenceelu
---

# 电影镜头语言选哪三刀

## Parent

[从白盒到如龙式雨夜切片](../MAP.md)

## Question

Given [当前引擎能否做确定性电影机位](./W04-engine-cinematic-camera.md), one-street geography, and [调查与对话在切片里算什么](./W08-investigation-dialogue-contract.md): the slice now has four story beats (photo Investigation, Attitude Choice, gunfight, two Aftermaths). Which **three** deterministic camera beats get authored poses (likely photo look / talk / Aftermath), and which stay on the over-shoulder gameplay camera? Hard cuts via `setActiveCamera`, or a tiny in-game sampled pose like Hellforge, are in envelope. App.pause, DOM video, and an engine sequencer are not. Freeze combat with gameDelta = 0, not a global time scale. How does the gameplay camera return after each authored beat?

## Blocked by

- [当前引擎能否做确定性电影机位](./W04-engine-cinematic-camera.md)
- [一条街是否取代巷厨厅三段地理](./W07-one-street-vs-three-segments.md)

## Resolution

Three authored camera beats, hard-cut with `setActiveCamera` (or a Hellforge-style sampled pose on one Camera). After each beat, restore the over-shoulder gameplay camera by ID — not by spawn order.

1. **Photo look** — Investigation of the brother’s photo.
2. **Talk** — Attitude Choice with the street NPC.
3. **Aftermath** — one of two written endings; camera + HUD text, not a manhua kill-freeze.

The gunfight stays on the over-shoulder gameplay camera. Combat freeze uses `gameDelta = 0`, not `App.pause` or a global time scale. No sequencer, no DOM video cutscene.
