# W06 — 仓库内可授权复用资产清单

## 结论

树内确有一批带明确许可的源资产或当前 Engine 可读资产，但分布很不均衡：

- **角色**：明确清权的只有 Quaternius CC0 动画狐狸；Hellforge 的人形主角和怪物虽有源 GLB、动作与 Engine sidecar，却没有逐资产许可记录，不能据此认定可再分发。
- **枪械**：在排除 FPS Gym HTML `mesh-binary@3` 后，未找到有明确 provenance 的手枪、霰弹枪或步枪 mesh。树内只有程序化斧/矛、科幻武器材质和 CC0 muzzle/smoke flipbook。
- **街景**：有 CC BY 3.0 的 Sponza 建筑裁切版、Poly Haven CC0 门/雕像/岩石、Meshy 商业账户生成的 Hellforge 模块，以及若干只有包级 Apache-2.0 声明、缺逐资产来源的街景候选。
- **材质**：明确许可的主要随上述 GLB 内嵌；另有 Kenney CC0 粒子贴图。`shoot-opt` 有大量当前 pack 格式的道路、城市、窗、霓虹材质，但只有包级许可证。
- **音频**：明确可复用的是 Apache-2.0 游戏源码中的 WebAudio 合成器，不是录音素材，也没有现成枪声采样。Hellforge BGM 和 MarsCraft MP3 均不能按现有记录视为已清权。

本清单只报告来源和授权状态，不替 Rain Alley 选择资产。

## 范围与判定

路径默认相对 `forgeax-games` 的本 worktree。纳入：

- 原始 `.glb` / `.gltf` 及 Engine `.meta.json` sidecar；
- `schemaVersion: "2.0.0"` 的 `internal-text-package` 等文本 authoring source；
- 能重新生成几何、材质或音效的源码。

未把 `internal-text-package` 误称为 mesh v4 cook：真正的 v4 证据应是 Pack v2
`body` artifact 的 codec `mesh-binary/4`。搜索范围内没有可独立授权盘点、且比其源文件
更合适的已提交 v4 body artifact；因此下面的可复用条目均以源文件/源码为授权单位。

没有把 `fps/wb-scene/materials/asset-store/blobs/` 或 Desktop ForgeaX-FPS-Gym HTML 中的
`mesh-binary@3` 当作 mesh 资产。`fps/assets/IntelliScene_Demo.glb` 是独立源 GLB，不是该
HTML blob，但仓内只有 `fps/package.json` 的包级 Apache-2.0 声明和 importer sidecar，
没有模型作者、上游或逐资产许可，因此也未列入已清权清单
（`fps/assets/IntelliScene_Demo.glb.meta.json`; `fps/package.json`）。

## 有逐资产许可或生成记录的候选

### 角色

- `aetherfall-odyssey/assets/models/quaternius-animated-fox/Fox.gltf`：Quaternius
  *Ultimate Animated Animal Pack* 的狐狸，CC0 1.0。仓内记录作者、官方页面、下载日期、
  SHA-256、51-joint skin 和 12 条动画；源 glTF 与 Engine sidecar 同在
  （`aetherfall-odyssey/assets/models/quaternius-animated-fox/ATTRIBUTION.md`;
  `aetherfall-odyssey/assets/models/quaternius-animated-fox/LICENSE`;
  `aetherfall-odyssey/assets/models/quaternius-animated-fox/Fox.gltf.meta.json`）。

没有找到同等清权强度的人形角色。Hellforge 的
`assets/characters/charactery-merged.glb`、`witch.glb` 及五个
`assets/monsters/*.glb` 是可加载、带动画的源 GLB；契约还明确
`charactery` 来自 Meshy/gen3d 合并流，但这些目录没有 license/provenance manifest、
provider job 或账户条款记录。它们只能列为**待补权属记录**，不能仅凭
`hellforge/package.json` 的 Apache-2.0 推断模型权利
（`hellforge/CHARACTER-ANIMATION-CONTRACT.md`;
`hellforge/assets/characters/charactery-merged.glb.meta.json`;
`hellforge/assets/monsters/enemy_zombie_001.glb.meta.json`）。

### 建筑、街道构件与环境道具

