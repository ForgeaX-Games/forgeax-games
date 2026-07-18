/**
 * 地图生成器 — 核心入口
 *
 * 接收一个 MapBlueprint，输出完整的 MapConfig。
 * 使用方式：
 *
 *   import { generateMap } from '@shared/mapgen/generator'
 *   import { redCanyonBlueprint } from '@shared/mapgen/presets/red-canyon'
 *   const map = generateMap(redCanyonBlueprint)
 */

import type { MapBlueprint, MapConfig } from './types'
import { generateTerrain } from './terrainGen'
import { generateResources } from './resources'

/**
 * 根据蓝图生成完整 MapConfig
 */
export function generateMap(bp: MapBlueprint): MapConfig {
  const { heightData, terrainTypes, cliffLevels, pathingGrid, cliffEdges, decorations, trenchGrid, borderGrid, edgeDist } = generateTerrain(bp)

  // 如果蓝图携带了预计算的资源位置（V2 管线），直接使用；否则走 V1 的 generateResources
  const hasPrecomputed = bp.precomputedMinerals && bp.precomputedMinerals.length > 0
  const { minerals: rawMinerals, geysers: rawGeysers } = hasPrecomputed
    ? { minerals: bp.precomputedMinerals!, geysers: bp.precomputedGeysers ?? [] }
    : generateResources(bp.bases)

  // 过滤落在沟壑/边界格子上的矿/气（直接查网格，精确排除）
  const res = bp.resolution
  const W = bp.width, H = bp.height

  function inExcludedZone(x: number, z: number): boolean {
    const EXPAND = 2
    const c0 = Math.round((x / W + 0.5) * (res - 1))
    const r0 = Math.round((z / H + 0.5) * (res - 1))
    for (let dr = -EXPAND; dr <= EXPAND; dr++) {
      for (let dc = -EXPAND; dc <= EXPAND; dc++) {
        const nr = r0 + dr, nc = c0 + dc
        if (nr < 0 || nr >= res || nc < 0 || nc >= res) continue
        if (trenchGrid[nr * res + nc] > 0) return true
        if (borderGrid[nr * res + nc] > 0) return true
      }
    }
    return false
  }

  const minerals    = rawMinerals.filter(m => !inExcludedZone(m.x, m.z))
  const geysers     = rawGeysers.filter(g => !inExcludedZone(g.x, g.z))
  const filteredDecos = decorations.filter(d => !inExcludedZone(d.x, d.z))

  return {
    name: bp.name,
    width: bp.width,
    height: bp.height,
    gridResolution: bp.resolution,
    heightData,
    terrainTypes,
    cliffLevels,
    pathingGrid,
    cliffEdges,
    spawnPoints: [...bp.spawnPoints],
    minerals,
    geysers,
    baseLocations: (bp.bases ?? []).map(b => ({ x: b.ccX, z: b.ccZ })),
    maxHeight: bp.maxHeight,
    decorations: filteredDecos,
    trenchGrid,
    borderGrid,
    edgeDist,
    theme: bp.theme,
  }
}

