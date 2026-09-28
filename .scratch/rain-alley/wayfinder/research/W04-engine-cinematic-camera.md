# W04 — 当前引擎能否做确定性电影机位

## 结论

**能做确定性的硬切机位和少量、游戏内自建的镜头插值；不能把当前能力称为引擎 sequencer / cutscene stack。**

最小且有树内证据的方案是：

1. 电影镜头仍是普通 `Camera` + `Transform` 实体；
2. 固定镜头可直接写 `Transform`，需要第二机位时用 `setActiveCamera(world, entity)` 按实体 ID 硬切；
3. 若需要短推镜或构图插值，由 `rain-alley` 自己持有很小的纯数据 beat，并以显式时间采样后写回同一相机的 `Transform` / `Camera`；
4. 战斗中的“定格”应是游戏规则门控（锁输入、停 AI、无敌，保留镜头/UI更新），而不是暂停整个 App。

这里的“确定性”只指：给定同一个 beat 时间，得到同一个镜头 pose。Hellforge 的纯采样器满足这一点；其实际播放用 `performance.now()`，因此它不是确定性模拟或可重放 sequencer（`hellforge/src/cutscene.ts:101-138`; `hellforge/main.ts:4154-4175`）。

## 引擎已有的相机能力

- `Camera` 只存投影、FOV、裁剪面、后处理等数据；视图矩阵来自同实体的 `Transform`。组件注释也明确仍是单一显示相机模型，而非多轨时间线（`packages/render/src/components/camera.ts:230-260`, `packages/render/src/components/camera.ts:303-348`）。
- 引擎有正式的活动相机选择接口：`setActiveCamera` 写入仅含实体 ID 的 `ActiveCamera` 资源；renderer 按该 ID 选择相机。资源缺失或 ID 无效时退回 query 的 first-hit（`packages/render/src/systems/active-camera.ts:41-115`; `packages/render/src/extract/camera.ts:55-77`; `packages/render/src/authoring.ts:16`）。
- 单元与集成测试证明可以从第一台硬切到第二台相机，并且最终只输出所选相机；也证明无效 ID 会静默退回第一台（`packages/runtime/src/__tests__/active-camera.unit.test.ts:93-114`, `packages/runtime/src/__tests__/active-camera.unit.test.ts:150-199`）。因此切镜时必须保存有效实体句柄，不能依赖生成顺序。
- `App.pause()` 会取消整条 rAF 调度；暂停后 `stepFrame(explicitDelta)` 能按显式 delta 跑完整 update/draw 帧（`packages/app/src/types.ts:383-398`; `packages/app/src/internal/frame-loop.ts:503-522`, `packages/app/src/internal/frame-loop.ts:580-595`）。这适合工具、截图或 DOM 视频覆盖，不适合“世界停住但引擎内镜头继续运动”的电影 beat。
- 引擎自带的 `video-cutscene` 示例正是暂停整个 App、播放 DOM `<video>`、结束后恢复；文件明确说明引擎不知道该 cutscene（`apps/hello/video-cutscene/src/main.ts:1-20`, `apps/hello/video-cutscene/src/main.ts:123-143`）。它不是镜头 sequencer 的证据。
- `Time` / `FixedTime` 对游戏只暴露只读视图，时钟写权限留在 scheduler；没有已证明的公开全局 `timeScale`（`packages/ecs/src/time.ts:1-32`, `packages/ecs/src/time.ts:84-121`）。ECS 可用带 `runIf` 的 system set 做自定义暂停门，但这是调度原语，不是 cutscene 系统（`packages/ecs/src/index.ts:335-359`）。

## 树内游戏证据

### `rain-alley`

- 当前只生成一台肩后相机，并在每帧根据玩家、yaw/pitch 和指数平滑写它的 `Transform`；没有活动相机切换（`rain-alley/main.ts:846-861`, `rain-alley/main.ts:1603-1655`）。
- 它已经把 real clock 与 game clock 分开，慢动作只缩放 `gameDelta`，镜头、后坐和 HUD 可继续走 `realDelta`（`rain-alley/src/rules.ts:1-39`, `rain-alley/src/rules.ts:147-168`; `rain-alley/main.ts:1097-1133`, `rain-alley/main.ts:1619-1629`）。把某个短 beat 的 gameplay delta 设为 0，是比 App.pause 更贴近现有结构的局部延伸，但当前代码尚未实现真正的 0 倍冻结。

### `hellforge`

- Hellforge 的 camera rig、keyframe script、sampler、owner 和 per-beat world policy 全部位于游戏目录，不是 engine package。`sampleCutscene(script, t)` 以显式 `t` 采样 fade、letterbox、caption 和 camera key；运行时将结果写回同一 camera 的 `Transform`（`hellforge/src/cutscene.ts:1-12`, `hellforge/src/cutscene.ts:68-138`; `hellforge/main.ts:4154-4175`, `hellforge/main.ts:4220-4228`）。
- 它的可读战斗 beat 不是全局停时：den policy 只声明 `freezeAi + playerInvulnerable + playerInputLocked`（`hellforge/src/cinematic-policy.ts:21-45`）；主循环仅跳过 `monsters.tick`，并明确让 `skills.tick` 继续（`hellforge/main.ts:3970-3990`）。
- Hellforge 还直接写同一相机的固定角色选择构图（`hellforge/main.ts:3651-3667`）。这证明 Camera+Transform 足以做固定电影机位，无需先引入第二台相机。

### `fps`

- FPS 同样只生成一台 camera，并每帧写 FOV 与 `Transform` 来实现 ADS、recoil、bob 和 shake（`fps/main.ts:290-300`, `fps/main.ts:717-812`）。没有树内活动相机切换或电影时间线。

在 `rain-alley`、`hellforge`、`fps` 中未发现 `setActiveCamera` / `ActiveCamera` 调用；因此“多机位切换”是引擎已测试能力，但不是这三个游戏的已上线使用模式。

## 对 replacement spec 的边界

可承诺：

- 固定建立镜头、肩后镜头与 1–2 个预生成电影 pose；
- 直接改同一相机 pose，或用有效实体 ID 做瞬时硬切；
- 极短、显式时长、可跳过的游戏内 beat；
- 通过独立 gameplay/presentation 时钟或系统门控，停 AI/输入而继续镜头、UI和必要技能结算；
- 对纯 sampler 写单测，确保 `pose = sample(beat, t)`。

属于 overreach，不能写成已有引擎能力：

- 通用 sequencer、轨道编辑器、镜头资产、镜头栈、blend graph 或导演 API；
- 任意系统统一响应的全局 time scale / freeze；
- Timeline 与动画、音频、对白、粒子、物理的跨轨同步；
- 可回放/联网确定性的 cinematic simulation；
- 多 viewport、画中画或多相机同时渲染；
- 把 Hellforge 的游戏私有 `cutscene.ts` / `camera-rig.ts` 提升为稳定引擎契约。

因此，`rain-alley` 的产品规格应写“少量预制电影机位与游戏内 beat sampler”，不应写“依赖引擎 sequencer”。若只需 Investigation 或 Aftermath 的可读停顿，优先复用同一台相机并暂停 gameplay authority；只有确有硬切构图需求时才增加第二台 `Camera` 并调用 `setActiveCamera`。
