# ForgeaX: Hellforge

A Diablo II-flavoured action RPG sample built on the forgeax engine.

> **MVP-state notice.** Right now the game ships only what you need to walk
> around a tiny encampment with the witch (the hero) and see her render.
> Skill activation, monsters, loot drops, leveling and gear are designed below
> but **not yet implemented** — they land incrementally on top of this MVP
> shell.

## Pitch

You play a female sorceress who walks out from the **Rogue Encampment** to
the wilderness, fights monsters with **active skills you cast on demand**
(D2: fire, ice, lightning…), collects loot from drops, levels up, learns
skills, and returns to the encampment to upgrade and try again. Two camera
modes you can toggle live:

- **2.5D** — top-down isometric, the classic Diablo angle, default for combat
  / loot pickup / inventory.
- **First-person** — eye-cam through the hero's head, for immersive
  exploration / dialogue / dungeon traversal.

Future characters slot in next to the witch — each is a separate GLB pack
swap, gameplay/skill code stays shared.

## Why "Hellforge"

In Diablo II the **Hellforge** is the prime-evil weapon foundry in Act IV.
It's iconic, it rhymes with **forgeax**, and it tells you what the engine
underneath is doing — forging entities + meshes + materials per frame.

## Status (2026-06-15)

What works today:

- [x] Witch hero spawns from `assets/characters/witch.glb` via the vendored
      per-node GLB loader (same shape as fps's IntelliScene path)
- [x] Single-scene encampment authored as a forgeax native `scene.pack.json`
      (ground slab + a few stone huts + a campfire altar)
- [x] **WASD** moves the hero around the encampment
- [x] **V** key toggles between 2.5D top-down and first-person view
- [x] Mouse-look in first-person (with pointer-lock, web + Tauri)
- [x] HUD shows view-mode + control hints

What's stubbed / not yet wired:

- [ ] AnimationPlayer (idle/move/attack/hit/death) — `witch.glb` already
      ships all 5 clips; play-runtime's vite.config still needs
      `gltfImporter` so the engine sees `animation-clip` sub-assets. Until
      then the witch is rendered in T-pose.
- [ ] Active skills (1/2/3/4 keys) — design in §Skills below
- [ ] Monsters + spawner — placeholder cubes for now
- [ ] Loot drops + inventory
- [ ] Leveling + skill tree
- [ ] Town vs wilderness scenes

## Controls (current MVP)

| input | action |
|---|---|
| WASD | move on the ground plane |
| Shift | sprint |
| V | toggle 2.5D ⇄ first-person view |
| Mouse (FPS mode) | look |
| Esc | release pointer lock |

## File layout

```
hellforge/
  forge.json              — game manifest (id, scenes, default scene)
  package.json            — @forgeax/game-hellforge workspace package
  main.ts                 — boot, ECS spawn, per-frame loop, view-mode toggle
  assets/
    characters/
      witch.glb           — 33-joint skinned sorceress + 5 clips (idle/move/attack/hit/death)
  scenes/
    rogue-encampment.pack.json   — native engine scene pack (ground + huts + altar)
  src/                    — game systems (skills, enemies, fx)
  docs/                   — design + handover notes
  AGENTS.md               — game-charter for AI agents touching this game
  PLAY_EXPERIENCE.md      — combat / loot / progression design notes
  README.md               — this file
```

## Scene authoring

The static scene lives in `scenes/rogue-encampment.pack.json` — the engine's
**native** scene pack format. Edit + Play render the same source, so the
editor (✎ Edit on `forge.json#defaultScene`) is the WYSIWYG authoring tool.
Hero / monsters / loot are **dynamic** and live in `main.ts` (spawned at
boot or runtime); only persistent visible terrain belongs in the pack.

## Skills (planned)

| key | school | early skill | mid-tier |
|---|---|---|---|
| 1 | Fire   | Fire Bolt        | Fire Ball  |
| 2 | Cold   | Ice Bolt         | Glacial Spike |
| 3 | Light  | Charged Bolt     | Lightning Strike |
| 4 | Util   | Teleport (short) | Town Portal |

Each skill: cooldown + mana cost + cast animation slot on the witch. Damage
projectiles are transient particle entities; impacts spawn FX assets.

## Roadmap

1. **MVP shell (this commit)** — witch renders, walks, view toggles, single
   encampment scene.
2. **Animations** — wire gltfImporter into play-runtime, spawn AnimationPlayer
   on the witch, swap clip on idle vs move vs attack (mirror hello-skin).
3. **Skill cast loop** — 1/2/3/4 → spawn projectile + play attack clip + UI
   cooldown.
4. **Enemy spawner** — a small wilderness scene with a few monsters; HP +
   damage + death.
5. **Loot + XP + level** — drop tables, pickup, level curve, skill points.
6. **Skill tree UI** — D2-style talent allocator.
7. **More characters** — paladin / barbarian / necromancer drop in as
   sibling GLB packs (`assets/characters/<name>.glb`).
