# Rain Alley Studio：当前开发入口

核对：2026-09-10。此工程属于 forgeax-games 的 `laurenceelu/feat-20260903-rain-alley` worktree；整理前 HEAD 为 `34fb86823729b53be95db7ddd87a36bea67fe80e`。

## 哪份源码会被加载

本游戏目录位于统一工作区 `~/dev/game-workspace/checkouts/rain-alley-games/rain-alley`（forgeax-games 的 `laurenceelu/feat-20260903-rain-alley` worktree，2026-09-15 自 ForgeaX-Games 迁入；Git 历史与未提交改动完整保留）。
隔离 Studio `forgeax-studio/.worktrees/rain-alley-play/.forgeax/games/rain-alley` 实际链接到这里。
顶层 `forgeax-games/rain-alley` 是另一个未跟踪副本；不合并、不删除，也不作为此入口的权威。

本机读取的运行环境（文件状态，不是新的 Play 验收）：

| 仓库 | 实际 checkout SHA |
|---|---|
| 隔离 Studio | `1ea2da26ea4d95d2364aedbda36924895411115a` |
| 内嵌 Editor | `6651d196560d2052ed51a9bee734e6596a9fa8ba` |
| 内嵌 Engine | `e53f162170503a113fca5aaaee37631af1750afb` |

旧性能/Play 报告使用 Engine `743b773c8902e4098f21e1c165a6a242602668c4`；不能把那次通过转移到上表 pin。父仓记录的 gitlink 与子模块实际 HEAD/dirty 状态也须分别记录。

## 两个模式与 SDK 分支

- `forge.json.entry = fps-main.ts`：当前 FPS。12 枪、165 个静态碰撞代理、楼梯连廊、NPC 交战、合批街区、预加载人物 LOD。
- `main.ts`：保留的第三人称剧情模式，117 个原代理。调查、态度选择、Aftermath 等规划属于此模式，不是 FPS 已完成清单。
- `mesh-binary/4` 是资产格式，不是“Engine 第四版”的产品版本号。
- Studio FPS 音效仍是合成；SDK 的实录枪声、88 水坑、Canvas 镜头层、车漆/弹痕/烟雾和 Engine 输入补丁不能默认视为已经同步到这里。
- TS 创建 ECS 碰撞体，Engine/Rapier 求解；GLB 与 Blender 布局 JSON 不会自动生成当前运行时碰撞。

## 运行与检查

这是 workspace 游戏，不是独立 npm 应用。在隔离 Studio 中发现 rain-alley 后 Play；先核对实际 games 映射和内嵌 Engine。不要为了开预览自动更新主线 pin。
⚠️ 2026-09-16：上述隔离 Studio 宿主（`forgeax-studio/.worktrees/rain-alley-play`，端口 15173）已在磁盘清理中摘除，此 Play 链路当前不可用。恢复方法见文末「2026-09-16」一节；SDK 链路不受影响。
旧报告中 `:15173/preview/?game=rain-alley` 是隔离验证路径，不能代替 Studio UI 验收；端口按当前服务输出确认。

已有依赖解析时，在本目录：

```sh
bun run typecheck
bun test tests
```

2026-09-10：71 项规则测试通过。本次没有重新运行浏览器或性能采样。720p 内嵌约 59–60 FPS 与独立 Chrome 未达标是 2026-09-09 的历史对照。

## 保留与后续

整理前 `src/presentation.ts`、`assets/scene.pack.json` 及其他游戏的未提交改动保持原位。源码差异另存版本快照；文档提交不顺带提交它们。
开发先读 [文档索引](docs/INDEX.md)；性能看 [PERFORMANCE](docs/fps/PERFORMANCE.md)，玩法/碰撞看 [LIVING-CITY](docs/fps/LIVING-CITY.md)，原街区合同看 [INTEGRATION](docs/district/INTEGRATION.md)。
旧剧情规划仍在仓根 `.scratch/rain-alley/`；统一工作区目录收录了全部 51 份 Plan/issue/handoff 原文。未勾选或已勾选项目都要结合代码与验收重新判断。


## 2026-09-11：接入桌面版 ForgeaX Studio App(已放弃并回滚)

- 结论：桌面 App 内置引擎没有 `Fog` 导出（`@forgeax/engine-render`),而本工程 `src/presentation.ts`、`src/fps/weather.ts` 依赖它（该导出只在 rain-perf 开发引擎）。模块加载即失败，预览卡 Loading,App 视口连带崩。决定不为此改游戏代码，放弃 App 链路，继续使用隔离 Studio。
- 当日曾通过 App 的 `POST /api/projects/link` 挂载并激活成功（`~/ForgeaxProjects/.forgeax/games/rain-alley` → 本目录，runtime ready)；该 symlink 仍在，不需要时删之即可。App 服务端 bind 超时默认 60s，冷构建（assets 422MB）约 5–7 分钟，曾通过 launchctl 设置 `FORGEAX_RUNTIME_SCOPE_TIMEOUT_MS=900000` 绕过（仍在会话环境中，`launchctl unsetenv` 可撤销）。
- 依赖指向已回滚：`node_modules/@forgeax` 恢复为指向隔离 Studio(`rain-alley-play` worktree）引擎的 symlink 组。App 曾把它替换成指向内置引擎的单一 symlink；备份在 `~/dev/game-workspace/backups/20260911-rain-alley-studio-link/`（现已无内容，@forgeax 已归位）。
- 工程内 `.forgeax/ddc`（约 66M）是 App 引擎构建留下的派生缓存，可删。
- 隔离 Studio(`rain-alley-play`, 端口 15173）链路不受影响，仍指向本目录。

## 2026-09-15：迁入 game-workspace

- worktree 整体移至 `~/dev/game-workspace/checkouts/rain-alley-games`（`git worktree move`，分支、10 个未 push commit 与全部未提交/未跟踪文件原样保留；Git 对象库仍在 ForgeaX-Games 的 forgeax-games 仓内，该仓搁置但保留）。
- 工作区根软链 `rain-alley-studio` 改指本目录；隔离 Studio `rain-alley-play/.forgeax/games/rain-alley` 映射已同步重指。
- 9/11 桌面 App 遗留的 `~/ForgeaxProjects/.forgeax/games/rain-alley` 软链仍指向旧 worktree 路径（现已悬空）；App 链路已放弃，该软链无实际作用，需要时可删。

## 2026-09-16：隔离 Studio Play 宿主摘除说明

- 清理背景：ForgeaX-Games 搁置，worktree 统一摘除（branch ref 均在，`codex/rain-alley-play` 未丢）。
- 影响：本文档描述的"隔离 Studio（15173）发现 rain-alley 后 Play"链路失效；Studio 侧 `.forgeax/games/rain-alley` 映射已重指到本 worktree 新位置，但宿主本体没了。
- 如需恢复 Studio Play：`git -C ~/dev/ForgeaX-Games/forgeax-studio worktree add .worktrees/rain-alley-play codex/rain-alley-play` → 装依赖 → 把 `.forgeax/games/rain-alley` 重指到 `~/dev/game-workspace/checkouts/rain-alley-games/rain-alley`。
- 日常推进以 SDK 链路（`../rain-alley-sdk`，绑定 `checkouts/engine-rain-perf`）为准。
