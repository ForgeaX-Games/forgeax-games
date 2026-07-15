# SHELL-AND-UI-PORT-SPEC — 从 aidiablo 移植「游戏外壳 + UI 系统」

> **这份文档是什么**:把参考项目 **aidiablo**(一个 Three.js/WebGL 的 D2-like 联机 ARPG)里已经打磨成型的 **启动界面 / 角色选择 / 游戏内 UI(HUD)** 的**设计与数据契约**,转写成 hellforge(ForgeaX ECS + WebGPU 引擎)可执行的移植规格。
>
> **给谁看**:在 `packages/games/hellforge/` 里实现前置流程与 HUD 的 AI agent / 开发者。
>
> **怎么用**:这是**蓝图**,不是可直接编译的代码。aidiablo 与 hellforge 技术栈完全异构(见 §1),**能迁移的是设计、交互、数据契约,不是实现代码**。文档里每一块都给出「aidiablo 怎么做的(带 `file:line`)→ hellforge 该怎么落地」。需要回看 aidiablo 源码时,它在本机:`/Users/you/dev/aidiablo2.25- 2/`(目录名带空格),前端在 `web/`,共享类型在 `shared/`。
>
> **范围**:本文覆盖 ① 启动流程 & 场景编排 ② 角色选择 & 创建 ③ 游戏内 UI(HUD)。**不含**关卡场景边界(留待后续单独落档)。

---

## 0. TL;DR

1. **前置流程只能做进 hellforge 游戏包内部**。宿主(play-runtime / preview)是"单游戏薄壳",从 canvas 直接进 `bootstrap(world, ctx)`,**没有 title/menu/角色选择层**,也不该改(引擎子模块 ubpa 维护)。所以 Title→角色选择→进游戏这套流程,要在 `hellforge/main.ts` 的 `bootstrap` 里、拉起战斗世界**之前**先展示。
2. **UI 走 DOM overlay,零引擎风险**。aidiablo 的 UI 几乎不碰 Three.js(全是 DOM + Canvas2D 叠在画布上),hellforge 现有 `hud.ts`/`inventory-ui.ts` 也正是这个套路(`installXxx(mount) -> Handle`)。前置界面与新 HUD 都照这个模板做,挂到 `ctx.uiRoot`。
3. **数据契约可直接搬**。`ClassDef` / `CLASS_DEFS` / `CharacterRecord` / 属性计算公式都是纯数据纯类型,零引擎依赖,是风险最低、最该先落地的部分。
4. **角色 3D 模型不要搬代码**。aidiablo 的职业模型是**程序化几何体 + 手写 sin/cos 动画**;hellforge 用 **GLB skinned mesh + AnimationPlayer clip**。这块是"重做资产 + 语义映射",走 hellforge 既有的 charactery GLB 路子(主 checkout 里 `characterd.glb`/`charactern.glb` 已在备)。
5. **多英雄要新建抽象**。hellforge 当前是硬编码单法师(`WITCH` 常量 + 无 class 字段的 `createPlayer()` + 扁平 `SKILLS`),接角色选择前要先把它重构成"按所选英雄取值"。

---

## 1. 前提:两个项目为什么不能共用代码

| 维度 | aidiablo(参考源) | hellforge(移植目标) |
|---|---|---|
| 渲染 | Three.js / WebGL | 自研 `@forgeax/engine-*` + **WebGPU** |
| 架构范式 | OOP 场景类(`GameScene` extends …) | **ECS**(`world.spawn` + components) |
| 场景数据 | 代码里生成(`GameScene.ts` 16000+ 行) | `assets/scenes/*.pack.json` 做 SSOT + array-TRS |
| 加载模型 | 独立 HTML app,`main()` 自 bootstrap | 被宿主用 `loadGame` 动态 import 的**内容包**,入口 `bootstrap(world, ctx)` |
| 角色模型 | **程序化几何体 + 程序化动画**(`buildXxxModel` + sin/cos) | **GLB skinned mesh + AnimationPlayer**(5-clip) |
| 前置流程 | 完整:Title→CharSelect/List→Settings→Waiting | **完全没有**,直接进战斗切片 |
| 存档/会话 | `localStorage` + `window.name` hack | 宿主 `uiRoot`/`registerCleanup`;存档待定 |

**结论**:UI 层(DOM/Canvas2D)与数据契约层可高保真移植;3D 相关(角色模型、预览渲染、GameScene 本体)必须按引擎范式重做。下面每块都按这个分界给方案。

---

## 2. 落地锚点:hellforge 消费端现状(你要挂在哪)

> 这一节是移植的地基。先认清 hellforge 提供什么、约束什么,后面 §3–§5 的方案都建立在此。

