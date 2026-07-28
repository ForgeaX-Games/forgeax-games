# go-karts · ForgeaX 架构适配说明

## 目标

把 `claude-fable-5-93` 终局 Three 游戏**蒸馏语义**移植进 ForgeaX Studio：

- WebGPU + ECS + `bootstrap(world, ctx)`
- 静态场景进 `scene.pack.json`（Edit/Play 一致）
- 动态玩法进 `registerUpdate` + `InputSnapshot`
- 朝向单点 SSOT（`src/orientation.ts`）

**不是**在 `uiRoot` 再嵌一套 Three（那是 `kart-fable`）。

## 目录职责

```
go-karts/
├── forge.json              # id / entry / defaultScene / physics
├── main.ts                 # 瘦编排：adopt scene → 绑系统 → registerUpdate
├── src/
│   ├── orientation.ts      # ★ 朝向 SSOT（ToyKart +Z ↔ ForgeaX −Z）
│   ├── track-data.ts       # 赛道曲线（含 re-export orientation helpers）
│   ├── scene.ts            # adoptHostScene / loadByGuid / findByName
│   ├── kart-controller.ts  # 街机驾驶
│   ├── follow-camera.ts
│   ├── ai-racers.ts
│   ├── race-session.ts     # 圈数/阶段骨架
│   └── hud.ts              # DOM → ctx.uiRoot
├── assets/scene.pack.json  # 权威静态世界
└── scripts/
    ├── build-scene.mjs     # landmarks + ToyKart 层级 → pack
    ├── toy-kart-pack.mjs   # 程序化 ToyKart（内置 mesh）
    └── bake-race-world.mjs # 赛道离线烘焙
```

## 朝向硬约束（来自 DISTILLATION）

1. 比赛车身 = **ToyKart 语义**，车头本地 **+Z**（鼻在 +Z，尾翼 −Z）。
2. 驾驶根实体用 ForgeaX **−Z 前进**；`rootYaw = heading + π`。
3. `*Visual` 上施加一次 `MESH_PLUS_Z_TO_FORGEAX_YAW = π`，使 mesh +Z 对齐父 −Z。
4. 宠物挂在 **Visual** 上，位置 `TOYKART_SEAT = [0, 0.55, -0.25]`。
5. **禁止**用 `kart_*.glb` 当赛道车身（那是车库壳）。
6. 道具 lookAt：本地 −Z 朝赛道（bake 时写入 landmarks.yaw）。

## 当前 Play 策略（对照录屏）

录屏（车库 / 完整 HUD / 金币道具 / 街景）= **Three MainScene**。  
▶ Play 已改为嵌入原版（`main.ts` + `original/`），不再用几何 ECS 车糊弄观感。

ECS 骨架保留在 `main.ecs.ts`，仅作远期重写参考。
