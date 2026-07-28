# go-karts · ForgeaX 原生移植

目标：把 Fable5 萌宠卡丁车**蒸馏语义**写进 ForgeaX 框架，而不是嵌套跑 Three。

## 平台契约（本包遵守）

| 项 | 做法 |
|----|------|
| 入口 | `export async function bootstrap(world, ctx)` |
| 静态世界 | `assets/scene.pack.json`（`forge.json.defaultScene`） |
| 动态玩法 | `registerUpdate` + `InputSnapshot` |
| HUD | DOM 挂 `ctx.uiRoot` |
| 朝向 | 只改 `src/orientation.ts` |

**不是** `original/` Three 嵌入（那是对照用旁路，不进本包 Play）。

## 对照真相源

- 录屏 / Vite 原版：`forgeax-games/claude-fable-5-93` + `DISTILLATION.md`
- 需要看原版观感时用独立 Vite 或 slug `kart-fable`，**不要**当交付架构

## 当前 ECS 完成度

| 模块 | 状态 |
|------|------|
| 干净赛道（沥青/路缘，去掉噪点草/木/叠层街景） | 有 |
| 场景布局 = landmarks → prop_*.glb | 有 |
| 车/宠 = kart_*.glb + pet_*（visual +Z→−Z） | 有 |
| 贴纸 HUD / 漂移 / 圈数名次 | 有 |
| 金币收集（运行时 pickup + HUD 计数） | 有 |
| 车库选装 / 道具箱效果 / 完整街景程序化 | 未 |

重建场景：`node scripts/build-scene.mjs`  
（可选重烤仅赛道：`node scripts/bake-race-world.mjs` 已默认不 bake 街景）
