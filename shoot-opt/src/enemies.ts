/**
 * Enemies — scene-instance spawners.
 *
 * Each enemy type is an authored scene asset under `assets/enemies/<type>.pack.json`
 * (generated from the original hand-coded builders by `scripts/gen-enemy-scenes.mjs`).
 * A scene's root (localId 0) is an identity-transform container carrying the `Enemy`
 * component; the body + decorative parts are `ChildOf` children. The engine's
 * `propagateTransforms` system moves the whole ship when we move only the container,
 * so callers track one entity (the root) instead of a parts list. // 整艘船跟着龙骨走~ ♪
 *
 * Per-spawn variety (speed / shootTimer / hp scaling with difficulty) is applied as
 * an `Enemy` override after instantiate — the baked scene values are placeholders.
 */
import { Transform, SceneInstance } from '@forgeax/engine-runtime';
import { defineComponent, type EntityHandle } from '@forgeax/engine-ecs';
import type { World } from '@forgeax/engine-ecs';
import { AssetGuid } from '@forgeax/engine-pack/guid';

// kind: 0=fighter 1=bomber 2=interceptor 3=dreadnought 4=scout 5=carrier 6=BOSS 7=assassin 8=spiral
export const Enemy = defineComponent('Enemy', {
  speed: 'f32', shootTimer: 'f32', kind: 'u8',
  hp: 'u16', maxHp: 'u16', hitFlash: 'f32',
});

/** Result returned by every enemy spawn function. */
export interface EnemySpawnResult {
  /**
   * The container entity (scene localId 0) carrying the `Enemy` component.
   * Setting Transform on it moves the whole ship — the body parts are
   * `ChildOf` children and follow via `propagateTransforms`.
   */
  entity: EntityHandle;
  /**
   * The synthetic root entity engine 5dfeb0b6 inserts above every scene
   * instance. Pass it to `world.despawnScene(...)` to tear the whole sub-tree
   * down in one call (root + container + body parts).
   *
   * History: feat-20260608-scene-nesting-ecs-fication ECS-fied SceneInstance —
   * `world.sceneInstances` is gone, `assets.instantiate` now returns the
   * synthetic-root Entity directly, and tear-down is `world.despawnScene(root)`.
   * The Enemy / Transform / gameplay state still lives on the original
   * container (scene localId 0), reachable via `SceneInstance.mapping[0]`.
   */
  instanceId: EntityHandle;
}

/** Map of enemy type → loaded SceneAsset handle (populated by loadEnemyScenes). */
export type EnemyScenes = Record<string, number>;

/** Context passed to every enemy spawner. */
export interface SpawnCtx {
  world: World;
  /** AssetRegistry — `instantiate` (GUID-resolving) lives here. */
  assets: any;
  scenes: EnemyScenes;
}

type EnemyType =
  | 'fighter' | 'bomber' | 'interceptor' | 'dreadnought'
  | 'scout' | 'carrier' | 'assassin' | 'spiral';

/** Scene GUIDs — must match SCENE_GUIDS in scripts/gen-enemy-scenes.mjs. */
const SCENE_GUIDS: Record<EnemyType, string> = {
  fighter:     'da3ff11c-76ec-458e-9e6c-2f14b3308e5a',
  bomber:      '3393696f-f137-47cf-a33b-54c6c8dea008',
  interceptor: 'c7b11f94-8ba4-40ba-9b38-70677a415786',
  dreadnought: '211a3899-89c5-4094-8846-4048bfa3c81b',
  scout:       '06b55f41-5709-4985-896b-063a8e3354b5',
  carrier:     'e90970d3-9b6b-46bf-a2bc-6a01e729b251',
  assassin:    '5f724564-10e9-4fe1-a9bb-e8f560ffabfe',
  spiral:      '786666d1-85cd-4e75-9707-b5095900d948',
};

/**
 * Load all enemy scene assets by GUID. Call once at startup (like registerMaterials).
 * The returned map is threaded into SpawnCtx.scenes.
 */
export async function loadEnemyScenes(assets: any, world: World): Promise<EnemyScenes> {
  const scenes: EnemyScenes = {};
  for (const [type, guidStr] of Object.entries(SCENE_GUIDS)) {
    const guid = AssetGuid.parse(guidStr);
    if (!guid.ok) throw new Error(`[shoot] bad scene GUID for enemy "${type}"`);
    // loadByGuid catalogues the SceneAsset payload (and its mesh/material refs)
    // but returns the PAYLOAD; `assets.instantiate` needs a Handle, so mint the
    // column handle on the World.
    const loaded = await assets.loadByGuid(guid.value);
    if (!loaded.ok) throw new Error(`[shoot] loadByGuid failed for enemy "${type}": ${loaded.error.code}`);
    scenes[type] = world.allocSharedRef('SceneAsset', loaded.value);
  }
  return scenes;
}

