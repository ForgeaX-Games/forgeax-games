# Hellforge 角色动作交付契约(6-clip)

> 你新生成一个主角时,按这份交付。Hellforge 的主角用
> **同一套 6-clip 契约**:一份共享蒙皮 mesh + 6 条 animation clip,运行时靠
> clip GUID 切换动作(**不换模型**)。当前主角参考实现:
> [`assets/characters/charactery-merged.glb.meta.json`](./assets/characters/charactery-merged.glb.meta.json)
> 与 [`src/heroes.ts`](./src/heroes.ts) / [`main.ts`](./main.ts) 的 `WITCH` 块
> (变量名历史遗留)/ [`src/monsters.ts`](./src/monsters.ts)。
> 早期 `witch.glb` 仍可作契约样例,但运行时已切到 charactery。
>
> 怪物仍可用 5-clip(`idle/move/attack/hit/death`);主角已拆成独立
> `walk` + `run`。

## 为什么是 6 条而不是 10 个 GLB

Meshy/gen3d 默认一个动作一个 GLB,每个 GLB 都带一份 mesh 拷贝(gta-01 每个
motion GLB ≈ 7.9 MB × 10 ≈ 80 MB,≈ 8 万面重复 10 次)。加载/切换都要换模型,
性能差。引擎的高效做法(见 `charactery-merged.glb` / 早期 `witch.glb`):
**一个 GLB 内嵌 6 条 clip**,mesh 只一份,切动作只是换 clip GUID 引用。合并流水线见
[`scripts/merge-gen3d-motions.ts`](./scripts/merge-gen3d-motions.ts)。

---

## B1. 必需的 6 个动作

| 槽位 | 动作 | 类型 | 说明 |
|---|---|---|---|
| `idle` | 待机 | **循环** | 角色不动时播;轻微呼吸/晃动 |
| `walk` | 走路 | **循环** | 中低速位移;由 `selectLocomotionClip` 按实际地速选 |
| `run` | 跑步 | **循环** | 高速/冲刺位移;与 walk **必须是不同源 clip**,禁止用 walk 冒充 |
| `attack` | 攻击/施法 | **one-shot** | 4 个技能共用这一条;播放时锁定移动,播完回 idle/walk/run |
| `hit` | 受击硬直 | **one-shot** | 被打时播;短促后仰/踉跄,播完回 idle/walk/run |
| `death` | 死亡 | **one-shot** | 播完停在最后一帧,实体回收 |

> 招架/闪避/技能变体等**不在契约内**;要加就扩 `HeroGltfClipName` 并改
> `main.ts` 的 `swapClip`/`playOnce` 调用。

## B2. 交付格式

- **首选**:一个内嵌 6 动画的 GLB(`charactery-merged.glb`)。meta.json 里会有
  `mesh / material / scene / texture / skeleton / skin` 各 1 个 + 6 个
  `animation-clip` 子资产。
- **次选**:6 个 motion GLB(每条动作一个),用
  [`scripts/merge-gen3d-motions.ts`](./scripts/merge-gen3d-motions.ts) 合并成
  上面的单 GLB。
- **骨架**:一套骨架、一份 mesh,6 条 clip 共用。关节名与 rigged base 一致
  即可(Meshy 短名如 `Hips`,引擎按名解析,已验证 meshy rigged 与 motion GLB
  关节一致,**无需 retarget**)。
- **mesh 节点世界矩阵为单位阵**(引擎蒙皮契约;见
  [`ENGINE-SKINNING-DOUBLE-TRANSFORM.md`](./ENGINE-SKINNING-DOUBLE-TRANSFORM.md))。
  水平 root motion 可去除(位移由代码驱动,见 `monsters.ts` 的
  `stripRootMotionXZ`)。
- **面数**:8000+ 面单个共享 mesh 没问题;**要避免的是
  10 个 GLB 各带一份 mesh 拷贝**。

## B3. 接线(生成 + 合并完之后)

1. 跑合并脚本产出 `assets/characters/<hero>-merged.glb`:
   ```bash
   bun scripts/merge-gen3d-motions.ts assets/3d/characters/<hero>.glb.gen3d-meta.json assets/characters/<hero>-merged.glb
   ```
2. 导入引擎目录生成 sidecar:
   ```bash
   forgeax-engine-remote-gltf import assets/characters/<hero>-merged.glb
   # → assets/characters/<hero>-merged.glb.meta.json
   ```
3. 抄 `src/heroes.ts` 的 `sorceressGltf` 块,把 scene GUID + 6 clip GUID 换成新 sidecar 里的;
   按 walk/run clip 时长分别调 `ANIM_STRIDE_WALK` / `ANIM_STRIDE_RUN`(free-walk ≈ 1.07s,
   free-run ≈ 0.67s)。
4. 运行时用 [`src/locomotion.ts`](./src/locomotion.ts) `selectLocomotionClip(speed, isPathDriven)`
   按**实际地速**选 walk/run,不要读按键状态。
5. **勿**把引擎生成的 `*.rigged_model.glb.meta.json` 留在 `assets/3d/characters/`
   (会撞 wb-gen3d 扫描);gen3d 侧车是 `*.glb.gen3d-meta.json`。

## B4. 动作标签 → 槽位映射(给 gen3d motion 命名用)

Meshy 的 motion 标签不直接对应 6 槽,合并脚本里 `MOTION_MAP` 按关键词归槽:

| Meshy 标签关键词 | 归到槽位 |
|---|---|
| `free-walk` / `走路` / `handbag` / `walk` / `走` | `walk`(free-walk / 走路 优先) |
| `free-run` / `跑步` / `run` / `跑` / `dash` | `run`(free-run / 跑步 优先;**禁止**回退到 walk) |
| `idle` / `stand` / `breath` | `idle` |
| `Punch` / `Kick` / `Shot` / `Combo` / `attack` / `cast` | `attack` |
| `hit` / `hurt` / `damage` / `受击` | `hit` |
| `Dead` / `death` / `die` / `死亡` | `death` |

> 主角固定输入(Task 1.4):
> `charactery.animated_model.motion-meshy-free-walk.glb` +
> `charactery.animated_model.motion-meshy-free-run.glb`。缺二进制 blob
> (只剩 `.meta.json`)是硬阻塞——先补资产再合并,禁止把 walk 复制成 run。
> `hit` 在 Meshy 库里常缺;可从 `idle` 加一段抖动当 hit,或单独生成。

`merge-gen3d-motions.ts` 顶部的 `MOTION_MAP` 可改;映射不到的 motion 会被列出
让你补。
