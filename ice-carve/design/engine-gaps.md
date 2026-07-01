# Engine Gaps — ice-carve

- **engine-math import**: `screenToRay` 在 `@forgeax/engine-math` 里是 `ray.screenToRay` 命名空间导出，不能具名 import；Vite 浏览器加载会 `import-failed` 静默 fallback 黑屏，Bun `/verify` 抓不到
- **shadow pipeline black-screen**: scene.pack Sun 的 `castShadow:true` + PBR 默认 ShadowCaster 在部分 WebGPU/过期 engine dist 下会让整帧失败 → 全黑；Stage A 关闭阴影
- **voxel mesh winding**: 体素面默认索引 winding 与引擎 backface cull 相反，面会被全部剔除；需手动翻三角或材质 `cullMode: 'none'`
- **voxel mesh rebuild**: 每次切割后 `allocSharedRef` 新 MeshAsset 并换 MeshFilter；理想引擎应支持 mesh 原地更新或 instanced voxel 组件
- **procedural audio**: Stage A 用 Web Audio 振荡器兜底；后续需 attach 真实 BGM/SFX
- **camera look-at**: 无 `quat.fromLookAt`，用手写 yaw/pitch 组合
