# W05 — 官方 glTF/FBX → mesh-bin v4 烹饪路径

## 结论

Studio 当前 pin 的 Engine 只有一条可发布路径：

`glTF/GLB 或 FBX 源文件 + <source>.meta.json` → Vite host 的
`pluginPack({ roots, importers })` → 对应 importer → `MeshAsset` →
`packMeshBinV4` → Pack v2 中的 `body` artifact（codec
`mesh-binary/4`）+ `pack-index.json` → runtime `configurePackIndex` /
scoped runtime binding → `loadByGuid(meshGuid)` → `meshLoader.loadPack` →
`unpackMeshBinV4`.

不能把旧 `.bin` 当源文件，也不能在 runtime 转换。运行时没有 legacy decoder
或 recook fallback；生产失败必须回到源文件与 Meta 重新烹饪
（`packages/assets-runtime/README.md:202-218`）。

## 1. 源文件、Meta 与资产根

每个有源转换资产使用 sibling `<source>.meta.json`。Schema 要求
`schemaVersion`、`kind: "external-asset-package"`、`importer`、
`importSettings`、`subAssets`；每个 sub-asset 至少有稳定 GUID、
`sourceIndex`、`kind`（`packages/pack/schema/meta.schema.json:1-10`,
`:34-47`, `:87-123`）。

最小形态：

```json
{
  "schemaVersion": 1,
  "kind": "external-asset-package",
  "importer": "gltf",
  "importSettings": {},
  "subAssets": [
    {
      "guid": "<uuid>",
      "kind": "mesh",
      "sourceIndex": 0,
      "sourceKey": "<producer-stable-key>"
    }
  ]
}
```

- 同目录同名源可省略 `source`；否则写相对路径，或
  `@name/rest` 并在 `package.json#forgeax.assets.paths` 声明别名
  （`packages/pack/schema/meta.schema.json:40-47`）。
- `package.json#forgeax.assets.roots` 是扫描根；未声明时默认
  `<cwd>/assets`。`paths` 与 `roots` 都相对 cwd 解析
  （`packages/pack/src/config.ts:4-33`）。
- Vite host 也可以显式传 `roots`。官方 glTF 样例扫描 app 自己的
  `assets/` 并注入 `gltfImporter`；FBX 样例扫描
  `forgeax-engine-assets/vendor/fbx-test` 并注入 `fbxImporter`
  （`apps/hello/gltf/vite.config.ts:10-35`,
  `apps/hello/fbx-cube/vite.config.ts:10-30`）。
- Meta 中的 GUID 是 runtime identity，importer 不能重新 mint。glTF
  importer 明确从 `ctx.subAssets[]` 取 GUID
  （`packages/gltf/src/gltf-importer.ts:1-31`）；FBX 聚合器同样按
  `(kind, sourceIndex)` 匹配 Meta GUID
  （`packages/fbx/src/to-asset-pack.ts:1-52`）。

## 2. 可执行命令

### glTF / GLB：有官方 sidecar CLI

```bash
# 在 engine workspace 先构建 bin（若尚未构建）
pnpm -F @forgeax/engine-gltf build

# 解析源并写 sibling <source>.meta.json
forgeax-engine-remote-gltf import path/to/model.glb

# 只检查目录中是否有缺失 sidecar，不写文件
forgeax-engine-remote-gltf import --check path/to/assets
```

CLI 的 bin 映射见 `packages/gltf/package.json:1-12`；命令、产物和退出码
（成功 0，解析/Meta 错误 1）见 `packages/gltf/README.md:199-211`。
实现只接受 `.gltf` / `.glb`，写 `${source}.meta.json`，并在已有 Meta
时复用稳定身份（`packages/gltf/src/cli-gltf.ts:57-67`, `:223-237`,
`:300-320`）。

### FBX：当前 pin 没有 sidecar CLI

