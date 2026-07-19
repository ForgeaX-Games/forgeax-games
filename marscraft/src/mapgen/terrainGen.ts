/**
 * 地图生成 — 地形生成器 (SC2 分层架构，7-Pass)
 *
 * 生成流程：
 *   Pass 1. Cliff Level Map — 从 heightGrid（首选）或平台/圆区/基础层级推导每格 cliff level
 *   Pass 2. Mark Special   — 标记坡道、石柱、遗留墙壁、地图边缘格子
 *   Pass 3. Cliff Edge Detection — 相邻格子 cliff level 不同 → 悬崖边缘
 *                                  ★ 坡道格子 (isRamp=1) 不参与悬崖边缘检测
 *                                  ★ 邻居是坡道格子时也跳过，避免悬崖在坡道区域产生
 *   Pass 4. Pathing Grid   — cliff edge + 石柱 + 边界 → 阻挡；缓冲膨胀时保护坡道格子
 *   Pass 5. Carve Ramps    — 在 pathWidth 范围内强制开放通行
 *   Pass 6. Cliff Edges    — 生成悬崖线段（用于 3D 墙壁）
 *   Pass 7. Height Data    — 视觉高度（cliff level × cliffVisH + 坡道插值 + 噪声）
 *   Pass 8. Terrain Types  — 纯视觉纹理分类
 *
 * 优先级（从高到低）：
 *   1. heightGrid（预计算，来自 VoronoiRasterizer，保留对角化边界）
 *   2. 边界山脉（pathing blocked + visual cliff）
 *   3. 坡道（pathing open + ramp visual + height interpolation）
 *   4. 石柱（pathing blocked + visual cliff）
 *   5. 旧版 cliffWalls（pathing blocked + visual cliff，向后兼容）
 *   6. 高地平台（cliff level + visual）
 *   7. 圆形区域（cliff level + visual）
 *   8. 自动悬崖边缘（cliff level 差异 → pathing blocked + visual cliff）
 *   9. 手动 unpathable 区域（pathing blocked only）
 *   10. 默认低地 + 微弱噪声
 */

import { dist, segDist, inRect, orientedRectTest } from './geometry'
import { TerrainType } from './types'
import type { MapBlueprint, CliffEdge, DecorationDef, TrenchDef, BorderZone } from './types'
import { getZoneAt, getZoneDecoConfig } from './procedural/ZoneClassifier'
import type { ZoneGrid, ZoneInfo, ZoneType } from './procedural/ZoneClassifier'

/** 每个 cliff level 的默认视觉高度差（世界单位） */
const DEFAULT_CLIFF_VISUAL_HEIGHT = 2.0

export interface TerrainResult {
  heightData: number[]
  terrainTypes: TerrainType[]
  cliffLevels: number[]
  pathingGrid: Uint8Array
  cliffEdges: CliffEdge[]
  decorations: DecorationDef[]
  /** 沟壑深度网格（0=无，1-3=深度），供 Terrain.ts 渲染覆盖层 */
  trenchGrid: Int8Array
  /** 边界网格（0=非边界，1=边界），供通行判断与过滤使用 */
  borderGrid: Uint8Array
  /** 地图边界山脉起始距离 */
  edgeDist: number
}

