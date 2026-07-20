# Cow-Level Survivor

Vampire-Survivors-like 3D 弹幕生还游戏 · ForgeAX Engine. 致敬 D2 Cow Level —— 一片牛群从四面涌来，你撑得越久，武器升得越多。

## 玩法

| 键位 | 行为 |
|---|---|
| `WASD` 或方向键 | 移动 |
| 鼠标 | FPS 视角转向（pointer lock） |
| `Space` | 跳跃 |
| `F` 或鼠标左键 | 射击（FPS 锁定后左键自动开火） |

顶视角和第一人称视角通过画面右上角按钮切换。

## 运行时边界

- **静态关卡、玩家和怪物外观**都是 native `SceneAsset`。游戏只保存 GUID，经由 `assets.loadByGuid<SceneAsset>()` → `world.allocSharedRef()` → `assets.instantiate()` 载入；不直接 `fetch()` `.pack.json`。
- **关卡**在 `assets/scenes/`，`src/levels.ts` 的 `sceneGuid` 是关卡配置的唯一资源身份。
- **玩家**是关卡场景中的 Transform-only `Player` marker。运行时将物理组件加到 marker，再把玩家 SceneAsset 实例化为它的子树。
- **怪物**由一个动态 kinematic physics root 加一个 native SceneAsset visual instance 组成。行为/数值在 `src/enemies.ts`，视觉层级和材质留在 `assets/monsters/*.pack.json`。
- **效果**的几何/材质归场景资产；`src/effects.ts` 仅保留 FxSystem 的运行时寿命、池大小和 shader 参数策略，不再引入另一条 JSON 传输路径。

## 文件结构

```text
main.ts                       ─ 引擎入口：GUID 场景加载、输入、主循环、切关
forge.json                    ─ 游戏 manifest；defaultScene 为 campaign fallback
assets/
  scenes/level1.pack.json     ─ 白天奶牛关 SceneAsset
  scenes/level2.pack.json     ─ 夜晚墓园 SceneAsset
  characters/player.pack.json ─ 玩家视觉 SceneAsset
  monsters/<kind>.pack.json   ─ 怪物视觉 SceneAsset
src/
  levels.ts                   ─ 关卡 GUID + 光照 / 刷怪 / 时长 / Boss 配置
  enemies.ts                  ─ 行为、spawner、physics root + native visual instance
  effects.ts                  ─ FxSystem 的运行时效果策略
  fx.ts                       ─ 世界空间视觉效果 + 屏幕震动
  hud.ts                      ─ DOM overlay：HP / XP / 计时 / 武器栏
  weapons.ts                  ─ 武器、子弹与命中判定
  gems.ts                     ─ XP 经验石与自动吸附
  upgrades.ts                 ─ 升级卡牌 UI
  sfx.ts                      ─ Web Audio 程序化音效
```

## 多关卡与启动器

- 编辑器发现每个 SceneAsset 的 GUID；Launcher 持久化 `play-config.json` 中的 `sceneGuid`，而不是 filename / `level2` 一类派生 ID。
- Host 在 bootstrap 前选择 `selectedSceneGuid ?? forge.json.defaultScene` 并预实例化该场景。这个选择是 editor/host 的资源选择职责，**不是 engine launch protocol**。
- Cow 根据 host 已实例化的 SceneAsset 决定自己的玩法：campaign fallback 从 Level 1 连续推进；非默认 Cow 关卡作为单关启动。live switch 消息是 `{ type: 'VAG_SET_LEVEL', sceneGuid }`，由 Cow 自己解释。

## 作为案例的看点

- **Edit = Play**：静态内容由同一套 SceneAsset 承载；Play 只添加 transient physics、HUD 和游戏行为。
- **GUID-first asset delivery**：资源 URL、Vite origin 和 pack-index 细节全部停在 host / `AssetRegistry` 边界；游戏代码不感知路径。
- **DOM HUD 唯一例外**：世界渲染走 ECS，计分/武器栏/死亡画面使用受 host 管理的 `ctx.uiRoot`。
- **零外部音频资源**：`src/sfx.ts` 用 Web Audio API 合成。
