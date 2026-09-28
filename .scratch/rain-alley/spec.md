---
status: ready-for-agent
---

# 《雨夜不回头》Vertical Slice spec

- **Display name**: 雨夜不回头
- **Slug**: `rain-alley`
- **Status**: ready-for-agent
- **Supersedes**: the 2026-09-03 three-segment Whitebox spec (alley → kitchen → hall)
- **Date**: 2026-09-05
- **Glossary**: `rain-alley/CONTEXT.md`
- **ADR**: do not migrate FPS Gym mesh-bin v3 cooked assets

## Problem Statement

The player still cannot play a Hong Kong rain-night over-shoulder gunfight that feels like a Yakuza-like street slice. What exists today is a Whitebox: cube bodies, a cube gun, a generated three-room corridor, and a DOM HUD. The shotgun numbers and enemy rules are real, but Play is unfair (enemies shoot through walls because line of sight is hardcoded true) and the look is cubes, so it reads nothing like FPS Gym and nothing like the product.

A previous spec asked for three authored combat rooms and a comic kill-freeze. That geography and that Aftermath are wrong for this Vertical Slice. The slice must stay a **shooter**. Investigation and one Attitude Choice are wrapping, not a dialogue game.

## Solution

Keep the Rules kernel. Replace Presentation.

The Vertical Slice is eight to twelve minutes on **one dense Hong Kong rain street** and **one complete gunfight**. Doorways and interiors are set dressing and cover, not extra combat rooms. The player inspects the brother’s photo (Investigation), speaks to one street NPC and picks one Attitude Choice, fights the street, then reads one of two Aftermath texts chosen by that flag.

The hero is a skinned Stand-in with a Weapon Socket on the hand, never a camera viewmodel. The Gameplay Camera stays over-shoulder during the fight. Three Authored Beats hard-cut for photo, talk, and Aftermath, then restore the Gameplay Camera by entity ID. Wet Look is static wet materials plus neon emissive. Gunshots, empty click, hit, and hurt play as procedural WebAudio.

Acceptance is real Studio Play judged by eye, plus `bun test` on the Rules kernel. Do not enable unused Engine fps metric flags.

## User Stories

