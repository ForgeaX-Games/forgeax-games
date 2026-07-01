# 冰雕工坊 · Game Design

> Intent Notes:
> - 3D 凿冰 + **固定铡刀**切割塑形；核心乐趣是「懂规矩地切」——只能沿边缘下刀，直切中间会毛边
> - 玩家先从大冰块凿下一块可操作的冰坯，再旋转冰体、对准**固定铡刀**切出目标轮廓
> - **订单制**：每单可含多个子形状（组合订单）；切完一部分 → 放到**交货区确认** → 继续雕下一部分
> - **分次交货**允许但扣少量分；一口气整单做完拿满分奖励
> - **订单剧情**需非常丰富——叙事内容后续大量补充，本设计先搭好叙事框架与接口
> - 铡刀：空格下刀；凿子：切换工具后按动作键凿削
> - 雕刻中：WASD 旋转冰块；**鼠标右键**自由旋转观察视角
> - **交货**：**鼠标左键拖动**冰坯至交货区 **虚线槽位**，与目标形状对齐后 **F 部分交货** → 选择 **继续补充** 下一部件

## §1. Core Experience

玩家经营一间冰雕工坊，柜台不断送来带故事的订单——婚礼要一对交叠的心形冰托、酒楼要「鱼 + 莲」组合冰盘、神秘客人要三件套几何雕塑。面对一块半透明大母冰和一台**永远固定在切台正上方、不可移动、不可旋转**的铡刀，先用凿子敲下冰坯，再 **WASD 微调冰体朝向**，让固定刀刃恰好落在**外轮廓棱线**上。空格一落，切面平整、冰屑飞溅；贪快从中间一刀两断，断面碎裂、毛边、扣分。

一单往往不止一个形状：**组合订单**要求切出多个部件。某部件在砧台上修到大致达标后，进入**交货模式**：用 **鼠标左键拖动** 冰坯，移到交货区对应 **虚线轮廓槽位**，旋转/位移直到与 **目标形状 ghost** 对齐——系统实时检测叠合度，对齐后按 **F** 完成**部分交货**。随后弹出 **「继续补充」**：回砧台/母冰雕下一部件，或先回修当前件。分次交货会扣少量**连贯分**；剧情里客人对「分多次送来」可有吐槽。一口气全部备齐再统一 F 则拿整单 bonus。

核心情绪弧：**读订单故事 → 观察组合目标 → 凿料 → 旋转对准下刀 → 拖入虚线槽对齐 → F 部分交货 → 继续补充 → 整单结算**。单关 5–15 分钟；「再来一单」来自：丰富订单剧情、组合形状、对齐槽位的空间手感、整单满分。

## §2. Game Shape

- **Genre**: 3D 物理益智 / 手工模拟 + 订单叙事（轻经营）
- **Perspective**: 第三人称斜俯（默认），可右键 orbit 自由观察
- **Controls**（固定绑定）:

| 输入 | 功能 | 生效模式 |
|---|---|---|
| **W / S** | 绕 Y 轴旋转冰坯（对准固定铡刀） | 雕刻模式（砧台） |
| **A / D** | 绕 X 轴微倾冰坯 | 雕刻模式（砧台） |
| **鼠标右键拖动** | 自由 orbit 相机（绕场景中心旋转视角） | 全程 |
| **鼠标左键拖动** | **拖动冰坯**平移至交货区；跟随鼠标在 XZ 平面移动 | **交货模式** |
| **空格** | 铡刀下切 | 雕刻模式 · 铡刀工具 |
| **E** | 凿击 | 雕刻模式 · 凿子工具 |
| **F** | **部分交货**（冰坯已在虚线槽内且与目标形状对齐） | 交货模式 · 对齐达标时 |
| **1 / 2** | 切换工具：1=铡刀，2=凿子 | 雕刻模式 |
| **R** | 重置本部件（砧台冰坯姿态 / 交货区拖出位置） | 雕刻 / 交货 |
| **Esc** | 暂停 | 全程 |

**模式切换**：
- **雕刻模式**（默认）：砧台修形；WASD 转冰；左键**不**绑相机（避免与交货冲突）
- **交货模式**：当前 part 雕刻 IoU ≥ 软阈值（如 75%）时 HUD 提示「可交货」；点击 **「去交货」** 或自动切换——冰坯可 **LMB 拖动**；交货区显示该 part 的 **虚线目标轮廓 + ghost 剪影**
- 交货模式下仍可用 **WASD 微调冰坯朝向**（在槽位内旋转对齐 ghost）；RMB 始终转视角

