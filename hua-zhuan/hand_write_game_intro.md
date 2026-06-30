新生成一个桌游，花砖物语。规则是：一共有4名玩家，桌面上每个玩家有一个收集盘，收集盘左边是从上到下有着1-5格的五行格子，右边是五种花色的5x5固定排列。中间是9个盘子，围成一圈，每个盘子上有4个随机的小花砖，中间区域放一个+1砖。花砖一共有5种。游戏分为多轮，每轮有拿取阶段和计分阶段。
- 拿取阶段：玩家每轮从一名玩家开始，顺时针依次拿取花砖，直到所有花砖拿完，进入结算阶段，然后开启下一轮。拿取规则是：
1. 玩家一次性要拿走一个盘子上，或者盘子围起来的中间区域的所有相同花色的花砖。并且，要将这些花砖放到自己的收集盘的一行里，保证一行内只有这一种花色。可以填不满一行，溢出的放到下面的扣分区。取走收集盘
2. 如果拿的是盘子上的花砖，其余花砖放到中间区域。首个拿取中间区域中的花砖的玩家，要将+1砖放到自己的扣分区
3. 首轮开始拿取的玩家随机选出，后续轮从拿到+1砖的玩家选择出。极端情况没有任何人去拿中间区域，就随机选出
然后
- 计分阶段
1. 从上到下进行结算，有一行放满了一种颜色花砖，则将一个花砖推入右边的收集区域，对应花砖的位置，将其点亮
2. 单独点亮的花砖不会算分，只有横向/纵向连成>=2长度的，会分别加一次横向长度分，一次纵向长度分
3. 下面的扣分区，从左到右分别扣1，1，2，2，3，3，3......分。
4. 如果有玩家完成了收集区域一整行的点亮，即结束游戏，每人计算额外分：
    1. 一整行5个集齐，整体+2分
    2. 一整列5个集齐，整体+7分
    5. 表盘上相同颜色5个集齐，整体+10分
5. 放满的花砖行清空，未满的保留到下一轮
最后分高者获胜
附录
花砖的收集板，所有玩家都是一样的。给花砖标号后，5x5的收集板的分布是
1 2 3 4 5
5 1 2 3 4
4 5 1 2 3
3 4 5 1 2
2 3 4 5 1
序号没有实际意义，只是用作区分
以及：
为了防止卡关，以下几种情况玩家无法拿取某种颜色的砖
1. 所有行都是以下两种情况之一：行有其他砖占据；空行，但是右边对应这种颜色的砖已经被点亮了
玩家必须选另一种颜色拿取，除非只剩下这一种颜色，那就跳过，下一个玩家拿
首次生成，每个阶段都用文本记录流程，并需要玩家手动点击下一阶段


提示词 1：整体 UI 布局图
GAME UI LAYOUT — AZUL-STYLE BOARD GAME (花砖物语 / Hua Zhuan)
This is a TOP-DOWN OVERVIEW of a 4-player tile-drafting board game, showing the COMPLETE game state layout.
═══ COMPOSITION — WHAT GOES WHERE ═══
CENTER OF SCREEN:
- 9 CIRCULAR FACTORY DISPLAYS arranged in a ring/circle formation
- Each factory display is a small round plate holding exactly 4 colorful tiles
- In the CENTER of the ring: a shared discard area (the "center pool") with a special "+1" first-player marker tile
FOUR CORNERS / EDGES — ONE PLAYER BOARD EACH:
Each player board consists of THREE sections side by side:
LEFT SECTION — "Pattern Lines" (staging area):
  - 5 horizontal rows forming a STAIRCASE / PYRAMID shape
  - Row 1 (top): 1 square slot
  - Row 2: 2 square slots
  - Row 3: 3 square slots
  - Row 4: 4 square slots
  - Row 5 (bottom): 5 square slots
  - Slots fill RIGHT-TO-LEFT with same-color tiles
  - Some slots filled with colored tiles, some empty (showing the grid)
RIGHT SECTION — "Wall" (scoring grid):
  - A 5×5 grid of square slots
  - Each row has all 5 tile colors in a FIXED diagonal-shifted pattern:
    Row 1: Color1 Color2 Color3 Color4 Color5
    Row 2: Color5 Color1 Color2 Color3 Color4
    Row 3: Color4 Color5 Color1 Color2 Color3
    Row 4: Color3 Color4 Color5 Color1 Color2
    Row 5: Color2 Color3 Color4 Color5 Color1
  - Some slots are "lit up" (tile placed, full color), others are "dim" (empty, faded outline)