- `aetherfall-odyssey/assets/models/hero-observatory/hero-observatory.glb`：Crytek
  Sponza Atrium 的 ForgeaX 裁切衍生版，CC BY 3.0；仓内保留完整作者链、上游 URL、
  衍生修改、SHA-256 和 Engine sidecar。复用/再分发必须保留 attribution 与 license
  （`aetherfall-odyssey/assets/models/hero-observatory/ATTRIBUTION.md`;
  `aetherfall-odyssey/assets/models/hero-observatory/LICENSE`）。
- `aetherfall-odyssey/assets/models/polyhaven-large-castle-door/large_castle_door_1k.glb`、
  `polyhaven-gothic-statue/gothic_statue_1k.glb`、
  `polyhaven-rock-face-01/rock_face_01_1k.glb`：Poly Haven CC0 1.0。各目录保留作者、
  官方页/API manifest、下载/校验说明、LICENSE、ATTRIBUTION 与 Engine sidecar
  （相应目录下 `ATTRIBUTION.md` 和 `LICENSE`）。
- `hellforge/assets/kit/modules/{kit-floor,kit-wall,kit-corner,kit-doorframe,kit-pillar,kit-trim,kit-rubble}.glb`：
  七件模块化石质建筑套件。`assets/kit/provenance.json` 逐件记录 SHA-256、Meshy
  provider、真实 job id、prompt、导出时间和用途；许可声明为
  “Meshy commercial license (operator account)”。这是**有生成链但账户条件式授权**：
  再用前仍须把实际 plan 条款随交付记录，不能改写成 CC0 或 Apache-2.0
  （`hellforge/assets/kit/provenance.json`; `hellforge/assets/kit/README.md`）。
- `planet-snake/tools/models/` 中列名的 12 个 Kenney Nature Kit GLB：CC0 1.0，
  且声明与官方压缩包逐字节一致，可作为植被/岩石/石块环境源资产
  （`planet-snake/tools/models/LICENSE.md`）。同目录其余 14 个生成模型没有
  redistribution record，`gate_dark.glb` 更无来源记录，均不属于已清权集合。

### 枪口、烟火与材质视觉

- `hellforge/assets/vfx/packs/kenney-particle-pack/` 的 `muzzle_*`、`smoke_*`、
  `fire_*` / `flame_*` PNG：Kenney Particle Pack，CC0 1.0。机器可读 manifest
  逐组保存源 URL、下载日期、文件 SHA-256、用途和 license deed；可作为枪口焰/烟雾
  视觉源，但它们不是枪 mesh
  （`hellforge/assets/vfx/provenance.json`）。
- 同一 manifest 中 path 为 null 的 glow/noise/spark/shard/bolt/scorch/ring 等程序贴图
  标为 `team-owned`，生成实现位于 `hellforge/src/fx/textures.ts`。它们是源码级视觉
  材料来源，不是写实 PBR 表面库。
- Aetherfall 的 Sponza、Poly Haven 门/雕像/岩石 GLB 自带已清权的 PBR 材质/贴图；
  许可边界随各自模型，不应拆出后丢失 CC BY attribution 或 CC0 provenance。

### 音频源码

- `hellforge/src/sfx.ts` 是无外部音频文件的 WebAudio oscillator/noise 合成器，
  覆盖 hit、crit、kill、cast、pickup 等事件；代码随 `hellforge/package.json`
  声明 Apache-2.0。它是可复用的音效**生成源码**，但没有专门的 firearm/gunshot
  事件或录音样本。
- `fps/main.ts` 也含程序化 WebAudio noise/oscillator 枪声实现，代码位于
  Apache-2.0 包中；可作为源码证据，不涉及被排除的 HTML cooked mesh
  （`fps/main.ts`; `fps/package.json`）。

## 只有包级许可、需补逐资产 provenance 的候选

这些内容满足源文件或当前 pack 格式，但仓内没有足够证据把二进制资产的权利链认定为已清：

- `go-karts/assets/prop_shop.glb`、`prop_lamp.glb`、`prop_bench.glb` 以及赛道/桥/
  clocktower 等街景源 GLB均有 Engine sidecar；`go-karts/package.json` 声明 Apache-2.0，
  但没有逐资产作者、生成 provider/job 或第三方 license。`package.json` 还说明这是
  “Fable5 pet kart racer” 的移植，故包级声明不足以替代资产 provenance。