- **Session length**: 一单 5–15 分钟（1–4 个部件）；战役模式连续接单；自由练习无叙事
- **Win**: 当前订单所有 **requiredParts** 均已交货且各部件 IoU ≥ 阈值；整单结算
- **Lose**: 当前部件冰坯过小（体积 < 目标 50%）；母冰耗尽且无法凿出新坯（可花「加冰费」续，叙事后续定）
- **Core loop**:

```
接单（剧情） → 看组合目标清单 → 下一未完成部件
    → 凿坯上砧 → WASD 对准固定铡刀 → 下切修形
    → 进入交货模式 → LMB 拖冰至虚线槽 → 与目标 ghost 对齐
    → F 部分交货 → 选「继续补充」→ 雕下一部件 / 回修
    → 全部 part 已交？整单结算 : 回到凿坯
    → 下一订单
```

- **Difficulty curve**:
  - 订单 1–3：单部件简单形（立方、圆柱）
  - 订单 4–6：双部件组合（心+心、圆+方底座）
  - 订单 7+：三部件以上、凹角星形/内孔、限时客人
  - 毛边容忍度与 IoU 阈值逐单提高；**整单一次交货**额外奖励逐单放大

## §3. Key Modules

### `fixed-guillotine`

- **Supports experience**: 铡刀作为关卡「绝对参照」，玩家只能动冰不能动刀
- **Gameplay**:
  - 铡刀实体 **世界坐标完全固定**：位置、旋转、尺度在 `scene.pack.json` 写死，`main.ts` 不驱动其 Transform（仅 Blade 子节点做落刀动画）
  - 刀刃为 **竖直平面**（世界 +X 常数平面，或 scene 中固定朝向）
  - 玩家通过 **旋转冰坯** 改变切向；不存在「移动铡刀」或「换刀位」
  - 落刀动画：仅 `GuillotineBlade` 的 `posY` 往复；刀架 `GuillotineFrame` 零位移
- **Technical approach**:
  - scene 中 `GuillotineFrame`（static）+ `GuillotineBlade`（animated child）
  - 切割平面方程从 Blade 静止时的世界矩阵导出，不随相机/冰坯变
- **Assets needed**: 铡刀架 + 刀片低模
- **Acceptance criteria**:
  - 任何操作下刀架不动；仅刀片上下
  - 同一冰坯朝向切 10 刀，刀刃世界位置完全一致

### `voxel-ice-body`

- **Supports experience**: 可切削、可凿削、可搬运的冰体实体
- **Gameplay**:
  - 冰体用 **3D 体素布尔网格**（建议 32×24×32，1 voxel ≈ 0.05m）
  - **母冰 BigBlock**：场景固定，可多次凿料
  - **冰坯 Workpiece**：凿离或切下后独立；同时仅 **1 块** 在砧台可切，**0–N 块** 已交货在交货区展示
  - 渲染：greedy-mesh 或 instanced cube，半透明冰蓝 PBR
- **Technical approach**: 同前 `IceGrid`；多 Workpiece 实例列表
- **Acceptance criteria**: 母冰、砧台冰坯、交货区成品可同时存在且 mesh 正确

### `guillotine-cut`

- **Supports experience**: 固定刀下的边缘切 vs 毛边切
- **Gameplay**:
  - 按空格 → 0.4s 落刀 → **固定平面**与砧台 Workpiece 求交 → 删 voxels
  - **边缘合法切**：交线 ≥30% 贴外轮廓（6-邻接暴露空气）
  - **中间非法切**：仍切，但断面随机抖动 + 毛边计数 + 碎裂 SFX
  - 冷却 0.6s；动画锁输入
- **Technical approach**: `classifyCut(plane, grid) → 'clean' | 'ragged'`；平面来自 `fixed-guillotine`
- **Acceptance criteria**: 同前；且与铡刀视觉位置一致

### `chisel-carve`

- **Supports experience**: 从大母冰凿下可操作冰坯
- **Gameplay**: 同前（E 凿击、连通分量分离）
- **Acceptance criteria**: 同前

### `ice-manipulation`