### 2.1 入口是 `bootstrap`,不是 `GameEntry`(AGENTS.md 已过时)

hellforge 实际入口:`export async function bootstrap(world, ctx?)`(`main.ts:153`),类型 `BootstrapEntry`;`loadGame` 校验 `typeof module.bootstrap === 'function'`。engine-app 位于嵌套 monorepo:`packages/editor/packages/engine/packages/app/`。

```ts
// packages/editor/packages/engine/packages/app/src/game-context.ts
export type BootstrapEntry = (world: World, ctx?: BootstrapContext) => void | Promise<void>;

export interface BootstrapContext {
  readonly renderer?: Renderer;
  readonly assets: AssetRegistry;                       // loadByGuid / catalog / instantiate
  readonly app: App;                                    // start/stop/pause/resume + registerUpdate + onError
  readonly registerUpdate: (fn: (dt: number) => void) => void; // ★ 每帧回调(替代 aidiablo 的 rAF)
  readonly defaultSceneRoot?: EntityHandle;             // 宿主已实例化的 defaultScene 根
  readonly defaultScene?: SceneAsset;
  readonly uiRoot?: HTMLElement;                        // ★ 受控 UI 挂载点(■Stop 时整体移除)
  readonly registerCleanup?: (fn: () => void) => void;  // ★ 非 DOM 副作用清理(逆序 flush)
  readonly setPointerLockAllowed?: (allowed: boolean) => void;
}
```

关键能力映射(aidiablo → hellforge):

| aidiablo 用的 | hellforge 换成 |
|---|---|
| `requestAnimationFrame` 自持循环(每个 IScene 一条) | `ctx.registerUpdate((dt) => …)` 引擎统一 tick |
| `document.body` append UI | `ctx.uiRoot`(嵌入编辑器视口时用 `position:absolute`,裸 body 用 `fixed`) |
| `beforeunload` / 场景 `destroy()` | `ctx.registerCleanup(fn)`(每个 `addEventListener`/`install*` 后紧跟一条) |
| 资产加载(GLTFLoader 等) | `ctx.assets.loadByGuid` / `instantiate` |
| `new GameScene({...})` 进游戏 | 在 bootstrap 里拉起 ECS 战斗世界 |

### 2.2 没有外壳层 → 前置流程做进游戏包

两个宿主(引擎自带 `apps/preview`、编辑器 `play-runtime`)加载合同一致:`createApp(canvas)` → 实例化 `defaultScene` → `resolveGame(slug)` → `entry(world, ctx)` → `app.start()`。**中间零 menu/title/character-select**。所谓"游戏选择"是 IDE/Studio 层选 slug 的事,不随游戏发布。

→ **Title / 角色选择必须在 `hellforge/main.ts` 的 `bootstrap` 里实现**:进 bootstrap 后先只 spawn 一个相机 + 用 `ctx.uiRoot` 挂前置 UI,玩家选完角色再拉起营地世界 + HUD。通用层不要动(AGENTS.md `:168` 明令别改引擎子模块)。

### 2.3 hellforge 现有 UI 套路:`installXxx(mount) -> Handle`

`hud.ts` / `inventory-ui.ts` / `render-settings.ts` 全是**纯 DOM overlay 叠 canvas**(文件头注释:"gameplay/render stays pure ECS; this file only paints UI",`hud.ts:12-13`)。统一模板:

```ts
export function installHud(args: { mount: HTMLElement; ... }): HudHandle {
  const root = document.createElement('div');
  root.style.cssText = (args.mount !== document.body ? 'position:absolute' : 'position:fixed') + ';inset:0;pointer-events:none;…';
  args.mount.appendChild(root);
  // …createElement + el.style.cssText 内联样式;注入 @keyframes;需要交互的节点单独开 pointer-events:auto
  return {
    setOrbs(hp, maxHp, mp, maxMp) { /* 命令式 setter,主循环每帧调 */ },
    setSkills(...) {}, setXp(...) {}, showArea(...) {},
    dispose() { root.remove(); /* 解绑 listener */ },
  };
}
```

要点:①`mount` 默认 `document.body`,传 `ctx.uiRoot`;②更新是**命令式 setter**(主循环推数据),不是响应式;③回调解耦(UI 不含游戏逻辑,事件通过回调回传);④`dispose()` 由 `ctx.registerCleanup` 注册。

→ **aidiablo 的 Title/CharSelect/Settings/HUD 全部照这个 `install*` 模板落地**,是零引擎风险路径。

### 2.4 场景切换:引擎有,但 hellforge 刻意回避

