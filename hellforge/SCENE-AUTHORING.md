# Hellforge 场景外部编辑工作流

> 编辑器不能可靠保存时,用脚本直改 `assets/scenes/*.pack.json`。git-diffable、确定性、
> 幂等。这是 hellforge 场景资产的实际编辑入口(营地 + 地牢)。

## 两条路径

| 场景 | SSOT | 怎么改 | 怎么生效 |
|---|---|---|---|
| 营地 `rogue-encampment` | pack.json + overrides.json | 改 `assets/scenes/rogue-encampment.overrides.json` → `apply` | 营地是 `defaultScene`,刷新游戏即见 |
| 地牢 `slagdeep-hollow` | `src/dungeon-layout.ts` + bake 策略 | 改布局/策略 → `bake-dungeon.ts` | re-bake 后刷新游戏即见 |

碰撞/可行走与视觉变换**解耦**:地牢走 `src/dungeon.ts` 的 layout 网格,营地走
`main.ts` 的矩形边界。改视觉 `Transform` 不影响玩法。

---

## 营地:overrides 编辑闭环

```bash
# 1. 一次性种子(从当前 pack 推出去拉伸默认值)
bun scripts/reshape-scene.ts init  assets/scenes/rogue-encampment.pack.json
#   → 生成 assets/scenes/rogue-encampment.overrides.json

# 2. 手改 overrides.json 里某个实体的 pos / scale / rotYDeg / mesh

# 3. 回写 pack
bun scripts/reshape-scene.ts apply assets/scenes/rogue-encampment.pack.json

# 4. 浏览器硬刷新(Cmd+Shift+R)看效果;不满意回到第 2 步

# 查看当前 pack 的 Name → transform
bun scripts/reshape-scene.ts dump  assets/scenes/rogue-encampment.pack.json
```

### overrides.json schema(keyed by entity Name)

