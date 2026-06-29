# Cow-Level Survivor

Vampire-Survivors-like 3D 弹幕生还游戏 · ForgeAX Engine. 致敬 D2 Cow Level —— 一片牛群从四面涌来，你撑得越久，武器升得越多。

## 玩法

| 键位 | 行为 |
|---|---|
| `WASD` 或 方向键 | 移动 |
| 鼠标 | FPS 视角转向 (pointer-lock) |
| `Space` | 跳跃 |
| `F` 或 鼠标左键 | 射击（FPS 锁定后左键自动开火） |
| `R` | 死亡后重开 |

顶视角和第一人称视角通过画面右上角按钮切换。

## 系统

- **Roguelike 武器** —— 起手一把基础枪，每升一级随机抽 3 张升级卡牌（武器解锁 / 武器进化 / 数值强化）。
- **敌人 wave** —— 多种牛系敌人（基础牛、近战冲锋、远程射手、Boss 牛王）按时间和等级 ramp。
- **掉宝 + XP** —— 击杀掉经验石（鲜血结晶），自动吸附；满经验自动升级 + 暂停游戏弹卡牌。
- **战斗反馈** —— 命中粒子 / 屏幕震动 / 浮动伤害数字 / 程序化音效（无外部 wav，全 Web Audio synth）。

## 文件结构

```
main.ts            ─ 引擎入口 (GameEntry)，串联关卡加载 + 输入 + 主循环 + 切关
forge.json         ─ 游戏 manifest（含 scenes 多关卡清单，编辑器场景切换器读它）
scenes/
  level1.pack.json ─ 第1关 静态场景（白天 · 奶牛关）
  level2.pack.json ─ 第2关 静态场景（夜晚 · 暗夜墓园）
src/
  levels.ts        ─ 关卡配置 SSOT：场景pack / 光照氛围 / 刷怪权重表 / 过关时长 / Boss
  hud.ts           ─ DOM overlay：HP/XP/计时/关卡角标/武器栏/死亡画面
  enemies.ts       ─ 敌人行为 + spawner（按 LevelConfig 驱动）+ AI + 外观pack加载
  weapons.ts       ─ 武器系统 + 子弹池 + 命中判定
  upgrades.ts      ─ 升级卡牌 UI + roll 逻辑
  fx.ts            ─ 命中特效 + 屏幕震动 + 浮动文字
  gems.ts          ─ XP 经验石 + 自动吸附
  sfx.ts           ─ Web Audio 程序化音效
  pixel-font.ts    ─ 5×7 像素字体（无外部资源）
scripts/
  gen-monster-packs.ts ─ 一次性：从 ENEMIES 内置定义导出怪物外观 pack
assets/
  base-material.pack.json ─ 基础材质包
  monsters/<kind>.pack.json ─ 每只怪的外观 SSOT（编辑器「怪物资产」组可直接编辑）
```

## 多关卡 & 角色/怪物资产 & 启动器

- **加新关卡**：编辑器场景下拉「＋ 新建场景」生成 `scenes/<id>.pack.json` 并
  登记进 `forge.json#scenes` → `src/levels.ts` 的 `LEVELS` 数组追加一条
  `LevelConfig`（刷怪权重 / 光照 / 时长 / Boss）。游戏按数组顺序推进，
  通关判定自动跟随 `LEVELS.length`。每关是独立场景树（第1关白天牧场 ↔
  第2关夜晚墓园：墓碑 / 枯树 / 地穴 / 发光灯柱，实体集完全不同）。
- **UE 内容浏览器习惯**：关卡、角色、怪物全是 Assets 面板里的资产——
  「关卡」分组双击在本窗口打开（窗口与关卡一对一绑定，绑定走 URL
  `?sceneFile=`，可开多个编辑窗口各编各的；右键/＋ 新建·复制场景）；
  「角色 & 怪物」分组双击进入资产编辑（近距取景 + 中性预览光），gizmo
  改部件 / 材质后自动保存回 `assets/monsters|characters/<name>.pack.json`，
  游戏下次加载即生效。外观与行为解耦：行为数值在 `src/enemies.ts` ENEMIES
  表；玩家出生点是场景里的 Transform-only `Player` 标记，外观来自
  `assets/characters/player.pack.json`。
- **启动器面板**：独立 dock 面板（与 Hierarchy/Assets 并列），显示本窗口
  正在编辑的关卡 + ▶ Play 运行目标 radio（全局 main 完整战役 / 仅某一关）。
  写入 `play-config.json`（gitignored，开发者本地状态），`main.ts` 启动时读取。

## 作为案例的看点

- **`scene.pack.json` ↔ `main.ts` 分工** —— 静态场景全在 pack 里，✎ Edit 模式跟 ▶ Play 完全一致；动态游戏循环在 `main.ts`。
- **DOM HUD overlay 唯一例外** —— 所有渲染走 ECS，唯独计分/武器栏/死亡画面是 `document.createElement`（参考 `src/hud.ts`）。
- **物理打靶 + roguelike 数值** —— 用引擎 `RigidBody`/`Collider` 做命中判定，外加纯 TS 数值层做升级 / 升级卡牌。
- **零外部音频资源** —— `src/sfx.ts` 全 Web Audio API 合成，方便理解游戏中如何接入声音。
