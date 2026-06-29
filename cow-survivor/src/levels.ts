// Levels — per-stage configuration for the multi-level campaign.
//
// Each level owns: which scene pack to instantiate, the lighting mood
// (skylight intensity + the player's follow point-light), the enemy spawn
// tables, and the survive-duration that clears the stage. Everything the
// spawner used to hardcode against global elapsed time now lives here, so
// a stage can have a completely different bestiary and pacing.
//
// Scene packs live in ./scenes/<id>.pack.json (one file per level — the editor
// discovers + edits the same files via its scenes/ level scan, and asset-first
// Play loads them by GUID from the per-game catalog, which scans scenes/ too).

import type { EnemyKind } from './enemies';

export interface SpawnPhase {
  /** Phase applies while level-elapsed < until (s). Last phase is the tail
   *  (its `until` is ignored — use Infinity by convention). */
  until: number;
  /** Cumulative-probability table: [kind, cumulative] rows, last row = 1. */
  weights: Array<[EnemyKind, number]>;
}

export interface LevelSpawnConfig {
  phases: SpawnPhase[];
  /** Alive cap: min(aliveCap, aliveBase + floor(elapsed/10) * alivePer10s). */
  aliveBase: number;
  alivePer10s: number;
  aliveCap: number;
  /** Wave size: waveBase + rand(0..waveRand) + min(waveGrowthCap, floor(elapsed/25)). */
  waveBase: number;
  waveRand: number;
  waveGrowthCap: number;
  /** Spawn cadence: max(intervalMin, intervalStart - elapsed * intervalAccel). */
  intervalStart: number;
  intervalMin: number;
  intervalAccel: number;
  boss: EnemyKind;
  bossFirstAt: number;
  bossInterval: number;
}

export interface LevelConfig {
  id: string;
  /** Big banner shown on level start (and in the HUD stage chip). */
  name: string;
  subtitle: string;
  scenePack: string;
  /** Survive this long (s) to clear the stage. */
  duration: number;
  /** Skylight intensity for the mood (day vs night). */
  skylightIntensity: number;
  /** The point light that follows the player. */
  playerLight: { color: [number, number, number]; intensity: number; range: number };
  spawn: LevelSpawnConfig;
}

export const LEVELS: LevelConfig[] = [
  // ── Level 1 — Day · the classic cow pasture ─────────────────────────────
  {
    id: 'level1',
    name: '奶 牛 关',
    subtitle: '生存吧~',
    scenePack: './scenes/level1.pack.json',
    duration: 180,
    skylightIntensity: 0.12,
    playerLight: { color: [1, 0.55, 0.35], intensity: 12, range: 6 },
    spawn: {
      phases: [
        { until: 20, weights: [['grasscalf', 0.65], ['ragingcow', 1]] },
        { until: 60, weights: [['grasscalf', 0.35], ['ragingcow', 0.60], ['sparkcalf', 0.85], ['bloodcow', 1]] },
        { until: 120, weights: [['grasscalf', 0.18], ['ragingcow', 0.40], ['sparkcalf', 0.62], ['bloodcow', 0.80], ['toxiccow', 0.92], ['stonebull', 1]] },
        { until: Infinity, weights: [['grasscalf', 0.10], ['ragingcow', 0.25], ['sparkcalf', 0.42], ['bloodcow', 0.58], ['toxiccow', 0.74], ['shadowstalker', 0.88], ['stonebull', 1]] },
      ],
      aliveBase: 28, alivePer10s: 5, aliveCap: 90,
      waveBase: 5, waveRand: 6, waveGrowthCap: 8,
      intervalStart: 3.2, intervalMin: 1.0, intervalAccel: 0.018,
      boss: 'cowking', bossFirstAt: 60, bossInterval: 90,
    },
  },

  // ── Level 2 — Night · the graveyard, new bestiary ───────────────────────
  {
    id: 'level2',
    name: '暗 夜 墓 园',
    subtitle: '黑暗中有什么在动…',
    scenePack: './scenes/level2.pack.json',
    duration: 240,
    skylightIntensity: 0.04,
    // Cold moonlight follows the player instead of the warm D2 torch.
    playerLight: { color: [0.45, 0.6, 1.0], intensity: 10, range: 7 },
    spawn: {
      phases: [
        { until: 20, weights: [['batling', 0.6], ['gravewalker', 1]] },
        { until: 60, weights: [['batling', 0.35], ['gravewalker', 0.62], ['nighthowler', 0.88], ['sparkcalf', 1]] },
        { until: 120, weights: [['batling', 0.20], ['gravewalker', 0.44], ['nighthowler', 0.66], ['shadowstalker', 0.82], ['toxiccow', 1]] },
        { until: Infinity, weights: [['batling', 0.12], ['gravewalker', 0.32], ['nighthowler', 0.54], ['shadowstalker', 0.72], ['toxiccow', 0.86], ['stonebull', 1]] },
      ],
      aliveBase: 32, alivePer10s: 5, aliveCap: 95,
      waveBase: 6, waveRand: 6, waveGrowthCap: 9,
      intervalStart: 3.0, intervalMin: 0.9, intervalAccel: 0.02,
      boss: 'vampirelord', bossFirstAt: 75, bossInterval: 100,
    },
  },
];
