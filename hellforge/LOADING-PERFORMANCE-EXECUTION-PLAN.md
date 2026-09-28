<!-- context-audit:2026-09-10 -->
> 文档核对：2026-09-10。设计/规划参考；不作为当前实现或验收完成的证明。
> 接手先读 [当前状态与入口](CURRENT.md)；[整理前原文](docs/archive/pre-management/LOADING-PERFORMANCE-EXECUTION-PLAN.md) 保留来源与原始内容。

# Hellforge 官网 Demo 加载性能 Production-Ready 执行计划

状态：`HISTORICAL_EXECUTION_SPEC / PARTIALLY_IMPLEMENTED`

2026-09-10 核对：开发基线 e166d293 已移除 forge.json.defaultScene，并在 main.ts 接入点击门后的 campLoader、预加载与性能 marks。下面 §1.2 的阻塞链是实施前根因，不是当前状态。其余阶段不因这些代码存在而视为完成；当前证据边界见 CURRENT.md 和 docs/evidence/loading-performance/INDEX.md。

执行者：Grok 4.6

日期：2026-08-20

主目标：以用户加载体验为第一优先级，降低
`https://forgeax.github.io/games/hellforge/` 首次访问和进入营地的等待时间，
同时保持最终画质、玩法、VFX、存档和跨区域流程不退化。

执行前必读：

- `hellforge/AGENTS.md`：Hellforge 权威规则。
- `packages/harness/docs/superpowers/plans/2026-07-27-hellforge-pr11-loading-optimization-plan.md`：
  已完成的 PR11 首次加载优化 SSOT。
- `hellforge/scripts/play-flow-checklist.md`：真实 `:18920` Play 回归流程。
- `hellforge/docs/handoff/2026-08-13-1k-textures-and-2k-restore.md`：
  1K/2K 资产约束。

本计划建立在 PR11 已完成的 parallel boot、determinate progress 和 lazy den 之上。
必须保留其行为和验收下限；不得把 den packs 或 den-only monsters 移回 campaign boot。

---

## 0. 执行契约

按本文阶段顺序执行。每个阶段都必须完成自己的验证门槛，再进入下一阶段。
不要一次性同时改启动顺序、资源格式、场景拆分和画质设置，否则失败时无法定位原因。

最终完成不是“本地看起来快了”，而是同时满足：

1. 本地 production bake 通过。
2. 冷缓存、热缓存和慢网回测达到本文硬门槛。
3. 标题、角色选择、营地、野外、地牢、存档、音频、VFX 全部通过回归。
4. 关键画面与基线相比无可感知画质退化。
5. 所有相关仓库 CI 通过。
6. 官网重新烘焙后，线上再次测量并通过同一套门槛。
7. PR 中附有可复查的 before/after 数据、资源瀑布和截图证据。

执行纪律：

