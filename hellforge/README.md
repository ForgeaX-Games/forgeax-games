# ForgeaX: Hellforge

A Diablo-like action RPG sample built on the forgeax engine, set in an
original world: the great Hellforge's dying embers corrupt the land.

## Pitch

You play a female sorceress in an Act-1 slice: spawn in **余烬哨站
Cinderwatch**, walk out the gate into the **灰烬荒原 Ashen Reach** wilderness
where cinder imps / ash walkers / charred bones hunt you, cast **active
skills** (magma, frost, arc, shadowstep), collect xp shards / gold / potions
/ **equipment beams** from drops, level up to unlock more skills, then brave
**熔渣深窟 Slagdeep Hollow** — a procedurally generated dungeon with a
clear-the-hollow quest and a unique boss, 熔渣督军 the Slaglord. Two camera
modes toggle live: 2.5D top-down (mouse ground-aim) and a GTA-style third
person.

## Why "Hellforge"

In Diablo II the **Hellforge** is the prime-evil weapon foundry in Act IV.
It's iconic, it rhymes with **forgeax**, and it tells you what the engine
underneath is doing — forging entities + meshes + materials per frame.

## Status (2026-07-03) — Act 1 slice COMPLETE

- [x] Witch hero: skinned GLB, 5 clips (idle/move/attack/hit/death), WASD +
      sprint, 2.5D ⇄ third-person toggle, foot-slide-corrected move clip
- [x] **Combat feel (打击感)** — attack swings ROOT monsters (no sliding
      while attacking) with damage landing at the clip's contact frame, so
      side-stepping a wind-up makes it whiff; hits knock monsters back along
      the bolt's flight path (bosses resist 75%); flinches interrupt wind-ups;
      12% crits (×1.65, bigger numbers, extra shove); impact flash pops +
      screen shake (hit/kill/boss-slam graded); the player is shoved by
      monster hits; synthesized WebAudio SFX (`src/sfx.ts` — casts, hits,
      crits, kills, pickups, level-ups, portals — no audio assets).
- [x] **Skills (active cast, no auto-attack)** — `src/skills.ts`
      1 熔火弹 Magma Bolt (L1, AoE splash) · 2 霜牙 Frost Fang (L2, pierce+slow)
      · 3 电弧涌 Arc Surge (L3, 3 erratic bolts) · 4 影踏 Shadowstep (L4,
      walkability-checked blink). Mana costs + regen + per-skill cooldowns.
- [x] **Monsters** — `src/monsters.ts`: 炉渣小鬼 imp / 灰烬行尸 ashwalker /
      焦骨武士 charred / 火纹术士 flamecaller (ranged fire bolts, keeps
      distance) / boss 熔渣督军 slaglord (a 3.5 m lava troll, enrages below
      40% hp). **Skinned GLB rigs** (`assets/monsters/*.glb`, goblin / zombie
      / skeleton / lich / lava-troll) with full idle/move/attack/hit/death
      clip state machines — death plays out on a corpse before despawn;
      lowpoly PartSpec assemblies remain as the load-failure fallback.
- [x] **Loot + progression** — `src/loot.ts` + `src/state.ts`: xp shards,
      gold, heal/mana potions, magnet pickup, gentle exponential xp curve,
      level-up = full heal + skill unlocks.
- [x] **Itemization (打宝核心)** — `src/items.ts` + `src/inventory-ui.ts`:
      6-slot paper doll (武器/头盔/胸甲/靴子/戒指/项链), 4 rarities
      (普通/魔法/稀有/传奇 — legendaries are named uniques with curated
      affix sets + flavor text), 16 affix stats in D2-style prefix/suffix
      pools (damage%, per-element damage, crit chance/damage, hp/mana,
      regens, movespeed, cdr, 金币获取, **掉宝率 MF**, 经验%, 击杀回血).
      Item level rides the killing monster's level (den +1); affix values
      scale ×(1+0.12·(ilvl−1)); equipping requires player level ≥ ilvl−1.
      24-slot bag + B-key panel: click to equip/swap, right-click melts to
      gold, hover tooltips with equipped-item comparison. Drops go to the
      bag (auto-equip only fills empty slots); bag full → beams stay on the
      ground (equipment never expires). Magic find shifts rarity weights on
      every kill roll; the boss loot-explodes 3-5 items (no commons, 22%
      legendary weight); legendary drops get a banner + fanfare + fat beam.