当前 `@forgeax/engine-fbx` 没有 `package.json#bin`，只有 WASM
fetch/build 与 package build/test scripts（`packages/fbx/package.json:1-31`）。
因此当前树中不存在可执行的 `forgeax-engine-remote-fbx`，文档里曾出现的
“`fbx import` 子命令”不能作为当前官方命令。FBX 的官方 producer 路径从
**有效的 `.fbx.meta.json` + host 注入 `fbxImporter`** 开始；Meta 应由
Editor 资产 authoring gateway 或可信的资产制作步骤生成/维护，而不是让
runtime 猜测。现行 fixture 展示了 `importer: "fbx"`、稳定 GUID 和
`fbx:<kind>` sourceKey（`forgeax-engine-assets/vendor/fbx-test/cube.fbx.meta.json:1-27`）。

新 checkout 若缺 FBX WASM：

```bash
pnpm -F @forgeax/engine-fbx fetch-wasm
# release artifact 不可用时才：
pnpm -F @forgeax/engine-fbx build:wasm
```

依据为 `packages/fbx/README.md:100-158`；这两条只准备 parser，不生成
Meta，也不烹饪 Pack。

### 扫描、验证、烹饪

```bash
# 从项目 cwd 扫描默认 roots；或重复传 --roots
forgeax-engine-remote-asset scan --roots assets
forgeax-engine-remote-asset verify

# Vite build 触发 pluginPack 的 build-time import/cook，并产出
# Pack v2、mesh body artifact 与 pack-index.json
pnpm build

# 有 catalog 后核验指定 GUID 的 source/receipt/package/artifact 证据
forgeax-engine-remote-asset verify \
  --guid <mesh-guid> --project <build-root> \
  --catalog <pack-index.json> --json
```

asset CLI 的命令面、参数与退出码（0/1）见
`packages/pack/src/cli-asset.ts:1-12`, `:170-226`, `:300-383`,
`:494-568`。`pluginPack` build mode 是唯一发布者：它把 importer
product finalize 成 Pack v2，发出 artifacts/package，并把最终
`packageUrl` 写回 index（`packages/import/src/build-production.ts:247-273`,
`:420-491`, `:493-515`）。

Host 配置必须同时注册对应 importer：

```ts
pluginPack({
  roots: [resolve(here, "assets")],
  importers: [gltfImporter, fbxImporter],
  runtimeBinding,
  refresh: reloadAssetHost(),
})
```

未注册 importer 不会产生合格 cooked product
（`packages/import/README.md:40-52`, `:141-179`）。

## 3. v4 是在哪里生成的

- glTF mesh 分支先桥接 canonical `MeshAsset`，再调用
  `packMeshBinV4`；artifact 明确标记
  `mediaType: application/x-forgeax-mesh` 与
  `assetCodec: { name: "mesh-binary", version: "4" }`
  （`packages/gltf/src/gltf-importer.ts:550-637`）。
- FBX 的 `buildMeshAsset` 也调用同一 `packMeshBinV4`，发出同一
  `mesh-binary/4` codec（`packages/fbx/src/to-asset-pack.ts:288-339`）。
- 共同 encoder 固定 header `version: 4`，写 geometry projection
  version/mask/digest/stride、vertex/index cardinality 与 JSON metadata；
  不接受也不发出 legacy version
  （`packages/import/src/mesh-bin.ts:94-100`, `:119-157`,
  `:183-219`）。
- Pack build 把 artifact 发到 `assets/`，普通 importer artifact path
  为 `${assetGuid}-${key}.bin`（mesh 的 key 是 `body`），并发出
  `${firstGuid}.pack.json` 与最终 catalog locator
  （`packages/import/src/build-production.ts:247-273`,
  `:459-491`）。调用方不应硬编码这些生成名，应按
  `pack-index.json` → Pack descriptor 寻址。

## 4. `loadByGuid` 为什么能接受

静态 build 使用 `assets.configurePackIndex(url)`；Studio/dev 使用
scoped runtime binding，两者是替代关系
（`packages/assets-runtime/README.md:27-41`）。
`loadByGuid` 先按 GUID 解 pack-index，再取 Pack v2、逐个读取本资产的
artifact，最后交给 loader registry
（`packages/assets-runtime/src/registry/load-by-guid.ts:480-549`,
`:1022-1118`）。

mesh loader 若发现 `body` artifact，就只走
`unpackMeshBinV4(artifact.bytes, input.guid)`；解码失败原样返回结构化
错误，成功后才恢复 material refs 并发布 MeshAsset
（`packages/assets-runtime/src/loaders/inline-pack.ts:240-270`）。
所以“`loadByGuid` 接受”的充分条件是：

