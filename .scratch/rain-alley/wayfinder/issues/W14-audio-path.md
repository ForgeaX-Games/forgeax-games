---
id: W14
title: 枪声与空间音用哪条音频路径
labels: [wayfinder:grilling]
status: closed
parent: W00
blocked_by: [W02]
assignee: laurenceelu
---

# 枪声与空间音用哪条音频路径

## Parent

[从白盒到如龙式雨夜切片](../MAP.md)

## Question

Given [当前引擎音频与音频事件合同是什么](./W02-engine-audio-contract.md): the proven engine path is `audio` clips + `AudioSource` + WebAudio Host (`sfx`/`music`, optional positional). There is no `audio-event` asset kind. FPS/Hellforge/Rain Alley procedural WebAudio is game-owned, not that contract. Do gunshot, reload, hit, rain bed, and neon hum use engine clips, keep procedural WebAudio, or hybrid? What must be audible for a fair gunfight before final mix?

## Blocked by

- [当前引擎音频与音频事件合同是什么](./W02-engine-audio-contract.md)

## Resolution

Prototype audio is **game-owned procedural WebAudio** (the path already in Rain Alley / FPS / Hellforge). Required for a fair gunfight: shot, empty/click, hit, hurt. Reload and a rain bed are next; neon hum is optional.

Do not block the prototype on `audio` clip assets or a non-existent `audio-event` kind. A later pass may swap procedural voices for engine clips without changing call sites if a thin play() seam exists.