1. As a player, I want to open 《雨夜不回头》 as its own Studio game beside Hellforge, so that the gunfight slice does not overwrite the ARPG.
2. As a player, I want to play in macOS Chrome with WebGPU via Studio Play, so that I am not blocked on the desktop app or Safari.
3. As a player, I want a start overlay that asks me to click, so that pointer lock can engage like a shooter.
4. As a player, I want mouse look with pointer lock actually requested at runtime, so that aiming is not stuck in an unlocked cursor.
5. As a player, I want a fixed right-shoulder Gameplay Camera, so that I see the hero and the gun in frame like a HK action film.
6. As a player, I want WASD to move relative to the camera, so that I can strafe along the street and into cover.
7. As a player, I want Shift to sprint for about 1.5 seconds with a cooldown, so that I can cross to a doorway or stall.
8. As a player, I want sprint to stay slower than a closing melee threat, so that I cannot kite the gunfight by running.
9. As a player, I want Space to hop a low curb (about 30–40 cm), so that the street reads as a street, not a platformer.
10. As a player, I want hop to never grant jump-shot or vault-over-enemy advantage, so that shotgun range stays honest.
11. As a player, I want F to trigger 1–2 seconds of slow-motion with about 8–10 seconds cooldown, so that I can survive a reload or a spray.
12. As a player, I want unlimited slow-motion uses (cooldown only), so that I am not punished for saving it.
13. As a player, I want no dedicated dodge, roll, slide, cover-stick, ADS, or shoulder-swap, so that the slice stays a lightweight over-shoulder shooter.
14. As a player, I want left mouse to fire a pump-feel shotgun, so that close-range fights feel like one sentence, one body.
15. As a player, I want an 8-shell magazine and infinite reserve, so that tension comes from the reload window, not scavenging boxes.
16. As a player, I want R to start a full-body reload of about 2.5–2.8 seconds, so that I am vulnerable on screen.
17. As a player, I want to walk (not sprint) during reload, and to be unable to fire until reload finishes, so that reload is a real decision.
18. As a player, I want empty-chamber clicks when I pull the trigger on an empty mag, so that I know I must reload.
19. As a player, I want one well-aimed doorway shot to kill a regular enemy, so that the shotgun fantasy holds.
20. As a player, I want pellet damage to fall off by mid-street, so that distant peekers are uncomfortable until I close in.
21. As a player, I want pellets to resolve as one clustered hitscan (about 8 pellets, no flight time), so that the CPU does not spawn a projectile entity per pellet.
22. As a player, I want muzzle flash, shells, sparks, and a gunshot sound on every fire, so that the shot still reads.
23. As a player, I want a hit spark and a hurt cue when I am shot, so that incoming damage is readable without a novel HUD.
24. As a player, I want unused guns detached from the camera, so that shooting does not rebuild the scene graph.
25. As a player, I want exactly one player weapon in this slice, so that animation and grip stay on one short-gun family.
26. As a player, I want the gun parented to a Weapon Socket on the hand, so that it follows Acting State instead of floating on the lens.
27. As a player, I want to see a skinned hero Stand-in, never a product T-pose or an untextured mesh, so that the street fight looks like a person with a gun.
28. As a player, I want idle, walk, fire (or aim), and reload Acting States at minimum, so that the body tells me what I am doing.
29. As a player, I want hit and death Acting States when those clips exist, so that taking a round and going down are readable.
30. As a player, I want an imperfect Mixamo-class or in-tree Stand-in grip to be acceptable, so that shipping is not blocked on finger IK.
31. As a player, I want to walk one dense rain street, so that I am in a Yakuza-like block, not three disconnected combat rooms.
32. As a player, I want doorways, shop mouths, and interiors as cover and set dressing, so that they help the gunfight without becoming extra authored rooms.
33. As a player, I want rain and neon as Wet Look only, so that movement and aim are not randomized by weather physics.
34. As a player, I want puddles, screen-space reflections, volume fog, and point-light shadows absent, so that the engine stays inside proven lighting.
35. As a player, I want optional cosmetic rain particles or a rain bed later, so that atmosphere can thicken without becoming a systems project.
36. As a player, I want to inspect the brother’s photo as a world object plus HUD copy, so that I know why I do not turn back.
37. As a player, I want Investigation to complete before the street talk can finish, so that the photo is not skippable flavour.
38. As a player, I want one Authored Beat camera while I look at the photo, so that the inspection feels staged, not a pause menu.
39. As a player, I want to talk to exactly one street NPC with short on-screen lines and no voice, so that the slice has attitude without a dialogue tree.
40. As a player, I want two Attitude Choice options stored as one persistent flag, so that the ending can split without a quest log.
41. As a player, I want an Authored Beat camera during that talk, so that the choice is readable.
42. As a player, I want the Gameplay Camera restored by entity ID after every Authored Beat, so that I am never left on the wrong lens for the gunfight.
43. As a player, I want the gunfight to stay on the Gameplay Camera the whole time, so that combat never cuts to a cinematic.
44. As a player, I want enemies who cannot shoot me through SightBlockers, so that cover is real and the fight is fair.
45. As a player, I want pistol peekers to chip me in about three hits from cover, so that standing in the open is punished.
46. As a player, I want a melee closer who kills on contact, so that I must shotgun the doorway instead of trading fists.
47. As a player, I want a suppression gunner who dumps me in about one second of sustained fire, so that I must break line of sight to reload.
48. As a player, I want one tougher coat-like closer who takes several shotgun blasts, so that I reload once under pressure inside the same street fight — not a second map.
49. As a player, I want old alley/kitchen/hall kill quotas treated as reusable rule material, so that pacing numbers can be retuned onto one street instead of rebuilt from nothing.
50. As a player, I want death to restart the gunfight beat, not the Investigation, so that a wipe does not replay the photo.
51. As a player, I want a short Chinese HUD for shells in mag, health or hurt, and death, so that I can read the fight without a product chrome redesign blocking Play.
52. As a player, I want that HUD to be Presentation, not the Whitebox DOM as the shipped look, so that the overlay can be replaced without rewriting shotgun math.
53. As a player, I want Chinese UI and almost no spoken VO, so that the slice does not take a dubbing track.
54. As a player, I want a short Chinese title card 《雨夜不回头》 at boot, so that the window name matches the display name.
55. As a player, I want Aftermath to be an Authored Beat plus one of two written endings from the Attitude Choice flag, so that the talk mattered.
56. As a player, I want no comic kill-freeze and no manhua HUD as the ending, so that Aftermath stays camera and text.
57. As a player, I want no scoreboard, inventory, relationship meter, or quest log, so that the slice stays a gunfight with two wrapping beats.
58. As a designer, I want enemy guns to be hand props with simple hitscan, not a second viewmodel system, so that there is still one shooter.
59. As a designer, I want Stand-in art from Mixamo-class, CC0, generation, in-tree skinned meshes, or boxes, so that Play is not blocked on a purchase or a license file.
60. As a designer, I want Hellforge charactery used only as a Stand-in or animation-pipeline reference, so that it is never the product hero.
61. As a designer, I want FPS Gym used only as a playability cookbook, so that we do not import first-person, ADS, or Gym arena art.
62. As a designer, I want a later License pass before public or mainline ship, so that the prototype can move now.
63. As a Studio user, I want this game adopted through the project link contract before it is made active, so that a handmade games-folder shortcut does not 404 on switch.
64. As an implementer, I want Hellforge files, pins, and cook workarounds left unchanged, so that the ARPG can keep moving in parallel.
65. As an implementer, I want one Presentation adapter in front of the Rules kernel, so that cameras, sockets, audio, and HUD can change without rewriting clocks and pellets.
66. As an implementer, I want no generic AI framework, so that street enemies stay a handful of archetypes, not a behaviour graph product.
67. As a tester, I want magazine, TTK, falloff, slow-motion cooldown, contact death, respawn grace, and line of sight to be unit-testable without WebGPU, so that fairness does not depend on Play cook.
68. As a tester, I want Investigation completion, Attitude Choice persistence, and Aftermath ending selection to be unit-testable on the Rules kernel, so that the wrapping beats cannot silently desync from the fight.
69. As a tester, I want a human Play checklist on the same host as combat and Authored Beats, so that T-pose, missing materials, pointer lock, and unfair LOS are caught by eye.
70. As a future art pass, I want clip audio and a denser street mesh swapped behind the same sockets and cameras, so that layout and rules do not have to be rebuilt.

