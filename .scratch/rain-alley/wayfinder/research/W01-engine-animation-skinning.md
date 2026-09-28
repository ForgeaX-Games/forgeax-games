# W01 — Engine v4 character animation and skinning contract

## Scope and evidence level

This records the Studio-pinned Engine v4 source contract and the three in-tree
games. “Runnable proof” below means a checked-in browser/Dawn smoke target or
game wiring, not a fresh visual run performed for this ticket.

## Engine contract

### Assets and import

- The asset model is deliberately split into three independent payloads:
  `SkeletonAsset` owns inverse-bind matrices and joint count, `SkinAsset` owns
  the skeleton GUID plus name paths, and `AnimationClip` owns duration and
  target-addressed channels
  (`engine/packages/types/src/index.ts:1710-1717`,
  `engine/packages/types/src/index.ts:1890-1922`).
- An animation channel addresses one stable `AnimationTargetId` and one of
  `translation | rotation | scale | weights`; samplers support only `LINEAR`
  and `STEP` (`engine/packages/types/src/index.ts:1720-1744`). A clip is only
  duration plus channels; it carries no semantic state name, transitions, or
  gameplay event (`engine/packages/types/src/index.ts:1747-1759`).
- glTF import derives target IDs from the complete named node path and rejects
  missing/duplicate paths or ID collisions
  (`engine/packages/gltf/src/parse-animation.ts:200-260`). It imports only
  `LINEAR`/`STEP`; `CUBICSPLINE` fails at import
  (`engine/packages/gltf/src/parse-animation.ts:84-92`,
  `engine/packages/gltf/src/parse-animation.ts:117-133`).
- glTF skin import caps a skin at 256 joints, reads inverse-bind matrices (or
  supplies identity matrices when absent), and requires named joint paths
  (`engine/packages/gltf/src/parse-skin.ts:18-35`,
  `engine/packages/gltf/src/parse-skin.ts:110-190`). The FBX package declares
  the same engine-facing products—meshes, nodes, materials, skeletons, skins,
  and clips—through its ufbx/Wasm importer
  (`engine/packages/fbx/package.json:1-9`).
- The glTF bridge writes `AnimationTargetId` onto animated scene entities and
  writes `Skin` onto skinned mesh entities
  (`engine/packages/gltf/src/bridge.ts:527-534`,
  `engine/packages/gltf/src/bridge.ts:600-633`,
  `engine/packages/gltf/src/bridge.ts:647-660`).

### Instantiation and skinning

- `Skin` is a sibling component on the mesh entity with
  `{ skeleton: shared<SkeletonAsset>, joints: entity[] }`
  (`engine/packages/skinning/src/skin.ts:1-18`,
  `engine/packages/skinning/src/skin.ts:61-66`).
- Scene instantiation auto-resolves `Skin.joints` from the matching
  `SkinAsset.jointPaths`; the lookup is scoped to the spawned subtree so
  multiple instances do not share bones. Missing skin assets or joints are
  structured failures
  (`engine/packages/render/src/scene-instances/post-spawn-resolve-joints.ts:1-31`,
  `engine/packages/render/src/scene-instances/post-spawn-resolve-joints.ts:69-120`,
  `engine/packages/render/src/scene-instances/post-spawn-resolve-joints.ts:123-162`).
- Render skinning computes `palette[i] = jointWorld[i] × inverseBind[i]`. The
  skinned mesh entity’s own transform is ignored for deformation; movement
  must affect the joint root or a common joint ancestor
  (`engine/packages/skinning/src/skin.ts:27-49`). This is separate from the
  practical requirement to keep the imported mesh parented so scene placement
  and culling remain coherent, which Hellforge documents in its binding helper
  (`hellforge/src/bind-skinned-animation.ts:9-18`).

### Playback and binding

- `AnimationPlayer` owns parallel variable-length arrays `clips`, `times`,
  `weights`, and `speeds`, plus `paused` and `looping`. Every full slot write
  must keep all four arrays at the same length
  (`engine/packages/animation/src/animation-player.ts:1-18`,
  `engine/packages/animation/src/animation-player.ts:35-52`,
  `engine/packages/animation/src/animation-player.ts:68-84`).
- The player belongs on an ancestor root. Import does not make a player scan
  descendants: callers explicitly collect instantiated entities carrying
  `AnimationTargetId` and call `bindAnimationTargets`
  (`engine/packages/animation/README.md:69-71`,
  `engine/packages/animation/README.md:82-94`).
- Each tick advances slot time, wraps when `looping=true`, clamps at the first
  or last frame when `looping=false`, blends translation/scale linearly and
  rotation with normalized lerp, then writes one local `Transform` per target
  (`engine/packages/animation/src/systems/advance-animation-player.ts:1-30`,
  `engine/packages/animation/src/systems/advance-animation-player.ts:117-157`,
  `engine/packages/animation/src/systems/advance-animation-player.ts:160-209`).
- Multiple clips can be hard-cut or weighted/cross-faded. `AnimationGraph`
  supports only clip/blend/add topology; the public package explicitly excludes
  an FSM, masks, IK, hidden subtree scanning, and arbitrary component-field
  animation (`engine/packages/types/src/index.ts:1760-1777`,
  `engine/packages/types/src/index.ts:1822-1846`,
  `engine/packages/animation/README.md:132-141`).

## What is required for idle / walk / aim / fire / reload / hit / death

