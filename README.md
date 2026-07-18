# ForgeaX Studio — forgeax-games

[English](./README.md) · [简体中文](./README.zh-CN.md) · [↑ studio](https://github.com/ForgeaX-Games/forgeax-studio)

> **The shared library of real, playable games — authored by the Forge agent, run by the real engine.**

`forgeax-games` is a standalone library of complete game projects that the ForgeaX engine can
discover, load, play, and edit. These are not hand-waved "examples": each is a full source
tree — `src/`, packed `assets/`, `scenes/`, custom `shaders/` — and most were written **by the
Forge AI agent inside Studio**, then committed here verbatim. They are the proof that the
chat-to-game loop produces something you can actually ship.

## Why it matters

A game here is exactly what the editor edits and the build pipeline packages — same files, same
`forge.json` contract, same engine. So a game runs **identically in Play and Edit**, and what
the agent authored is what you get. The library doubles as the engine's living regression suite:
it spans the difficulty range from a 30-line spinner to full 3D physics shooters.

## The `forge.json` contract

Every game is anchored by a single manifest, `forge.json` — the authoritative,
schema-validated description the engine, editor, build, and launcher all read (the schema lives
in `@forgeax/engine-project`). Minimal shape:

```json
{ "id": "fps", "name": "Sector Strike", "schemaVersion": "1.0.0",
  "entry": "main.ts", "pointerLock": true, "physics": "3d" }
```

- `id` is the slug (`^[a-z0-9][a-z0-9-]{1,40}$`) and is the directory name.
- `entry` points at the game's code entry (`main.ts` or `src/main.ts`).
- Optional gates like `physics: "3d"` and `pointerLock` are read by the host, not re-implemented
  per game.

`forge.json` is also the **discovery guard**: the launcher only wires up directories that
contain one. READMEs, scripts, and tooling dirs are skipped automatically.

## How discovery & isolation work

- **Disk is the source of truth.** Games live as version-controlled source under
  `packages/games/<slug>/`. At startup the launcher idempotently symlinks each
  `forge.json`-bearing directory into `.forgeax/games/<slug>/`, where the engine's discovery
  chain (`listAllGames` / `detectActiveSlug`) finds it with zero registration.
- **Safe by design.** Deleting a game from the Studio UI removes only the
  `.forgeax/games/<slug>` symlink — the real, version-controlled source is never touched. To
  truly remove a game you `git rm` it here and push.
- **No cross-game collisions.** Per-game pack-index isolation lets two games that share asset
  GUIDs coexist without the global asset catalog collapsing — so copies and variants are safe.

## The roster

| slug | name | shape |
|:--|:--|:--|
| `spin-cube` | spin-cube | the minimal "does it render" smoke game |
| `fps` | Sector Strike | first-person shooter, pointer-lock |
| `cow-survivor` | Cow-Level Survivor | 3D physics survivor, packed monsters/effects/characters |
| `hellforge` | ForgeaX: Hellforge | 3D physics action game |
| `shoot-opt` | shoot-opt | full shooter scaffold (76 sub-materials sharing one PBR parent) |

## Add a game (the recipe)

1. Create `<slug>/` (slug matches `^[a-z0-9][a-z0-9-]{1,40}$`).
2. Add the scaffold: a `forge.json` (required), `package.json`
   (`@forgeax/game-<slug>`), `tsconfig.json`, the code entry, an `assets/` pack, and an
   optional `FORGE.md` design note.
3. Commit + push here, then on the studio side
   `git submodule update --remote packages/games` and start — the launcher symlinks it in.

> First checkout must run `git submodule update --init packages/games`, or the library is empty
> and the launcher gracefully skips every game.

---

Part of the **ForgeaX Studio** monorepo. This repo is a submodule of
[`ForgeaX-Games/forgeax-studio`](https://github.com/ForgeaX-Games/forgeax-studio) — clone that
with `--recurse-submodules` to run the full studio. License: Apache-2.0.
