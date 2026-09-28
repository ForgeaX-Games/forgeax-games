# Hellforge · SDK 迁移状态

更新：2026-09-25。这里是 SDK 0.1.38 与 0.2.1 两个隔离轨道的状态索引，验收证据不能互相继承。

## 一眼看当前 Goal

- **正在做**：隔离的 `@forgeax/engine@0.2.1` + 本地 P1/P2/P3 补丁候选，P4b 营地画质
  局部通过；P5 已证明静态 Web 子路径启动、营地/野外、同一角色真实入洞与
  **指定地牢折角的两段真实 LMB 点地导航**，但**尚未证明新版有效战斗、Boss、
  领奖或正式网址可替换**。这不是旧 0.1.38 发布轨道。
- **当前难点**：D2a 远距盲射、D2b 超射程预检、D2c 手动斜跑均未命中；D2d
  被正常过场遮罩挡在点击前置；D2e 点地导航定向通过，但撤离后存在
  `119.532s` 未采样空档并死亡。D2f A2 已在营地证明受控异常释放与 35 秒
  工具会话持续，**B 战斗尚未执行**。首份 B 脚本经静态对抗审查发现错误键位、
  提前返回、虚假到达与失效退场等 P1，已否决且未运行；下一步先做更小的
  退场演练／安全 runner，再在有效射距内验证首个非 Boss 命中／击杀。
  D2g 出口合同已审，但第二份仅接受 live den 的脚本也因终态误报／救援
  缺陷被静态否决、未执行；下一片须从 camp **单次连续**演练真实出口。
- **最后安全恢复点**：浏览器 session `hf021-p5-d0`，正常 `R` 后 camp `[0,5]`、
  HP `60/60`、MP80、同一 identity/quest active、红蓝药 `0/1`、keys 全 false；
  主代理又只读核对 area/pos、intent/path 与遮罩。续作仍须刷新核对，不能依赖
  浏览器会话永存；D2e 死亡发生时刻／原因没有连续证据。
- **发布仍禁止**：0.1.38 发布 paused；0.2.1 未完整验收，且 BGM 权属、Pages 写权限与容量
  方案仍未解决。没有改 Studio pin、推送或替换正式网址。

