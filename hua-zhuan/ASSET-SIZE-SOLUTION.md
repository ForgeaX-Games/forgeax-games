# 图片资源尺寸规范化方案

## 问题诊断

当前 `assets/source/` 中的 PNG 实际像素尺寸与代码/设计文档要求的显示尺寸严重不匹配，
导致「图片缩放 × 节点布局缩放 × 容器 boardScale」三重叠加，花砖尺寸难以计算。

### 现状对照表

| 资产文件 | 实际像素 | 设计目标尺寸 | 缩放比 | 问题程度 |
|----------|----------|-------------|--------|----------|
| `factory-plate.png` | 2048×2048 | 160×160 | **缩小 ~13×** | 严重浪费 |
| `tile-first-player.png` | 917×768 | 48×48 | **缩小 ~19×** | 严重浪费 |
| `main_board_bg.png` | 2106×1504 | 900×650 | 缩小 ~2.3× | 可接受(retina) |
| `wall_grid_outline.png` | 928×911 | 400×400 | 缩小 ~2.3× | 可接受(retina) |
| `arrow_right_icon.png` | 175×108 | 24×18 | 缩小 ~7× | 中等浪费 |
| `score_box_bg.png` | 253×95 | 160×60 | 缩小 ~1.6× | 可接受(retina) |
| `pattern_slot_empty.png` | 76×76 | 70×70 | 略大 | 正常 |
| `tile-*.png` (5色) | 48×48 | 48×48 | **1:1** | 完美 |

---

## 解决方案：载入时 Bake + 设计坐标统一

### 核心原则

```
源 PNG（任意像素）──→ 载入 Bake ──→ 标准逻辑尺寸 ──→ 仅一层 boardScale ──→ 屏幕
```

**分离三件事：**

1. **素材像素** — 源文件可以是任意分辨率（高清或低清都行）
2. **逻辑尺寸** — 在 900×650 设计空间里的固定值，写死在代码里
3. **显示缩放** — 仅由 `boardScale` 一个变量控制

### 方案 A：CSS 强制尺寸（最简，零代码改动）

当前 `board-ui.ts` 已经在用 `img.style.width/height` 设置绝对像素尺寸，
浏览器会自动将源 PNG 缩放到指定 CSS 尺寸。**现有管线已经是这种模式**。

唯一需要做的是：
- 确保所有 `<img>` 元素都显式设置了 `width` 和 `height`（已满足）
- 添加 `image-rendering: auto`（默认，缩小时抗锯齿）
- 对过大的源文件提供 **优化版本** 节省带宽（见方案 B）

**优点**：零改动，浏览器原生支持
**缺点**：2048×2048 解码后仍占 16MB 显存，首帧慢

### 方案 B：离屏 Canvas 预烘焙（推荐）

在 `game-assets.ts` 中新增 `ImageCache` 层：

```typescript
// 概念伪码 — 载入后 bake 到标准逻辑尺寸
const BAKE_SIZES: Record<string, [number, number]> = {
  'factory-plate':       [160, 160],
  'tile-first-player':   [48, 48],
  'arrow_right_icon':    [24, 18],
  'main_board_bg':       [900, 650],
  'score_box_bg':        [160, 60],
  'pattern_slot_empty':  [70, 70],
  'wall_grid_outline':   [400, 400],
};

async function bakeAsset(src: string, w: number, h: number): Promise<string> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/png');
  // 或用 canvas.toBlob() → URL.createObjectURL() 更省内存
}
```

**效果**：
- `factory-plate` 从 2048² 降到 160²，内存占用降低 **163 倍**
- `tile-first-player` 从 917×768 降到 48²，内存降低 **245 倍**
- 后续所有布局计算只需 `logicalSize × boardScale`，无需再关心源图尺寸

**与当前管线兼容性**：完全兼容
- 当前已经是 `new URL(…).href` → `<img src=…>`
- 只需把 URL 替换为 bake 后的 blob URL 即可，渲染逻辑零改动

### 方案 C：直接替换源文件（最终方案）

将 `assets/source/` 中的超大图替换为设计尺寸的 @2x 版本：

| 文件 | 当前像素 | 目标像素(@2x) | 理由 |
|------|----------|--------------|------|
| `factory-plate.png` | 2048×2048 | **320×320** | 160 设计 ×2 retina |
| `tile-first-player.png` | 917×768 | **96×96** | 48 设计 ×2 retina |
| `arrow_right_icon.png` | 175×108 | **48×36** | 24×18 设计 ×2 retina |
| `main_board_bg.png` | 2106×1504 | **1800×1300** | 900×650 ×2 retina |
| 其他 | — | 保持不变 | 已接近目标 |

**优点**：从根源解决，无运行时开销
**缺点**：需要重新导出 / 重绘素材

---

## 推荐实施路径

```
Phase 1（立即）: 方案 C — 替换 factory-plate + tile-first-player
                   这两张占总资源体积 90%+，效果最明显

Phase 2（可选）: 方案 B — 对仍然不匹配的资源添加 bake 层
                   保证任何尺寸的源图都能正确显示

Phase 3（长期）: 所有新素材按 @2x 标准导出，不再出现「源图 2048 显示 48」的情况
```

---

## 当前 boardScale 架构（保持不变）

```
┌─────────────────────────────────────────────────┐
│  boardScaleForCell()                            │
│  scale = min(cellW/900, cellH/650, 0.58)       │
│                                                 │
│  所有元素的显示尺寸 = 逻辑设计尺寸 × scale      │
│  ├── 花砖: 48 × scale                          │
│  ├── 槽位: 70 × scale                          │
│  ├── 墙格: 80 × scale                          │
│  ├── 工厂: 160 × scale × 1.35(plate boost)     │
│  └── 背景: 900×650 × scale                     │
└─────────────────────────────────────────────────┘
```

这套架构本身没问题。问题仅在于源图尺寸和逻辑尺寸脱节，导致开发时
心智负担增加（"为什么 48px 的砖用了 917px 的图"）。规范化源图后，
`逻辑尺寸 ≈ 源图尺寸 / 2` 这个心智模型就清晰了。

---

## 附：未使用资源清理

| 文件 | 状态 | 建议 |
|------|------|------|
| `floor_slot_empty.png` (292×295) | 代码零引用 | 删除或归档 |
| `player-board.png` (560×400) | 仅 onerror fallback | 保留但标记为 fallback-only |

---

## 结论

> **图片缩放与节点缩放分离** 的核心答案：
>
> 当前管线已经将它们分开了（CSS 尺寸 vs boardScale），
> 真正的问题是**源图像素与设计逻辑尺寸差距过大**导致开发体验差。
>
> 最直接的修复是：把 `factory-plate`、`tile-first-player`、`arrow_right_icon`
> 三张图替换为 @2x 目标尺寸的版本。无需改任何代码逻辑。
