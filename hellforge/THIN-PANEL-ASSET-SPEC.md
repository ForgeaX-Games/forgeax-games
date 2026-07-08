# 薄板 AI 资产生成规格(营地结构件去拉伸 - proper fix)

> 你选了「重新生成薄墙板 AI 资产」。营地的墙/屋顶/围栏是**薄槽**(厚 0.2-0.3m),
> 而你现有 AI 资产是 ≈2m 厚方块,塞不进去不拉伸。需要新生成**薄板**资产,
> 我再平铺进槽(等比不拉伸、保留 AI 贴图)。
>
> **地牢不用生成**:地牢墙是厚墙(3.2 高 × 2.4 厚),现有 `prop-den-wall` 等比就能贴,
> 我直接平铺(见下文「地牢」)。

## 你要生成的 3 个薄板资产(用 wb-ai-asset,precise-lowpoly 模式)

生成时**关键强调「薄/flat slab」**——meshy 默认会出 ≈2m 厚方块,要它在一条轴上薄。
生成完落到 `packages/games/hellforge/assets/3d/props/meshes/<stem>.glb` + sidecar。

### 1. `prop-wall-panel` — 薄墙板
- **目标自然 bbox**:宽 1.0m × 高 2.4m × **厚 0.1-0.3m**(Z 轴薄!)
- **prompt**:`thin flat stone wall panel, 1m wide, 2.4m tall, 0.1m thick, weathered grey stone, flat back and front, low-poly game asset, no base`
- **平铺**:4m 墙铺 4 块、5m 墙铺 5 块,沿长度首尾相接;E/W 墙旋转 90°。
- **覆盖**:Hut1/2/3 全部 6 面墙。

### 2. `prop-roof-panel` — 薄屋顶板
- **目标 bbox**:2.0m × **厚 0.1m** × 2.0m(接近正方形的薄扁板)
- **prompt**:`flat thin roof slab, 2 by 2 meters, 0.1m thick, dark thatch over wood, low-poly game asset, flat`
- **平铺**:4.2×4.2 屋顶铺 2×2=4 块;5.2×3.2 铺 3×2=6 块。
- **覆盖**:Hut1/2/3 屋顶。

### 3. `prop-fence-panel` — 薄围栏段
- **目标 bbox**:宽 2.0m × 高 1.2m × **厚 0.1m**
- **prompt**:`thin wooden fence section, 2m wide, 1.2m tall, 0.1m thick, weathered dark wood posts and rails, low-poly game asset, flat back`
- **平铺**:12m 围栏铺 6 块、16m 铺 8 块,沿长度首尾相接。
- **覆盖**:FenceW1/E1/N。

## 生成要点

- **薄是关键**:如果生成回来 Z 轴还是 1.5m 厚,平铺后墙就是 1.5m 厚(小屋变碉堡)。
  prompt 里反复强调 `thin`/`flat`/`0.1m thick`。生成后用下面「验收」命令确认 bbox 的厚度轴 < 0.4m。
- **面数**:每个面板 8000 面以内即可(面板比角色简单)。
- **落地对齐**:面板底部要在 y=0(平铺脚本会按 bbox.min.y 落地,你不用管)。
- **材质**:墙=灰石、屋顶=深色茅草/木、围栏=深色朽木。跟 hellforge 灰烬主题搭。
- **必须有 `.meta.json` sidecar**:`<stem>.glb.meta.json`(importer `gltf`,含 `mesh`+`material` subAssets)。
  wb-ai-asset 通常自动生成;若只有 .glb 没 sidecar,跑引擎导入:
  ```bash
  # 在 hellforge 目录,把 GLB 纳入引擎 catalog(生成 .meta.json)
  bunx forgeax-engine-remote-gltf import assets/3d/props/meshes/prop-wall-panel.glb
  ```
  三个面板各跑一次。`tile-apply` 靠 sidecar 读 mesh/material GUID + bbox,没 sidecar 会跳过。

## 验收(生成完后,接线前自检)

```bash
cd packages/games/hellforge
# 看每个面板的 bbox(确认厚度轴 < 0.4m,长度/高度轴合理)
bun -e 'import {readPropBBox} from "./scripts/lib/scene-authoring.ts"; for(const s of ["prop-wall-panel","prop-roof-panel","prop-fence-panel"]){const b=readPropBBox("./assets/3d/props/meshes",s); console.log(s, "size", b.size.map(v=>+v.toFixed(2)), "min", b.min.map(v=>+v.toFixed(2)));}'
```
- `prop-wall-panel` 期望 size ≈ [1, 2.4, 0.1~0.3](X 长 1, Y 高 2.4, Z 薄)
- `prop-roof-panel` 期望 size ≈ [2, 0.1, 2](薄扁板)
- `prop-fence-panel` 期望 size ≈ [2, 1.2, 0.1](X 长 2, Y 高 1.2, Z 薄)
若 Z 轴(厚度)> 0.5,墙会偏厚——可接受就继续,不可接受就重新生成强调 thin。

## 暂不生成(保持盒体即可)

- **Gate column / Lintel / Torch post / Deadtree 干枝 / 营火木柴**:细长件,AI 难出
  薄长条;盒体(纯色)够用。后续要再单独生成柱子/枯树。
- **Ground / Path / EmberCrack**:大平面薄片;盒体+纯色或后续生成 flat tile 贴图。

## 地牢(无需你生成)

地牢墙(3.2 高 × 2.4 厚)用现有 `prop-den-wall`(2×1.5×1.14)等比缩放到高 3.2
→ 4.27×3.2×2.43,厚 2.43 ≈ 槽 2.4,**完美贴合**;长墙沿长度平铺多段。
我直接改 bake 脚本,你不用动。地牢地面/slag 保持盒体。

## 生成完之后(我来接线)

3 个面板资产落到 `assets/3d/props/meshes/` 后,告诉我(或直接说「面板好了」),
我跑:
```bash
bun scripts/reshape-scene.ts tile-apply scenes/rogue-encampment.pack.json   # 营地墙/屋顶/围栏平铺
bun scripts/bake-dungeon.ts && bun scripts/fix-prop-materials.ts scenes/slagdeep-hollow.pack.json  # 地牢墙平铺
```
然后你硬刷新看效果。平铺是幂等的(重跑会先拆旧 tile 再铺新的)。
