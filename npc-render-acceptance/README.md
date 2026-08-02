# NPC Render Acceptance

真实 Studio renderer 验收夹具，对应 NPC PRD M2 规模门槛。

- `localStorage['forgeax.npc-render-acceptance.mode']='body'`：5000 个 Body，以引擎 `Instances` 的 2048/2048/904 分区渲染。
- 值为 `spotlight`：500 个 Body + 30 spotlight，真实调用 `NpcClient.connect` 与单次 `sendSnapshots`。
- Play world 暴露 `globalThis.__npcRenderAcceptance`，包含 mode、实例数、render entity 数与 frame 计数，供真实 `:18920` Playwright harness 采集 FPS。

验收必须在 Studio `:18920` 的 Play / Game Look 中执行；独立 Play server 或单测不能替代 renderer 证据。两模式相同预热与采样窗，FPS 差异要求小于 10%，且 console error 为 0。
