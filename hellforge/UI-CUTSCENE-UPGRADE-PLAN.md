# UI-CUTSCENE-UPGRADE-PLAN — Hellforge UI 视觉升级 + 最小过场系统

> 状态：🟢 SPEC · 执行中（2026-07-20，方案 1 已经用户确认）
> 上游：`docs/handoff/2026-07-20-hellforge-ui-cutscenes.md`（studio 仓）
> 参考工程：`/Users/you/dev/aidiablo2.25- 2`（**只看设计；图标 PNG 为用户自有 AI 生成资产，已获准拷贝子集**）
> 范围铁律：不改玩法权威；不做 audio / Fog-DoF / DDC / marketplace；不搬 aidiablo 代码；不发明暴雪专有名词。

## 0. 视觉方向

不换皮：保留 forge-gold / ink / crimson 身份（`src/ui-theme.ts`），对齐 D2 签名特征——
对称 orb 底栏、石质全高侧栏、金字宽字距衬线标题、真图标（emoji 退场）、情境光标、黑屏过区。
升级路径：**token 收口 → 工艺加深 → 真图标 + 展示字体 → 交互手感**。

## 1. 差距表（2026-07-20 盘点）

| 维度 | 现状 | 目标 |
|---|---|---|
| 主题 token | 新面板已 token 化；char-select/char-list/cube-ui/buff-display/automap/fatal-overlay/部分 Title 硬编码 hex | 全部收口到 `ui-theme.ts` |
| 图标 | emoji（🪄🎩🧥👢💍📿 / 🪓🔮💀 / 🔥❄️⚡🌀） | aidiablo PNG 子集（见 §2）；空位用同图 grayscale 剪影 |
| 字体 | 单一系统 serif 栈 | 捆绑 Cinzel woff2（OFL）作展示字体（Latin/数字），CJK 落 Songti |
| Tooltip | HUD 用 native `title`；inventory 自绘对比 | 全局 `ui-tooltip.ts`（边缘钳制），两处迁入 |
| 交互 | 点击装备、无拖拽、无自绘光标、切屏 instant、loading 裸文本 | bag↔equip 拖拽、情境光标、fade 过渡、loading 精修 |
| 过场 | 零 | Phase B 最小系统 |

可复用地基（不重造）：`ui-layer-manager.ts` 输入漏斗（main.ts:1865-1871）、
`camera-rig.ts` blend/damp、`render-settings.ts` z-40/41 overlay 模式、`registerUpdate` 动画模型。

## 2. 图标资产映射（aidiablo `dist/icons/` → `assets/ui/icons/`）

| Hellforge | aidiablo 源 | 说明 |
|---|---|---|
| weapon（杖） | `crystal_staff.png` | SLOT_META + 掉落/背包 |
| helm | `iron_helm.png` | |
| armor | `chain_mail.png` | |
| boots | `leather_boots.png` | |
| ring | `ring.png` | |
| amulet | `amulet.png` | |
| 技能 熔火弹 magma | `skills/mage_huodan.png` | |
| 技能 霜牙 frost | `skills/mage_bingdan.png` | 冰晶矢，贴合"冰箭"语义 |
| 技能 电弧涌 arc | `skills/mage_shandian.png` | |
| 技能 影踏 blink | `skills/mage_chuansong.png` | |
| 光标 ×6 | `mouse/cursor_{default,attack,interact,loot,talk,portal}.png` | 情境光标 |

职业图标（🪓🔮💀）：aidiablo 无对应资产 → 用主题 SVG 纹章（不搬代码，自绘）。
provenance：以上 PNG 均为用户自有工程的 AI 生成资产（aidiablo v0.5.0 `dist/icons/`），Cinzel 为 SIL OFL 1.1。

## 3. 分期与验收

### Phase 0 — 基准 ✅/⬜
- [x] 基线 `bun test hellforge/src` = 183 pass（2026-07-20）
- [ ] 本 SSOT + handoff §8 指针
- [ ] 图标/字体资产落仓