export function generateTerrain(bp: MapBlueprint): TerrainResult {
  const R = bp.resolution
  const W = bp.width
  const H = bp.height
  const edgeDist = bp.edgeDist ?? 56
  const noiseAmp = bp.noiseAmplitude ?? 0.04
  const cliffVisH = bp.cliffVisualHeight ?? DEFAULT_CLIFF_VISUAL_HEIGHT
  const baseCL = bp.baseCliffLevel ?? 0

  const total = R * R
  const cliffLevels = new Array<number>(total)
  const heightData = new Array<number>(total)
  const terrainTypes = new Array<TerrainType>(total)
  const pathingGrid = new Uint8Array(total) // 0 = walkable, 1 = blocked
  const isRamp = new Uint8Array(total)      // 1 = ramp area (full visual width)
  const isEdge = new Uint8Array(total)      // 1 = edge/mountain
  const isPillar = new Uint8Array(total)    // 1 = pillar
  const isLegacyWall = new Uint8Array(total) // 1 = legacy cliffWall
  // 沟壑（Trench）数组
  const isTrench = new Uint8Array(total)      // 1 = trench cell
  const trenchGrid = new Int8Array(total)     // 0=无, 1-3=深度（输出）
  const trenchTypeGrid = new Int8Array(total) // 0=lava, 1=water, 2=void
  // 边界（Border）数组
  const isBorder = new Uint8Array(total)      // 1 = border cell
  const borderGrid = new Uint8Array(total)    // 0=非边界, 1=边界（输出）

  // ================================================================
  // Pass 1: Cliff Level Map
  // ================================================================

  // ── 1a: 基础层级填充 ──
  cliffLevels.fill(baseCL)

  // ── 1b: 若提供预计算 heightGrid（来自 VoronoiRasterizer），直接采样基底 ──
  // 这是首选路径，可保留边界对角化产生的 45° 分界线。
  const hg = bp.heightGrid
  const hgRes = bp.heightGridRes ?? 0

  if (hg && hgRes > 0) {
  for (let row = 0; row < R; row++) {
    for (let col = 0; col < R; col++) {
        // 最近邻采样（整数映射）
        const gCol = Math.min(hgRes - 1, Math.floor(col * hgRes / R))
        const gRow = Math.min(hgRes - 1, Math.floor(row * hgRes / R))
        cliffLevels[row * R + col] = hg[gRow * hgRes + gCol]
      }
    }
  }

  // ── 1c: 叠加 platforms / circles 的高度修改（无论有无 heightGrid 都执行）──
  // 让玩家用笔刷画出的结构能覆盖在程序化生成的基底之上。
  // 同时预光栅化地形纹理（circles, platforms, ramps）以供后续 O(1) 采样，极大优化性能
  const explicitCircleTerrainMap = new Int8Array(total).fill(-1)
  const baseCircleTerrainMap = new Int8Array(total).fill(-1)
  const rampTerrainMap = new Int8Array(total).fill(-1)
  const cellW = W / (R - 1)
  const cellH = H / (R - 1)

  for (const c of bp.circles) {
    const hasHeight = c.cliffLevel !== undefined || c.height !== undefined
    const hasTerrain = c.terrain !== undefined
    if (!hasHeight && !hasTerrain) continue
    
    // 只在包围盒内遍历，取代全图遍历，性能提升百倍
    const minCol = Math.max(0, Math.floor((c.x - c.r + W / 2) / cellW))
    const maxCol = Math.min(R - 1, Math.ceil((c.x + c.r + W / 2) / cellW))
    const minRow = Math.max(0, Math.floor((c.z - c.r + H / 2) / cellH))
    const maxRow = Math.min(R - 1, Math.ceil((c.z + c.r + H / 2) / cellH))
    
    const rSq = c.r * c.r
    const isSquare = c.shape === 'square'
    const cl = hasHeight ? (c.cliffLevel ?? _heightToCliffLevel(c.height!, cliffVisH)) : 0
    const t = hasTerrain ? c.terrain! : -1
    
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const wx = col * cellW - W / 2
        const wz = row * cellH - H / 2
        let hit = false
        if (isSquare) {
          hit = Math.abs(wx - c.x) <= c.r && Math.abs(wz - c.z) <= c.r
        } else {
          const dx = wx - c.x
          const dz = wz - c.z
          hit = dx * dx + dz * dz <= rSq
        }
        if (hit) {
      const idx = row * R + col
          if (hasHeight) cliffLevels[idx] = cl
          if (hasTerrain) {
            explicitCircleTerrainMap[idx] = t
            baseCircleTerrainMap[idx] = t
          }
        }
      }
    }
  }

  // platforms 后应用（优先级高，可覆盖 circles）
  for (const pl of bp.platforms) {
    const minCol = Math.max(0, Math.floor((pl.x1 + W / 2) / cellW))
    const maxCol = Math.min(R - 1, Math.ceil((pl.x2 + W / 2) / cellW))
    const minRow = Math.max(0, Math.floor((pl.z1 + H / 2) / cellH))
    const maxRow = Math.min(R - 1, Math.ceil((pl.z2 + H / 2) / cellH))
    
    const cl = pl.cliffLevel ?? _heightToCliffLevel(pl.height, cliffVisH)
    const t = pl.terrain ?? -1
    
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const idx = row * R + col
        cliffLevels[idx] = cl
        if (t !== -1) {
          baseCircleTerrainMap[idx] = t
        }
      }
    }
  }

  // ramps 纹理光栅化
  for (const rm of bp.ramps) {
    const minX = Math.min(rm.ax, rm.bx) - rm.width
    const maxX = Math.max(rm.ax, rm.bx) + rm.width
    const minZ = Math.min(rm.az, rm.bz) - rm.width
    const maxZ = Math.max(rm.az, rm.bz) + rm.width

    const minCol = Math.max(0, Math.floor((minX + W / 2) / cellW))
    const maxCol = Math.min(R - 1, Math.ceil((maxX + W / 2) / cellW))
    const minRow = Math.max(0, Math.floor((minZ + H / 2) / cellH))
    const maxRow = Math.min(R - 1, Math.ceil((maxZ + H / 2) / cellH))

    // ── 决定整条坡道统一使用的纹理 ──
    let t: number
    if (rm.terrain !== undefined) {
      // 编辑器显式指定：直接用
      t = rm.terrain
    } else {
      // 程序化生成：取高端附近地形，整条坡道保持一致
      // 1. 确定哪一端 cliffLevel 更高
      const acol = Math.min(R - 1, Math.max(0, Math.round((rm.ax + W / 2) / cellW)))
      const arow = Math.min(R - 1, Math.max(0, Math.round((rm.az + H / 2) / cellH)))
      const bcol = Math.min(R - 1, Math.max(0, Math.round((rm.bx + W / 2) / cellW)))
      const brow = Math.min(R - 1, Math.max(0, Math.round((rm.bz + H / 2) / cellH)))
      const clA = cliffLevels[arow * R + acol]
      const clB = cliffLevels[brow * R + bcol]
      const [hcol, hrow] = clA >= clB ? [acol, arow] : [bcol, brow]

      // 2. 在高端 3×3 邻域内找 cliffLevel 最高的非坡道格，采样其地形
      let highT = -1, highCL = -999
      for (let dr = -3; dr <= 3; dr++) {
        for (let dc = -3; dc <= 3; dc++) {
          const nr = hrow + dr, nc = hcol + dc
          if (nr < 0 || nr >= R || nc < 0 || nc >= R) continue
          if (isRamp[nr * R + nc]) continue
          const nCL = cliffLevels[nr * R + nc]
          if (nCL > highCL) {
            highCL = nCL
            const nT = baseCircleTerrainMap[nr * R + nc]
            highT = nT !== -1 ? nT : (nCL > 0 ? TerrainType.Rock : TerrainType.Regolith)
          }
        }
      }
      t = highT >= 0 ? highT : (Math.max(clA, clB) > 0 ? TerrainType.Rock : TerrainType.Regolith)
    }

    // ── 将统一纹理写入整条坡道的 rampTerrainMap ──
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const wx = col * cellW - W / 2
        const wz = row * cellH - H / 2
        if (orientedRectTest(wx, wz, rm.ax, rm.az, rm.bx, rm.bz, rm.width).inside) {
          rampTerrainMap[row * R + col] = t
        }
      }
    }
  }

  // ── 1d: 沟壑（Trench）光栅化 ──
  // 优先级高于 platforms/circles（沟壑可以"挖穿"任意高地），
  // 将对应格子的 cliffLevel 设为 baseCL - depth（负值），
  // 并记录深度/类型供后续 Pass 使用。
  for (const tr of (bp.trenches ?? [])) {
    const r = tr.r
    const minCol = Math.max(0, Math.floor((tr.x - r + W / 2) / cellW))
    const maxCol = Math.min(R - 1, Math.ceil((tr.x + r + W / 2) / cellW))
    const minRow = Math.max(0, Math.floor((tr.z - r + H / 2) / cellH))
    const maxRow = Math.min(R - 1, Math.ceil((tr.z + r + H / 2) / cellH))
    const rSq = r * r
    const isSquare = tr.shape === 'square'
    const typeCode: number = tr.type === 'void' ? 2 : tr.type === 'water' ? 1 : 0
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const wx = col * cellW - W / 2
        const wz = row * cellH - H / 2
        const hit = isSquare
          ? Math.abs(wx - tr.x) <= r && Math.abs(wz - tr.z) <= r
          : (wx - tr.x) ** 2 + (wz - tr.z) ** 2 <= rSq
        if (!hit) continue
        const idx = row * R + col
        isTrench[idx] = 1
        trenchGrid[idx] = tr.depth
        trenchTypeGrid[idx] = typeCode
        cliffLevels[idx] = baseCL - tr.depth  // B: 负 cliff level
      }
    }
  }

  // ── 1e: 边界（Border）光栅化 ──
  // 边界是附加标记层，不修改任何地形数据（cliffLevel / terrainType / heightData 均不变）。
  // 只标记 borderGrid = 1，供后续 Pass 5c 设置 pathingGrid，供 Terrain.ts 叠加黑色遮罩。
  for (const br of (bp.borders ?? [])) {
    const r = br.r
    const minCol = Math.max(0, Math.floor((br.x - r + W / 2) / cellW))
    const maxCol = Math.min(R - 1, Math.ceil((br.x + r + W / 2) / cellW))
    const minRow = Math.max(0, Math.floor((br.z - r + H / 2) / cellH))
    const maxRow = Math.min(R - 1, Math.ceil((br.z + r + H / 2) / cellH))
    const rSq = r * r
    const isSquare = br.shape === 'square'
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        const wx = col * cellW - W / 2
        const wz = row * cellH - H / 2
        const hit = isSquare
          ? Math.abs(wx - br.x) <= r && Math.abs(wz - br.z) <= r
          : (wx - br.x) ** 2 + (wz - br.z) ** 2 <= rSq
        if (!hit) continue
        const idx = row * R + col
        isBorder[idx] = 1
        borderGrid[idx] = 1
      }
    }
  }

  // ================================================================
  // Pass 2: Mark ramps, pillars, legacy walls, edge mountains
  // ================================================================
  // ★ 使用 orientedRectTest 检测坡道，得到精确的有向矩形区域，
  //    同时获取插值参数 t，用于后续高度计算。

  for (let row = 0; row < R; row++) {
    for (let col = 0; col < R; col++) {
      const idx = row * R + col
      const wx = (col / (R - 1)) * W - W / 2
      const wz = (row / (R - 1)) * H - H / 2

      // 边界山脉（优先级最高，直接 continue）
      const edge = Math.max(Math.abs(wx), Math.abs(wz))
      if (edge > edgeDist) {
        isEdge[idx] = 1
        continue
      }

      // 旧版悬崖墙壁
        for (const cl of bp.cliffWalls) {
          if (segDist(wx, wz, cl.ax, cl.az, cl.bx, cl.bz).d < cl.width) {
          isLegacyWall[idx] = 1
            break
        }
      }

      // 石柱 (已废弃，直接忽略)
      // for (const p of bp.pillars || []) {
      //   if (dist(wx, wz, p.x, p.z) < p.r) {
      //     isPillar[idx] = 1
      //     break
      //   }
      // }

      // ★ 坡道 — 用 orientedRectTest 检测完整视觉宽度
      for (const rm of bp.ramps) {
        if (orientedRectTest(wx, wz, rm.ax, rm.az, rm.bx, rm.bz, rm.width).inside) {
          isRamp[idx] = 1
          break
        }
      }
    }
  }

  // ================================================================
  // Pass 3: Auto-detect cliff edges
  // ================================================================
  // ★ 关键规则（来自 alg_starcraft_terrain）：
  //   - isRamp[idx] === 1 → 跳过，坡道格子永远不产生悬崖边缘
  //   - isRamp[nIdx] === 1 → 跳过邻居是坡道的情况，防止坡道周围产生碎片墙壁
  //
  // 这两条规则是当前实现曾经缺失的，会导致坡道内出现暗色墙块。

  const isCliffEdgeCell = new Uint8Array(total)

  for (let row = 0; row < R; row++) {
    for (let col = 0; col < R; col++) {
      const idx = row * R + col
      // 已硬阻挡 → 跳过
      if (isEdge[idx] || isPillar[idx] || isLegacyWall[idx]) continue
      // ★ 坡道格子自身不作悬崖边缘检测
      if (isRamp[idx]) continue

      const cl = cliffLevels[idx]
      const dirs: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]]
      for (const [dr, dc] of dirs) {
        const nr = row + dr
        const nc = col + dc
        if (nr < 0 || nr >= R || nc < 0 || nc >= R) continue
        const nIdx = nr * R + nc
        // ★ 邻居是坡道格子 → 跳过（不在坡道边缘产生悬崖）
        if (isRamp[nIdx]) continue
        if (cliffLevels[nIdx] !== cl) {
          isCliffEdgeCell[idx] = 1
            break
        }
      }
    }
  }

  // ================================================================
  // Pass 4: Build pathing grid
  // ================================================================

  for (let i = 0; i < total; i++) {
    if (isEdge[i] || isPillar[i] || isLegacyWall[i] || isCliffEdgeCell[i]) {
      pathingGrid[i] = 1
    }
  }

  // 手动不可通行区域（rects + circles + decorations）
  const isManualUnpathable = new Uint8Array(total)

  if (bp.unpathableRects) {
    for (let row = 0; row < R; row++) {
      for (let col = 0; col < R; col++) {
        const wx = (col / (R - 1)) * W - W / 2
        const wz = (row / (R - 1)) * H - H / 2
        for (const rect of bp.unpathableRects) {
          if (inRect(wx, wz, rect.x1, rect.z1, rect.x2, rect.z2)) {
            const idx = row * R + col
            pathingGrid[idx] = 1
            isManualUnpathable[idx] = 1
            break
          }
        }
      }
    }
  }

  if (bp.unpathableCircles) {
    for (let row = 0; row < R; row++) {
      for (let col = 0; col < R; col++) {
        const wx = (col / (R - 1)) * W - W / 2
        const wz = (row / (R - 1)) * H - H / 2
        for (const circ of bp.unpathableCircles) {
          if (dist(wx, wz, circ.x, circ.z) < circ.r) {
            const idx = row * R + col
            pathingGrid[idx] = 1
            isManualUnpathable[idx] = 1
            break
          }
        }
      }
    }
  }

  // Pass 4a: 缓冲膨胀 — 在阻挡格子周围扩 1 格（装饰物在膨胀之后再标记，不参与膨胀）
  // ★ 关键：绝对不能膨胀进坡道格子 (isRamp=1)
  const bufferedPathing = new Uint8Array(total)
  for (let row = 0; row < R; row++) {
    for (let col = 0; col < R; col++) {
      const idx = row * R + col
      if (pathingGrid[idx]) {
        bufferedPathing[idx] = 1
        continue
      }
      // ★ 坡道格子不参与缓冲膨胀（保护坡道不被旁边的悬崖边缘吃掉）
      if (isRamp[idx]) continue

      // 检查 8 连通邻居是否有阻挡格子
      outer: for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue
          const nr = row + dr, nc = col + dc
          if (nr >= 0 && nr < R && nc >= 0 && nc < R) {
            if (pathingGrid[nr * R + nc]) {
              bufferedPathing[idx] = 1
              break outer
            }
          }
        }
      }
    }
  }
  for (let i = 0; i < total; i++) pathingGrid[i] = bufferedPathing[i]

  // 装饰物阻挡（在膨胀之后标记，装饰物不参与缓冲膨胀）
  if (bp.decorations) {
    for (let row = 0; row < R; row++) {
      for (let col = 0; col < R; col++) {
        const idx = row * R + col
        if (pathingGrid[idx]) continue
        const wx = (col / (R - 1)) * W - W / 2
        const wz = (row / (R - 1)) * H - H / 2
        for (const deco of bp.decorations) {
          if (deco.blocksPathing && dist(wx, wz, deco.x, deco.z) <= deco.r) {
            pathingGrid[idx] = 1
            break
          }
        }
      }
    }
  }

  // ================================================================
  // Pass 5: Carve ramp corridors — 在 pathWidth 范围内强制开放通行
  // ================================================================
  // 用 orientedRectTest 检测，只在 pathWidth 半宽内开放
  for (let row = 0; row < R; row++) {
    for (let col = 0; col < R; col++) {
      const idx = row * R + col
      if (!pathingGrid[idx]) continue // 已通行，跳过
      const wx = (col / (R - 1)) * W - W / 2
      const wz = (row / (R - 1)) * H - H / 2
      for (const rm of bp.ramps) {
        const pw = rm.pathWidth ?? Math.min(rm.width * 0.5, 3.0)
        if (orientedRectTest(wx, wz, rm.ax, rm.az, rm.bx, rm.bz, pw).inside) {
          pathingGrid[idx] = 0 // 强制开放
          break
        }
      }
    }
  }

  // ================================================================
  // Pass 5b: Force trench blocking — 沟壑永远不可通行（坡道不能覆盖沟壑）
  // ================================================================
  for (let i = 0; i < total; i++) {
    if (isTrench[i]) pathingGrid[i] = 1
  }

  // ================================================================
  // Pass 5c: Force border blocking — 边界完全不可通行（包括飞行单位）
  // ================================================================
  for (let i = 0; i < total; i++) {
    if (isBorder[i]) pathingGrid[i] = 1
  }

  // ================================================================
  // Pass 6: Generate cliff edge segments for 3D rendering
  // ================================================================

  const cliffEdges = _buildCliffEdges(bp, R, W, H, cliffLevels, isRamp, isEdge)

  // ================================================================
  // Pass 7: Height data (visual)
  // ================================================================

  for (let row = 0; row < R; row++) {
    for (let col = 0; col < R; col++) {
      const idx = row * R + col
      const wx = (col / (R - 1)) * W - W / 2
      const wz = (row / (R - 1)) * H - H / 2

      let h: number

      if (isEdge[idx]) {
        // 边界：平坦地面，不再生成山脉视觉，依靠装饰物过渡
        h = cliffLevels[idx] * cliffVisH
      } else if (isLegacyWall[idx]) {
        h = _nearestPlatformHeight(bp, wx, wz) + 2
      } else if (isPillar[idx]) {
        h = 5
      } else if (isRamp[idx]) {
        // ★ 坡道：用 orientedRectTest.t 做精确高度插值
        h = _getRampHeightOBB(bp, wx, wz)
      } else if (isManualUnpathable[idx]) {
        // 手动不可通行区域：略低于地面 + 粗糙噪声，形成陨石坑视觉
        h = cliffLevels[idx] * cliffVisH - 0.15
        h += (Math.sin(wx * 1.7 + wz * 0.8) * Math.cos(wz * 2.3 + wx * 0.6)) * 0.12
      } else {
        h = cliffLevels[idx] * cliffVisH
      }

      // 非特殊格子添加微弱表面噪声
      if (!isEdge[idx] && !isLegacyWall[idx] && !isPillar[idx] && !isRamp[idx] && !isManualUnpathable[idx]) {
        h += Math.sin(wx * 0.27) * Math.cos(wz * 0.21) * noiseAmp
      }

      // 允许负高度（负 CL 值 = 凹陷地形/深坑），不再钳制到 0
      heightData[idx] = h
    }
  }

  // ================================================================
  // Pass 8: Terrain types (visual)
  // ================================================================

  for (let row = 0; row < R; row++) {
    for (let col = 0; col < R; col++) {
      const idx = row * R + col
      const wx = (col / (R - 1)) * W - W / 2
      const wz = (row / (R - 1)) * H - H / 2

      // 沟壑：最高优先级，覆盖所有其他类型判断（边界不修改地形类型，在 Terrain.ts 里叠加遮罩）
      if (isTrench[idx]) {
        const tc = trenchTypeGrid[idx]
        terrainTypes[idx] = tc === 2 ? TerrainType.Void : tc === 1 ? TerrainType.Water : TerrainType.Lava
      } else if (isEdge[idx] || isLegacyWall[idx] || isPillar[idx] || isCliffEdgeCell[idx]) {
        terrainTypes[idx] = TerrainType.Cliff
      } else if (isRamp[idx]) {
        // 坡道格纹理优先级：
        //  1. 地形笔刷显式覆盖（explicitCircleTerrainMap）
        //  2. rampTerrainMap（光栅化时已统一写入高端纹理，或编辑器指定）
        //  3. 最终 fallback
        const expT = explicitCircleTerrainMap[idx]
        const rampT = rampTerrainMap[idx]
        if (expT !== -1) {
          terrainTypes[idx] = expT
        } else if (rampT !== -1) {
          terrainTypes[idx] = rampT
        } else {
          terrainTypes[idx] = cliffLevels[idx] > 0 ? TerrainType.Rock : TerrainType.Regolith
        }
      } else if (isManualUnpathable[idx]) {
        terrainTypes[idx] = TerrainType.Crater
      } else {
        const baseT = baseCircleTerrainMap[idx] !== -1 ? baseCircleTerrainMap[idx] : (cliffLevels[idx] > 0 ? TerrainType.Rock : TerrainType.Regolith)
        terrainTypes[idx] = baseT
      }
    }
  }

  const bpDecos = bp.decorations || []
  const removedSet = new Set<string>(bp.removedDecoIds ?? [])

  // V2 管线已提供装饰物位置时（基于区域/道路/骨架），直接使用，不再自动生成
  let autoDecos: DecorationDef[]
  if (bpDecos.length > 0) {
    autoDecos = []
  } else {
    const bpAny = bp as any
    const hasZoneData = bpAny._zoneGrid && bpAny._zones
    autoDecos = hasZoneData
      ? _zoneAwareDecorations(
          R, W, H, cliffLevels, pathingGrid, bp, bpDecos, trenchGrid, borderGrid,
          bpAny._zoneGrid as ZoneGrid, bpAny._zoneGridRes as number, bpAny._zones as ZoneInfo[],
          bpAny._advancedConfig ?? {},
        ).filter(d => !removedSet.has(d.id))
      : _autoEdgeDecorations(R, W, H, cliffLevels, pathingGrid, bp, bpDecos, trenchGrid, borderGrid)
          .filter(d => !removedSet.has(d.id))
  }

  return { 
    heightData, 
    terrainTypes, 
    cliffLevels, 
    pathingGrid, 
    cliffEdges,
    decorations: [...bpDecos, ...autoDecos],
    trenchGrid,
    borderGrid,
    edgeDist,
  }
}

