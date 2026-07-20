/**
 * 地形纹理主题配色系统
 *
 * 每个 theme 定义 6 种可绘制地形的基础 RGB 颜色（0-1 范围）。
 * Lava/Water/Void/Border 等功能性颜色不随主题变化。
 */

export type TerrainThemeId =
  | 'volcanic' | 'canyon' | 'arctic' | 'badlands'
  | 'swamp' | 'desert' | 'jungle' | 'volcanic_dark'
  | 'lunar' | 'rust' | 'tundra' | 'crystal' | 'ashland'

export interface TerrainThemePalette {
  regolith: [number, number, number]
  sand:     [number, number, number]
  rock:     [number, number, number]
  crater:   [number, number, number]
  cliff:    [number, number, number]
  ramp:     [number, number, number]
}

export interface TerrainThemeDef {
  id: TerrainThemeId
  name: string
  palette: TerrainThemePalette
}

export const TERRAIN_THEMES: Record<TerrainThemeId, TerrainThemeDef> = {
  volcanic: {
    id: 'volcanic', name: '火山',
    palette: {
      regolith: [0.52, 0.22, 0.12],   // 暗红褐土 — 主基调
      sand:     [0.72, 0.50, 0.28],   // 明亮橙黄沙 — 明显偏亮偏暖
      rock:     [0.28, 0.22, 0.22],   // 深灰黑岩 — 暗沉冷色
      crater:   [0.14, 0.08, 0.05],   // 近乎焦黑 — 最暗
      cliff:    [0.35, 0.20, 0.28],   // 暗紫褐 — 带紫色调偏移
      ramp:     [0.62, 0.42, 0.22],   // 暖沙岩 — 金色调过渡
    },
  },
  canyon: {
    id: 'canyon', name: '峡谷',
    palette: {
      regolith: [0.60, 0.32, 0.18],   // 赤土
      sand:     [0.82, 0.62, 0.38],   // 亮金沙
      rock:     [0.32, 0.18, 0.14],   // 深红褐岩
      crater:   [0.16, 0.08, 0.06],   // 焦土
      cliff:    [0.42, 0.22, 0.30],   // 紫红岩壁
      ramp:     [0.68, 0.48, 0.28],   // 赭黄过渡
    },
  },
  arctic: {
    id: 'arctic', name: '极地',
    palette: {
      regolith: [0.68, 0.72, 0.78],   // 冰蓝灰地
      sand:     [0.88, 0.90, 0.92],   // 近白雪地
      rock:     [0.35, 0.38, 0.48],   // 深蓝灰岩
      crater:   [0.20, 0.22, 0.32],   // 深冰蓝坑
      cliff:    [0.30, 0.35, 0.50],   // 蓝紫冰壁
      ramp:     [0.58, 0.62, 0.72],   // 亮冰蓝过渡
    },
  },
  badlands: {
    id: 'badlands', name: '荒地',
    palette: {
      regolith: [0.45, 0.36, 0.25],   // 枯土
      sand:     [0.68, 0.55, 0.35],   // 亮黄土
      rock:     [0.25, 0.22, 0.20],   // 深灰棕岩
      crater:   [0.12, 0.10, 0.08],   // 焦炭
      cliff:    [0.30, 0.24, 0.32],   // 暗紫棕壁
      ramp:     [0.55, 0.44, 0.28],   // 赭黄过渡
    },
  },
  swamp: {
    id: 'swamp', name: '沼泽',
    palette: {
      regolith: [0.28, 0.40, 0.22],   // 暗沼绿
      sand:     [0.52, 0.62, 0.35],   // 亮苔绿
      rock:     [0.18, 0.20, 0.16],   // 深墨绿岩
      crater:   [0.08, 0.12, 0.06],   // 黑泥
      cliff:    [0.22, 0.28, 0.32],   // 蓝绿岩壁
      ramp:     [0.42, 0.50, 0.30],   // 黄绿过渡
    },
  },
  desert: {
    id: 'desert', name: '沙漠',
    palette: {
      regolith: [0.75, 0.60, 0.38],   // 沙褐
      sand:     [0.92, 0.82, 0.58],   // 明亮金沙
      rock:     [0.42, 0.32, 0.22],   // 深棕岩
      crater:   [0.28, 0.18, 0.10],   // 深褐坑
      cliff:    [0.48, 0.35, 0.40],   // 紫褐岩壁
      ramp:     [0.80, 0.65, 0.42],   // 亮赭黄过渡
    },
  },
  jungle: {
    id: 'jungle', name: '丛林',
    palette: {
      regolith: [0.32, 0.42, 0.18],   // 深橄榄绿
      sand:     [0.58, 0.65, 0.32],   // 亮黄绿
      rock:     [0.20, 0.18, 0.15],   // 深棕黑岩
      crater:   [0.10, 0.12, 0.06],   // 深苔黑
      cliff:    [0.25, 0.30, 0.35],   // 蓝灰绿壁
      ramp:     [0.48, 0.52, 0.25],   // 黄绿过渡
    },
  },
  volcanic_dark: {
    id: 'volcanic_dark', name: '暗黑火山',
    palette: {
      regolith: [0.20, 0.10, 0.08],   // 焦黑红
      sand:     [0.40, 0.22, 0.12],   // 暗橙褐
      rock:     [0.12, 0.10, 0.12],   // 近黑紫
      crater:   [0.06, 0.03, 0.02],   // 极深黑
      cliff:    [0.18, 0.10, 0.18],   // 暗紫壁
      ramp:     [0.32, 0.18, 0.10],   // 暗赭过渡
    },
  },
  lunar: {
    id: 'lunar', name: '月球',
    palette: {
      regolith: [0.55, 0.54, 0.52],   // 中灰（微暖）
      sand:     [0.78, 0.76, 0.72],   // 亮银灰
      rock:     [0.30, 0.30, 0.34],   // 深蓝灰
      crater:   [0.15, 0.15, 0.18],   // 极深灰蓝
      cliff:    [0.28, 0.26, 0.36],   // 紫灰壁
      ramp:     [0.62, 0.60, 0.58],   // 暖银过渡
    },
  },
  rust: {
    id: 'rust', name: '锈蚀',
    palette: {
      regolith: [0.50, 0.24, 0.12],   // 锈红
      sand:     [0.72, 0.45, 0.22],   // 亮铜橙
      rock:     [0.22, 0.16, 0.14],   // 深锈黑
      crater:   [0.12, 0.06, 0.04],   // 焦锈
      cliff:    [0.30, 0.18, 0.25],   // 紫锈壁
      ramp:     [0.58, 0.35, 0.18],   // 铜色过渡
    },
  },
  tundra: {
    id: 'tundra', name: '冻原',
    palette: {
      regolith: [0.50, 0.46, 0.35],   // 枯黄土
      sand:     [0.75, 0.70, 0.55],   // 亮枯草
      rock:     [0.28, 0.26, 0.25],   // 深灰棕
      crater:   [0.15, 0.14, 0.12],   // 深冻土
      cliff:    [0.32, 0.30, 0.38],   // 冰紫壁
      ramp:     [0.60, 0.55, 0.40],   // 暖枯黄过渡
    },
  },
  crystal: {
    id: 'crystal', name: '水晶矿',
    palette: {
      regolith: [0.32, 0.28, 0.48],   // 紫灰底
      sand:     [0.55, 0.52, 0.75],   // 亮紫蓝
      rock:     [0.18, 0.16, 0.30],   // 深紫岩
      crater:   [0.08, 0.06, 0.18],   // 极深靛
      cliff:    [0.25, 0.18, 0.45],   // 亮紫壁
      ramp:     [0.48, 0.42, 0.65],   // 亮紫过渡
    },
  },
  ashland: {
    id: 'ashland', name: '灰烬地',
    palette: {
      regolith: [0.28, 0.24, 0.26],   // 灰烬
      sand:     [0.48, 0.42, 0.40],   // 亮灰褐
      rock:     [0.15, 0.13, 0.16],   // 深炭黑
      crater:   [0.06, 0.05, 0.07],   // 极深灰
      cliff:    [0.22, 0.18, 0.28],   // 暗紫壁
      ramp:     [0.38, 0.32, 0.32],   // 暖灰过渡
    },
  },
}

export const DEFAULT_THEME: TerrainThemeId = 'volcanic'

/** RGB 0-1 → RGB 0-255 for CSS/2D canvas */
export function paletteToCSS(rgb: [number, number, number]): string {
  return `rgb(${Math.round(rgb[0] * 255)},${Math.round(rgb[1] * 255)},${Math.round(rgb[2] * 255)})`
}

/** RGB 0-1 → [R,G,B] 0-255 for 2D canvas */
export function paletteTo255(rgb: [number, number, number]): [number, number, number] {
  return [Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255)]
}

export function getThemePalette(id: TerrainThemeId | string): TerrainThemePalette {
  return (TERRAIN_THEMES[id as TerrainThemeId] ?? TERRAIN_THEMES[DEFAULT_THEME]).palette
}
