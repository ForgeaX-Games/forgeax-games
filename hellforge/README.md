# ForgeaX: Hellforge

An original dark-fantasy action RPG sample on the forgeax engine. The dying
embers of a great Hellforge corrupt the land. UI layout is D2R-*inspired*
(visual language only — no Blizzard assets or owned world terms).

## Pitch

You play a female **Sorceress** in an Act-1 vertical slice: spawn in **余烬哨站
Cinderwatch**, accept a quest from 烬守者维拉, cross **灰烬荒原 Ashen Reach**,
cast tree-resolved skills (magma / frost / arc / phase-step), loot and level,
then clear **熔渣深窟 Slagdeep Hollow** and turn the quest in for a frost wand.
Default combat camera is fixed isometric (`arpg`); **V** toggles a camp-only
non-combat showcase with spring-arm collision (~400 ms blend).

## Status (2026-07-17) — Sorceress ARPG vertical slice (code-complete)

Code milestones M1–M4 and M5.1–5.2 + M6.1–6.2 are on this branch. **Browser
acceptance and licensed audio remain open human gates** — see Open gates.

- [x] Domain save (`CharacterDomain` envelope), derived `CombatStats`, damage
- [x] Point-and-click + WASD movement intent; UiLayerManager panel ownership
- [x] ARPG camera rig + camp showcase (probe / orbit / blend)
- [x] Three-branch Sorceress skill tree (15 nodes) + hotbar select (1–4)
- [x] Quest / dialogue (Veyra) — rewards on turn-in, not auto-grant
- [x] Hybrid areas: Cinderwatch → Ashen Reach → Slagdeep
- [x] Frost Fang shader VFX language (M5.1–5.2)
- [x] D2R-inspired HUD: globes, skill bar, XP, quest tracker, automap, **C**
      character sheet from `CombatStats`, target name/level/HP
- [ ] Browser walkthrough at 1920×1080 and 1280×720 (human)
- [ ] M5.3–5.4 licensed SFX + provenanced BGM (blocked — see below)

## Controls

| input | action |
|---|---|
| WASD | move · Shift sprint (cancels click path / pursuit) |
| Mouse | aim — isometric ground cursor · showcase: look |
| Left-click | ground → path; enemy → pursue + Frost Fang; npc/loot/exit → interact |
| Right-click | cast selected hotbar skill · showcase: drag orbit |
| 1 / 2 / 3 / 4 | **select** hotbar slot only (do not cast) |
| B / I | inventory |
| K | skill tree |
| C | character / combat-stat sheet |
| Q | quest log |
| Tab | den automap |
| V | camp-only showcase toggle (combat / loot / entrance off) |
| R | respawn after death (camp; progression kept) |
| F10 | render-settings panel |
| Esc | close major panels / automap |

## Open gates

1. **Browser acceptance pending human** — this request skipped interactive
   playtesting. Do not invent screenshots or claim SPEC §15 walkthroughs.
2. **Audio provenance M5.3–5.4 blocked**
   - No licensed OGG (or equivalent) production SFX pack is checked in.
   - Existing BGM under `assets/music/` is documented with Metaphor OST-style
     titles and has **no cleared provenance**; do not invent licenses or claim
     `verify-audio-manifest` passes.
   - Runtime combat bed remains synthesized WebAudio (`src/sfx.ts`).

## Verify (static)

```bash
cd packages/games
bun test hellforge/src
bun hellforge/scripts/validate-scene-pack.ts hellforge/assets/scenes/rogue-encampment.pack.json
bun hellforge/scripts/validate-blocker-prop-consistency.ts
```

`validate-blocker-prop-consistency` compares camp obstacle AABBs to pack prop
footprints (unit-cube × transform) — **camp is the hard L2 gate**. Wild
(`ashen-reach.layout.json`) is **layout-internal only by design for PR1** (no
companion pack / prop match). Optional named exceptions live in
`assets/scenes/blocker-prop-allowlist.json` (empty by default).

Do **not** cite `bun fx check` or `ONLY=hellforge bun scripts/website/build-games.mjs`
as Hellforge source gates (see SPEC / plan notes).

## World layout

```
(0, 0) …………………… Cinderwatch (scene pack, safe zone)
   └ gate → Ashen Reach wilderness
        └ cave mouth → Slagdeep Hollow (PCG, quest + boss) @ (300, 300)
```

## Spec / plan

- [`ARPG-VERTICAL-SLICE-SPEC.md`](./ARPG-VERTICAL-SLICE-SPEC.md)
- [`ARPG-VERTICAL-SLICE-PLAN.md`](./ARPG-VERTICAL-SLICE-PLAN.md)
- [`PLAY_EXPERIENCE.md`](./PLAY_EXPERIENCE.md)
- [`AGENTS.md`](./AGENTS.md)
