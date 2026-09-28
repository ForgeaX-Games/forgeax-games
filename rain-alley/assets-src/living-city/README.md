<!-- context-audit:2026-09-10 -->
> 文档核对：2026-09-10。按源码使用的参考文档；文中的验收结果仅适用于其记录的版本和日期。
> 接手先读 [当前状态与入口](../../CURRENT.md)；[整理前原文](../../docs/archive/pre-management/assets-src/living-city/README.md) 保留来源与原始内容。

# Living city production

以现有 `assets/weather/district-rain.glb` 为唯一街区输入，保留网格基础、布局和门洞，输出独立 `assets/living-city/` 与 `rain-alley-lived.blend`。

生产顺序：textures.py → Blender background build_city.py → 同步 layout.json 到 src/fps/city-layout.ts → import_assets.py → 正式 catalog/cook → 实机验收。

完整功能、物理边界、版本限制和验证入口见 [LIVING-CITY.md](../../docs/fps/LIVING-CITY.md)。不运行 Cycles。不要导出源场景外停放的动物/武器到完整街区；脚本已分别选择导出。
