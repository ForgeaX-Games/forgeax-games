# SHELL port progress — handoff

> SSOT design: [`SHELL-AND-UI-PORT-SPEC.md`](./SHELL-AND-UI-PORT-SPEC.md) §6.
> This file tracks **where we are** and **the next cut**. Update on each slice.
>
> **2026-07-15 stabilization: ACCEPTED for shell/boot gates below.**
> Evidence + SHAs: parent worktree
> `docs/handoff/2026-07-15-hellforge-stabilization.md`.

## Status vs SPEC §6

| # | Phase | Status | Notes |
|---|---|---|---|
| 1 | Data contract (`classes` / `heroes` / `heroId`) | 🟡 contract only | HP/mana flow; damage/defense/attack-speed semantics are not wired |
| 2 | Pure UI ports (KeyBindings / BuffIcons / BuffDisplay / CubeUI) | 🟡 source only | BuffDisplay/CubeUI/KeyBindings remain unwired |
| 3 | Shell skeleton (ShellManager + Title) | ✅ accepted | Title mounts before heavy runtime; clicks stay inside uiRoot |
| 4 | CharSelect / CharList + preview camera | ✅ accepted | One-shot gate; selected `CharacterRecord` owns runtime hero bind |
| 5 | HUD redo (`HudViewModel` + D2 layout) | ✅ accepted | Continue/NewGame → camp + HUD + WASD verified 2026-07-15 |
| 6 | Automap / SkillTree | 🟡 adapted | Den automap + skill sheet exist; deep combat wiring still follow-up |

## Stabilization acceptance gate (2026-07-15)

Passed in browser (Studio Play, warm cache):

1. Title before hero/dungeon/monster init; clickable.
2. Character hand-off selects hero before runtime boot.
3. Camp + hero render; no purple-cylinder core fallback.
4. Invalid hero scene GUID → `#hellforge-fatal-boot` (injection restored, not committed).
5. New / Continue / Back / double-Enter paths OK; Stop clears shell/HUD from uiRoot.
6. Viewport loading overlay not held by Studio API pollers after assets quiet.

Still follow-up (not claimed):

- KeyBindings / BuffDisplay / CubeUI combat wiring
- Full class damage/defense/attack-speed semantics
- Title Settings route
- Den launcher mode browser re-verify this session (code path retained)
- Real `/__pack/scan-done` producer + DDC zero-byte product fix (platform)

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

## Deliberate deviations

- SkillTree → skill sheet: hellforge has no synergies/prereqs/skill-points schema
- Automap top-down (not full isometric world): only den has tiles
- BuffDisplay / CubeUI / KeyBindings remain orphan until gameplay callers exist
- No Settings on Title (F10)

## Don't

- Don't use `position:fixed` on uiRoot-mounted overlays
- Don't port aidiablo procedural class models or invent a talent tree
- Don't wire `KeyBindings.matches()` without resolving `e.key` vs `e.code`
- Don't resurrect purple-cylinder as a “successful” hero boot
