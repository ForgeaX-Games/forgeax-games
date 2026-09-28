# Codex + Blender MCP → rain-alley street stand-in

**Date:** 2026-09-05
**Audience:** Codex driving Blender Lab MCP, then a later rain-alley `/implement` that loads the mesh
**Status:** delivered; ticket 19 later completed the game-side instantiation; not a photogrammetry pipeline
**Paste-ready prompt:** [CODEX-PROMPT-street-blockout.md](./CODEX-PROMPT-street-blockout.md)

## Verdict

Do this as three hand-offs, not one magic step.

1. **Generate stills** (any image model Codex has; “image2” here means concept stills, including img2img from a layout sketch). Those stills are **reference planes**, not a mesh.
2. **Model in Blender MCP** a metric, one-street greybox-plus: wet PBR scalars, neon emissive strips, named cover / spawn / collision empties. Official Blender Lab MCP on this machine is proven for primitive massing, not Yakuza cinematic density.
3. **Export glTF/GLB** and cook with Engine v4. Studio Play will **not** show the street until presentation code instantiates the cooked scene (ticket 19). Dropping a file into `assets/` is not a preview.

Blender MCP cannot reconstruct a Hong Kong street from a photo. If the still looks like Kowloon and the mesh is 12 grey boxes with neon strips, that is success for this pass.

## Why this is the right size

- Ticket **15** is closed: cameras, HUD, VFX, and the whitebox body sit behind `RainAlleyPresentation`. The street is still **spawned as boxes in `rain-alley/main.ts` (`buildWhitebox`)**.
- Ticket **19** (“一条湿地雨街”) is the code ticket that deletes the three-room corridor and loads one street mass. Codex should **produce the GLB + sidecar**, not rewrite `main.ts`.
- Tickets **16 / 17 / 18 / 20 / 21** stay gameplay / hero / fight / cameras. Do not block them on this art track, and do not implement them from Blender.

## Machine (already verified 2026-09-05)

| Piece | Fact |
| --- | --- |
| Blender | 5.2.0 LTS at `/Applications/Blender.app/Contents/MacOS/Blender` |
| MCP | Official Blender Lab, `~/.codex/config.toml` server name `blender` → `/Users/you/dev/blender-mcp/.venv/bin/blender-mcp` |
| Bridge | `127.0.0.1:9876`, Auto Start on, Allow Online Access required even for localhost |
| Proven smoke | `blender-mcp/artifacts/building-smoke.blend` — 12 buildings, 15–45 m, Cycles 16 spp. Connectivity only. |
| Codex project trust | `/Users/you/dev/blender-mcp` is `trusted` |
| Heat | Studio Play + Blender Cycles together overheated this Mac. Keep Studio **stopped** until the GLB exists. Do not `pkill`; when Play is needed later: `cd forgeax-studio && bun fx start` (or `restart` if heap changed). |

## Product constraints Codex must keep

Source of truth: [spec.md](../spec.md), glossary [rain-alley/CONTEXT.md](../../../rain-alley/CONTEXT.md), cook path [W05](../wayfinder/research/W05-official-cook-path-v4.md), wet recipe [W13](../wayfinder/issues/W13-wet-rain-recipe.md).

- **One dense Hong Kong rain street, one gunfight.** Shop mouths and interiors are cover / dressing. Do not author alley / kitchen / hall as three combat rooms.
- **Wet Look only:** darker ground roughness (~0.15–0.35), optional metallic, HDR emissive neon, one directional light in-engine later. No puddles, dynamic wetness, SSR, volume fog, point/spot shadows, rain physics.
- **Engine v4 only.** Source `.glb` / `.gltf` + sibling `.meta.json`. Fail closed on mesh-bin v3. No FBX-first path. No FPS Gym HTML blobs.
- **Stand-in legal.** Fastest mesh that reads as a wet street wins. License pass is later. Do not buy assets. Do not copy Hellforge as the product street.
- **Units:** 1 Blender metre = 1 game metre. Character joint centimetre-space (W10) does **not** apply to the street.
- **Playable envelope** (current whitebox, to be retuned onto one street — keep the *mass*, not the three rooms):

  | Thing | Approx |
  | --- | --- |
  | Walkable width | ~6 m |
  | Player spawn | `(0, 0.88, 8)` looking down −Z |
  | Curb hop | 0.35 m high, Space-only |
  | Player capsule | radius 0.38, half-height 0.5 |
  | Cover blocks | ~1.1 × 1.7 × 1.1 m |
  | Street length target | 40–60 m of *one* route, not a city tile |

The 12-tower smoke test (15–45 m towers on an 80 m plaza) is **the wrong scale**. Rebuild; do not reuse that scene as the street.

## Named contract in the .blend

Collections (exact names):

| Collection | What |
| --- | --- |
| `VISUAL` | Rendered street, shops, neon, curb, ground |
| `COLLISION` | Simple boxes only. Prefix `COL_`. These inform later SightBlockers; they are not auto-imported as physics today |
| `COVER` | Peek / doorway masses the fight will use |
| `SPAWN` | Empties: `SPAWN_Player`, `SPAWN_Talker`, `SPAWN_Photo`, peekers `SPAWN_Peeker_01`… |
| `REF` | Image empties for the concept stills; **exclude from GLB export** |

