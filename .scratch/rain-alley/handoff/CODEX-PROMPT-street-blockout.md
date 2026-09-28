You are an art-track agent (Codex or equivalent) handing off from Cursor.

Goal: generate Hong Kong rain-night concept stills, then drive the already-installed Blender Lab MCP to model a **playable stand-in street** for the ForgeaX game `rain-alley` (display name 《雨夜不回头》), then export Engine-v4 glTF. You do **not** wire the mesh into Play. You do **not** edit gameplay code.

Read these files in this order (absolute paths):

1. `/Users/you/dev/ForgeaX-Games/forgeax-games/.worktrees/laurenceelu-feat-20260903-rain-alley/.scratch/rain-alley/handoff/2026-09-05-codex-blender-street.md`
2. `/Users/you/dev/ForgeaX-Games/forgeax-games/.worktrees/laurenceelu-feat-20260903-rain-alley/.scratch/rain-alley/spec.md`
3. `/Users/you/dev/ForgeaX-Games/forgeax-games/.worktrees/laurenceelu-feat-20260903-rain-alley/rain-alley/CONTEXT.md`
4. `/Users/you/dev/blender-mcp/README.md`
5. `/Users/you/dev/ForgeaX-Games/forgeax-games/.worktrees/laurenceelu-feat-20260903-rain-alley/.scratch/rain-alley/wayfinder/issues/W13-wet-rain-recipe.md`
6. `/Users/you/dev/ForgeaX-Games/forgeax-games/.worktrees/laurenceelu-feat-20260903-rain-alley/.scratch/rain-alley/wayfinder/research/W05-official-cook-path-v4.md`
7. `/Users/you/dev/ForgeaX-Games/forgeax-games/.worktrees/laurenceelu-feat-20260903-rain-alley/.scratch/rain-alley/issues/19-one-wet-rain-street.md`

## Machine (verified 2026-09-05)

- Blender 5.2.0 LTS: `/Applications/Blender.app/Contents/MacOS/Blender`
- Official Blender Lab MCP (not community `uvx blender-mcp`)
- Codex MCP server name: `blender`
- MCP binary: `/Users/you/dev/blender-mcp/.venv/bin/blender-mcp`
- Codex config: `/Users/you/.codex/config.toml` (`[mcp_servers.blender]`, host `127.0.0.1`, port `9876`, `tool_timeout_sec = 360`)
- Bridge: `127.0.0.1:9876` — Blender must be open; Add-on MCP Auto Start; System → Network → Allow Online Access
- Proven smoke (wrong scale for this job): `/Users/you/dev/blender-mcp/artifacts/building-smoke.blend`
- Codex trust: `/Users/you/dev/blender-mcp` is trusted
- Studio Play is currently **stopped** on purpose (machine overheat). Do not start `:18900` / `:18920` / `:15173` in this session. Prefer EEVEE / viewport screenshots over Cycles.

## Product facts

- Game root: `/Users/you/dev/ForgeaX-Games/forgeax-games/.worktrees/laurenceelu-feat-20260903-rain-alley/rain-alley`
- Bootstrap still builds the street as boxes in `buildWhitebox` inside `/Users/you/dev/ForgeaX-Games/forgeax-games/.worktrees/laurenceelu-feat-20260903-rain-alley/rain-alley/main.ts`
- Presentation adapter: `/Users/you/dev/ForgeaX-Games/forgeax-games/.worktrees/laurenceelu-feat-20260903-rain-alley/rain-alley/src/presentation.ts` (ticket 15 closed)
- Asset roots already declared in `rain-alley/package.json` → `forgeax.assets.roots = ["assets"]`
- Empty default scene pack (do not casually replace its GUID): `/Users/you/dev/ForgeaX-Games/forgeax-games/.worktrees/laurenceelu-feat-20260903-rain-alley/rain-alley/assets/scene.pack.json`
- `forge.json`: `/Users/you/dev/ForgeaX-Games/forgeax-games/.worktrees/laurenceelu-feat-20260903-rain-alley/rain-alley/forge.json`

