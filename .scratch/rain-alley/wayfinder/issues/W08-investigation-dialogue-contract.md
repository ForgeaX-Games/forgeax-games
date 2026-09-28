---
id: W08
title: 调查与对话在切片里算什么
labels: [wayfinder:grilling]
status: closed
parent: W00
blocked_by: []
assignee: laurenceelu
---

# 调查与对话在切片里算什么

## Parent

[从白盒到如龙式雨夜切片](../MAP.md)

## Question

What is the minimum Investigation / dialogue / choice / Aftermath contract for this Vertical Slice? Candidates already known to be in-engine: HUD cards, a photo object, a persistent flag, two ending texts. What must the player *do* besides shoot, and what must still be readable without VO or an unproven dialogue tree?

## Blocked by

None - can start immediately

## Resolution

The Vertical Slice RPG contract is four beats on the one street, with no quest log and no dialogue tree:

1. **Investigation** — the player inspects the brother’s photo (a world object plus readable HUD copy). This changes what they know and is required before the talk can complete.
2. **Attitude choice** — one street NPC, short on-screen lines, one persistent choice (two options). No VO, no branching conversation graph.
3. **Gunfight** — the one complete street fight already locked in [一条街是否取代巷厨厅三段地理](./W07-one-street-vs-three-segments.md).
4. **Aftermath** — two ending texts (and matching camera beat once cinematic language is chosen), selected by that persistent flag. Not a score screen.

Readable without speech: photo inspect, choice cards, gunfight, two written endings. A full mission/inventory/relationship system is out of this map.