- **Supports experience**: 雕刻时转冰；交货时 **LMB 拖冰入槽**；全程 RMB 看视角
- **Gameplay**:
  - **雕刻模式**（`CarvePhase`）：砧台 Workpiece 用 WASD 旋转；RMB orbit 相机
  - **交货模式**（`DeliveryPhase`）：
    - 交货区每个 part 有 **虚线槽位**（`DeliverySlot`）：地面 dashed outline mesh 或 DOM 投影虚线框 + 3D ghost 目标形
    - **LMB 按住冰坯** → 沿鼠标射线与 `y=slotY` 平面求交，拖动冰坯 `posX/posZ`（带边界 clamp，不可拖出交货台）
    - 槽内仍可用 **WASD 旋转**冰坯，使体素投影与 ghost **对齐**
    - 实时 **对齐度** `alignScore`（槽位坐标系下 IoU / 轮廓距离）；达标时虚线变 **绿实线**，HUD 显示「按 F 部分交货」
  - 左键在雕刻模式下无效（或点击 UI「去交货」）；**绝不**用 LMB 绑 orbit，避免与交货拖动冲突
- **Technical approach**:
  - 状态机：`CarvePhase` | `DeliveryPhase`
  - `pickWorkpiece(screenX, screenY)` + 平面拖动 `dragOnPlane`
  - `DeliverySlot { partId, ghostTransform, dashedBounds, alignThreshold }`
- **Acceptance criteria**:
  - LMB 可平滑拖动冰坯至虚线槽
  - 对齐前后虚线颜色/ F 提示正确切换

### `composite-order`

- **Supports experience**: 一单多形状、组合目标
- **Gameplay**:
  - 订单 schema：`Order { id, narrative, parts: Part[], bonus: WholeDeliveryBonus }`
  - `Part { partId, label, targetMask, transformHint, iouThreshold, optional }`
  - **组合方式**:
    - **并列**：心 + 心（两个独立体，各交一次）
    - **底座+顶饰**：圆盘 + 星形（先交底座再交顶饰，或反之——`sequence` 字段约束）
    - **拼图式**：同一俯视图内多区域（mask 并集，但分 part 验收）
  - HUD：**部件 checklist**（☐ 鱼身 ☐ 莲叶 ☐ 底座），当前雕刻高亮
  - 玩家可自由选择未完成部件顺序（除非订单指定 `sequence: strict`）
- **Technical approach**:
  - `data/orders/*.json` + `data/masks/<partId>.json` 体素模板
  - 运行时 `OrderController.activePartId`
- **Assets needed**: 每部件目标剪影 UI；订单卡立绘（叙事用，后续补）
- **Acceptance criteria**:
  - 至少 1 个双部件 + 1 个三部件订单可配置并游玩
  - checklist 随交货更新

### `order-delivery`

- **Supports experience**: **LMB 拖入虚线槽对齐 → F 部分交货 → 继续补充**；分次 vs 整单评分
- **Gameplay**:
  - **交货区**（`DeliveryZone`）：右侧固定平台；每个未完成/待交 part 显示 **虚线轮廓槽**（dashed slot）；已交 part 槽位变为 **实线 + 成品冰雕固定展示**
  - **完整流程**:
    1. 砧台雕刻 IoU ≥ 软阈值 → HUD「可交货 · 点击去交货」→ 进入 `DeliveryPhase`（冰坯随玩家移至交货区附近，或整块瞬移至可拖区域）
    2. **LMB 拖动**冰坯进入对应 part 的 **虚线框**
    3. WASD 微调朝向，直至 `alignScore` ≥ 槽位阈值（可与雕刻 IoU 相同或略低，如 85%）
    4. 虚线 **变绿**，按 **F** → **部分交货**（播放落槽 SFX，该 part 锁定在槽位）
    5. 弹出 **后续选择面板**（非立即下一关）:
       - **「继续补充」**（主按钮）：关闭面板 → 回 **雕刻模式**；砧台清空；订单下一 `activePartId` 高亮；可凿新坯雕下一部件
       - **「再修修」**：该 part 从槽位 **退回可编辑**（已交标记撤销，扣少量信誉分 optional，后续叙事定）
       - **「整单确认」**（仅当所有 required parts 均已对齐交货时亮起）：一次性结算整单 bonus
    6. 选「继续补充」后重复凿→切→拖→F，直至全部 part `delivered`
  - **评分**:
    - 部件分 = 槽位最终 `alignScore` + 刀数 + 毛边
    - **分次交货惩罚**：每按一次 **F 部分交货**，整单连贯分 **−3%**（上限 −15%）
    - **整单一次确认奖励**：全部 part 已落槽后点「整单确认」而非逐个 F 后立即继续 → **+10% bonus** + `onWholeDelivery` 台词
  - 整单完成 → 结算屏 + epilogue