```jsonc
{
  "Boulder_1":   { "mesh": "keep",  "scale": 0.75,  "ground": true,  "pos": [-14, 0, 18], "rotYDeg": 22.9 },
  "Hut1_Wall_N": { "mesh": "cube",  "pos": [-6, 1.2, -6], "scale": [4, 2.4, 0.3] },
  "Crate_2":     { "mesh": "keep",  "pos": [-3.4, 0.28, -5.7], "scale": 0.55 },
  "GateColumnL": { "mesh": "cube",  "rotYDeg": 0 }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `mesh` | `"keep"` \| `"cube"` \| `"<prop-stem>"` | `keep`=沿用当前 mesh(等比缩放);`cube`=内置 CUBE(盒体无 UV 拉伸);`prop-boulder`=换到该 prop GLB |
| `pos` | `[x,y,z]` | 绝对世界坐标;省略=保留原值。`ground:true` 时 `y` 被自动重算 |
| `scale` | `number` \| `[x,y,z]` | 单值=等比;数组=逐轴(盒体用);省略=保留原值 |
| `rotYDeg` | `number` | 绕 Y 轴旋转度数;省略=保留原旋转 |
| `ground` | `boolean` | `true` 时把 `posY` 设为让 GLB 包围盒底部贴地(y=0)。装饰用;特效(Glow/Flame)别开 |

### init 的分类启发式

- **结构件**(墙/屋顶/围栏/门梁/地面/路径/余烬裂缝/火把柱/枯树干枝)→ `mesh:"cube"`,
  保留原盒体变换(盒体无 UV 拉伸,看起来干净)。材质被统一换成纯色「灰烬棕」
  `StructBox`,避免 prop 贴图在 cube 面上再次拉伸。
- **体积装饰**(巨石/木桶/篝火底座/篝火光晕)→ `mesh:"keep"`,等比缩放到原最大尺度
  (`scale = max(原scale) / max(GLB bbox)`),`ground:true` 落地。保留 prop 贴图细节。
- **灯光实体**(Sun/CampfireLight/TorchGate*_Light)→ 跳过(无 MeshFilter)。

> 想让某个结构件改回 GLB?把它的 `mesh` 改成 `prop-hut-wall` 之类的 stem,设等比
> `scale`,看效果。想隐藏某个实体?`mesh:"cube"` + `scale:[0.001,0.001,0.001]`。

### apply 做了什么(幂等)

- `mesh:"cube"` → MeshFilter 指向 CUBE_GUID;MeshRenderer 材质换成 `StructBox` 纯色。
- `mesh:"keep"` → MeshFilter 不变;Transform 写等比 scale + 落地 posY。
- `mesh:"<stem>"` → MeshFilter 指向该 prop 的 mesh GUID(从 sidecar 读)。
- 只动 `Transform` + `MeshFilter` + `MeshRenderer.materials`;`refs[]` 由 `ensureRefGuid`
  追加。与 `reflow-rogue-props.ts` / `fix-prop-materials.ts` 正交。

---

## 地牢:bake 编辑闭环

地牢 244 个实体由 `src/dungeon-layout.ts` 程序生成,SSOT 是布局 + bake 策略。

```bash
# 改 src/dungeon-layout.ts(布局/种子/装饰) 或 scripts/bake-dungeon.ts 的 POLICY
bun scripts/bake-dungeon.ts
bun scripts/fix-prop-materials.ts assets/scenes/slagdeep-hollow.pack.json
# 浏览器硬刷新
```

### bake 的 per-GeoKind 策略(`POLICY` in bake-dungeon.ts)

| GeoKind | 策略 | 结果 |
|---|---|---|
| floorA / floorB / wall / slag / torchPost | `cube` | 内置 CUBE + 地牢纯色材质,保留布局盒体变换(无 UV 拉伸) |
| brazier / rubble / bone | `ground` | prop GLB,等比缩放 + 落地 |
| flame | `keep` | prop GLB,保留布局变换(火焰舌已坐在火把柱顶,X/Z 对称不拉伸) |

改策略:编辑 `scripts/bake-dungeon.ts` 的 `POLICY` 表(把某 kind 从 `cube` 改成
`ground` 即可让它用 GLB 等比落地),re-bake。

---

## 天空:bake-sky 闭环

可见熔岩红云 + IBL 共用 `scripts/bake-sky.ts` 的程序化 equirect:

```bash
cd packages/games/hellforge
bun scripts/bake-sky.ts
# → assets/sky.hdr (IBL)
# → assets/3d/sky/sky-dome.glb + meta (可见 emissive 穹顶)
# → src/sky-dome.gen.ts (穹顶 mesh/material GUID,勿手改)
```

运行时 `main.ts` 的 `installSkyDome()` 加载穹顶并每帧跟随相机。**不要**在 pack
里声明 `Skylight`/`SkyboxBackground` 的 `equirect`——当前引擎 build 不渲染 cubemap
天空盒,pack 里写会出彩虹 garbage。

---

## 验证清单

- `bun scripts/bake-dungeon.ts` 无 `⚠ ... falling back to CUBE` 警告(prop sidecar 都在)。
- 浏览器 `localhost:18920` 硬刷新:
  - 营地:小屋墙/屋顶/围栏/门柱是干净灰烬棕盒体(无拉伸贴图);巨石/木桶/篝火等比、落地。
  - 地牢(营地大门外进去):墙/地面/火把柱是纯色盒体;火盆/碎石/骨堆/火焰用 GLB 等比落地。
- 改一条 override → `apply` → 刷新,确认摆放/缩放/旋转即时可控。

## 不做的事

- 不修编辑器 save(开放陷阱多,1 天不划算);编辑器仅用于预览。
- 结构件「沿跨度平铺单元 GLB」(保纹理密度)是扩展项,当天默认走盒体+纯色。
- 蒙皮角色不要用场景非等比缩放(引擎双重变换 bug);改体型把缩放烤进 mesh。
