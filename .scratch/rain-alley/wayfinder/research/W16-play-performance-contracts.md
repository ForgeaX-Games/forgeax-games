# W16 — Studio与游戏包里现有的性能验收合同是什么

## 结论

游戏仓里的 `package.json#forgeax.metrics` 是 **Engine 五类 MetricKind 声明**（必须五键齐全，`enabled=false` 时写 `reason`），**不是** Studio Play 的帧率门。Hellforge、FPS Gym、Rain Alley 以及 Engine 四个 `templates/game-*` **全部关掉** `bundle-size` / `fps` / `bench` / `gate` / `spike-report`。真正会量 FPS 的是 Engine 仓自己的 `apps/hello/*` 一类宿主，经 `scripts/metrics/run-fps.mjs` 走 vite preview；Studio 主 CI 的 boot+Play smoke **不要求 GPU 帧或 FPS**。Rain Alley 白盒把五类全禁用，并把 `gate` 的理由写成「Studio Play owns runtime acceptance」——那只是声明，**没有**配套的包内 fps/bundle CI。

本票只记现有合同，不写新门。

## 1. MetricKind 合同（Engine 仓，不在 games CI）

Closed union 顺序锁定：`bundle-size` / `fps` / `bench` / `gate` / `spike-report`。每个 workspace 必须在 `package.json#forgeax.metrics` 声明全部五项；`enabled=true` 或 `false`+非空 `reason`；未声明 / 拼写错误 / 非 `ok` 会挡 Engine PR。[engine/AGENTS.md:207-209](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/AGENTS.md#L207-L209) [engine/forgeax-metrics.schema.json:4-8](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/forgeax-metrics.schema.json#L4-L8)

含义（schema 正文，不是游戏仓另立的标准）：

| kind | 启用时测什么 |
|:--|:--|
| `bundle-size` | 某 `dist` 产物 gzip/brotli 体积，对 `baseline.threshold`（字节） |
| `fps` | vite preview 稳态帧率；可选 `sampleCount` / `frameCount`（默认 5×120）；`compareKey` 为 `median`（默认）或 `p95` |
| `bench` | vitest bench / 可选 pixel-parity |
| `gate` | 子进程退出码（smoke / grep 一类） |
| `spike-report` | 尖峰研究产物树 |

[engine/forgeax-metrics.schema.json:14-32](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/forgeax-metrics.schema.json#L14-L32) [engine/forgeax-metrics.schema.json:103-123](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/forgeax-metrics.schema.json#L103-L123)

`run-fps.mjs`：`--app` 默认 `apps/hello/triangle`；`fps.enabled !== true` 时打印 skip 并 **exit 0**。有 baseline 时：median 或 p95 低于 `threshold` → `noisy` → 失败。无 baseline 时只要采到样本即 `ok`。[engine/scripts/metrics/run-fps.mjs:19-21](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/scripts/metrics/run-fps.mjs#L19-L21) [engine/scripts/metrics/run-fps.mjs:88-93](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/scripts/metrics/run-fps.mjs#L88-L93) [engine/scripts/metrics/run-fps.mjs:161-166](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/scripts/metrics/run-fps.mjs#L161-L166)

**启用 fps 的例子（Engine apps，不是共享游戏库）：** `@forgeax/hello-triangle` 开了 `fps`（5×120，无 threshold）和 `gate`（`pnpm --filter @forgeax/hello-triangle smoke`）。[engine/apps/hello/triangle/package.json:25-36](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/apps/hello/triangle/package.json#L25-L36)

**未启用的 P95≥60 先例：** `apps/parity/instancing-static` 的描述写明 AC-09「10000 cubes、P95≥60 fps」，但 `fps`/`gate` 因 swiftshader 假绿与软件路径过慢而 `enabled: false`。[engine/apps/parity/instancing-static/package.json:7](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/apps/parity/instancing-static/package.json#L7) [engine/apps/parity/instancing-static/package.json:21-31](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/apps/parity/instancing-static/package.json#L21-L31)

forgeax-games 的 CI 只有 `bun-guard`，不跑 Engine `run-all` / `run-fps`。[.github/workflows/bun-guard.yml:1-13](../../../.github/workflows/bun-guard.yml#L1-L13) 根 `package.json` 自称 data-only、无引擎。[package.json:8](../../../package.json#L8)

本 worktree 下 **没有任何游戏** `metrics.*.enabled === true`（`go-karts` / `hillside-3` / `npc-render-acceptance` 甚至没有 `forgeax.metrics` 块）。声明存在只是为了形状对齐 Engine 模板，不是可执行验收。

## 2. Rain Alley / Hellforge / FPS Gym 声明了什么

### Rain Alley（全部关闭）

[rain-alley/package.json:16-36](../../../rain-alley/package.json#L16-L36)

| kind | enabled | reason |
|:--|:--|:--|
| `bundle-size` | false | `whitebox game` |
| `fps` | false | `whitebox game` |
| `bench` | false | `whitebox game` |
| `gate` | false | `Studio Play owns runtime acceptance` |
| `spike-report` | false | `not a spike app` |

包脚本只有 `typecheck` 与 `bun test tests`，没有 metrics runner。[rain-alley/package.json:8-10](../../../rain-alley/package.json#L8-L10)

白盒规格把「性能红线」写成 **可观察行为**（禁止每枪重建场景、闲置武器离相机/骨骼、VFX/枪声池化、动态灯可自适应），自动化 seam 明确是 **无 WebGPU 的规则单测**；Chrome 三段走通是后续人签，不在本包 CI。[rain-alley/docs/SPEC.md:104-113](../../../rain-alley/docs/SPEC.md#L104-L113)

### FPS Gym（`fps/`，Sector Strike）

与多数模板拷贝相同：五类全 `false`。`fps` reason：`template has no independent smoke gate`；`gate` reason：`no CI gate on template scaffold; apps/preview hosts acceptance`。[fps/package.json:17-37](../../../fps/package.json#L17-L37)

README 只讲 GUID/脚手架，没有数值 FPS 门。[README.md:73-77](../../../README.md#L73-L77)

### Hellforge

同样五类全关，措辞是 sample game：`fps` → `sample game; no independent smoke gate yet`；`gate` → `no CI gate on sample games`；`bundle-size` → `sample game; size is downstream of apps/preview`。[hellforge/package.json:15-20](../../../hellforge/package.json#L15-L20)

Play **操作前提**（不是 MetricKind）：Node 堆 ≥ 16GB（`NODE_OPTIONS=--max-old-space-size=16384`），否则 cook OOM；浏览器路径 `localhost:18920 → hellforge → Play`。[hellforge/README.md:7-18](../../../hellforge/README.md#L7-L18)

`LOADING-PERFORMANCE-EXECUTION-PLAN.md` 里有营地加载时延/体积和「600 帧、1080p p95≤22ms、720p 稳 60」等 **计划硬闸**，未接到 `package.json#forgeax.metrics`。[hellforge/LOADING-PERFORMANCE-EXECUTION-PLAN.md:251-271](../../../hellforge/LOADING-PERFORMANCE-EXECUTION-PLAN.md#L251-L271)

旧白盒票 14 是 **人签发布红线**（macOS Chrome WebGPU、8–12 分钟打通、连射可瞄准、特效不摘、不改 Hellforge 16GB 前提），不是 metrics 开关。[.scratch/rain-alley/issues/14-chrome-webgpu-fps-gate.md:3-23](../../issues/14-chrome-webgpu-fps-gate.md#L3-L23)

## 3. Engine `templates/game-*`（rain-alley-play pin）

四份模板全部 `metrics.*.enabled: false`：

| template | fps reason | gate reason |
|:--|:--|:--|
| `game-empty` | template has no independent benchmark harness | browser acceptance is owned by the exact SDK verifier |
| `game-default` | template has no independent smoke gate | CI acceptance is owned by the apps/preview host; the template has no standalone runner |
| `game-3d` | template has no independent benchmark harness | browser acceptance is owned by the exact SDK verifier |
| `game-brotato-3d` | template has no independent benchmark harness | browser acceptance is owned by the Preview host |

[engine/templates/game-empty/package.json:12-32](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/templates/game-empty/package.json#L12-L32) [engine/templates/game-default/package.json:22-42](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/templates/game-default/package.json#L22-L42) [engine/templates/game-3d/package.json:16-36](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/templates/game-3d/package.json#L16-L36) [engine/templates/game-brotato-3d/package.json:17-37](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/templates/game-brotato-3d/package.json#L17-L37)

共享库里 `fps/`、`game-2048`、`aetherfall-odyssey` 等多数包直接复用 `game-default` 那套 reason 字符串。Rain Alley 是少数把 `gate` 改成 Studio Play 语义的包，仍全部 `enabled: false`。

## 4. Studio Play-smoke 与其它宿主合同

### 主 CI editor smoke（不测 FPS）

Studio `testing.md`：Boot（onboarding 打开 editor `games/sample`，再 File → New Game 选 engine `game-default`）+ Play（点 in-process `play-terminal-play`，等 6 秒）。失败条件是 **非 WebGPU/Vite 冷启动噪声的 page/console error**。对应 editor 正式 `smoke-play`，**不跳转 standalone `/preview/`，也不要求 GPU 帧或 FPS**。本地：`bun run test:studio-smoke-contract` / `test:studio-smoke`。[packages/harness/docs/testing.md:64-81](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/harness/docs/testing.md#L64-L81)

实现注释重复同一边界：WebGPU-tolerant，boot 与 6 秒 Play 后只查 allowlist 外的 console 错。[packages/studio-qa/README.md:239-243](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/studio-qa/README.md#L239-L243) [packages/studio-qa/src/editor-smoke.mjs:1-5](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/studio-qa/src/editor-smoke.mjs#L1-L5) [packages/studio-qa/src/editor-smoke.mjs:19-20](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/studio-qa/src/editor-smoke.mjs#L19-L20)

Editor 仓 `smoke-play` 是 CI **parent job**（core/breadth/editor shard 聚合），不是游戏包 `forgeax.metrics.gate`。[packages/editor/scripts/ci/smoke-play-bundles.mjs:1-8](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/scripts/ci/smoke-play-bundles.mjs#L1-L8)

### 可选 `studio-qa` 全游戏 standalone Play

`pnpm -F @forgeax/studio-qa qa`：每个已发现游戏的独立 Play 表面截 WebGPU canvas，分类 `SHOT` / `CRASH` / `HANG` / `UNREACHABLE`。`SHOT` = 采到一帧；**渲染对不对靠人看 PNG，没有 FPS 阈值**。[packages/studio-qa/README.md:227-237](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/studio-qa/README.md#L227-L237) [packages/studio-qa/src/run.mjs:1-5](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/studio-qa/src/run.mjs#L1-L5)

目标来自 `.forgeax/games` 的 `forge.json`，不是 `metrics.fps`。

### Assembled-gateway AC-03（Studio 壳旅程，不是 rain-alley 包）

heavy assembled Gateway 证据要求 public `http://localhost:18920`，**独立 engine preview / 点采样 FPS 不算**。数值：整数显示 FPS ≥ 59、raw average ≥ 58.95、p95 frame time ≤ 20 ms、trace window 90 s；`frameStats` 不能替代 trace。[packages/studio-qa/README.md:119-124](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/studio-qa/README.md#L119-L124) [packages/studio-qa/src/quality-gates/report-contract.mjs:67-75](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/studio-qa/src/quality-gates/report-contract.mjs#L67-L75)

### 宿主路径与 telemetry（不是门槛）

slot 0：UI `:18920`，独立 engine Play `:15173`。AGENTS / chrome-performance skill：**viewport bug 必须走真实 `:18920`**；`:15173` curl **不能**证明内嵌 editor。[packages/harness/docs/PORTS.md:34-36](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/harness/docs/PORTS.md#L34-L36)

引擎可每秒 postMessage `VAG_FPS_STATS { fps }`；这是预览 HUD，不是 CI MetricKind。[packages/harness/docs/conventions.md:86-94](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/harness/docs/conventions.md#L86-L94)

排查时 **不得把右上角 FPS 文本当真实显示帧率**，先对 `FireAnimationFrame` / `BeginFrame`。[.claude/skills/forgeax-chrome-performance/SKILL.md:26-31](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/.claude/skills/forgeax-chrome-performance/SKILL.md#L26-L31)

## 5. 给 W15 grilling 的事实边界

- **打开游戏包 `fps`/`gate` 开关** 会让 Engine 的 metrics runner 在 **该包作为 Engine workspace member** 时生效；当前 games 仓 **不跑** 那些脚本，Hellforge/FPS/Rain Alley 也都是显式 opt-out。
- **Studio 主 CI Play smoke** 验收的是 editor `game-default` 引导路径上的 console 健康，**不是** `rain-alley` slug，也 **没有** 帧率数字。
- **可选** `studio-qa qa` 可以对每个 slug 要一帧截图；**assembled-gateway AC-03** 的 59 fps 是 Studio 组装旅程合同，不是游戏 `package.json`。
- 白盒规格与票 14 的「能瞄准 / 不每枪重建」仍是 **人观察 + 规则单测**；没有现成的包级 bundle-size 或 fps baseline 可「重新打开」。
- 本票 **不** 决定 Vertical Slice 该开哪几扇门。
