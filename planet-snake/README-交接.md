# 星球贪吃蛇 — 代码交接说明

一个跑在 ForgeaX 引擎（WebGPU + ECS）上的球面贪吃蛇。这个包是**游戏代码**，
不含引擎本身。

---

## ⚠️ 先说清楚：这份代码不能独立跑起来

它是 ForgeaX Studio 的一个 game 目录，必须放回 studio 的工作区里才能跑：

```
<forgeax-studio>/.forgeax/games/planet-snake/     ← 这个包解压到这里
```

然后按 studio 自己的方式启动（`bun install` → `bun fx start`），
浏览器开 `http://localhost:18920`，或者直接开引擎预览：

```
http://127.0.0.1:<engine-port>/preview/?game=planet-snake&rs=1
```

> `rs=1` 建议一直带着：它给渲染缩放设上限。不带的话在高 DPI 屏上会按满
> DPR 渲染（实测 7.6 兆像素），帧率从 ~55 掉到 11。

**想直接玩不想装环境** → 用另外那个静态站点包（`planet-snake-静态站点.zip`），
纯静态、解压上传就能跑，不需要引擎源码。

---

## 目录

| 路径 | 是什么 |
|---|---|
| `main.ts` | 游戏主体（约 3900 行）。ECS 系统、渲染、玩法、特效都在这 |
| `src/` | 拆出去的模块：地表、水体、粒子、蛇身、HUD、着色器…… |
| `src/worldgen/` | **vendored 快照**，见下 |
| `tools/` | 离线工具链（资产烘焙 + WorldClaw 三级流水线） |
| `assets/` | 场景 pack、glTF sidecar |
| `docs/` | 引擎接口契约说明 |

---

## 三类文件不要手改

### 1. `src/worldgen/` 是 vendored 快照

上游是独立的 worldgen 仓，每个文件头一行都写着「改动请改上游后重新复制」。
要改散布算法请改上游再同步回来，别在这里改。

### 2. 这几个是**生成产物**，手改会被下次生成覆盖

| 文件 | 谁生成的 |
|---|---|
| `src/biome-plan.ts` | `bun tools/plan-biome.ts "<一句话世界观>" --write` |
| `src/object-plan.ts` | `bun tools/emit-object-plan.ts <region>` |
| `src/terrain-calibration.ts` | `bun tools/terrain-gate.ts --write` |
| `src/props-data.ts` | `python3 tools/bake-props.py tools/models` |

文件头都有生成命令，照着重跑即可。
`tools/models/` 是混合来源，逐文件来源与待确认项以
`tools/models/LICENSE.md` 为准，不能把整个目录统一声明为 Kenney CC0。

### 3. `src/biome-plan.baseline.ts` 是冻结基准

生成器上线前那份手调方案的原样副本，`tools/plan-biome.ts` 拿它当**参照物**
衡量新方案的难度和密度。**不要拿它当普通配置去改**——一旦它跟着产物一起变，
基准就会随生成漂移，验收标准等于没有。（这是实测踩过的：一次偏保守的生成把
致命障碍基准从 89 拉到 68，下一轮就以 68 为准了。）

游戏里加 `?plan=baseline` 可以切回这份旧方案做对比。

---

## WorldClaw 三级流水线

`tools/` 里那套是按 Hunyuan3D-WorldClaw 论文实现的世界生成，分三级：

**Stage 1 — 规划**　`tools/plan-biome.ts`
一句话世界观 → 结构化的 `BiomePlan`。用**两个** agent：意图 agent 只抽 prompt
字面说了的（每条带原文 evidence），规划 agent 补全并把补的每一项落进 `defaulted`。
拆两个的唯一目的是造一条**出处边界**——凡是没出现在 intent 里的都是模型编的。
这条边界是程序强制的：`user_stated` 必须等于 intent evidence 集合，每条还得是
prompt 的逐字子串，对不上直接报错。

