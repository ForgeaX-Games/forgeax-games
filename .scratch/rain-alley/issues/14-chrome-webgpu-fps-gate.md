# 14 Chrome WebGPU与FPS性能红线最终门

## What to build

最终门：macOS Chrome + WebGPU 真人打通 8–12 分钟切片，不依赖桌面 app 或 Safari。射击时枪口焰、弹壳、火星、枪声仍在，但不能每枪重建整场景；闲置武器离开相机/骨骼根；特效与枪声走池化；动态灯可自适应。帧率要稳到能瞄准，掉帧根因按「CPU 场景重建」而不是「GPU 填不满」来验收。本票是发布前的性能与宿主红线，不是新玩法。

## Blocked by

13 港漫击杀反馈

## Status

ready-for-agent

## Acceptance checklist

- [ ] 验收宿主是 macOS Chrome WebGPU；桌面 `.app` / Safari 不算过票
- [ ] 真人能连续打通开场闪回→巷→厨→厅→大衣→胜利闪回，时长落在约 8–12 分钟可玩切片
- [ ] 连射与击杀冻结期间仍能瞄准；没有每枪整世界卡死
- [ ] 枪口焰、弹壳、火星、枪声在终局仍然存在，不是为了帧率被摘掉
- [ ] Hellforge 的 16GB cook 前提、场景与角色域未被本切片改动
- [ ] 本票可单独演示：Chrome ▶ Play 完整走通一遍，并对照开火前后是否可瞄准
- [ ] 只改 `rain-alley`；Hellforge 零改；不 push
