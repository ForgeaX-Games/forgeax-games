---
id: W02
title: 当前引擎音频与音频事件合同是什么
labels: [wayfinder:research]
status: closed
parent: W00
blocked_by: []
assignee: research-subagent
---

# 当前引擎音频与音频事件合同是什么

## Parent

[从白盒到如龙式雨夜切片](../MAP.md)

## Question

What audio kinds, loaders, and playback APIs does Engine v4 actually expose (`audio`, `audio-webaudio`, asset kinds `audio` / `audio-event`)? How do in-tree games play gunshots or ambience today? Separate proven runtime APIs from FPS Gym’s procedural WebAudio. Do not choose Rain Alley’s sound design.

## Blocked by

None - can start immediately

## Resolution

Closed. Engine v4 exposes one proven `audio` clip path (`AudioClipAsset` + `AudioSource` playing edges + `AudioBackend`/WebAudio Host), with `sfx` and `music` buses and optional positional panning. No current `audio-event` asset contract was found. FPS, Hellforge, and the current Rain Alley instead use game-owned procedural Web Audio; Hellforge additionally uses `HTMLAudioElement` for BGM.

Research: [W02 engine audio contract](../research/W02-engine-audio-contract.md).
