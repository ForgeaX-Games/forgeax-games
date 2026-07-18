/**
 * MarsCraft -> forgeax-engine — MinimapAlertPing (M19 UI port)
 * =============================================================================
 * Port of the Three.js source `web/ui/MinimapAlertPing.ts`: pulsing rings drawn
 * on the minimap canvas at world positions (alert locations). `addPing(x,z,color)`
 * queues one; `render(ctx, mapW, mapH, size)` (wired as the minimap `overlay`)
 * draws + expires them. Expanding-ring + fading pulse, exactly as the source.
 */

const PING_DURATION = 4000;   // ms a ping lives
const PING_MIN_RADIUS = 3;
const PING_MAX_RADIUS = 10;

interface Ping { worldX: number; worldZ: number; color: string; startTime: number; duration: number; }

export interface MinimapPingHandle {
  addPing(worldX: number, worldZ: number, color?: string, duration?: number): void;
  render(ctx: CanvasRenderingContext2D, mapWidth: number, mapHeight: number, size: number): void;
  count(): number;
  clear(): void;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : 0);

export function createMinimapPings(): MinimapPingHandle {
  let pings: Ping[] = [];
  return {
    addPing(worldX, worldZ, color = '#ff4444', duration = PING_DURATION) {
      pings.push({ worldX, worldZ, color, startTime: now(), duration });
    },
    render(ctx, mapWidth, mapHeight, size) {
      const t = now();
      pings = pings.filter((p) => t - p.startTime < p.duration);
      for (const ping of pings) {
        const elapsed = t - ping.startTime;
        const progress = elapsed / ping.duration; // 0→1
        const px = ((ping.worldX + mapWidth / 2) / mapWidth) * size;
        const py = ((ping.worldZ + mapHeight / 2) / mapHeight) * size;
        const pulse = (elapsed / 500) % 1; // 500ms pulse period
        const radius = PING_MIN_RADIUS + pulse * (PING_MAX_RADIUS - PING_MIN_RADIUS);
        const alpha = Math.max(0, 1 - progress) * (1 - pulse * 0.7);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = ping.color;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(px, py, radius, 0, Math.PI * 2); ctx.stroke();
        ctx.globalAlpha = alpha * 0.6;
        ctx.fillStyle = ping.color;
        ctx.beginPath(); ctx.arc(px, py, PING_MIN_RADIUS, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
    },
    count: () => pings.length,
    clear: () => { pings = []; },
  };
}
