<!-- context-audit:2026-09-10 -->
> 文档核对：2026-09-10。设计/规划参考；不作为当前实现或验收完成的证明。
> 接手先读 [当前状态与入口](CURRENT.md)；[整理前原文](docs/archive/pre-management/CONTEXT.md) 保留来源与原始内容。

# Rain Alley

2026-09-09 默认 FPS 已接入[性能优化](docs/fps/PERFORMANCE.md)：派生 `district-batched.glb`、预加载敌人动画 LOD，并复用引擎注册的标准材质参数声明。原 GLB/Blender 保留；不改引擎、不做途中资源流式加载。当前 720p 内嵌浏览器短窗口约 59–60 FPS，独立 Chrome 对照仍未达标，跨设备与长期帧率需单独验收。

内容生产基线为[生活化街区与交战增量](docs/fps/LIVING-CITY.md)：派生场景 `district-lived.glb`，17 栋楼高调整、165 个静态碰撞代理、可行走楼梯与 F 攀梯，敌人巡逻/追击/攻击，主角受击和死亡重开。原剧情资源保留。

A Hong Kong rain-night shooter with two separate entries: the current FPS Arsenal (`fps-main.ts`) and the original over-shoulder narrative slice (`main.ts`). The 2026-09-07 user request explicitly adds first-person handling and multiple weapons; the older narrative terms below still describe the legacy mode.

The 2026-09-08 art/handling pass adds period-oriented weapons, articulated enemies, five reload styles, layered synthesized audio and the case-file HUD. See [Engine art handoff](docs/fps/ART-HANDOFF.md) for import/material compatibility and physical boundaries.

## Language

**Vertical Slice**:
The destination experience: one street, one hero, one investigation or dialogue, one gunfight, and one aftermath, playable in about eight to twelve minutes.
_Avoid_: whitebox, demo, FPS Gym, Hellforge camp

**Whitebox**:
Cube stand-ins and HUD used to test rules. The district architecture now has an art pass; the FPS now uses stylized articulated Blender characters; the legacy mode keeps its stand-ins. It is not the product look.
_Avoid_: prototype (unless a throwaway `/prototype` branch), vertical slice

**District collision**:
Legacy Blender proxies live in `src/street-layout.ts`; FPS projects these through `src/fps/city-collision.ts`, adjusts building heights and adds 48 stair/gallery proxies (165 total). Bootstrap creates static ECS colliders, and Rapier handles movement. Runtime does not call Blender MCP or load the authoring JSON. See [district integration](docs/district/INTEGRATION.md).
_Avoid_: automatic GLB collision generation, MCP runtime dependency

**Rules kernel**:
Pure functions and the segment FSM that decide clocks, shotgun, vitality, enemy intent, and phase transitions without importing render.
_Avoid_: gameplay, AI framework, combat system (when meaning this module)

**Presentation**:
Everything the player sees and hears: scene, characters, sockets, cameras, audio, VFX, HUD. Replaceable without rewriting the rules kernel.
_Avoid_: main.ts (that file currently mixes layers)

**FPS Gym**:
A handling and ForgeaX-capability reference. The FPS Arsenal distills ADS, recoil, spread, mechanical feedback and audio concepts from its static code. It does not copy legacy cooked assets; see [FPS analysis](docs/fps/REFERENCE-ANALYSIS.md).
_Avoid_: HTML pack, cooked blobs

**mesh-binary/4**:
The cooked mesh binary format, not an Engine release number. Record actual Studio, Editor and Engine commits separately; historical validation used Engine 743b773, while the current local embedded checkout is listed in CURRENT.md.
_Avoid_: mesh-binary v3, Gym cooked artifacts

**Weapon Socket**:
In the legacy third-person mode, a named attach point on a character rig. The separate FPS mode currently loads named Blender GLB parts through the official asset pipeline and parents them to its camera; a dedicated viewmodel render layer is a future engine integration seam.
_Avoid_: conflating third-person sockets with FPS viewmodels

**Acting State**:
The visible character performance a player can read: idle, walk, run, aim, fire, pump, reload, hit, death.
_Avoid_: 8-clip contract (the old spec listed six clips and called them eight)

**Investigation**:
The player inspects the brother’s photo as a world object plus HUD copy, and must do this before the street talk can complete. Not a quest log.
_Avoid_: RPG system, mission, collectible

**Attitude Choice**:
One street NPC, short on-screen lines, two options stored as one persistent flag. No voice and no branching conversation graph.
_Avoid_: dialogue tree, quest giver

**Aftermath**:
The beat after the gunfight that shows one of two written endings chosen by the Attitude Choice flag. Not a score screen.
_Avoid_: victory flashback, scoreboard

**Stand-in**:
Whatever mesh or clip gets a humanoid, Weapon Socket, and street mass into Play fastest. It is not the shipped look and does not wait on a license file.
_Avoid_: final art, product hero, cleared CC0 pack (until a later license pass)

**License pass**:
A later gate before public or mainline ship. Not a blocker for the prototype or this map’s remaining decisions.
_Avoid_: treating the Gym HTML v3 ban as optional (that ban is a codec/ADR constraint)

**Gameplay Camera**:
The over-shoulder camera used during the street gunfight and free movement. Restored by entity ID after every authored beat.
_Avoid_: first-person, ADS, active-camera-by-spawn-order

**Authored Beat**:
A hard-cut camera pose for photo look, talk, or Aftermath. Not a sequencer track.
_Avoid_: cutscene stack, App.pause, DOM video

**Legacy narrative Wet Look**:
Street materials with static low roughness (and optional metallic) plus emissive neon. Not rain physics or puddles.
_Avoid_: dynamic wetness, SSR, volume fog
