# W03 — 当前引擎湿地雨夜与 PBR 已证明到哪一步

## 结论

截至指定 Engine pin，运行游戏已经证明的是：标准 metallic/roughness PBR、贴图驱动的 metallic-roughness 与 normal、Skylight/IBL、HDR emissive、bloom、DirectionalLight 阴影，以及游戏自定义的屏幕空间 haze。尚未被这三个运行游戏证明的是：雨、雨滴/雨幕、积水/水洼、动态 wetness mask、雨水改变 roughness、SSR/平面反射、体积雾，以及可直接复用的“湿地雨夜”组合。

Hellforge 的 den 地面是现有证据中最接近“湿面”的一项，但其合同只是保留 metallic-roughness 贴图并把 `roughnessFactor` 设为 `0.78`；代码称其为 “slick wet stone”，并不等于已证明雨水响应、积水或反射系统（`hellforge/scripts/lib/surface-spec.ts:7-14`，`hellforge/src/surface-materials.test.ts:139-155`）。

## 逐项证据边界

### Lighting / PBR — 运行游戏已证明

- Engine 标准 PBR shader 的材质合同包含 base color、metallic、roughness、metallic-roughness texture、normal、emissive、clearcoat、specular tint 与 IBL bindings（`packages/shader/src/default-standard-pbr.wgsl:43-63`，`:100-146`，`:194-224`）。它还实际计算定向光阴影、cluster lights 和 emissive，而非只声明字段（同文件 `:749-773`）。
- FPS 在当前 `bootstrap` 中创建 Skylight，加载 HDR equirect 并把它同时交给 IBL 与可见 skybox；其普通材质 helper 实际传入 roughness、metallic、emissive（`fps/main.ts:50-91`，`:121-148`）。当前 Play 路径加载 `scene.json`、实例化 glTF/材质/灯光，并随后安装 HDR sky（`fps/main.ts:220-266`）。
- Hellforge 运行时按区域重排 ambient、point、spot 与 directional key lights；DirectionalLight 明确开启 shadow map（`hellforge/main.ts:1865-1897`）。F10 同时把 sun/ambient/fire/fill 与 exposure、atmosphere 参数实时写回运行世界（`hellforge/main.ts:2160-2181`）。
- Rain Alley whitebox 本身只证明了基本标准材质和基础光照：所有场景材质默认 `roughness=0.82, metallic=0`（`rain-alley/main.ts:149-161`），运行时创建一个 Skylight、一个投影 DirectionalLight 和一个不投影的反向 fill（`:822-845`）。

### Wet / roughness / metal — 有 PBR 基础，没有湿润系统证明

- Hellforge 的地表测试固定了四个 glTF 的 roughness scalar，并验证 floor/path/wall 保留 metallic-roughness texture（`hellforge/src/surface-materials.test.ts:139-155`）。这证明“贴图 × scalar”的 roughness 工作流在游戏资产中落地。
- FPS 的动态枪械/装甲使用不同 metallic/roughness 数值（如枪 `0.85/0.32`、头盔 `0.6/0.45`），证明金属与非金属材质可在同一运行场景中使用（`fps/main.ts:130-148`）。
- 但 Hellforge、FPS、Rain Alley 中均没有 wetness、puddle、rain-response 或 reflection 的运行调用点。Engine shader 虽已声明 clearcoat/specular tint 等更宽材质面（`packages/shader/src/default-standard-pbr.wgsl:118-146`），本次检查没有在三个目标游戏中找到其湿面用途；因此只能归为 package capability，不是湿地效果的游戏证明。

### Emissive / neon — HDR emissive 已证明；当前 FPS 霓虹场景证据不足

