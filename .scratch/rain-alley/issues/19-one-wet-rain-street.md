# 19 — 一条湿地雨街

**What to build:** The player walks one dense Hong Kong rain street. The generated alley / kitchen / hall corridor is gone. Shop mouths and interiors are cover and set dressing, not extra combat rooms. Wet Look is static wet roughness plus emissive neon and one directional shadow. No puddles, reflections, volume fog, or point-light shadows.

**Blocked by:** 15 — Presentation 接缝预整; 17 — 一条街规则 + 调查 / 态度 / 战后

**Parallel art (does not unblock this ticket):** Codex + Blender MCP can produce a stand-in street GLB while this ticket waits on 17. Handoff: [2026-09-05-codex-blender-street.md](../handoff/2026-09-05-codex-blender-street.md). That track must not rewrite `main.ts`; this ticket is still the one that instantiates the cooked scene and deletes the three-room Whitebox corridor.

**Status:** closed

**Parent:** [Vertical Slice spec](../spec.md)

- [x] Play has one street mass the player can walk; the three-room Whitebox route is gone
- [x] Doorways read as cover / dressing, not as loading a second combat map
- [x] Materials read wet and neon without dynamic wetness, SSR, or volume fog

## Resolution

Street v2 is instantiated in Studio Play from scene GUID
`01a07151-c0b9-7f76-98c2-74fa89da409d`. The three-room Whitebox corridor is
gone. Shop mouths are cover / shutters on one 50 m street. Wet Look is static
materials plus neon emissive and one directional + skylight.

Official cook was done on the isolated Studio worktree
`forgeax-studio/.worktrees/rain-alley-play` (engine `743b773`, importer
`mesh-binary/4`). Studio **main** pin `c37d87a` still cooks `mesh-binary/3` and
was not used or bumped.

Sidecar had three colliding material GUIDs (WarmWindow_* sharing IDs with
AwningPetrol / NeonCyan / StreetPaintOchre). Those three second materials were
reminted with `AssetGuid.random()`; the scene GUID was left unchanged.
`forgeax-engine-remote-asset verify` then passed (`material-validated: 21`).
The cooked street pack lists 68 meshes as `mesh-binary/4`; COVER_01 `body.bin`
header uint32 LE is `4`.

Play evidence: `.scratch/rain-alley/evidence/ticket-19/`.

Ticket 17 is still open. This ticket remapped the existing alley / kitchen /
hall fixtures onto one street and did not add Investigation / Attitude /
Aftermath.