> **当前活动轨道：0.2.1 HF-021-P5 有界玩法复验中；P4b 营地视觉候选已局部验证（P3 本地补丁保留，不是上游修复/新 SDK release）**。
> checkout：`/Users/you/dev/game-workspace/checkouts/hellforge-sdk-0.2.1-plugins/hellforge`；
> Git 根为父目录，branch `codex/hellforge-sdk-0.2.1-plugin-asset`；P4b 基线 clean HEAD
> `751026b6b007ce5fdc5942e19885e25cfa7c58e4`；P4b 已本地签名提交
> `b392bd0659c9da0ea5c194edd5f2b9c469fa3c98`，未推送/发布。最终候选状态以
> `git log -1` / `git status --short` 为准；运行时精确 pin `@forgeax/engine@0.2.1`。
> **已验证：** 合并后的 DevKit `@0.2.1` patch SHA `7bd86242a587df931e2a9f86a5a5f2d605a892bcb4a8f415d2ea2c3ec4955644`，lock SHA
> `4b1ca12346a027dc3e0e98c0f5920eaebb0be99ad0d183363701567271465ab3`；P3 DevKit 四项合同红转绿，
> 与 P2 Render 11 项及 P1 catalog 3 项定向合测共 18 pass / 0 fail。P1–P3 同 pin 基线的 frozen
> install、project check、33/33 asset verify 已通过，本轮 P4b 未重复这些门；P4b 重跑
> typecheck、scene validate、production build 与本地 camp smoke。P4b 三文件 allowlist 的
> `CAMP_DIRECTIONAL_MUL=1.75` 只应用于 camp 方向性 key，global exposure 保持 `.50`，
> den/wild directional multiplier 保持 `1`。当前组合候选全量 `pnpm test` 为 1174 pass / 0 fail
>（118 files，178539 expectations）。最终 bundle 的 fresh Chrome/WebGPU 1280×720 营地截图固定 ROI
> hero/route/hut/fire p50 为 `.0352/.0332/.0380/.1208`，fire `>.95` 比例 `.0012`；
> 实际目视仍为 dusk，真实 W 移动从 `[0,5]` 到 `[0,2.962431000012159]`。wild/den
> 有界 inspect smoke 未吃到 camp multiplier；其完整玩法与相对营地的像素层级未验。
> **未关闭：** 本次 P4 冷启动在角色选择预览阶段观察到 `0 lights` warning，像素影响待验；
> P2/P3 旧日志未记录触发阶段，不能回溯归因。P4 稳定营地 renderer admitted 7 lights。
> 完整 Boss / HUD / 领奖流程、其他浏览器/GPU、长时稳定性、
> 更多镜头/天气、正式 URL/Pages 和上游修复。P4b 只支持本次营地视角的有界视觉候选，不等于整体验收。
> **恢复点：** P4b 基线 clean HEAD 为 `751026b6b007ce5fdc5942e19885e25cfa7c58e4`；仅回退本卡源码时恢复
> 该 HEAD 的 `hellforge/main.ts`、`hellforge/src/light-director.ts`、`hellforge/src/light-director.test.ts`，
> 保留 P1/P2/P3 patch、lock 与 Studio 边界。P2/P3 历史回滚仍以旧 P2 前 clean HEAD
> `0e711aef86198be4e1aa95f85026b59cb1f3fec3` 及对应证据为准；未推送/发布。
> 当前 `dist` 为上述 P4b 源码在提交前构建的本地验收产物；正式发布前须在发布候选提交后重新构建并封存版本指纹。
> 分片证据： [P1 catalog](docs/sdk-migration/2026-09-24-hf-021-p1-static-catalog-evidence.md)、
> [P2 Render](docs/sdk-migration/2026-09-24-hf-021-p2-render-evidence.md)、
> [P3 DevKit fatal overlay](docs/sdk-migration/2026-09-24-hf-021-p3-devkit-fatal-overlay-evidence.md)、
> [P4b camp lighting](docs/sdk-migration/2026-09-24-hf-021-p4b-camp-lighting-evidence.md)。
>
> **独立历史轨道：0.1.38 Web 发布仍为 paused，尚未正式发布。** 下方该版本内容只记录
> `/Users/you/dev/game-workspace/checkouts/hellforge-sdk-0.1.38/hellforge` 的历史状态，
> 不代表本 checkout 的 0.2.1；旧 Boss、旧 Web 候选截图/产物和旧 `pack-index` 均不能证明
> 0.2.1。旧迁移记录见
> [0.2.1 插件资产迁移记录](docs/sdk-migration/2026-09-24-sdk-0.2.1-plugin-asset-migration.md)。

## 历史轨道：SDK 0.1.38 Web 发布候选（paused）

## 入口与范围

- 目录：`/Users/you/dev/game-workspace/checkouts/hellforge-sdk-0.1.38/hellforge`。
- Git 根为上一级；分支 `codex/hellforge-sdk-0.1.38-web`。
- 已恢复并签名提交旧迁移成果：`6d6d4a53d4721410e2fcd3ccb74da66989437ace`。本轮改动在此之后，实时状态以 `git status --short` 为准。
- 当前实现检查点：`23fbd490414c86580101efb7297f228ca8896e1a`（含 SSH 签名，本地，未推送）；迁移主体为 `0cbdee5ae58b0825340a0d5a65584938087037cc`。完整版本指纹和范围见 [0.1.38 验证记录](docs/sdk-migration/2026-09-22-sdk-0.1.38.md)。
- 原恢复 stash `cfb13c1fe31a9ac5f07ec87b788dbb5db4907e01`、0.1.33 worktree、工作区原 Hellforge 链接和 Studio pin 均保留。
- 本轮锁定 npm 最新稳定版 `@forgeax/engine@0.1.38`，开发期间新版进入下一轮。补丁处理见 [patches/README.md](patches/README.md)。
- 用户已授权：验收通过后仅发布到 `https://forgeax.github.io/games/hellforge/`。目标为桌面 Chrome / Edge、WebGPU、键鼠。
- 完整范围和验收门见 [Web Goal](docs/sdk-migration/WEB-RELEASE-GOAL.md)；后续升级见 [持续迭代手册](docs/sdk-migration/CONTINUATION-RUNBOOK.md)。

## 本轮进度

