#!/usr/bin/env bash
# 批量缩放图片资源到 @2x 设计尺寸
# 用法: bash scripts/resize-assets.sh
#       bash scripts/resize-assets.sh --dry-run   (仅打印，不执行)
#       bash scripts/resize-assets.sh --restore   (从 backup 恢复原图)

set -euo pipefail

ASSET_DIR="$(cd "$(dirname "$0")/../assets/source" && pwd)"
BACKUP_DIR="$(cd "$(dirname "$0")/.." && pwd)/assets/source_backup"

# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 缩放目标表：文件名 → 目标宽x目标高 (@2x retina)
# 设计尺寸 ×2 = 输出像素，保证 retina 屏清晰
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
declare -A TARGETS=(
  ["factory-plate.png"]="320x320"
  ["tile-first-player.png"]="96x96"
  ["arrow_right_icon.png"]="48x36"
  ["main_board_bg.png"]="1800x1300"
  ["wall_grid_outline.png"]="800x800"
  ["score_box_bg.png"]="320x120"
  ["pattern_slot_empty.png"]="140x140"
  ["floor_slot_empty.png"]="100x100"
)

DRY_RUN=false
RESTORE=false

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --restore) RESTORE=true ;;
  esac
done

# ── 恢复模式 ──
if [ "$RESTORE" = true ]; then
  if [ ! -d "$BACKUP_DIR" ]; then
    echo "❌ 备份目录不存在: $BACKUP_DIR"
    exit 1
  fi
  echo "🔄 从 source_backup/ 恢复原始图片..."
  cp -v "$BACKUP_DIR"/*.png "$ASSET_DIR"/
  echo "✅ 恢复完成"
  exit 0
fi

# ── 缩放模式 ──
echo "📐 图片资源缩放脚本"
echo "   源目录: $ASSET_DIR"
echo "   备份到: $BACKUP_DIR"
echo ""

# 备份
if [ ! -d "$BACKUP_DIR" ]; then
  mkdir -p "$BACKUP_DIR"
  echo "📦 首次运行，备份原始文件..."
  for file in "${!TARGETS[@]}"; do
    src="$ASSET_DIR/$file"
    if [ -f "$src" ]; then
      cp "$src" "$BACKUP_DIR/$file"
    fi
  done
  echo ""
fi

# 执行缩放
for file in "${!TARGETS[@]}"; do
  src="$ASSET_DIR/$file"
  size="${TARGETS[$file]}"
  w="${size%x*}"
  h="${size#*x}"

  if [ ! -f "$src" ]; then
    echo "⚠️  跳过(文件不存在): $file"
    continue
  fi

  # 获取当前尺寸
  current=$(ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height \
    -of csv=p=0:s=x "$src" 2>/dev/null || echo "?x?")

  if [ "$current" = "${w}x${h}" ]; then
    echo "✓  已是目标尺寸: $file ($current)"
    continue
  fi

  echo "🔧 $file: $current → ${w}x${h}"

  if [ "$DRY_RUN" = true ]; then
    continue
  fi

  tmp="$ASSET_DIR/.tmp_${file}"
  ffmpeg -y -i "$src" \
    -vf "scale=${w}:${h}:flags=lanczos" \
    -pred mixed -compression_level 9 \
    "$tmp" 2>/dev/null
  mv "$tmp" "$src"
done

echo ""
echo "✅ 完成！"
echo ""
echo "验证尺寸:"
for file in "${!TARGETS[@]}"; do
  src="$ASSET_DIR/$file"
  if [ -f "$src" ]; then
    actual=$(ffprobe -v error -select_streams v:0 \
      -show_entries stream=width,height \
      -of csv=p=0:s=x "$src" 2>/dev/null || echo "?")
    target="${TARGETS[$file]}"
    if [ "$actual" = "$target" ]; then
      echo "  ✓ $file: $actual"
    else
      echo "  ✗ $file: $actual (期望 $target)"
    fi
  fi
done
