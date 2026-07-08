# Hellforge 角色动作交付契约(5-clip)

> 你新生成一个主角时,按这份交付。Hellforge 的主角(女巫)和每种怪物都用
> **同一套 5-clip 契约**:一份共享蒙皮 mesh + 5 条 animation clip,运行时靠
> clip GUID 切换动作(**不换模型**)。参考实现见
> [`assets/characters/witch.glb.meta.json`](../assets/characters/witch.glb.meta.json)
> 与 [`main.ts`](../main.ts) 的 `WITCH` 块 / [`src/monsters.ts`](../src/monsters.ts)。

## 为什么是 5 条而不是 10 个 GLB

Meshy/gen3d 默认一个动作一个 GLB,每个 GLB 都带一份 mesh 拷贝(gta-01 每个
motion GLB ≈ 7.9 MB × 10 ≈ 80 MB,≈ 8 万面重复 10 次)。加载/切换都要换模型,
性能差。引擎的高效做法(见 `witch.glb`):**一个 GLB 内嵌 5 条 clip**,mesh 只
一份,切动作只是换 clip GUID 引用。合并流水线见
[`scripts/merge-gen3d-motions.ts`](../scripts/merge-gen3d-motions.ts)。

---

## B1. 必需的 5 个动作

| 槽位 | 动作 | 类型 | 说明 |
|---|---|---|---|
| `idle` | 待机 | **循环** | 角色不动时播;轻微呼吸/晃动 |
| `move` | 走/跑合一 | **循环** | 引擎按移速自动缩放播放速率(一条覆盖 走/跑/冲刺);给一条自然的跑或快走即可 |
| `attack` | 攻击/施法 | **one-shot** | 4 个技能共用这一条;播放时锁定移动,播完回 idle |
| `hit` | 受击硬直 | **one-shot** | 被打时播;短促后仰/踉跄,播完回 idle |
| `death` | 死亡 | **one-shot** | 播完停在最后一帧,实体回收 |

> 招架/闪避/技能变体等**不在契约内**;要加就扩 `WITCH.clips` 数组并改
> `main.ts` 的 `swapClip`/`playOnce` 调用,但首版 5 条够用。

## B2. 交付格式

- **首选**:一个内嵌 5 动画的 GLB(`witch.glb` 就是这种)。meta.json 里会有
  `mesh / material / scene / texture / skeleton / skin` 各 1 个 + 5 个
  `animation-clip` 子资产。
- **次选**:5 个 motion GLB(每条动作一个),用
  [`scripts/merge-gen3d-motions.ts`](../scripts/merge-gen3d-motions.ts) 合并成
  上面的单 GLB。
- **骨架**:一套骨架、一份 mesh,5 条 clip 共用。关节名与 rigged base 一致
  即可(Meshy 短名如 `Hips`,引擎按名解析,已验证 `gta-01.rigged_model.glb`
  26 关节与 motion GLB 0 差异,**无需 retarget**)。
- **mesh 节点世界矩阵为单位阵**(引擎蒙皮契约;见
  [`ENGINE-SKINNING-DOUBLE-TRANSFORM.md`](./ENGINE-SKINNING-DOUBLE-TRANSFORM.md))。
  水平 root motion 可去除(位移由代码驱动,见 `monsters.ts` 的
  `stripRootMotionXZ`)。
- **面数**:8000+ 面单个共享 mesh 没问题(gta-01 = 8000 面);**要避免的是
  10 个 GLB 各带一份 mesh 拷贝**(≈ 重复 8 万面)。

## B3. 接线(生成 + 合并完之后)

1. 跑合并脚本产出 `assets/characters/<hero>.glb`:
   ```bash
   bun scripts/merge-gen3d-motions.ts assets/3d/characters/gta-01.glb.gen3d-meta.json assets/characters/<hero>.glb
   ```
2. 导入引擎目录生成 sidecar:
   ```bash
   forgeax-engine-remote-gltf import assets/characters/<hero>.glb
   # → assets/characters/<hero>.glb.meta.json(mesh/material/scene/texture/skeleton/skin + 5 animation-clip)
   # vite-plugin-pack 自动入 catalog,无需手改
   ```
3. 抄 `main.ts` 的 `WITCH` 块,把 scene GUID + 5 clip GUID 换成新 sidecar 里的:
   ```ts
   const HERO = {
     scene:  '<scene-guid from <hero>.glb.meta.json>',
     clips: [
       { name: 'idle',   guid: '<animation-clip idle guid>' },
       { name: 'move',   guid: '<animation-clip move guid>' },
       { name: 'attack', guid: '<animation-clip attack guid>' },
       { name: 'hit',    guid: '<animation-clip hit guid>' },
       { name: 'death',  guid: '<animation-clip death guid>' },
     ] as const,
   } as const;
   ```
   然后把 `loadWitch(...)` / `playerRig` 接到 `HERO`。怪物同理(每种怪一套 5 clip)。

## B4. 动作标签 → 槽位映射(给 gen3d motion 命名用)

Meshy 的 motion 标签不直接对应 5 槽,合并脚本里 `MOTION_MAP` 按关键词归槽:

| Meshy 标签关键词 | 归到槽位 |
|---|---|
| `walk` / `走路` / `free-walk` | `idle`(慢走当待机)或 `move` |
| `run` / `跑步` / `RunFast` / `free-run` | `move` |
| `Punch` / `Kick` / `Shot` / `Combo` / `attack` | `attack` |
| `hit` / `hurt` / `damage` / `受击` | `hit`(Meshy 没有现成的,可能要单独生成) |
| `Dead` / `death` / `die` / `死亡` | `death` |

> `hit` 在 Meshy 库里常缺;可从 `idle` 加一段抖动当 hit,或单独让生成器出一条
> "受击后仰"。`idle` 也可以用极慢的 `walk` 凑(脚本里把 `walk` 映射到 `idle`)。

`merge-gen3d-motions.ts` 顶部的 `MOTION_MAP` 可改;映射不到的 motion 会被列出
让你补。