- 已完成：恢复基线、精确升级、主线程宿主与 ECS Instances 适配；renderer 公开服务注入、DevKit 启动屏障、默认根目录 pack-index 重绑；三个仍需要的 render 补丁 seam。
- A/B 已通过：冻结安装、1170 项测试（0 fail）、类型/场景/doctor、production build、启动负控与失败传播、skin/FX shader、发布包路径/体积/全部产物哈希审计。
- D 完整玩法已通过：Chrome/WebGPU，普通静态服务 `crossOriginIsolated=false`；真实接任务→荒原→地牢 8 敌人/Boss→正常回营→Veyra 领奖→刷新。同一角色 Lv5、XP119、金币342、唯一霜铸魔杖及其 ID 保留，过场结束后可继续操作。详见 [玩法证据](docs/sdk-migration/2026-09-22-web-playthrough.md)。
- C 补充：死亡/R 复活；TAA 冰火、背包关闭后输入、松键/失焦、960×600 与 1920×1080 截图。修复无 WebGPU 时启动错误被开场层遮挡，实测 Diagnostics 与鼠标/键盘 Reload；未通过删雾效支持备用后端。
- Edge 补测：微软官方 153.0.4234.48 临时独立会话，真实进入/战斗/R 复活/刷新存档、TAA 1080p 冰火已验；三次有界完整路线尝试均在战斗死亡后停止，未取得 Edge D 证据，详情及测试输入策略问题在玩法证据中单列。
- 独立审查：Luna Standards/补丁审查与独立 Astra 启动边界复核未发现新增 P0/P1；补强了偏移/过滤/跨帧 reset、四 shader 组合、真实 World smoke。不能代替 D/E 验收。
- 本次 HTML 修复另经独立 Astra Standards / Luna Spec 审查，均无新增发现；最终构建正常加载/移动/施法/存档复验通过。入口只改变构建提交号，游戏插件与着色器/资产不变。
- 收尾文档 `15961d5…15b55b6` 另经独立 Astra Standards / Luna Spec 审查，均无新增发现；仅核对证据表述与定向回滚范围，不是正式发布签字，详见本轮验证记录。
- 未验边界：正式 URL、Edge 完整领奖闭环、其他 GPU/Windows、长时稳定性、全部 FX 逐帧与双材质参数扰动实验。选角原图有正常照明，0-light 警告未表现为持续黑屏。
- 发布阻断：最新 GitHub CLI 只读复核账户已为 `LuZhouheng`，对 `forgeax/forgeax.github.io` 仍为 `permissions.push=false`；此前 Git HTTPS dry-run 的 `forgeax` 返回 403。CLI 身份不等同 Git 凭据已切换，没有实际 push。两首 BGM 的来源仍未确认，也尚未替换/移除，当前 dist 不可直接发布。
- 既有站点风险：完整 pages Git 文件树 7,346,351,977 bytes；后续 Actions 只读核查取得现网 ZIP 产物 1,885,692,207 bytes，部署日志明确发出 1 GB 超限警告后成功。Git 原始大小、压缩 ZIP 与解包站点大小不能混写；成功不代表容量符合支持范围。详见[现网部署证据](docs/sdk-migration/2026-09-22-pages-deployment-evidence.md)，仍需维护者确认处理方案，不擅自删除其他游戏。

## SDK 0.2.1 HF-021-P0–P5 迁移轨道（P5 D1 入洞与 D2e 定向点地通过，战斗 D2/D3 未验，整体未验收）

- 目标游戏运行时只 pin `@forgeax/engine@0.2.1`。`@forgeax/engine-sdk@0.2.1` 是外部
  SDK carrier/合同证据，记录 integrity，但不作为游戏运行依赖加入 `package.json`。
- 新 checkout 已完成 schema-v3 `forge.json#roots.engine` → Pack `plugin/engine` root
  GUID → `mountPluginAsset` → 现有 bootstrap 的最小切片。既有场景/材质 `.pack.json`
  与 GUID 未批量转换；主线程策略保留。
- P0 曾验证：冻结安装、`project check`、Pack inspect、构建后 `asset verify`、build、
  TypeScript 检查；live DevKit host 进入营地并以真实 W 键移动约 0.55 m。Pack v2
  `pack-index` 发布及 provenance 有 P0 证据。
- P0 静态页最初失败：`http://localhost:18738/games/hellforge/` 请求根 `/pack-index.json`
  404、`generated-app-bootstrap` fatal。P1 在隔离 checkout 中新建两个精确 pin 为 0.2.1
  的 patchedDependencies 后，该静态子路径进入营地并完成真实 W 移动；它是 **0.2.1 + local
  patch**，不可把此结果描述成无补丁的上游 SDK 0.2.1。红/绿路径、双包 seam 与负控见 P1 证据。