- 开工前读取当前仓库的 `AGENTS.md`、工作流规则和本计划。
- 在独立 worktree 工作，不切换主目录分支，不覆盖现有未提交文件。
- 首先记录每个相关仓库的 HEAD、分支和工作区状态。
- 每个 commit 只包含一个可独立验证的阶段。
- Games、Engine、Editor、Studio、Website 改动必须分仓、分 PR。
- 最终面向 `main` 的下游 PR 不得保留 off-main 子模块 pin。
- 不修改 `.env`，不提交 `.forgeax/workbench` 运行时状态。
- 不使用 `pkill`；服务只停止已记录 PID，或使用仓库提供的停止命令。
- 不用“增加 loading 动画”掩盖实际阻塞；必须同时降低阻塞时机或资源成本。
- 保持当前 1K 贴图；Engine
  [#2078](https://github.com/ForgeaX-Games/forgeax-engine/issues/2078) 和对应 pin
  未收敛前不恢复 2K。
- Hellforge 执行者不直接修改 Engine 子模块。发现 Engine 前置时，产出独立 handoff
  交给 Engine owner；只有用户另行授权且仓库 owner 接受后，才启动跨仓 Engine 工作。
- Merge、官网 workflow dispatch 和生产发布只在执行会话获得用户授权后进行。

---

## 1. 已知基线与根因

### 1.1 线上实测基线

2026-08-20 对当前官网 Demo 的一次实测：

- 冷启动到“点击进入”：约 `11.8 s`。
- 该阶段传输约 `79.5 MB`。
- Resource Timing `decodedBodySize` 约 `300 MB`。这是 HTTP content-encoding
  解码后的响应体，不等于 GPU 显存。
- 其中 `87` 个 `body.bin` 约占 `77 MB` 传输。
- 完整首次进入游戏累计接近 `95 MB` 传输、`343 MB` HTTP-decoded body。
- 热缓存到“点击进入”仍约 `7.4 s`，说明瓶颈不只是网络，还包括 Pack 解析、
  图片处理、CPU 工作和 GPU 上传。
- 角色确认后进入运行时还会追加约 `16 MB` 传输、`43 MB` HTTP-decoded body，
  并出现较长等待。

这些数字只作为历史基线。阶段 0 必须在同一机器、同一浏览器和固定网络配置下重新采样，
得到可比较的正式 baseline。

### 1.2 实施前的启动阻塞（历史根因）

关键代码：

- `hellforge/forge.json`
- `hellforge/main.ts`
- Engine `packages/devkit/src/host.ts`

实施前 `forge.json.defaultScene` 指向营地场景
`2748fc78-a386-4b9b-b7d5-cd771eaf6a71`。

Standalone Host 的执行顺序是：

1. 刷新 Pack Catalog。
2. `loadByGuid(defaultScene)`。
3. `assets.instantiate(defaultScene)`。
4. 挂载 game plugin。
5. 执行 Hellforge `bootstrap()`。

因此，Hellforge 自己的标题、点击门和 Intro 代码还没有机会运行，Host 就已经递归加载了
营地 Scene 的全部引用。

即使 Host 没有提供默认场景，`hellforge/main.ts` 当前也会在约
`bootstrap()` 488–528 行再次同步等待营地 `loadByGuid + instantiate`。
BootCamera、Intro 和 Title Shell 都在这段等待之后创建。

Engine Project Schema 已明确允许 `defaultScene` 缺省；Host 也会在缺省时跳过默认场景加载。
因此第一条可行切口是：

- 从 Hellforge `forge.json` 移除 `defaultScene`。
- 由 Hellforge 自己以幂等 Promise 管理营地预加载。
- 先挂载点击门、Intro、标题 UI 和 BootCamera，再后台加载营地。

### 1.3 当前纹理烘焙事实

关键代码：

- Engine `packages/vite-plugin-pack/src/index.ts`
- Engine `packages/gltf/src/gltf-importer.ts`
- Engine `packages/image/src/ktx2-encode.ts`
- Engine `packages/render/src/render-data.ts`
- Hellforge `assets/**/*.glb.meta.json`

Hellforge 的 GLB sidecar 目前通常只有：

```json
{
  "importSettings": {
    "defaultSceneIndex": 0
  }
}
```

GLB 嵌入贴图进入 Vite Pack 的 `decodeImage` 路径时，如果
`importSettings.compressionMode` 未设置，当前实现默认使用 `none`，
所以最终产出 raw RGBA `body.bin`。这解释了大量单张约 4 MiB 的
1024×1024 RGBA 贴图。

Engine 已实现：

- `compressionMode: "auto" | "etc1s" | "uastc" | "none"`。
- `auto`：sRGB 颜色贴图使用 ETC1S，linear 法线/ORM 使用 UASTC。
- UASTC LDR 使用 KTX2 zstd supercompression。
- Runtime 根据 WebGPU 能力转码到 BC、ASTC 或 ETC 系列格式。
- `downscaleMaxDimension`。
- KTX2/Basis 加载和 GPU 消费路径。

但当前源码存在必须先验证的缺口：

- `basisEncodeParamsFor()` 的 `mipGen` 当前对 ETC1S、UASTC、UASTC-HDR
  全部硬编码为 `false`。
- glTF 贴图默认 `mipmap: true`。
- Runtime 明确拒绝“压缩纹理 + `mipmap:true` + `mipLevelCount <= 1`”，
  错误码为 `mipgen-unsupported-compressed-format`。
- Pack KTX2 loader 还可能根据实际转码层数把单层纹理规范化为
  `mipmap:false / mipLevelCount:1`，所以缺 mip 不一定抛错，也可能静默退化为
  无 mip sampling。
- glTF reimport 当前不会保留 sidecar 的 `compressionMode` 和 `mipmap`，
  手工增加的策略可能在下一次重导入时丢失。

因此禁止直接批量增加 `compressionMode: "auto"`。
必须先完成阶段 4 的单资源探针；如果探针确认 KTX2 只有一层 mip，
或 reimport 丢失压缩设置，先完成独立 Engine 前置 PR。

### 1.4 官网烘焙使用的真实依赖

Website workflow：

- 仓库：`forgeax-website`
- 文件：`.github/workflows/build-demos.yml`
- Workflow 名称：`Build live demos`

重要事实：

- Workflow 会 checkout `forgeax-games/main`。
- 游戏 bake 使用 Studio 的
  `packages/editor/packages/play-runtime` 和其递归 Engine pin。
- `_engine` checkout 主要用于 Engine examples，不能代表 Games bake 使用的 Engine。

所以如果 KTX2 mip 修复发生在 Engine：

1. Engine PR 合入。
2. Editor 对齐 Engine main pin 并通过 Editor CI。
3. Studio 对齐 Editor main pin并通过 Studio CI。
4. Games 才能依赖该能力。
5. Website 重新 bake 后官网才真正使用新路径。

不得只改 Engine main 后假定官网 Games 已生效。

---

## 2. 性能目标与发布硬门槛

### 2.1 标准测试档

主验收档：

- Chrome Stable 或 Edge Stable。
- WebGPU 硬件后端，不使用软件渲染作为最终性能证据。
- 阶段 0 指定一台 Release Reference Device；before/after 必须使用同一台机器、
  同一 GPU、同一浏览器精确版本和同一电源模式。
- 记录 OS build、CPU、GPU/WebGPU adapter info、浏览器版本和是否接通电源。
- 1920×1080，DPR 1。
- render scale 1.0。
- `fpsCap=0`，固定其余 Render Settings，不读取测试前遗留的 localStorage 设置。
- Tab 保持前台可见。
- 20 Mbps 下行、5 Mbps 上行、40 ms RTT。
- 默认 CPU，不做 CPU throttle。
- 每个场景执行 5 次，报告 median 和 worst。

压力档：

- 5 Mbps 下行、1 Mbps 上行、80 ms RTT。
- CPU 4× slowdown。
- 只作为用户体验压力验证；不替代主验收档。

本机无节流档：

- 用来定位 CPU、解码和 GPU 上传瓶颈。
- 不作为公网体验达标的唯一证据。

### 2.2 必须埋点的稳定时间点

使用 `performance.mark()`，命名保持稳定：

- `hf:bootstrap-start`
- `hf:click-gate-visible`
- `hf:intro-complete`
- `hf:title-visible`
- `hf:title-interactive`
- `hf:camp-load-start`
- `hf:camp-assets-ready`
- `hf:character-confirmed`
- `hf:runtime-load-start`
- `hf:runtime-assets-ready`
- `hf:camp-playable`
- `hf:first-stable-frame`

定义：

- `click-gate-visible`：点击门已挂载、可点击。
- `title-interactive`：标题主要按钮可点击，不要求营地已加载。
- `camp-assets-ready`：营地 Scene payload 及其依赖已加载。
- `camp-playable`：角色、Camera、输入、HUD、营地必要几何已就绪，Loading Cover 已隐藏。
- `first-stable-frame`：`camp-playable` 后连续两个 `requestAnimationFrame` 完成。

埋点只执行一次，并在 `window.__hf` 的只读性能快照中暴露，便于浏览器回测。
不要把 Engine App、凭据或可变内部对象挂到全局。

### 2.3 Hard gates

主验收档必须全部达到：

- `navigationStart → hf:click-gate-visible` median `<= 2.0 s`，worst `<= 3.0 s`。
- 自动化快速路径（点击门出现后立即点击并立即跳过 Intro）：
  `navigationStart → hf:title-interactive` median `<= 4.0 s`。
- 正常 15 秒 Intro 不使用 `navigationStart → title` 作为性能门，因为它包含视频时长
  和用户点击等待；改测 `hf:intro-complete → hf:title-interactive <= 0.5 s`。
- 点击门出现前不得请求营地 Scene 的大体积 `body.bin` 依赖。
- 点击门出现前 transfer size `<= 5 MB`。
- 已存在存档、跳过 Intro、最快操作路径：
  `character-confirmed → camp-playable` median `<= 6.0 s`，worst `<= 8.0 s`。
- 正常用户路径（Intro/标题/角色选择期间允许后台预载）：
  `character-confirmed → camp-playable` median `<= 2.0 s`。
- 到 `camp-playable` 的累计 transfer size `<= 35 MB`。
- 到 `camp-playable` 的累计 decoded body size `<= 140 MB`。
- 热缓存 `navigationStart → click-gate-visible` median `<= 1.5 s`。
- `first-stable-frame` 后采样 600 帧：
  1920×1080 median 约 `16.7 ms`、`p95 <= 22 ms`；1280×720 稳定 60 fps，
  且不得出现连续 500 ms 以上卡死。不得低于已完成 PR11 的回归下限。
- Camp 背景加载与 Intro 同时进行时，`getVideoPlaybackQuality()` 的 dropped frame
  比例 `<= 1%`，且视频交互保持响应。
- Loading Cover 进度单调，恰好在隐藏时达到 100%，不得用假进度。
- Campaign 到营地前不得请求 den packs 或 den-only monsters；首次 den 进入走现有
  determinate cover，第二次进入 cover 开销 `<= 300 ms`。
- Console 中没有新的 error、404、WebGPU validation error、
  `pipeline-null`、`shader-not-found`、`render-system-no-camera`。
- 所有要求的视觉与功能回归通过。

除上述绝对目标外，任何 PR11 已有指标相对阶段 0 刷新的 current-main baseline
不得回退超过 5%。

压力档体验门槛：

- 1 秒内出现非空品牌背景或明确加载状态。
- 点击门 median `<= 5 s`。
- 所有等待都显示真实阶段或真实进度，不出现黑屏、无反馈冻结。
- 快速进入路径 `character-confirmed → camp-playable` median `<= 12 s`。

如果经阶段 5 后真实数据证明某个绝对 byte budget 与当前引擎产物不兼容，
只能在 PR 中用完整资源清单和用户时延证据提出调整；不得静默放宽。

---

## 3. 目标启动架构

目标状态机：

```text
host-start
  → ui-shell-ready
  → click-gate-visible
  → intro/title
  → camp-preloading
  → camp-assets-ready
  → character-selected
  → runtime-assets-ready
  → camp-playable
  → far-decor-streaming
  → den-on-demand
```

关键原则：

1. UI readiness 与 World readiness 分离。
2. 预加载只下载/解析 payload；Entity 只实例化一次。
3. 所有入口复用一个 in-flight Promise，避免重复下载和重复实例化。
4. 标题和角色选择阶段主动隐藏网络等待。
5. 营地核心就绪后允许进入；远景和地牢不阻塞首个可玩帧。
6. 最终资产仍使用完整质量；画质降级只作为最后、逐资产验证后的选择。

---

## 4. 分阶段执行

## 阶段 0：建立可复现 baseline

### 动作

1. 创建独立 Games worktree 和分支：
   `laurenceelu/feat-20260820-hellforge-loading-performance`。
2. 记录 Games、Studio、Editor、Engine、Website 的 HEAD。
3. 在 Games worktree 先跑当前静态门并保存 baseline：

```bash
bun test hellforge/src
bun hellforge/scripts/validate-scene-pack.ts \
  hellforge/assets/scenes/rogue-encampment.pack.json
bun hellforge/scripts/validate-blocker-prop-consistency.ts
bunx tsc -p hellforge/tsconfig.check.json
```

测试数不得低于执行前 baseline，且不得低于现有契约 floor `807`。

4. 审计 `hellforge/assets/ui/**/*.webp.meta.json`：当前 Engine image importer
   不支持 WebP cook。确认这些 sidecar 是否进入 Pack scan；任何真实 cook failure
   必须在优化前通过无损 PNG 转换或明确的 direct-copy/exclude 契约解决，不能静默忽略。
   不因本任务重压缩没有 sidecar、仅由浏览器直接加载的正常 WebP。
5. 确认 Studio 已由人工配置 16GB Node heap 后执行 `bun fx restart`，在真实
   `http://localhost:18920` Play 路径采集同一套 cold/warm baseline。
   不修改或提交 `.env`；`:15173` 和独立 viewport 不能替代该产品边界。
6. 使用 Website 的 production adapter 只构建 Hellforge：

```bash
STUDIO_ROOT=/Users/you/dev/ForgeaX-Games/forgeax-studio \
ENGINE_ROOT=/Users/you/dev/ForgeaX-Games/forgeax-studio/packages/editor/packages/play-runtime \
GAMES_DIR=<games-worktree> \
OUT_DIR=/tmp/hellforge-perf-baseline \
ONLY=hellforge \
NODE_OPTIONS=--max-old-space-size=16384 \
node /Users/you/dev/ForgeaX-Games/forgeax-website/scripts/website/build-games.mjs
```

该命令中的 `NODE_OPTIONS` 不是 Bun bake 子进程的可靠内存上限或保证。
执行机必须有足够可用内存；参考官网 workflow，必要时提供受控 swap，并记录峰值 RSS。

7. 用静态 HTTP server 服务
   `/tmp/hellforge-perf-baseline/games/hellforge/`。
8. 保存 server PID；结束时只停止该 PID。
9. 使用真实 Chrome/WebGPU 完成 5 次冷缓存、5 次热缓存测量。
10. 输出：
   - Navigation Timing。
   - Paint Timing。
   - Resource Timing。
   - `transferSize`、`encodedBodySize`、`decodedBodySize`。
   - 每个资源的 duration 和 initiatorType。
   - `pack-index.json` GUID 到 package/body 的映射。
   - 最大 30 个资源。
   - 按 JS、texture body、mesh body、JSON、image、audio、HDR 分类汇总。
11. 采集标题、角色选择、营地、技能、地牢五组基线截图。
12. 保存 Console 和 WebGPU 错误。
13. 用 `hellforge/scripts/play-flow-checklist.md` 记录 Flow A–F 的执行状态；
    性能改动至少完整跑 Flow A、B、D、F。

### 冷/热缓存协议

冷缓存：

- 新 browser context。
- `Network.setCacheDisabled(true)`。
- 清理 browser cache。
- URL 增加唯一 `?perfRun=<id>`。
- 不清理游戏 localStorage；“新用户”和“已有存档”使用不同 context。

热缓存：

- 先完整访问一次作为 primer。
- 保持同一 browser context。
- `Network.setCacheDisabled(false)`。
- 第二次导航使用同一静态资源 URL。

### 完成标准

- 5 次数据都能自动或半自动导出为 JSON。
- 时间点定义一致。
- 基线截图、网络汇总和错误日志齐全。
- 在 `hellforge/docs/evidence/<pr-id>/INDEX.md` 记录机器、浏览器、所有相关 SHA、
  before waterfall、截图路径和 Flow checklist 结果，沿用现有 PR evidence 结构。
- 数据与本计划历史基线大致同量级；若差异超过 20%，先解释环境差异。

---

## 阶段 1：添加低开销测量点

### 主要文件

- `hellforge/main.ts`
- 必要时新增一个小型 `hellforge/src/loading-perf.ts`

### 动作

1. 在稳定生命周期位置写入第 2.2 节 marks。
2. 添加一次性 mark helper，防止重入覆盖。
3. 在 `window.__hf` 中增加只读 `loadingPerf()` 快照：
   - marks。
   - measures。
   - `createPerfProbe().snapshot()`。
4. 不在游戏代码内开启长期 `PerformanceObserver`。
5. 浏览器测试工具负责 Long Task、Resource 和 Navigation 采样。

### 测试

- 重复调用 mark helper 不产生重复 mark。
- Stop/重新 Play 不复用旧运行的 mark。
- 埋点代码不改变 Boot 顺序。

### 完成标准

- Local production bake 中所有 marks 按顺序出现。
- 该 commit 的网络大小和时间与阶段 0 baseline 差异小于噪声范围。

---

## 阶段 2：让点击门和标题不再等待营地

这是最高优先级、无画质损失的改动。

### 主要文件

- `hellforge/forge.json`
- `hellforge/main.ts`
- `hellforge/src/shell.ts`
- `hellforge/src/intro-video.ts`

### 动作

1. 从 `forge.json` 删除 `defaultScene`。
2. 保留 `CAMP_SCENE_GUID` 作为 Hellforge 自己管理的资产 GUID。
3. 把 BootCamera 创建提前到任何营地 await 之前。
4. 把 shared UI、点击门/Intro 挂载提前到任何营地 await 之前。
5. 将“加载 Scene payload”和“实例化 Entity”拆成两个幂等步骤：

```text
ensureCampSceneLoaded(): Promise<SceneAsset>

ensureCampSceneInstantiated(): Promise<{
  scene: SceneAsset
  root: EntityHandle
}>
```

函数要求：

- 第一次 `ensureCampSceneLoaded()` 启动完整 Scene 引用闭包加载。
- 后续 load 调用返回同一个 in-flight/resolved Promise。
- `ensureCampSceneInstantiated()` await payload 后只实例化一次。
- 兼容 `ctx.defaultScene/defaultSceneRoot` 已存在的开发场景。
- 必要时把相对 Pack Index 重新绑定到绝对 URL。
- 保留当前最多两次 retry。
- cleanup 后 Promise 即使完成也不得再向已停止 World 写入。
- 错误保留结构化 code/hint，不能只抛字符串。

这两个单 Scene API 只适用于阶段 6 尚未落地时。若请求风暴要求提前执行阶段 6，
必须在同一 PR 中原子替换为阶段 6 的分层 loader；不得让完整 Scene loader 和分层
loader 同时存活。

6. 点击门挂载后立即 fire-and-forget 启动 `ensureCampSceneLoaded()`。
7. `initializeRuntime()` 在首次读取 `campRoot/campScene` 前调用并 await
   `ensureCampSceneInstantiated()`。
8. 营地背景加载失败时：
   - 点击门/标题仍可显示。
   - 角色确认后 Loading Cover 显示明确失败和“重试”。
   - 重试会创建新的 Promise，但不会重复实例化成功场景。
9. `startedInDen` 的开发入口可以跳过标题，但仍使用同一 Promise。
10. 修正依赖“Host 已实例化 defaultScene”的注释和日志。

### 明确不做

- 不创建第二套营地实体。
- 不保留长期 legacy/new 双路径开关。
- 不把整个 `bootstrap()` 拆成新框架。
- 不在这一阶段改纹理格式或场景内容。

### 测试

- `forge.json` 无 defaultScene 仍通过 Engine Project Schema。
- 并发调用 `ensureCampSceneLoaded()`：load 恰好一次，instantiate 为零。
- 并发调用 `ensureCampSceneInstantiated()`：load 恰好一次，instantiate 恰好一次。
- 背景加载失败后 UI 仍可交互，重试可恢复。
- Stop 时晚到的 Promise 不写入 World。
- Title 期间始终有 BootCamera。
- 没有 `render-system-no-camera`。
- Host 预加载根仅在营地 GUID / `NpcVeyraAnchor` 时复用；den-shaped preload 会真正实例化营地。
- Pack Index 只对相对 URL 做绝对化，已是 `/…` 或带 scheme 的 URL 不 `configurePackIndex`。
- `LoadTracker` 在 `requireCampScene()` 前注册 `camp` 相位，成功后 `completePhase('camp')`。

### 完成标准

- `click-gate-visible` 达到第 2.3 节门槛。
- 点击门之前的网络瀑布不再出现营地依赖的 87 个 body。
- 背景加载没有造成 Intro 明显掉帧；若有，推迟营地 preload 到视频开始后的 idle
  时段，或提前执行 Scene 分层。
- 营地最终画面与 baseline 相同。

若该阶段后点击门仍超过 2 秒，或点击门前 transfer 仍超过 5 MB：

1. 先分解 JS/WASM 下载、解析、WebGPU 初始化时间。
2. 如果主要瓶颈是单一游戏/Engine bundle，进入“条件阶段 A：Host Shell 与代码拆分”。
3. 不要先做 CDN 或 Service Worker。

---

## 阶段 3：利用 Intro、标题和角色选择时间预加载

### 主要文件

- `hellforge/main.ts`
- `hellforge/src/hero-preview.ts`
- `hellforge/src/load-tracker.ts`
- 可能新增一个很小的 `hellforge/src/preload.ts`

### 调度顺序

1. 点击门出现：开始营地 Scene 预载。
2. Intro 播放：继续营地预载。
3. 营地 ready：预载 Veyra 和当前可继续角色的 Hero payload。
4. 标题 idle：分批预载 Wild monster scene/clip 和火山必需资产。
5. 角色选择变化：只预载当前选择职业，不预载所有职业。
6. 角色确认：提升当前角色所需资源的逻辑优先级，并等待剩余必需资源。
7. `camp-playable` 后：再启动 far decor。
8. 接近地牢入口：继续使用现有 `ensureDenLoaded()` 需求加载。

### 实现要求

- 预载只调用 `loadByGuid` 或 fetch 必需 JSON，不提前 spawn gameplay Entity。
- Runtime 使用同一 AssetRegistry，复用已缓存 payload。
- 同一 GUID 的 in-flight 请求去重。
- 以阶段控制独立顶层 GUID 的并发；上限从 4 开始测量，最多 6。
- 当前 AssetRegistry 会用 `Promise.all` 展开一个 Scene 的完整引用闭包，游戏侧并发池
  无法限制该闭包内部约 87 个依赖。若瀑布和 Long Task 仍显示请求风暴，必须提前执行
  阶段 6 的 Scene 分层，或单独设计 Engine 级依赖调度，不能假装游戏侧并发池已经限流。
- Hero clip 可在当前 Hero 组内并行，但组间受并发限制。
- 保留现有 `LoadTracker` 单调进度保证。
- Loading Cover 展示真实阶段：
  `营地`、`角色`、`怪物`、`渲染准备`。
- `camp-assets-ready` 已发生时，角色确认不再重复显示营地阶段。

### 完成标准

- 正常用户路径 `character-confirmed → camp-playable` median `<= 2 s`。
- 快速跳过路径不比阶段 2 更慢。
- 没有请求风暴、重复实例化、角色选择竞态或晚到 preview 覆盖当前选择。
- 预载失败可在正式进入时重试并显示真实错误。
- GUID 并发池上限 4；`whenTitleIdle` 的 `loadByGuid` 峰值 ≤ 4。
- `onCharacterConfirmed()` 后 title-idle 不再启动新的 GUID。
- `{ ok: false }` 不得当作已预热；封面在 `camp-assets-ready` / `isLoaded()` 时显示「角色」而非「营地」。
- 不得把 den-only monster GUID 放进 title idle。

---

## 阶段 4：KTX2/Basis 单资源能力探针

不要直接批量修改所有 GLB。

### 探针资源

先选择一个普通营地 prop，要求：

- 有 sRGB albedo。
- 有 linear normal/ORM。
- 当前为 1024×1024。
- 不影响角色、地面和关键 UI。

### 动作

1. 只给该 GLB sidecar 增加：

```json
{
  "importSettings": {
    "defaultSceneIndex": 0,
    "compressionMode": "auto",
    "mipmap": true
  }
}
```

2. 执行 cold cook，确认 DDC 没有复用旧 raw 产物。
3. 检查产物：
   - media type 为 `image/ktx2`。
   - asset codec 为 Basis。
   - sRGB 进入 ETC1S，linear 进入 UASTC。
   - KTX2 header `levelCount > 1`。
   - Runtime TextureAsset `mipLevelCount > 1`。
4. 在真实 WebGPU 运行并检查：
   - Runtime 仍报告 `mipLevelCount > 1`。
   - 没有 `mipgen-unsupported-compressed-format`；但“不报错”本身不算通过，
     因为 Pack loader 可能把单层 KTX2 静默改为 `mipmap:false`。
   - 没有 WebGPU format/upload validation error。
   - BC、ASTC、ETC fallback 至少通过仓库已有的能力测试矩阵。
5. 执行一次 glTF reimport round-trip，确认 sidecar 的
   `compressionMode` 和 `mipmap` 保持不变。

### 预期分支

当前源码很可能生成 `levelCount === 1`，因为 `mipGen` 被硬编码为 `false`；
Runtime 可能静默关闭 mip，也可能在其他投影路径触发结构化错误。
如果发生：

- 停止 Games 批量压缩。
- 不用 `mipmap:false` 作为世界材质的全局生产方案。
- 进入“条件阶段 B：Engine 离线 mip 前置”。

如果 reimport 丢失 `compressionMode/mipmap`，同样进入条件阶段 B。
只有 mip 和 reimport 两个探针都通过后才能进入阶段 5。

---

## 条件阶段 B：Engine 离线 mip 与 reimport 契约前置

该阶段只在阶段 4 失败时执行，并使用独立 Engine/Editor/Studio PR。
Hellforge 当前 `AGENTS.md` 明确禁止游戏执行者直接修改 Engine：

- Grok 在本执行中先产出 Engine handoff，包含复现、目标契约、建议文件和测试。
- 把 handoff 交给 Engine owner，等待其 PR 合入。
- 等 Editor/Studio pin 收敛后，从阶段 4 探针恢复。
- 等待期间可以继续阶段 6 的 Games 场景分层，但不得以 `mipmap:false`
  批量发布世界材质来绕过前置。
- 只有用户另行授权跨仓实现并确认 owner 流程后，才执行下面的 Engine 改动建议。

### 目标

让 `compressionMode != none` 且 `mipmap:true` 的 PNG/JPEG 和 GLB 嵌入贴图，
在 build time 生成包含完整 mip chain 的 KTX2，并让 Runtime 正确上传；
glTF reimport 必须保留这两个 sidecar 设置。

### Engine 可能改动点

- `packages/image/src/ktx2-encode.ts`
- `packages/vite-plugin-pack/src/index.ts`
- `packages/image/src/image-importer.ts`
- `packages/codec/src/encode/basis-encode.ts`
- `packages/gltf/src/parse-gltf.ts`
- `packages/gltf/src/reimport-reuse-meta.ts`
- KTX2 parser/transcoder/runtime upload 相关测试

### 技术要求

1. 将“是否生成 mip”作为明确输入，而不是对所有纹理强制开启。
2. `importSettings.mipmap:true` 传递到 Basis encoder `mipGen:true`。
3. `mipmap:false` 保持单层。
4. KTX2 parser 保留 level count、每层尺寸和偏移。
5. Runtime 转码后保留每层数据，不触发运行时 mip generation。
6. DDC fingerprint 必须包含 mip 设置，避免旧产物污染。
7. ETC1S、UASTC-LDR 都覆盖 mip。
8. HDR equirect 继续保持 raw `rgba16float`；它用于 cubemap projection，
   不能因本工作改成 sample-only block-compressed render target。
9. glTF sidecar reimport 保留 `compressionMode` 和 `mipmap`，与
   `downscaleMaxDimension` 一样进入 round-trip 契约。

### 必须新增/通过的测试

- `mipmap:false` 编码得到 `levelCount === 1`。
- `mipmap:true` 编码得到完整 `floor(log2(max(width,height))) + 1` 层。
- glTF embedded texture 集成测试。
- glTF sidecar reimport round-trip 测试。
- standalone image sidecar 集成测试。
- Runtime `deriveRenderDataTexture` 接受有离线 mip 的压缩 TextureAsset。
- BC、ASTC、ETC2 capability 分支测试。
- 真实 Dawn/WebGPU 上传测试。
- 现有未压缩纹理、HDR、材质和场景测试无回归。

### 集成顺序

Engine → Editor pin → Studio pin。

每一层先跑本仓 `bun fx ci` 或该仓完整 CI，再合入，再更新下游 pin。
Website Games bake 使用 Studio play-runtime；在 Studio main 未获得新 Engine pin 前，
不得进入 Games 批量 KTX2 发布。

### 完成标准

- 阶段 4 探针在最终 Studio main pin 上通过。
- 所有跨仓 PR 合入 main。
- 最终 Games PR 不依赖 off-main pin。

---

## 阶段 5：分批启用 GPU-native 纹理

进入本阶段时，批准的 GLB sidecar 统一保留：

- `downscaleMaxDimension: 1024`：当前资源已经是 1K，因此不降低当前画质，
  同时防止误恢复 2K 再次触发 cook OOM。
- `mipmap: true`：仅在条件阶段 B 的离线 mip 契约已由最终 Studio pin 提供后启用。
- `compressionMode`：按下面资产分级选择。

### 资产分级

第一类：关键近景，优先质量

- Hero。
- Veyra/NPC。
- 营火和高亮 emissive 道具。
- 玩家近距离观察的地面和建筑主体。
- 选择界面的角色预览。

默认尝试 `compressionMode: "uastc"`。

第二类：普通环境道具

- 木箱、围栏、石块、树枝、一般屋顶、火山锥、地牢重复件。

默认尝试 `compressionMode: "auto"`：

- sRGB → ETC1S。
- linear normal/ORM → UASTC。

第三类：保持原路径

- HDR equirect。
- 需要作为 render target 的纹理。
- 经实测在压缩后出现不可接受色带、法线错误或 alpha 问题的单个资产。

### 批次

每批最多 5 个 GLB：

1. 普通远景 camp props。
2. 普通近景 camp props。
3. 火山和 wild props。
4. den props。
5. NPC/monster。
6. Hero 和高关注资产最后处理。

每一批都必须：

1. Cold cook。
2. 输出 raw→KTX2 的字节差异。
3. 检查 mip count。
4. 跑营地和地牢视觉回归。
5. 跑冷/热加载抽样。
6. 单独 commit 或至少保持可单批回退。

### 画质升级策略

如果 `auto` 的 ETC1S 在某个 albedo 出现明显 banding/blocking：

1. 仅把该 GLB 切换为 `uastc`。
2. 重新比较网络和画质。
3. 只有 UASTC 仍不合格时，该资产保留 `none`。

不要为了少量关键资产让整个项目退回 raw。

### 完成标准

- 到 `camp-playable` 的 transfer/decoded bytes 达到第 2.3 节预算。
- GPU 上传阶段显著缩短。
- 无缺 mip 导致的远景闪烁和纹理噪点。
- 关键画面无可感知退化。

---

## 阶段 6：按需拆分营地 Scene

这是可提前的条件分支。出现以下任一情况即可执行：

- 阶段 2/3 的完整 Scene 引用闭包导致请求风暴、Intro 掉帧或明显 Long Task。
- 阶段 5 后仍未满足 camp playable 时延或 byte budget。

当前 `rogue-encampment.pack.json` 约 188 个 Entity，并通过 refs 递归带入多组
mesh/material/texture。加载根 Scene 会加载其完整引用闭包。

### 目标分层

`camp-core`：

- Ground。
- 出生点和必要 Anchor。
- 营火核心。
- 必要灯光编辑占位。
- Camera/交互依赖的最小实体。

`camp-near`：

- 初始相机视锥内的建筑、Veyra、传送门和近景装饰。

`camp-far`：

- 远景屋顶、树木、外围围栏、散布物。

`den`：

- 继续保持接近入口或区域切换时加载。

### 实现要求

1. 先确认场景的 authoring/generator SSOT。
2. 修改 SSOT 并重新生成；不要直接手工维护 6500 行 pack JSON。
3. 不提交 `.forgeax/workbench` 的个人运行时状态。
4. 每个 Scene pack 的 refs 只包含该层实际使用的资源闭包。
5. 保持 localId/Anchor/Name 契约稳定。
6. `camp-core + camp-near` ready 后允许 `camp-playable`。
7. `camp-far` 在可玩后使用 idle/rAF 小批实例化，避免一个长任务。
8. 利用现有黑暗、雾气和远裁剪隐藏 far decor 淡入，但最终效果必须一致。
9. 不在玩家视线中心突然弹出大型建筑。
10. 阶段 6 是阶段 2 单 Scene 契约的明确替代，而不是叠加层。原
    `CAMP_SCENE_GUID` 完整 Scene 必须退出 runtime 路径，不能再与 layers 一起加载。
11. 分层 loader 契约：

```text
ensureCampLayerLoaded('core' | 'near' | 'far'): Promise<SceneAsset>
ensureCampLayerInstantiated('core' | 'near' | 'far'): Promise<LayerRoot>
ensureCampPlayableInstantiated(): Promise<{ core: LayerRoot; near: LayerRoot }>
ensureCampFarInstantiated(): Promise<LayerRoot>
```

12. 每层有独立的 in-flight/resolved Promise 和 exactly-once instantiate；
    `ensureCampPlayableInstantiated()` 只聚合 `core + near`，far 不得被它隐式拉入。
13. cleanup 统一释放所有已实例化 layer roots，并使晚到 Promise 失效；Stop→Play
    不得复用上一个 World 的 handle。
14. `LoadTracker` 分别记录 core/near/far 的真实权重；进入可玩态只要求 core/near
    完成，far 使用独立后台进度且不让主 Cover 回退。

如果没有可复现的场景生成 SSOT：

- 停止手改 pack。
- 先补一个确定性生成/拆分入口及测试。
- 生成两次必须 byte-identical。

### 完成标准

- `camp-core + camp-near` 的引用闭包显著小于原根 Scene。
- 并发调用每个 layer 的 load/instantiate 仍各执行一次；
  `ensureCampPlayableInstantiated()` 不请求 far，网络中不再出现旧完整 Scene GUID。
- Stop→Play 后旧 layer roots 全部释放，晚到的 far Promise 不写入新 World。
- 首个可玩帧不等待 far/den。
- far decor 全部完成后，Entity 数、关键 Name、材质和最终截图与 baseline 对齐。
- 区域切换、Camera probe、fade blocker、导航和 NPC Anchor 均无回归。

---

## 阶段 7：选择性降尺寸

只在阶段 6 后压力档仍不达标时执行。

### 规则

- 先用实际屏幕覆盖率判断，不按文件名猜。
- Hero、NPC、Ground、营火、近景建筑保持原分辨率。
- 长期只占几十像素的外围石块、树枝、围栏和小型散布物可以尝试
  `downscaleMaxDimension: 512`。
- 一次只调整一个资产组。
- 每次都做静态截图和运动中的 mip/shimmer 检查。

### 完成标准

- 压力档加载有可测改善。
- 1920×1080 和高 DPI 实机观察无可感知退化。
- 任一明显变糊资产立即恢复原尺寸或提升到 1024。

---

## 条件阶段 A：Host Shell 与代码拆分

仅当阶段 2 后 `click-gate-visible` 仍受 JS/Engine 启动限制、无法达到 2 秒，
或点击门前 transfer 仍超过 5 MB 时执行。

### 目标

在大型 game module 执行前，由 standalone HTML 显示一个轻量、可访问的 Hellforge
品牌加载层；必要时把真正可交互的 click gate 和大型 Engine/game chunk 拆开，
Game UI ready 后无闪烁接管。

### 边界

- 归属 build-standalone 或 Website adapter，不能在每次 bake 后手改输出文件。
- 首屏只包含必要 HTML/CSS 和一张经过优化的 title background。
- 不复制完整角色选择和 Gameplay UI。
- 必须支持 WebGPU 不可用提示。
- 不因静态 shell 延迟 module preload。
- 接管后移除静态 DOM，不能留下双层点击区域。
- 如果只是提前显示静态品牌画面、真正点击门仍等待完整 bundle，则只满足
  “1 秒内有反馈”，不能视为通过 `click-gate-visible` 的时间或 byte hard gate。
- pre-click byte 超标时必须使用 dynamic import/code split，把真正点击门放入轻量 chunk；
  纹理 KTX2 无法解决点击门之前的 JS/WASM 体积。

### 完成标准

- 压力档 1 秒内出现品牌首屏。
- module 仍并行下载。
- 点击门接管无 layout shift、闪白或重复交互。
- Cow Survivor 等其他 demo 不受影响；若做成通用能力，必须有通用测试。

---

## 阶段 8：官网 bake 使用不可变输入并记录 provenance

这是生产发布的必做 Website 前置 PR，不是可选优化。

### 主要文件

- `forgeax-website/.github/workflows/build-demos.yml`
- 必要时新增一个小型 provenance 生成脚本和测试

### 动作

1. 为 `workflow_dispatch` 增加 `games_ref`、`studio_ref` 输入。
2. 本次 production bake 要求输入完整不可变 commit SHA；拒绝只填写浮动 `main`。
3. Games checkout 使用 `games_ref`，Studio checkout 使用 `studio_ref`。
4. Checkout 后立即记录实际 SHA：
   - Games。
   - Studio。
   - Studio 递归 pin 的 Editor。
   - Editor 递归 pin 的 Engine。
5. 生成 machine-readable provenance JSON，并通过
   `actions/upload-artifact@v4` 保存；不得包含 token、远端 URL 凭据或环境机密。
6. 自动 `repository_dispatch` 可以保留其现有触发语义，但同样必须记录最终实际 checkout
   SHA；本次手工 production release 只接受显式 immutable inputs。
7. PR 测试必须证明 checkout `ref` 来自输入，而不是始终跟随 main。
8. 更新 `restore-live-games.yml` 为单游戏恢复：
   - 增加严格 choice/allowlist 的 `game_path` 输入，并包含 `games/hellforge`。
   - 只从 `source_commit` checkout 所选路径，不再一次恢复整个 games 列表。
   - 校验所选路径的 `index.html` 存在，且 staged diff 只能位于该精确目录。
   - 一次原子 commit/push；Hellforge 回滚不得覆盖其他游戏的新版本。

### 完成标准

- 给定相同 Games/Studio SHA 可以复现同一套递归源码输入。
- Artifact 明确包含四仓 SHA。
- `Restore live game artifacts` 可以只恢复 Hellforge，拒绝白名单外路径，
  并通过测试证明其他 games 工作树内容保持不变。
- 官网验收报告引用 workflow run URL 和 provenance artifact。

---

## 5. 回测与回归矩阵

## 5.1 静态/单元验证

Games：

- `bun test hellforge/src`，通过数不低于执行前 baseline 和契约 floor `807`。
- `bun hellforge/scripts/validate-scene-pack.ts
  hellforge/assets/scenes/rogue-encampment.pack.json`。
- `bun hellforge/scripts/validate-blocker-prop-consistency.ts`。
- `bunx tsc -p hellforge/tsconfig.check.json`。
- `LoadTracker` 单调进度测试。
- Camp preload 幂等、失败重试、Stop 竞态测试。
- Shell 状态转换测试。
- 资源 GUID 和 pack refs 完整性检查。

Engine 条件 PR：

- Image、Codec、glTF、Vite Pack、Assets Runtime、Render 相关测试。
- Package typecheck。
- Dawn/WebGPU compressed texture tests。
- 对应仓完整 `bun fx ci`。

Studio/Editor pin：

- 按仓库规则运行完整 `bun fx ci`。
- Studio 真实 `:18920` Play 路径验证 Hellforge。

Website：

- `ONLY=hellforge` production bake。
- `games/manifest.json` 中 Hellforge `ok:true`。Hellforge 当前不在 Website
  `data/curation/games.json` 的 `source[]`，因此不要求 `sourceOk:true`。
- Scrub 和 public output gate。
- workflow dispatch 的 immutable ref/provenance 测试。
- restore workflow fixture：只恢复 `games/hellforge`，其他 game 文件 hash 不变；
  白名单外路径和缺少 `index.html` 均拒绝。

## 5.2 功能回归

逐项人工或浏览器自动化：

以 `hellforge/scripts/play-flow-checklist.md` 为现有 SSOT，执行真实
`http://localhost:18920` Studio Play；`:15173` curl 和独立 editor viewport
不能替代产品路径验收。

- 点击门出现并可点击。
- PV 播放、跳过、缺资源 fallback。
- Title 新游戏、继续、设置。
- CharSelect preview、职业切换、确认。
- CharList preview、继续已有角色。
- 存档写入、刷新、继续。
- 进入营地。
- Camera、移动、点击地面。
- 点击光效、怪物脚底环、技能 VFX。
- NPC 对话和任务。
- Wild monsters 和掉落。
- 进入 Slagdeep、Boss、返回。
- BGM/SFX 在首次用户手势后正常。
- Stop/再次 Play 不残留 UI、Entity、Promise 或音频。
- WebGPU 不可用时显示正确 Guard。

## 5.3 视觉回归

固定条件：

- 1920×1080，DPR 1，render scale 1。
- 固定角色、固定世界 seed、固定 Camera。
- 动态粒子区域可 mask，但主体材质不可 mask。

截图点：

1. Click gate/Intro。
2. Title。
3. CharSelect 正面与旋转视角。
4. Camp spawn。
5. Ground、hut、fence、tree、campfire 近景。
6. 远景斜视角，重点观察 mip shimmer。
7. Wild skill/VFX。
8. Den floor、wall、slag 和 Boss。

检查：

- 色彩空间没有改变。
- Albedo 无明显 ETC1S block/banding。
- Normal 没有翻转、变平或通道错误。
- ORM 金属度/粗糙度一致。
- Alpha/emissive 一致。
- 远景无缺 mip 闪烁。
- 最终 far decor 全部加载后构图一致。

自动像素比较只作为提示，因为 WebGPU、粒子和抗锯齿可能存在小幅非确定性；
最终必须由同机 side-by-side 和快速闪切确认。

## 5.4 性能回测

每阶段至少采集：

- 5 cold。
- 5 warm。
- 新用户流程。
- 已有存档最快流程。
- 正常 Intro/选择流程。
- 主验收网络。
- 压力网络至少 3 次。

输出：

- 每个稳定 mark 的 median/worst。
- 到 click gate、title、camp playable 的累计 transfer/encoded/decoded bytes。
- 最大资源及资产 GUID/source 映射。
- Long Task 总数、总时长、最长任务。
- `createPerfProbe` 600 帧 snapshot。
- `first-stable-frame` 时先 reset probe；浏览器 harness 另行记录最大 rAF gap、
  `>=500ms` gap 次数，不能只依赖当前 snapshot。
- Intro `totalVideoFrames/droppedVideoFrames`。
- Console/WebGPU errors。

Resource Timing `decodedBodySize` 只代表 HTTP content-encoding 解码后的响应体：
KTX2 仍按 KTX2 container 字节计算，它不是转码后的 GPU texture 大小。
浏览器 Web API 无法可靠直接给出跨设备 GPU 显存占用。
不要伪造 GPU memory 数字；使用 KTX2 level/format 的理论字节、实际上传格式、
进程内存和 decoded payload 作为明确标注的代理指标。

---

## 6. 防回归门

在 Website production bake 后增加或运行静态产物审计：

- Hellforge 可执行 build 存在。
- pack-index 所有引用可达。
- 优化名单内的 texture body 使用预期 KTX2/Basis codec。
- 不允许优化名单重新出现 4 MiB raw RGBA body。
- 优化名单对应的 GLB sidecar 必须仍声明批准的 `compressionMode/mipmap`。
- KTX2 mip level count 合法。
- Hellforge 总产物和 camp critical closure 不超过批准预算。
- 没有 `/assets/assets/` 双路径。
- 没有 404 引用。

时间预算不建议直接作为共享 GitHub Runner 的硬 CI gate，因为 runner 和无硬件 WebGPU
会产生较大噪声。CI 使用确定性的 byte/codec/refs gate；真实时延作为发布验收 gate。

---

## 7. Production 发布与线上复验

### 发布前

1. 所有功能 PR 已合 main。
2. Engine 条件链已收敛到 Engine/Editor/Studio main。
3. Games 分支合入前同步 `origin/main` 使用 merge，不 rebase。
4. Games production bake 使用最终 main pins 再跑一次。
5. Website workflow 支持本次发布输入明确的 Games SHA 和 Studio SHA，
   并产出 provenance JSON/Artifact，至少记录 Games、Studio、Editor、Engine SHA。
6. 本文全部 Hard gates 通过。

### 官网烘焙

1. 在 `forgeax-website` 触发 `Build live demos` / `build-demos.yml`。
2. 以不可变 commit SHA 传入 Games、Studio ref；不要只传浮动 `main`。
3. 保存 workflow provenance：Games、Studio，以及 Studio 递归
   Editor/Engine submodule SHA。
4. 等待 Build games、Gate games build report、Scrub、Push 全部成功。
5. 等待 GitHub Pages 内容可访问。
6. 不以 workflow 绿色代替浏览器验收。

### 线上复验

对正式 URL 重复：

- 5 cold。
- 5 warm。
- 主验收网络。
- 已有存档快速进入。
- 完整功能 smoke。
- Console/404/WebGPU gate。
- 标题、营地、VFX、地牢截图。

CDN/Pages 缓存可能短暂保留旧资源。通过 workflow checkout SHA、资源文件名、
响应时间和资源 body 大小确认测试的是新 bake。

### Rollback

出现以下任一情况立即回滚：

- Load failure 或黑屏。
- 缺 mip、严重闪烁或关键画质下降。
- WebGPU validation error。
- 线上时延比本地 production bake 劣化超过 30% 且不能由网络解释。
- 关键流程或 VFX 回归。

回滚方式：

- 优先使用阶段 8 的单游戏 `Restore live game artifacts`，选择
  `game_path=games/hellforge`，输入已知良好的 `forgeax.github.io` 40 字符 commit SHA，
  并在恢复后立即跑 live smoke；不得连带恢复其他游戏。
- Revert 对应 Games PR 并重新 bake。
- 单个压缩资产失败时优先将该 sidecar 回到 `none`，不撤掉已验证成功的全部资产。
- Engine 能力回归时按 Engine→Editor→Studio 顺序 revert pin，再重烘焙。
- 不在生产分支保留临时兼容 shim。

---

## 8. 迭代决策树

每次只回答一个问题：

1. 点击门是否 `<= 2 s`，且点击门前 transfer `<= 5 MB`？
   - 否：完成阶段 2；仍失败则分析 JS/WASM/Engine，进入条件阶段 A。
2. 正常角色确认到可玩是否 `<= 2 s`？
   - 否：完成阶段 3。
3. Scene 闭包是否造成请求风暴、Intro 掉帧或明显 Long Task？
   - 是：提前执行阶段 6。
4. 到 camp playable 的 bytes 是否达标？
   - 否：阶段 4 探针。
5. 探针是否有完整 mip，且 reimport 保留压缩设置？
   - 否：条件阶段 B。
6. 批量 KTX2 后 bytes/时延是否达标？
   - 否：阶段 6 场景分层。
7. 压力档是否仍失败？
   - 是：阶段 7 选择性 512。
8. Website immutable refs/provenance 是否完成？
   - 否：阶段 8。
9. 本地全部达标？
   - 是：PR、CI、线上 bake、同协议复验。
10. 线上未达标？
   - 比较本地/线上 waterfall，定位 CDN、cache header、构建 pin 或产物差异，
     修复后重新 bake；不得只增加 spinner。

---

## 9. 建议的 commit/PR 切分

Games：

1. 加载性能 marks 和 baseline harness 对接。
2. 移除 blocking defaultScene，先显示 UI。
3. 标题期后台预载和真实进度。
4. KTX2 单资源 probe。
5. 环境资产分批 KTX2。
6. 条件性的 camp 分层。
7. 条件性的远景尺寸优化。
8. 资源预算和回归 gate。

Engine 条件链：

1. Engine 离线 KTX2 mip、glTF reimport 契约及测试。
2. Editor pin。
3. Studio pin。

Website 必做：

1. Immutable Games/Studio refs 与四仓 provenance artifact。
2. 静态资源预算审计。

Website 条件改动：

1. Host Shell/code split，仅在阶段 2 无法通过时延或 pre-click byte 门时。

每个 PR 描述都必须包含：

- Why。
- Change。
- Before/after。
- Test plan。
- Visual evidence。
- Risk。
- Rollback。
- 相关上游/下游 PR 链接。

---

## 10. 最终交付报告模板

```text
Hellforge Loading Production Report

Shipped SHAs
- Games:
- Engine:
- Editor:
- Studio:
- Website workflow run:
- Provenance artifact:
- Public bake commit:

User-visible result
- Cold click gate median/worst:
- Warm click gate median/worst:
- Normal confirm→playable median/worst:
- Fast confirm→playable median/worst:

Payload
- Before/after transfer to click gate:
- Before/after transfer to camp playable:
- Before/after decoded bytes:
- Raw RGBA texture bodies before/after:
- KTX2 ETC1S/UASTC counts:

Runtime
- Frame median/p95:
- Max rAF gap / >=500ms gaps:
- Intro dropped/total video frames:
- Long tasks:
- Console/WebGPU errors:

Quality
- Screenshot set:
- Assets promoted from auto to UASTC:
- Assets intentionally left uncompressed:
- Assets selectively downscaled:

Gates
- Unit:
- Production bake:
- Functional smoke:
- Visual regression:
- Live cold/warm:

Remaining risks
- ...
```

只有报告完整且第 2.3 节全部通过，才可宣称 `production-ready`。
