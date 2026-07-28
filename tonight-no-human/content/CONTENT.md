# 内容库约定（今晚别变回人）

本目录是**玩法/影游/小关素材的唯一入口**。代码只从这里解析引用，不把正文或路径散落在 `MatchFSM` / `AppShell` 里。

```
content/
  narrative/                 # 互动影游
    chapter_<id>/
      media/                 # 主片 / 私密特写 / DM 立绘 等媒体文件
      （脚本定义在 src/narrative/content/scripts/ —— 见下）
  minigames/                 # 小游戏库附属素材（按 minigameId 分夹）
    <minigameId>/
      art/ audio/ notes…     # 后期往这里丢图、音、关卡表
```

## 影游：脚本在哪、素材在哪

| 东西 | 位置 | 谁读 |
|---|---|---|
| 影游剧本（节拍、投票、线索、时长） | `src/narrative/content/scripts/*.ts` | `NarrativeCatalog` |
| 媒体文件（视频/纸雕静帧/音效） | `content/narrative/chapter_*/media/` | `resolveNarrativeAsset()` |
| 章节节点 → 影游 id | `src/chapter/chapters/chapter_*.ts` 的 `narrativeId` | `NodePlaylist` |

`NarrativeScript.assets.*` 里的路径一律用**相对本游戏根**的 POSIX 路径，例如：

```text
content/narrative/chapter_mx/media/mx_open_master.webp
```

运行时通过 `src/narrative/content/assetPath.ts` 转成可 fetch / 可挂 UI 的 URL。缺文件时 Director 仍可按时长空跑（Demo），但日志会标 `asset-missing`。

## 小游戏：库在哪、怎么加

| 东西 | 位置 | 谁读 |
|---|---|---|
| 库条目元数据（标题/类型/状态/素材根） | `src/minigame/library/` | `MinigameLibrary` |
| 运行时工厂（`IMinigame`） | `src/minigame/registry.ts` ← library 注册 | `createMinigame` |
| 实现代码 | `src/minigame/impl/` | factory |
| 关卡附属素材 | `content/minigames/<id>/` | 各 impl 自己 load |

**加一个新小游戏（后期库扩展）：**

1. `content/minigames/<id>/` 建夹放素材  
2. `src/minigame/impl/<Id>.ts` 实现 `IMinigame`  
3. 在 `src/minigame/library/entries/` 加一条 `MinigameLibraryEntry`（`status: 'shipped'`）  
4. 章节 `nodes[].minigameId` 指向该 id  
5. **不要改** `MatchFSM`

`status: 'planned' | 'stub' | 'shipped'` —— planned 只出现在库目录里供策划对照；stub 可跑占位；shipped 才是真玩法。

## 禁止

- 在 `AppShell` 里写死影游时长 / 线索文案  
- 把媒体丢到 `assets/` 引擎 scene pack（那是 3D 场景，不是影游纸雕轨）  
- 新建国家时复制 FSM；只加 `chapter_*` + narrative scripts + library entries
