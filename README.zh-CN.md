# ForgeaX Studio — forgeax-games

[English](./README.md) · [简体中文](./README.zh-CN.md) · [↑ studio](https://github.com/ForgeaX-Games/forgeax-studio)

> **真实、可玩的共享游戏库 —— 由 Forge agent 编写,由真实引擎运行。**

`forgeax-games` 是一个独立的完整游戏项目库,可被 ForgeaX 引擎发现、加载、游玩与编辑。它们不是
敷衍的「示例」:每个都是完整的源码树——`src/`、打包的 `assets/`、`scenes/`、自定义
`shaders/`——其中大部分是 **Studio 里的 Forge AI agent 写出来的**,原样提交到这里。它们证明了
「聊天到游戏」的闭环能产出真正可交付的东西。

## 它为何重要

这里的一个游戏,正是编辑器所编辑、构建流水线所打包的同一批文件——同样的 `forge.json` 契约、
同样的引擎。因此游戏在 **Play 与 Edit 中行为完全一致**,agent 写出来的就是你拿到的。这个库
同时是引擎的活体回归套件:难度跨度从 30 行的旋转方块,到完整的 3D 物理射击游戏。

## `forge.json` 契约

每个游戏都由唯一的清单 `forge.json` 锚定——它是引擎、编辑器、构建与启动器共同读取的、经 schema
校验的权威描述(schema 位于 `@forgeax/engine-project`)。最小形态:

```json
{ "id": "fps", "name": "Sector Strike", "schemaVersion": "1.0.0",
  "entry": "main.ts", "pointerLock": true, "physics": "3d" }
```

- `id` 即 slug(`^[a-z0-9][a-z0-9-]{1,40}$`),也是目录名。
- `entry` 指向游戏代码入口(`main.ts` 或 `src/main.ts`)。
- 像 `physics: "3d"`、`pointerLock` 这样的可选开关由宿主读取,而非每个游戏各自重造。

`forge.json` 同时是**发现守卫**:启动器只会接入含它的目录;README、脚本、工具目录会被自动跳过。

## 发现与隔离机制

- **磁盘即真相。** 游戏作为受版控的源码存放在 `packages/games/<slug>/`。启动时,启动器幂等地
  把每个含 `forge.json` 的目录 symlink 进 `.forgeax/games/<slug>/`,引擎的发现链
  (`listAllGames` / `detectActiveSlug`)即可零注册识别。
- **设计上安全。** 从 Studio UI 删除游戏只移除 `.forgeax/games/<slug>` 这个 symlink——受版控的
  真实源码绝不被动。要真正移除游戏,在本仓 `git rm` 该目录并 push。
- **无跨游戏碰撞。** per-game pack-index 隔离让两个共享资产 GUID 的游戏可以共存,而不会让全局
  资产目录降级——因此拷贝与变体都是安全的。

## 游戏清单

| slug | 名称 | 形态 |
|:--|:--|:--|
| `spin-cube` | spin-cube | 最小「能否渲染」冒烟游戏 |
| `fps` | Sector Strike | 第一人称射击,指针锁定 |
| `cow-survivor` | Cow-Level Survivor | 3D 物理生存,打包了怪物/特效/角色 |
| `hellforge` | ForgeaX: Hellforge | 3D 物理动作游戏 |
| `shoot-opt` | shoot-opt | 完整射击脚手架(76 个子材质共享一个 PBR parent) |

## 加入一个游戏(食谱)

1. 新建 `<slug>/`(slug 匹配 `^[a-z0-9][a-z0-9-]{1,40}$`)。
2. 放入脚手架:`forge.json`(必需)、`package.json`(`@forgeax/game-<slug>`)、`tsconfig.json`、
   代码入口、一个 `assets/` 包,以及可选的 `FORGE.md` 设计说明。
3. 在这里 commit + push,然后在 studio 侧 `git submodule update --remote packages/games` 并启动
   ——启动器会把它 symlink 进来。

> 首次 checkout 必须执行 `git submodule update --init packages/games`,否则库为空,启动器会优雅
> 跳过所有游戏。

---

本仓是 **ForgeaX Studio** 的一个子模块,隶属
[`ForgeaX-Games/forgeax-studio`](https://github.com/ForgeaX-Games/forgeax-studio) ——
用 `--recurse-submodules` 克隆超级仓即可运行完整 studio。许可:Apache-2.0。
