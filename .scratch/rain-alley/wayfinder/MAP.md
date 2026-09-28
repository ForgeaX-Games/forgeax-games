---
id: W00
title: 从白盒到如龙式雨夜切片
labels: [wayfinder:map]
status: open
parent: null
blocked_by: []
assignee: null
---

# 从白盒到如龙式雨夜切片

## Destination

Lock every decision needed to write a replacement product spec for `rain-alley`: an eight-to-twelve-minute Yakuza-like Hong Kong rain-night over-shoulder TPS/RPG Vertical Slice (one street, one hero, one Investigation or dialogue, one gunfight, one Aftermath). When this map has no open children, hand off to `/to-spec`. Do not implement the slice on this map.

## Notes

- Domain glossary: `rain-alley/CONTEXT.md`. Keep terms sharp with `/domain-modeling`. HITL tickets use `/grilling`.
- Module language: `/codebase-design` (Rules kernel vs Presentation seam). Do not invent a generic AI framework.
- Engine surface: Engine v4 only, proven in-tree or by a small `/prototype`. FPS Gym is playability/capability reference, not an asset source.
- Keep the Rules kernel; Presentation may be replaced entirely.
- Charting constraint already recorded as [Do not migrate FPS Gym mesh-bin v3 cooked assets](../../../rain-alley/docs/adr/0001-do-not-migrate-gym-mesh-bin-v3.md).
- Old build tickets live in `.scratch/rain-alley/issues/` (01–14). They describe the superseded whitebox plan.
- This map produces decisions, not deliverables.
- Before execution, every decision ticket is discussed with Laurence and recorded. After the map clears, follow the Matt Pocock main flow: `/to-spec` → `/to-tickets` → one fresh `/implement` session per ticket; `/implement` drives TDD and closes with a Standards + Spec code review before commit.

## Decisions so far

- [当前引擎湿地雨夜与PBR已证明到哪一步](./issues/W03-engine-wet-pbr-rain.md) — 已证明标准 metallic/roughness PBR、IBL、HDR emissive/bloom、定向阴影及 Hellforge 屏幕空间 haze；雨、积水/动态 wetness、反射、体积雾和点/聚光阴影仍未被目标运行游戏证明。
- [当前引擎能否做确定性电影机位](./issues/W04-engine-cinematic-camera.md) — 可用 `Camera` + `Transform` 做固定构图，以 `setActiveCamera` 按实体 ID 硬切，或在游戏内用显式时间采样短镜头；没有已证明的通用 sequencer、全局 time scale 或跨轨 cutscene stack。
- [当前引擎骨骼动画与蒙皮合同是什么](./issues/W01-engine-animation-skinning.md) — Engine v4 proves generic imported skinning, explicit target binding, clip cuts/blends, and Hellforge’s five-state enemy loop, but not one skinned third-person character with the full idle/walk/aim/fire/reload/hit/death set.
- [当前引擎音频与音频事件合同是什么](./issues/W02-engine-audio-contract.md) — Engine v4 已证明的合同是 `audio` clip + `AudioSource` 边沿 + WebAudio Host；当前没有 `audio-event` 资产合同，FPS/Hellforge/Rain Alley 的程序化 WebAudio 不等同于 Engine API。
- [从glTF或FBX烹饪到mesh-bin v4的官方路径是什么](./issues/W05-official-cook-path-v4.md) — 只有源文件 + sidecar meta，经 Vite `pluginPack` 烹饪为 mesh-bin v4；runtime 拒收 v3，不能把旧 `.bin` 当源或在运行时转码。
- [仓库内还有哪些可授权复用的角色枪与街景](./issues/W06-in-org-reusable-assets.md) — 明确清权的树内资产集中在 CC0/CC BY 环境与非人角色；Meshy kit 需核验账户条款；现代人形、现代枪 mesh 与枪声采样仍为空缺。
- [Studio与游戏包里现有的性能验收合同是什么](./issues/W16-play-performance-contracts.md) — 游戏包 `forgeax.metrics` 五类全关；Studio Play smoke 不测 FPS；Rain Alley 把 gate 交给 Studio Play 但仍全部 disabled，自动化只剩 `bun test`。
- [一条街是否取代巷厨厅三段地理](./issues/W07-one-street-vs-three-segments.md) — 新切片只制作一条高密度香港雨街和一场完整枪战；门洞与室内仅作街景和掩体，旧三段 FSM 只是可复用规则材料。
- [调查与对话在切片里算什么](./issues/W08-investigation-dialogue-contract.md) — 最小闭环是调查哥哥照片 → 一名 NPC 短对白与一次态度选择 → 一场街战 → 由该选择分出的两种战后文字结果；无任务系统和对话树。
- [没有Gym源文件时资产从哪来](./issues/W09-asset-source-policy.md) — 不购买；原型用最快能进 Play 的 stand-in（Mixamo / CC0 / 生成 / 方块 / 树内蒙皮），授权补录后置；仍禁止 Gym HTML v3。
- [电影镜头语言选哪三刀](./issues/W12-three-cinematic-beats.md) — 定机位三刀：看照片、对白选择、战后文字；枪战保持越肩；硬切后按相机 ID 回到玩法相机；不用 sequencer / 漫画杀意冻结。
- [湿地雨夜怎么做才不超过引擎](./issues/W13-wet-rain-recipe.md) — 静态湿 roughness + 霓虹自发光 + 定向阴影；雨只作装饰；不做积水、动态湿润、反射、体积雾、点光阴影。
- [枪声与空间音用哪条音频路径](./issues/W14-audio-path.md) — 原型用游戏内程序化 WebAudio；枪声/空仓/命中/受伤必须有；clip 资产后补。
- [一个蒙皮主角加武器插座在Play里能不能站住](./issues/W10-skinned-hero-weapon-socket-prototype.md) — 能。蒙皮角色带材质加载、24 关节绑定、两段动画切换、方块武器以 `ChildOf` 挂 `RightHand` 并跟随动画；两条约束：关节空间是厘米、外部游戏必须先经 `projects/link` 登记。
- [白盒代码哪些留下哪些扔掉](./issues/W11-whitebox-keep-vs-delete.md) — 留规则内核、时钟、KCC、霰弹数值、对象池、指针锁定意图；扔方块人枪、程序化三段走廊、DOM HUD、私有 teleport；必须补真视线遮挡与真实指针锁定；一条表现层接缝，不做通用 AI 框架。
- [Play与性能验收门写到什么程度](./issues/W15-play-performance-gates.md) — 硬门是真实 Studio Play（link + active + `/preview/?game=`），电影镜头与枪战同宿主；验收看人眼五条；不开引擎 fps/gate 指标；自动化维持 `bun test` 加人工清单。

## Not yet specified

- How many extra street extras stand besides the one talker and the gunfight; crowd tech is unproven.
- A six-gun roster and a long-gun family.
- Facial performance and lip sync.

## Out of scope

- Copying, converting, or shimming FPS Gym HTML `mesh-binary@3` cooked assets (see ADR 0001).
- First-person viewmodel, ADS, and Gym arena art direction as the product look.
- Merging this slice into Hellforge.
- Open-world streaming, city-scale density, and unproven facial/crowd/sequencer stacks.
- A full dialogue tree, quest log, inventory, or relationship system.
- Comic kill-freeze / manhua HUD as the Aftermath (replaced by camera + two written endings).
- Implementing the Vertical Slice itself — that starts after `/to-spec` / `/to-tickets`.