- P1 基线全量 `pnpm test` 为 1161 pass / 12 fail。P2 checkpoint 定向 Render 合同集为
  11 pass / 0 fail；当时 Render + DevKit fatal-overlay 集为 11 pass / 4 fail，四项 DevKit
  红测记录在 [P2 证据](docs/sdk-migration/2026-09-24-hf-021-p2-render-evidence.md)。P3 定向
  合入后 DevKit 4 项、Render 11 项、P1 catalog 3 项共 18 pass / 0 fail；本轮全量
  `pnpm test` 实际为 1173 pass / 0 fail（118 files、178531 expectations）。这个结果属于
  本地 P1/P2/P3 组合候选，不表示未打补丁的上游 SDK；不回填 0.1.38 旧补丁。
- P2 在隔离 checkout 新增精确 `@forgeax/engine-render@0.2.1` patchedDependency；patch、锁哈希、
  五文件 allowlist、验证边界与回滚方式见 [HF-021-P2 Render 证据](docs/sdk-migration/2026-09-24-hf-021-p2-render-evidence.md)。
- P2 Chrome 仅为生产静态营地/HUD、一次 Frost Fang 透明 FX 与可见 W 位移 smoke；当时记录过
  `0 lights` 文字，但没有触发阶段时间戳，不能用本次 P4 角色预览观察替它归因；P4 稳定营地
  已 admitted 7 lights，旧告警的像素影响仍待验。P2 整体视觉门当时未通过。营地截图只留在
  本次 CUA 工具记录中（SHA-256
  `ae13566acd934a9a48cff9d18231d067f4b29ba2f60aba9017b61a766920a6bc`），没有仓库内图片文件。
- 版本、锁指纹、命令结果、浏览器环境、首错、剩余验证及恢复点见
  [HF-021-P0 执行证据](docs/sdk-migration/2026-09-24-hf-021-p0-sdk-0.2.1-evidence.md)。
- 本轮 P1 静态页面结果和新增 local patch 精确路径/哈希见
  [HF-021-P1 静态 catalog 证据](docs/sdk-migration/2026-09-24-hf-021-p1-static-catalog-evidence.md)。
- 本轮 P2 Render patch、回归测试、静态 smoke、同版 DevKit 无 WebGPU 负控与未验边界见
  [HF-021-P2 Render 证据](docs/sdk-migration/2026-09-24-hf-021-p2-render-evidence.md)。
- 本轮 P3 DevKit fatal-overlay patch、静态 DOM 合同、no-WebGPU Reload 鼠标/键盘结果与边界见
  [HF-021-P3 DevKit fatal-overlay 证据](docs/sdk-migration/2026-09-24-hf-021-p3-devkit-fatal-overlay-evidence.md)。
- P5 D0 仅局部证据封存，门口 checkpoint 尚未通过：独立 Playwright session `hf021-p5-d0` 清空存储后真实完成
  标题→跳过 intro→新建 Sorceress→入营→左键接近/点击 Veyra→接受任务，且只读断言
  `available→active`；真实键盘跨过营地门观察到 `area=wild`。一次实际有效时长未确认的 `S` 长按越过
  目标门口 `[0,14]`，随后被 Lv3 敌人正常击杀；普通 `R` 已恢复安全营地 `[0,5]`，
  HP `60/60`、任务 `active`、bag `[]`、所有按键释放；D0 结束时 R 后 identity.id/装备 ID 尚未复核，D1 起点后续补验相同。该段不写成精确门口 checkpoint
  或完整玩法通过；首个 `0 lights` warning、截图哈希、identity/nav/存档和未验边界见
  [HF-021-P5 D0 证据](docs/sdk-migration/2026-09-24-hf-021-p5-d0-playtest-evidence.md)。
- P5 D1 已在固定的 P4b `@forgeax/engine@0.2.1` 本地补丁构建产物上，复用同一角色完成真实连续入洞（D1 未重新构建）：
  无红药、无调试写入，单条键鼠调用约 5.94 秒首次从 `camp [0,5]` 进入
  `den [302.4,340.8]`，HP `60/60`、quest `active`、identity.id 不变；洞内初始
  8 敌（含 `slaglord`）和稳定入口画面均经只读复核。此前 D1/D1b/D1c 的按键
  工具时序、洞口差 2.30m 与野外闲置死亡均单列，不当作游戏故障或新版通关。
  D1 结束时 session 在 den 入口、生命药水 `0`、法力药水 `1`；后续已发生 D2a 尝试及普通 R 复活，
  **该位置不再是当前恢复点**。D2 战斗/Boss、D3 回营领奖/刷新和正式发布尚未验收。
  版本、截图哈希、对抗性归因、资源与当时恢复点见
  [HF-021-P5 D1 证据](docs/sdk-migration/2026-09-24-hf-021-p5-d1-playtest-evidence.md)。