引擎有 `@forgeax/engine-state`(`defineState` / `setNextState` / `addOnEnter` / `despawnOnExit`,demo 里状态变体名甚至就叫 `main-menu`)。但 hellforge **刻意不用**——AGENTS.md `:145-146`:营地与地牢在**同一个 world**(地牢偏移到 (300,300) 超出 far plane),进出=**传送玩家**,不走引擎场景切换(规避 fullRebuild 黑屏 bug)。`enterArea()`(`main.ts:1068`)只改局部变量 + 灯光 + HUD 标题,无 scene load/unload。

对"多个前置界面切换"的含义:

- **纯 UI 界面之间切换(Title ↔ 角色选择 ↔ Settings)**:不换 3D 场景,**用 DOM overlay 显隐即可**,完全绕开黑屏风险 —— 推荐路径。
- **角色选择要 3D 展示模型**:把预览模型放偏移位、菜单期相机看过去(沿用 hellforge 的"同 world + 偏移"土办法),或承担 engine-state 的验证成本。**不要**天真地引入引擎场景切换。

### 2.5 多英雄:当前零抽象

`WITCH` 是硬编码单一 GUID 集(`main.ts:80-89`);`createPlayer()`(`src/state.ts`)返回写死数值、**无 class 入参**;`SKILLS`(`src/skills.ts:55`)是扁平法师专属数组、按 index 绑 1-4 键。全无 hero/archetype 抽象。

→ 接角色选择前,先新建**英雄定义表**(见 §4.4),把 `WITCH`/`createPlayer()`/`SKILLS` 从单例常量重构成"按所选 `heroId` 取值"。这块是纯新增,不受引擎约束。

---

## 3. 模块 A:启动流程 & 场景编排

### 3.1 aidiablo 的两层状态机

aidiablo **没有单一状态机**,是两层松耦合(移植时建议合并简化):

- **逻辑/网络状态** `AppState`(`main.ts:24`):`title | charSelect | connecting | waiting | playing | disconnected | stopped | ended`
- **视觉场景类型** `SceneType`(`SceneManager.ts:6`):`title | charSelect | charList | game | settings`

前置菜单流(Title/CharSelect/CharList/Settings)由 `SceneManager` 管;进游戏后 `WaitingUI` 和 `GameScene` **绕过** SceneManager 直接挂 body。切游戏时不销毁菜单,只是把菜单容器 `display:none`(`main.ts:290`)——**这是隐患,移植时应主动 dispose**。

**hellforge 建议**:hellforge 是单机(`PLAY_EXPERIENCE.md`:多人/netcode 明确 out of scope),所以 `connecting/waiting/disconnected` 这些**网络子状态可以全部砍掉**。前置流程简化为一个线性 UI 状态机:

```
boot → title → (newGame → charSelect | continue → charList) → charCreated/charPicked → inGame
```

用一个 `let shellState: 'title'|'charSelect'|'charList'|'settings'|'inGame'` + DOM 显隐驱动即可,无需引擎场景切换。

### 3.2 SceneManager / IScene → hellforge

aidiablo 的 `IScene`(`SceneManager.ts:8`)只有 3 个方法,**没有 update**(各场景自持 rAF):

```ts
export interface IScene { show(): void; hide(): void; destroy(): void; }
```

`switchTo()` 时序值得保留:`fadeOut(400ms 黑遮罩)` → 旧场景 `hide()+destroy()` → 新场景 `factory()` → `show()` → `fadeIn`。

**hellforge 落地**:

- 不要照搬"每个场景一个 class + 自持 rAF"。做一个轻量 `ShellManager`,每个界面是一个 `install*(mount) -> Handle`(§2.3 模板),`Handle` 加 `show()/hide()`;切换 = 隐藏旧、显示新。
- 过渡遮罩:aidiablo 是 CSS `opacity` 黑 div —— hellforge 直接用一个 `uiRoot` 里的黑色 overlay div + CSS transition 即可(纯 DOM,别上 WebGPU pass)。
- **动画循环**:所有 `requestAnimationFrame`/`performance.now` 换成 `ctx.registerUpdate((dt)=>…)`;粒子等表现层也走这条。

### 3.3 进游戏的 hand-off 窄口(最重要的移植分界)

aidiablo 前置流程与游戏本体的**唯一强耦合**是这一处(`main.ts:715` `startThreeGame()`):

```ts
new GameScene({ client, playerId, isSpectator, onRequestRestart });
```

即前置流程只需把 **选定的 `classId` + `playerName`** 交给游戏本体。**hellforge 对应**:前置 UI 完成 → 用选定的 `heroId`(见 §4.4)在 bootstrap 里初始化战斗世界(spawn 对应英雄的 GLB + 属性 + 技能组)。

