# forgeax-engine 蒙皮渲染：网格节点世界矩阵被双重应用（double-transform）

> 给 forgeax-engine 维护者（ubpa）的问题报告。
> 现象：把一个带骨骼蒙皮（`Skin` + `AnimationPlayer`）的角色挂到任意带变换的父节点下、
> 或给其骨架根加任何非单位变换后，角色渲染位置/朝向错乱（平移被加倍、旋转被平方），
> 而不是跟随父变换刚性移动。
>
> 结论先行：**当前蒙皮顶点着色器把「网格节点的世界矩阵」和「关节调色板（已含完整世界变换）」相乘了两次。**
> 二者在 glTF 蒙皮场景里通常共享同一批祖先节点，于是祖先变换被应用两遍。
> 这是一条**未写出来的隐含契约**：“蒙皮网格节点的世界矩阵必须是单位阵”。
> Demo（hello-skin）能跑只是因为它恰好在原点、网格节点世界矩阵≈单位阵，掩盖了这个 bug。

---

## 1. TL;DR

| | |
|---|---|
| **症状** | 移动/旋转蒙皮角色（通过父节点或骨架根）→ 位移加倍、旋转平方、方向错乱 |
| **根因** | 蒙皮 VS 里 `world = meshNode.worldFromLocal * (palette * pos)`，而 `palette = jointWorld * IBM` 已经是完整世界变换；`meshNode.worldFromLocal` 与各关节共享祖先 → 祖先变换被乘两次 |
| **隐含契约** | 蒙皮网格节点（持有 `Skin` 的实体）的 `Transform.world` 必须是单位阵 |
| **为何 demo 不暴露** | hello-skin 的 Fox 在世界原点，网格节点世界矩阵≈单位阵，`I * (jointWorld*IBM)` 看不出问题 |
| **正确语义（glTF）** | 蒙皮 mesh 的渲染完全由关节（joint world × IBM）决定，**mesh 节点自身的 transform 应被忽略** |
| **建议修复** | 蒙皮路径下不要再乘 `meshNode.worldFromLocal`（置为单位阵），让 palette 独自承载世界变换 |

---

## 2. 涉及代码（file:line）

### 2.1 顶点着色器：在 palette 之上又乘了一次 meshNode 世界矩阵

`packages/engine/packages/shader/src/default-standard-pbr-skin.wgsl`

```wgsl
// palette[i] = jointWorld_i * IBM_i  （host 端预乘，见 §2.2）
let skinMatrix =
    palette[in.skinIndex.x] * in.skinWeight.x +
    palette[in.skinIndex.y] * in.skinWeight.y +
    palette[in.skinIndex.z] * in.skinWeight.z +
    palette[in.skinIndex.w] * in.skinWeight.w;

let skinnedLocal = skinMatrix * vec4<f32>(in.pos, 1.0);   // 已是“世界空间”坐标
// ...
let instanceLocal = instances[idx].localFromInstance;     // 蒙皮场景下恒为 I
let world = meshes[0].worldFromLocal * instanceLocal * skinnedLocal;  // ← 又乘了一次 meshNode 世界矩阵
out.clip = view.worldViewProj * world;
out.worldPos = world.xyz;
```

注释（同文件）也写明了 palette 的语义是 “world × IBM”：

```
// @group(2) @binding(1) palette  storage  (array of joint skinning mat4x4,
//                                          CPU-precomputed world * IBM)
//
// Skinning formula:
//   world_pos  = Sum(w_i * palette[base + skinIndex[i]] * local_pos)
```

注意：公式注释说 `world_pos = Σ w_i * palette * local_pos`（**这是对的**），
但实际代码又额外左乘了 `meshes[0].worldFromLocal`（**与注释不一致**）。

### 2.2 host 端预乘：palette = jointWorld × IBM（完整世界矩阵）

`packages/engine/packages/runtime/src/systems/skin-palette-allocator.ts`

```ts
// CPU pre-multiply: writeJointPalette(slice, ibm, jointWorld)
//   -> M_i = joint_world_i * IBM_i
function writeJointPalette(slice, ibms, jointWorlds) {
  // ...
  mat4.multiply(temp, jw, ibm);   // temp = jointWorld * IBM
  // payload[i] = temp
}
```

