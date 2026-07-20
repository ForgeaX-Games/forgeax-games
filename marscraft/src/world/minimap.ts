/**
 * MarsCraft -> forgeax-engine — Minimap (Milestone M10)
 * =============================================================================
 * Port of the Three.js source `web/world/Minimap.ts`. A bottom-left DOM <canvas>
 * overlay (absolute-positioned over `#app`, the proven 2D-UI pattern in this port
 * — same as the selection marquee), redrawn each frame from:
 *   - a cached terrain base image (downsampled heightData + terrainTypes colors),
 *   - a fog overlay (unseen = near-black, explored-not-visible = dimmed) read from
 *     the VisionSystem grid,
 *   - unit blips (own = blue, enemy = red, neutral = grey) drawn ONLY where the
 *     local player can currently see/explore them (enemies in fog are not drawn;
 *     cloaked-undetected enemies are not drawn),
 *   - mineral (cyan) / geyser (green) markers,
 *   - the camera viewport rectangle (white) from the RTS camera handle.
 * LEFT-click / drag recenters the camera via `cam.jumpTo(worldX, worldZ)`.
 *
 * Adaptations from the source:
 *   - The source was an ECS `System` with `world.query(...)`; forgeax exposes
 *     entity enumeration only inside a system callback, so the minimap registers
 *     its OWN per-frame system that snapshots units into a plain array, then the
 *     canvas is redrawn from that snapshot (throttled to ~15fps). No ad-hoc query.
 *   - Right-click-to-move-camera-issued-order is dropped (the source forwarded it
 *     to a command callback; movement orders are issued through the in-world
 *     right-click in command-layer). LEFT-click camera jump is kept (the headline
 *     interaction the brief asks for).
 *
 * Everything is DOM-guarded: if `document` / the `#app` canvas is absent (headless),
 * the minimap no-ops and never throws.
 */

import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { Transform } from '@forgeax/engine-runtime';
import { Faction, Garrisoned, Building, PLAYER_ID } from '../components';
import type { MapConfig } from '../mapgen/types';
import type { VisionHandle } from '../systems/vision-system';
import type { DetectionHandle } from '../systems/detection-system';
import { resolveUiHost } from '../ui/ui-host';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Batch = any;

/** Minimal camera handle the minimap reads (subset of installRtsCamera's return). */
export interface MinimapCamera {
  jumpTo(x: number, z: number): void;
  readonly focusX: number;
  readonly focusZ: number;
  readonly distance: number;
}

export interface MinimapDeps {
  map: MapConfig;
  cam: MinimapCamera;
  vision: VisionHandle;
  detection?: DetectionHandle;
  localPlayerId: number;
  /** Canvas pixel size (square). Default 200. */
  size?: number;
  /** Margin from the screen edges (px). Default 12. */
  margin?: number;
  /** Optional overlay drawn AFTER the base map each frame (e.g. alert pings). */
  overlay?: (ctx: CanvasRenderingContext2D, mapWidth: number, mapHeight: number, size: number) => void;
}

/** Faction blip colors (own=blue, enemy=red, neutral=grey). */
const BLIP_COLOR: Record<number, string> = {
  [PLAYER_ID.PLAYER]: 'rgb(74,150,255)',
  [PLAYER_ID.ENEMY]: 'rgb(226,74,63)',
  [PLAYER_ID.NEUTRAL]: 'rgb(150,150,150)',
};

interface UnitBlip { x: number; z: number; playerId: number; isBuilding: boolean }

export interface MinimapHandle {
  /** Remove the canvas + listeners (HMR / teardown). */
  dispose(): void;
  /** True if the canvas was actually created (DOM present). */
  active(): boolean;
}

