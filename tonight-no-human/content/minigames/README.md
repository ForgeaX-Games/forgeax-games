# 小游戏库素材根

每个子目录名 = `minigameId`（与 `src/minigame/library` 条目一致）。

```
m1_marigold_escort/   # 金盏花护送
m2_sugar_skull_sync/  # 糖颅彩绘对拍
…
```

建议子结构（按需建，不强制）：

```
<minigameId>/
  art/          # 场景拼贴、道具
  audio/        # 短 SFX / 循环
  level.json    # 可选：关卡参数表（impl 自行读取）
  NOTES.md      # 策划备注
```

代码侧入口见 `content/CONTENT.md` 与 `src/minigame/library/`。