### 2.3 jointWorld 来源：关节实体的完整 `Transform.world`

`packages/engine/packages/runtime/src/render-system-extract.ts`

```ts
// 每个关节的世界矩阵直接取自 propagateTransforms 写好的 Transform.world
const jWorldView = worldInternal._getArrayView(jointEntity, Transform, 'world'); // 含全部祖先
jointWorlds[jIdx] = jWorldView as unknown as Mat4;
// ...
skinPaletteAllocator.writeJointPalette(slice, ibms, jointWorlds);
```

即：`jointWorld` 经由 `propagateTransforms` 沿 `ChildOf` 链累乘了**全部祖先**（含外部父节点）。

### 2.3.1 关节 vs 网格节点共享祖先（导致重复）

`gltfDocToSceneAsset`（`packages/engine/packages/gltf/src/bridge.ts`）按 glTF 节点父子关系写 `ChildOf`。
典型 Mixamo / glTF 骨骼资产里，**蒙皮 mesh 节点和各骨骼是同一个 `Armature` 的子节点**，所以二者的世界矩阵共享 `Armature`（及其以上的全部祖先）。

实测一只角色（witch.glb）实例化后的 `ChildOf` 链：

```
playerRig(22, 无 ChildOf, 我们驱动的父坐标系)
└─ witchRoot(58, SceneInstance 合成根)         parent = 22
   └─ Armature(23)                              parent = 58
      ├─ CH_Witch_001(24, 持有 Skin 的网格节点)  parent = 23   ← meshNode
      └─ mixamorig:Hips(25)                      parent = 23   ← joint root
         └─ mixamorig:Spine(26) ...              parent = 25
```

`meshNode(24)` 与 `Hips(25)` 都在 `Armature(23)` 下 → 它们的 `world` 都包含 `playerRig × witchRoot × Armature`。

---

## 3. 数学推导：祖先变换被乘两次

记角色（mesh 节点与全部关节）共同祖先的世界变换为 `A`
（在我们的例子里 `A = playerRig.world`，把角色整体平移/旋转）。

- 关节世界矩阵：`jointWorld_i = A · jointBindWorld_i'`
  （`jointBindWorld_i'` 是动画后、Armature 局部空间内的关节姿态；绑定姿态下等于 `jointBindWorld_i`）
- IBM（逆绑定矩阵）：`IBM_i = jointBindWorld_i^{-1}`（在模型/Armature 空间烤的，**不含 A**）
- palette：`palette_i = jointWorld_i · IBM_i = A · jointBindWorld_i' · jointBindWorld_i^{-1}`
  - 绑定姿态：`palette_i = A · I = A`
- 网格节点世界矩阵：`meshNode.worldFromLocal = A · meshLocal`（mesh 节点也在 `A` 之下）

代入着色器：

```
world = meshNode.worldFromLocal · (palette_i · pos)
      = (A · meshLocal) · (A · jointBindWorld' · IBM · pos)
      ≈ A · A · (绑定空间顶点)          // A 出现两次
```

**`A` 被应用了两次。** 平移 `A = T(d)` → 实际位移 `≈ 2d`；旋转 `A = R(θ)` → 实际 `≈ R(2θ)` 且伴随错误的复合；非单位缩放则被平方。这正是“移动角色乱飞 / 方向不对 / 看着像原地”的来源。

> [!NOTE]
> 当 `A = I`（角色在世界原点、无父变换）时，`world ≈ I · I · 绑定顶点`，结果正确。
> 这就是 `apps/hello/skin`（Fox 在原点）始终正常、从而掩盖该 bug 的原因。

---

## 4. 与 glTF 规范的关系

glTF 2.0 蒙皮规范要点（大意，见 spec “Skins” 一节及 *Implementation Note*）：

- 蒙皮 mesh 的顶点位置完全由关节矩阵 `globalJointTransform · inverseBindMatrix` 决定；
- **引用该蒙皮 mesh 的节点自身的 transform 不参与/应被忽略**（joint 矩阵已是相对场景根的全局变换）。