→ 这个窄口意味着**可以分阶段移植**:先做前置流程骨架(纯 DOM,不碰战斗世界),游戏本体保持现状,选角结果先只驱动"用哪个英雄 GLB"。

### 3.4 三个界面的构成与移植路线

| 界面 | aidiablo 实现 | 渲染 | 移植路线 |
|---|---|---|---|
| **TitleScene**(`scenes/TitleScene.ts`, 845 行) | 背景图 + 金属渐变 logo + 左右火把光效 + 暗角 + Canvas2D 粒子(ember/snow/smoke/spark)+ 石刻按钮 | **纯 DOM + Canvas2D**,零 Three.js | 整块作 DOM overlay 直接搬。背景/logo/火把/暗角是 CSS;粒子 Canvas2D 保留。金属渐变字靠 `background-clip:text`,DOM 下可直接用。按钮条件逻辑:有存档→"继续"+"新建";无→"开始";恒有"设置"(`TitleScene.ts:270`) |
| **WaitingUI**(`scenes/WaitingUI.ts`, 164 行) | 联机等待/连接/断线/玩家列表/开始按钮 | **纯 DOM**(innerHTML 模板) | **hellforge 单机,基本整块删掉**。若保留"开始游戏"确认步,退化成一个简单按钮即可 |
| **SettingsScene**(`scenes/SettingsScene.ts`, 564 行) | BGM/SFX 音量+静音、语言 EN/中文、确认/取消(带回滚) | **纯 DOM**(自绘 slider + toggle) | DOM 逻辑可搬;音量接 hellforge 音频系统;`render-settings.ts`(F10 面板)已是同类实现,可合并复用其 `localStorage` 持久化套路(key `hellforge.render.v1`) |

### 3.5 引擎耦合点处理清单(模块 A)

| 耦合点 | aidiablo | hellforge 处理 |
|---|---|---|
| 引导入口 | `index.html` + 全局 `main()` | 搬进 `bootstrap(world, ctx)` |
| UI 挂载 | `document.body` / `#scene-container` | `ctx.uiRoot` |
| 帧循环 | 各场景自持 `requestAnimationFrame` | `ctx.registerUpdate` |
| 过渡遮罩 | CSS opacity 黑 div | 同左(DOM overlay,不上 WebGPU) |
| 清理 | `destroy()` / `beforeunload` | `ctx.registerCleanup` |
| 音频 | Web Audio + `audiobus` 事件总线 | **事件总线模式保留**(场景只 `emit`),后端换 hellforge 音频 |
| i18n | `t()` + `Language='en'|'zh'` | 可整体保留,带上 `class.*.name/description` 文案 key |
| 持久化 | `window.name`(跨刷新 hack)+ localStorage | `window.name` 方案不可移植;单机可暂用 localStorage,长期走平台存档 |

---

## 4. 模块 B:角色选择 & 创建

### 4.1 流程

```
Title ──"新游戏"──> CharSelectScene(选职业+起名) ──onCreateCharacter(name,classId)──> 写存档 ──> 进游戏
     └──"继续"────> CharListScene(存档列表) ──onEnterGame(id)──> 进游戏
                              ├─ onNewChar ──> CharSelectScene
                              └─ onDeleteChar(id) ──> 删存档(二次确认,需输确认词)
```

- **CharSelectScene**(`scenes/CharSelectScene.ts`, 1008 行):D2R 篝火风,一排职业人物按弧线排布,点击选中→放大高亮+头顶光环。当前只显示 3 个职业(barbarian/sorceress/necromancer,其余被 `HIDDEN_CLASSES` 过滤,`:43`)。底部:角色名输入(maxLength 12)+🎲随机名+创建按钮。场景本身不落库,只把 `(name, classId)` 抛给上层。
- **CharListScene**(`scenes/CharListScene.ts`, 1017 行):WoW 风左预览右列表,`MAX_CHARS=12`,列表项=职业图标+名+`职业名·Lv.等级`,删除需输入确认词(`:887`)。

### 4.2 数据契约(★ 可直接搬,零引擎依赖 —— 优先落地)

以下类型/数据是纯 TS,原样复制到 hellforge 即可用(来自 `shared/types.ts` 和 `shared/config.ts`):

