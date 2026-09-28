<!-- context-audit:2026-09-10 -->
> 文档核对：2026-09-10。按源码使用的参考文档；文中的验收结果仅适用于其记录的版本和日期。
> 接手先读 [当前状态与入口](CURRENT.md)；[整理前原文](docs/archive/pre-management/README.md) 保留来源与原始内容。

# Rain Alley / 雨夜不回头

当前 FPS 使用[生活化街区与交战增量](docs/fps/LIVING-CITY.md)，并接入[性能优化与引擎交接](docs/fps/PERFORMANCE.md)：在原模型上保留旧铁门、破损、垃圾、小动物、楼梯连廊和高低屋顶，敌人可巡逻与还击，主角有受击和死亡重开反馈。默认加载合批派生资产 `assets/performance/district-batched.glb`，敌人 LOD 预加载，原场景保留；同机 720p 内嵌预览短窗口约 59–60 FPS，独立 Chrome 仍未通过 60 FPS 验收。

ForgeaX 港式街区射击项目。当前默认运行第一人称「雨巷军械库」：12 把可切换武器、瞄准/换弹/奔跑/跳跃及可复活训练目标。街区有 170 m 路网、24 栋建筑和四家可直接进入的店铺；新增 12 把 Blender 分件枪械、3 类可动人物、机械装填与港式案卷 HUD；旧第三人称剧情入口保留。

- [FPS 操作、参考分析与验证](docs/fps/README.md)
- [枪械 / 人物 Blender 与 Engine 交接](docs/fps/ART-HANDOFF.md)
- [当前街区接入、碰撞架构、导出和验证](docs/district/INTEGRATION.md)
- [引擎整体回归样本与建议](docs/district/ENGINE-REGRESSION.md)
- [可编辑 Blender 源文件与布局快照](assets-src/district/README.md)
- [产品目标](docs/SPEC.md) · [术语](CONTEXT.md)
- [历史 v2：50 m 街道](docs/STREET-INTEGRATION-2026-09-05.md)

## Run / 运行

在 ForgeaX Studio 中发现并选择 `rain-alley` 后 Play。默认入口为 `fps-main.ts`；将 `forge.json` 的 entry 改回 `main.ts` 可运行旧剧情模式。`forge.json` 声明 `physics: 3d`；运行时依赖 Studio workspace 的 `@forgeax/engine-*` 包，本目录不是独立 npm 应用。

FPS 启动调用 `installCityCollision(world)`，继承 `src/street-layout.ts` 的 117 个代理并校正 17 栋楼高，增加 48 个楼梯/平台代理，共 165 个静态物理体，再实例化 `assets/performance/district-batched.glb` 的视觉场景。旧剧情入口仍使用原 117 个代理。**运行时不调用 Blender MCP，也不读取制作阶段 JSON；GLB 导入不会自动创建这些碰撞体。**

FPS 操作：WASD 移动，左键开火，右键瞄准，R 换弹，Shift 奔跑，空格跳跃，Q/E 或滚轮切枪，1–0 快选前十把，B 打开全部军械库，M 静音。旧剧情模式的慢动作/迈坎仍仅属于 `main.ts`。

## Checks / 检查

在已解析 workspace 依赖的本目录执行：

```sh
bun run typecheck
bun test tests
```

2026-09-09：typecheck 与 71 项规则测试通过。当前性能与完整功能回归见 [性能交接](docs/fps/PERFORMANCE.md)。街区原交付的三条路线证据仍见接入文档；新增 FPS 的 12 枪、换弹、实际物理命中与四店输入驱动验收见 [FPS 验证记录](docs/fps/VALIDATION.md)。更新循环帧间隔不等于 GPU 耗时或输入延迟。