```bash
bun tools/plan-biome.ts --current        # 只跑校准，打印当前方案的实测指标
bun tools/plan-biome.ts "一颗温带海洋星球……"   # 生成（默认不写盘）
```

**Stage 2 — 地形**　`src/terrain-plan.ts` + `src/surface.ts`
论文那条区域感知高度场 `H(x) = Σ_r m̃_r(x)·[h_r + ΣN + ΣG]`。每个区域有自己的
基准海拔、粗糙度和地貌算子（peak/dune/terrace/erosion/ridge/flat），所以草原平缓、
高地陡峭，而不是一套噪声铺满全球。

`TERRAIN_PLAN` 是这条公式在仓库里的**唯一**定义，CPU 求值和 WGSL 都从它生成——
不要再手写第二份 `ps_relief`。

```bash
bun tools/terrain-gate.ts                # 20 万点量测 + 断言
bun tools/terrain-gate.ts --write        # 重新生成着色标定
```

> gate 里有一条**世界单位的绝对幅度下限**，别删。上面那些「高地比草原高/陡」的
> 断言全是相对关系，靠「把整个星球缩小」一样能满足——首版就是这么过的 gate，
> 归一化分位数全对，实际起伏却从 3.10 掉到 1.23，星球平了 2.5 倍。

**Stage 3 — 区域物体**　`tools/region-shot.ts` + `tools/plan-objects.ts`
选区 → 用**记录的相机**渲染该区 → 在这张图上做地形条件化构图 → 检测实例 →
射线打回地形求交反解摆放 → refine agent 复核尺寸 → 逐个重建 mesh。

```bash
bun tools/region-shot.ts --region grassland    # 渲染 + 记录相机
bun tools/plan-objects.ts --region grassland --no-3d   # 跑到摆放为止（不生成 3D）
bun tools/plan-objects.ts --region grassland   # 全跑，含重建（每个模型约 6 分钟）
bun tools/emit-object-plan.ts grassland        # 落成 src/object-plan.ts
```

相机被做成一个对象而不是三处各写一遍，是因为渲染、构图、反解摆放**必须用同一个**——
构图图上的像素坐标只有配上产生它的那个相机才有意义。

相对论文有三处替换，都记在对应文件头：分割用 gemini 的 grounded detection 代替
SAM3（网关没有分割模型）、重建用文生 3D 代替 SAM3D（图生 3D 要求 image_url 公网可达）、
渲染用 CPU 光线步进代替截游戏画面（保证摆放射线与产生像素的射线同源）。

---

## 外部依赖

`tools/` 里几个脚本要调一个 LiteLLM 兼容网关。**地址和 key 都不在代码里**，
运行时从环境变量取：

- `FORGEAX_LLM_BASE_URL` —— 网关地址，未设置直接报错
- key 按顺序取：

1. 环境变量 `FORGEAX_LLM_KEY`
2. 本机 `~/.local/bin/claude` 包装脚本里的 `ANTHROPIC_API_KEY`

自己跑的话把 `FORGEAX_LLM_BASE_URL` 和 `FORGEAX_LLM_KEY` 都设上。

> 这些只是**离线开发工具**的依赖。**游戏本体运行完全不需要它们**——
> 生成产物已经落盘在 `src/` 里了。

资产转换要 Blender 5.2+（`tools/bake-props.py`、以及 hy3d-local 那边的
`cloud2prop.py`）。

---

## 操作

A / D 转向 · Shift 加速 · Q 蛇蜕 · 空格 突刺 · E 蛇灵 · F 涌泉（限水面）· C 裂地 · P 帧率

开发构建或 URL 带 `?debug=1` 时，调试接口挂在 `window.__ps`（`__ps.props()` /
`__ps.regions()` / `__ps.cam(h,back,look)` / `__ps.look(dir)` / `__ps.god(true)` 等），
改视角和取数据都靠它。