### Phase A1 — 共享层 ✅（2026-07-20 完成）
- [x] `ui-theme.ts` 扩展：石纹/角饰/分隔件 helper、`Z` z-index 表（cube-ui legacy z-7000 已收编）
- [x] `src/ui-tooltip.ts`：全局 tooltip（边缘钳制）；hud native `title` 与 inventory compare 已迁入
- [x] `src/ui-icons.ts`：图标注册表 + `<img>`/剪影；emoji 全部退场（items/skills/classes 域字段已清）
- [x] `src/ui-cursors.ts`：全局 gauntlet 光标（取代原 ember-crosshair 内联方案；情境切换留 `setCursor()` 待 A3 评估 hover 缝）
- [x] `src/ui-transition.ts`：fade cover + zoneCard；shell 切屏（fadeNav）与 den↔wild 传送已接入，coverUp 门控 WASD
- [x] Cinzel `@font-face`（`assets/ui/fonts/`，OFL 出处文件随附）

### Phase A2 — 逐屏精雕 ✅（2026-07-20 完成）
- [x] HUD：orb transform-only 液体动效（`setOrbMotion` 开关）、技能格/装备 chip PNG 图标化、全局 tooltip
- [x] Inventory：角饰 + bag↔equip 鼠标拖拽（6px 阈值 + 幽灵图标 + 落点金框；点击/右键熔炼保留；未做 multi-cell）
- [x] Character / Skill / Quest / Dialogue：统一 chrome（石纹+角饰+Z 表）；skill 树节点主动技图标；dialogue typewriter（点击补全）+ `.hf-btn`
- [x] Shell 三屏：loading 精修（Cinzel 金字+扫条+tip）；char-select / char-list token 收口；Title 本已 token 化
- [x] automap / buff-display / cube-ui / fatal-overlay token 收口（cube/buff 保持 orphan）

### Phase A3 — 验收 ✅（2026-07-20，真实 `:18920` 内嵌 Play）
- [x] `bun test hellforge/src` = **190 pass / 0 fail**（含 cutscene 7 例）；`check-game-engine-imports` tsc 0 错
- [x] 双分辨率（1920×1080 / 1280×720）走查：Title / CharSelect / CharList / loading / HUD / inventory / skill / character / quest / tooltip hover 全部截图核验
- [x] **顺带修复启动级 bug**：`assets/` 根 4 个孤儿 `*.jpg.meta.json`（#37 删源留壳）触发 `pack-orphan-meta` 使 hellforge 整个 pack catalog 塌缩为 [] → `defaultScene 未实例化`。git rm 后恢复（332 条）
- [x] 顺带修复 Vite 资产 URL 陷阱：动态模板 `new URL(\`…${rel}\`)` 被转成**非递归** glob（skills/cursors 子目录全 undefined）；改 base+concat，目录 URL 掉尾斜杠需补
- ⚠️ 未浏览器验证（留给真人）：dialogue typewriter 实机、inventory 拖拽（需先有掉落）、den zoneCard 实机、orb 动效开关（API `setOrbMotion` 在；settings UI 勾选框未做）

### Phase B — 最小过场系统 ✅（2026-07-20）
- [x] 契约：`src/cutscene.ts` 纯数据 script + `sampleCutscene()`（fade/letterbox/caption/镜头关键帧，复用 `lerpCameraRig`+smoothstep）；`src/cutscene.test.ts` 7 例全绿
- [x] `src/cutscene-ui.ts`：letterbox 双黑条（金线描边）+ fade cover + Cinzel caption；Z 表入位
- [x] 输入：`UiLayerManager` 新增 `'cutscene'` 面板——复用 worldInputBlocked 漏斗；**Esc=skip**（验收：`active() === 'cutscene'` → Esc → null）
- [x] 镜头：update loop 内 cutscene 分支接管 rig，播完 `makeArpgAtPlayer()` 交还；不暂停 AI
- [x] 样例：① 营地入场（黑起 + 24m→arpg 缓推 + letterbox + 「余烬哨站」caption，每次进游戏播一次；`window.__hf.playCampIntro()` 可复播）② 进 den 黑屏 zoneCard（A2 已交付）
- [x] PR4a 追加（2026-07-24）：`__hf.playFaceCu()` / `__hf.playFinisherClimax()` / `__hf.playerEyeFocus()` — Face CU 跟 `headfront`/`Head` 世界坐标，勿再刷 Boss 验收（详见 `docs/handoff/2026-07-24-hellforge-pr4a-bootstrap.md`）
- [x] 浏览器验收：caption/letterbox 截图在案；skip/输入阻塞经 `__hf.uiLayers.active()` 断言

### Phase C — 叙事过场（可选，另立计划）

## 4. 明确不做

audio；engine Fog/DoF；DDC；marketplace；merchant/waypoint/gamble/铁匠/成就/聊天/多人 lobby（方案 2 才解锁）；
inventory multi-cell；键位重绑 UI；暴雪专有名词；搬 aidiablo 代码；视频过场。

