import {
  BOARD_TILE_DEFS,
  COASTAL_PORT_CYCLE,
  PORT_LABELS,
  TERRAIN_INFO,
  type PortKind,
  type TerrainType,
} from './constants';
import type { BoardGraph, BoardTile, Edge, Vertex } from './types';

const AXIAL_NEIGHBORS = [
  { dq: 1, dr: 0 },
  { dq: 1, dr: -1 },
  { dq: 0, dr: -1 },
  { dq: -1, dr: 0 },
  { dq: -1, dr: 1 },
  { dq: 0, dr: 1 },
];

export const HEX_SIZE = 30;

export function cornerPos(q: number, r: number, corner: number, size: number): { x: number; y: number } {
  const cx = size * Math.sqrt(3) * (q + r / 2);
  const cy = size * (3 / 2) * r;
  const ang = (Math.PI / 180) * (60 * corner - 30);
  return { x: cx + size * Math.cos(ang), y: cy + size * Math.sin(ang) };
}

function posKey(x: number, y: number): string {
  return `${x.toFixed(2)},${y.toFixed(2)}`;
}

function edgeKey(v1: string, v2: string): string {
  return v1 < v2 ? `${v1}|${v2}` : `${v2}|${v1}`;
}

/** Build full board graph from tile definitions */
export function buildBoardGraph(): BoardGraph {
  const tiles: BoardTile[] = BOARD_TILE_DEFS.map((t, id) => ({ id, ...t }));
  const tileByQr = new Map(tiles.map((t) => [`${t.q},${t.r}`, t]));
  const vertices = new Map<string, Vertex>();
  const edges = new Map<string, Edge>();

  const posToVertex = new Map<string, string>();

  for (const tile of tiles) {
    for (let c = 0; c < 6; c++) {
      const p = cornerPos(tile.q, tile.r, c, HEX_SIZE);
      const pk = posKey(p.x, p.y);
      let vid = posToVertex.get(pk);
      if (!vid) {
        vid = `v_${vertices.size}`;
        posToVertex.set(pk, vid);
        vertices.set(vid, { id: vid, x: p.x, y: p.y, tileIds: [], port: null });
      }
      const v = vertices.get(vid)!;
      if (!v.tileIds.includes(tile.id)) v.tileIds.push(tile.id);

      const c2 = (c + 1) % 6;
      const p2 = cornerPos(tile.q, tile.r, c2, HEX_SIZE);
      const pk2 = posKey(p2.x, p2.y);
      let vid2 = posToVertex.get(pk2);
      if (!vid2) {
        vid2 = `v_${vertices.size}`;
        posToVertex.set(pk2, vid2);
        vertices.set(vid2, { id: vid2, x: p2.x, y: p2.y, tileIds: [], port: null });
      }
      const ek = edgeKey(vid, vid2);
      if (!edges.has(ek)) {
        edges.set(ek, { id: ek, v1: vid, v2: vid2, tileIds: [tile.id] });
      } else {
        const e = edges.get(ek)!;
        if (!e.tileIds.includes(tile.id)) e.tileIds.push(tile.id);
      }
    }
  }

  assignCoastalPorts(vertices);

  const desert = tiles.find((t) => t.terrain === 'desert')!;

  return {
    tiles,
    vertices,
    edges,
    robberTileId: desert.id,
  };
}

export function tileAt(board: BoardGraph, q: number, r: number): BoardTile | undefined {
  return board.tiles.find((t) => t.q === q && t.r === r);
}

export function terrainLabel(terrain: TerrainType): string {
  return TERRAIN_INFO[terrain].name;
}

/** Place trade ports on evenly spaced coastal vertices (sorted CCW from east). */
function assignCoastalPorts(vertices: Map<string, Vertex>): void {
  const coastal = [...vertices.values()].filter((v) => v.tileIds.length < 3);
  coastal.sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x));
  const step = Math.max(1, Math.round(coastal.length / COASTAL_PORT_CYCLE.length));
  let pi = 0;
  for (let i = 0; i < coastal.length && pi < COASTAL_PORT_CYCLE.length; i += step) {
    coastal[i]!.port = COASTAL_PORT_CYCLE[pi]!;
    pi++;
  }
}

export function portLabel(kind: PortKind): string {
  return PORT_LABELS[kind];
}

export function formatBoardSummary(board: BoardGraph): string[] {
  const lines: string[] = ['【地图生成】37 格六边形资源板（外围每边 5 格）'];
  for (const t of board.tiles) {
    const info = TERRAIN_INFO[t.terrain];
    const num = t.number !== null ? ` 点数:${t.number}` : ' [沙漠·强盗起点]';
    lines.push(`  #${t.id} (${t.q},${t.r}) ${info.name}${num} → ${info.resource ? info.resource : '无'}`);
  }
  lines.push(`顶点 ${board.vertices.size} 个，边 ${board.edges.size} 条`);
  let portCount = 0;
  for (const v of board.vertices.values()) if (v.port) portCount++;
  lines.push(`港口顶点 ${portCount} 个`);
  return lines;
}

export function getAdjacentVertices(board: BoardGraph, vertexId: string): string[] {
  const out = new Set<string>();
  for (const e of board.edges.values()) {
    if (e.v1 === vertexId) out.add(e.v2);
    if (e.v2 === vertexId) out.add(e.v1);
  }
  return [...out];
}

export function getVertexEdges(board: BoardGraph, vertexId: string): string[] {
  const out: string[] = [];
  for (const e of board.edges.values()) {
    if (e.v1 === vertexId || e.v2 === vertexId) out.push(e.id);
  }
  return out;
}

export function hexPixelCenter(q: number, r: number, size = HEX_SIZE): { x: number; y: number } {
  return {
    x: size * Math.sqrt(3) * (q + r / 2),
    y: size * (3 / 2) * r,
  };
}

export function boardBounds(board: BoardGraph): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const v of board.vertices.values()) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }
  const pad = HEX_SIZE;
  return { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
}

/** Neighbor hex across edge shared by tile */
export function neighborTileIds(board: BoardGraph, tileId: number): number[] {
  const tile = board.tiles[tileId];
  if (!tile) return [];
  const out: number[] = [];
  for (const { dq, dr } of AXIAL_NEIGHBORS) {
    const n = board.tiles.find((t) => t.q === tile.q + dq && t.r === tile.r + dr);
    if (n) out.push(n.id);
  }
  return out;
}
