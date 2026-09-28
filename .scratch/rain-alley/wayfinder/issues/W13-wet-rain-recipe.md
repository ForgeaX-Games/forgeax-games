---
id: W13
title: 湿地雨夜怎么做才不超过引擎
labels: [wayfinder:grilling]
status: closed
parent: W00
blocked_by: [W03]
assignee: laurenceelu
---

# 湿地雨夜怎么做才不超过引擎

## Parent

[从白盒到如龙式雨夜切片](../MAP.md)

## Question

Given [当前引擎湿地雨夜与PBR已证明到哪一步](./W03-engine-wet-pbr-rain.md): wet-street look can use static metallic/roughness (Hellforge “slick wet stone” is a roughness scalar, not rain). Rain, puddles, dynamic wetness, reflections, volume fog, and point/spot shadows are unproven. What wet-street, neon, and rain recipe stays inside that envelope for this Vertical Slice, and what is postponed? Cosmetic only — movement and aim stay deterministic.

## Blocked by

- [当前引擎湿地雨夜与PBR已证明到哪一步](./W03-engine-wet-pbr-rain.md)

## Resolution

Stay inside proven PBR: darker wet roughness (and optional metallic) on street/ground materials, HDR emissive neon on signs, directional shadow, existing skylight/IBL. Rain is cosmetic only — optional unlit particle or audio bed, never affecting move or aim.

Postponed: puddles, dynamic wetness, SSR/planar reflection, volume fog, point/spot shadows, weather physics. Hellforge screen-space haze may be copied as a cheap grade; it is not scene fog.