// ── 与编辑器 getDecoSpacing 保持一致的默认半径 ──
// 自动生成的装饰物必须使用与编辑器手放相同的 baseR，不能随意缩放
const DECO_BASE_R: Record<string, number> = {
  plant:     0.8,
  rock:      1.2,
  machinery: 1.5,
  crystal:   1.2,
  ruins:     1.0,
  barricade: 1.2,
}
function decoBaseR(type: string): number { return DECO_BASE_R[type] ?? 1.0 }

// ================================================================
// Auto edge-decoration generator
// ================================================================

/**
 * 沿悬崖边缘自动散布装饰物：
 *   - 岩石 (rock): 悬崖低侧，形成自然基底堆叠
 *   - 晶体 (crystal): 悬崖高侧 CL≥2 边缘，稀疏点缀
 *   - 植物 (plant): CL0 可通行区域靠近悬崖，形成植被带
 *
 * 使用确定性 sin 哈希（不依赖 Math.random），相同地图每次生成相同装饰。
 * 用占用格网防止装饰物重叠，并对资源点留出安全间距。
 */
function _autoEdgeDecorations(
  R: number, W: number, H: number,
  cliffLevels: number[],
  pathingGrid: Uint8Array,
  bp: MapBlueprint,
  bpDecos: DecorationDef[],
  trenchGrid: Int8Array,
  borderGrid: Uint8Array,
): DecorationDef[] {
  const decos: DecorationDef[] = []
  const STEP = 2          // 每 2 格采样一次（更密，让崖脚岩石形成连线）
  const CELL = 1.5        // 占用格网格大小缩小，允许石头互相贴近
  const RESOURCE_SAFE = 9.0  // 资源点安全距离

  // ── 收集需要避让的资源点 ──
  const rpts: Array<{ x: number; z: number }> = []
  if (bp.spawnPoints) for (const s of bp.spawnPoints) rpts.push({ x: s.x, z: s.z })
  if (bp.bases) {
    for (const b of bp.bases) {
      rpts.push({ x: b.ccX, z: b.ccZ })
      rpts.push({ x: b.mineralArcX, z: b.mineralArcZ })
      for (const g of b.geysers) rpts.push({ x: g.x, z: g.z })
    }
  }

  // ── 沟壑禁区：直接查光栅化后的 trenchGrid，精确到格子 ──
  // 额外扩展 1 格缓冲，避免装饰物贴着沟壑边缘放置
  function inTrench(x: number, z: number): boolean {
    const EXPAND = 1   // 缓冲格数
    const c0 = Math.round((x / W + 0.5) * (R - 1))
    const r0 = Math.round((z / H + 0.5) * (R - 1))
    for (let dr = -EXPAND; dr <= EXPAND; dr++) {
      for (let dc = -EXPAND; dc <= EXPAND; dc++) {
        const nr = r0 + dr, nc = c0 + dc
        if (nr < 0 || nr >= R || nc < 0 || nc >= R) continue
        if (trenchGrid[nr * R + nc] > 0) return true
      }
    }
    return false
  }

  // ── 边界禁区：直接查光栅化后的 borderGrid，精确到格子 ──
  function inBorder(x: number, z: number): boolean {
    const EXPAND = 1
    const c0 = Math.round((x / W + 0.5) * (R - 1))
    const r0 = Math.round((z / H + 0.5) * (R - 1))
    for (let dr = -EXPAND; dr <= EXPAND; dr++) {
      for (let dc = -EXPAND; dc <= EXPAND; dc++) {
        const nr = r0 + dr, nc = c0 + dc
        if (nr < 0 || nr >= R || nc < 0 || nc >= R) continue
        if (borderGrid[nr * R + nc] > 0) return true
      }
    }
    return false
  }

  // ── 坡道禁区（坡道走廊 + 额外缓冲，保证通道畅通） ──
  type RampZone = { ax: number; az: number; bx: number; bz: number; halfW: number }
  const rampZones: RampZone[] = []
  if (bp.ramps) {
    for (const r of bp.ramps) {
      rampZones.push({ ax: r.ax, az: r.az, bx: r.bx, bz: r.bz, halfW: r.width + 5.0 })
    }
  }

  function nearRamp(x: number, z: number): boolean {
    for (const rz of rampZones) {
      const ddx = rz.bx - rz.ax, ddz = rz.bz - rz.az
      const len2 = ddx * ddx + ddz * ddz
      let dist: number
      if (len2 < 0.001) {
        dist = Math.hypot(x - rz.ax, z - rz.az)
      } else {
        const t = Math.max(0, Math.min(1, ((x - rz.ax) * ddx + (z - rz.az) * ddz) / len2))
        dist = Math.hypot(x - (rz.ax + t * ddx), z - (rz.az + t * ddz))
      }
      if (dist < rz.halfW) return true
    }
    return false
  }

  // ── 占用格网（防止过密） ──
  const occupied = new Set<string>()

  function markOccupied(x: number, z: number, radius: number) {
    const n = Math.ceil(radius / CELL)
    const cx = Math.round(x / CELL), cz = Math.round(z / CELL)
    for (let dx = -n; dx <= n; dx++)
      for (let dz = -n; dz <= n; dz++)
        occupied.add(`${cx + dx},${cz + dz}`)
  }

  function isOccupied(x: number, z: number) {
    return occupied.has(`${Math.round(x / CELL)},${Math.round(z / CELL)}`)
  }

  // 预占蓝图装饰物位置
  for (const d of bpDecos) markOccupied(d.x, d.z, Math.max(d.r * 2, CELL))

  // ── 确定性哈希 ──
  function hr(x: number, z: number, salt: number): number {
    const v = Math.sin(x * 127.1 + z * 311.7 + salt * 74.3) * 43758.5453
    return v - Math.floor(v)
  }

  function nearResource(x: number, z: number): boolean {
    for (const p of rpts)
      if (Math.hypot(p.x - x, p.z - z) < RESOURCE_SAFE) return true
    return false
  }

  // ── 世界坐标 → 格网采样（用于抖动后验证落点层级） ──
  function sampleAt(wx: number, wz: number): { cl: number; blocked: boolean } {
    const c = Math.round((wx / W + 0.5) * (R - 1))
    const r = Math.round((wz / H + 0.5) * (R - 1))
    if (c < 0 || c >= R || r < 0 || r >= R) return { cl: 99, blocked: true }
    const i = r * R + c
    return { cl: cliffLevels[i], blocked: pathingGrid[i] === 1 }
  }

  /** 基于位置生成确定性 ID，跨重建保持稳定 */
  function makeAutoId(prefix: string, x: number, z: number): string {
    return `${prefix}_${Math.round(x * 10)}_${Math.round(z * 10)}`
  }

  // ── 独立的簇间距占用格（与岩石内部间距分开管理）──
  // 簇心间距 ≥ CLUSTER_GAP，用较大格网；簇内岩石用 CELL(1.5)
  const CLUSTER_GAP = 14.0
  const clusterCellSize = CLUSTER_GAP / 2
  const clusterOccupied = new Set<string>()
  function markCluster(x: number, z: number) {
    const cx = Math.round(x / clusterCellSize)
    const cz = Math.round(z / clusterCellSize)
    clusterOccupied.add(`${cx},${cz}`)
  }
  function isClusterOccupied(x: number, z: number) {
    const cx = Math.round(x / clusterCellSize)
    const cz = Math.round(z / clusterCellSize)
    return clusterOccupied.has(`${cx},${cz}`)
  }

  // ================================================================
  // Pass A — 崖脚簇状岩石
  // ================================================================
  // 遍历崖脚格子；触发新簇时一次放 3-4 块紧密岩石，
  // 然后封锁 CLUSTER_GAP 范围，保证相邻簇之间有明显空白。
  // 效果：沿崖壁看到 "一团一团" 的岩石群，而不是均匀散点。

  for (let row = STEP; row < R - STEP; row += STEP) {
    for (let col = STEP; col < R - STEP; col += STEP) {
      const idx = row * R + col
      const cl = cliffLevels[idx]
      if (pathingGrid[idx] === 1) continue   // 只在可通行低侧

      // 直接 4 邻居检测（1格）：是否贴着更高层级
      let cliffAbove = false
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
        const nr = row + dr, nc = col + dc
        if (nr < 0 || nr >= R || nc < 0 || nc >= R) continue
        if (cliffLevels[nr * R + nc] > cl) { cliffAbove = true; break }
      }
      if (!cliffAbove) continue

      const wx = (col / (R - 1) - 0.5) * W
      const wz = (row / (R - 1) - 0.5) * H

      if (nearRamp(wx, wz) || nearResource(wx, wz) || inTrench(wx, wz) || inBorder(wx, wz)) continue

      // 决定是否在此处触发新簇（30% 概率 + 簇间距保护）
      if (isClusterOccupied(wx, wz)) continue
      if (hr(wx, wz, 0) > 0.30) continue

      // 触发一个簇：3-4 块岩石在 2.5 单位半径内散落
      markCluster(wx, wz)
      const rockCount = 3 + (hr(wx, wz, 5) > 0.5 ? 1 : 0)
      for (let i = 0; i < rockCount; i++) {
        const a = hr(wx + i * 1.7, wz, 1)
        const b = hr(wx, wz + i * 2.3, 2)
        const c = hr(wx + i, wz + i, 3)
        const px = wx + (a - 0.5) * 5.0
        const pz = wz + (b - 0.5) * 5.0
        const dest = sampleAt(px, pz)
        // 落点必须仍在低侧且可通行，且不在沟壑内
        if (dest.blocked || dest.cl > cl) continue
        if (nearRamp(px, pz) || nearResource(px, pz) || inTrench(px, pz) || inBorder(px, pz)) continue
        if (isOccupied(px, pz)) continue
        decos.push({
          id: makeAutoId('_ar', px, pz),
          type: 'rock',
          x: px, z: pz,
          r: decoBaseR('rock'),
          rotation: c * Math.PI * 2,
          scale: 0.8 + a * 0.4,
          blocksPathing: true,
          blocksLOS: false,
        })
        markOccupied(px, pz, 1.5)
      }
    }
  }

  // ================================================================
  // Pass B — 平原 LOS Blocker（视野遮蔽物）
  // ================================================================
  // 在真正开阔的 CL0 平原（距离任意悬崖 ≥ PLAIN_CLIFF_DIST）放置
  // 少量视野遮蔽簇（plant，blocksLOS=true，blocksPathing=false）。
  // 每簇 2-3 株，簇间距 ≥ 28 单位，全图 4-8 簇。
  // 偏离地图中轴（沿 x 偏移），制造信息差而不堵死通道。

  const PLAIN_CLIFF_DIST = 6  // 距悬崖格子数（格网单位）
  const LOS_CLUSTER_GAP = 28.0
  const losOccupied = new Set<string>()
  const losCellSize = LOS_CLUSTER_GAP / 2
  function isLosOccupied(x: number, z: number) {
    return losOccupied.has(`${Math.round(x / losCellSize)},${Math.round(z / losCellSize)}`)
  }
  function markLos(x: number, z: number) {
    losOccupied.add(`${Math.round(x / losCellSize)},${Math.round(z / losCellSize)}`)
  }

  const BSTEP_PLAIN = 4
  for (let row = BSTEP_PLAIN; row < R - BSTEP_PLAIN; row += BSTEP_PLAIN) {
    for (let col = BSTEP_PLAIN; col < R - BSTEP_PLAIN; col += BSTEP_PLAIN) {
      const idx = row * R + col
      if (cliffLevels[idx] !== 0) continue
      if (pathingGrid[idx] === 1) continue

      // 确认周围 PLAIN_CLIFF_DIST 格内没有悬崖（真正开阔平原）
      let tooNearCliff = false
      outer: for (let dr = -PLAIN_CLIFF_DIST; dr <= PLAIN_CLIFF_DIST; dr++) {
        for (let dc = -PLAIN_CLIFF_DIST; dc <= PLAIN_CLIFF_DIST; dc++) {
          const nr = row + dr, nc = col + dc
          if (nr < 0 || nr >= R || nc < 0 || nc >= R) continue
          if (cliffLevels[nr * R + nc] > 0 || pathingGrid[nr * R + nc] === 1) {
            tooNearCliff = true; break outer
          }
        }
      }
      if (tooNearCliff) continue

      const wx = (col / (R - 1) - 0.5) * W
      const wz = (row / (R - 1) - 0.5) * H

      if (nearRamp(wx, wz) || nearResource(wx, wz) || inTrench(wx, wz) || inBorder(wx, wz)) continue
      if (isLosOccupied(wx, wz)) continue

      // 8% 概率在开阔平原触发一个 LOS blocker 簇
      if (hr(wx, wz, 10) > 0.08) continue

      markLos(wx, wz)
      const plantCount = 2 + (hr(wx, wz, 11) > 0.5 ? 1 : 0)
      for (let i = 0; i < plantCount; i++) {
        const a = hr(wx + i * 2.1, wz, 12)
        const b = hr(wx, wz + i * 1.9, 13)
        const c = hr(wx + i, wz + i, 14)
        const px = wx + (a - 0.5) * 4.0
        const pz = wz + (b - 0.5) * 4.0
        const dest = sampleAt(px, pz)
        if (dest.blocked || dest.cl !== 0) continue
        if (nearRamp(px, pz) || nearResource(px, pz) || inTrench(px, pz) || inBorder(px, pz)) continue
        if (isOccupied(px, pz)) continue
        decos.push({
          id: makeAutoId('_al', px, pz),
          type: 'plant',
          x: px, z: pz,
          r: decoBaseR('plant'),
          rotation: c * Math.PI * 2,
          scale: 0.8 + a * 0.4,
          blocksPathing: false,
          blocksLOS: true,    // ← 视野遮蔽，不阻挡通行
        })
        markOccupied(px, pz, 2.0)
      }
    }
  }

  // ================================================================
  // Pass C — 崖顶高侧极稀疏视觉装饰（晶体，不阻挡）
  // ================================================================
  for (let row = STEP; row < R - STEP; row += STEP) {
    for (let col = STEP; col < R - STEP; col += STEP) {
      const idx = row * R + col
      const cl = cliffLevels[idx]
      if (pathingGrid[idx] === 1 || cl < 2) continue

      let cliffBelow = false
      for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as [number, number][]) {
        const nr = row + dr, nc = col + dc
        if (nr < 0 || nr >= R || nc < 0 || nc >= R) continue
        if (cliffLevels[nr * R + nc] < cl) { cliffBelow = true; break }
      }
      if (!cliffBelow) continue

      const wx = (col / (R - 1) - 0.5) * W
      const wz = (row / (R - 1) - 0.5) * H
      if (nearResource(wx, wz) || inTrench(wx, wz) || inBorder(wx, wz)) continue

      const r0 = hr(wx, wz, 0)
      if (r0 > 0.04) continue          // 极稀疏：4%
      if (isClusterOccupied(wx, wz)) continue

      const r3 = hr(wx, wz, 3)
      const dest = sampleAt(wx, wz)
      if (dest.cl < cl) continue
      if (isOccupied(wx, wz)) continue

      decos.push({
        id: makeAutoId('_ac', wx, wz),
        type: 'crystal',
        x: wx, z: wz,
        r: decoBaseR('crystal'),
        rotation: r3 * Math.PI * 2,
        scale: 0.8 + r0 * 0.4,
        blocksPathing: false,   // ← 高侧视觉装饰，不阻挡通行
        blocksLOS: false,
      })
      markOccupied(wx, wz, 3.5)
    }
  }

  // ================================================================
  // 地图边界：角落必放 + 边缘稀疏岩石簇
  // ================================================================
  // 不做连续环绕带（会产生"画框"效果）。
  // 改为：4 个角落必放岩石簇 + 沿每条边每 ~24 单位 40% 概率触发一簇。
  // 每簇 3-4 块岩石在 3-4 单位半径内自然散落。
  {
    const EW = W / 2, EH = H / 2
    const INSET = 5.0          // 簇心距边界内缩
    const CLUSTER_STEP = 20.0  // 簇间间距
    const SCATTER = 5.0        // 簇内散布半径（加大，形成更厚实的石堆面）

    // 在指定位置放一簇岩石（6-9 块，形成有体量的石堆）
    function placeEdgeCluster(cx: number, cz: number, saltBase: number) {
      const count = 6 + Math.floor(hr(cx, cz, saltBase) * 3)  // 6-8 块
      for (let i = 0; i < count; i++) {
        const a = hr(cx * 1.3 + i, cz * 0.7, saltBase + i)
        const b = hr(cx * 0.7, cz * 1.3 + i, saltBase + i + 1)
        const c = hr(cx + i * 2.1, cz + i * 1.7, saltBase + i + 2)
        const px = cx + (a - 0.5) * SCATTER * 2
        const pz = cz + (b - 0.5) * SCATTER * 2
        if (nearResource(px, pz) || nearRamp(px, pz) || inTrench(px, pz) || inBorder(px, pz)) return
        if (isOccupied(px, pz)) continue
        decos.push({
          id: makeAutoId('_ab', px, pz),
          type: 'rock',
          x: px, z: pz,
          r: decoBaseR('rock'),
          rotation: c * Math.PI * 2,
          scale: 0.8 + a * 0.4,
          blocksPathing: false,
          blocksLOS: false,
        })
        markOccupied(px, pz, 1.5)  // 紧密排列
      }
    }

    let edgeSalt = 50

    // 四个角落（必放 2 簇重叠，形成更厚实的角落石堆）
    for (const [cx, cz] of [
      [-EW + INSET, -EH + INSET],
      [ EW - INSET, -EH + INSET],
      [-EW + INSET,  EH - INSET],
      [ EW - INSET,  EH - INSET],
    ] as [number, number][]) {
      placeEdgeCluster(cx, cz, edgeSalt)
      placeEdgeCluster(cx + (hr(cx, cz, edgeSalt + 1) - 0.5) * 4,
                       cz + (hr(cx, cz, edgeSalt + 2) - 0.5) * 4, edgeSalt + 3)
      edgeSalt += 10
    }

    // 上下边（z 固定，沿 x 扫描，70% 概率触发）
    for (const ez of [-EH + INSET, EH - INSET]) {
      for (let ex = -EW + CLUSTER_STEP; ex < EW - INSET; ex += CLUSTER_STEP) {
        if (hr(ex, ez, edgeSalt) < 0.70) placeEdgeCluster(ex, ez, edgeSalt)
        edgeSalt += 7
      }
    }

    // 左右边（x 固定，沿 z 扫描，70% 概率触发）
    for (const ex of [-EW + INSET, EW - INSET]) {
      for (let ez = -EH + CLUSTER_STEP; ez < EH - INSET; ez += CLUSTER_STEP) {
        if (hr(ex, ez, edgeSalt) < 0.70) placeEdgeCluster(ex, ez, edgeSalt)
        edgeSalt += 7
      }
    }
  }

  return decos
}

