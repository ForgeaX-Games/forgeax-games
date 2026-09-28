---
id: W10
title: 一个蒙皮主角加武器插座在Play里能不能站住
labels: [wayfinder:prototype]
status: closed
parent: W00
blocked_by: [W01, W05]
assignee: laurenceelu
---

# 一个蒙皮主角加武器插座在Play里能不能站住

## Parent

[从白盒到如龙式雨夜切片](../MAP.md)

## Question

Raise fidelity with a throwaway `/prototype` under [没有Gym源文件时资产从哪来](./W09-asset-source-policy.md): cook the fastest available glTF/GLB (Mixamo-class humanoid, CC0, Meshy, or in-tree skinned mesh; boxes if nothing is in hand) via `forgeax-engine-remote-gltf import` then Vite `pluginPack`. No FBX-first path. Bind clips per [当前引擎骨骼动画与蒙皮合同是什么](./W01-engine-animation-skinning.md). Do not block on ATTRIBUTION. Can one skinned mesh, a Weapon Socket (not a camera viewmodel), and at least one fire or aim clip play in Studio Play without T-pose or missing materials? Link the prototype branch. Capability only.

## Blocked by

- [当前引擎骨骼动画与蒙皮合同是什么](./W01-engine-animation-skinning.md)
- [从glTF或FBX烹饪到mesh-bin v4的官方路径是什么](./W05-official-cook-path-v4.md)

## Resolution

Yes. Verified in the running engine Play host with a throwaway probe on branch
`laurenceelu/proto-20260905-w10-socket` (`w10-socket/` game, worktree
`forgeax-games/.worktrees/w10-socket`). Stand-in art is hellforge
`charactery-merged.glb`, never a product hero.

Proven end to end, on screen:

- The cooked mesh-bin v4 character loads with materials — no T-pose, no missing
  material, no console error storm.
- Skin found; 24 joints carry `AnimationTargetId`; `bindAnimationTargets`
  succeeds; both clips (idle, attack-as-fire) play and switch at runtime.
- A **Weapon Socket is real**: a cube parented with `ChildOf` to the joint named
  `RightHand` renders in the hand, casts a shadow, and keeps following the hand
  through the attack clip.

The load recipe is exactly hellforge's: `assets.loadByGuid` →
`world.allocSharedRef` → `assets.instantiate(handle, world, rig)` →
`AnimationPlayer` on the SceneInstance root → `bindAnimationTargets` over every
mapping entity that carries `AnimationTargetId`. Joints are ordinary entities in
`SceneInstance.mapping` and carry `Name`, which is how a socket finds its bone.

Two constraints the spec must carry:

1. **Joint space is centimetres on this rig.** `RightHand` sits ~23 units from
   the forearm, so socket offsets and scales are ~100x their metric values. A
   metric-sized prop parented to a joint is invisible, not missing.
2. **Studio only activates externally-linked games.** A hand-made symlink under
   `.forgeax/games/` is rejected by `resolveForgeaxGameProjection`; the game must
   be adopted through `POST /api/projects/link` before `PUT /api/projects/active`
   will accept it.
