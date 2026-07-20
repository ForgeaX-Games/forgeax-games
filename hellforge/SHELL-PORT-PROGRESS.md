# SHELL port progress — handoff

> SSOT design: [`SHELL-AND-UI-PORT-SPEC.md`](./SHELL-AND-UI-PORT-SPEC.md) §6.
> Product SSOT for the vertical slice: [`ARPG-VERTICAL-SLICE-SPEC.md`](./ARPG-VERTICAL-SLICE-SPEC.md).
> This file tracks **where we are** and **the next cut**. Update on each slice.
>
> **2026-07-15 stabilization: ACCEPTED for shell/boot gates below.**
> Evidence + SHAs: parent worktree
> `docs/handoff/2026-07-15-hellforge-stabilization.md`.
>
> **2026-07-17 M6 code signoff:** HUD / character panel / showcase camera landed
> in unit tests. **Browser acceptance still pending human** (no screenshots
> invented). Audio M5.3–5.4 remains blocked on provenance.

## Status vs SPEC §6

| # | Phase | Status | Notes |
|---|---|---|---|
| 1 | Data contract (`classes` / `heroes` / `heroId`) | ✅ slice | Sorceress domain + CombatStats; other classes UI-disabled |
| 2 | Pure UI ports (KeyBindings / BuffIcons / BuffDisplay / CubeUI) | 🟡 source only | BuffDisplay/CubeUI/KeyBindings remain unwired |
| 3 | Shell skeleton (ShellManager + Title) | ✅ accepted | Title mounts before heavy runtime; clicks stay inside uiRoot |
| 4 | CharSelect / CharList + preview camera | ✅ accepted | One-shot gate; selected `CharacterRecord` owns runtime hero bind |
| 5 | HUD redo (`HudViewModel` + D2 layout) | ✅ code | Globes / skill bar / XP / target / C sheet / showcase reduced HUD — **browser pending** |
| 6 | Automap / SkillTree / Quest / Dialogue | ✅ code | Den automap + 15-node tree + Q log + Veyra dialogue — **browser pending** |
| 7 | Camp showcase camera | ✅ code | Spring-arm probe + 400 ms blend + RMB orbit — **browser pending** |

## Stabilization acceptance gate (2026-07-15)

Passed in browser (Studio Play, warm cache):

1. Title before hero/dungeon/monster init; clickable.
2. Character hand-off selects hero before runtime boot.
3. Camp + hero render; no purple-cylinder core fallback.
4. Invalid hero scene GUID → `#hellforge-fatal-boot` (injection restored, not committed).
5. New / Continue / Back / double-Enter paths OK; Stop clears shell/HUD from uiRoot.
6. Viewport loading overlay not held by Studio API pollers after assets quiet.

## Milestone 6 / vertical-slice gates (2026-07-17)

| Gate | Status |
|---|---|
| `bun test hellforge/src` | Pass at signoff |
| Scene pack validate (camp) | Run at signoff |
| Audio manifest verifier | **Not claimed** — M5.3–5.4 blocked |
| Fresh Sorceress walkthrough 1920×1080 | **Pending human** |
| Repeat at 1280×720 | **Pending human** |
| Death / quest reload / skill fixture browser | **Pending human** |

### Audio block (M5.3–5.4) — why

- No licensed production OGG (or equivalent) SFX pack is in-tree.
- `assets/music/README.md` labels BGM with Metaphor OST-style titles
  (`Desecrated Cathedral`, `Priestess of the Temple`) without a cleared
  provenance record. Do **not** invent licenses or claim audio gates pass.
- Combat feedback continues to use synthesized WebAudio (`src/sfx.ts`).

## Hot-path note (phase 5)

SPEC says “assemble HudViewModel each frame”. hellforge keeps **discrete setters**
(`setOrbs` / `setSkills` / …) as the 60 Hz path with dirty checks; `HudViewModel` +
`apply()` exist for batch hand-off (e.g. enter game). Feeding `apply()` every frame
would force equipment-chip rebuilds — worse than the current split.

## uiRoot / viewport contract (must keep)

- Mount all overlays on `ctx.uiRoot ?? document.body`
- `mount !== body` → `position:absolute;inset:0` (editor `.ep-viewport-root`)
- `mount === body` → `position:fixed` (preview fallback)
- Interactive nodes: `pointer-events:auto`
- Never mutate host `#game-ui-root` `pointer-events`
- floatText coords = canvas-local (== mount-local when uiRoot matches viewport)
- Major panels own exclusivity via `UiLayerManager` only

## Deliberate deviations

- Automap top-down (not full isometric world): only den has tiles
- BuffDisplay / CubeUI / KeyBindings remain orphan until gameplay callers exist
- No Settings on Title (F10)
- No true FPS camera mode in this slice

## Don't

- Don't use `position:fixed` on uiRoot-mounted overlays
- Don't port aidiablo procedural class models
- Don't claim direct 1–4 cast, auto quest reward, or shallow-save gameplay authority
- Don't invent Blizzard-owned world terms or audio provenance
- Don't resurrect purple-cylinder as a “successful” hero boot
