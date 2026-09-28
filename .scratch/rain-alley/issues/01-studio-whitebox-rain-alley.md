# 01 Studio白盒雨巷

## What to build

玩家能在 Studio 游戏列表里单独打开《雨夜不回头》（slug `rain-alley`），与 Hellforge 并列、互不覆盖。▶ Play 后进入白盒 L 形雨巷：方块墙、占位主角、固定右肩越肩第三人称、鼠标指针锁定瞄准、WASD 相对相机移动。玩家能走完整条窄巷并看到换弹转角，体感是港片巷战机位而不是等距 ARPG 或第一人称。本票不包含开火、敌人、段切换或美术皮肤。

## Blocked by

无

## Status

ready-for-agent

## Acceptance checklist

- [ ] Studio 启动后能发现并打开独立游戏《雨夜不回头》，Hellforge 仍在列表且可照常打开
- [ ] 玩家能看到右肩越肩机位里的占位主角与白盒巷道，而不是第一人称或 Hellforge 等距视角
- [ ] 鼠标锁定后可环顾，WASD 相对相机平移/ strafe，能走到 L 形巷的转角
- [ ] 巷内有可读的换弹转角几何，无支路、无可错过房间
- [ ] 本票可单独给玩家演示：从列表进入、走一圈巷、退出；不依赖后续战斗票
- [ ] 只改 `rain-alley`；Hellforge 零改；不 push