export function installMinimap(world: World, deps: MinimapDeps): MinimapHandle {
  const { map, cam, vision, detection, localPlayerId } = deps;
  const size = deps.size ?? 200;
  const margin = deps.margin ?? 12;

  // ── DOM guard ──────────────────────────────────────────────────────────────
  if (typeof document === 'undefined') {
    // headless — register nothing, return a no-op handle.
    return { dispose() {}, active() { return false; } };
  }

  // Mount into the disposable #game-ui-root so it's not stranded on Stop.
  const parent = resolveUiHost();

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  canvas.id = 'marscraft-minimap';
  canvas.style.position = 'absolute';
  canvas.style.left = margin + 'px';
  canvas.style.bottom = margin + 'px';
  canvas.style.width = size + 'px';
  canvas.style.height = size + 'px';
  canvas.style.zIndex = '50';
  canvas.style.cursor = 'crosshair';
  canvas.style.imageRendering = 'pixelated';
  canvas.style.border = '2px solid rgba(255,102,51,0.4)';
  canvas.style.borderRadius = '4px';
  canvas.style.pointerEvents = 'auto';
  parent.appendChild(canvas);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return { dispose() {}, active() { return false; } };
  }

  // ── terrain base image (static; drawn once) ──────────────────────────────────
  const terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = size;
  terrainCanvas.height = size;
  drawTerrainBase(terrainCanvas, map, size);

  // ── input (left-click / drag -> jumpTo) ──────────────────────────────────────
  let mouseDown = false;
  const canvasToWorld = (cssX: number, cssY: number): { x: number; z: number } => {
    const rect = canvas.getBoundingClientRect();
    const dw = rect.width || size, dh = rect.height || size;
    return {
      x: (cssX / dw) * map.width - map.width / 2,
      z: (cssY / dh) * map.height - map.height / 2,
    };
  };
  const jumpFromEvent = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    const w = canvasToWorld(e.clientX - rect.left, e.clientY - rect.top);
    cam.jumpTo(w.x, w.z);
  };
  const onDown = (e: MouseEvent) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    mouseDown = true;
    jumpFromEvent(e);
  };
  const onMove = (e: MouseEvent) => {
    if (!mouseDown) return;
    e.stopPropagation();
    jumpFromEvent(e);
  };
  const onUp = (e: MouseEvent) => { e.stopPropagation(); mouseDown = false; };
  const onCtx = (e: Event) => e.preventDefault();
  canvas.addEventListener('mousedown', onDown);
  canvas.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
  canvas.addEventListener('contextmenu', onCtx);

  // ── per-frame unit snapshot (no ad-hoc world.query) + throttled redraw ───────
  const blips: UnitBlip[] = [];
  let redrawTimer = 0;
  const REDRAW_INTERVAL = 1 / 15; // ~15fps

  world.addSystem({
    name: 'mc-minimap',
    queries: [{ with: [Entity, Transform, Faction] }],
    resources: ['Time'],
    fn: (_w, qr) => {
      const dt = world.getResource<{ dt: number }>('Time')?.dt ?? 0;
      redrawTimer += dt;
      if (redrawTimer < REDRAW_INTERVAL) return;
      redrawTimer = 0;

      // snapshot units.
      blips.length = 0;
      for (const b of qr[0] as unknown as Batch[]) {
        const n = b.Entity.self.length as number;
        for (let i = 0; i < n; i++) {
          const e = b.Entity.self[i] as EntityHandle;
          if (world.get(e, Garrisoned).ok) continue; // inside a transport
          const playerId = b.Faction.playerId[i] as number;
          const x = b.Transform.pos[i * 3] as number;
          const z = b.Transform.pos[i * 3 + 2] as number;
          if (z < -1e6) continue; // off-field stash (garrison) — skip
          // enemy blips drawn only where visible/explored + not cloaked-undetected.
          if (playerId !== localPlayerId && playerId !== PLAYER_ID.NEUTRAL) {
            if (!vision.isVisible(x, z, localPlayerId)) continue;
            if (detection && !detection.isVisibleToEnemy(e)) continue;
          }
          blips.push({ x, z, playerId, isBuilding: world.get(e, Building).ok });
        }
      }

      redraw(ctx, terrainCanvas, blips, deps, size);
      deps.overlay?.(ctx, deps.map.width, deps.map.height, size);
    },
  });

  return {
    dispose() {
      canvas.removeEventListener('mousedown', onDown);
      canvas.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      canvas.removeEventListener('contextmenu', onCtx);
      canvas.remove();
    },
    active() { return true; },
  };
}

// ── drawing helpers ────────────────────────────────────────────────────────────

