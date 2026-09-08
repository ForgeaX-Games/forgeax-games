# hillside-3 — 山坡田园别墅(ForgeaX 纯程序化 3D 场景)

第一人称自由探索的 3D 场景:两层田园别墅(L 形主体 + 木构架横翼 + 圆塔 + 门廊)、
分区规划的草甸景观(伴路花带 / 修剪草坪 / 干草捆 / 菜园 / 晾衣绳)、连续分形脊线雪山。
**全部几何与贴图为纯代码程序化生成**(参数进、顶点出),无任何外部美术资产。

![主视角](screenshots/main-view.png)

| | |
|---|---|
| ![屋顶与山脉](screenshots/rooftops-and-range.png) | ![草甸](screenshots/meadow.png) |

## 运行

需要 Node.js ≥ 20 与支持 WebGPU 的浏览器(Chrome / Edge)。

```bash
npx -y -p @forgeax/game forgeax-game devkit install   # 安装 ForgeaX Runtime(首次)
# 之后经 forgeax MCP 工具 forgeax_run_current_game 构建并获取预览 URL,
# 或使用 ForgeaX Studio 打开本工作区。
```

打开预览 URL 后:**点击画面**锁定鼠标,**鼠标**转视角,**WASD** 移动,**Shift** 跑,**Esc** 释放鼠标。

## 结构

```
.(本目录)      游戏源码(入口 main.ts)
  lib.ts        调色板 / 光照 / MeshBuf 网格构建器 / 参数化基础形
  meshlib2.ts   高密度建模函数库(定向发射 quadO/hexBox/archFrame/branchedTrunk…)
  building.ts   别墅(墙体/屋顶/塔/烟囱/门廊/窗)+ 挡土墙与露台
  scene.ts      场景装配:地形/植被分区/栅栏链/叙事道具/远景
  textures.ts   程序化贴图(albedo+法线对,值噪声/fbm/voronoi)
  terrain.ts    解析高度场与布局常量
  sky.ts        天空穹顶 / 分形脊线雪山 / 雾幕
  props.ts      道具网格(桶/箱/灯/花/草卡…)
tools/          无头抓帧(shoot.mjs)/ 硬底线巡检(patrol.mjs)/ 构图判据(judge.mjs)
docs/           STATUS(迭代日志)/ REFERENCE / 判据历史
```

## 工程要点

- 三角形 ~305k,实体 ~131,SwiftShader 软光栅可跑
- 实例化草 8k+(实体位姿包围盒剔除陷阱的解法见 `docs/STATUS.md`)
- 验收流程:类型检查 → 构建 → 无头抓帧 → 与参考图并排比对 → 18 项硬底线巡检 → 分区哨兵判据