The engine has no built-in meanings for those labels. For a skinned character
to visibly perform them, the existing contracts require all of the following:

1. An imported scene containing one skinned mesh, `SkeletonAsset`, `SkinAsset`,
   named joint entities, and clip channels whose target IDs match those
   entities (contracts above).
2. Each desired visible performance represented by a compatible
   `AnimationClip` payload/GUID. The engine does not require seven distinct
   clips, but it also does not synthesize aim, fire, reload, hit, or death.
3. `skinningPlugin` in a host that contains `Skin`; animation components and
   the advance system installed by the animation runtime/profile
   (`engine/packages/skinning/README.md:1-10`,
   `engine/packages/animation/src/plugin.ts:43-57`).
4. Instantiate the scene, place `AnimationPlayer` on the instantiated root,
   collect `AnimationTargetId` entities from `SceneInstance.mapping`, and bind
   them explicitly. Hellforge’s helper is the compact in-game instance of this
   sequence (`hellforge/src/bind-skinned-animation.ts:43-60`,
   `hellforge/src/bind-skinned-animation.ts:98-158`).
5. Game code chooses the slot(s), resets `times`, supplies weights/speeds,
   chooses looping for locomotion and non-looping for one-shots, and decides
   when a one-shot yields back to locomotion. Gameplay timing/events are not
   emitted by the clip system; a game must synchronize fire, reload completion,
   damage, and death itself. Hellforge computes attack contact from clip
   duration rather than receiving an animation event
   (`hellforge/src/monsters.ts:1049-1085`).
6. Aim layering is not a named engine facility. A full-body aim clip can use
   the same hard-cut path; weighted/additive clips can use the generic blend/add
   path, but there is no bone mask or IK contract
   (`engine/packages/animation/README.md:132-141`).

## Documented versus demonstrated

### Runnable Engine examples

- `hello-skin` is the strongest glTF end-to-end proof: it loads a Fox scene and
  Survey/Walk/Run clip GUIDs, instantiates the scene, finds `Skin` and animation
  targets, binds an `AnimationPlayer`, and exposes hard cuts, a 0.3-second
  crossfade, and a three-way blend
  (`engine/apps/hello/skin/src/main.ts:60-68`,
  `engine/apps/hello/skin/src/main.ts:160-199`,
  `engine/apps/hello/skin/src/main.ts:220-258`,
  `engine/apps/hello/skin/src/main.ts:359-390`,
  `engine/apps/hello/skin/src/main.ts:426-499`). Its package makes the
  300-frame skinned draw smoke a gate
  (`engine/apps/hello/skin/package.json:30-49`).
- `hello-fbx-skin` is the FBX proof: the fixture has 80 joints and three clips
  (`run`, `punch`, `shot`), creates three independent instances, binds each
  root, and swaps clips through the same four slot arrays
  (`engine/apps/hello/fbx-skin/src/main.ts:1-18`,
  `engine/apps/hello/fbx-skin/src/main.ts:90-121`,
  `engine/apps/hello/fbx-skin/src/main.ts:126-188`,
  `engine/apps/hello/fbx-skin/src/main.ts:236-263`). Its 300-frame structural
  smoke is also a checked-in gate
  (`engine/apps/hello/fbx-skin/package.json:7-36`).

### In-tree games

- Hellforge is the only examined game with an actual skinned-character
  gameplay path. Monsters declare five imported clip GUIDs
  (`idle/move/attack/hit/death`) per rig
  (`hellforge/src/monsters.ts:310-353`), load those clips and require idle
  (`hellforge/src/monsters.ts:540-555`), bind the instantiated root
  (`hellforge/src/monsters.ts:609-640`), play hit and death as non-looping
  one-shots (`hellforge/src/monsters.ts:750-779`,
  `hellforge/src/monsters.ts:819-833`), and resume idle/move after one-shots
  (`hellforge/src/monsters.ts:1110-1133`). This proves the generic contract can
  drive locomotion, attack, hit, and death in game code. The current hero
  preview only proves idle/static fallback
  (`hellforge/src/hero-preview.ts:459-479`).
- Hellforge’s seven-clip hero delivery document is a product-side convention,
  not an Engine requirement. It names idle/walk/run/attack/hit/death/dodge and
  explicitly says monsters retain the five-clip contract
  (`hellforge/CHARACTER-ANIMATION-CONTRACT.md:1-12`,
  `hellforge/CHARACTER-ANIMATION-CONTRACT.md:24-37`).
- FPS Gym does not prove third-person skinned acting. Its enemies and weapon
  are assembled from primitive parts with per-part procedural animation
  (`fps/main.ts:300-341`, `fps/main.ts:365-389`).
- Rain Alley is still a primitive whitebox: the visible player is spawned from
  boxes/spheres, not an imported `Skin`/`AnimationPlayer`
  (`rain-alley/main.ts:285-328`). Its named acting-state list is therefore
  terminology, not runtime proof (`rain-alley/CONTEXT.md:25-37`).

## Bottom line

Engine v4 proves imported glTF/FBX skinning, explicit target binding, clip hard
cuts, N-way blending, and non-looping final-frame clamp. Hellforge proves a
five-state skinned enemy loop in game code. No examined running game proves the
complete idle/walk/aim/fire/reload/hit/death set on one skinned third-person
character; specifically, aim and reload remain unproven on that path, while the
FBX Engine demo proves a generic `shot` clip but not gameplay fire/reload
synchronization.