function drawTerrainBase(canvas: HTMLCanvasElement, map: MapConfig, size: number): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const res = map.gridResolution;
  const cellW = size / res, cellH = size / res;
  ctx.fillStyle = '#1a0a04';
  ctx.fillRect(0, 0, size, size);
  for (let row = 0; row < res; row++) {
    for (let col = 0; col < res; col++) {
      const idx = row * res + col;
      const h = map.heightData[idx] ?? 0;
      const terrain = map.terrainTypes[idx] ?? 0;
      let r: number, g: number, b: number;
      switch (terrain) {
        case 0: r = 110; g = 45; b = 25; break;   // Regolith
        case 1: r = 120; g = 75; b = 35; break;   // Sand
        case 2: r = 80; g = 65; b = 55; break;    // Rock
        case 3: r = 140; g = 150; b = 160; break; // Ice
        case 4: r = 40; g = 24; b = 16; break;    // Crater
        case 5: r = 60; g = 48; b = 38; break;    // Cliff
        case 6: r = 100; g = 76; b = 50; break;   // Ramp
        default: r = 60; g = 40; b = 25;
      }
      const brightness = Math.min(1.3, 1 + h * 0.03);
      r = Math.min(255, Math.floor(r * brightness));
      g = Math.min(255, Math.floor(g * brightness));
      b = Math.min(255, Math.floor(b * brightness));
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(col * cellW, row * cellH, cellW + 0.5, cellH + 0.5);
    }
  }
}

function redraw(
  ctx: CanvasRenderingContext2D,
  terrainCanvas: HTMLCanvasElement,
  blips: UnitBlip[],
  deps: MinimapDeps,
  size: number,
): void {
  const { map, cam, vision, localPlayerId } = deps;

  // 1. terrain base.
  ctx.drawImage(terrainCanvas, 0, 0);

  // 2. fog overlay (coarse grid; black = unexplored, dim = explored-not-visible).
  const fres = 32;
  const cw = size / fres, ch = size / fres;
  for (let row = 0; row < fres; row++) {
    for (let col = 0; col < fres; col++) {
      const worldX = (col + 0.5) / fres * map.width - map.width / 2;
      const worldZ = (row + 0.5) / fres * map.height - map.height / 2;
      const state = vision.getFogState(worldX, worldZ, localPlayerId);
      if (state === 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(col * cw, row * ch, cw + 0.5, ch + 0.5);
      } else if (state === 1) {
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(col * cw, row * ch, cw + 0.5, ch + 0.5);
      }
    }
  }

  // 3. resource markers (cyan minerals, green geysers) — only where explored.
  ctx.fillStyle = 'rgba(68,170,255,0.75)';
  for (const m of map.minerals) {
    if (vision.getFogState(m.x, m.z, localPlayerId) === 0) continue;
    const px = ((m.x + map.width / 2) / map.width) * size;
    const py = ((m.z + map.height / 2) / map.height) * size;
    ctx.fillRect(px - 1, py - 1, 2, 2);
  }
  ctx.fillStyle = 'rgba(68,255,102,0.85)';
  for (const g of map.geysers) {
    if (vision.getFogState(g.x, g.z, localPlayerId) === 0) continue;
    const px = ((g.x + map.width / 2) / map.width) * size;
    const py = ((g.z + map.height / 2) / map.height) * size;
    ctx.fillRect(px - 1.5, py - 1.5, 3, 3);
  }

  // 4. unit blips (already vision-gated for enemies in the snapshot).
  for (const u of blips) {
    const px = ((u.x + map.width / 2) / map.width) * size;
    const py = ((u.z + map.height / 2) / map.height) * size;
    ctx.fillStyle = BLIP_COLOR[u.playerId] ?? 'rgb(255,255,255)';
    const s = u.isBuilding ? 3 : 2;
    ctx.fillRect(px - s / 2, py - s / 2, s, s);
  }

  // 5. camera viewport rectangle (white) from the RTS camera focus + distance.
  const viewW = (cam.distance * 1.5 / map.width) * size;
  const viewH = (cam.distance * 1.0 / map.height) * size;
  const cx = ((cam.focusX + map.width / 2) / map.width) * size;
  const cy = ((cam.focusZ + map.height / 2) / map.height) * size;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(cx - viewW / 2, cy - viewH / 2, viewW, viewH);

  // 6. border.
  ctx.strokeStyle = 'rgba(255,102,51,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(0, 0, size, size);
}
