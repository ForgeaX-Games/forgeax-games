<!-- context-audit:2026-09-10 -->
> 文档核对：2026-09-10。按源码使用的参考文档；文中的验收结果仅适用于其记录的版本和日期。
> 接手先读 [当前状态与入口](../../CURRENT.md)；[整理前原文](../../docs/archive/pre-management/assets-src/weather/README.md) 保留来源与原始内容。

# 雨夜材质增量 / Existing-model refinement

当前暴雨版：27/27 材质有颜色图，18 个材质使用 9 组表面配方；新沥青底色和粗糙度图扩大积水。天空源图与提示词在 `sky/`，完整运行说明见 `../../docs/fps/STORM-UPGRADE.md`。

本目录在既有街区上改材质，不重建模型。`rain-alley-district-rain.blend` 来自原 `assets-src/district/rain-alley-district.blend`；网格和对象变换前后指纹相同。`assets/weather/district-rain.glb` 与原 GLB 的 meshes / nodes / accessors / scenes 完全一致，原二进制数据保留为逐字节相同的前缀。碰撞与门洞沿用 `src/street-layout.ts`。

- `refine_materials.py`：Python + NumPy + Pillow，读取原 GLB，只附加材质贴图和材质设置，输出正式 glTF 源资产。随后仍需官方 importer/cook。没有修改 cooked payload。
- `textures/`：512×512 的可重复生成表面细节图；底色为 sRGB，Normal / ORM 为线性数据。ORM 的 R 是局部材质凹槽遮蔽，G 是粗糙度，B 为非金属；不是整场景烘焙 GI。
- `update_blender.py`：在原 Blender 源文件中更新材质节点，保存本目录的新文件，不覆盖原文件。原有招牌、墙面等底色图保留。
- `material-audit.json` / `blender-audit.json`：几何不变与源文件哈希的证据。

复现：在本 game workspace 中用实际 Python/Blender 可执行文件运行：

```sh
python assets-src/weather/refine_materials.py
Blender --background assets-src/district/rain-alley-district.blend --python assets-src/weather/update_blender.py
```

GLB 的可复现发布入口是 `refine_materials.py`；Blender 文件用于材质继续编辑和检查。两条路径的灯光预览不同：实际暖色灯、天空、反射探针、雨丝、水花与雾均由 `src/fps/weather.ts` / `presentation.ts` 创建，运行不依赖 Blender。

原 district / v2 street 资产保留。新版独立 sidecar 的 scene GUID 由 `src/fps/asset-guids.ts` 引用，只用于 FPS；旧 `main.ts` 仍使用旧街区。不要手工复用旧场景 GUID。