// ================================================================
// Internal helpers
// ================================================================

/** blueprint 高度 → cliff level */
function _heightToCliffLevel(height: number, cliffVisH: number): number {
  return Math.round(height / cliffVisH)
}

/**
 * 坡道高度插值 — 使用 orientedRectTest 的 t 参数做精确线性插值
 * 相比 segDist，OBB 测试更精确地反映了有向矩形内各点的插值位置
 */
function _getRampHeightOBB(bp: MapBlueprint, wx: number, wz: number): number {
  for (const rm of bp.ramps) {
    const { inside, t } = orientedRectTest(wx, wz, rm.ax, rm.az, rm.bx, rm.bz, rm.width)
    if (inside) {
      return rm.hA + (rm.hB - rm.hA) * t
    }
  }
  // fallback: 旧版 segDist（不在 OBB 内但在旧版检测范围内的边界情况）
  for (const rm of bp.ramps) {
    const { d, t } = segDist(wx, wz, rm.ax, rm.az, rm.bx, rm.bz)
    if (d < rm.width) {
      return rm.hA + (rm.hB - rm.hA) * t
    }
  }
  return 0
}

/** 查找最近平台高度（旧版悬崖墙壁用） */
function _nearestPlatformHeight(bp: MapBlueprint, wx: number, wz: number): number {
  let best = 3
  let bestD = Infinity
  for (const pl of bp.platforms) {
    const cx = (pl.x1 + pl.x2) / 2
    const cz = (pl.z1 + pl.z2) / 2
    const d = dist(wx, wz, cx, cz)
    if (d < bestD) { bestD = d; best = pl.height }
  }
  return best
}