- P5 D2a 在同一角色、相同 P4b 构建上只做了一次真实洞内首杀尝试：入口直线 W+Shift
  约 9.15 秒仅前进约 4.10m 后受 nav grid 拐角阻挡；对首次距约 36m 的 flamecaller
  做了 27 次 RMB 尝试，实际成功施法数未封存，怪物记录时始终 32/32，
  **无击杀、XP/金币/掉落新增证据**。普通 S+Shift 撤离至 wild，
  随后未计时空档死亡，真实 R 已恢复安全 camp `[0,5]`，HP60、任务 active、同一 identity、
  生命药水0、法力药水1、所有键释放。D2a 结束时 session 在 camp；之后已发生 D2b，
  不能再把此坐标与 HP 当成当前状态。继续前须重新只读核对；
  不能将这次无伤害直接判作技能或 SDK 故障，也不能把 D1 的入洞证据当作 D2 通过。
  详见 [HF-021-P5 D2a 失败证据](docs/sdk-migration/2026-09-24-hf-021-p5-d2a-playtest-evidence.md)。
- P5 D2b 在 docs-only HEAD `915293aa48b9cfc1509e62b0b80660d87aef5800` 的**同一 P4b
  dist 哈希**上重入 den；首次目标仍在约 36.08m，超出 Frost 基础 22.8m，脚本
  跳过攻击，**未发送技能/点击，未产生命中或击杀证据**。向南撤离先受出口需离 pad
  `>6m` 才 re-arm 的隐藏条件所限；普通北移再南返后确实退出，沿 wild 路线回到
  camp `[0.147167,14.123977]`，HP `49.1089/60`、任务 active、同一 identity、
  生命药水0、法力药水1、keys 全 false。这是 D2b 结束时的营地状态；之后已发生 D2c，
  不能把它当最新恢复点。
  D2a/D2b 两次有界尝试均未形成技能命中，原任务卡的两次预算已用；不能称 D2
  或 Boss 通过。近墙稳定画面与出口隐藏 re-arm 是待复现的体验风险，不等于 SDK
  渲染故障。详见 [HF-021-P5 D2b 距离与撤离证据](docs/sdk-migration/2026-09-24-hf-021-p5-d2b-range-and-return-evidence.md)。
- Sol/max 管理在 D2a/b 归因后新开一次 ≤10 分钟的
  [D2c 首次命中/首杀微实验卡](docs/sdk-migration/2026-09-24-hf-021-p5-d2c-task-card.md)：
  同一角色、一次入洞、绕合法折角后在有效距离内最多两次有记录的真实瞄准；
  仅命中并击杀一个非 Boss 才过此门。**D2c 实际未通过**：真实 D+W 斜跑
  到 x≈306.85 后，W 在 z≈336.704 受下一格墙阻挡；目标仍距 31.97m，
  未按槽位/鼠标、未施法或击杀。任务卡要求的 100–200ms 原始轨迹采样未归档，
  独立 Luna/max 审查判“导航探针部分执行、证据不足”，不能拿聚合结果冒充合规；
  也未触发正常 LMB 点地 A*，不能据此判 SDK
  寻路故障。另一次普通键鼠安全撤离已回 camp `[0.054576,13.920348]`，
  HP `49.1089/60`、MP80、同一 identity/quest active、红蓝药 `0/1`、keys 全 false；
  这是 D2c 结束时的恢复点，后续已发生 D2d/e，不能当当前状态。下一片当时
  应先验证 LMB 点地寻路过折角，再进入有效射距战斗。详见
  [D2c 卡路与恢复证据](docs/sdk-migration/2026-09-24-hf-021-p5-d2c-nav-stop-evidence.md)。
- P5 D2d 真实入洞后在 LMB 前发现 `#hellforge-ui-transition` 仍拦截 canvas；
  现场截图是“熔渣深窟”过场黑幕。`area=den` 早于默认 `900ms` hold + `500ms`
  fade 结束，故没有点击、point intent/path 或导航证据，也不是已证明的游戏
  导航 bug。普通键鼠安全回 camp；详见
  [D2d 过场门证据](docs/sdk-migration/2026-09-24-hf-021-p5-d2d-transition-gate-evidence.md)。