1. Meta GUID/kind 闭包与 importer 输出一致；
2. pluginPack 已把 source 烹饪为 Pack v2 当前 publication；
3. catalog row 的 `packageUrl` 能取到 Pack，artifact descriptor 能取到
   `mesh-binary/4` body；
4. v4 header、projection、长度、metadata、attribute finite checks 全过；
5. refs 中的默认材质 GUID 也能递归加载。

## 5. 错误码与恢复

### Import / build 阶段

`ImporterRegistry` / runner 的主错误码：

- `importer-not-registered`
- `source-read-failed`
- `import-produced-no-assets`
- `guid-mismatch`
- `import-internal-error`

语义与恢复见 `packages/import/README.md:174-187`。v4 encoder 自身还可能
给 producer：

- `mesh-bin-payload-invalid`
- `mesh-bin-header-truncated`
- `mesh-bin-version-unsupported`
- `mesh-bin-header-invalid`

失败都带 `sourceKey`、`expected`、`actual` 和
“re-cook the source with its Meta sidecar through the build-time importer”
恢复提示（`packages/import/src/mesh-bin.ts:20-40`,
`packages/pack/src/mesh-bin-contract.ts:20-53`）。importer 会将 encoder
失败包装成 `import-internal-error`，不发布部分 artifact
（glTF：`packages/gltf/src/gltf-importer.ts:620-635`；
FBX：`packages/fbx/src/to-asset-pack.ts:324-338`）。

### Runtime 公共错误

runtime 对所有 mesh wire 失败公开
`code: "mesh-bin-contract-violation"`，detail 至少包含：

- `sourceKey`
- `reason`: `header-truncated` / `version-unsupported` /
  `header-invalid` / `projection-mismatch` /
  `payload-length-mismatch` / `metadata-invalid` /
  `attribute-invalid` / `payload-non-finite`
- `expected` 与 `actual` facts

并统一提示回 source + Meta recook
（`packages/assets-runtime/src/errors/asset.ts:52-90`；
原因映射与检查见
`packages/assets-runtime/src/loaders/mesh-bin.ts:79-116`,
`:117-175`, `:206-280`）。

其他链路错误会保持各自结构化 code，例如 catalog/pack fetch 的
`asset-not-found`、`asset-fetch-failed`、`asset-not-imported`、
`asset-parse-failed`。只按 `.code/.detail/.hint` 修复源、Meta、
importer 注册或重跑 build/cold-cook；不要替换为手写 mesh。

## 6. mesh-bin v3 明确被拒

v4 header decoder读取 offset 0 的版本，只有 `version === 4` 才继续；
否则返回 `mesh-bin-version-unsupported`，expected 为 `mesh-bin v4`
（`packages/pack/src/mesh-bin-contract.ts:85-103`）。
runtime 将它投影为 `mesh-bin-contract-violation`，
`reason: "version-unsupported"`，expected facts `{ field: "version",
version: 4 }`，actual facts 携带读到的版本
（`packages/assets-runtime/src/loaders/mesh-bin.ts:79-115`）。
单测直接构造 version 3 并断言 `unpackMeshBinV4(...).ok === false`
（`packages/assets-runtime/src/__tests__/mesh-bin.unit.test.ts:133-138`）。

因此 FPS Gym HTML 的 `mesh-binary@3` 既不是可加载输入，也不在本 ticket
的迁移范围；正确动作是从有授权的原始 glTF/FBX + Meta 重新走上述 v4
producer 路径。

## 决策摘要

- glTF/GLB：用 `forgeax-engine-remote-gltf import` 生成/更新 Meta。
- FBX：当前没有对应 CLI；从 Editor authoring gateway/可信制作步骤产出的
  `.fbx.meta.json` 开始，host 注入 `fbxImporter`。
- cook：以 `pluginPack` 的 dev/build producer 为唯一出口；`pnpm build`
  生成 Pack v2、`mesh-binary/4` artifact 和 `pack-index.json`。
- load：只用 catalog + `loadByGuid`；不直接 load 源文件或 `.bin`。
- v3：fail closed，公开为 `mesh-bin-contract-violation`，必须从源 recook。