```ts
// ClassId(types.ts:302)—— hellforge 可先只启用有 GLB 的几个
export type ClassId = 'barbarian' | 'sorceress' | 'amazon' | 'necromancer'
  | 'paladin' | 'druid' | 'assassin' | 'warlock';

// ClassDef(types.ts:311)—— 职业定义的核心契约
export interface ClassDef {
  id: ClassId; name: string; icon: string; description: string; lore: string;
  coreMechanic: string; coreMechanicDesc: string;
  baseStatMods: { hp?: number; mp?: number; damageMin?: number; damageMax?: number;
                  defense?: number; attackSpeed?: number; critChance?: number };
  growthMods: { hpMult: number; mpMult: number; dmgMult: number; defMult: number };
  skillTrees: [SkillTree, SkillTree, SkillTree];
  canUseShield: boolean; canDualWield?: boolean;
  exclusiveWeaponTypes?: WeaponType[]; classSkillKey?: string;
  defaultSkillBar: number[];              // 6 格技能栏初始
  initialSkills: Record<number, number>;  // skillId → level 初始自带
}

// 角色存档(main.ts:60)—— 真正落 localStorage 的结构
export type CharacterRecord = {
  id: string; playerName: string; classId: ClassId; level: number;
  lastRoomId?: string; lastPlayerId?: string; mapSeed?: number;  // 单机可删这三个
  createdAt: number; lastPlayedAt: number;
};
// key='aidiablo_characters', MAX_CHARACTERS=12
```

属性计算基准(`config.ts:171`/`:192`):

```ts
export const PLAYER_BASE_STATS = { hp: 80, mp: 40, damageMin: 4, damageMax: 8, defense: 2,
  attackSpeed: 1.5, attackRange: 1.5, critChance: 0.05, critMultiplier: 1.5, /* …perLevel */ };
// 五段式成长 [startLv,endLv,hp/lv,mp/lv,dmg/lv,def/lv]
export const PLAYER_GROWTH_SEGMENTS = [[1,18,12,6,1.5,0.5],[19,36,18,9,2.5,1.0],
  [37,55,28,14,4.0,2.0],[56,72,42,21,6.5,3.5],[73,99,60,30,10.0,5.5]];
```

> **属性计算契约(务必保留)**:最终属性 = `PLAYER_BASE_STATS` + `ClassDef.baseStatMods`;升级成长 = `PLAYER_GROWTH_SEGMENTS[段] × ClassDef.growthMods.*Mult`。aidiablo 里这套算在**服务端**,存档只存元数据。**hellforge 是单机,必须把这套计算在客户端/ECS 系统实现一份**(否则选了职业却没有职业差异)。

### 4.3 ⚠️ 角色 3D 模型:重做资产,不要搬代码

> [!CAUTION]
> aidiablo 的职业模型 = **一棵 `THREE.Group` 关节树 + 每帧手写 `sin/cos` 改 Euler 角**(`web/models/BarbarianModel.ts` 等,共享契约 `ClassModelParts` 暴露 12 个关节 Group,共享动画 `animateRun/Hit/Death` + 各职业 `idle/attack/cast`)。**没有骨骼蒙皮、没有 AnimationClip。**
>
> hellforge 的角色 = **GLB skinned mesh + `AnimationPlayer` 播 clip**(见 `CHARACTER-ANIMATION-CONTRACT.md`,charactery 5-clip:idle/move/attack/hit/death)。
>
> **这两者不是 1:1 搬运。** 不要移植 `buildXxxModel` 的几何体拼装代码。

语义映射方案:

| aidiablo | hellforge |
|---|---|
| `buildBarbarianModel()` 程序化几何体 | 每职业一个 **GLB**(带骨架+蒙皮),`pack`/`main.ts` 引用 GUID。主 checkout 已在备 `characterd.glb`/`charactern.glb` |
| `ClassModelParts` 12 个命名关节(upperBody/headGrp/leftArm/lElbow/…) | GLB armature 的 bone;若运行时要程序化控制(挂点/特效),留一张"逻辑关节名→bone 名"映射表 |
| `animateXxxIdle/Attack/Cast`(sin/cos 手写) | 烘焙成 GLB 的 **AnimationClip**,交给 `AnimationPlayer` 按状态机切 |
| 死灵法师 `orbitSkulls` 环绕头骨、`buildAuraDisc` 光环(`NecromancerModel.ts:136`) | GLB 装不下的运行时 VFX → hellforge **粒子/特效 entity**,挂骨骼挂点 |
| CharSelect 每职业一个 `THREE.WebGLRenderer` 预览(`:513`) | 一个 ECS 子场景/离屏视口,camera+灯光+角色 entity 播 idle clip;或沿用"同 world 偏移位 + 相机看过去"(§2.4) |