/**
 * 生成悬崖边缘线段（用于 3D 墙壁渲染）
 *
 * 使用 Marching Squares (平滑轮廓线) 算法，将离散的高低格子转换为
 * 平滑的 45度斜角和直线边界。彻底消除方块格子引擎特有的 90度马赛克锯齿。
 */
function _buildCliffEdges(
  bp: MapBlueprint,
  R: number, W: number, H: number,
  cliffLevels: number[],
  isRamp: Uint8Array,
  isEdge: Uint8Array,
): CliffEdge[] {
  const edges: CliffEdge[] = []
  const cellW = W / (R - 1)
  const cellH = H / (R - 1)

  // 1. 寻找最小和最大高度层级，按层级逐层提取轮廓
  let minLevel = 999
  let maxLevel = -999
  for (let i = 0; i < R * R; i++) {
    if (cliffLevels[i] < minLevel) minLevel = cliffLevels[i]
    if (cliffLevels[i] > maxLevel) maxLevel = cliffLevels[i]
  }
  if (minLevel >= maxLevel) return []

  // Marching Squares 2x2 单元边缘的中点 (T=0, R=1, B=2, L=3)
  const getMidWorld = (col: number, row: number, edgeIdx: number) => {
    switch (edgeIdx) {
      case 0: return { x: (col + 0.5) * cellW - W / 2, z: row * cellH - H / 2 }
      case 1: return { x: (col + 1) * cellW - W / 2, z: (row + 0.5) * cellH - H / 2 }
      case 2: return { x: (col + 0.5) * cellW - W / 2, z: (row + 1) * cellH - H / 2 }
      case 3: return { x: col * cellW - W / 2, z: (row + 0.5) * cellH - H / 2 }
      default: return { x: 0, z: 0 }
    }
  }

  // 16 种状态的边缘连接表
  const cases: number[][][] = [
    [], // 0
    [[3, 2]], // 1: BL
    [[2, 1]], // 2: BR
    [[3, 1]], // 3: BL, BR
    [[1, 0]], // 4: TR
    [[3, 2], [1, 0]], // 5: BL, TR (鞍点)
    [[2, 0]], // 6: BR, TR
    [[3, 0]], // 7: BL, BR, TR
    [[0, 3]], // 8: TL
    [[0, 2]], // 9: TL, BL
    [[0, 3], [2, 1]], // 10: TL, BR (鞍点)
    [[0, 1]], // 11: TL, BL, BR
    [[1, 3]], // 12: TL, TR
    [[1, 2]], // 13: TL, TR, BL
    [[2, 3]], // 14: TL, TR, BR
    [], // 15: 全高
  ]

  for (let level = minLevel; level < maxLevel; level++) {
    // 负 level 对应沟壑边界（trench），不生成 box wall；
    // 沟壑外观由地形 mesh 顶点凹陷 + lava/void glow plane 表现。
    if (level < 0) continue

    const threshold = level + 0.5
    for (let row = 0; row < R - 1; row++) {
      for (let col = 0; col < R - 1; col++) {
        const tlIdx = row * R + col
        const trIdx = row * R + col + 1
        const blIdx = (row + 1) * R + col
        const brIdx = (row + 1) * R + col + 1

        // 如果任何一个角是坡道或地图边缘，跳过轮廓生成（给坡道留出缺口）
        if (isRamp[tlIdx] || isRamp[trIdx] || isRamp[blIdx] || isRamp[brIdx]) continue
        if (isEdge[tlIdx] && isEdge[trIdx] && isEdge[blIdx] && isEdge[brIdx]) continue

        let state = 0
        if (cliffLevels[tlIdx] > threshold) state |= 8
        if (cliffLevels[trIdx] > threshold) state |= 4
        if (cliffLevels[brIdx] > threshold) state |= 2
        if (cliffLevels[blIdx] > threshold) state |= 1

        const segs = cases[state]
        for (const seg of segs) {
          const p1 = getMidWorld(col, row, seg[0])
          const p2 = getMidWorld(col, row, seg[1])
          edges.push({
            x1: p1.x, z1: p1.z,
            x2: p2.x, z2: p2.z,
            highLevel: level + 1,
            lowLevel: level,
          })
        }
      }
    }
  }

  // 2. 优化：合并共线的相邻线段，以及进行曲线平滑算法
  return _smoothAndMergeEdges(edges)
}