## Implementation Decisions

- **Product geography**: one dense Hong Kong rain street, one gunfight. The old three-segment FSM is reusable rule material only. Do not author alley, kitchen, and hall as three combat rooms.
- **RPG wrapping**: Investigation → Attitude Choice → gunfight → Aftermath. No quest log, no dialogue tree, no inventory, no relationship system.
- **Keep / replace**: keep the Rules kernel, Game Clock, character controller movement, shotgun numbers, object pools, and pointer-lock intent. Replace cube hero and cube gun as product look, the procedural three-room corridor, and the Whitebox DOM HUD as product chrome. Boxes remain legal Stand-ins behind the Presentation seam.
- **Must-fix fairness**: combat must call real line of sight against SightBlockers instead of hardcoding a clear shot. Pointer lock must be requested at runtime, not only declared on the game manifest.
- **Presentation seam**: one adapter between the Rules kernel and Engine v4. Skinned hero, Weapon Socket, Authored Beats, Wet Look, and procedural SFX live on the Presentation side. No generic AI framework.
- **Cameras**: three Authored Beats via active-camera-by-entity-id (photo look, talk, Aftermath). Gunfight stays on the Gameplay Camera. Restore that camera by ID after every beat. No sequencer, no global time scale, no `App.pause` as freeze, no DOM video. Slow-motion stays `gameDelta = 0` scaling, not a pause.
- **Skinning recipe** (from the W10 throwaway prototype): load cooked scene by guid, mint a shared handle, instantiate under a movement rig, put the animation player on the scene-instance root, bind every animation-target joint. Parent the weapon with a child-of to a named hand joint. Do not put the animation player on a detached skin entity.
- **Joint space**: on the proven Stand-in rig, joint local space is centimetre-scale (the hand sits on the order of tens of units from the forearm). Socket offsets and scales must match that space; a metre-sized prop parented to the joint is invisible, not missing.
- **Acting State**: idle / walk / fire-or-aim / reload required for the hero Stand-in. Hit / death when clips exist. Sprint may be a faster walk clip. No jump clip, no dodge clip, no ADS clip. A full idle/walk/aim/fire/reload/hit/death set is still unproven as one TPS pack; missing clips degrade to the nearest proven clip or a freeze, they do not block the seam.
- **Assets**: Engine v4 cook only — source glTF/GLB plus sidecar meta through the pack pipeline. Fail closed on mesh-bin v3. No FBX-first path. No purchase. Fastest Stand-in wins. License pass is later.
- **Studio activation**: an external game directory must be adopted through the projects-link API before it can be made the active runtime scope. A handmade symlink under the games folder is not enough.
- **Wet Look**: static low roughness (optional metallic), emissive neon, one directional light with shadows. Optional cosmetic rain. No puddles, dynamic wetness, SSR, volume fog, or point/spot shadows.
- **Audio**: prototype procedural WebAudio. Fair-fight minimum: shot, empty/click, hit, hurt. Reload and rain bed next. Keep a thin play() seam for later clip swap. There is no engine audio-event asset kind to wait on.
- **Keys**: WASD move, Shift sprint, Space hop, F slow-motion, LMB fire, R reload.
- **Performance**: do not rebuild the scene graph per shot. Pool VFX and SFX. Do not enable Engine fps/gate/bench/bundle-size/spike-report flags that every in-tree game currently disables.
- **Host**: forgeax-games sibling of Hellforge. Do not merge into Hellforge. Do not open a new git repo. Engine bindings follow Studio-pinned workspace engine packages.