> **注**:aidiablo 里 `create3DCharacterBody()`(`CharSelectScene.ts:561`)有一段现成的 GLB 加载 + 包围盒归一化 + 裁手臂逻辑(当前未启用),可作 GLB 加载的参考;但 hellforge 应走引擎的 glTF loader,不用 Three 的 `GLTFLoader`。
>
> **另注**:`web/scenes/ModelFactory.ts` 名字有误导 —— 它是**场景道具工厂**(木桶/宝箱/神龛/树/栅栏),**与角色无关**。角色模型在 `web/models/`。

### 4.4 hellforge 侧要新建的英雄抽象

因为 §2.5 单英雄硬编码,接角色选择前先建英雄定义表(纯新增):

```ts
// 建议新建 src/heroes.ts
interface HeroDef {
  id: ClassId;                       // 复用 aidiablo 的 ClassId 命名
  displayName: string;               // i18n key 或直接文案
  gltf: { scene: string; clips: { name: 'idle'|'move'|'attack'|'hit'|'death'; guid: string }[] };
  scale: number;                     // 类比 PLAYER_SCALE=1.3
  baseStats: PlayerStatsInit;        // = PLAYER_BASE_STATS + ClassDef.baseStatMods
  growth: ClassDef['growthMods'];
  skills: SkillDef[];                // 该英雄的技能组(替代当前扁平 SKILLS)
}
const HEROES: Record<ClassId, HeroDef> = { /* charactery=sorceress; characterd/charactern=… */ };
```

然后把 `WITCH`(`main.ts:80`)→ `HEROES[pickedHeroId].gltf`;`createPlayer()`(`state.ts`)加 `heroId` 入参按 `HeroDef.baseStats` 初始化;`SKILLS`(`skills.ts`)→ `HEROES[heroId].skills`。

### 4.5 存档

aidiablo:localStorage key `aidiablo_characters` 存 `CharacterRecord[]`;CRUD 全在 `main.ts`(`getCharacterList/saveCharacter/deleteCharacter/upsertCharacterLevel`,`:119-155`)。`window.name` 存会话缓存(断线重连用 —— 单机不需要)。

hellforge:CRUD 逻辑可整体搬(纯逻辑);存储后端单机可暂用 localStorage(换 key,如 `hellforge.characters.v1`),长期走平台存档 API。**删掉断线重连相关字段与 `window.name` 那套**。

---

## 5. 模块 C:游戏内 UI 系统(HUD)

### 5.1 核心洞察:一切由「引擎无关的快照」驱动

aidiablo 所有 HUD 组件都不碰 Three.js —— 它们每帧读一份 `client.getRenderState()` 返回的纯数据快照(`PlayerSnapshot` 子集),把 UI 当作快照的纯函数投影(`GameScene.animate()` `:15616` → `updateHUD(state)` `:14701`)。

→ **hellforge 落地第一步:定义一个引擎无关的 `HudViewModel`**,ECS 每帧从组件组装它,喂给 UI:

```ts
interface HudViewModel {
  hp: number; maxHp: number; mp: number; maxMp: number;
  xp: number; xpToNext: number; level: number; gold: number; skillPoints: number;
  skillBar: number[];                       // 6 格 skillId
  skillLevels: Record<number, number>;
  cooldowns: Map<number, number>;           // skillId → 就绪时间戳(客户端本地预测)
  buffs: { id; remainMs; totalMs; effects }[];
  potions: { q?; w? };
  areaName: string;
}
```

有了它,aidiablo 绝大部分 UI 渲染代码可复用。

### 5.2 组件可复用性分级(★ 没有任何组件强绑 Three.js)

| 组件 | 文件 | 渲染 | 评级 | 说明 |
|---|---|---|---|---|
| **KeyBindings** | `ui/KeyBindings.ts` | 无(纯逻辑) | **①直接搬** | 动作→按键映射 + localStorage + 冲突自动交换。改 `STORAGE_KEY` 即可。**最该第一个搬** |
| **BuffIcons** | `ui/BuffIcons.ts` | Canvas2D | **①直接搬** | 程序化画 D2 风金属圆图标,输出 `HTMLCanvasElement`。含 27 个 buff 定义 + `SKILL_BUFF_MAP` + 伤害类型色表。引擎无关 |
| **BuffDisplay** | `ui/BuffDisplay.ts` | DOM+Canvas2D | **①几乎搬** | 独立组件,构造只需 `parent`,API 干净(`addBuff/update/clear`),扇形倒计时。接 hellforge buff 数据即可 |
| **CubeUI** | `ui/CubeUI.ts` | 纯 DOM | **①几乎搬** | 3×4 合成格 + Transmute,回调解耦。**当前是孤儿代码(全仓未接线)→ 无历史包袱**,最适合直接拿去接 `inventory-ui.ts` |
| **DebugHUD** | `ui/DebugHUD.ts` | 纯 DOM | **①→②** | 结构照搬;数据源从 aidiablo 网络层换成 hellforge 帧率/指标 |
| **AutomapRenderer** | `ui/AutomapRenderer.ts` | Canvas2D | **①渲染/②数据** | 全屏 overlay,**自带等距投影**(`w2s()` `:211`,不用相机矩阵),渲染整体可搬;探索迷雾算法(`Set<"x,y">`)可搬;数据要换成 hellforge 的 tile/ECS 世界数据 |
| **SkillTreeRenderer** | `ui/SkillTreeRenderer.ts` | Canvas2D | **②借鉴 IA** | 渲染自包含可搬,但强依赖 aidiablo 的 `SkillDef` schema(synergies/auraEffects/prerequisite…)。**最有价值的是信息架构**:tooltip "当前级/下一级预览/协同加成" 分区、按需求等级自动分层、可学脉冲/满级金星/连线视觉。按 hellforge 技能 schema 重写数据层 |
| **主 HUD**(球+技能栏) | `GameScene.createHUD/updateHUD` | 纯 DOM+CSS | **②借鉴布局** | 见 §5.3 |

