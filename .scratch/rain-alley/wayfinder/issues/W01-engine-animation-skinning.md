---
id: W01
title: 当前引擎骨骼动画与蒙皮合同是什么
labels: [wayfinder:research]
status: closed
parent: W00
blocked_by: []
assignee: research-subagent
---

# 当前引擎骨骼动画与蒙皮合同是什么

## Parent

[从白盒到如龙式雨夜切片](../MAP.md)

## Question

Against Engine v4 primary sources (packages `animation`, `skinning`, `gltf`, `fbx`, runtime GameEntry examples, Hellforge if it actually plays clips): what character animation and skinning contracts exist today? What is required to show idle/walk/aim/fire/reload/hit/death on a skinned mesh? What is documented but unproven in a running game? Do not propose product direction.

## Blocked by

None - can start immediately

## Resolution

- Engine v4 separates skeleton IBM data, skin-to-joint bindings, and target-addressed clips.
- Imported joints need stable `AnimationTargetId`; instantiated targets must be explicitly bound to an `AnimationPlayer` on their ancestor root.
- Clip slots are parallel `clips/times/weights/speeds` arrays; looping, hard cuts, N-way blend, and additive graphs exist.
- The engine supplies no idle/aim/fire/reload/hit/death semantics, FSM, masks, IK, or animation events.
- Game code must choose clips, own one-shot return rules, and synchronize gameplay events with clip time.
- Engine smoke apps prove glTF Survey/Walk/Run plus blending and FBX run/punch/shot on skinned meshes.
- Hellforge proves an in-game skinned enemy path for idle/move/attack/hit/death; its hero preview proves idle only.
- FPS Gym and Rain Alley use procedural primitive bodies, so neither proves the requested full skinned acting set.
- Aim and reload remain unproven on one in-tree skinned third-person game character.
- Full cited findings: [W01 engine animation and skinning research](../research/W01-engine-animation-skinning.md).
