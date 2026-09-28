# W02 — 当前引擎音频与音频事件合同

## 结论

Engine v4 已有一条可用的、以 `audio` 资产和 ECS `AudioSource` 边沿为核心的音频链路；没有证据表明当前存在 `audio-event` 资产种类或独立音频事件总线。FPS、Hellforge 和当前 Rain Alley 的声音实现都不是这条 Engine 链路：它们分别直接使用程序化 Web Audio，或用 `HTMLAudioElement` 播放音乐。

这张票只确认能力边界，不替 Rain Alley 选择音效、环境声、空间化或混音设计。

## 1. 资产种类与导入/加载

- `AudioClipAsset` 是纯数据 `{ kind: 'audio', sourceKey, mediaType: audio/*, bytes }`，解码归 Host；Engine `Asset` 闭合联合包含它。[engine/packages/types/src/asset.ts:85-93](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/types/src/asset.ts#L85-L93) [engine/packages/types/src/index.ts:1210-1233](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/types/src/index.ts#L1210-L1233)
- build-time `audioImporter` 只接受一个 `kind: 'audio'` 子资产；识别 wav/mp3/ogg/flac MIME，读取原始字节并产出 `browser-audio` source artifact，不在构建期创建 `AudioContext` 或解码。[engine/packages/audio-webaudio/src/audio-importer.ts:35-48](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/audio-webaudio/src/audio-importer.ts#L35-L48) [engine/packages/audio-webaudio/src/audio-importer.ts:50-77](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/audio-webaudio/src/audio-importer.ts#L50-L77) [engine/packages/audio-webaudio/src/audio-importer.ts:80-129](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/audio-webaudio/src/audio-importer.ts#L80-L129)
- Pack v2 的 `audioLoader` 要求 `artifacts.source` 的 media type 为 `audio/*` 且与 payload 一致，再返回 `AudioClipAsset` 字节载荷。[engine/packages/audio-webaudio/src/audio-loader.ts:4-42](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/audio-webaudio/src/audio-loader.ts#L4-L42)
- `audioLoader` 不是 `assets-runtime` 普通默认 loader 表的一员；音频 Host 需要把它作为 extra loader 注入。运行时单测明确用 `new AssetRegistry(..., [audioLoader])`，随后 `loadByGuid<AudioClipAsset>`，且加载阶段不创建 `AudioContext`。[engine/packages/assets-runtime/src/wire-default-loaders.ts:50-64](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/assets-runtime/src/wire-default-loaders.ts#L50-L64) [engine/packages/runtime/src/__tests__/audio-load-by-guid.unit.test.ts:68-90](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/runtime/src/__tests__/audio-load-by-guid.unit.test.ts#L68-L90)
- `audioContribution` 是较新的 Host decoder contribution，同样只认 `kind: 'audio'`、`audio/*` 和非空字节，并把消费方标为 `AudioBackend`。[engine/packages/audio/src/assets/audio-decoder.ts:9-50](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/audio/src/assets/audio-decoder.ts#L9-L50)
- 在目标 Engine worktree 和目标 games worktree 全量搜索 `audio-event` / `AudioEvent` 均为零；闭合 `Asset` 联合也没有该分支。因此不能把 `audio-event` 当作当前 Engine v4 合同。

## 2. 播放 API 与运行语义

- 游戏侧主合同是 `AudioSource`：`clip`, `playing`, `loop`, `volume`, `spatialBlend`, `bus`；`AudioListener` 是空 marker。bus 只有 `'sfx' | 'music'`。[engine/packages/audio/src/components.ts:13-23](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/audio/src/components.ts#L13-L23) [engine/packages/audio/src/audio-backend.ts:12-20](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/audio/src/audio-backend.ts#L12-L20)
- 播放由 `playing` 边沿驱动：`false -> true` 调 `play`，`true -> false` 调 `stop`；播放中只自动追踪 `volume` 更新，实体移除会 stop。要重复触发 one-shot，游戏必须先写回 `false` 再写 `true`。[engine/packages/audio/src/audio-tick-system.ts:22-27](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/audio/src/audio-tick-system.ts#L22-L27) [engine/packages/audio/src/audio-tick-system.ts:69-119](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/audio/src/audio-tick-system.ts#L69-L119)
- 后端直接 API 是 `play/stop/setVolume/setBusVolume/setBusMute/setListenerPose/getState/destroy`。没有命名 cue、随机容器、衰减曲线、并发组、优先级或“audio event”对象。[engine/packages/audio/src/audio-backend.ts:41-51](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/audio/src/audio-backend.ts#L41-L51)
- `audioPlugin` 注册组件、`AudioEngine` world resource、tick system，并把第一个 `AudioListener + Transform` 的世界位姿同步到后端。[engine/packages/audio/src/plugin-factory.ts:19-60](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/audio/src/plugin-factory.ts#L19-L60)
- WebAudio Host 懒建 `AudioContext`，建立 `sfx + music -> master`，用一次性 click/keydown/touchstart 重试 resume。[engine/packages/audio-webaudio/src/web-audio-engine.ts:43-70](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/audio-webaudio/src/web-audio-engine.ts#L43-L70) [engine/packages/audio-webaudio/src/web-audio-engine.ts:100-150](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/audio-webaudio/src/web-audio-engine.ts#L100-L150)
- 播放时 Host 才 `decodeAudioData`；每个 entity 同时只有一个 active source，新 play 会替换旧 source。`spatialBlend > 0` 只决定是否插入 `PannerNode`，当前没有由 blend 数值插值 dry/spatial 路径；非循环 source `onended` 自动清理。[engine/packages/audio-webaudio/src/web-audio-engine.ts:221-238](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/audio-webaudio/src/web-audio-engine.ts#L221-L238) [engine/packages/audio-webaudio/src/web-audio-engine.ts:240-287](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/audio-webaudio/src/web-audio-engine.ts#L240-L287)
- Realm/Host 边界传输的是闭合 `AudioIntent`：play、stop、source volume、bus volume/mute、listener pose、destroy。首个 sourceKey play 携带 bytes，后续复用缓存。[engine/packages/audio/src/audio-intent.ts:10-23](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/audio/src/audio-intent.ts#L10-L23) [engine/packages/audio/src/audio-intent.ts:50-84](../../../../../../../forgeax-studio/.worktrees/rain-alley-play/packages/editor/packages/engine/packages/audio/src/audio-intent.ts#L50-L84)

## 3. 目标游戏现状

### FPS Gym

- 完全是“zero asset files”的程序化 Web Audio：噪声 buffer、oscillator、filter、gain 包络直接组合枪声/命中/换弹等；`fire()` 直接调用 `audio.shot(...)`。[fps/main.ts:1062-1120](../../../fps/main.ts#L1062-L1120) [fps/main.ts:660-670](../../../fps/main.ts#L660-L670)
- ambience 是两个持续 oscillator 的低频 drone，首次 mousedown 时启动；不是音频资产，也不经过 `AudioSource`。[fps/main.ts:515-519](../../../fps/main.ts#L515-L519) [fps/main.ts:1122-1138](../../../fps/main.ts#L1122-L1138)

### Hellforge

- SFX 同样是自有 `AudioContext` 的 oscillator/noise 合成器，首次 pointer/key gesture 解锁，`Sfx.play(name)` 直接调度节点；不使用 Engine audio 包。[hellforge/src/sfx.ts:1-8](../../../hellforge/src/sfx.ts#L1-L8) [hellforge/src/sfx.ts:30-46](../../../hellforge/src/sfx.ts#L30-L46) [hellforge/src/sfx.ts:73-110](../../../hellforge/src/sfx.ts#L73-L110)
- BGM 是 `HTMLAudioElement` 播放两个 mp3，带 0.35 秒 phase crossfade 和自有 duck/volume；文件头已明确“no engine AudioClip”。[hellforge/src/bgm.ts:1-15](../../../hellforge/src/bgm.ts#L1-L15) [hellforge/src/bgm.ts:117-180](../../../hellforge/src/bgm.ts#L117-L180) [hellforge/src/bgm.ts:239-268](../../../hellforge/src/bgm.ts#L239-L268)
- 主程序分别安装 `installBgm` 和 `Sfx`，进一步证明它们是游戏自管的两套音频所有者。[hellforge/main.ts:604-623](../../../hellforge/main.ts#L604-L623) [hellforge/main.ts:1020-1027](../../../hellforge/main.ts#L1020-L1027)

### 当前 Rain Alley

- 只有 `ShotSoundPool`：三个常驻 oscillator + 三个 gain channel，开枪时轮转触发 0.14 秒包络；没有 ambience、音频资产或 Engine `AudioSource`。[rain-alley/main.ts:528-560](../../../rain-alley/main.ts#L528-L560) [rain-alley/main.ts:820-823](../../../rain-alley/main.ts#L820-L823) [rain-alley/main.ts:1410-1419](../../../rain-alley/main.ts#L1410-L1419)

## 4. 对后续规格的合同边界

- 可以依赖：`audio` GUID -> `AudioClipAsset` -> world shared ref -> `AudioSource.playing` 边沿 -> Host WebAudio；sfx/music 两总线；可选 positional panner；listener 跟随首个标记实体；显式清理。
- 不可依赖：`audio-event` 资产、命名事件库、随机/分层 cue、距离参数合同、混响区、优先级/voice stealing、第三 ambience bus，或 FPS Gym 程序化声音作为 Engine API。
- 规格若采用 Engine 链路，应把“游戏规则发生了 shot/ambience 状态变化”与“如何驱动 `AudioSource` 边沿/loop”分开描述；不要把 FPS Gym 的 oscillator 实现复制成 Engine 合同。
