<!-- context-audit:2026-09-10 -->
> 文档核对：2026-09-10。按源码使用的参考文档；文中的验收结果仅适用于其记录的版本和日期。
> 接手先读 [当前状态与入口](../../CURRENT.md)；[整理前原文](../../docs/archive/pre-management/assets-src/district/README.md) 保留来源与原始内容。

# District authoring source / 街区制作源文件

`rain-alley-district.blend` 是可继续编辑的 Blender 源文件，贴图打包在文件内。验证环境为 Blender 5.2.0 LTS。运行时 GLB 与 sidecar 位于 `../../assets/district/`，当前主街区不会覆盖 v2 `assets/street/`。

`district-layout.game-y-up.json` 是从制作数据整理的交接快照：米制、Y-up，包含 117 个碰撞代理、路线、门洞与定位标记。它不是 ForgeaX 正式 schema，也不是游戏运行时加载文件。运行时数据在 `../../src/street-layout.ts`；改动碰撞或定位点时两者必须一起更新。

导出集合：VISUAL、INTERIOR、COVER、DOOR、SPAWN、PORTAL。排除 COLLISION、REF、相机和检查灯。GLB 使用 Y-up、Apply Modifiers、Tangents、Custom Properties；关闭动画、相机和灯。COLLISION 保留在 Blender 用于编辑，通过游戏 TS 独立创建物理体。

资产外观是 1990 年代港式街区美术原型；生成纹理和印刷图集已内嵌。正式发行的来源/字体/许可复核仍是独立门槛。不要把 EEVEE 检查灯光视为游戏运行时灯光。
