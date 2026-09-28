---
id: W03
title: 当前引擎湿地雨夜与PBR已证明到哪一步
labels: [wayfinder:research]
status: closed
parent: W00
blocked_by: []
assignee: research-subagent
---

# 当前引擎湿地雨夜与PBR已证明到哪一步

## Parent

[从白盒到如龙式雨夜切片](../MAP.md)

## Question

What lighting, PBR materials, wet/roughness/metal workflows, emissive neon, rain, fog, and shadows are proven in Engine v4 games (Hellforge, fps, others) versus merely present as packages (`vfx`, `render`)? Cite running games or tests, not wish lists. Do not pick Rain Alley’s look.

## Blocked by

None - can start immediately

## Resolution

Proven: standard metallic/roughness PBR, IBL, HDR emissive/bloom, directional shadows, Hellforge screen-space haze. Unproven in target games: rain, puddles/dynamic wetness, reflections, volume fog, point/spot shadows. Detail: [Research findings](../research/W03-engine-wet-pbr-rain.md)