## Testing Decisions

A good test asserts **observable slice rules**, not engine internals: magazine empty, pump lock, reload lock, pellet falloff, contact death, respawn grace, slow-motion cooldown, whether a SightBlocker occludes a shot, whether Investigation is required before talk completes, whether the Attitude Choice flag selects Aftermath text A or B, whether death restarts the gunfight rather than the photo.

Do not test Transform propagation, animation-target hash internals, glTF bytes, or Studio chrome.

**One automation seam — the Rules kernel.** Extend the existing pure-function tests (`bun test` in the game package). Prior art is this package’s current rules tests and Hellforge’s combat/damage tests: exported functions, no Play cook, no WebGPU.

**Not a second seam:** Presentation (skinning, sockets, cameras, HUD, WebAudio, pointer lock). Those are a human Play checklist on the real Studio Play host (same host as combat and Authored Beats):

- start overlay appears and pointer lock engages on click
- skinned or boxed hero with the weapon in the hand; no T-pose; no missing-material mesh; no console error storm
- one fair gunfight beat — enemies cannot shoot through blockers
- three Authored Beats cut and return to the Gameplay Camera
- Aftermath shows the ending that matches the Attitude Choice

If a world-tick test without GPU is ever added, it still must not open WebGPU.

## Out of Scope

- Copying, converting, or shimming FPS Gym HTML mesh-binary v3 cooked assets
- First-person, ADS, viewmodel-on-camera, Gym arena art direction as the product look
- Merging this slice into Hellforge
- Open-world streaming, city-scale density, facial performance, lip sync, crowd tech
- A six-gun roster or a long-gun animation family
- A full dialogue tree, quest log, inventory, or relationship system
- Comic kill-freeze / manhua HUD as Aftermath
- Puddles, dynamic wetness, SSR, volume fog, point/spot shadows
- Purchase of assets; License pass is a later gate, not this spec’s blocker
- Enabling unused Engine fps/gate metric flags
- Desktop `.app` / Safari as the acceptance host
- Finger IK and a perfect Meshy grip

## Further Notes

- Crowd extras besides the talker and the gunfight remain unspecified; do not invent crowd tech.
- The W10 probe (`w10-socket` on `laurenceelu/proto-20260905-w10-socket`) proved skinned load, joint bind, clip switch, and a hand socket. It is not the product game. Switch Studio back to rain-alley before implementing this spec.
- Display name stays 《雨夜不回头》; directory stays `rain-alley`.
- Next: `/to-tickets`, then one fresh `/implement` session per ticket.