即：蒙皮 mesh 的最终位置应只由 `jointWorld · IBM` 决定，**mesh 节点自身 transform 必须被忽略**。
当前引擎额外左乘 `meshNode.worldFromLocal`，违反了这一点。

---

## 5. 复现

1. 任取一个带 skin + 动画的 glTF（如 Mixamo 导出，mesh 与骨骼同在一个 Armature 下）。
2. `loadByGuid<SceneAsset>` → `instantiate(handle, world, parent)`，其中 `parent` 是一个带非单位 `Transform`（例如 `posZ = 5`）的实体；或直接给该实例的合成根/Armature 设一个非单位 `Transform`。
3. 运行一帧，观察渲染位置。

**预期**：角色整体出现在父节点处（如 z=5），随父节点刚性移动/旋转。
**实际**：角色出现在错误位置（祖先平移被加倍、旋转被平方），看起来“乱飞 / 方向错 / 像没动”。

> 纯代码侧可断言：构造 `A = T(0,0,5)`，绑定姿态下，蒙皮某顶点 `v` 的最终 `world.z`
> 期望约为 `v.z + 5`，实际约为 `v.z + 10`。

---

## 6. 建议修复（任选其一，推荐 A）

### A. 蒙皮路径不再左乘 meshNode 世界矩阵（最小、符合 glTF 语义）

palette 已是完整世界矩阵，蒙皮 VS 直接用它即可：

```wgsl
// default-standard-pbr-skin.wgsl
// 改前：
//   let world = meshes[0].worldFromLocal * instanceLocal * skinnedLocal;
// 改后（忽略 mesh 节点 transform，符合 glTF；instanceLocal 在蒙皮下恒为 I）：
let world = skinnedLocal;
```

- 影响面：仅蒙皮 shader 一行。
- 与 host 端 `palette = jointWorld * IBM`（§2.2）自洽，与文件顶部公式注释一致。
- hello-skin（Fox 在原点）结果不变（原本 `meshNode.worldFromLocal ≈ I`）。

> 法线/切线同理：当前用 `meshes[0].normalMatrix` 与 `meshes[0].worldFromLocal` 参与，
> 修复时应保持「只由 skinNormal3x3（来自 palette）决定」，去掉重复的 meshNode 部分。

### B. palette 改为「mesh 节点局部」空间（保留 shader 现状）

让 host 端预乘成 `palette_i = meshNode.worldFromLocal^{-1} · jointWorld_i · IBM_i`，
则 `world = meshNode.worldFromLocal · palette · pos = jointWorld · IBM · pos`，自洽。

- 缺点：每帧多一次 `inverse(meshNode.world)`，且要求 extract 阶段拿到 mesh 节点世界矩阵；比 A 复杂。

### C. 明确并强制契约（不改渲染，仅文档 + 校验）

如果有意保留「`world = meshNode.world · palette · pos`」的设计，请：
- 在 `Skin` 组件 / 蒙皮 shader 文档里**写明**：持有 `Skin` 的实体其 `Transform.world` 必须为单位阵（mesh 节点不得有非单位祖先/局部变换）；
- 在 extract 阶段对蒙皮实体做一次 fail-fast 校验（`world ≈ I` 否则报结构化错误），避免静默错位。

> 我们目前在 game 侧的临时绕过（等引擎修复后即可删除）：实例化后把持有 `Skin` 的
> mesh 节点从 Armature 子树 `removeComponent(ChildOf)` 并把其 `Transform` 钉为单位阵，
> 使 `meshNode.worldFromLocal = I`，从而单次正确变换。这只是 workaround，不应成为长期契约。

---

## 7. 期望结论

倾向**方案 A**：它修掉了与 glTF 语义和文件内公式注释都不符的那次多余左乘，影响面最小，
且能让「把蒙皮角色挂到父坐标系、移动父节点即可整体移动」这一最自然的用法直接成立，
无需调用方了解任何隐含契约。

---

### 附：环境

- 触发场景：forgeax-studio / `packages/games/hellforge`（2.5D ARPG，witch.glb 33 关节 + 5 动画）。
- 渲染后端：rhi-wgpu（wasm）/ WebGPU。
- 相关 commit 区域：`feat-20260523-skin-skeleton-animation`（M2/M3，skin palette + pbr-skin shader）。