/**
 * Instantiate an enemy scene at (x, z) and apply per-spawn Enemy stats.
 * The scene's body already carries the correct mesh/material/orientation; we only
 * move the identity container root to (x, z) — children follow via propagation.
 */
function spawn(
  ctx: SpawnCtx, type: EnemyType, x: number, z: number,
  stats: { speed: number; shootTimer: number; kind: number; hp: number; maxHp: number },
): EnemySpawnResult {
  const { world, assets, scenes } = ctx;
  const res = assets.instantiate(scenes[type], world);
  if (!res.ok) throw new Error(`[shoot] instantiate "${type}" failed: ${res.error?.code ?? res.error}`);
  // Engine 5dfeb0b6: `assets.instantiate` returns the synthetic-root Entity
  // (a fresh entity with identity Transform + SceneInstance, parent of every
  // owned root). The Enemy + Transform we want to drive still live on the
  // original container (scene localId 0), now ChildOf{syntheticRoot}.
  // Reach it via `SceneInstance.mapping[0]`; tear the whole sub-tree down
  // through the synthetic root with `world.despawnScene(synth)` later.
  const synth = res.value as EntityHandle;
  const inst = world.get(synth, SceneInstance);
  if (!inst.ok) throw new Error(`[shoot] SceneInstance lookup failed for "${type}"`);
  const container = inst.value.mapping[0] as EntityHandle;
  world.set(container, Transform, { posX: x, posZ: z });
  world.set(container, Enemy, { ...stats, hitFlash: 0 });
  return { entity: container, instanceId: synth };
}

const RAND = Math.random;

// ── Per-type spawners (stat formulas preserved verbatim from the original builders) ──

export function spawnFighter(ctx: SpawnCtx, x: number, z: number, difficulty: number): EnemySpawnResult {
  return spawn(ctx, 'fighter', x, z, {
    speed: 4.5 + RAND() * 3 + difficulty * 0.6, shootTimer: 0.6 + RAND() * 1.2, kind: 0, hp: 2, maxHp: 2,
  });
}

export function spawnBomber(ctx: SpawnCtx, x: number, z: number, difficulty: number): EnemySpawnResult {
  return spawn(ctx, 'bomber', x, z, {
    speed: 2.2 + RAND() * 1.5 + difficulty * 0.3, shootTimer: 0.4 + RAND() * 0.8, kind: 1, hp: 4, maxHp: 4,
  });
}

export function spawnInterceptor(ctx: SpawnCtx, x: number, z: number, difficulty: number): EnemySpawnResult {
  return spawn(ctx, 'interceptor', x, z, {
    speed: 6 + RAND() * 3 + difficulty * 0.7, shootTimer: 0.5 + RAND() * 0.8, kind: 2, hp: 2, maxHp: 2,
  });
}

export function spawnDreadnought(ctx: SpawnCtx, x: number, z: number, difficulty: number): EnemySpawnResult {
  return spawn(ctx, 'dreadnought', x, z, {
    speed: 1.5 + RAND() * 1.0 + difficulty * 0.15, shootTimer: 0.3 + RAND() * 0.5, kind: 3, hp: 8, maxHp: 8,
  });
}

export function spawnScout(ctx: SpawnCtx, x: number, z: number, difficulty: number): EnemySpawnResult {
  return spawn(ctx, 'scout', x, z, {
    speed: 7 + RAND() * 4 + difficulty * 0.8, shootTimer: 3 + RAND() * 4, kind: 4, hp: 1, maxHp: 1,
  });
}

export function spawnCarrier(ctx: SpawnCtx, x: number, z: number, difficulty: number): EnemySpawnResult {
  return spawn(ctx, 'carrier', x, z, {
    speed: 1.2 + RAND() * 0.8 + difficulty * 0.1, shootTimer: 0.25 + RAND() * 0.3, kind: 5, hp: 12, maxHp: 12,
  });
}

export function spawnAssassin(ctx: SpawnCtx, x: number, z: number, difficulty: number): EnemySpawnResult {
  const hp = 2 + Math.floor(difficulty * 0.3);
  return spawn(ctx, 'assassin', x, z, {
    speed: 3.0 + difficulty * 0.4, shootTimer: 0.8 + RAND(), kind: 7, hp, maxHp: hp,
  });
}

export function spawnSpiral(ctx: SpawnCtx, x: number, z: number, difficulty: number): EnemySpawnResult {
  const hp = 4 + Math.floor(difficulty * 0.4);
  return spawn(ctx, 'spiral', x, z, {
    speed: 2.5 + difficulty * 0.3, shootTimer: 1.2 + RAND(), kind: 8, hp, maxHp: hp,
  });
}