- FPS 运行代码创建 emissive eyes、visor、hit flash，并创建标准 PBR 金属材质（`fps/main.ts:130-148`）；Engine shader 把 emissive texture × emissive × intensity 加到 HDR color（`packages/shader/src/default-standard-pbr.wgsl:770-773`）。
- Hellforge 的默认 grade 打开 bloom，并明确阈值会捕获 fire/fixture emissive；注释也排除了“定义但没有 rendered call site”的 portal，说明其证据口径是运行调用点而非愿望清单（`hellforge/src/render-settings-defaults.ts:31-48`，`:50-67`）。运行时确实安装这条 `shadow → ... → bloom → atmosphere → tonemap` pipeline（`hellforge/main.ts:473-492`）。
- `fps/tools/gen-scene.ts` 有蓝/琥珀 emissive neon 材质与四条 neon mesh（`:80-94`，`:110-115`），但当前 `fps/scene.json` 只列一个 `GltfRef` 与一个 Sun（`fps/scene.json:1-50`）。所以“霓虹配方/旧 arena 作者工具存在”不能升级为当前 FPS Play 的霓虹运行证明；可确认的是通用 HDR emissive，而不是一套现成 neon street 结果。

### Rain / particles — 未证明

- Hellforge 的运行 ambient particles 只有 `ember | ash | snow`，并由自有 `AmbientFx` 用 unlit instances/实体池实现（`hellforge/src/ambient-fx.ts:1-25`，`:27-58`，`:190-218`）；F10 也只暴露 `auto | ash | snow | off`（`hellforge/src/render-settings-defaults.ts:20-24`）。它不是雨。
- `@forgeax/engine-vfx` 暴露 code-first GPU emitter、player、loader 与 runtime contracts（`packages/vfx/src/index.ts:1-40`，`:65-110`），但包自身明确是 runtime contract、没有 canvas/frame-loop 证明（`packages/vfx/package.json:47-56`）。三个目标游戏也没有消费该包的调用点。因此 VFX package 的存在不能证明 rain effect。

### Fog / haze — 仅 Hellforge 屏幕空间 haze 已证明

- Hellforge 自定义 atmosphere shader 明说没有 depth sampling，只做 radial vignette 与 vertical haze（`hellforge/src/shaders/atmosphere.wgsl:1-9`）；fragment 以屏幕纵向 mask 混入 haze color（同文件 `:48-72`）。
- 该 pass 在游戏启动时实际注册、安装，并接收 F10 `haze` 参数（`hellforge/main.ts:473-492`，`:2174-2181`）。所以已证明的是 pre-tonemap 屏幕空间色调/薄雾，不是有深度、密度、散射或局部体积的场景 fog。

### Shadows — 定向阴影已证明；点光/聚光阴影未证明

- FPS 当前场景的 Sun 明确 `castShadow: true`（`fps/scene.json:28-45`），加载器把该字段映射进 DirectionalLight（`fps/scene-runtime/instantiate.ts:256-281`）。
- Hellforge 的 custom pipeline 主 pass 读取 `shadowDepth`，并创建 shadow cascade writer（`hellforge/src/pipeline-topology.ts:22-29`，`:97-118`）。游戏还为历史 glTF 材质补齐 ShadowCaster pass（`hellforge/src/ensure-shadow-casters.ts:1-14`，`:45-61`，`:88-109`）。
- Hellforge 同时明确写出边界：custom pipeline 没有 point/spot caster passes，所以这些灯不启用 shadow；当前证明仅覆盖 DirectionalLight/CSM 路径（`hellforge/main.ts:1882-1892`，`hellforge/src/pipeline-topology.ts:22-29`）。

## Package-only / 非证据

- `render` 与 `shader` 不是“只存在包里”：它们被上述三个游戏直接消费，标准 PBR、IBL、emissive 和 directional shadow 有运行调用链。
- `vfx` 在此范围内仍是 package-level GPU effect contract；没有目标游戏的 rain consumer。
- `graphics-extras` 的包职责是 glyph layout/mesh bake、tilemap bit encoding 和 video playback，本身没有 runtime canvas，也不提供湿地、雨、雾或 PBR 证明（`packages/graphics-extras/package.json:6-8`，`:44-58`）。
- 代码中出现字段、模板、旧 scene generator 或 shader capability，不等于目标游戏当前 Play 已证明该效果。尤其不能从 clearcoat 字段推导“湿面已完成”，也不能从 VFX runtime 推导“雨已完成”。

## 研究边界

本票只记录当前 pin 的能力与证据等级；未选择 Rain Alley 的材质数值、灯光颜色、雨实现、雾实现或最终视觉方案，也未提取任何 HTML 资产。