BOTTOM STRIP — "Floor Line" (penalty area):
  - A single horizontal row of 7+ small slots below the pattern lines
  - Labeled with penalty values: -1, -1, -2, -2, -3, -3, -3
  - May contain overflow tiles and the +1 first-player marker
SCORE DISPLAY:
  - Each player board has a score counter/number at the top
═══ TILE DESIGN ═══
5 distinct tile types, each with:
- A UNIQUE COLOR: vibrant blue, warm orange, deep red, pale cyan, dark navy/black
- A UNIQUE PATTERN/MOTIF: star, flower, diamond, swirl, cross
  (color + pattern together make each tile instantly distinguishable)
- Square shape with slightly rounded corners
- The "+1" first-player tile is a different shape or has a prominent "1" numeral
═══ VISUAL STYLE ═══
Clean modern board game illustration, flat design with subtle shadows.
Warm wooden table background texture visible around the boards.
Player boards have a light cream/parchment base color with thin dark borders.
Factory displays are ceramic-white circular plates with subtle rim shadow.
Tiles are glossy, saturated, with embossed pattern details.
The overall feeling should be: elegant Portuguese azulejo tile art meets modern flat UI.
═══ LAYOUT RULES ═══
- 4 player boards positioned at TOP-LEFT, TOP-RIGHT, BOTTOM-LEFT, BOTTOM-RIGHT
- Factory ring centered between all four player boards
- Each player board is clearly separated with ample spacing
- Player colors/names indicated by a colored banner or tab at the top of each board
═══ OUTPUT RULES ═══
1. Output size: 1024x1024 pixels (or 1536x1024 landscape)
2. Show the COMPLETE game state — all 4 player boards + factory ring + center pool visible
3. This is a BIRD'S-EYE / TOP-DOWN view of the entire table
4. NO perspective distortion — flat orthographic projection
5. NO text labels except score numbers and penalty numbers (-1, -2, -3)
6. NO 3D rendering — flat illustration with minimal shadow
7. NO hands, no people, no external objects — just the game components on the table
8. All tiles should be clearly distinguishable at this zoom level
9. The image should serve as a VISUAL REFERENCE for implementing this game's UI in code
提示词 2：花砖素材 Atlas（5 种花砖 + 1 先手砖）
GAME TILE ATLAS — AZUL BOARD GAME TILES
═══ GRID CONTRACT (ABSOLUTE) ═══
Output ONE image with EXACTLY 2 rows × 3 columns = 6 cells.
Each cell is 256x256 pixels. Total image: 768x512 pixels.
ZERO padding between cells, ZERO margin around the image.
CELL CONTENTS (row, col → item):
  (0,0) BLUE TILE — cerulean blue background, white STAR pattern embossed in center
  (0,1) ORANGE TILE — warm tangerine orange background, white FLOWER pattern embossed in center
  (0,2) RED TILE — deep crimson red background, white DIAMOND pattern embossed in center
  (1,0) CYAN TILE — pale turquoise cyan background, white SWIRL pattern embossed in center
  (1,1) DARK TILE — dark navy/charcoal background, white CROSS pattern embossed in center
  (1,2) FIRST PLAYER MARKER — white/cream tile with a large dark "1" numeral in the center, circular shape or octagonal, distinct from the 5 color tiles
═══ STYLE ═══
Portuguese azulejo-inspired tile art, clean vector illustration style.
Each tile is a square with slightly rounded corners (except the +1 marker which is circular/octagonal).
Tiles have a glossy ceramic appearance with subtle embossed/raised pattern detail.
Patterns are white motifs on colored backgrounds — high contrast, instantly distinguishable at small sizes.
Consistent top-left lighting at 45°, subtle drop shadow within each tile to convey depth.
═══ CRITICAL ═══
- TRANSPARENT background — every cell except the tile must be fully transparent.
- Each tile centered within its 256x256 cell, occupying ~70% of cell area (~180x180 pixels).
- All 5 color tiles share the SAME shape, size, corner radius, and shadow style — only color and pattern differ.
- The +1 marker must be visually DISTINCT in shape (round or octagonal) so it's never confused with a color tile.
- DO NOT add grid borders, frame numbers, text labels, or any UI chrome.
- NO items bleeding across cell boundaries.
- Patterns must be readable even when tiles are scaled down to 32x32 pixels.
提示词 3：玩家收集板底图
GAME UI — PLAYER BOARD BASE (AZUL COLLECTION BOARD)
A single player's collection board for an Azul-style tile game.
This is the BASE PLATE only — no tiles placed on it, just the empty board showing all slot positions.
═══ LAYOUT (LEFT TO RIGHT) ═══
LEFT SECTION — "Pattern Lines" (pyramid/staircase):
  5 horizontal rows, RIGHT-ALIGNED, forming a staircase shape:
  - Row 1 (top):    [ _ ]                           (1 empty square slot, right-aligned)
  - Row 2:          [ _ ][ _ ]                       (2 empty slots, right-aligned)
  - Row 3:          [ _ ][ _ ][ _ ]                  (3 empty slots, right-aligned)
  - Row 4:          [ _ ][ _ ][ _ ][ _ ]             (4 empty slots, right-aligned)
  - Row 5 (bottom): [ _ ][ _ ][ _ ][ _ ][ _ ]       (5 empty slots, right-aligned)
  Each slot is a rounded square with a subtle inset/depression to suggest "place tile here."