- **Technical approach**:
  - `alignScore = computeIoU(workpiece, targetMask, slotTransform)`
  - `onPartialDeliver(partId)` → checklist ☑ → show `PostDeliveryPanel`
  - `deliveryCount` 统计 F 次数
- **Acceptance criteria**:
  - LMB 拖入虚线框 + 对齐 + F 可完成单 part 交货
  - 点「继续补充」后回到砧台并可开始下一 part
  - 分 3 次 F 比整单确认连贯分低

### `order-narrative`

- **Supports experience**: 非常丰富的订单剧情（**内容后续大量补充**，本阶段搭框架）
- **Gameplay**:
  - **叙事层**（内容 pipeline，非阻塞实现）:
    - `Order.narrative`: `{ prologue, perPartHints[], onPartDelivered[], onWholeDelivery, epilogue, guestProfile }`
    - **客人档案**：姓名、身份、口癖、与前几单的 callback（`referencesOrderId`）
    - **分支台词**：毛边多 → 客人吐槽；整单满分 → 额外小费剧情；分次交货 → 「能不能一次送齐？」
  - **呈现**:
    - 接单：全屏/侧栏 **订单卡**（客人头像、需求清单、故事正文）
    - 雕制中：底部 **客人留言 ticker**（perPartHints 轮播）
    - 每次交货确认：短对话 bubble
    - 整单结束：epilogue + 解锁下一单
  - **后续补充方式**：纯 JSON/YAML 文案 + 可选 `narrative/` markdown，**不改代码**即可加订单
- **Technical approach**:
  - `NarrativeDirector` 读 `order.narrative`，按事件 `onDeliverPart | onRaggedCut | onOrderComplete` 触发 line
  - DOM `#narrative-panel`；i18n key 预留
  - Stage D 先实现 **2 条完整示例订单**（含组合形 + 分次/整单台词差分）；其余 slot 标 `TBD`
- **Assets needed**（后续）: 客人立绘 ×N、订单卡边框、打字机 SFX
- **Acceptance criteria**（框架）:
  - 新订单仅加 JSON 即可出现在游戏里
  - 交货/毛边/整单至少各触发 1 条不同台词

### `shape-goal-scoring`

- **Supports experience**: 单部件目标感
- **Gameplay**:
  - 每 **Part** 独立 `targetMask`、独立 IoU 阈值
  - 分数 = `IoU * 100 - raggedCutCount * 5 - cutCount * 2`（部件分）
  - 整单分 = Σ 部件分 × 连贯系数（见 `order-delivery`）
- **Acceptance criteria**: 砧台 IoU 达软阈值才可进交货模式；槽位 `alignScore` 达标才可 F；整单分含连贯扣分

## §3.5. Peripheral Systems

### Game Menu / Title Screen
- **Visual**: 冷色渐变 + 工坊招牌「冰雕工坊」+ 固定铡刀剪影
- **Flow**: 标题 → 主菜单
- **Items**: 继续接单 / 自由练习 / 订单图鉴（已完订单剧情回放，后续）/ 设置 / 退出
- **Implementation**: DOM `#game-menu`；`GameState` 含 `'order-briefing'`

### Order Briefing（接单界面）
- **Visual**: 订单卡 + 客人立绘（fallback 剪影）+ 组合目标缩略图（多部件并排）
- **Flow**: 选中订单 → 阅读 prologue →「开始雕刻」进入工坊
- **Interaction**: 可滚动阅读长文；「跳过」仅跳过动画不跳过文本摘要

### Pause & Resume
- **Trigger**: Esc
- **Overlay**: 继续 / 放弃本单（扣 reputation 后续）/ 返回标题
- **Pauses**: 冰旋转、落刀、搬运；BGM 30%

### Game Over / Result
- **部分交货后面板**（`PostDeliveryPanel`）：部件名、槽位 alignScore、**「继续补充」** / 「再修修」/ 「整单确认」
- **整单 Win**: 全部 part 已交 → 结算：部件分、连贯分、bonus、星级、epilogue
- **Lose**: 冰坯碎 / 母冰耗尽 → 重试或放弃本单