Object origins on the ground plane. Apply scale before export. Do not export lights, cameras, or `REF`.

## Image stills (step 1)

Generate and save under `blender-mcp/artifacts/rain-alley-ref/` (create the folder):

1. Over-shoulder night: wet asphalt, neon signs, one shop mouth as cover, no cinematic fog volume
2. Same street, opposite direction
3. Top-down / slightly ortho layout of **one** 40–60 m corridor with 6 m width and 4–6 cover pockets
4. Detail: doorway + curb (35 cm) + neon strip

Use the stills as Blender reference images on `REF`. Do not run photogrammetry, voxel remesh-from-photo, or Meshy image-to-3D for the *street* in this pass (character Meshy is ticket 18, different conversation).

## Blender MCP loop (step 2)

1. Open Blender; confirm Preferences → Add-ons → MCP → Server is running.
2. In Codex, use the `blender` MCP server (`execute_blender_code`, screenshots, optional EEVEE thumbnail — prefer EEVEE over Cycles on this machine).
3. New scene `RainAlleyStreet`, metric, scale_length 1.0.
4. Build the street from boxes / arrayed facades. Principled BSDF only. Ground roughness low; neon via Emission on separate strips.
5. Screenshot vs stills; iterate massing, not shader graphs.
6. Save `.blend` to `blender-mcp/artifacts/rain-alley-street.blend` (do not overwrite `building-smoke.blend`).

`execute_blender_code` scripts must assign `result = {...}` so the client can read bounds, object counts, and export path.

## Export + cook (step 3)

Export (from Blender Python, not the UI click-path):

```python
bpy.ops.export_scene.gltf(
    filepath=export_path,  # .../rain-alley/assets/street/street.glb
    export_format='GLB',
    use_selection=False,
    use_visible=True,
    export_apply=True,
    export_cameras=False,
    export_extras=True,
    export_yup=True,
)
```

Hide `REF` before export. Prefer exporting only `VISUAL` + `COVER` + `SPAWN` empties if collision boxes pollute the look; keep `COLLISION` in the `.blend` even if omitted from the first GLB.

Then, from a shell that has the Studio-pinned engine CLI on PATH (Studio `packages/editor` / engine workspace, **not** a random npm gltf-transform):

```bash
# write / reuse sibling street.glb.meta.json
forgeax-engine-remote-gltf import rain-alley/assets/street/street.glb
```

Game already declares `"forgeax.assets.roots": ["assets"]` in `rain-alley/package.json`. `forge.json` `defaultScene` currently points at an empty `RainAlleyRoot` pack (`assets/scene.pack.json`) — do not replace that GUID casually; ticket 19 decides how the street scene is instantiated.

Studio activation reminder (W10): the game must already be `POST /api/projects/link` + `PUT /api/projects/active`. A handmade `.forgeax/games` symlink 404s.

## What Codex must not do

- Edit `rain-alley/src/rules.ts` or grow a generic AI framework
- Delete `buildWhitebox` / change spawn combat in `main.ts` (that is ticket 19 in a Cursor `/implement` session)
- Enable Engine fps / gate / bench metrics
- Import mesh-bin v3 or Gym cooked blobs
- Start Studio Play while Blender is rendering
- Treat Hellforge `charactery` as the street or the product hero
- Author three combat rooms “to match the current whitebox route”

## Done when

- [x] Four reference stills on disk under `blender-mcp/artifacts/rain-alley-ref/`
- [x] `rain-alley-street.blend` saved; collections named as above; bounds ~6 m wide × 40–60 m long × buildings ≤ ~12 m
- [x] `rain-alley/assets/street/street.glb` + `street.glb.meta.json` exist (`importer: "gltf"`)
- [x] A written bounds dump (`result` JSON or a short `export-result.json`) lists player spawn empty at roughly `(0, 0, 8)` in Blender XY with Z-up → glTF Y-up accounted for
- [x] The art session stopped before wiring `loadByGuid`; a later ticket 19 implementation performed the separate `/implement` and Play verification.

## Handoff back to Cursor

When the GLB exists, tell Cursor: implement ticket 19 using `assets/street/street.glb` as the Presentation street mass; keep Rules kernel; replace `buildWhitebox` corridor; map `COVER` / `SPAWN` to SightBlockers and peek points; Wet Look via existing PBR, no puddles.

## Delivery update (2026-09-05)

The art handoff above is complete. Cursor later implemented ticket 19 in the game worktree: the street scene is instantiated from the stable scene GUID, the old corridor is gone, and the 74 collision proxies are installed in the runtime. The verified cook and Play run used the isolated Studio worktree `forgeax-studio/.worktrees/rain-alley-play` with Engine `743b773` and `mesh-binary/4`; screenshots are in `../evidence/ticket-19/`. The original “do not wire/load in this art session” constraint remains a historical boundary for this document, not a claim that ticket 19 is still pending.