- P5 D2e 在相同 P4b dist 上，独立 session 中等到遮罩 `pointer-events:none`、
  card 隐藏且点击位置由 canvas 接收；真实 `mouse.move → mousedown` 两次分别
  取得即时 `point`、非空当前 path、followIdx 进展与 100–200ms 连续坐标，
  到实际 intent 目标 `0.3710m/0.3954m ≤ PATH_ARRIVE 0.45m`，keys 全空、stuck0，
  证明**本次指定折角点地导航**通过。没有攻击或首杀。随后一次普通撤退仍在
  den，`119.532s` 未采样空档后观察到 wild 死亡；具体死亡时刻／原因未知，
  此次安全撤离未通过。仅正常 `R` 恢复 camp `[0,5]`、HP60、同一角色与任务、
  红蓝药 `0/1`、keys 空；这是当前最后安全恢复点。详见
  [D2e 点地与安全边界证据](docs/sdk-migration/2026-09-24-hf-021-p5-d2e-point-nav-evidence.md)。
- P5 D2f 先补测试执行护栏：A1 营地受控异常中真实 Shift／中键均由
  `finally` 释放，但原始混合采样有 `327ms` 间隔，按原门未放行战斗；A2
  划分活跃采样和释放，19 个样本最大 `110ms`，停止后 `1ms` 内释放，
  keys 空、完整角色快照与位置不变。另一个 35 秒 camp 无输入会话证明
  PTY yield/resume，但脚本错误 getter 与 `531ms` 采样间隔不能当 B 安全证据。
  独立 Luna/max 只条件性放行**具体 B 脚本审查**，尚未入洞或打怪；详见
  [D2f 安全门证据](docs/sdk-migration/2026-09-24-hf-021-p5-d2f-safety-gate-evidence.md) 与
  [D2f 任务卡](docs/sdk-migration/2026-09-24-hf-021-p5-d2f-safety-first-task-card.md)。
  后续 883 行 B 脚本草稿仅通过语法检查，未执行；独立审查发现多处 P1，
  本轮拒绝并移除该代理生成草稿，详见安全门证据，不得把它当成实机通过。
  D2g [出口安全门与下一片任务卡](docs/sdk-migration/2026-09-25-hf-021-p5-d2g-exit-gate.md)
  已核入口、re-arm、返程合同；约 300 行第二份草稿亦静态否决并移除，
  没有 D2g 浏览器通过证据。
- 迁移任务卡及其原始合同仍见
  [2026-09-24 0.2.1 迁移记录](docs/sdk-migration/2026-09-24-sdk-0.2.1-plugin-asset-migration.md)；
  本 checkout 仅为本地迁移候选，不要据本局部结果创建发布标签。

## 历史 0.1.38 构建与运行（非本 checkout）

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm preview --port 18738
```

在上面的 **0.1.38 游戏目录**执行，不是在工作区根、旧 0.1.33 副本或 Studio 中执行。当前本地地址为 `http://localhost:18738/games/hellforge/`；若进程已退出，运行 preview 重新启动。不要省略子路径；本机实测使用 `localhost`，监听地址以 preview 输出为准。

生产构建固定 base `/games/hellforge/`。新候选是隔离目录，旧 `hellforge` 链接和 Studio Play 仍指向旧源码，这是保留回滚的边界，不表示旧入口已被升级。
P2/P3 的本地静态验收曾使用 `http://localhost:18739/games/hellforge/`，那次临时 preview 后来已停止；P5 本轮在同端口重新开启 preview，并固定使用上面列出的 P4b dist 哈希。进程可能随会话结束。续验先检查当前响应与哈希；只有源码或补丁改变时才在 0.2.1 候选目录重建 `dist`，不能把旧页面当新构建验收。
`pnpm dev` 与 `pnpm build` 都经 `scripts/run-sdk.mjs` 固定 engine/render 不进入 Worker，因为当前 DOM HUD 和直接渲染控制仍在同一主线程；kernel 策略保持 auto。不能绕过此入口并把默认 Worker 构建当作已验版本。

## 历史证据

[2026-09-20 SDK 0.1.33 记录](docs/sdk-migration/2026-09-20-sdk-0.1.33.md)包含旧版材质、FX temporal、遮挡/死亡修复、资产哈希和局部实机证据。旧版 Boss 链未完成；旧 1149 tests 和性能数字不归属于 0.1.38。

本轮没有切换 Studio pin，没有声称 Studio、移动端、未测 GPU 或长时稳定性通过。