Constraints from spec/W13/W05:

- One dense Hong Kong rain street, one gunfight. Shop mouths = cover/dressing, not extra combat rooms. Do not rebuild alley / kitchen / hall as three maps.
- Wet Look: static low roughness + optional metallic + emissive neon. No puddles, dynamic wetness, SSR, volume fog, point/spot shadows, rain physics.
- Engine v4 only: source `.glb`/`.gltf` + sibling `.meta.json` via `forgeax-engine-remote-gltf import`, then Vite `pluginPack`. Fail closed on mesh-bin v3. No FBX-first. No FPS Gym HTML blobs.
- 1 Blender metre = 1 game metre. W10 centimetre joint-space is for the hero rig, not this street.
- Playable envelope: walkable width ~6 m; player spawn ~`(0, 0.88, 8)` looking −Z; curb 0.35 m; capsule radius 0.38 / half-height 0.5; street length 40–60 m; building height ≤ ~12 m.
- Do not reuse `building-smoke.blend` (15–45 m towers on an 80 m plaza).

## Job

1. Generate 4 concept stills (text-to-image or img2img). Save under `/Users/you/dev/blender-mcp/artifacts/rain-alley-ref/`
   - over-shoulder wet neon street, shop mouth as cover
   - same street, opposite direction
   - top-down / slight-ortho layout of **one** 40–60 m × ~6 m corridor with 4–6 cover pockets
   - doorway + 35 cm curb + neon strip
   Stills are Blender reference planes only. Do **not** photogrammetry, voxel-remesh-from-photo, or Meshy image-to-3D the street.

2. Confirm Blender MCP (`get_objects_summary` or equivalent). New scene named `RainAlleyStreet`, metric, `scale_length = 1.0`.

3. Model the street with boxes / arrayed facades. Principled BSDF only. Ground roughness ~0.15–0.35. Neon = Emission strips. Collections with these **exact** names:
   - `VISUAL` — rendered street
   - `COLLISION` — simple boxes, prefix `COL_`
   - `COVER` — peek / doorway masses
   - `SPAWN` — empties: `SPAWN_Player`, `SPAWN_Talker`, `SPAWN_Photo`, `SPAWN_Peeker_01`…
   - `REF` — image empties; **exclude from GLB**

4. Save `/Users/you/dev/blender-mcp/artifacts/rain-alley-street.blend` (do not overwrite `building-smoke.blend`). `execute_blender_code` scripts must set `result = {...}` with bounds and counts.

5. Hide `REF`. Export GLB:

```
filepath = /Users/you/dev/ForgeaX-Games/forgeax-games/.worktrees/laurenceelu-feat-20260903-rain-alley/rain-alley/assets/street/street.glb
export_format='GLB', export_apply=True, export_cameras=False, export_yup=True, export_extras=True
```

Create the `street` directory if needed. If `forgeax-engine-remote-gltf` is on PATH, run:
`forgeax-engine-remote-gltf import` on that GLB to write `street.glb.meta.json`. If not on PATH, stop after the GLB and report that.

6. Write `/Users/you/dev/blender-mcp/artifacts/rain-alley-street-export.json` with object counts, world bounds in metres, spawn empty positions, export path, and whether the sidecar was written.

## Hard stops

- Do not edit `rain-alley/main.ts`, `rain-alley/src/rules.ts`, `rain-alley/src/presentation.ts`, or any Hellforge files.
- Do not `loadByGuid` / instantiate in the engine. Dropping a GLB into `assets/` is not Play.
- Do not start Studio. Do not enable Engine fps/gate/bench metrics.
- Do not copy FPS Gym or Hellforge as the product street.
- Do not implement tickets 16, 17, 18, 20, 21.

## Done when

- 4 stills on disk under `rain-alley-ref/`
- `rain-alley-street.blend` saved with the named collections
- `street.glb` exists at the export path above (sidecar if CLI available)
- `rain-alley-street-export.json` written
- You stop and report those absolute paths. Engine preview is a later Cursor `/implement` on ticket 19.
