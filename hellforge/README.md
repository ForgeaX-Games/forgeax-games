<!-- context-audit:2026-09-10 -->
> 文档核对：2026-09-10。按源码使用的参考文档；文中的验收结果仅适用于其记录的版本和日期。
> 接手先读 [当前状态与入口](CURRENT.md)；[整理前原文](docs/archive/pre-management/README.md) 保留来源与原始内容。

# ForgeaX: Hellforge

An original dark-fantasy action RPG sample on the forgeax engine. The dying
embers of a great Hellforge corrupt the land. UI layout is D2R-*inspired*
(visual language only — no Blizzard assets or owned world terms).

## 旧 Studio checkout 的启动前提（2026-08-13 记录）

**当前分支是独立 SDK 0.1.38 Web 发布候选，尚未发布。** 请按 [CURRENT.md](CURRENT.md) 执行 `pnpm install --frozen-lockfile` → `pnpm build` → `pnpm preview --port 18738`，访问 `/games/hellforge/`；后续升级与发布按 [持续迭代手册](docs/sdk-migration/CONTINUATION-RUNBOOK.md)。
下述 Studio 段落仅作历史记录，不是本迁移副本的启动方式，也不授权修改 Studio pin。

历史 1K cook 记录要求 Node heap ≥ 16GB。是否仍适用于新 pin 必须重新测试；本次没有核验远端 #2078 状态，不能把旧要求推广为所有 Engine 的永久前提。实际 Studio 加载的是旧游戏副本，先核对 [CURRENT.md](CURRENT.md)。

```bash
# in forgeax-studio/.env (gitignored — do not commit)
NODE_OPTIONS=--max-old-space-size=16384

# then from Terminal.app in the studio repo root — `start` reuses the old process:
bun fx restart
# browser: http://localhost:18920 → hellforge → Play
```

Do not raise the heap further to restore 2K textures. See [`docs/handoff/2026-08-13-1k-textures-and-2k-restore.md`](./docs/handoff/2026-08-13-1k-textures-and-2k-restore.md).

## Pitch

You play a female **Sorceress** in an Act-1 vertical slice: spawn in **余烬哨站
Cinderwatch**, accept a quest from 烬守者维拉, cross **灰烬荒原 Ashen Reach**,
cast tree-resolved skills (magma / frost / arc / phase-step), loot and level,
then clear **熔渣深窟 Slagdeep Hollow** and turn the quest in for a frost wand.
Default combat camera is fixed isometric (`arpg`); **V** toggles a camp-only
non-combat showcase with spring-arm collision (~400 ms blend).

## Status (2026-07-17) — Sorceress ARPG vertical slice (code-complete)

Code milestones M1–M4 and M5.1–5.2 + M6.1–6.2 are on this branch. **Browser
acceptance and licensed audio remain open human gates** — see Open gates.

- [x] Domain save (`CharacterDomain` envelope), derived `CombatStats`, damage
- [x] Point-and-click + WASD movement intent; UiLayerManager panel ownership
- [x] ARPG camera rig + camp showcase (probe / orbit / blend)
- [x] Three-branch Sorceress skill tree (33 nodes) + hotbar select (1–4)
- [x] Quest / dialogue (Veyra) — rewards on turn-in, not auto-grant
- [x] Hybrid areas: Cinderwatch → Ashen Reach → Slagdeep
- [x] Frost Fang shader VFX language (M5.1–5.2)
- [x] D2R-inspired HUD: globes, skill bar, XP, quest tracker, automap, **C**
      character sheet from `CombatStats`, target name/level/HP
- [ ] Browser walkthrough at 1920×1080 and 1280×720 (human)
- [ ] M5.3–5.4 licensed SFX + provenanced BGM (blocked — see below)

## Controls

| input | action |
|---|---|
| WASD | move · Shift sprint (cancels click path / pursuit) |
| Mouse | aim — isometric ground cursor · showcase: look |
| Left-click | ground → path; enemy → pursue + Frost Fang; npc/loot/exit → interact |
| Right-click | cast selected hotbar skill · showcase: drag orbit |
| 1 / 2 / 3 / 4 | **select** hotbar slot only (do not cast) |
| B | camp: stash dual-open (仓库+背包) · wilderness/den: inventory |
| I | inventory |
| K | skill tree |
| C | character / combat-stat sheet |
| Q | quest log |
| Tab | den automap |
| V | camp-only showcase toggle (combat / loot / entrance off) |
| R | respawn after death (camp; progression kept) |
| F | forge / 熔炉方块 (salvage / re-roll / fuse) |
| F10 | render-settings panel |
| Esc | close major panels / automap |

- **N-Stash:** 营地专属个人仓库 (camp-only personal stash, 12×10 grid) — drag
  items both ways between 背包 ⇄ 仓库 (B opens the dual-open pair in camp).

## Open gates

1. **Browser acceptance pending human** — the recorded milestone did not complete interactive
   playtesting. Do not invent screenshots or claim SPEC §15 walkthroughs.
2. **Audio provenance M5.3–5.4 blocked**
   - No licensed OGG (or equivalent) production SFX pack is checked in.
   - Existing BGM under `assets/music/` is documented with Metaphor OST-style
     titles and has **no cleared provenance**; do not invent licenses or claim
     `verify-audio-manifest` passes.
   - Runtime combat bed remains synthesized WebAudio (`src/sfx.ts`).

## Verify (static)

```bash
cd /Users/you/dev/game-workspace/checkouts/hellforge-games
bun test hellforge/src
bun hellforge/scripts/validate-scene-pack.ts hellforge/assets/scenes/rogue-encampment.pack.json
bun hellforge/scripts/validate-blocker-prop-consistency.ts
```

`validate-blocker-prop-consistency` compares camp obstacle AABBs to pack prop
footprints (unit-cube × transform) — **camp is the hard L2 gate**. Wild
(`ashen-reach.layout.json`) is **layout-internal only by design for PR1** (no
companion pack / prop match). Optional named exceptions live in
`assets/scenes/blocker-prop-allowlist.json` (empty by default).

Do **not** cite `bun fx check` or `ONLY=hellforge bun scripts/website/build-games.mjs`
as Hellforge source gates (see SPEC / plan notes).

## World layout

```
(0, 0) …………………… Cinderwatch (scene pack, safe zone)
   └ gate → Ashen Reach wilderness
        └ cave mouth → Slagdeep Hollow (PCG, quest + boss) @ (300, 300)
```

## Spec / plan

- [`ARPG-VERTICAL-SLICE-SPEC.md`](./ARPG-VERTICAL-SLICE-SPEC.md)
- [`ARPG-VERTICAL-SLICE-PLAN.md`](./ARPG-VERTICAL-SLICE-PLAN.md)
- [`PLAY_EXPERIENCE.md`](./PLAY_EXPERIENCE.md)
- [`AGENTS.md`](./AGENTS.md)
- [`docs/handoff/2026-08-13-1k-textures-and-2k-restore.md`](./docs/handoff/2026-08-13-1k-textures-and-2k-restore.md) — 1K cook 权宜与 2K 恢复