- `spin-cube/assets/GT_MC_Large Building.glb` 有 Engine sidecar，包级 Apache-2.0，
  但提交和目录没有上游/作者/资产许可记录
  （`spin-cube/assets/GT_MC_Large Building.glb.meta.json`; `spin-cube/package.json`）。
- `shoot-opt/src/background.ts` 是程序化城市、工业区、公园、河岸和高架路几何源码；
  `shoot-opt/assets/materials/` 有 city/road/highway/rooftop/window/neon/
  holo-billboard 等文本 authoring package 材质，包级 Apache-2.0
  （`shoot-opt/src/background.ts`; `shoot-opt/src/setup.ts`;
  `shoot-opt/assets/materials/road-dark.pack.json`; `shoot-opt/package.json`）。
  这批最接近“可直接搬运的 v4 街景源码+材质”，但没有逐材质 provenance；另外
  `shoot-opt/assets/scene.pack.json` 本身是空 scene，不能误报成现成街区。
- `cow-survivor/assets/characters/player.pack.json` 与
  `assets/monsters/*.pack.json` 是文本 authoring package 形式的程序化牛/怪物角色；
  `cow-survivor/package.json` 声明 Apache-2.0，但无逐角色来源说明，且没有人形或枪械。
- `game-brotato-v2/assets/lib/weapons/axe.ts` 和 `spear.ts` 是 Apache-2.0 包内的
  primitive-geometry 武器源码，有完整部件尺寸与材质槽；它们是明确可审计的近战源码，
  不是枪。

## 明确不应复用的音频

- `hellforge/assets/music/bgm-camp.mp3` 与 `bgm-den.mp3`：项目 README 明说 provenance
  uncleared，且旧标签类似商业 OST 名称；不得宣称清权
  （`hellforge/assets/music/README.md`）。
- `marscraft/assets/music/*.mp3`：进度记录只说从未指明的 “source” 复制九首 MP3，
  没有 LICENSE、作者或来源 URL；`marscraft/package.json` 的 Apache-2.0 不能补足该
  二进制音乐权利链
  （`marscraft/PORT-PROGRESS.md`; `marscraft/assets/music/`;
  `marscraft/package.json`）。
- Hellforge 自己也明确记录“没有 licensed production OGG SFX pack in-tree”
  （`hellforge/SHELL-PORT-PROGRESS.md`; `hellforge/README.md`）。

因此，当前组织仓内没有可直接列为已清权的枪声采样包。

## Marketplace / gen3d 搜索结果

检查了 `/Users/you/dev/ForgeaX-Games/forgeax-studio/packages/marketplace` 和
`/Users/you/dev/ForgeaX-Games/forgeax-marketplace`。两处插件树均未检出受版本
控制的 GLB/GLTF/FBX/OBJ 或 WAV/MP3/OGG/FLAC 资产；它们提供生成、交接、存储和导出
代码，不是组织级可复用资产目录。已落入游戏仓的 gen3d/Meshy 输出必须以游戏旁的
provenance 为准；目前只有 Hellforge kit 达到逐件 job/prompt/license 记录强度，
Hellforge 角色仅记录生成/合并技术链，尚未记录足够的再分发许可。

## 对后续授权决策可直接使用的边界

- 可直接引用为“许可明确”：Quaternius Fox（CC0）、三个 Poly Haven 环境资产
  （CC0）、Kenney Nature Kit 的列名 12 件（CC0）、Kenney 粒子贴图（CC0）、
  Sponza 裁切版（CC BY 3.0，必须署名）。
- 可引用为“账户条款条件式”：Hellforge 七件 Meshy kit；须保留 job/prompt/SHA，
  并核验和记录 operator account 的实际商业 plan 条款。
- 其余包级 Apache-2.0 候选不能自动升级为逐资产清权；二进制音乐、Hellforge 人形/
  怪物、Go Karts/Spin Cube 模型都需要补来源记录。
- 树内没有已清权的现代人形角色、现代枪 mesh 或枪声采样包。这个“空缺”是本次搜索
  的事实结论，不是 Rain Alley 的采购/生成选择。
