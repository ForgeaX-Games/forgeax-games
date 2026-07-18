# hellforge 场景资产接入 PLAN(阶段 2/3)

> 2026-07-04 调研产出。阶段 1(生成 25 GLB)进行中;本文档记录阶段 2/3 的
> 完整改动方案,生成完后直接动手。

## 目标

让 wb-ai-asset 生成的 25 个 GLB 真正出现在 hellforge 游戏里(运行时渲染),
而不只是躺在资产目录。保留 hellforge 的 PCG 布局随机性,只把视觉从内置 cube
升级成生成的 GLB mesh。

## 三层门槛 + 方案

### 层 1:运行时资产表收录(改 wb-ai-asset 插件,plugin 内)

**门槛**:wb-ai-asset 现在写的 `<name>.glb.meta.json` 格式:
```json
{ "schemaVersion":1, "producer":{...}, "type":"aiasset-mesh",
  "contentHash":"sha256:...", "dependencies":[...textures] }
```
不符合 vite-plugin-pack `buildCatalog` 期望的 `external-asset-package` 格式:
```json
{ "schemaVersion":"1.0.0", "kind":"external-asset-package",
  "importer":"gltf", "importSettings":{"colorSpace":"srgb","mipmap":"auto"},
  "subAssets":[{ "guid":"<uuid>", "sourceIndex":0, "kind":"mesh", "name":"..." }] }
```
→ buildCatalog 不收录 → 运行时 `AssetRegistry.loadByGuid` 发现不了 GLB。

**方案**:wb-ai-asset `per-game-store.ts:writeAsset` 写 sidecar 时,**额外**
用 `@forgeax/engine-gltf` 的 `parseGlb`/`toAssetPack`(browser-clean,backend
可用 —— 已验证 `parse-gltf.ts` 无 node: import)cook canonical meta,写入
`<name>.glb.meta.json`(替换现有 aiasset-mesh 格式,或并存)。

- `toAssetPack(doc, existingMeta, sourceName)` 支持 reimport GUID reuse
  (传 existingMeta 复用旧 GUID,避免 churn)
- mesh GUID 由 engine-gltf SSOT 生成,与 editor import 流程同源
- wb-ai-asset 自己的台账信息(contentHash / dependencies / producer)挪到
  meta 的扩展字段或第二份 sidecar,不破坏 buildCatalog 解析

**改动文件**:`packages/marketplace/plugins/wb-ai-asset/server/per-game-store.ts`
(+ 可能 `asset-storage.ts` 接口)。**plugin 内,不越界**。

### 层 2:pack.json 引用 GLB(改 games 子仓 bake 脚本)

**门槛**:pack.json `assets[]` 现在 = 1 scene + 10 material,0 个 mesh asset。
所有实体 `MeshFilter.assetHandle:0` → 解析回 CUBE_GUID(内置 cube)。

**机制**(已查 scene-pack.ts 305-310):
- `assetHandle` 是 refs 表索引,`refs[assetHandle]` = GUID
- GUID 是 builtin mesh(cube/sphere)→ `kind`;是 imported mesh → `meshAsset:GUID`
- 要引用外部 GLB:pack.json 需有 mesh asset 条目(带 GUID)+ 实体 assetHandle
  指向该 GUID 的 refs 索引

**方案**:改 `scripts/bake-dungeon.ts`(slagdeep SSOT)+ rogue-encampment 的
bake/手编辑:
- `assets[]` 加 mesh asset 条目(每个原型一个,带 toAssetPack 生成的 GUID)
- `refs` 表加 GLB GUID(替换或并列 CUBE_GUID)
- 实体 `assetHandle` 指向对应 GLB GUID 的 refs 索引

**改动文件**:games 子仓 `hellforge/scripts/bake-dungeon.ts` + 可能
`rogue-encampment.pack.json`(若手编辑)。

### 层 3:运行时加载 GLB(改 games 子仓 dungeon.ts)

**门槛**:运行时 `dungeon.ts` 是纯 PCG,用 `HANDLE_CUBE` 当场生成几何,
完全不读 pack.json,不加载外部 GLB。

**方案**(replace_cube 设计):保留 PCG 布局逻辑(dungeon-layout.ts 的
DUNGEON_SEED + 房间/走廊/装饰生成),只把 `{component:MeshFilter, data:{assetHandle:HANDLE_CUBE}}`
换成加载对应 GLB mesh 的 handle:
- 引擎运行时 `AssetRegistry.loadByGuid(glBMeshGuid)` → MeshAsset
- `world.allocSharedRef('MeshAsset', meshAsset)` → handle
- 实体 MeshFilter 用该 handle
- 按实体类型(Boulder/Crate/Wall...)映射到对应原型 GLB 的 GUID

**改动文件**:games 子仓 `hellforge/src/dungeon.ts`(核心运行时)。

## 执行顺序

1. ✅ 阶段 1:生成 25 GLB(进行中)
2. 阶段 2a:改 wb-ai-asset `writeAsset` cook canonical meta(插件内)
   → 用已生成的 crate-verify 验证 buildCatalog 能收录
3. 阶段 2b:改 bake-dungeon.ts + rogue pack.json 加 mesh asset 引用
   → 编辑器里打开场景看 GLB 显示
4. 阶段 3:改 dungeon.ts 运行时 loadByGuid 替代 HANDLE_CUBE
   → 真机跑游戏看 GLB 渲染
5. 真机验证 + gate(typecheck/test)+ commit + PR

## 风险 / 待确认

- **Meshy gateway 并发**:5 并行已验证可工作(批 1 成功),但每批 9 分钟
  (排队),24 个约 45 分钟
- **GUID 稳定性**:toAssetPack 的 GUID 生成需确认是确定性(contentHash 派生)
  还是随机 —— 影响 reimport churn
- **dungeon.ts 改动面**:运行时加载 GLB 涉及引擎 AssetRegistry 异步加载,
  PCG 同步生成逻辑要适配(async loadByGuid)—— 可能要改 dungeon.ts 的
  生成时序
- **6-layer model**:wb-ai-asset(server 后端)import engine-gltf 需确认
  layer 规则允许(backend L1 → frontend L1? engine-gltf 是 frontend L1,
  但 browser-clean 部分 backend 可用 —— cookGltfMeta 注释说 platform-io
  不能 import engine-gltf 是因为 layer,但 wb-ai-asset 是 plugin 不是
  platform-io,规则可能不同)→ 阶段 2a 开工前确认