## 5. 风险与对策

输入抢占 → 只走 UiLayerManager 既有漏斗；HMR 泄漏 → 每 install 有 dispose、动画走 registerUpdate；
资产 provenance → 用户自有 AI 图标 + OFL 字体，均注明；性能 → dirty-setter/增量更新，禁每帧 innerHTML；
双 git → 全 commit 在 forgeax-games 本分支；验收 → 每期双分辨率走查，不攒账。

---

# 方案 R — aidiablo 1:1 完全重构（2026-07-21 用户指令推翻微调路线）

> 用户：「完全复刻 aidiablo 的 UI（装备/技能/药水等），完全重构，不能微调」+ PoE2/Exile-UI tooltip 参照。
> 移植纪律：样式照抄、代码重写。规格锚点 = agent 从 aidiablo 源文件实测提取（GS 行号在案）。

## R 分期与验收（全部 ✅，199 tests / tsc 0 错，双分辨率走查在案）

- [x] **R1 HUD 底栏**：130px orb（5px 圈+双层波浪+玻璃+脉动辉光）、gargoyle 石像、中央石板（顶缘紫 XP 条）、4 技能格（48px 像素化图标/冷却罩/三态边框）+ 2 药水格（40px 药瓶+计数）、C/K/B/Q/Tab 快捷按钮行（可点击）、meta 行；equip chips 移除
- [x] **R2 药水**：domain 计数（cap 20，红 30/蓝 20 瞬回）+ `use-potion`/`add-potion` op + Digit5/6 + 掉落进腰带（满则旧即时恢复）+ 新角色 2红1蓝、旧存档 0/0（可选字段不 bump schema）+ 3 单测
- [x] **R3 Inventory**：右 560px 全高石板（三层颗粒底 + 石柱 56px 铆钉 + 琥珀宝石角饰 + 标题带金线菱形）、stone-inset 纸娃娃槽（SVG 剪影）+ 8×3 背包格工艺 + 金币 pill + 拖拽绿/红高亮
- [x] **R4 Character**：左 420px 全高石板 + 战力块（dps/ehp 代理 + 装备 Σscore/等级×8/技能×12 三贡献，纯函数 `computeCombatPower` 可测）+ 攻击/防御/其他 分组
- [x] **R5 技能树**：石刻沟槽石板 + 右侧竖排 tab（激活金框+左指三角）+ 技能点盒 + 54px 节点（满级金/已学绿/未学灰 五档渐变 + 等级徽 + 可学绿脉冲 + 满级★）+ 直角三层金属管连线+箭头 + 深蓝 tooltip 分区 + 右键投点 + 点空白关板
- [x] **R6 Tooltip**：全局壳换 `rgba(0,0,0,0.96)`+`#5a3a1a`；物品分区 = 名（品质色居中）/ 基底行（分隔线）/ 属性（roll 值 + 灰区间 `7–19%`，`affixRangeFor` 4 单测）/ 需求 / 传奇 flavor / 对比；技能 tooltip 按元素色（火/冰/电）
- [x] **R7 Title/过场**：aidiablo `title_bg.jpg` 实图背景（brightness 0.55 / saturate 0.8）；zoneCard = Cinzel 32 `#d4a853` + 320×8 红条里程碑 + tip + 500ms 淡出；区域弹字 36px
- [x] **R8 验收**：199 pass / 0 fail；`check-game-engine-imports` tsc 0 错；1920×1080 + 1280×720 走查截图（`.forgeax/playwright-mcp/r1..r8-*`）

### R 期修复的坑（记录在案）
1. 过场计时改 **wall-clock**：dt 累加在帧循环被打断时会把脚本冻在中途（`'cutscene'` 占有态卡死，输入全锁）。
2. **不要用 `iframe.location.reload()` 驱动游戏重载**——会拆 Play 会话并在引擎侧留下孤儿 mesh handle（RhiError 刷屏）。正确做法：studio 页面重开 ▶ Play。
3. `new URL(\`…/${rel}\`, import.meta.url)` 被 Vite 转非递归 glob（子目录资产 undefined）；静态目录 URL 会被改写丢尾斜杠——统一 base+concat 并 `replace(/\/?$/,'/')`。

### R 期明确不做
商店/传送点/成就/聊天/多人；多格物品/socket/双持/盾；HoT 药水（只有瞬回）；aidiablo 代码直搬；Courier New 字体（保 Cinzel+宋 身份）。
