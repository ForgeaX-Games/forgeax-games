# LearnOpenGL Vendor Attribution

This `learn-opengl/` subtree contains binary assets vendored from the upstream
[`JoeyDeVries/LearnOpenGL`](https://github.com/JoeyDeVries/LearnOpenGL) repository.

## Provenance

| Field | Value |
|:--|:--|
| Upstream URL | <https://github.com/JoeyDeVries/LearnOpenGL> |
| Upstream commit | [`a545a703f95893258d16dbe32f5ccbb6400fd213`](https://github.com/JoeyDeVries/LearnOpenGL/commit/a545a703f95893258d16dbe32f5ccbb6400fd213) |
| Upstream commit date | 2024-08-05 |
| Vendor date | 2026-05-18 |
| Vendor scope | `resources/textures/` top-level (24 PNG + 7 JPG = 31 files) |
| Subdirectories deferred | `objects/` `skybox/` `pbr/` `hdr/` |
| License | CC BY-NC 4.0 (see `LICENSE` in this directory) |

## Reproducing the vendor step

```bash
git clone https://github.com/JoeyDeVries/LearnOpenGL /tmp/LearnOpenGL-full
cd /tmp/LearnOpenGL-full
git checkout a545a703f95893258d16dbe32f5ccbb6400fd213
# copy the 31 top-level textures into forgeax-engine-assets/learn-opengl/textures/
# regenerate sidecars: node forgeax-engine-assets/scripts/generate-sidecar.mjs
```

## Vendored files (31)

| # | Filename | colorSpace | Section(s) used |
|--:|:--|:--|:--|
|  1 | `awesomeface.png` | srgb | 1.4 textures (sample face) |
|  2 | `background.jpg` | srgb | 4.advanced-opengl backgrounds, 7.in-practice breakout |
|  3 | `block.png` | srgb | 7.in-practice breakout |
|  4 | `block_solid.png` | srgb | 7.in-practice breakout |
|  5 | `bricks2.jpg` | srgb | 5.advanced-lighting parallax-mapping |
|  6 | `bricks2_disp.jpg` | linear | 5.advanced-lighting parallax-mapping (height map) |
|  7 | `bricks2_normal.jpg` | linear | 5.advanced-lighting parallax-mapping (normal map) |
|  8 | `brickwall.jpg` | srgb | 5.advanced-lighting normal-mapping (diffuse) |
|  9 | `brickwall_normal.jpg` | linear | 5.advanced-lighting normal-mapping (normal map) |
| 10 | `concreteTexture.png` | srgb | community / supplementary |
| 11 | `container.jpg` | srgb | 1.4 textures, 1.5-1.7 transformations / coordinate-systems / camera |
| 12 | `container2.png` | srgb | 2.lighting lighting-maps (diffuse) |
| 13 | `container2_specular.png` | linear | 2.lighting lighting-maps (specular map) |
| 14 | `container2_specular_colored.png` | linear | 2.lighting lighting-maps (alt specular) |
| 15 | `grass.png` | srgb | 4.advanced-opengl blending |
| 16 | `marble.jpg` | srgb | 4.advanced-opengl framebuffers |
| 17 | `matrix.jpg` | srgb | 4.advanced-opengl geometry-shader scene |
| 18 | `metal.png` | srgb | 4.advanced-opengl depth-testing floor |
| 19 | `paddle.png` | srgb | 7.in-practice breakout |
| 20 | `particle.png` | srgb | 7.in-practice breakout |
| 21 | `powerup_chaos.png` | srgb | 7.in-practice breakout (powerup) |
| 22 | `powerup_confuse.png` | srgb | 7.in-practice breakout (powerup) |
| 23 | `powerup_increase.png` | srgb | 7.in-practice breakout (powerup) |
| 24 | `powerup_passthrough.png` | srgb | 7.in-practice breakout (powerup) |
| 25 | `powerup_speed.png` | srgb | 7.in-practice breakout (powerup) |
| 26 | `powerup_sticky.png` | srgb | 7.in-practice breakout (powerup) |
| 27 | `toy_box_diffuse.png` | srgb | 5.advanced-lighting parallax-mapping (toy box diffuse) |
| 28 | `toy_box_disp.png` | linear | 5.advanced-lighting parallax-mapping (toy box height) |
| 29 | `toy_box_normal.png` | linear | 5.advanced-lighting parallax-mapping (toy box normal) |
| 30 | `window.png` | srgb | 4.advanced-opengl blending (transparent window) |
| 31 | `wood.png` | srgb | 5.advanced-lighting shadow-mapping floor |

## Notes

- File renaming, compression to KTX2 / Basis, and alpha-channel transforms are
  out of scope for this vendor; bytes are byte-identical with the upstream
  commit listed above.
- LearnOpenGL `LICENSE.md` does not provide per-file author attribution; the
  table above only documents engine-side `colorSpace` classification and the
  LearnOpenGL section that consumes each file.
- For the runtime sidecar `<filename>.image.meta.json` schema, see the
  forgeax-engine repo `AGENTS.md §Disk schema`.

## 2026 sync

> Filled by `tweak-20260520-learn-opengl-assets-mirror` M5 (w17) after the
> mirror script ran and the actual file set was finalised.

| Field | Value |
|:--|:--|
| Upstream URL | <https://github.com/JoeyDeVries/LearnOpenGL> |
| Upstream commit | `a545a703f95893258d16dbe32f5ccbb6400fd213` |
| Upstream master HEAD captured at | 2026-05-20 |
| Sync feat | `tweak-20260520-learn-opengl-assets-mirror` |
| Vendor scope | full `resources/` tree mirror — 138 upstream files across audio / fonts / levels / meshes / textures (categories table below). The pre-existing 31 top-level textures from the 2024-08-05 vendor step are a strict subset and remain byte-identical |
| License | CC BY-NC 4.0 (unchanged) |

### Pin-SHA continuity note

The 2026-05-20 `git ls-remote refs/heads/master` returned the same commit
SHA (`a545a703...`) as the 2024-08-05 vendor step above. Upstream master has
not advanced since 2024-08-05, so the new mirror is a strict superset of the
existing 31-texture subset; byte-equality of the existing files is therefore
guaranteed by construction and the M2 collision gate becomes a regression
check rather than a discovery.

### Categories

Counts below cover only upstream-derived binaries (138 total). Sidecar
`*.meta.json` / `*.image.meta.json` files and the forgeax-side
`meshes/cube-mesh.stub` (procedural-cube placeholder, not upstream) are
excluded.

| Category | Path | File count | Notes |
|:--|:--|:--|:--|
| audio | `learn-opengl/audio/` | 5 | 7.in-practice breakout SFX — `bleep.mp3` / `bleep.wav` / `breakout.mp3` / `powerup.wav` / `solid.wav` |
| fonts | `learn-opengl/fonts/` | 5 | 4 TTFs (`Antonio-{Bold,Light,Regular}.ttf`, `OCRAEXT.TTF`) + `SIL Open Font License.txt` |
| levels | `learn-opengl/levels/` | 4 | breakout level files `one.lvl` / `two.lvl` / `three.lvl` / `four.lvl` |
| meshes/backpack | `learn-opengl/meshes/backpack/` | 8 | `.obj` + `.mtl` + 5 textures (ao / diffuse / normal / roughness / specular) + `source_attribution.txt` |
| meshes/cyborg | `learn-opengl/meshes/cyborg/` | 8 | `.obj` + `.mtl` + `.blend` + `.blend1` + 3 textures (diffuse / normal / specular) + `LICENSE.txt` |
| meshes/nanosuit | `learn-opengl/meshes/nanosuit/` | 33 | `.obj` + `.mtl` + 31 textures across arm / body / glass / hand / helmet / leg / cell-alpha groups |
| meshes/planet | `learn-opengl/meshes/planet/` | 4 | `.obj` + `.mtl` + `mars.png` + `source.txt` (4.advanced-opengl instancing) |
| meshes/rock | `learn-opengl/meshes/rock/` | 3 | `.obj` + `.mtl` + `rock.png` (4.advanced-opengl instancing) |
| meshes/vampire | `learn-opengl/meshes/vampire/` | 5 | `dancing_vampire.dae` + 4 textures under `textures/` (diffuse / emission / normal / specular) — 6.guest articles skeletal-animation |
| textures (top-level) | `learn-opengl/textures/` | 31 | Pre-existing 2024-08-05 vendor subset — full list in §Vendored files (31) above |
| textures/hdr | `learn-opengl/textures/hdr/` | 1 | `newport_loft.hdr` — 6.PBR IBL environment map |
| textures/pbr/gold | `learn-opengl/textures/pbr/gold/` | 5 | albedo / ao / metallic / normal / roughness — 6.PBR lighting (textured) |
| textures/pbr/grass | `learn-opengl/textures/pbr/grass/` | 5 | albedo / ao / metallic / normal / roughness — 6.PBR lighting (textured) |
| textures/pbr/plastic | `learn-opengl/textures/pbr/plastic/` | 5 | albedo / ao / metallic / normal / roughness — 6.PBR lighting (textured) |
| textures/pbr/rusted_iron | `learn-opengl/textures/pbr/rusted_iron/` | 5 | albedo / ao / metallic / normal / roughness — 6.PBR lighting (textured) |
| textures/pbr/wall | `learn-opengl/textures/pbr/wall/` | 5 | albedo / ao / metallic / normal / roughness — 6.PBR lighting (textured) |
| textures/skybox | `learn-opengl/textures/skybox/` | 6 | back / bottom / front / left / right / top — 4.advanced-opengl cubemaps |
