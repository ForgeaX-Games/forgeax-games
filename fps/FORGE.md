# SECTOR STRIKE

A Call-of-Duty-like first-person shooter built on forgeax-engine (WebGPU ECS).

## Play
- **Click** — lock the mouse & fire (hold to auto-fire)
- **Mouse** — aim / look around
- **WASD** — move · **Shift** — sprint
- **R** — reload

Survive an endless assault of red hostiles inside a dark industrial arena.
Headshots deal bonus damage. Rack up the highest score before you fall.

## Under the hood (all forgeax-engine ECS)
- First-person camera driven by yaw/pitch quaternions + WASD movement with crate collision.
- Hitscan shooting via ray-vs-sphere against an enemy pool, head/body hitboxes, recoil + muzzle flash.
- Enemies seek the player, attack in melee range, die & respawn from the arena edges.
- Standard PBR materials + a dim directional "sun" and a warm point-light "flashlight" that rides the player for that COD-night mood.
- Flat DOM HUD overlay only (crosshair / health / ammo / score) — the world itself is 100% engine entities.

> Note: rendering needs a WebGPU-capable browser. In a headless/VM preview the engine may report "no usable backend".
