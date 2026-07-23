# Hellforge Boss antechamber kit

Minimum modular set for PR1 quality-room assembly (T3). Paths are stable —
Meshy / `wb-ai-asset` swaps overwrite the same `modules/<id>.glb` files.

## Modules (2 m grid language)

| id | footprint (authored) | role |
|---|---|---|
| `kit-floor` | 2×2×0.12 m slab, top at y=0 | floor tile |
| `kit-wall` | 2×3.2×0.35 m | wall run |
| `kit-corner` | L corner | wall corner |
| `kit-doorframe` | ~2.2 m wide opening | door / portal |
| `kit-pillar` | ~0.56×3.4×0.56 m | support |
| `kit-trim` | 2×0.18×0.44 m ledge | cornice / trim |
| `kit-rubble` | low pile | rubble / decals |

## Material conventions (L4 fallback — Track A importer gaps)

While the engine glTF bridge only maps baseColor / metallic-roughness / normal
(and drops MASK), kit modules must follow these bake rules:

| Slot | Rule |
|---|---|
| **Albedo** | Opaque baseColor texture required. **Bake AO into albedo** (no reliance on `occlusionTexture`). |
| **Normal** | Optional but preferred; OpenGL-style tangent-space. |
| **Metallic-Roughness** | Factors and/or MR texture OK; keep metal low / rough high for ash stone. |
| **Baked AO** | Encoded in albedo darkening — do **not** ship a separate occlusion map for fidelity. |
| **Decals** | Mesh-based rubble / trim only; no MASK cutout decal sheets. |
| **Tangents** | **Required** whenever `normalTexture` is present (MikkTSpace, `VertexLayout.SEPARATE` — see `bake-prop-tangents.ts` / kit bake). |
| **Emissive** | **No `emissiveTexture`** in glTF. Glow (if any) via runtime `Materials.standard` factor at spawn. |

### L4 omissions (name in golden-shot notes)

- **No MASK / alphaCutoff** foliage or cutouts (importer collapses to opaque).
- **No emissive textures** from glTF.
- Do not rely on `doubleSided` or occlusion-from-glTF.
- When Track A material merges later, a follow-up may re-bake for full fidelity.

## Texel density gate

Mechanical report (not prose):

```bash
cd packages/games/hellforge
bun scripts/report-kit-texel-density.ts
```

- Formula: per-triangle `sqrt((texW×texH×uvArea)/worldArea)` px/m; module =
  world-area-weighted mean using albedo resolution (see script header).
- **Band (Meshy L1 kit):** **64–768 px/m** inclusive (Meshy 2048² albedo ≈ 440–730 px/m; interim procedural was ~64–256).
- Fails nonzero if any module is outside the band or missing tangents when
  normals are present.
- Checked-in report: [`texel-density-report.json`](./texel-density-report.json).

Interim procedural set uses 128² albedo/normal on ~2 m faces (weighted density
lands ~80–190 px/m across modules). Meshy swaps must stay in-band.

## Provenance

SSOT: [`provenance.json`](./provenance.json).

Every module row: `path`, `sha256`, `source`, `license`, `attribution`,
`intendedUse`, plus Meshy fields (`provider`, `jobId`, `prompt`, `exportTime`)
when applicable.

| `source` | meaning |
|---|---|
| `hellforge-authored-modular` | Team-owned interim geometry (`meshySwapEligible: true`) |
| `wb-ai-asset/meshy` | Cleared Meshy export (record **real** job id — never invent) |

## Scripts

```bash
cd packages/games/hellforge

# regenerate interim team kit + provenance
bun scripts/bake-kit-antechamber.ts

# assemble quality room pack (den boss approach)
bun scripts/bake-antechamber.ts
bun scripts/validate-scene-pack.ts assets/scenes/boss-antechamber.pack.json --allow-missing-veyra

# validate rows ↔ files, L4 + tangent contract
bun scripts/validate-kit.ts

# mechanical texel-density + tangent gate (writes texel-density-report.json)
bun scripts/report-kit-texel-density.ts

# after Studio Meshy export — replace one module in place
bun scripts/ingest-kit-module.ts \
  --id kit-wall \
  --file /path/to/export.glb \
  --job-id <real-meshy-job-id> \
  --prompt "…" \
  --provider meshy

# REQUIRED after ingest (module GUID / meta changes stale the pack refs)
bun scripts/bake-antechamber.ts
bun scripts/validate-scene-pack.ts assets/scenes/boss-antechamber.pack.json --allow-missing-veyra
bun scripts/validate-kit.ts
```

> **GUID / pack coupling:** `boss-antechamber.pack.json` refs point at kit
> module mesh/material GUIDs from `.glb.meta.json`. Any Meshy/ingest that
> rewrites those sidecars **must** rebake the antechamber pack or Play loads
> orphan GUIDs. `validate-kit.ts` checks pack refs resolve to current kit metas.

## Human Meshy swap (Studio)

Agent cannot drive `wb-ai-asset` UI. Exact steps:

1. Open Studio (`localhost:18920`) → marketplace **wb-ai-asset** → Meshy provider.
2. Generate each module with dark-fantasy hell stone prompts; prefer opaque URP
   PBR, no cutout foliage, no emissive maps.
3. Export GLB (commercial plan that grants the needed license for this account).
4. Record the **real** Meshy job/task id + prompt + export time.
5. Run `ingest-kit-module.ts` with those fields into the matching `--id`.
6. **Rebake** with `bake-antechamber.ts` (required — pack refs track module GUIDs).
7. Re-run `validate-kit.ts`, `validate-scene-pack.ts … --allow-missing-veyra`,
   and `report-kit-texel-density.ts`. Do not commit fabricated job ids.
