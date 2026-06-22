# shoot-opt — 极光骑士团 · AURORA KNIGHTS

3D 飞机大战 · ForgeAX Engine。

> _"如果你撑不住——这座城就完了。"_ — 塔台最后的通讯

## 概述

俯视角 3D 弹幕射击。你驾驶原型战机 **苍鹰 (Azure Falcon)** 起飞，
保卫被「残烬军团」入侵的霓虹都市 **新苍穹市**。

## 玩法

| 键位 | 行为 |
|---|---|
| `Space` | 起飞（开场） / 射击 |
| `WASD` 或 方向键 | 移动 |
| `R` | 复活 / 通关后再来一局 |

- **HP 系统**：3 颗心，被打掉就 GG（盾可挡 1 次伤害）
- **Combo 系统**：连续命中得分倍增，最高 ×8
- **Power-ups**：盾🛡️ / 三连射🔫 / 全屏炸💣 / 回血❤️
- **Obstacle**：从顶部砸下来的废铁货柜，可摧毁也会撞死你

## 剧情节奏

游戏按分数推进 5 个 Wave + 通关结局：

| 触发分 | Wave |
|---:|---|
| 0 | 序章 — 黎明前的最后一架战机 |
| 2 000 | WAVE 01 · 突破外环封锁 |
| 6 000 | WAVE 02 · 钢铁之雨 |
| 12 000 | WAVE 03 · 红河之战 |
| 22 000 | WAVE 04 · 黑日降临 |
| 35 000 | FINALE · 极光破晓 |
| 50 000 | ✦ 通关 ✦ |

完整世界观见 [`story.md`](./story.md)。

## 模块结构

```
src/
├── main.ts        # 主循环 / ECS systems / HUD / 剧情触发
├── setup.ts       # 材质 + 几何注册
├── player.ts      # 苍鹰战机（29 个零件）
├── enemies/       # 6 种敌机：scout / fighter / bomber / interceptor / dreadnought / carrier
├── effects.ts     # 爆炸 / 尾焰 / 子弹
├── powerups.ts    # 道具 + 障碍
├── background.ts  # 城市 / 工业区 / 红河 / 公园 / 高速 五区域滚动背景
└── story.ts       # 剧情数据 + 开场/Wave 横幅/结局 UI（NEW）
```
