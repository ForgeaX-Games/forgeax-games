---
id: W09
title: 没有Gym源文件时资产从哪来
labels: [wayfinder:grilling]
status: closed
parent: W00
blocked_by: [W06]
assignee: laurenceelu
---

# 没有Gym源文件时资产从哪来

## Parent

[从白盒到如龙式雨夜切片](../MAP.md)

## Question

Given [仓库内还有哪些可授权复用的角色枪与街景](./W06-in-org-reusable-assets.md): cleared in-tree stock is mostly CC0/CC BY environments (Quaternius fox, Poly Haven, Kenney nature/particles, attributed Sponza cut) plus Hellforge Meshy kit under operator-account terms. There is **no** cleared modern human, shotgun mesh, or gunshot sample. Hellforge `charactery` GLBs exist but lack per-asset license records.

What is the source policy for hero, enemies, shotgun prop, street set, wet materials, and gunshot audio? Choose in-org reuse (and whether unlicensed Hellforge GLBs are allowed after provenance work), new Meshy/gen3d, purchased/Mixamo-class libraries, or engine primitives until licensed. FPS Gym HTML blobs stay forbidden.

## Blocked by

- [仓库内还有哪些可授权复用的角色枪与街景](./W06-in-org-reusable-assets.md)

## Settled so far

- No commercial purchase.
- Mixamo-class, CC0 downloads, Meshy/gen3d, simple boxes, and in-tree stand-ins are all allowed **for prototype speed**. Provenance and a license pass are deferred until a later product gate, not this map’s prototype.
- Hellforge `charactery` is not the product hero. It may be used only as a throwaway animation-pipeline stand-in because it already loads in Engine v4.
- FPS Gym HTML blobs stay forbidden (codec and ADR, not a license discussion).

## Resolution

Asset policy is **speed-first stand-ins**, not a store or a license office.

Pick whatever reaches Studio Play fastest as a glTF/GLB (or a box if no mesh is in hand): Mixamo-class humanoid, CC0 pack, Meshy/gen3d, or an in-tree skinned mesh. Do not buy assets. Do not wait for ATTRIBUTION files before the prototype. Do not copy FPS Gym cooked v3.

Sockets and Acting State are designed as if a human TPS rig will replace the stand-in. Boxes remain valid Presentation until a mesh is cooked through mesh-bin v4.

A public or mainline ship still needs a later license pass; that pass is out of this ticket.