> 评级:①=设计+代码几乎可照搬(纯 DOM/Canvas overlay);②=借鉴信息架构/视觉,数据层重写。**无 ③**。

### 5.3 主 HUD 布局(D2 经典视觉配方)

底部 fixed 条 `height:150px`,`pointer-events:none`,flex 三段:`[石像+HP球(红)] [中央底板] [MP球(蓝)+石像]`。

- **HP/MP 球**(`GameScene.makeOrb` `:14905`):130px 圆,液体 = `height:{pct}%` 渐变 div(bottom:0 上涨),波浪 = CSS `@keyframes d2-wave1/2`(`:13625`),玻璃反光/内辉光呼吸纯 CSS。**不是 canvas**。HoT 用更亮的叠加层。中央白描边数值。
- **中央底板**(`:15000`):金属渐变 `border-image`。自上而下:XP 条(紫,`width:{xpPct}%`)→ HP/MP 文本 → 技能栏行 `[药水W][6×技能格52px][药水E]` → 快捷按钮行 C/K/S/I/Q/Y/Tab(`onclick` 派发合成 `KeyboardEvent`,一种 DOM→键盘桥)→ 底部 `Lv|XP|★金币|技能点|区域名`。
- **技能格**(`:14805`):图标(img/emoji)+ 右下槽位号 + 左上技能等级 + 冷却半透明遮罩+径向填充+倒计时 + 缺蓝蓝色叠加 + learned/ready 调 opacity/边框。
- **视觉体系(值得抄)**:等宽字体 `'Courier New'`;金色强调 `#c8a84e/#c8a951/#f0c840`;暗棕金属面板 + `border-image` 渐变边;z-index 分层(HUD 100/buff 101/minimap 110/tooltip 200/fullmap&skilltree 500-600/cube 7000/debug 1000)。

**hellforge 落地**:hellforge 已有 `hud.ts` —— **只移植 D2 布局与视觉配方**(三段底栏、液体球 CSS 配方、技能格叠层规则、金属配色),数据绑定改成读 `HudViewModel`。

> [!CAUTION]
> aidiablo 主 HUD 每帧 `innerHTML` **全量重建 + 重绑事件**(`GameScene.ts:14991`),是明显性能坑。hellforge 移植时**务必改成增量更新 DOM 节点**(hellforge `inventory-ui.ts` 已有 "cheap full rebuild — 30 nodes" 的克制注释,可参考其粒度)。

### 5.4 数据绑定注意点

- **技能冷却** `skillCooldowns`(`GameScene.ts:14815`)是**客户端本地预测**的 Map,不从快照读 —— 单机 hellforge 直接本地算即可。
- **Buff 倒计时**两种范式并存:HUD 内联版**服务器驱动**(直接用 `remainMs/totalMs`);独立 `BuffDisplay.ts` 是**客户端 `update(dt)` 增量**。单机选后者(客户端增量)更自然。
- **探索迷雾**(Automap)是客户端持久状态(`exploredByZone: Map<zone, Set<"x,y">>`),按玩家位置每帧累积,可照搬。

---

## 6. 分阶段落地路线

按"风险从低到高、依赖从少到多"排:

