// Map scene-pack loader (M18) — reads an EDITABLE `scenes/<id>.pack.json` and
// extracts the map's placement markers (see docs/map-scene-schema.md). The game
// bootstrap uses these to OVERRIDE a blueprint's procedural resource/start
// placements, so editing the scene in the Studio editor moves the real
// resources/starts (terrain stays procedural via the MapRoot blueprint id).
//
// Reading the pack FILE (not a host-instantiated scene) means editor saves flow
// straight to Play on reload, with no dependency on host defaultScene timing.

import type { MineralPatch, VespeneGeyser, SpawnPoint } from './types';

export interface MapSceneMarkers {
  /** Blueprint id from the `MapRoot:<id>` marker (terrain SSOT). */
  blueprintId: string | null;
  spawnPoints: SpawnPoint[];
  minerals: MineralPatch[];
  geysers: VespeneGeyser[];
}

interface PackEntity { localId: number; components: Record<string, Record<string, unknown>>; }

function num(v: unknown, d = 0): number { return typeof v === 'number' && Number.isFinite(v) ? v : d; }

/** Y-rotation (radians) from a Transform quaternion (facing about +Y). */
function facingOf(t: Record<string, unknown>): number {
  const q = Array.isArray(t.quat) ? (t.quat as unknown[]) : [];
  const qy = num(q[1]), qw = num(q[3], 1);
  if (qy === 0 && qw === 1) return 0;
  return 2 * Math.atan2(qy, qw);
}

/** Parse a scene pack's marker entities into map placements. */
export function parseMapScene(pack: unknown): MapSceneMarkers | null {
  const p = pack as { assets?: Array<{ kind?: string; payload?: { entities?: PackEntity[] } }> };
  const scene = p?.assets?.find((a) => a.kind === 'scene');
  const entities = scene?.payload?.entities;
  if (!entities || !Array.isArray(entities)) return null;

  const out: MapSceneMarkers = { blueprintId: null, spawnPoints: [], minerals: [], geysers: [] };
  for (const e of entities) {
    const name = (e.components?.Name as { value?: string } | undefined)?.value;
    if (!name) continue;
    const t = (e.components?.Transform ?? {}) as Record<string, unknown>;
    const pos = Array.isArray(t.pos) ? (t.pos as unknown[]) : [];
    const x = num(pos[0]), z = num(pos[2]);
    const colon = name.indexOf(':');
    const kind = colon >= 0 ? name.slice(0, colon) : name;
    const suffix = colon >= 0 ? name.slice(colon + 1) : '';
    switch (kind) {
      case 'MapRoot':
        out.blueprintId = suffix || null;
        break;
      case 'Start': {
        // suffix = `P<playerId>`
        const pid = suffix.startsWith('P') ? parseInt(suffix.slice(1), 10) : parseInt(suffix, 10);
        out.spawnPoints.push({ x, z, playerId: Number.isFinite(pid) ? pid : 0, facing: facingOf(t) });
        break;
      }
      case 'Mineral': {
        const amt = parseInt(suffix, 10);
        out.minerals.push({ x, z, amount: Number.isFinite(amt) ? amt : 1500 });
        break;
      }
      case 'Geyser': {
        const amt = parseInt(suffix, 10);
        out.geysers.push({ x, z, amount: Number.isFinite(amt) ? amt : 2500 });
        break;
      }
      default: break; // unknown marker (decoration etc.) — ignored this pass
    }
  }
  // A valid map scene must at least name a blueprint + carry starts.
  if (!out.blueprintId && out.spawnPoints.length === 0) return null;
  return out;
}

/**
 * Fetch + parse `scenes/<id>.pack.json` (browser only). Returns null on any
 * failure (missing file / bad JSON / no markers) so the caller falls back to the
 * pure procedural map. Sorted so mineral/geyser order is deterministic.
 */
export async function loadMapScene(mapId: string): Promise<MapSceneMarkers | null> {
  if (typeof fetch === 'undefined') return null;
  try {
    const url = new URL(`../../scenes/${mapId}.pack.json`, import.meta.url).href;
    const res = await fetch(url);
    if (!res.ok) return null;
    const json = await res.json();
    return parseMapScene(json);
  } catch {
    return null;
  }
}