### Player Feedback & Juice
- **落刀 / 毛边 / 凿击**: 同前
- **可交货**: 砧台 IoU 达标 → HUD「去交货」脉动；交货区对应虚线槽 **闪烁**
- **拖动对齐**: 虚线框内 ghost 半透明；`alignScore` 进度条；达标虚线 **灰→绿**，F 键提示放大
- **F 部分交货**: 「咔」落槽 + checklist ☑ + 短对话 bubble
- **继续补充**: 面板关闭时镜头平移回砧台/母冰；下一 part 在 checklist 高亮
- **整单完成**: 全部槽位实线亮灯 + epilogue 打字机

## §4. Asset Requirements

### Image Assets

| 资产 | 描述 | outputSize | style | 用途 |
|---|---|---|---|---|
| `ice-noise.png` | 冰内部噪声 | 256×256 | semi-realistic | 冰材质 |
| `guillotine-frame.png` | 铡刀木架（**固定场景**） | 512×512 | semi-realistic | GuillotineFrame |
| `delivery-platform.png` | 交货区木台 | 512×256 | semi-realistic | DeliveryZone |
| `ui-slot-dashed.png` | 虚线槽位贴花（可 tiling） | 256×256 | anime-hd-flat | 槽位 dashed outline |
| `chisel-metal.png` | 凿子金属 | 256×256 | semi-realistic | 凿子 |
| `ui-order-card.png` | 订单卡背景 | 512×768 | anime-hd-flat | 叙事 UI |
| `ui-part-checklist.png` | 部件 checklist 框 | 256×400 | anime-hd-flat | HUD |
| `ui-target-composite.png` | 组合目标示意图集 | 1024×512 | anime-hd-flat | 多部件剪影 |
| `guest-portrait-*.png` | 客人立绘（**后续多张**） | 256×256 | anime-hd-flat | 叙事 |
| `particle-ice-chip.png` | 冰屑 | 64×64 | flat | 粒子 |
| `workbench-wood.png` | 砧台木纹 | 512×512 | semi-realistic | 切台 |

### Audio

| 类型 | 描述 |
|---|---|
| **BGM** | 工坊氛围 + 叙事屏安静变体，2 轨 |
| **SFX** | 落刀 clean/ragged、凿击、分离、**delivery-slot** 交货落槽、**order-bell** 新订单、level-complete、ui-click |
| **Narrative SFX**（可选） | 打字机、客人进门铃 |

## §5. Art Baseline

**Style preset**: semi-realistic

| Key Experience | Visual Presentation | Technical Realization |
|---|---|---|
| **固定铡刀** | 沉重木架占画面一侧，刀轨垂直，永不动 | scene static；仅 Blade 动画 |
| 组合订单 | HUD 多剪影 + 交货区多槽成品陈列 | DeliveryZone 槽位 Transform |
| 交货对齐 | 虚线槽 + ghost 叠合；对齐变绿；F 落槽 | dashed mesh + alignScore；PostDeliveryPanel |
| 订单剧情 | 订单卡、客人 bubble、长文本 | DOM narrative panel；JSON 驱动 |
| 冰块 | 半透明蓝白 | PBR + alpha |

## §6. Staged Development Plan

### Stage A: 固定铡刀 + 体素冰 + 旋转切割

- **Goal**: **固定铡刀**在 scene 中；砧台上一块冰坯；WASD 旋转；空格干净切
- **Modules**: `fixed-guillotine`, `voxel-ice-body`, `guillotine-cut`（clean）, `ice-manipulation`
- **Verify**: 刀架不动；冰可切可转；`/verify` ok
- **Deliverable**: 固定刀切冰原型

### Stage B: 凿子 + 母冰分离

- **Goal**: 母冰凿料 → 独立冰坯上砧
- **Modules**: `chisel-carve`
- **Deliverable**: 凿 → 切流程

### Stage C: 边缘毛边 + 单部件评分 + LMB 交货

