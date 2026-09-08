# Brotato 3D v2

本模板当前交付 M2：M1 的角色模型套件、番茄主角、玩家移动与 25×25 紧镜头软跟随，叠加双武器自动战斗、发芽土豆敌人，以及红叉预告驱动的分阶梯部署。

详细规格见：

- [`docs/M2-SPEC.md`](docs/M2-SPEC.md)
- [`docs/brotato_3d_策划案_ca43b496.plan.md`](docs/brotato_3d_策划案_ca43b496.plan.md)

运行入口是 `src/main.ts`：

- `bootstrapPlugin` 提供固定相机、调试时钟和命令注册表。
- `m1ComponentsPlugin` 只注册 M1 自有 ECS 组件；场景组件由 `scenePlugin()` 统一拥有。
- `m1SystemsPlugin` 接入输入、移动、肢体动画和相机跟随。
- `arenaPlugin` 加载 Arena、番茄与战斗资产，注册部署/战斗/死亡系统、验收 gizmo/HUD，并绑定所有可逆清理。

`forge.json#canvas` 将游戏内部绘制缓冲区固定为 1600×900。DevKit 保持 GPU
画布为该尺寸，并将显示画布按 16:9 CSS contain-fit 到浏览器视口；窗口变大不会
增加游戏内部渲染像素数。

手动验收：进入 `forgeax dev .` 启动的页面后按 F1；用 WASD/方向键移动番茄，观察 F1 的坐标、速度、`ENEMIES`、`LIVE/PENDING/TIER/NEXT/RELAX`；按 F8 或 X 显示 7.5/11.0 出生环与视野内缩矩形；按 F5 或 T 显示武器目标线；按 F9 或 V 显示 25×25 标定线框；按 F4 或 G 开关压力测试；按 P 与 `.` 验证暂停和单步。Host `gameProjection` 还提供 `spawn.pause`、`spawn.burst`（`{count}`）、`spawn.clear`、`spawn.seed`（`{seed}`）四个部署验收 action。