1. **数据契约层(零风险,先做)**:搬 `ClassId`/`ClassDef`/`CharacterRecord`/`PLAY­ER_BASE_STATS`/`PLAYER_GROWTH_SEGMENTS` + 属性计算公式。建 `src/heroes.ts` 英雄表(§4.4)。
2. **纯逻辑 UI(①级,直接搬)**:`KeyBindings` → `BuffIcons` → `BuffDisplay` → `CubeUI`。改 storage key、接 hellforge 数据。
3. **前置流程骨架(DOM overlay)**:`ShellManager` + Title(照 `install*` 模板)+ 简化版"开始"确认。用 `ctx.uiRoot`/`registerUpdate`/`registerCleanup`。选角结果先只决定"用哪个英雄 GLB"。
4. **角色选择 UI + 3D 预览**:CharSelect/CharList 的 DOM 逻辑搬;3D 预览按 §4.3 用 GLB + AnimationPlayer 重做(依赖英雄 GLB 资产就绪)。
5. **HUD 重做**:定义 `HudViewModel`,ECS 每帧组装;按 §5.3 移植 D2 布局到 hellforge `hud.ts`,增量更新。
6. **Automap / SkillTree**:搬渲染,换数据源(依赖 hellforge tile/技能 schema)。

模块 A(前置流程)与游戏本体只靠 §3.3 的窄口耦合,可独立推进,不阻塞战斗世界。

---

## 7. 风险 & 坑清单

- **别改引擎/宿主层**:前置流程做进游戏包 `bootstrap`,不要试图给 play-runtime/preview 加菜单层(AGENTS.md `:168`)。
- **别引入引擎场景切换**:纯 UI 界面切换用 DOM 显隐;换 3D 场景会碰 hellforge 刻意回避的 fullRebuild 黑屏(§2.4)。
- **角色模型别搬程序化代码**:走 GLB + AnimationPlayer(§4.3)。
- **属性计算别漏**:aidiablo 在服务端算,hellforge 单机要自己实现一份(§4.2)。
- **HUD 别每帧全量重建**:改增量更新(§5.3)。
- **`localId` 连续性**(若前置流程/预览要写场景 pack):见 AGENTS.md `:101` 的 CAUTION,增删节点后重排 `localId` 为 `0..N-1`。
- **`window.name`/localStorage hack 不可移植**:换平台存档;删断线重连字段。
- **文案两套来源**:`CLASS_DEFS` 里有硬编码中文 `name/description`,i18n 又有 `class.*.name` key(`CharSelectScene.ts:293`),移植时统一到一处。

---

## 附:aidiablo 源码索引(回看用)

根:`/Users/you/dev/aidiablo2.25- 2/`

**启动流程 & 编排**
- 入口/存档 CRUD/网络编排:`web/main.ts`(`:24` AppState、`:60` CharacterRecord、`:119-155` 存档 CRUD、`:715` startThreeGame hand-off)
- 场景管理:`web/SceneManager.ts`(`:6` SceneType、`:8` IScene、`:82` switchTo)
- 标题:`web/scenes/TitleScene.ts`(`:74` buildDOM、`:270` 按钮条件、`:673` 粒子)
- 等待/设置:`web/scenes/WaitingUI.ts`、`web/scenes/SettingsScene.ts`

**角色选择**
- 选职业:`web/scenes/CharSelectScene.ts`(`:43` HIDDEN_CLASSES、`:482` 预览渲染、`:852` 创建、`:561` GLB fallback 参考)
- 角色列表:`web/scenes/CharListScene.ts`(`:21` CharRecord、`:887` 删除确认)
- 模型契约/共享动画:`web/models/ClassModelTypes.ts`(`:6` ClassModelParts)
- 职业模型:`web/models/{Barbarian,Necromancer,Sorceress}Model.ts`
- 数据:`shared/types.ts`(`:302` ClassId、`:311` ClassDef、`:247` SkillTree、`:680` PlayerSnapshot)、`shared/config.ts`(`:171` PLAYER_BASE_STATS、`:192` GROWTH、`:4592` CLASS_DEFS)

**UI 系统**
- 主 HUD:`web/scenes/GameScene.ts`(`:13728` createHUD、`:14701` updateHUD、`:14905` makeOrb、`:13625` 球 CSS、`:15616` animate 主循环)
- 组件:`web/ui/{KeyBindings,BuffIcons,BuffDisplay,CubeUI,DebugHUD,AutomapRenderer,SkillTreeRenderer}.ts`

**hellforge 消费端**
- 入口/生命周期:`main.ts`(`:153` bootstrap)、`packages/editor/packages/engine/packages/app/src/{game-context,types,load-game}.ts`
- UI 模板:`src/{hud,inventory-ui,render-settings}.ts`
- 单英雄现状:`main.ts`(`:80` WITCH)、`src/{state,skills}.ts`
- 角色动画契约:`CHARACTER-ANIMATION-CONTRACT.md`