ARROW INDICATOR:
  Between the left section and right section, each row has a small RIGHT-POINTING ARROW (→)
  indicating that completed rows push a tile to the wall.
RIGHT SECTION — "Wall" (5×5 scoring grid):
  A 5×5 grid of square slots, each showing a FADED/GHOSTED tile color:
  Row 1: Blue(faded)  Orange(faded) Red(faded)  Cyan(faded)  Dark(faded)
  Row 2: Dark(faded)  Blue(faded)   Orange(faded) Red(faded) Cyan(faded)
  Row 3: Cyan(faded)  Dark(faded)   Blue(faded)  Orange(faded) Red(faded)
  Row 4: Red(faded)   Cyan(faded)   Dark(faded)  Blue(faded) Orange(faded)
  Row 5: Orange(faded) Red(faded)   Cyan(faded)  Dark(faded) Blue(faded)
  "Faded" means: the color is visible but at 20-30% opacity, as a placement guide.
BOTTOM STRIP — "Floor Line" (penalty row):
  A single horizontal row of 7 small square slots below everything.
  Each slot has a small number inside:
  Slot 1: "-1"  Slot 2: "-1"  Slot 3: "-2"  Slot 4: "-2"  Slot 5: "-3"  Slot 6: "-3"  Slot 7: "-3"
TOP — Score area:
  A rectangular banner at the top with "SCORE: 0" or just a number display area.
═══ VISUAL STYLE ═══
Clean, warm board game aesthetic. Light cream/parchment board with thin dark wood-colored border.
Slot depressions are slightly darker than the board surface.
The overall board has rounded corners and a subtle shadow to suggest it's sitting on a table.
Portuguese azulejo decorative border pattern around the edge (subtle, not overpowering).
═══ OUTPUT RULES ═══
1. Output size: 1024x768 pixels (landscape).
2. This is a FLAT TOP-DOWN view of ONE player's board — NO perspective.
3. TRANSPARENT background behind the board shape.
4. The board itself has the cream/parchment fill.
5. NO actual tiles placed — only empty slots and faded color guides on the wall.
6. Penalty numbers (-1, -2, -3) are the ONLY text allowed.
7. NO player name, NO decorative text, NO labels except the penalty numbers.
提示词 4：工厂盘
GAME UI — FACTORY DISPLAY PLATE (AZUL)
A single circular factory display plate for an Azul board game.
This is the EMPTY PLATE — no tiles on it.
═══ DESCRIPTION ═══
A round, shallow ceramic dish/plate viewed from directly above (top-down).
The plate has 4 subtle circular INDENTATIONS arranged in a 2×2 grid pattern,
evenly spaced within the plate. These indentations show where tiles are placed.
═══ VISUAL STYLE ═══
White/off-white ceramic with a subtle rim shadow.
The plate surface has a very faint ceramic glaze texture.
The 4 indentations are slightly darker circles (depressions) within the plate.
Clean, minimal design — like a real porcelain plate.
═══ OUTPUT RULES ═══
1. Output size: 512x512 pixels.
2. TRANSPARENT background — only the circular plate is visible.
3. Plate occupies ~80% of the canvas (centered).
4. FLAT TOP-DOWN orthographic view, NO perspective.
5. NO text, NO numbers, NO decorative patterns on the plate itself.
6. NO tiles on the plate — just the empty dish with 4 indentation marks.
总结
提示词	用途	尺寸	粘贴到生图服务使用
提示词 1
整体 UI 布局概念图 — 验证排版和视觉方向
1024×1024 或 1536×1024
直接粘贴
提示词 2
花砖 Atlas — 5 色砖 + 先手砖切片
768×512（2×3 网格，每格 256×256）
直接粘贴
提示词 3
玩家收集板底图 — 空板带槽位引导
1024×768
直接粘贴
提示词 4
工厂盘 — 空盘子
512×512
直接粘贴