- [x] **PCG dungeon as an EDITABLE SCENE** — `src/dungeon-layout.ts` is a
      pure seeded generator (rooms + Prim-connected L-corridors on a 44×44
      grid, torches, decor, boss braziers, per-room monster packs scaled by
      depth). `bun scripts/bake-dungeon.ts` bakes its geometry into
      `scenes/slagdeep-hollow.pack.json` — the editor lists it next to
      rogue-encampment (click to edit; Launcher "Only slagdeep-hollow"
      starts the run inside the den). Runtime re-runs the SAME fixed seed
      for the walkability grid + spawns (always matches the baked pack) and
      instantiates the pack under a root at (300, 300); if the pack is
      missing it falls back to spawning from the layout. Re-run the bake
      after ANY dungeon-layout.ts change.
- [x] **Quest**: 清剿熔渣深窟 (clear the den) → banner + xp/gold reward.
- [x] **ARPG HUD** — `src/hud.ts`: HP/mana orbs, 4 skill slots with
      cooldown veils + mana costs + unlock levels, XP strip, quest tracker,
      boss HP bar, area-name fades, floating damage numbers, death screen.
- [x] **Custom WGSL shaders** — `src/shaders/`: `fire-bolt.wgsl` (living
      flame projectile body), `portal-vortex.wgsl` (swirling portal discs).
      Premultiplied-alpha, ACES-safe amplitudes. Plus a pooled particle
      system (`src/fx.ts`): hit bursts, death gibs, campfire embers, portal
      motes.
- [x] Death → R to respawn at camp (small xp toll).

Not yet (post-slice): inventory grid (equipment is auto-equip for now),
skill tree allocator, town portal scroll, audio, more acts/characters.

## Controls

| input | action |
|---|---|
| WASD | move · Shift sprint |
| Mouse | aim — 2.5D: ground cursor · 3rd person: look |
| Left-click | cast selected skill |
| 1 / 2 / 3 / 4 | select + cast 熔火弹 / 霜牙 / 电弧涌 / 影踏 |
| V | toggle 2.5D ⇄ third-person |
| R | respawn after death |
| Esc | release pointer lock |

## World layout (ONE engine world, no scene switches)

```
(0, 0) …………………… Cinderwatch (scene pack, safe zone — no aggro)
   └ gate at z=14 → Ashen Reach wilderness (ring spawner, imp/ashwalker/charred)
        └ cave mouth at (14, 24) — orange portal disc
              ⇅ player teleport (same world!)
(300, 300) …………… Slagdeep Hollow — PCG rooms/corridors, quest + boss,
                   blue return portal at the entry room
```

The dungeon sits past the camera's far plane (200 m), so neither area ever
renders while you're in the other. Teleporting the player avoids the
engine's scene-switch full-rebuild renderer bug entirely.

## File layout

```
hellforge/
  forge.json              — game manifest (id, scenes, default scene)
  main.ts                 — boot, witch rig, camera, input, area/portal/quest glue
  src/
    state.ts              — hp/mana/xp/level/gold + curves
    items.ts              — equipment slots / rarities / affixes / drop rolls
    skills.ts             — SKILLS table + projectile system
    monsters.ts           — MONSTERS bestiary + AI manager
    loot.ts               — drops + magnet pickup
    dungeon-layout.ts     — PURE seeded dungeon generator (bake + runtime share it)
    dungeon.ts            — runtime: baked-pack instantiate + walkability
    hud.ts                — ARPG DOM overlay (orbs / slots / quest / boss bar)
    fx.ts                 — shader registration + particle pools
    shaders/*.wgsl(.meta.json) — fire-bolt / portal-vortex
  assets/characters/witch.glb   — 33-joint skinned sorceress + 5 clips
  assets/monsters/*.glb(.meta.json) — skinned monster rigs (imported via
                            engine cli-gltf; meta.json carries the GUIDs)
  scenes/rogue-encampment.pack.json — camp scene pack (editable)
  scenes/slagdeep-hollow.pack.json  — BAKED dungeon scene (editable; regenerate
                            via `bun scripts/bake-dungeon.ts`)
  tsconfig.check.json     — dev typecheck (needs games/node_modules symlink
                            → editor/packages/play-runtime/node_modules)
```

## Scene authoring

The static camp lives in `scenes/rogue-encampment.pack.json` — the engine's
native scene pack format; ✎ Edit is the WYSIWYG tool for it. Everything
dynamic (hero, monsters, projectiles, loot, the whole PCG dungeon) is
runtime-spawned from `main.ts` + `src/` and never appears in Edit.

## Verify

Play `:15173/preview/?game=hellforge`, Edit `:15280/editor/?game=hellforge`
— wait ~7 s, console must show only the favicon 404. Gameplay probes hang
off `window.__hf` (state / player / monsters / skills / loot / dungeon).

## Roadmap (next)

1. Inventory grid (compare/stash instead of auto-equip)
2. Skill tree allocator (4-school)
3. SFX (WebAudio, cow-survivor's sfx.ts pattern)
4. More characters — paladin / barbarian / necromancer as sibling GLB packs
