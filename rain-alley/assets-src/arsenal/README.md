<!-- context-audit:2026-09-10 -->
> 文档核对：2026-09-10。按源码使用的参考文档；文中的验收结果仅适用于其记录的版本和日期。
> 接手先读 [当前状态与入口](../../CURRENT.md)；[整理前原文](../../docs/archive/pre-management/assets-src/arsenal/README.md) 保留来源与原始内容。

# Blender source / 雨巷装备与人物

2026-09-08 暴雨精修已写回枪械 Blender：9 类钢、木、皮革等材质使用打包的 Base / Normal / ORM 贴图。`surface-blender-audit.json` 与 `surface-audit.json` 分别记录 Blender 几何不变、12 枪 GLB 几何和活动原点不变。

`base-glb/` 是精修前的可移植输入，`python refine_surfaces.py --source-dir base-glb` 从本目录执行可重建本轮 GLB；需要 NumPy/Pillow。不得把已精修输出重复作为输入。Blender 的常规再导出用于后续编辑，未保证与此二进制追加配方字节一致；所有再导出都须经正式 importer 与实机测试。

`rain-alley-arsenal.blend` 含 12 个枪械根对象，`rain-alley-characters.blend` 含 lookout / enforcer / boss 三类人物。源文件只包含对应资产场景和依赖，不含街区。纹理打包在文件内。

两份均为实际打开、导出过的 Blender 5.2 文件。网格以命名角色分件，人物手臂/前臂保留父子关系；不是骨骼蒙皮。人物服装色写入 `RA_CharacterPalette` 色板贴图，使用 UV0，用一个材质减少绘制批次。

在工作副本中编辑，保留根名称与 `asset__ROLE` 命名、原点和单位。枪械总览中根对象的排布只是 Blender 检查布局，导出时每个根恢复到零点。游戏枪口为 -Z；不要再次旋转 GLB。

```sh
Blender --background rain-alley-arsenal.blend --python export_assets.py
Blender --background rain-alley-characters.blend --python export_assets.py
```

使用实际 Blender 可执行路径；脚本按本目录相对位置输出到 `rain-alley/assets/arsenal/`。只在副本或允许覆盖本轮装备资产的工作区执行。脚本使用 `use_active_scene=True`，避免其他场景中的选中对象被带入。

随后用对应 Engine 构建出的 glTF CLI 重新 import GLB，保留 sidecar 身份。若更改节点/材质拓扑，须同步 sidecar 的 source keys、overrides 和 `src/fps/asset-guids.ts`；陈旧 source keys 会导致整个 catalog scan 失败。不要仅改 GUID 字段、cook codec 或使用旧 DDC。

生成过程中的临时脚本/重复导入快照不作为运行时依赖。当前 `.blend`、GLB、sidecar 是编辑交付；`export_assets.py` 是可移植再导出入口。具体机械/碰撞/材质约定见 [Engine handoff](../../docs/fps/ART-HANDOFF.md)。