/**
 * 平滑算法：
 * 1. 将离散线段组装为连续路径 (Polyline)
 * 2. 对路径顶点进行拉普拉斯平滑 (Laplacian Smoothing)
 * 3. 再次合并共线线段以大幅减少多边形数量
 */
function _smoothAndMergeEdges(edges: CliffEdge[]): CliffEdge[] {
  if (edges.length === 0) return []

  const groups = new Map<string, CliffEdge[]>()
  for (const e of edges) {
    const key = `${e.highLevel}_${e.lowLevel}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(e)
  }

  const smoothedEdges: CliffEdge[] = []
  const EPSILON = 0.001

  for (const group of groups.values()) {
    const ptMap = new Map<string, {x: number, z: number, edges: number[]}>()
    const getPtId = (x: number, z: number) => {
      const k = `${x.toFixed(3)},${z.toFixed(3)}`
      if (!ptMap.has(k)) {
        ptMap.set(k, {x, z, edges: []})
      }
      return k
    }

    for (let i = 0; i < group.length; i++) {
      const e = group[i]
      ptMap.get(getPtId(e.x1, e.z1))!.edges.push(i)
      ptMap.get(getPtId(e.x2, e.z2))!.edges.push(i)
    }

    const usedEdge = new Uint8Array(group.length)
    const paths: {x: number, z: number}[][] = []

    for (let i = 0; i < group.length; i++) {
      if (usedEdge[i]) continue
      const path: {x: number, z: number}[] = []
      
      let currEdgeIdx = i
      let currPtKey = getPtId(group[i].x1, group[i].z1)
      path.push({x: ptMap.get(currPtKey)!.x, z: ptMap.get(currPtKey)!.z})
      
      // 往前追踪
      while (true) {
        usedEdge[currEdgeIdx] = 1
        const e = group[currEdgeIdx]
        const k1 = getPtId(e.x1, e.z1)
        const k2 = getPtId(e.x2, e.z2)
        const nextPtKey = (k1 === currPtKey) ? k2 : k1
        path.push({x: ptMap.get(nextPtKey)!.x, z: ptMap.get(nextPtKey)!.z})
        
        const nextEdges = ptMap.get(nextPtKey)!.edges.filter(idx => !usedEdge[idx])
        if (nextEdges.length === 0) break
        
        currEdgeIdx = nextEdges[0]
        currPtKey = nextPtKey
      }
      
      // 往回追踪
      currPtKey = getPtId(group[i].x1, group[i].z1)
      while (true) {
        const prevEdges = ptMap.get(currPtKey)!.edges.filter(idx => !usedEdge[idx])
        if (prevEdges.length === 0) break
        
        currEdgeIdx = prevEdges[0]
        usedEdge[currEdgeIdx] = 1
        const e = group[currEdgeIdx]
        const k1 = getPtId(e.x1, e.z1)
        const k2 = getPtId(e.x2, e.z2)
        const nextPtKey = (k1 === currPtKey) ? k2 : k1
        path.unshift({x: ptMap.get(nextPtKey)!.x, z: ptMap.get(nextPtKey)!.z})
        currPtKey = nextPtKey
      }
      
      paths.push(path)
    }

    // 对路径进行平滑处理
    for (const path of paths) {
      if (path.length < 3) {
        // 线段太短，直接输出
        const levelEdge = group[0]
        for (let i = 0; i < path.length - 1; i++) {
          smoothedEdges.push({
            x1: path[i].x, z1: path[i].z,
            x2: path[i+1].x, z2: path[i+1].z,
            highLevel: levelEdge.highLevel,
            lowLevel: levelEdge.lowLevel
          })
        }
        continue
      }

      const isLoop = (Math.abs(path[0].x - path[path.length-1].x) < EPSILON && Math.abs(path[0].z - path[path.length-1].z) < EPSILON)
      let curPath = path
      
      // 执行 3 次 Laplacian 平滑迭代
      for (let iter = 0; iter < 3; iter++) {
        const nPath = curPath.map(p => ({x: p.x, z: p.z}))
        for (let i = 0; i < curPath.length; i++) {
          if (!isLoop && (i === 0 || i === curPath.length - 1)) continue // 端点固定
          const pIdx = i === 0 ? curPath.length - 2 : i - 1
          const nIdx = i === curPath.length - 1 ? 1 : i + 1
          nPath[i].x = curPath[i].x * 0.5 + curPath[pIdx].x * 0.25 + curPath[nIdx].x * 0.25
          nPath[i].z = curPath[i].z * 0.5 + curPath[pIdx].z * 0.25 + curPath[nIdx].z * 0.25
        }
        curPath = nPath
      }

      const levelEdge = group[0]
      for (let i = 0; i < curPath.length - 1; i++) {
        smoothedEdges.push({
          x1: curPath[i].x, z1: curPath[i].z,
          x2: curPath[i+1].x, z2: curPath[i+1].z,
          highLevel: levelEdge.highLevel,
          lowLevel: levelEdge.lowLevel
        })
      }
    }
  }

  return _mergeCollinearEdges(smoothedEdges)
}

function _mergeCollinearEdges(edges: CliffEdge[]): CliffEdge[] {
  if (edges.length <= 1) return edges
  const EPSILON = 0.001
  let currentEdges = [...edges]
  let merged = true

  while (merged) {
    merged = false
    const nextEdges: CliffEdge[] = []
    const used = new Uint8Array(currentEdges.length)

    for (let i = 0; i < currentEdges.length; i++) {
      if (used[i]) continue
      let e1 = currentEdges[i]

      for (let j = i + 1; j < currentEdges.length; j++) {
        if (used[j]) continue
        const e2 = currentEdges[j]

        if (e1.highLevel !== e2.highLevel || e1.lowLevel !== e2.lowLevel) continue

        // 检查端点是否重合
        const share1 = Math.abs(e1.x2 - e2.x1) < EPSILON && Math.abs(e1.z2 - e2.z1) < EPSILON
        const share2 = Math.abs(e1.x1 - e2.x2) < EPSILON && Math.abs(e1.z1 - e2.z2) < EPSILON
        const share3 = Math.abs(e1.x2 - e2.x2) < EPSILON && Math.abs(e1.z2 - e2.z2) < EPSILON
        const share4 = Math.abs(e1.x1 - e2.x1) < EPSILON && Math.abs(e1.z1 - e2.z1) < EPSILON

        if (share1 || share2 || share3 || share4) {
          const dir1x = e1.x2 - e1.x1, dir1z = e1.z2 - e1.z1
          const dir2x = e2.x2 - e2.x1, dir2z = e2.z2 - e2.z1
          const cross = dir1x * dir2z - dir1z * dir2x

          if (Math.abs(cross) < EPSILON) {
            let nx1, nz1, nx2, nz2
            if (share1) { nx1 = e1.x1; nz1 = e1.z1; nx2 = e2.x2; nz2 = e2.z2 }
            else if (share2) { nx1 = e2.x1; nz1 = e2.z1; nx2 = e1.x2; nz2 = e1.z2 }
            else if (share3) { nx1 = e1.x1; nz1 = e1.z1; nx2 = e2.x1; nz2 = e2.z1 }
            else { nx1 = e1.x2; nz1 = e1.z2; nx2 = e2.x2; nz2 = e2.z2 }

            e1 = { x1: nx1, z1: nz1, x2: nx2, z2: nz2, highLevel: e1.highLevel, lowLevel: e1.lowLevel }
            used[j] = 1
            merged = true
          }
        }
      }
      nextEdges.push(e1)
    }
    currentEdges = nextEdges
  }
  return currentEdges
}

// ================================================================
// Zone-Aware Decoration Generator
// ================================================================

/**
 * 分区感知的装饰物生成器
 *
 * 核心策略：
 *   1. 在分区边界（不同 ZoneType 交界处）密集放置装饰物，形成自然分隔
 *   2. 在分区内部根据类型决定装饰密度和种类
 *   3. 所有通道留出固定宽度（corridorWidth）保证单位通行
 *   4. spawn_zone 和 mineral_zone 内部几乎不放装饰
 */
function _zoneAwareDecorations(
  R: number, W: number, H: number,
  cliffLevels: number[],
  pathingGrid: Uint8Array,
  bp: MapBlueprint,
  bpDecos: DecorationDef[],
  trenchGrid: Int8Array,
  borderGrid: Uint8Array,
  zoneGrid: ZoneGrid,
  zoneGridRes: number,
  zones: ZoneInfo[],
  advCfg: { denseBattleIntensity?: number; corridorWidth?: number; edgeDecoDensity?: number; densePacking?: boolean },
): DecorationDef[] {
  const decos: DecorationDef[] = []
  const packed = advCfg.densePacking ?? false
  const CELL = packed ? 0.6 : 1.2
  const RESOURCE_SAFE = packed ? 5.0 : 9.0
  const denseMul = advCfg.denseBattleIntensity ?? 1.0
  const edgeMul = advCfg.edgeDecoDensity ?? 1.0

  // ── 收集安全点 ──
  const rpts: Array<{ x: number; z: number }> = []
  if (bp.spawnPoints) for (const s of bp.spawnPoints) rpts.push({ x: s.x, z: s.z })
  if (bp.bases) {
    for (const b of bp.bases) {
      rpts.push({ x: b.ccX, z: b.ccZ })
      rpts.push({ x: b.mineralArcX, z: b.mineralArcZ })
      for (const g of b.geysers) rpts.push({ x: g.x, z: g.z })
    }
  }

  // ── 沟壑/边界检查 ──
  function inTrench(x: number, z: number): boolean {
    const c0 = Math.round((x / W + 0.5) * (R - 1))
    const r0 = Math.round((z / H + 0.5) * (R - 1))
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r0 + dr, nc = c0 + dc
        if (nr < 0 || nr >= R || nc < 0 || nc >= R) continue
        if (trenchGrid[nr * R + nc] > 0) return true
      }
    }
    return false
  }
  function inBorder(x: number, z: number): boolean {
    const c0 = Math.round((x / W + 0.5) * (R - 1))
    const r0 = Math.round((z / H + 0.5) * (R - 1))
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r0 + dr, nc = c0 + dc
        if (nr < 0 || nr >= R || nc < 0 || nc >= R) continue
        if (borderGrid[nr * R + nc] > 0) return true
      }
    }
    return false
  }

  // ── 坡道禁区 ──
  type RampZone = { ax: number; az: number; bx: number; bz: number; halfW: number }
  const rampZones: RampZone[] = []
  if (bp.ramps) {
    for (const r of bp.ramps) {
      rampZones.push({ ax: r.ax, az: r.az, bx: r.bx, bz: r.bz, halfW: r.width + 5.0 })
    }
  }
  function nearRamp(x: number, z: number): boolean {
    for (const rz of rampZones) {
      const ddx = rz.bx - rz.ax, ddz = rz.bz - rz.az
      const len2 = ddx * ddx + ddz * ddz
      let d: number
      if (len2 < 0.001) {
        d = Math.hypot(x - rz.ax, z - rz.az)
      } else {
        const t = Math.max(0, Math.min(1, ((x - rz.ax) * ddx + (z - rz.az) * ddz) / len2))
        d = Math.hypot(x - (rz.ax + t * ddx), z - (rz.az + t * ddz))
      }
      if (d < rz.halfW) return true
    }
    return false
  }

  // ── 占用格网 ──
  const occupied = new Set<string>()
  function markOccupied(x: number, z: number, radius: number) {
    const n = Math.ceil(radius / CELL)
    const cx = Math.round(x / CELL), cz = Math.round(z / CELL)
    for (let dx = -n; dx <= n; dx++)
      for (let dz = -n; dz <= n; dz++)
        occupied.add(`${cx + dx},${cz + dz}`)
  }
  function isOccupied(x: number, z: number) {
    return occupied.has(`${Math.round(x / CELL)},${Math.round(z / CELL)}`)
  }
  for (const d of bpDecos) markOccupied(d.x, d.z, Math.max(d.r * 2, CELL))

  // ── 确定性哈希 ──
  function hr(x: number, z: number, salt: number): number {
    const v = Math.sin(x * 127.1 + z * 311.7 + salt * 74.3) * 43758.5453
    return v - Math.floor(v)
  }
  function nearResource(x: number, z: number): boolean {
    for (const p of rpts) if (Math.hypot(p.x - x, p.z - z) < RESOURCE_SAFE) return true
    return false
  }
  function sampleAt(wx: number, wz: number): { cl: number; blocked: boolean } {
    const c = Math.round((wx / W + 0.5) * (R - 1))
    const r = Math.round((wz / H + 0.5) * (R - 1))
    if (c < 0 || c >= R || r < 0 || r >= R) return { cl: 99, blocked: true }
    const i = r * R + c
    return { cl: cliffLevels[i], blocked: pathingGrid[i] === 1 }
  }
  function makeAutoId(prefix: string, x: number, z: number): string {
    return `${prefix}_${Math.round(x * 10)}_${Math.round(z * 10)}`
  }

  // ── 分区网格采样 ──
  function getZoneAtWorld(wx: number, wz: number): ZoneType {
    const c = Math.round((wx / W + 0.5) * (zoneGridRes - 1))
    const r = Math.round((wz / H + 0.5) * (zoneGridRes - 1))
    if (c < 0 || c >= zoneGridRes || r < 0 || r >= zoneGridRes) return 'wasteland'
    return getZoneAt(zoneGrid, r * zoneGridRes + c)
  }

  const BORDER_BAND = packed ? 5 : 3
  function isZoneBorder(row: number, col: number): boolean {
    const zr = Math.round(row / R * (zoneGridRes - 1))
    const zc = Math.round(col / R * (zoneGridRes - 1))
    if (zr < 0 || zr >= zoneGridRes || zc < 0 || zc >= zoneGridRes) return false
    const myZone = zoneGrid[zr * zoneGridRes + zc]
    for (let dr = -BORDER_BAND; dr <= BORDER_BAND; dr++) {
      for (let dc = -BORDER_BAND; dc <= BORDER_BAND; dc++) {
        if (dr === 0 && dc === 0) continue
        const nr = zr + dr, nc = zc + dc
        if (nr < 0 || nr >= zoneGridRes || nc < 0 || nc >= zoneGridRes) continue
        if (zoneGrid[nr * zoneGridRes + nc] !== myZone) return true
      }
    }
    return false
  }

  const CLUSTER_GAP = packed ? 2.5 : 6.0
  const clusterCellSize = CLUSTER_GAP / 2
  const clusterOccupied = new Set<string>()
  function markCluster(x: number, z: number) {
    clusterOccupied.add(`${Math.round(x / clusterCellSize)},${Math.round(z / clusterCellSize)}`)
  }
  function isClusterOccupied(x: number, z: number) {
    return clusterOccupied.has(`${Math.round(x / clusterCellSize)},${Math.round(z / clusterCellSize)}`)
  }

  const STEP = 2

  // ================================================================
  // Pass 1 — 分区边界装饰（最重要的视觉效果）
  // ================================================================
  // 在不同分区交界处密集放置装饰物，形成自然的区域分隔
  // 这是整个系统最关键的 pass，决定了地图的"区域感"

  for (let row = STEP; row < R - STEP; row += STEP) {
    for (let col = STEP; col < R - STEP; col += STEP) {
      const idx = row * R + col
      if (pathingGrid[idx] === 1) continue

      if (!isZoneBorder(row, col)) continue

      const wx = (col / (R - 1) - 0.5) * W
      const wz = (row / (R - 1) - 0.5) * H

      if (nearRamp(wx, wz) || nearResource(wx, wz) || inTrench(wx, wz) || inBorder(wx, wz)) continue

      const zone = getZoneAtWorld(wx, wz)
      const cfg = getZoneDecoConfig(zone)

      const prob = packed ? 1.0 : cfg.edgeDensity * edgeMul
      if (hr(wx, wz, 100) > prob) continue
      if (!packed && isClusterOccupied(wx, wz)) continue

      markCluster(wx, wz)

      const typeIdx = Math.floor(hr(wx, wz, 101) * cfg.decoTypes.length) % cfg.decoTypes.length
      const decoType = cfg.decoTypes[typeIdx]

      const clusterSize = packed ? 6 + Math.floor(hr(wx, wz, 102) * 5) : 4 + Math.floor(hr(wx, wz, 102) * 4)
      const scatter = packed ? 3.5 : 6.0
      for (let i = 0; i < clusterSize; i++) {
        const a = hr(wx + i * 1.7, wz, 103)
        const b = hr(wx, wz + i * 2.3, 104)
        const c = hr(wx + i, wz + i, 105)
        const px = wx + (a - 0.5) * scatter
        const pz = wz + (b - 0.5) * scatter

        const dest = sampleAt(px, pz)
        if (dest.blocked) continue
        if (nearRamp(px, pz) || nearResource(px, pz) || inTrench(px, pz) || inBorder(px, pz)) continue
        if (isOccupied(px, pz)) continue

        decos.push({
          id: makeAutoId('_zb', px, pz),
          type: decoType,
          x: px, z: pz,
          r: decoBaseR(decoType),
          rotation: c * Math.PI * 2,
          scale: packed ? 0.7 + a * 0.3 : 0.8 + a * 0.4,
          blocksPathing: cfg.blocksPathing,
          blocksLOS: decoType === 'plant',
        })
        markOccupied(px, pz, packed ? 0.5 : 1.0)
      }
    }
  }

  // ================================================================
  // Pass 2 — 高度差边界密铺装饰（崖脚+崖顶双侧）
  // ================================================================
  // 扫描所有可通行格子，检测附近是否有高度差异（扩展检测范围 CLIFF_SCAN）。
  // 在高度差边界两侧密集放置装饰物：低侧放岩石，高侧放岩石/晶体/植物。
  // packed 模式下逐格扫描，普通模式 step=2。

  {
    const CLIFF_SCAN = packed ? 3 : 2
    const cliffStep = packed ? 1 : STEP
    const cliffProb = packed ? 0.9 : 0.45
    const cliffTypes: string[] = ['rock', 'rock', 'rock', 'crystal', 'plant']

    for (let row = cliffStep; row < R - cliffStep; row += cliffStep) {
      for (let col = cliffStep; col < R - cliffStep; col += cliffStep) {
        const idx = row * R + col
        const cl = cliffLevels[idx]
        if (pathingGrid[idx] === 1) continue

        // 扩展范围检测：CLIFF_SCAN 格内是否有不同高度
        let hasHeightDiff = false
        for (let dr = -CLIFF_SCAN; dr <= CLIFF_SCAN && !hasHeightDiff; dr++) {
          for (let dc = -CLIFF_SCAN; dc <= CLIFF_SCAN && !hasHeightDiff; dc++) {
            if (dr === 0 && dc === 0) continue
            const nr = row + dr, nc = col + dc
            if (nr < 0 || nr >= R || nc < 0 || nc >= R) continue
            if (cliffLevels[nr * R + nc] !== cl) hasHeightDiff = true
          }
        }
        if (!hasHeightDiff) continue

        const wx = (col / (R - 1) - 0.5) * W
        const wz = (row / (R - 1) - 0.5) * H

        if (nearRamp(wx, wz) || nearResource(wx, wz) || inTrench(wx, wz) || inBorder(wx, wz)) continue

        const zone = getZoneAtWorld(wx, wz)
        if (zone === 'spawn_zone' && !packed) continue

        if (hr(wx, wz, 0) > cliffProb * edgeMul) continue
        if (isOccupied(wx, wz)) continue

        // 选择装饰类型：低侧偏岩石，高侧混合
        const typeHash = Math.floor(hr(wx, wz, 6) * cliffTypes.length) % cliffTypes.length
        const decoType = cliffTypes[typeHash]
        const c = hr(wx, wz, 3)

        decos.push({
          id: makeAutoId('_zh', wx, wz),
          type: decoType,
          x: wx, z: wz,
          r: decoBaseR(decoType),
          rotation: c * Math.PI * 2,
          scale: packed ? 0.5 + hr(wx, wz, 7) * 0.4 : 0.7 + hr(wx, wz, 7) * 0.5,
          blocksPathing: decoType === 'rock',
          blocksLOS: decoType === 'plant',
        })
        markOccupied(wx, wz, packed ? 0.4 : 0.8)
      }
    }
  }

  // ================================================================
  // Pass 3 — 分区内部装饰（按类型差异化）
  // ================================================================

  const INTERIOR_STEP = packed ? 1 : 2
  for (let row = INTERIOR_STEP; row < R - INTERIOR_STEP; row += INTERIOR_STEP) {
    for (let col = INTERIOR_STEP; col < R - INTERIOR_STEP; col += INTERIOR_STEP) {
      const idx = row * R + col
      if (pathingGrid[idx] === 1) continue

      const wx = (col / (R - 1) - 0.5) * W
      const wz = (row / (R - 1) - 0.5) * H

      if (nearRamp(wx, wz) || nearResource(wx, wz) || inTrench(wx, wz) || inBorder(wx, wz)) continue

      const zone = getZoneAtWorld(wx, wz)
      const zoneCfg = getZoneDecoConfig(zone)

      let interiorProb = packed ? Math.max(zoneCfg.interiorDensity, 0.7) : zoneCfg.interiorDensity
      if (zone === 'dense_battle') interiorProb *= denseMul
      if (packed && zone === 'spawn_zone') interiorProb = 0.15
      if (hr(wx, wz, 200) > interiorProb) continue

      const count = packed ? 2 + Math.floor(hr(wx, wz, 204) * 3) : 1 + Math.floor(hr(wx, wz, 204) * 3 * interiorProb)
      for (let i = 0; i < count; i++) {
        const ox = i === 0 ? 0 : (hr(wx + i, wz, 205) - 0.5) * 3.0
        const oz = i === 0 ? 0 : (hr(wx, wz + i, 206) - 0.5) * 3.0
        const px = wx + ox, pz = wz + oz
        if (isOccupied(px, pz)) continue
        if (i > 0 && (nearRamp(px, pz) || inTrench(px, pz) || inBorder(px, pz))) continue

        const typeIdx = Math.floor(hr(px, pz, 201) * zoneCfg.decoTypes.length) % zoneCfg.decoTypes.length
        const decoType = zoneCfg.decoTypes[typeIdx]
        const c = hr(px, pz, 202)

        decos.push({
          id: makeAutoId('_zi', px, pz),
          type: decoType,
          x: px, z: pz,
          r: decoBaseR(decoType),
          rotation: c * Math.PI * 2,
          scale: packed ? 0.5 + hr(px, pz, 203) * 0.4 : 0.7 + hr(px, pz, 203) * 0.5,
          blocksPathing: zoneCfg.blocksPathing && decoType !== 'plant',
          blocksLOS: decoType === 'plant',
        })
        markOccupied(px, pz, packed ? 0.4 : 1.2)
      }
    }
  }

  // ================================================================
  // Pass 4 — 走廊两侧密集装饰（corridor 分区特殊处理）
  // ================================================================
  // corridor 分区的核心视觉效果：两侧紧密排列装饰物，中间留出通道

  const corridorW = advCfg.corridorWidth ?? 4
  for (let row = 1; row < R - 1; row += 1) {
    for (let col = 1; col < R - 1; col += 1) {
      const idx = row * R + col
      if (pathingGrid[idx] === 1) continue

      const wx = (col / (R - 1) - 0.5) * W
      const wz = (row / (R - 1) - 0.5) * H

      const zone = getZoneAtWorld(wx, wz)
      if (zone !== 'corridor') continue

      if (nearRamp(wx, wz) || nearResource(wx, wz) || inTrench(wx, wz) || inBorder(wx, wz)) continue

      // 距离分区中心太近 = 通道核心，不放装饰
      let nearestD = Infinity
      for (const z of zones) {
        if (z.type === 'corridor') {
          const d = Math.hypot(z.cx - wx, z.cz - wz)
          if (d < nearestD) nearestD = d
        }
      }
      if (nearestD < corridorW) continue

      if (hr(wx, wz, 300) > (packed ? 0.95 : 0.7) * edgeMul) continue
      if (isOccupied(wx, wz)) continue

      const c = hr(wx, wz, 301)
      const useBarricade = hr(wx, wz, 302) < 0.3
      const type = useBarricade ? 'barricade' : 'rock'

      decos.push({
        id: makeAutoId('_zc', wx, wz),
        type,
        x: wx, z: wz,
        r: decoBaseR(type),
        rotation: c * Math.PI * 2,
        scale: packed ? 0.6 + hr(wx, wz, 303) * 0.3 : 0.8 + hr(wx, wz, 303) * 0.3,
        blocksPathing: true,
        blocksLOS: false,
      })
      markOccupied(wx, wz, packed ? 0.4 : 1.2)
    }
  }

  // ================================================================
  // Pass 5 — 地图边界岩石（保留原有逻辑）
  // ================================================================
  {
    const EW = W / 2, EH = H / 2
    const INSET = 5.0
    const CLUSTER_STEP = 20.0
    const SCATTER = 5.0

    function placeEdgeCluster(cx: number, cz: number, saltBase: number) {
      const count = 6 + Math.floor(hr(cx, cz, saltBase) * 3)
      for (let i = 0; i < count; i++) {
        const a = hr(cx * 1.3 + i, cz * 0.7, saltBase + i)
        const b = hr(cx * 0.7, cz * 1.3 + i, saltBase + i + 1)
        const c = hr(cx + i * 2.1, cz + i * 1.7, saltBase + i + 2)
        const px = cx + (a - 0.5) * SCATTER * 2
        const pz = cz + (b - 0.5) * SCATTER * 2
        if (nearResource(px, pz) || nearRamp(px, pz) || inTrench(px, pz) || inBorder(px, pz)) return
        if (isOccupied(px, pz)) continue
        decos.push({
          id: makeAutoId('_ze', px, pz),
          type: 'rock',
          x: px, z: pz,
          r: decoBaseR('rock'),
          rotation: c * Math.PI * 2,
          scale: 0.8 + a * 0.4,
          blocksPathing: false,
          blocksLOS: false,
        })
        markOccupied(px, pz, 1.5)
      }
    }

    let edgeSalt = 50
    for (const [cx, cz] of [
      [-EW + INSET, -EH + INSET], [EW - INSET, -EH + INSET],
      [-EW + INSET, EH - INSET],  [EW - INSET, EH - INSET],
    ] as [number, number][]) {
      placeEdgeCluster(cx, cz, edgeSalt)
      placeEdgeCluster(cx + (hr(cx, cz, edgeSalt + 1) - 0.5) * 4,
                       cz + (hr(cx, cz, edgeSalt + 2) - 0.5) * 4, edgeSalt + 3)
      edgeSalt += 10
    }
    for (const ez of [-EH + INSET, EH - INSET]) {
      for (let ex = -EW + CLUSTER_STEP; ex < EW - INSET; ex += CLUSTER_STEP) {
        if (hr(ex, ez, edgeSalt) < 0.70) placeEdgeCluster(ex, ez, edgeSalt)
        edgeSalt += 7
      }
    }
    for (const ex of [-EW + INSET, EW - INSET]) {
      for (let ez = -EH + CLUSTER_STEP; ez < EH - INSET; ez += CLUSTER_STEP) {
        if (hr(ex, ez, edgeSalt) < 0.70) placeEdgeCluster(ex, ez, edgeSalt)
        edgeSalt += 7
      }
    }
  }

  return decos
}