- **Goal**: 毛边规则；砧台 IoU；**LMB 拖入虚线槽 → 对齐 → F 部分交货 → 「继续补充」**（单 part 订单）
- **Modules**: `guillotine-cut`（ragged）, `shape-goal-scoring`, `order-delivery`, `ice-manipulation`（DeliveryPhase）
- **Verify**: 达标 → LMB 拖至虚线框 → 对齐变绿 → F → 点继续补充 → 可重开下一单/练习
- **Deliverable**: 完整单部件「切 → 拖对齐 → F → 继续补充」循环

### Stage D: 组合订单 + 分次扣分 + 叙事框架

- **Goal**: 双部件组合订单；checklist；分次 vs 整单连贯分；**叙事 JSON 框架 + 2 条示例订单**（长文占位 + 交货差分台词）
- **Modules**: `composite-order`, `order-narrative`, §3.5 订单 briefing / 结算
- **Verify**: 交 part1 → 继续 part2 → 整单结算；分 2 次交比 1 次分低
- **Deliverable**: 可玩组合单 + 叙事 pipeline（内容可后续无限加）

### Stage E: 打磨 + 叙事内容扩充（持续）

- **Goal**: 菜单、5+ 订单剧情正文、客人立绘、粒子 juice
- **Note**: **丰富剧情主要由后续 JSON/markdown 补充**，不改核心代码
- **Deliverable**: 展示级「冰雕工坊」体验

---

## 附录 A：固定铡刀与区域布局

```
                    [固定铡刀架 + 竖直刀刃]
                              |
                              |  ← 刀刃平面（世界固定，永不移动）
                              |
  [母冰 BigBlock]     ═══════╪═══════ [砧台 CarveTable]
  （凿料）                  |
                            [冰坯] ← WASD 旋转对准刀

                    ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
                    [交货区 DeliveryZone]
                    ┄┄槽1┄┄  ┄┄槽2┄┄  ┄┄槽3┄┄  ← 虚线轮廓
                    LMB 拖冰入槽 → 对齐 ghost → F 部分交货
```

## 附录 B：订单数据示例（叙事后续扩充）

```jsonc
{
  "id": "order-wedding-hearts",
  "narrative": {
    "prologue": "（长文）明日婚礼，新人要一对交叠心形冰托……",
    "perPartHints": ["先雕左心，刃口要贴外缘。", "右心稍小，叠在左边。"],
    "onPartDelivered": ["「嗯，这颗心还算端正。」", "「另一颗也齐了？我看看……」"],
    "onSplitDelivery": "「怎么分两次送？罢了罢了，赶得上就行。」",
    "onWholeDelivery": "「一次送齐！师傅手艺真稳，小费多加五成。」",
    "epilogue": "（长文）婚礼当夜，冰烛台映得满堂晶亮……",
    "guestProfile": { "name": "王掌柜", "trait": "嘴硬心软" }
  },
  "parts": [
    { "partId": "heart-left", "label": "左心", "targetMask": "masks/heart-l.json", "iouThreshold": 0.85 },
    { "partId": "heart-right", "label": "右心", "targetMask": "masks/heart-r.json", "iouThreshold": 0.85 }
  ],
  "deliveryScoring": { "splitPenaltyPerConfirm": 0.03, "wholeBatchBonus": 0.10 }
}
```

## 附录 C：操作与交货流程

```
1. 读订单 → 2. 凿坯上砧 → 3. WASD 对准固定铡刀 → 4. 空格下切修形
5. 砧台 IoU 达标 → 6. 「去交货」进入交货模式
7. LMB 拖动冰坯至该 part 虚线槽 → WASD 微调与 ghost 对齐
8. 虚线变绿 → F 部分交货
9. 面板选「继续补充」→ 回砧台凿下一 part（或「整单确认」若已全部落槽）
10. 整单结算（连贯分 + epilogue）
```

**模式与按键分工**：

| 阶段 | 左键 | 右键 | WASD | F |
|---|---|---|---|---|
| 雕刻 | （无效 / 点 UI） | orbit 视角 | 转冰坯 | — |
| 交货 | **拖冰入虚线槽** | orbit 视角 | 槽内转冰对齐 | **部分交货** |

**继续补充**：每次 F 后默认引导点「继续补充」——回雕刻模式雕下一部件，不强制立刻交下一槽。

**整单满分**：全部 part 已拖入槽且对齐，用「整单确认」一次结算 → `onWholeDelivery` + 10% bonus。

**分次交货**：每按一次 F，`deliveryCount++`，连贯分 × `(1 - 0.03 × (deliveryCount - 1))`（下限 0.85）。
