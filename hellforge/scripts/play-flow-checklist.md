# Hellforge PR 0 — Scripted Studio Play Flow Checklist

> Drive **real** Studio Play on `http://localhost:18920` via
> `forgeax-editor-gateway` (or Playwright MCP). Do **not** use `:15173` curl
> or the editor viewport as a substitute.
>
> Warm-up: open Hellforge once and wait for first compile. Never reload via
> `iframe.location.reload()`.

## Preconditions

- [ ] `bun fx start` healthy (`:18900` / `:18920` / `:15173`)
- [ ] Gateway / browser can evaluate inside the Play iframe
- [ ] Fresh character (or wipe local saves for a clean run)

## Flow A — Fresh save end-to-end (run twice)

1. Open Studio → Hellforge → ▶ Play.
2. Title → New Game → confirm Sorceress → enter camp.
3. Camp intro cutscene: assert `__hf.uiLayers.active() === 'cutscene'`.
4. While cutscene: press `B` / `K` / `C` / `Q` / `F10` / `Tab` — active stays
   `'cutscene'`; world input still blocked. `Esc` skips; active becomes `null`.
5. Accept Veyra quest → leave to Ashen Reach → fight ≥1 pack.
6. Enter Slagdeep Hollow → reach boss room → defeat boss (or skip with dev
   tools only if documenting a partial evidence pass).
7. Return to camp → turn in → reload character; progression persists.
8. Archive checklist log for this pass.

## Flow B — Stop→Play owner assertion (×3)

1. With an in-game session, evaluate:
   `window.__hf.assertSingleOwners()` → `{ ok: true }`.
2. Studio ■ Stop, then ▶ Play again (same or fresh character).
3. After in-game, re-run `assertSingleOwners()` → ok.
4. Repeat Stop→Play three times total; every cycle ok.

## Flow C — Potion / death copy spot checks

1. Fill HP → press `5` → banner 「生命已满」; stock unchanged
   (`__hf.character.snapshot().potions`).
2. Die → death overlay says 「无经验惩罚」 (not 「损失少量经验」).

## Flow D — Perf + golden views

1. `__hf.perf.reset()` then play 60s; dump `__hf.perf.snapshot()` at 1920×1080
   and 1280×720 (before and after one Stop→Play).
2. Capture golden views: camp / wilderness / dungeon entrance / normal combat /
   boss room.
3. Capture ≥30s continuous combat video.
4. Record paths in `docs/evidence/pr0/INDEX.md`.

## Pass criteria

- Flow A completed **twice** with logs.
- Flow B: three consecutive Stop→Play cycles with `assertSingleOwners().ok`.
- Flow C + D archived; mountain-ring wilderness/den view no longer shows a
  triangular mountain intrusion on the den floor.
