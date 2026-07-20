// MarsCraft — StarCraft-style 3D RTS, ported from a Three.js implementation
// to the forgeax-engine (WebGPU ECS).
//
// This is the game entry the preview-runtime host calls as
// `bootstrap(world, ctx)` after it has created the renderer + world. The host
// drives the frame loop; we spawn entities + register ECS systems here.
//
// The port proceeds milestone-by-milestone (see PORT-PROGRESS.md). This file
// wires the milestones together; the heavy per-subsystem logic lives in src/*.
//
// ── Coordinate convention (matches the Three.js source) ──────────────────
// World is X (east) / Z (south) ground plane, Y up. The RTS camera looks down
// at an angle. Grid <-> world helpers live in src/world/map.ts.

import {
  Transform, Camera, perspective, quat,
  Skylight, DirectionalLight, ChildOf,
  type Handle, type MaterialAsset,
} from '@forgeax/engine-runtime';
import type { World } from '@forgeax/engine-ecs';
import type { BootstrapContext } from '@forgeax/engine-app';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { generateMap } from './src/mapgen/generator';
import { redCanyonBlueprint } from './src/mapgen/presets/red-canyon';
import { getMapBlueprint, mapIds } from './src/mapgen/map-registry';
import { loadMapScene } from './src/mapgen/scene-loader';
import { buildTerrain } from './src/world/terrain';
import { buildEnvironment } from './src/world/environment';
import { installInput } from './src/input';
import { installRtsCamera } from './src/world/camera';
import { makePrimitives } from './src/world/unit-models';
import { spawnUnit, type UnitFactoryCtx } from './src/systems/unit-factory';
import { installSelection, type SelectionHandle } from './src/systems/selection';
import { installCommandLayer } from './src/systems/command-layer';
import { AttackSystem } from './src/systems/attack-system';
import { ProjectileSystem } from './src/systems/projectile-system';
import { DeathSystem } from './src/systems/death-system';
import { HealthBarSystem } from './src/systems/health-bar';
import { makeProjectileAssets } from './src/systems/projectile-spawn';
import { seedCombatRandom, setCombatRandomSource } from './src/systems/damage-resolver';
import { spawnResourceFields, type ResourceSpawnResult } from './src/world/resources';
import { ResourceManager } from './src/systems/resource-manager';
import { HarvestSystem, type HarvestSystemHandle } from './src/systems/harvest-system';
import { BuildingSystem, type BuildingSystemHandle } from './src/systems/building-system';
import { installPlacement, type PlacementHandle } from './src/systems/placement';
import { installBuildingLift, type BuildingLiftHandle } from './src/systems/building-lift';
import { EnergySystem } from './src/systems/energy-system';
import { BuffSystem } from './src/systems/buff-system';
import { StatModifierSystem } from './src/systems/stat-modifier-system';
import { AbilitySystem, type AbilitySystemHandle } from './src/systems/ability-system';
import { UpgradeManager, type UpgradeManagerHandle } from './src/systems/upgrade-manager';
import { FormSwitchSystem, type FormSwitchHandle } from './src/systems/form-switch';
import { UnitMorphSystem, type UnitMorphHandle } from './src/systems/unit-morph';
import { ShieldRegenSystem } from './src/systems/shield-regen';
import { OutOfCombatSystem } from './src/systems/out-of-combat';
import { MedivacHealSystem } from './src/systems/medivac-heal';
import { ShieldBatterySystem } from './src/systems/shield-battery';
import { CreepHealingSystem } from './src/systems/creep-healing';
import { GroundEffectSystem, type GroundEffectHandle } from './src/systems/ground-effect-system';
import { HazardSystem, type HazardHandle } from './src/systems/hazard-system';
import { DirectionWaveSystem, type DirectionWaveHandle } from './src/systems/direction-wave-system';
import { CreepSystem, type CreepHandle } from './src/systems/creep-system';
import { GarrisonSystem, type GarrisonHandle } from './src/systems/garrison-system';
import { DetectionSystem, type DetectionHandle } from './src/systems/detection-system';
import { SummonSystem, type SummonHandle } from './src/systems/summon-system';
import { TriggerSystem, type TriggerSystemHandle } from './src/systems/trigger-system';
import { VisionSystem, type VisionHandle } from './src/systems/vision-system';
import { FogSystem, type FogHandle } from './src/systems/fog-system';
import { SimpleAI, type SimpleAIHandle } from './src/systems/simple-ai';
import { installMinimap, type MinimapHandle } from './src/world/minimap';
import { installHud, type HudHandle } from './src/ui/hud';
import { installGameOver } from './src/ui/game-over';
import { VictorySystem, type VictoryHandle } from './src/systems/victory-system';
import { installAlerts, type AlertHandle } from './src/ui/alert-system';
import { ControlGroupSystem, type ControlGroupHandle } from './src/systems/control-groups';
import { installControlGroupBar } from './src/ui/control-group-bar';
import { installGameTimeApm, type GameTimeApmHandle } from './src/ui/game-time-apm';
import { installIdleTracker, type IdleTrackerHandle } from './src/ui/idle-tracker';
import { RallyRenderer, type RallyRendererHandle } from './src/systems/rally-renderer';
import { createMinimapPings } from './src/ui/minimap-ping';
import { installUpgradeMarkers, type UpgradeMarkersHandle } from './src/ui/upgrade-markers';
import { installSettingsPanel, type SettingsPanelHandle } from './src/ui/settings-panel';
import { showMainMenu, type MainMenuHandle, type MenuStartOptions, type MenuRace, type MenuDifficulty } from './src/ui/main-menu';
import { RACE_CONFIGS } from './src/data/ai-build-orders';
import { VfxSystem, type VfxHandle, type VfxKind } from './src/systems/vfx-system';
import { BuffAuraSystem, type BuffAuraHandle } from './src/systems/buff-aura-system';
import { StatefulAbilityVfxSystem, type StatefulAbilityVfxHandle } from './src/systems/stateful-ability-vfx-system';
import { addBuff, removeBuff, makeBuff } from './src/systems/abilities-runtime';
import { findBuffConfig } from './src/data/abilities';
import { AudioManager, type AudioManagerHandle, raceNameFromCode } from './src/systems/audio-manager';
import { EventBus } from './src/core/event-bus';
import {
  setFormSwitchHandler, setMorphHandler,
  setGroundEffectHandler, setHazardHandler, setSummonHandler,
  setTransportLoadHandler, setTransportUnloadHandler, setRecallHandler,
  setDirectionWaveHandler,
} from './src/systems/effect-executor';
import { setGarrisonCommandHandler } from './src/systems/command-executor';
import {
  PLAYER_ID, RACE, Faction, Movement, Health, Attack, Harvester, Building, Energy, Abilities,
  UnitStats, UnitType, buildingTypeId, buildingProductionQueue, commandCurrent, abilityIds,
  unitTypeId, formActiveId, abilityBuffs as abilityBuffsImport, BUILDING_STATE,
} from './src/components';
import { getUnitDef } from './src/data/units';
// ── M15 chunk 1: deterministic lockstep sim core (opt-in via ?lockstep=1) ──────
import { LockstepDemo, determinismCheck, determinismDiscriminates } from './src/net/lockstep-demo';
import { computeGameChecksum } from './src/net/checksum-computer';
import { initGameRng, gameRandom } from './src/net/seeded-random';

// Faction colors (packed 0xRRGGBB). Player = blue, enemy = red.
const FACTION_COLOR: Record<number, number> = {
  [PLAYER_ID.PLAYER]: 0x3a8cff,
  [PLAYER_ID.ENEMY]: 0xe24a3f,
};
function factionColor(playerId: number): number {
  return FACTION_COLOR[playerId] ?? 0x888888;
}

// Lit PBR base material (children tint via `parent` + paramValues.baseColor).
const PBR_BASE_GUID = 'b1a4c0de-1111-4a2b-9c3d-000000000001';
// UNLIT base (shader forgeax::default-unlit) — renders baseColor directly, immune to
// scene lighting/IBL/tonemapping. Used for the war-fog decal so unexplored terrain
// reads truly DARK (a lit near-black material got washed to grey by the skylight).
const UNLIT_BASE_GUID = 'b1a4c0de-1111-4a2b-9c3d-000000000002';

type Ctx = { world: World; assets: import('@forgeax/engine-assets-runtime').AssetRegistry };

/**
 * Site a town hall next to a mineral field. The CC is offset from the field
 * centroid TOWARD the map center (0,0) — NOT a fixed +z — so it always lands on
 * the playable side. A fixed `+7` pushed the +z (enemy P2) base into the south
 * border band, wedging its workers on unwalkable cells (0 income). `dir=-1`
 * gives a point on the FIELD side (for placing workers between CC and minerals).
 */
/** Canonical opening worker count (source `getRaceInitialUnits`: 1 base + 12 workers). */
const STARTING_WORKERS = 12;
/** Lay the starting workers in a tidy 4×3 block near the field-side point. */
function workerGridOffset(i: number): { ox: number; oz: number } {
  const cols = 4;
  const col = i % cols, row = Math.floor(i / cols);
  return { ox: (col - (cols - 1) / 2) * 1.6, oz: (row - 1) * 1.6 };
}

function baseSite(cx: number, cz: number, dist = 7, dir = 1): { x: number; z: number } {
  const len = Math.hypot(cx, cz) || 1;
  const ux = -cx / len, uz = -cz / len; // unit vector toward map center
  return { x: cx + ux * dist * dir, z: cz + uz * dist * dir };
}

/**
 * Pick the mineral patch nearest (px,pz) and return it + the centroid of all
 * patches within ~12 units of it (the local field), for siting a base/SCVs.
 */
function nearestMineralCluster(
  world: World,
  fields: ResourceSpawnResult,
  px: number,
  pz: number,
): { entity: import('@forgeax/engine-ecs').EntityHandle; cx: number; cz: number } | null {
  let best: { e: import('@forgeax/engine-ecs').EntityHandle; x: number; z: number } | null = null;
  let bestSq = Infinity;
  const pts: Array<{ x: number; z: number }> = [];
  for (const e of fields.minerals) {
    const t = world.get(e, Transform);
    if (!t.ok) continue;
    const x = t.value.pos[0], z = t.value.pos[2];
    pts.push({ x, z });
    const dsq = (x - px) ** 2 + (z - pz) ** 2;
    if (dsq < bestSq) { bestSq = dsq; best = { e, x, z }; }
  }
  if (!best) return null;
  let sx = 0, sz = 0, n = 0;
  for (const p of pts) {
    if ((p.x - best.x) ** 2 + (p.z - best.z) ** 2 <= 12 * 12) { sx += p.x; sz += p.z; n++; }
  }
  return { entity: best.e, cx: n ? sx / n : best.x, cz: n ? sz / n : best.z };
}

/** Mint a tinted child of the lit PBR base material. */
function litMaterial(world: World, baseGuid: AssetGuid, rgb: [number, number, number], opts?: { metallic?: number; roughness?: number }): Handle<'MaterialAsset', 'shared'> {
  return world.allocSharedRef('MaterialAsset', {
    kind: 'material',
    parent: baseGuid,
    paramValues: {
      baseColor: [rgb[0], rgb[1], rgb[2], 1],
      metallic: opts?.metallic ?? 0,
      roughness: opts?.roughness ?? 0.85,
    },
  } satisfies MaterialAsset);
}

export async function bootstrap(world: World, bctx?: BootstrapContext) {
  const { assets } = bctx ?? {};
  if (!assets) { console.error('[marscraft] no AssetRegistry on BootstrapContext'); return; }
  const ctx: Ctx = { world, assets };

  // Reset the EventBus so a re-bootstrap (HMR / scene reload) doesn't leak stale
  // listeners from a prior TriggerSystem instance bound to a dead world.
  EventBus.reset();

  // ── M17 chunk C.1: pre-game MainMenu setup via ?query params ────────────────
  // The forgeax bootstrap runs the match immediately (no menu phase). So the
  // MainMenu overlay + a query-param RELOAD flow gate it: on a fresh entry
  // (`?game=marscraft`, no `started`) the world is still built (it idles behind
  // the overlay) and the menu is shown; picking settings + Start sets
  // `?started=1&map=&race=&airace=&difficulty=` and reloads. When `started=1`,
  // main.ts reads those params and applies them, and the menu is NOT shown.
  const params = (typeof location !== 'undefined') ? new URLSearchParams(location.search) : new URLSearchParams();
  const startedParam = params.get('started') === '1';
  // `?fixtures=1` — spawn the M9 ability-VERIFY fixtures (a caster + a wounded ally +
  // an enemy) AND a starting army squad. These exist only for e2e/manual verification;
  // a NORMAL match opens like the source (a town hall + 12 workers, no army, no caster).
  const fixturesParam = params.get('fixtures') === '1';
  // `?workers=N` — override the starting worker count per side (default: the source's
  // 12). ONLY for e2e determinism: the timing-sensitive channel tests (real-cast
  // windups) need a light sim so headless FPS stays high enough that game-time
  // isn't dt-clamped into a crawl. A normal match ignores this and opens with 12.
  const workersParam = params.get('workers');
  const startingWorkers = workersParam != null
    ? Math.max(0, Math.min(STARTING_WORKERS, Number.parseInt(workersParam, 10) || 0))
    : STARTING_WORKERS;
  const RACES: MenuRace[] = ['terran', 'zerg', 'protoss'];
  const resolveRace = (v: string | null): { chosen: MenuRace; concrete: import('./src/data/units').RaceType } => {
    const raw = (v ?? 'random').toLowerCase();
    if (raw === 'terran' || raw === 'zerg' || raw === 'protoss') return { chosen: raw, concrete: raw };
    // 'random' (or unknown) -> pick one deterministically-ish (Math.random is fine;
    // for a repeatable pick you can pass an explicit race). Store 'random' as the
    // chosen label but resolve a concrete race for the sim.
    const concrete = RACES[Math.floor(Math.random() * RACES.length)] as import('./src/data/units').RaceType;
    return { chosen: 'random', concrete };
  };
  const diffParam = ((): MenuDifficulty => {
    const d = (params.get('difficulty') ?? 'normal').toLowerCase();
    return (d === 'easy' || d === 'normal' || d === 'hard') ? d : 'normal';
  })();
  const playerRaceRes = resolveRace(params.get('race'));
  const aiRaceRes = resolveRace(params.get('airace'));
  // The resolved match config (read by hooks + applied below when started).
  const matchCfg = {
    started: startedParam,
    difficulty: diffParam,
    playerRace: playerRaceRes.concrete,
    playerRaceChosen: playerRaceRes.chosen,
    aiRace: aiRaceRes.concrete,
    aiRaceChosen: aiRaceRes.chosen,
  };

  const canvas = document.querySelector<HTMLCanvasElement>('#app');
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
  let aspect = 16 / 9;
  if (canvas) {
    canvas.width = Math.max(1, canvas.clientWidth * dpr);
    canvas.height = Math.max(1, canvas.clientHeight * dpr);
    aspect = canvas.width / canvas.height;
  }

  // ── base material ──────────────────────────────────────────────────────
  const baseRes = AssetGuid.parse(PBR_BASE_GUID);
  if (!baseRes.ok) { console.error('[marscraft] base material GUID parse failed'); return; }
  const baseGuid = baseRes.value;
  const loadRes = await assets.loadByGuid<MaterialAsset>(baseGuid);
  if (!loadRes.ok) { console.error('[marscraft] base material loadByGuid failed:', loadRes.error.code); return; }
  // unlit base (same pack) — used only for the fog decal; fall back to the PBR base if
  // it can't be resolved (fog just goes back to the washed-out look, never crashes).
  const unlitParse = AssetGuid.parse(UNLIT_BASE_GUID);
  let unlitBaseGuid = baseGuid;
  if (unlitParse.ok && (await assets.loadByGuid<MaterialAsset>(unlitParse.value)).ok) unlitBaseGuid = unlitParse.value;

  // ── camera (RTS angled top-down) ─────────────────────────────────────────
  // Default camera looks down -Z. Pitch it down ~52° and lift it so the ground
  // plane fills the frame from an isometric-ish vantage. Mars-sky clear color.
  const pitch = -0.92; // radians, look downward
  const camQuat = quat.create();
  quat.fromAxisAngle(camQuat, [1, 0, 0], pitch);
  const cameraEntity = world.spawn(
    { component: Transform, data: { pos: [0, 34, 26], quat: camQuat } },
    { component: Camera, data: { ...perspective({ fov: Math.PI / 4, aspect, near: 0.5, far: 600 }), clearColor: [0.55, 0.34, 0.26, 1] } },
  ).unwrap();

  // ── lighting ─────────────────────────────────────────────────────────────
  // Skylight (cubemap-less) → flat ambient on first frame everywhere incl.
  // WebKit/WKWebView. Warm Mars dusk tint. Bumped a touch to lift shadowed
  // slopes now that the sun is softer.
  world.spawn({ component: Skylight, data: { color: [1.0, 0.85, 0.75], intensity: 0.7 } });
  // Sun. Intensity dropped 2.4 → 1.15: at 2.4 a flat-topped surface facing the
  // sun (N·L≈1) drove baseColor×2.4 past 1.0 → the plateau blew out to WHITE
  // while sloped lowland stayed Mars-red. 1.15 keeps the regolith red-brown
  // (0.52×1.15≈0.6) lit, not clipped, so the terrain reads Mars everywhere.
  // castShadow:false for now (shadows land in a later milestone).
  world.spawn({ component: DirectionalLight, data: { direction: [-0.4, -1.0, -0.55], color: [1.0, 0.92, 0.82], intensity: 1.15, castShadow: false } });

  // ── Mars terrain (M1 render) + map selection (M14) ──────────────────────────
  // Pick the map from `?map=<id>` (default red-canyon); all 7 ported presets are
  // in the registry. generateMap is pure engine-agnostic mapgen; on any failure
  // fall back to red-canyon so the game always boots. `tint => litMaterial(...)`
  // closes over the base material GUID so terrain.ts stays renderer-detail-free.
  const mapParam = (typeof location !== 'undefined')
    ? new URLSearchParams(location.search).get('map') : null;
  const picked = getMapBlueprint(mapParam);
  let mapId = picked.id;
  let map: ReturnType<typeof generateMap>;
  try {
    map = generateMap(picked.blueprint);
  } catch (e) {
    console.warn(`[marscraft] map '${picked.id}' failed to generate, falling back to red-canyon:`, e);
    mapId = 'red-canyon';
    map = generateMap(redCanyonBlueprint);
  }
  // ── M18: overlay the EDITABLE scene's placements ──────────────────────────
  // Terrain stays procedural (the blueprint above); the map's `scenes/<id>.pack
  // .json` — edited in the Studio editor — supplies the resource + start
  // placements, so moving a marker in Edit mode moves the real mineral/geyser/
  // start on the next Play. If the MapRoot names a different blueprint than
  // `?map=`, regenerate terrain from IT (the scene is the source of truth for
  // which map this is). Missing/invalid scene → keep the pure procedural map.
  let placementSource: 'scene' | 'procedural' = 'procedural';
  {
    const scene = await loadMapScene(mapId);
    if (scene) {
      if (scene.blueprintId && scene.blueprintId !== mapId) {
        const bp = getMapBlueprint(scene.blueprintId);
        try { map = generateMap(bp.blueprint); mapId = bp.id; } catch { /* keep current */ }
      }
      if (scene.spawnPoints.length > 0) map.spawnPoints = scene.spawnPoints;
      if (scene.minerals.length > 0) map.minerals = scene.minerals;
      if (scene.geysers.length > 0) map.geysers = scene.geysers;
      placementSource = 'scene';
      console.log(`[marscraft] map '${mapId}' placements from editable scene: ${map.spawnPoints.length} starts, ${map.minerals.length} minerals, ${map.geysers.length} geysers`);
    }
  }
  const tint = (rgb: [number, number, number], opts?: { metallic?: number; roughness?: number }) =>
    litMaterial(world, baseGuid, rgb, opts);
  // unlit tint — baseColor renders as-is (no lighting); used for the fog decal.
  const unlitTint = (rgb: [number, number, number], opts?: { metallic?: number; roughness?: number }) =>
    litMaterial(world, unlitBaseGuid, rgb, opts);
  const terrain = buildTerrain(world, baseGuid, tint, map);

  // ── Mars ambience decor (M1) ──────────────────────────────────────────────
  // Deterministic scatter of rocks / boulders / spires on the terrain surface,
  // avoiding pathable corridors, spawn points and mineral/geyser/base areas.
  buildEnvironment(world, baseGuid, tint, map, terrain.heightAt);

  // ── RTS camera + input (M1) ───────────────────────────────────────────────
  // DOM input state (keys / pointer / wheel / edge-scroll), guarded for headless
  // loads inside installInput. The camera system reads it each frame and drives
  // the camera Transform — pan (arrows/WASD + edge-scroll), wheel zoom (clamped),
  // middle-drag grab-pan, clamped to the map bounds.
  const input = installInput(canvas);
  const cam = installRtsCamera(world, cameraEntity, input, { mapWidth: map.width, mapHeight: map.height });

  // ── M10 state (fog of war + vision + minimap) — populated below, read by hooks ──
  let fogSystem: FogHandle | null = null;
  let minimap: MinimapHandle | null = null;
  // ── M12 state (HUD) — populated after the minimap, read by hooks ──
  let hud: HudHandle | null = null;
  // ── M19 state (win/lose + GameOverScreen) — read by hooks ──
  let victory: VictoryHandle | null = null;
  // ── M19 state (AlertSystem toasts) — read by hooks ──
  let alerts: AlertHandle | null = null;
  // ── M19 state (control groups 0-9) — read by hooks ──
  let controlGroups: ControlGroupHandle | null = null;
  // ── M19 state (GameTimeAPM + IdleTracker) — read by hooks ──
  let gameTimeApm: GameTimeApmHandle | null = null;
  let idleTracker: IdleTrackerHandle | null = null;
  // ── M19 state (rally-point renderer) — read by hooks ──
  let rallyRenderer: RallyRendererHandle | null = null;
  // ── M19 state (minimap alert pings) — read by hooks ──
  let minimapPingsRef: ReturnType<typeof createMinimapPings> | null = null;
  // ── M19 state (upgrade markers) — read by hooks ──
  let upgradeMarkers: UpgradeMarkersHandle | null = null;
  // ── M19 state (settings panel) — read by hooks ──
  let settingsPanel: SettingsPanelHandle | null = null;
  // ── M17 chunk C.1 state (pre-game MainMenu overlay) — read by hooks ──
  let mainMenu: MainMenuHandle | null = null;

  // ── vision (M10) ───────────────────────────────────────────────────────────
  // Installed EARLY (right after the camera, before combat / health-bar / fog /
  // minimap) so every downstream consumer reads an up-to-date per-player vision
  // grid the same frame — matching the source DeterministicVision priority 5. It
  // rebuilds, per player, a coarse feathered visibility grid from each owned
  // unit's/building's visionRange (high-ground occlusion via terrain.heightAt),
  // plus the sticky "explored" grid. Local player is the human (PLAYER).
  const visionSystem: VisionHandle = new VisionSystem({
    mapWidth: map.width,
    mapHeight: map.height,
    getTerrainHeight: terrain.heightAt,
    players: [PLAYER_ID.PLAYER, PLAYER_ID.ENEMY],
  }).install(world);

  // ── unit factory + test army (M3) ─────────────────────────────────────────
  // Cache the 4 shared primitive meshes ONCE; every part of every unit reuses
  // them. The factory spawns each unit's composite model via ChildOf children.
  let selection: SelectionHandle | null = null;
  let commandLayer: import('./src/systems/command-layer').CommandLayerHandle | null = null;
  let factoryCtxRef: UnitFactoryCtx | null = null;
  // ── economy state (M7) — populated inside the prims block, read by hooks ──
  let resourceManager: ResourceManager | null = null;
  let harvest: HarvestSystemHandle | null = null;
  let resourceFields: ResourceSpawnResult | null = null;
  let playerBase: import('@forgeax/engine-ecs').EntityHandle | null = null;
  let startScvs: import('@forgeax/engine-ecs').EntityHandle[] = [];
  // ── building state (M8) — populated after the command layer, read by hooks ──
  let buildingSystem: BuildingSystemHandle | null = null;
  let placement: PlacementHandle | null = null;
  let buildingLift: BuildingLiftHandle | null = null;
  // ── enemy AI state (M13 ch1) — populated after placement, read by hooks ──
  let enemyAi: SimpleAIHandle | null = null;
  // ── abilities state (M9) — populated after combat, read by hooks ──
  let abilitySystem: AbilitySystemHandle | null = null;
  // ── M9 chunk 2 state (upgrades / forms / morph) — read by hooks ──
  let upgradeManager: UpgradeManagerHandle | null = null;
  let formSwitch: FormSwitchHandle | null = null;
  let unitMorph: UnitMorphHandle | null = null;
  // ── M9 chunk 3 state (ground-effect / hazard / creep / garrison / detection /
  //    summon) — read by hooks ──
  let groundEffectSystem: GroundEffectHandle | null = null;
  let hazardSystem: HazardHandle | null = null;
  let directionWaveSystem: DirectionWaveHandle | null = null;
  let creepSystem: CreepHandle | null = null;
  let garrisonSystem: GarrisonHandle | null = null;
  let detectionSystem: DetectionHandle | null = null;
  let summonSystem: SummonHandle | null = null;
  let triggerSystem: TriggerSystemHandle | null = null;
  // ── M15 chunk 1 state (lockstep demo) — opt-in via ?lockstep=1, read by hooks ──
  let lockstep: LockstepDemo | null = null;
  // ── M11 state (VFX) — read by hooks ──
  let vfx: VfxHandle | null = null;
  let buffAuras: BuffAuraHandle | null = null;
  let statefulVfx: StatefulAbilityVfxHandle | null = null;
  // ── M16 state (audio / BGM) — read by hooks ──
  let audio: AudioManagerHandle | null = null;
  let casterEntityRef: import('@forgeax/engine-ecs').EntityHandle | null = null;
  let casterAllyRef: import('@forgeax/engine-ecs').EntityHandle | null = null;
  let casterEnemyRef: import('@forgeax/engine-ecs').EntityHandle | null = null;
  // spawnCasterAt: defined inside the prims block (needs the factory ctx); a
  // closure ref so the window hook can call it after bootstrap.
  let spawnCasterAtRef: ((x: number, z: number) => import('@forgeax/engine-ecs').EntityHandle | null) | null = null;
  const prims = makePrimitives(world);
  if (prims) {
    const factoryCtx: UnitFactoryCtx = { prims, tint, heightAt: terrain.heightAt };
    factoryCtxRef = factoryCtx;

    // spawnCasterAt(x,z): spawn a player caster (a goliath chassis for a visible
    // model) granted a large energy pool + the in-scope abilities phase_snipe +
    // heal. The factory already attaches Energy/Abilities (goliath has neither by
    // default), so we add/overwrite them here. Returns the caster entity.
    const spawnCasterAt = (x: number, z: number): import('@forgeax/engine-ecs').EntityHandle | null => {
      const e = spawnUnit(world, factoryCtx, {
        typeId: 'goliath', x, z,
        playerId: PLAYER_ID.PLAYER, playerColor: factionColor(PLAYER_ID.PLAYER),
      });
      if (!e) return null;
      // Ensure Abilities (goliath has it via the factory's non-building branch).
      if (!world.get(e, Abilities).ok) world.addComponent(e, { component: Abilities, data: {} });
      // phase_snipe (instant-ish damage) + heal + tactical_mark (M9 ch4 PASSIVE
      // trigger fixture: on_attack_hit / on_damage_dealt -> mark the target). The
      // passive auto-activates once its `tactical_mark` upgrade is granted below.
      abilityIds.set(e, ['phase_snipe', 'heal', 'tactical_mark']);
      // Grant a big energy pool seeded full so casts work immediately.
      if (world.get(e, Energy).ok) {
        world.set(e, Energy, { energy: 200, maxEnergy: 200, regenRate: 1, startPercent: 1 });
      } else {
        world.addComponent(e, { component: Energy, data: { energy: 200, maxEnergy: 200, regenRate: 1, startPercent: 1 } });
      }
      // StatModifierSystem derives Energy.maxEnergy/regenRate from UnitStats
      // base* each frame; without these the goliath's base (0) would wipe the
      // pool we just granted. Seed the base energy stats to match.
      if (world.get(e, UnitStats).ok) {
        world.set(e, UnitStats, { baseMaxEnergy: 200, baseEnergyRegen: 1, finalMaxEnergy: 200, finalEnergyRegen: 1 });
      }
      return e;
    };
    spawnCasterAtRef = spawnCasterAt;

    // Two spawn points: prefer the map's spawnPoints, else fall back to the
    // map edges. Player army clusters near spawn 0, enemy near spawn 1.
    const spawns = map.spawnPoints ?? [];
    const half = map.width / 2;
    const playerSpawn = spawns[0] ?? { x: -half + 8, z: 0 };
    const enemySpawn = spawns[1] ?? { x: half - 8, z: 0 };

    // Starting armies are RACE-DERIVED (M17 chunk C.1): each side's opening squad
    // comes from its race's targetComposition (the same table the SimpleAI + army
    // production use), so picking a player/AI race actually changes the units on
    // the field + their models. Falls back to a mixed squad if a race table is
    // empty. (Pre-M17 this was a fixed cross-race demo squad.)
    const raceArmy = (race: import('./src/data/units').RaceType): string[] => {
      const comp = RACE_CONFIGS[race]?.targetComposition ?? {};
      const units = Object.keys(comp).slice(0, 6);
      return units.length ? units : ['marine', 'marauder', 'marine'];
    };
    const playerArmy = raceArmy(matchCfg.playerRace);
    const enemyArmy = raceArmy(matchCfg.aiRace);

    const placeArmy = (army: string[], cx: number, cz: number, playerId: number) => {
      const cols = 3;
      for (let i = 0; i < army.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const ox = (col - (cols - 1) / 2) * 3;
        const oz = (row - 0.5) * 3;
        spawnUnit(world, factoryCtx, {
          typeId: army[i],
          x: cx + ox,
          z: cz + oz,
          playerId,
          playerColor: factionColor(playerId),
        });
      }
    };

    // Starting army squads are a VERIFY fixture only (`?fixtures=1`). A normal match
    // opens with just a town hall + workers (source `getRaceInitialUnits`: 1 base + 12
    // workers, no army), so the initial map isn't a jumble of mixed combat units.
    if (fixturesParam) {
      placeArmy(playerArmy, playerSpawn.x, playerSpawn.z, PLAYER_ID.PLAYER);
      placeArmy(enemyArmy, enemySpawn.x, enemySpawn.z, PLAYER_ID.ENEMY);
    }

    // ── caster verify fixtures (M9) — only under ?fixtures=1 (see above) ─────────
    // Spawn a player CASTER unit with a big energy pool + two in-scope abilities:
    //   `phase_snipe` (unit-target enemy, instant 70 spell damage — its castTime +
    //    projectile are M9 seams that this chunk's pipeline fires instantly) and
    //   `heal` (unit-target ally heal). The caster has Energy + Abilities; its
    //    abilityIds are set directly (allowedUnits gating is non-blocking here).
    // A nearby wounded ally + a nearby enemy give both abilities a live target, so
    // a verify run can: cast phase_snipe -> enemy hp drops + caster energy drops;
    // cast heal -> ally hp climbs + caster energy drops.
    if (fixturesParam) casterEntityRef = spawnCasterAt(playerSpawn.x - 6, playerSpawn.z + 6);
    if (fixturesParam && casterEntityRef) {
      // A wounded friendly target (for heal): spawn a marine and knock its hp down.
      const ally = spawnUnit(world, factoryCtx, {
        typeId: 'marine', x: playerSpawn.x - 4, z: playerSpawn.z + 6,
        playerId: PLAYER_ID.PLAYER, playerColor: factionColor(PLAYER_ID.PLAYER),
      });
      const allyHealth = ally ? world.get(ally, Health) : null;
      if (ally && allyHealth?.ok) {
        const h = allyHealth.value;
        world.set(ally, Health, { hp: Math.max(1, Math.floor(h.maxHp * 0.4)) });
      }
      casterAllyRef = ally;
      // An enemy target in phase_snipe range (for damage).
      casterEnemyRef = spawnUnit(world, factoryCtx, {
        typeId: 'roach', x: playerSpawn.x - 9, z: playerSpawn.z + 6,
        playerId: PLAYER_ID.ENEMY, playerColor: factionColor(PLAYER_ID.ENEMY),
      });
    }

    // ── unit selection (M4) ───────────────────────────────────────────────────
    // Left-click single-pick / shift-add / double-click select-by-type, left-drag
    // marquee box (combat-priority filter), empty-ground clear. Green ground rings
    // mark selected units; a DOM overlay div draws the drag box. Picking projects
    // unit centers via the camera VP (correct for the pitched rig) and always
    // resolves to the PARENT unit entity. The selected set feeds M5 movement.
    selection = installSelection(world, cameraEntity, input, {
      tint,
      localPlayerId: PLAYER_ID.PLAYER,
    });

    // ── economy (M7) ──────────────────────────────────────────────────────────
    // Per-player resource balances + the worker harvest loop. Installed BEFORE the
    // command layer + movement so it runs FIRST each frame (source priority 85 <
    // CommandExecutor 90): a worker's harvest/return_cargo move-command it sets is
    // consumed by the executor the same frame, and its direct Movement targets are
    // steered by the movement system the same frame. Resource fields (mineral
    // patches + geysers) come from the map (red-canyon carries them around each
    // base via generateResources); the HarvestSystem moves workers mineral->base,
    // deposits MINERAL_PER_TRIP each trip into the ResourceManager, and loops — so
    // a player's mineral balance climbs over time (the verification target).
    resourceManager = new ResourceManager();
    resourceManager.initPlayer(PLAYER_ID.PLAYER);
    resourceManager.initPlayer(PLAYER_ID.ENEMY);

    resourceFields = spawnResourceFields(world, prims, tint, map, terrain.heightAt);
    harvest = new HarvestSystem({ resourceManager }).install(world);

    // Race-derived opening (M17 chunk C.1): town hall + worker typeIds come from
    // the chosen player/AI race config (terran command_center/scv, zerg hatchery/
    // drone, protoss nexus/probe), so a picked race changes the starting economy
    // buildings + workers too — not just the army.
    const playerTownHall = RACE_CONFIGS[matchCfg.playerRace]?.baseTypeId ?? 'command_center';
    const playerWorker = RACE_CONFIGS[matchCfg.playerRace]?.workerTypeId ?? 'scv';
    const enemyTownHall = RACE_CONFIGS[matchCfg.aiRace]?.baseTypeId ?? 'command_center';
    const enemyWorker = RACE_CONFIGS[matchCfg.aiRace]?.workerTypeId ?? 'scv';

    // Spawn a player town hall next to the first mineral field + a few workers
    // and set them harvesting, so the economy runs on load (deposit target +
    // gather loop both present without any input). The base sits near the field
    // centroid; workers a couple units off the nearest patch.
    if (resourceFields.minerals.length > 0) {
      const field = nearestMineralCluster(world, resourceFields, playerSpawn.x, playerSpawn.z);
      if (field) {
        const base = baseSite(field.cx, field.cz); // toward map center — stays walkable
        const baseX = base.x, baseZ = base.z;
        const wp = baseSite(field.cx, field.cz, 2, -1); // worker row on the field side
        const cc = spawnUnit(world, factoryCtx, {
          typeId: playerTownHall, x: baseX, z: baseZ,
          playerId: PLAYER_ID.PLAYER, playerColor: factionColor(PLAYER_ID.PLAYER),
          isComplete: true,
        });
        if (cc) playerBase = cc;
        // The starting town hall is spawned already-complete, bypassing the
        // building-system's construct->complete handler that registers supply.
        // Grant its supply here so units can be trained from the opening base.
        resourceManager.addSupplyMax(PLAYER_ID.PLAYER, getUnitDef(playerTownHall)?.supplyProvide ?? 0);

        const scvs: import('@forgeax/engine-ecs').EntityHandle[] = [];
        for (let i = 0; i < startingWorkers; i++) {
          const g = workerGridOffset(i);
          const e = spawnUnit(world, factoryCtx, {
            typeId: playerWorker, x: wp.x + g.ox, z: wp.z + g.oz,
            playerId: PLAYER_ID.PLAYER, playerColor: factionColor(PLAYER_ID.PLAYER),
          });
          if (e) scvs.push(e);
        }
        startScvs = scvs;
        // Auto-start gathering on the first system tick (snapshots exist by then).
        harvest.queueAssignToMineral(scvs, field.entity);
      }
    }

    // ── enemy AI economy seed (M13 ch1) ────────────────────────────────────────
    // Mirror the player's auto-start for the ENEMY player so the AI has a real
    // opening: a COMPLETE town hall next to the enemy mineral field + a few
    // starting workers set harvesting. The SimpleAI system (installed after the
    // building/placement stack below) then runs its economy + build order + waves.
    if (resourceFields.minerals.length > 0) {
      const efield = nearestMineralCluster(world, resourceFields, enemySpawn.x, enemySpawn.z);
      if (efield) {
        const ebase = baseSite(efield.cx, efield.cz); // toward center (was +z → into the south border, wedged the AI's workers)
        const ebx = ebase.x, ebz = ebase.z;
        const ewp = baseSite(efield.cx, efield.cz, 2, -1); // worker row on the field side
        spawnUnit(world, factoryCtx, {
          typeId: enemyTownHall, x: ebx, z: ebz,
          playerId: PLAYER_ID.ENEMY, playerColor: factionColor(PLAYER_ID.ENEMY),
          isComplete: true,
        });
        // town hall starting supply (mirrors the player's grant).
        resourceManager.addSupplyMax(PLAYER_ID.ENEMY, getUnitDef(enemyTownHall)?.supplyProvide ?? 0);
        const escvs: import('@forgeax/engine-ecs').EntityHandle[] = [];
        for (let i = 0; i < startingWorkers; i++) {
          const g = workerGridOffset(i);
          const e = spawnUnit(world, factoryCtx, {
            typeId: enemyWorker, x: ewp.x + g.ox, z: ewp.z + g.oz,
            playerId: PLAYER_ID.ENEMY, playerColor: factionColor(PLAYER_ID.ENEMY),
          });
          if (e) escvs.push(e);
        }
        harvest.queueAssignToMineral(escvs, efield.entity);
      }
    }

    // ── movement + pathfinding + command layer (M5) ───────────────────────────
    // Build the pathing stack (PathGrid + OccupancyGrid + FlowField + region A*),
    // install the CommandExecutor (issues Movement targets/paths from each unit's
    // command) and the MovementSystem (steers Transform along the heightfield),
    // and wire right-click-to-move on the current selection. Right-click rays to
    // the ground via the camera Transform + perspective; the group's destinations
    // are formation-spread so units don't stack.
    commandLayer = installCommandLayer(world, {
      map,
      cameraEntity,
      input,
      selection,
      heightAt: terrain.heightAt,
    });

    // ── abilities / energy / buffs / stat-mods (M9) ───────────────────────────
    // Installed BEFORE combat so per-frame order matches the source priority chain
    // (Ability 91 < Energy 92 < Buff 93 < StatMod 94 < Attack 95): the ability
    // system rebuilds the combat-target snapshot + ticks cooldowns + autocast,
    // energy regenerates, buffs tick/expire + apply hard-control, then the stat-
    // modifier system recomputes UnitStats finals and layers buffs onto the legacy
    // Health/Movement/Attack/Energy/UnitType components — so the M6 attack system
    // (next) reads buff-corrected stats. A cast spends energy + sets cooldown +
    // applies its in-scope effects (damage via resolveDamage, heal, energy
    // drain/gain, buff/debuff stat-mods, stun, restore-shield) the same frame.
    abilitySystem = new AbilitySystem({
      clampToWalkable: (x, z) => {
        // Clamp teleport landings to a walkable cell when the path grid is up.
        if (commandLayer && commandLayer.pathGrid.isWalkableAt(x, z)) return { x, z };
        return { x, z };
      },
      // requiredUpgrade ability gating (M9 ch4): an ability with a non-empty
      // requiredUpgrade is rejected unless that upgrade is researched (level >= 1).
      // upgradeManager is created just below; captured by closure.
      getUpgradeLevel: (playerId, upgradeId) => upgradeManager?.getLevel(playerId, upgradeId) ?? 0,
    }).install(world);
    new EnergySystem().install(world);
    new BuffSystem().install(world);

    // ── upgrades / forms / morph (M9 chunk 2) ────────────────────────────────
    // UpgradeManager installs a per-frame system that writes each unit's
    // UnitStats.upgrade* columns from its player's level table; it MUST run
    // BEFORE StatModifierSystem (which folds upgrade* into final* the same frame).
    // FormSwitch + UnitMorph swap a unit's stats/model on demand (driven by the
    // ability effect-executor seams, wired below). UnitMorph is a per-frame system
    // (advances morph timers); FormSwitch is event-driven (no per-frame query).
    upgradeManager = new UpgradeManager().install(world);
    const modelDeps = { prims, tint };
    formSwitch = new FormSwitchSystem(modelDeps).install(world);
    if (resourceManager) {
      unitMorph = new UnitMorphSystem({ resourceManager, model: modelDeps }).install(world);
    }
    // Wire the M9 ch1 effect-executor seams to the new systems.
    setFormSwitchHandler((_w, entity, formId) => { formSwitch?.switchForm(entity, formId); });
    setMorphHandler((_w, entity, targetTypeId) => { unitMorph?.startMorph(entity, targetTypeId); });

    new StatModifierSystem().install(world);

    // ── VFX (M11 chunk 1) ──────────────────────────────────────────────────────
    // The transient-mesh VFX engine + the CORE combat/death effects. Installed
    // BEFORE combat so its EventBus subscriptions (muzzle/impact/spark/blood/
    // death_debris/cast_flash) are live when the attack/projectile/death/ability
    // systems emit this frame. spawnVfx BUFFERS the spawn (events fire mid-frame
    // inside other systems' query loops); the VfxSystem tick flushes + advances +
    // self-despawns the particles. It is passed to ProjectileSystem so projectile
    // impacts spawn a blast (explosion on splash / impact on single-target) —
    // replacing the M6 minimal hit-flash sphere.
    vfx = new VfxSystem({ prims, tint, heightAt: terrain.heightAt }).install(world);

    // Persistent per-entity buff auras (M17 chunk C): consumes ability:buff_applied
    // (which carries the buff's declarative BuffVFXConfig) and renders the activation
    // burst + continuous particles + overhead marker + foot ring for as long as the
    // buff is held, tearing down on removal/expiry/host-despawn.
    buffAuras = new BuffAuraSystem(vfx, { tint }).install(world);
    // Ability-specific persistent VFX not expressible as a declarative buff config
    // (e.g. the stellar_insight floating eye) — a bespoke composite per host entity.
    if (abilitySystem) statefulVfx = new StatefulAbilityVfxSystem({ tint, prims, vfx, ability: abilitySystem, heightAt: terrain.heightAt }).install(world);

    // ── combat (M6) ───────────────────────────────────────────────────────────
    // Installed AFTER the command-executor + movement so per-frame order is:
    // command -> movement -> attack -> projectile -> death -> health-bar. The
    // attack system applies each unit's real WeaponDef into its Attack columns,
    // auto-acquires the nearest enemy in vision (so opposing armies fight on
    // contact), faces + fires (instant damage or a spawned Projectile); the
    // projectile system flies + resolves hits (+ splash + bounce); the death
    // system despawns dead units + their model parts + selection rings; the
    // health-bar system shows hp bars above damaged/selected units.
    seedCombatRandom(0x5eed); // deterministic high-ground-miss rolls for verify
    const projectileAssets = makeProjectileAssets(prims.sphere, tint);
    new AttackSystem({ getTerrainHeight: terrain.heightAt, projectileAssets }).install(world);
    new ProjectileSystem(vfx).install(world);
    // HealthBar built first so DeathSystem can despawn a dying unit's bars
    // synchronously (before the unit) — avoids a 1-frame ChildOf orphan.
    const healthBar = new HealthBarSystem({ tint });
    new DeathSystem({ selection, healthBar }).install(world);
    healthBar.install(world);

    // ── buildings (M8) ─────────────────────────────────────────────────────────
    // Construction progress + production queue + rally, plus placement (cursor
    // footprint ghost -> commit) + Terran lift/land. The BuildingSystem reuses the
    // command layer's OccupancyGrid (same footprint/walkable state the movement
    // system reads) so reservations and pathing stay consistent. It runs as its own
    // system (priority-equivalent to "before movement" here is not required: it only
    // advances build/production timers + issues commands the executor consumes next
    // frame). On a building's death it releases the footprint before DeathSystem
    // despawns it. Placement spends the player's resources, spawns the building in
    // `constructing` state, reserves the footprint, and assigns the builder a
    // `build` command (the construction tick recognises the on-site SCV).
    if (resourceManager && commandLayer) {
      const bsys = new BuildingSystem({
        resourceManager,
        factoryCtx,
        occupancy: commandLayer.occupancy,
        isWalkable: (x, z) => commandLayer!.pathGrid.isWalkableAt(x, z),
        harvest,
        // M9 ch2: research now uses real UpgradeDef cost/time + the manager owns
        // levels (SSOT); a completed research bumps the level + applies stats.
        upgradeManager,
        // M9 ch4: building-morph model swap + larva spawn need the model deps +
        // the terrain sampler.
        model: { prims, tint },
        heightAt: terrain.heightAt,
      });
      buildingSystem = bsys.install(world);

      placement = installPlacement(world, {
        map: { width: map.width, height: map.height, gridResolution: map.gridResolution },
        occupancy: commandLayer.occupancy,
        resourceManager,
        buildingSystem,
        factoryCtx,
        prims,
        tint,
        input,
        screenToGround: (px, py) => commandLayer!.screenToGround(px, py),
        isWalkable: (x, z) => commandLayer!.pathGrid.isWalkableAt(x, z),
        heightAt: terrain.heightAt,
        localPlayerId: PLAYER_ID.PLAYER,
        localPlayerColor: factionColor(PLAYER_ID.PLAYER),
      });

      buildingLift = installBuildingLift(world, {
        heightAt: terrain.heightAt,
        onLift: (e) => commandLayer!.occupancy.release(e as unknown as number),
        onLand: (e, x, z) => {
          // re-reserve at the landed cell (best-effort footprint from typeId).
          const tid = buildingTypeId.get(e);
          if (!tid) return;
          const { col, row } = ((): { col: number; row: number } => {
            const r = map.gridResolution;
            return {
              col: Math.max(0, Math.min(r - 1, Math.floor(((x + map.width / 2) / map.width) * r))),
              row: Math.max(0, Math.min(r - 1, Math.floor(((z + map.height / 2) / map.height) * r))),
            };
          })();
          commandLayer!.occupancy.markBuilding(e as unknown as number, col - 1, row - 1, 3, 2);
        },
      });
    }

    // ── enemy AI (M13 chunk 1) ─────────────────────────────────────────────────
    // Drive PLAYER_ID.ENEMY with the SimpleAI core: economy (train workers to the
    // effective cap + harvest assignment + gas), the race build order, army
    // production by target-composition deficit, and the idle->rallying->attacking
    // wave state machine. Installed AFTER the building/placement stack (it calls
    // buildingSystem.trainUnit / placement.placeAt / harvest.assign*). It reuses
    // the same OccupancyGrid walkability (commandLayer.pathGrid) the movement
    // system reads, and the SAME placement commit path (with an ENEMY owner
    // override) — no reimplemented AI-side build/spend/harvest.
    if (resourceManager && buildingSystem && placement && harvest && commandLayer) {
      enemyAi = new SimpleAI({
        playerId: PLAYER_ID.ENEMY,
        color: factionColor(PLAYER_ID.ENEMY),
        // M17 chunk C.1: AI race + difficulty come from the MainMenu params
        // (?airace / ?difficulty), resolved above; default terran/normal.
        race: matchCfg.aiRace,
        difficulty: matchCfg.difficulty,
        resourceManager,
        buildingSystem,
        placement,
        harvest,
        isWalkable: (x, z) => commandLayer!.pathGrid.isWalkableAt(x, z),
        map: { width: map.width, height: map.height },
        // map-designer base-location centers — the AI expands to the nearest
        // un-taken one (M13 chunk 2 expansion).
        baseLocations: map.baseLocations,
        // player base (from the auto-start above) is the AI's attack target;
        // falls back to the player spawn until the AI observes the real base.
        enemyBase: (() => {
          const baseTf = playerBase ? world.get(playerBase, Transform) : null;
          return baseTf?.ok
            ? { x: baseTf.value.pos[0], z: baseTf.value.pos[2] }
            : { x: playerSpawn.x, z: playerSpawn.z };
        })(),
      }).install(world);
    }

    // ── ability subsystems (M9 chunk 3) ───────────────────────────────────────
    // GroundEffect / Hazard zones (persistent AoE), Creep coverage, Garrison
    // (transport/bunker load-unload), Detection (cloak/detector), and Summon
    // (spawn_unit + SummonedLifetime + Illusion + recall). Each registers a
    // per-frame system + a handle; the ability effect-executor / command-executor
    // seams are wired to their handlers below so casts/orders reach the real code.
    const groundEffect = new GroundEffectSystem({ prims, tint, heightAt: terrain.heightAt });
    groundEffectSystem = groundEffect.install(world);
    const hazard = new HazardSystem({ prims, tint, heightAt: terrain.heightAt });
    hazardSystem = hazard.install(world);
    // Direction wave (sonar pulse): reveals fog along its path + reveals cloaked
    // enemies it passes over — pass the vision system so path-reveal is real.
    const directionWave = new DirectionWaveSystem({ prims, tint, heightAt: terrain.heightAt, vision: visionSystem });
    directionWaveSystem = directionWave.install(world);
    setDirectionWaveHandler((req) => { directionWave.spawnDirectionWave(req); });
    const creep = new CreepSystem({ prims, tint, heightAt: terrain.heightAt });
    creepSystem = creep.install(world);
    detectionSystem = new DetectionSystem().install(world);
    if (commandLayer) {
      const garrison = new GarrisonSystem({
        selection: selection ?? undefined,
        callbacks: {
          getTerrainHeight: terrain.heightAt,
          clampToWalkable: (x, z) => {
            if (commandLayer && commandLayer.pathGrid.isWalkableAt(x, z)) return { x, z };
            return { x, z };
          },
        },
      });
      garrisonSystem = garrison.install(world);
      // wire the effect-executor transport_load/unload seams.
      setTransportLoadHandler((_w, carrier, unit) => { garrison.loadUnit(unit, carrier); });
      setTransportUnloadHandler((_w, carrier) => { garrison.unloadAll(carrier); });
      // wire the command-executor garrison/pickup seams.
      setGarrisonCommandHandler((_w, self, target, mode) =>
        mode === 'garrison' ? garrison.loadUnit(self, target) : garrison.loadUnit(target, self));
    }
    if (resourceManager) {
      const summon = new SummonSystem({ factoryCtx, factionColor });
      summonSystem = summon.install(world);
      setSummonHandler((req) => { summon.summon(req); });
      setRecallHandler((w, caster, x, z, radius) => { summon.recall(w, caster, x, z, radius); });
    }
    // wire the effect-executor spawn_ground_effect / spawn_hazard seams.
    setGroundEffectHandler((req) => { groundEffect.spawnGroundEffect(req); });
    setHazardHandler((req) => { hazard.spawnHazard(req); });

    // ── passive support systems (M9 chunk 2) ──────────────────────────────────
    // Small per-frame regen/heal passives. Order is not load-bearing (they only
    // read finals + write hp/shield), but OutOfCombat must install before
    // CreepHealing (which queries it). ShieldRegen + ShieldBattery + Medivac heal
    // anywhere; CreepHealing's creep coverage now reads the REAL CreepSystem
    // (M9 ch3) `isOnCreep` — no longer the default-false seam.
    new ShieldRegenSystem().install(world);
    const outOfCombat = new OutOfCombatSystem().install(world);
    new MedivacHealSystem().install(world);
    new ShieldBatterySystem().install(world);
    new CreepHealingSystem({ outOfCombat, isOnCreep: (x, z) => creepSystem?.isOnCreep(x, z) ?? false }).install(world);

    // ── TriggerSystem (M9 chunk 4) ────────────────────────────────────────────
    // Reactive effect evaluation: subscribes to the EventBus combat/ability events
    // (emitted by damage-resolver / attack-system / projectile-system / death-
    // system / ability-system / buff-system) and fires the matching triggers on
    // the involved entity (buff-level + ability-level passives), honoring per-
    // trigger cooldowns + on_interval timers + passive auto-activation. Its
    // condition deps (upgrade level / out-of-combat / creep) are the systems above;
    // nearby_unit_count + effect area targeting use the AbilitySystem's per-frame
    // combat snapshot. Installed last so all its dep handles exist.
    triggerSystem = new TriggerSystem({
      upgradeManager,
      outOfCombat,
      creep: creepSystem,
      combatSnapshot: () => abilitySystem?.snapshot ?? [],
    }).install(world);

    // ── fog of war + minimap (M10) ────────────────────────────────────────────
    // Fog: hide ENEMY units/buildings outside the local player's VISIBLE set
    // (collapse the parent Transform scale -> 0; ChildOf model parts + health bars
    // inherit it and vanish; restored when revealed) + a coarse ground-fog decal
    // layer over unseen/explored terrain. Cloaked-undetected enemies stay hidden
    // (consults the M9 DetectionSystem). Own units/neutral resources always shown.
    // (The source's screen-space depth-reprojection fog SHADER is a documented seam
    // — a game can't add a fullscreen post-process pass in forgeax; see fog-system.ts.)
    // Installed AFTER vision + detection so it reads a fresh grid each frame.
    // Minimap alert-ping store (M19): positioned AlertSystem alerts add pings here,
    // drawn on the minimap's overlay layer.
    const minimapPings = createMinimapPings();
    minimapPingsRef = minimapPings;
    {
      fogSystem = new FogSystem({
        vision: visionSystem,
        detection: detectionSystem ?? undefined,
        localPlayerId: PLAYER_ID.PLAYER,
        prims, tint, unlitTint, heightAt: terrain.heightAt,
        mapWidth: map.width, mapHeight: map.height,
      }).install(world);

      // Minimap: bottom-left DOM <canvas> overlay, redrawn ~15fps from the vision
      // grid + a per-frame unit snapshot. Terrain colors + fog shading + blips
      // (own=blue/enemy=red[only visible]/neutral=grey) + camera viewport rect;
      // left-click/drag -> cam.jumpTo. DOM-guarded (no-ops headless).
      minimap = installMinimap(world, {
        map, cam,
        vision: visionSystem,
        detection: detectionSystem ?? undefined,
        localPlayerId: PLAYER_ID.PLAYER,
        overlay: (ctx, mw, mh, sz) => minimapPings.render(ctx, mw, mh, sz),
      });
    }

    // ── in-game HUD (M12 chunk 1) ─────────────────────────────────────────────
    // The core SC-style DOM HUD over #app: resource bar (top-right, polled from
    // the ResourceManager), selection panel (bottom-center, portrait + bars +
    // stats / multi-select grid), command card (bottom-right 3x5 — train / build /
    // research / ability buttons that invoke the REAL systems), production-queue
    // strip + the SC2 CursorManager. Driven from LIVE handles every ~18fps; DOM-
    // guarded (no-ops headless). Anchored bottom-RIGHT / bottom-CENTER / top-RIGHT
    // so it never overlaps the bottom-LEFT minimap. localPlayer = the human (PLAYER).
    if (resourceManager && selection) {
      hud = installHud({
        world,
        localPlayerId: PLAYER_ID.PLAYER,
        resourceManager,
        selection,
        buildingSystem,
        placement,
        abilitySystem,
      });
    }

    // ── win/lose + GameOverScreen (M19 UI port) ───────────────────────────────
    // A player with 0 living buildings (after having had some) is defeated; the
    // GameOverScreen shows VICTORY/DEFEAT + stats. Return-to-menu reloads to the
    // pre-game MainMenu (?game=marscraft, no started).
    {
      const gameOverUI = installGameOver(() => {
        if (typeof location !== 'undefined') location.href = `${location.pathname}?game=marscraft`;
      });
      victory = new VictorySystem({ ui: gameOverUI, localName: 'You', enemyName: 'Enemy' }).install(world);
    }

    // ── AlertSystem toasts (M19 UI port) ──────────────────────────────────────
    // Corner alerts: under-attack (local target of combat:damage_taken), unit
    // lost (combat:kill), and build/train/upgrade complete (alert:* from the
    // building-system). Click an alert with a position → camera jumps there.
    alerts = installAlerts({
      world,
      localPlayerId: PLAYER_ID.PLAYER,
      onJumpTo: (x, z) => { try { cam?.jumpTo?.(x, z); } catch { /* no cam */ } },
      onPing: (x, z, color) => minimapPings.addPing(x, z, color),
    });

    // ── control groups 0-9 + ControlGroupBar (M19 UI port) ────────────────────
    // Ctrl+N assigns the selection to group N; N recalls it; N twice centres. The
    // bar renders each non-empty group; click = recall, dbl-click = centre.
    if (selection) {
      const cgSys = new ControlGroupSystem({
        input, selection, jumpTo: (x, z) => { try { cam?.jumpTo?.(x, z); } catch { /* no cam */ } },
      });
      controlGroups = cgSys.install(world);
      installControlGroupBar({
        groups: controlGroups,
        onRecall: (n) => cgSys.recall(n),
        onCenter: (n) => { cgSys.recall(n); const g = cgSys.getGroup(n); if (g.length) { let sx = 0, sz = 0; for (const e of g) { const t = world.get(e, Transform); if (t.ok) { sx += t.value.pos[0]; sz += t.value.pos[2]; } } cam?.jumpTo?.(sx / g.length, sz / g.length); } },
      });
    }

    // ── GameTimeAPM + IdleTracker (M19 UI port) ───────────────────────────────
    gameTimeApm = installGameTimeApm();
    if (selection) {
      idleTracker = installIdleTracker({
        world, localPlayerId: PLAYER_ID.PLAYER, selection,
        onJumpTo: (x, z) => { try { cam?.jumpTo?.(x, z); } catch { /* no cam */ } },
      });
      // rally-point lines + flags for selected buildings (M19).
      rallyRenderer = new RallyRenderer({ selection, heightAt: terrain.heightAt, prims, tint }).install(world);
    }
    // upgrade-level badges for the local player (M19).
    if (buildingSystem) {
      const bsys = buildingSystem;
      upgradeMarkers = installUpgradeMarkers({ getLevel: (id) => bsys.getUpgradeLevel(PLAYER_ID.PLAYER, id) });
    }

    // ── audio / dynamic BGM (M16) ─────────────────────────────────────────────
    // Install the BGM manager and enter the in-game economy phase for the LOCAL
    // player's race. The manager subscribes to the M9 EventBus combat events, so
    // once the player's units fight it crossfades to battle music and back to
    // economy when the fight ends. Autoplay stays silent until the first user
    // gesture (pointerdown/keydown) — the desired phase is tracked meanwhile and
    // starts on that gesture (never throws on a blocked play()). All browser APIs
    // are guarded inside the manager, so this no-ops cleanly headless.
    {
      // Local race = the player's Command Center race (terran here); raceNameFromCode
      // falls back to terran if the base/Faction is missing.
      const baseFaction = playerBase ? world.get(playerBase, Faction) : null;
      const localRace = raceNameFromCode(baseFaction && baseFaction.ok ? baseFaction.value.race : RACE.TERRAN);
      audio = new AudioManager().install(world);
      audio.setLocalRace(localRace);
      audio.startGameBGM(localRace);
    }

    // ── SettingsPanel (M19 UI port) — F10 toggles; applies volume + edge-scroll ──
    settingsPanel = installSettingsPanel({
      onChange: (s) => {
        audio?.setVolume(s.masterVolume, s.bgmVolume);
        input.edgeScrollEnabled = s.edgeScroll;
      },
    });

    // Grant the caster fixture's `tactical_mark` upgrade so its passive (a trigger
    // fixture) auto-activates — verifiable via `probeTriggers(caster())` (the
    // passive shows activated) and by casting phase_snipe at the enemy (the
    // on_damage_dealt trigger applies the `tactical_mark` debuff to the target).
    if (casterEntityRef) {
      upgradeManager?.setLevel(PLAYER_ID.PLAYER, 'tactical_mark', 1);
    }

    // ── M15 chunk 1: deterministic lockstep sim core (opt-in via ?lockstep=1) ──
    // DEFAULT play is unaffected: without the flag, `lockstep` stays null and the
    // sim free-runs exactly as before (M0–M14). With `?lockstep=1` we seed the ONE
    // sim RNG source, build a LockstepDemo over the human + enemy players, and add a
    // per-frame system that advances the driver: each turn interval both players'
    // queued commands are packaged as that turn's batches and the driver steps once
    // (recording the world checksum every CHECKSUM_INTERVAL_TURNS). This exercises
    // the transport-agnostic lockstep core against the REAL world in-process; true
    // WebSocket networking + the authoritative room are chunk 2 (see src/net/
    // chunk2-seam.ts) — the preview host is client-only, so they are deferred, not
    // faked.
    const lockstepOn = (typeof location !== 'undefined')
      && new URLSearchParams(location.search).get('lockstep') === '1';
    if (lockstepOn) {
      // Seed the single sim RNG source (SSOT of all lockstep randomness) and
      // unify combat randomness onto it so the high-ground-miss roll draws from the
      // same seeded stream (full determinism — no second RNG in the sim path).
      initGameRng(0x5eed_beef);
      setCombatRandomSource(gameRandom);
      lockstep = new LockstepDemo({
        world,
        players: [PLAYER_ID.PLAYER, PLAYER_ID.ENEMY],
      });
      lockstep.start();
      // Per-frame driver: advance the lockstep clock by the frame dt. This does
      // NOT gate the ECS systems (they still run every frame); it drives the turn
      // buffer + checksum plumbing over the live world. A `window.__marscraft`
      // command helper can queue orders that then execute at the next turn.
      world.addSystem({
        name: 'mc-lockstep-driver',
        queries: [],
        resources: ['Time'],
        fn: () => {
          const dt = world.getResource<{ dt: number }>('Time').dt;
          lockstep?.tick(dt * 1000);
        },
      });
      console.info('[marscraft] M15 chunk 1: lockstep sim core ENABLED (?lockstep=1). Driver + checksum plumbing active over the live world; WS transport + Bun server = chunk 2 (deferred). Hooks: __marscraft.lockstepState() / checksumNow() / determinismCheck().');
    }
  }

  // ── M17 chunk C.1: pre-game MainMenu overlay + query-param START flow ───────
  // Build the ?started=1 URL that launches a configured match, then reload. The
  // world is already running behind the overlay; reloading re-enters bootstrap
  // with started=1 (menu skipped) + the chosen params applied above.
  const startMatch = (opts: MenuStartOptions): void => {
    if (typeof location === 'undefined') return;
    const p = new URLSearchParams(location.search);
    p.set('game', p.get('game') ?? 'marscraft');
    p.set('started', '1');
    p.set('map', opts.mapId);
    p.set('race', opts.race);
    p.set('airace', opts.aiRace);
    p.set('difficulty', opts.difficulty);
    location.search = p.toString();
  };
  // Show the menu ONLY on a fresh entry (no ?started=1). The match idles behind it.
  if (!matchCfg.started) {
    mainMenu = showMainMenu(startMatch);
    mainMenu.show();
  }

  // ── debug hook (dev/verify aid; harmless in prod) ─────────────────────────
  if (typeof window !== 'undefined') {
    (window as { __marscraft?: unknown }).__marscraft = {
      cam, map, cameraEntity,
      spawns: map.spawnPoints,
      // ── M17 chunk C.1: pre-game MainMenu verify helpers ───────────────────
      // `menuVisible()` -> is the setup overlay currently shown (true on a fresh
      // `?game=marscraft` entry, false once `?started=1`). `matchConfig()` -> the
      // RESOLVED match settings this bootstrap applied: the map that loaded, the
      // concrete player/AI races (random resolved to a real race + the chosen
      // label), the difficulty, and whether a match is live (started). Verify:
      // change ?difficulty/?airace/?map and matchConfig() + aiState() track them.
      menuVisible: () => mainMenu?.isVisible() ?? false,
      matchConfig: () => ({
        started: matchCfg.started,
        map: mapId,
        difficulty: matchCfg.difficulty,
        race: matchCfg.playerRace,
        raceChosen: matchCfg.playerRaceChosen,
        aiRace: matchCfg.aiRace,
        aiRaceChosen: matchCfg.aiRaceChosen,
      }),
      // `startMatch(opts)` -> programmatic Start (e2e): apply a partial selection
      // to the menu + commit (sets ?started=1&... and reloads). With no menu (already
      // started) it builds the URL directly from the given opts merged over current
      // config. e.g. `__marscraft.startMatch({ difficulty:'hard', aiRace:'zerg' })`.
      startMatch: (opts?: Partial<MenuStartOptions>) => {
        if (mainMenu) { mainMenu.start(opts); return; }
        const cur: MenuStartOptions = {
          difficulty: matchCfg.difficulty,
          race: matchCfg.playerRaceChosen,
          aiRace: matchCfg.aiRaceChosen,
          mapId,
        };
        startMatch({ ...cur, ...(opts ?? {}) });
      },
      // `menuSelection()` -> the menu's current in-panel selection (pre-Start).
      menuSelection: () => mainMenu?.selection() ?? null,
      // M14 map selection: which preset loaded + the full list. Switch via
      // `?map=<id>` on the preview URL.
      mapInfo: () => ({ id: mapId, width: map.width, height: map.height, gridResolution: map.gridResolution, spawns: map.spawnPoints?.length ?? 0, minerals: map.minerals?.length ?? 0, geysers: map.geysers?.length ?? 0, placementSource, available: mapIds() }),
      focus: (x: number, z: number) => cam?.jumpTo?.(x, z),
      // M4 selection: the live handle + a deterministic test helper. `selectAll()`
      // selects every player unit; `getSelected()` returns the selected entity ids.
      selection,
      selectAll: () => selection?.selectAll(),
      getSelected: () => selection?.getSelected() ?? [],
      // M5 movement + pathfinding: the pathing stack + a deterministic move-order
      // test helper. `moveSelectedTo(x,z)` issues a formation-spread move order to
      // the current selection synchronously; after a few frames the selected
      // units' Transform.pos[0]/pos[2] head toward (x,z).
      commandLayer,
      moveSelectedTo: (x: number, z: number) => commandLayer?.moveSelectedTo(x, z),
      screenToGround: (px: number, py: number) => commandLayer?.screenToGround(px, py) ?? null,
      pathGrid: commandLayer?.pathGrid,
      // ── M6 combat verify helpers ──────────────────────────────────────────
      // `spawnSkirmish(x,z)` drops ~3 player + ~3 enemy combat units a few units
      // apart near (x,z) on the terrain, so the attack system auto-acquires and
      // the two sides fight on contact (deterministic — no input needed).
      spawnSkirmish: (x = 0, z = 0) => {
        if (!factoryCtxRef) return { spawned: 0 };
        const playerUnits = ['marine', 'marauder', 'marine'];
        const enemyUnits = ['zergling', 'zergling', 'roach'];
        const ids: number[] = [];
        // player on the -X side, enemy on the +X side, ~8 units apart so they
        // start out of range and close in.
        for (let i = 0; i < playerUnits.length; i++) {
          const e = spawnUnit(world, factoryCtxRef, {
            typeId: playerUnits[i], x: x - 4, z: z + (i - 1) * 2,
            playerId: PLAYER_ID.PLAYER, playerColor: factionColor(PLAYER_ID.PLAYER),
          });
          if (e) ids.push(e as unknown as number);
        }
        for (let i = 0; i < enemyUnits.length; i++) {
          const e = spawnUnit(world, factoryCtxRef, {
            typeId: enemyUnits[i], x: x + 4, z: z + (i - 1) * 2,
            playerId: PLAYER_ID.ENEMY, playerColor: factionColor(PLAYER_ID.ENEMY),
          });
          if (e) ids.push(e as unknown as number);
        }
        return { spawned: ids.length, entities: ids };
      },
      // `probeCombat()` reads the first few combat units' state so a verify run
      // can confirm targets acquired / hp drops / deaths over a few seconds.
      // forgeax has no World-level entity enumeration outside a system, so this
      // deterministically scans a small raw-id range via world.get. An EntityHandle
      // is (generation<<24)|index, so raw 0..N hits generation-0 handles
      // (handle==index) — true for freshly-spawned, never-recycled units, which is
      // the skirmish case. Recycled slots (gen>0) are skipped; fine for verify.
      probeCombat: (ids?: number[]) => {
        const out: Array<Record<string, unknown>> = [];
        const readOne = (raw: number) => {
          const eh = raw as unknown as import('@forgeax/engine-ecs').EntityHandle;
          const h = world.get(eh, Health);
          if (!h.ok) return;
          const a = world.get(eh, Attack);
          out.push({
            entity: raw,
            hp: h.value.hp, maxHp: h.value.maxHp, isDead: h.value.isDead,
            targetEntity: a.ok ? a.value.targetEntity : null,
            isAttacking: a.ok ? a.value.isAttacking : null,
            damage: a.ok ? a.value.damage : null, range: a.ok ? a.value.range : null,
          });
        };
        if (ids && ids.length) { for (const id of ids) readOne(id); return out; }
        let count = 0;
        for (let raw = 0; raw < 4000 && count < 8; raw++) {
          const before = out.length; readOne(raw);
          if (out.length > before) count++;
        }
        return out;
      },
      // ── M7 economy verify helpers ─────────────────────────────────────────
      // `resources(playerId?)` reads the current {minerals,gas,supply,supplyMax}
      // balance for a player (default = local player). Over a few seconds of
      // harvesting it should INCREASE (the verification target).
      resources: (playerId: number = PLAYER_ID.PLAYER) =>
        resourceManager?.getResources(playerId) ?? null,
      // `harvestTest()` spawns a fresh Command Center + 3 SCVs next to the
      // nearest mineral field and orders them to harvest (deterministic, no
      // input). Returns the spawned ids. Call it, wait a few seconds, then read
      // `resources()` — minerals climb.
      harvestTest: () => {
        if (!factoryCtxRef || !harvest || !resourceFields) return { ok: false };
        const field = nearestMineralCluster(world, resourceFields, 0, 0);
        if (!field) return { ok: false, reason: 'no-minerals' };
        const baseX = field.cx, baseZ = field.cz + 7;
        const cc = spawnUnit(world, factoryCtxRef, {
          typeId: 'command_center', x: baseX, z: baseZ,
          playerId: PLAYER_ID.PLAYER, playerColor: factionColor(PLAYER_ID.PLAYER),
          isComplete: true,
        });
        const scvs: import('@forgeax/engine-ecs').EntityHandle[] = [];
        for (let i = 0; i < 3; i++) {
          const e = spawnUnit(world, factoryCtxRef, {
            typeId: 'scv', x: baseX - 2 + i * 2, z: baseZ - 2,
            playerId: PLAYER_ID.PLAYER, playerColor: factionColor(PLAYER_ID.PLAYER),
          });
          if (e) scvs.push(e);
        }
        harvest.queueAssignToMineral(scvs, field.entity);
        return {
          ok: true,
          base: cc ? (cc as unknown as number) : null,
          scvs: scvs.map((e) => e as unknown as number),
          mineral: field.entity as unknown as number,
        };
      },
      // `probeHarvest()` reads the auto-started SCVs' harvest state so a verify
      // run can confirm the loop is progressing (state cycles MOVING->MINING->
      // RETURNING; carryAmount becomes MINERAL_PER_TRIP after mining).
      probeHarvest: () => {
        const STATE_NAMES = [
          'idle', 'moving_to_mineral', 'mining', 'returning_mineral',
          'moving_to_gas', 'harvesting_gas', 'returning_gas',
        ];
        const CARRY_NAMES = ['none', 'mineral', 'gas'];
        const readOne = (e: import('@forgeax/engine-ecs').EntityHandle) => {
          const h = world.get(e, Harvester);
          if (!h.ok) return null;
          return {
            entity: e as unknown as number,
            state: STATE_NAMES[h.value.state] ?? h.value.state,
            carryAmount: h.value.carryAmount,
            carryType: CARRY_NAMES[h.value.carryType] ?? h.value.carryType,
            targetMineral: h.value.targetMineral,
            targetBase: h.value.targetBase,
            isHarvesting: h.value.isHarvesting,
          };
        };
        const ids = startScvs.length ? startScvs : [];
        return {
          base: playerBase ? (playerBase as unknown as number) : null,
          resources: resourceManager?.getResources(PLAYER_ID.PLAYER) ?? null,
          workers: ids.map(readOne).filter(Boolean),
        };
      },
      // ── M8 building verify helpers ────────────────────────────────────────
      // `build(typeId, x, z)` deterministically places + starts a building at
      // world (x,z): spends the player's resources, spawns it in `constructing`
      // state (10% hp), reserves the footprint. Returns the entity id (or null on
      // unaffordable / blocked). For Terran buildings (which need an on-site SCV
      // to advance) it assigns the nearest player SCV a build command + parks it
      // at the site so construction proceeds; Zerg/Protoss auto-construct.
      build: (typeId: string, x = 0, z = 0) => {
        if (!placement || !factoryCtxRef) return null;
        // Spawn a fresh dedicated SCV at the site as the builder so Terran
        // construction proceeds deterministically (a harvesting SCV would have its
        // command overwritten by the HarvestSystem). Zerg/Protoss auto-construct
        // regardless; the builder is harmless there.
        const builder = spawnUnit(world, factoryCtxRef, {
          typeId: 'scv', x: x + 1.5, z: z + 1.5,
          playerId: PLAYER_ID.PLAYER, playerColor: factionColor(PLAYER_ID.PLAYER),
        });
        const e = placement.placeAt(typeId, x, z, builder);
        if (!e) { if (builder) world.set(builder, Health, { isDead: true }); return null; }
        // Park the builder ON the site so the construction tick sees it on-site.
        const builderT = builder ? world.get(builder, Transform) : null;
        if (builder && builderT?.ok) {
          const bt = world.get(e, Transform);
          // move builder to the site (offset +1,+1 on X/Z); keep its own Y.
          if (bt.ok) world.set(builder, Transform, { pos: [bt.value.pos[0] + 1, builderT.value.pos[1], bt.value.pos[2] + 1] });
        }
        return e as unknown as number;
      },
      // `train(buildingEntity, unitTypeId)` enqueues a unit in that building's
      // production queue (spends resources). The building must be COMPLETE.
      // Returns true if enqueued.
      train: (buildingEntity: number, unitTypeId: string) => {
        if (!buildingSystem) return false;
        return buildingSystem.trainUnit(buildingEntity as unknown as import('@forgeax/engine-ecs').EntityHandle, unitTypeId);
      },
      // `setRally(buildingEntity, x, z)` sets a building's rally point so trained
      // units head there.
      setRally: (buildingEntity: number, x: number, z: number) => {
        buildingSystem?.setRally(buildingEntity as unknown as import('@forgeax/engine-ecs').EntityHandle, x, z);
      },
      // `liftOff` / `landAt` for the Terran lift seam (verify only).
      liftOff: (buildingEntity: number) =>
        buildingLift?.liftOff(buildingEntity as unknown as import('@forgeax/engine-ecs').EntityHandle) ?? false,
      landAt: (buildingEntity: number, x: number, z: number) =>
        buildingLift?.landAt(buildingEntity as unknown as import('@forgeax/engine-ecs').EntityHandle, x, z) ?? false,
      // `probeBuildings()` reads every Building entity's {typeId, state,
      // buildProgress, queueLength} so a verify run can confirm a building
      // constructs over time + its production queue drains.
      probeBuildings: () => {
        const STATE_NAMES = ['placing', 'constructing', 'complete', 'morphing'];
        const out: Array<Record<string, unknown>> = [];
        for (let raw = 0; raw < 6000; raw++) {
          const eh = raw as unknown as import('@forgeax/engine-ecs').EntityHandle;
          const b = world.get(eh, Building);
          if (!b.ok) continue;
          const queue = buildingProductionQueue.get(eh);
          out.push({
            entity: raw,
            typeId: buildingTypeId.get(eh) ?? null,
            state: STATE_NAMES[b.value.state] ?? b.value.state,
            buildProgress: Number(b.value.buildProgress.toFixed(3)),
            hasRally: b.value.hasRally,
            isPowered: b.value.isPowered,
            queueLength: queue ? queue.length : 0,
            queueHead: queue && queue.length ? { itemId: queue[0].itemId, progress: Number(queue[0].progress.toFixed(3)) } : null,
          });
        }
        return out;
      },
      // ── M9 ability verify helpers ─────────────────────────────────────────
      // `castAbility(casterEntity, abilityId, {targetEntity?, x?, z?})` runs the
      // full cast pipeline: validate -> spend energy -> set cooldown -> apply the
      // in-scope effects. Returns true if the cast went through. With the default
      // caster fixtures: cast 'phase_snipe' at the enemy -> its hp drops 70 +
      // caster energy drops 60; cast 'heal' at the wounded ally -> ally hp climbs
      // + caster energy drops. The caster id is `caster()`, targets are
      // `casterTargets()`.
      castAbility: (
        casterEntity: number,
        abilityId: string,
        target?: { targetEntity?: number; x?: number; z?: number },
      ) => {
        if (!abilitySystem) return false;
        const eh = casterEntity as unknown as import('@forgeax/engine-ecs').EntityHandle;
        return abilitySystem.castAbility(eh, abilityId, {
          targetEntity: target?.targetEntity !== undefined
            ? (target.targetEntity as unknown as import('@forgeax/engine-ecs').EntityHandle)
            : undefined,
          x: target?.x,
          z: target?.z,
        });
      },
      // `probeEnergy(ids?)` -> per-entity {energy, maxEnergy}. Default = the caster
      // fixture. Use to confirm a cast dropped the caster's energy.
      probeEnergy: (ids?: number[]) => {
        const out: Array<{ entity: number; energy: number; maxEnergy: number } | null> = [];
        const readOne = (raw: number) => {
          const eh = raw as unknown as import('@forgeax/engine-ecs').EntityHandle;
          const er = world.get(eh, Energy);
          out.push(er.ok ? { entity: raw, energy: Number(er.value.energy.toFixed(2)), maxEnergy: er.value.maxEnergy } : null);
        };
        const list = ids && ids.length
          ? ids
          : (casterEntityRef ? [casterEntityRef as unknown as number] : []);
        for (const id of list) readOne(id);
        return out;
      },
      // `abilitiesOf(entity)` -> its runtime abilityIds list.
      abilitiesOf: (entity: number) =>
        abilityIds.get(entity as unknown as import('@forgeax/engine-ecs').EntityHandle) ?? [],
      // `fireAbilityEvent(abilityId, x?, z?, entity?)` emits the `ability:used`
      // bus event directly — a verify aid for the ability-VFX dispatch (the
      // bespoke per-ability effect fires off this event; casting the real ability
      // needs a specific unit + upgrade, which a smoke test can't easily set up).
      fireAbilityEvent: (abilityId: string, x?: number, z?: number, entity?: number, targetEntity?: number) => {
        const ent = entity ?? (casterEntityRef as unknown as number) ?? 0;
        EventBus.instance.emit('ability:used', { entity: ent, abilityId, targetX: x, targetZ: z, targetEntity });
        return abilityId;
      },
      // `fireTeleport(fromX,fromZ,toX,toZ)` emits the `fx:teleport` bus event
      // (the same one `executeTeleport` emits after a blink) — a verify aid for the
      // blink VFX (departure implosion @from + arrival burst @to).
      fireTeleport: (fromX = 0, fromZ = 0, toX = 10, toZ = 0) => {
        const ent = (casterEntityRef as unknown as number) ?? 0;
        EventBus.instance.emit('fx:teleport', { entity: ent, fromX, fromZ, toX, toZ });
        return { fromX, fromZ, toX, toZ };
      },
      // `fireLifecycle(event, opts)` emits an ability-lifecycle event directly (the
      // SAME events the ability system emits on real casts) — a verify aid for the
      // lifecycle-driven stateful VFX (flame_dash sustained shell, cloak toggle burst)
      // that need a specific unit/target to cast normally. event ∈ cast_start |
      // sustained_start | sustained_end | sustained_complete | toggle_complete.
      fireLifecycle: (
        event: string,
        opts: { entity?: number; abilityId?: string; x?: number; z?: number; duration?: number; castTime?: number; stateId?: string; active?: boolean } = {},
      ) => {
        const ent = opts.entity ?? (casterEntityRef as unknown as number) ?? 0;
        const a = opts.abilityId ?? '';
        if (event === 'cast_start') EventBus.instance.emit('ability:cast_start', { entity: ent, abilityId: a, castTime: opts.castTime ?? 1 });
        else if (event === 'sustained_start') EventBus.instance.emit('ability:sustained_start', { entity: ent, abilityId: a, targetX: opts.x, targetZ: opts.z, duration: opts.duration });
        else if (event === 'sustained_end') EventBus.instance.emit('ability:sustained_end', { entity: ent, abilityId: a });
        else if (event === 'sustained_complete') EventBus.instance.emit('ability:sustained_complete', { entity: ent, abilityId: a, targetX: opts.x, targetZ: opts.z });
        else if (event === 'toggle_complete') EventBus.instance.emit('ability:toggle_complete', { entity: ent, stateId: opts.stateId ?? 'cloak', active: opts.active ?? true });
        return { event, entity: ent };
      },
      // `spawnCaster(x,z)` -> spawn a fresh player caster (goliath chassis, 200
      // energy, abilities phase_snipe+heal). Returns its entity id.
      spawnCaster: (x = 0, z = 0) => {
        const e = spawnCasterAtRef?.(x, z) ?? null;
        return e ? (e as unknown as number) : null;
      },
      // The default caster fixture + its two pre-spawned targets (wounded ally for
      // heal, enemy for phase_snipe).
      caster: () => (casterEntityRef ? (casterEntityRef as unknown as number) : null),
      casterTargets: () => ({
        ally: casterAllyRef ? (casterAllyRef as unknown as number) : null,
        enemy: casterEnemyRef ? (casterEnemyRef as unknown as number) : null,
      }),
      // `probeAbility(entity)` -> {abilityIds, cooldowns, buffs, energy} for a unit
      // (debugging the cast pipeline + buff lifecycle).
      probeAbility: (entity: number) => {
        const eh = entity as unknown as import('@forgeax/engine-ecs').EntityHandle;
        const er = world.get(eh, Energy);
        const hr = world.get(eh, Health);
        return {
          entity,
          abilityIds: abilityIds.get(eh) ?? [],
          energy: er.ok ? Number(er.value.energy.toFixed(2)) : null,
          maxEnergy: er.ok ? er.value.maxEnergy : null,
          hp: hr.ok ? hr.value.hp : null,
          maxHp: hr.ok ? hr.value.maxHp : null,
        };
      },
      // ── M9 chunk 2 verify helpers (upgrades / forms / morph) ──────────────
      // `research(playerId, upgradeId)` enqueues an upgrade in a complete research
      // building owned by the player (spends real UpgradeDef cost). Returns the
      // {building, ok}. Over its research time the level rises; affected units'
      // final damage/armor/range climb. `upgradeLevel(playerId, upgradeId)` reads
      // the current level. To verify the STAT effect deterministically, use
      // `grantUpgrade(playerId, upgradeId)` (skips the queue: bumps level + applies
      // immediately) then read a unit's Attack.damage / Health.armor.
      research: (_playerId: number, upgradeId: string) => {
        if (!buildingSystem) return { ok: false, reason: 'no-building-system' };
        // Scan complete buildings; researchUpgrade internally checks the building
        // def's canResearch list + cost/max-level, so we just try each one.
        for (let raw = 0; raw < 6000; raw++) {
          const eh = raw as unknown as import('@forgeax/engine-ecs').EntityHandle;
          const b = world.get(eh, Building);
          if (!b.ok || b.value.state !== 2 /* COMPLETE */) continue;
          if (buildingSystem.researchUpgrade(eh, upgradeId)) return { ok: true, building: raw };
        }
        return { ok: false, reason: 'no-eligible-building' };
      },
      // Deterministic stat-effect verify: bump the level + apply now (no queue).
      grantUpgrade: (playerId: number = PLAYER_ID.PLAYER, upgradeId = 'infantry_weapons') => {
        if (!upgradeManager) return null;
        return upgradeManager.completeUpgrade(playerId, upgradeId);
      },
      upgradeLevel: (playerId: number = PLAYER_ID.PLAYER, upgradeId = 'infantry_weapons') =>
        upgradeManager?.getLevel(playerId, upgradeId) ?? 0,
      // `switchForm(entity, formId)` swaps a unit to/from a form (siege tank, roach
      // brace, ...). Returns true if it switched. Confirm via `probeForm(entity)`
      // (activeFormId + Attack.range/damage change).
      switchForm: (entity: number, formId: string) =>
        formSwitch?.switchForm(entity as unknown as import('@forgeax/engine-ecs').EntityHandle, formId) ?? false,
      // `morphUnit(entity, targetTypeId)` begins a unit morph (zergling->baneling).
      // Charges cost, shows an egg, completes after the target's build time. Confirm
      // via `probeForm(entity)` (unitTypeId changes once complete).
      morphUnit: (entity: number, targetTypeId: string) =>
        unitMorph?.startMorph(entity as unknown as import('@forgeax/engine-ecs').EntityHandle, targetTypeId) ?? false,
      // `probeForm(entity)` -> {typeId, activeFormId, morphing, morphProgress, hp,
      // damage, range, armor} so a verify run can confirm a form/morph transform.
      probeForm: (entity: number) => {
        const eh = entity as unknown as import('@forgeax/engine-ecs').EntityHandle;
        const at = world.get(eh, Attack);
        const hr = world.get(eh, Health);
        const ut = world.get(eh, UnitType);
        const ss = world.get(eh, UnitStats);
        return {
          entity,
          typeId: unitTypeId.get(eh) ?? null,
          activeFormId: formActiveId.get(eh) ?? null,
          morphing: unitMorph?.isMorphing(eh) ?? false,
          morphProgress: unitMorph ? Number((unitMorph.morphProgress(eh)).toFixed(3)) : 0,
          hp: hr.ok ? hr.value.hp : null, maxHp: hr.ok ? hr.value.maxHp : null,
          armor: hr.ok ? hr.value.armor : null,
          damage: at.ok ? at.value.damage : null, range: at.ok ? Number(at.value.range.toFixed(2)) : null,
          finalDamage: ss.ok ? ss.value.finalDamage : null,
          upgradeAttackBonus: ss.ok ? ss.value.upgradeAttackBonus : null,
          category: ut.ok ? ut.value.category : null,
        };
      },
      // ── M9 chunk 3 verify helpers (ground-effect / hazard / creep / garrison /
      //    detection / summon / recall) ──────────────────────────────────────
      // `spawnGroundEffect(typeId, x, z, playerId?, radius?, duration?)` drops a
      // persistent ground AoE zone (e.g. 'corrosive_bile' / 'flame_trail'). A unit
      // standing in it loses hp over time (tick every 0.5s). Returns the zone id.
      // Verify: spawn a zone over an enemy unit, wait a few seconds, its hp drops.
      spawnGroundEffect: (
        typeId = 'corrosive_bile', x = 0, z = 0,
        playerId: number = PLAYER_ID.PLAYER, radius = 4, duration = 8,
      ) => {
        const e = groundEffectSystem?.spawnGroundEffect({ typeId, x, z, playerId, radius, duration }) ?? null;
        return e ? (e as unknown as number) : null;
      },
      // `probeGroundEffects()` -> every live zone {typeId, playerId, radius,
      // remaining, x, z}.
      probeGroundEffects: () => groundEffectSystem?.probe() ?? [],
      // `spawnHazard(...)` drops a hazard zone (lurker spine / mine / force field).
      // With areaEffects it damages enemies in range; blocksMovement gates ground
      // pathing. Returns the hazard id.
      spawnHazard: (
        hazardTypeId = 'lurker_spine', x = 0, z = 0,
        playerId: number = PLAYER_ID.PLAYER, radius = 3, duration = 8,
      ) => {
        const caster = casterEntityRef;
        if (!hazardSystem || !caster) return null;
        const e = hazardSystem.spawnHazard({
          hazardTypeId, x, z, playerId, casterEntity: caster,
          hp: 0, duration, shape: 'circle', radius,
          blocksMovement: true,
          areaEffects: [{ type: 'damage', amount: 8, damageType: 'spell' }],
          areaInterval: 1.0,
        });
        return e ? (e as unknown as number) : null;
      },
      probeHazards: () => hazardSystem?.probe() ?? [],
      // `spawnDirectionWave(x,z, dirX,dirZ, ...)` fires a sonar-style corridor
      // wave from (x,z) along (dirX,dirZ): it travels, path-reveals fog, and
      // applies `sonar_revealed` to enemies it passes (each once). Verify:
      // place an enemy on the path, fire the wave, `probeDirectionWaves()` shows
      // traveled climbing + hits>0, and the enemy gains the reveal debuff. The
      // caster/playerId is the local player (enemies = other factions).
      spawnDirectionWave: (
        x = 0, z = 0, dirX = 1, dirZ = 0,
        opts?: { speed?: number; maxRange?: number; width?: number; revealRange?: number; revealDuration?: number; playerId?: number },
      ) => {
        if (!directionWaveSystem) return null;
        const e = directionWaveSystem.spawnDirectionWave({
          casterEntity: (casterEntityRef ?? (0 as unknown as typeof casterEntityRef))!,
          playerId: opts?.playerId ?? PLAYER_ID.PLAYER,
          x, z, dirX, dirZ,
          speed: opts?.speed ?? 14,
          maxRange: opts?.maxRange ?? 27 * 1.84,
          width: opts?.width ?? 2.5 * 1.84,
          revealRange: opts?.revealRange ?? 4 * 1.84,
          revealDuration: opts?.revealDuration ?? 6,
          hitEffects: [{
            type: 'apply_debuff', debuffId: 'sonar_revealed', duration: 6,
            modifiers: [{ stat: 'isRevealed', mode: 'add', value: 1 }], stackMode: 'refresh',
          }],
        });
        return e ? (e as unknown as number) : null;
      },
      probeDirectionWaves: () => directionWaveSystem?.probe() ?? [],
      // `poweredAt(x,z, playerId?)` -> true if a completed friendly pylon covers
      // (x,z) (Protoss power grid). Build a pylon, then a point within 7 world
      // units reads true, farther reads false — the gate placement + production use.
      poweredAt: (x = 0, z = 0, playerId: number = PLAYER_ID.PLAYER) =>
        buildingSystem?.isPoweredAt(playerId, x, z) ?? false,
      // `giveMinerals(amount, playerId?)` deposits minerals (verify aid so a test
      // can afford a structure without waiting out harvesting under throttled sim).
      giveMinerals: (amount = 500, playerId: number = PLAYER_ID.PLAYER) => {
        resourceManager?.addMinerals(playerId, amount);
        return resourceManager?.getResources(playerId)?.minerals ?? 0;
      },
      // `forceComplete(entity?)` flips a building (or, if no id given, every
      // CONSTRUCTING building — best-effort raw scan) to COMPLETE + full HP — a
      // deterministic verify aid so tests don't wait out real build times (e.g. an
      // 18s pylon) under headless rAF throttling. Pass the id `build()` returned
      // (the raw scan misses recycled gen>0 handles). Returns how many completed.
      forceComplete: (entity?: number) => {
        const complete = (eh: import('@forgeax/engine-ecs').EntityHandle): boolean => {
          const b = world.get(eh, Building);
          if (!b.ok || b.value.state === BUILDING_STATE.COMPLETE) return false;
          const h = world.get(eh, Health);
          world.set(eh, Building, { state: BUILDING_STATE.COMPLETE, buildProgress: 1 });
          if (h.ok) world.set(eh, Health, { hp: h.value.maxHp });
          return true;
        };
        if (entity !== undefined) return complete(entity as unknown as import('@forgeax/engine-ecs').EntityHandle) ? 1 : 0;
        let n = 0;
        for (let raw = 0; raw < 6000; raw++) {
          if (complete(raw as unknown as import('@forgeax/engine-ecs').EntityHandle)) n++;
        }
        return n;
      },
      // `isOnCreep(x, z)` -> true if creep covers (x,z). Spawn a hatchery (creep
      // source), wait ~2s for the source list to refresh + radius to grow, then a
      // point near it returns true.
      isOnCreep: (x = 0, z = 0) => creepSystem?.isOnCreep(x, z) ?? false,
      creepOwner: (x = 0, z = 0) => creepSystem?.getCreepOwner(x, z) ?? null,
      probeCreep: () => creepSystem?.probe() ?? [],
      markStartingBase: (entity: number) =>
        creepSystem?.markStartingBase(entity as unknown as import('@forgeax/engine-ecs').EntityHandle),
      // `garrisonLoad(unit, carrier)` / `garrisonUnloadAll(carrier)` drive the
      // GarrisonSystem directly (verify). `probeGarrison(carrier)` reads the
      // carrier's {capacity, usedSlots, loaded[]}.
      garrisonLoad: (unit: number, carrier: number) =>
        garrisonSystem?.loadUnit(
          unit as unknown as import('@forgeax/engine-ecs').EntityHandle,
          carrier as unknown as import('@forgeax/engine-ecs').EntityHandle,
        ) ?? false,
      garrisonUnloadAll: (carrier: number) =>
        garrisonSystem?.unloadAll(carrier as unknown as import('@forgeax/engine-ecs').EntityHandle),
      probeGarrison: (carrier: number) =>
        garrisonSystem?.probe(carrier as unknown as import('@forgeax/engine-ecs').EntityHandle) ?? null,
      // `isVisibleToEnemy(entity)` -> false for an undetected cloaked unit.
      isVisibleToEnemy: (entity: number) =>
        detectionSystem?.isVisibleToEnemy(entity as unknown as import('@forgeax/engine-ecs').EntityHandle) ?? true,
      isCloaked: (entity: number) =>
        detectionSystem?.isCloaked(entity as unknown as import('@forgeax/engine-ecs').EntityHandle) ?? false,
      // `summon(typeId, count, x, z, playerId?, lifetime?)` spawns summoned units
      // (illusions/broodlings/interceptors). Returns their ids. With a lifetime
      // they auto-despawn (SummonedLifetime -> DeathSystem).
      summon: (
        typeId = 'broodling', count = 2, x = 0, z = 0,
        playerId: number = PLAYER_ID.PLAYER, lifetime = 6,
      ) => {
        const caster = casterEntityRef;
        if (!summonSystem || !caster) return [];
        const ids = summonSystem.summon({
          unitTypeId: typeId, count, x, z, playerId, casterEntity: caster, lifetime,
        });
        return ids.map((e) => e as unknown as number);
      },
      probeSummons: () => summonSystem?.probe() ?? [],
      recall: (x = 0, z = 0, radius = 8) => {
        const caster = casterEntityRef;
        if (!summonSystem || !caster) return false;
        summonSystem.recall(world, caster, x, z, radius);
        return true;
      },
      // ── M9 chunk 4 verify helpers (triggers / building-morph / larva) ─────
      // `probeTriggers(entity)` -> {abilityIds, activatedPassives, triggers[]} for a
      // unit. Default = the caster fixture (a goliath with the tactical_mark passive
      // granted). The caster's tactical_mark passive should appear ACTIVATED, with
      // its on_attack_hit / on_damage_dealt triggers listed. After casting
      // phase_snipe at the enemy, the enemy gains the `tactical_mark` debuff (the
      // trigger fired) — confirm via `probeAbility(casterTargets().enemy)` showing
      // the buff, or by re-reading probeTriggers' cooldown state.
      probeTriggers: (entity?: number) => {
        if (!triggerSystem) return null;
        const raw = entity ?? (casterEntityRef ? (casterEntityRef as unknown as number) : null);
        if (raw === null) return null;
        return triggerSystem.probe(raw as unknown as import('@forgeax/engine-ecs').EntityHandle);
      },
      // `buffsOf(entity)` -> the entity's active buff ids (to confirm a trigger
      // applied a buff/debuff to its target).
      buffsOf: (entity: number) => {
        const arr = abilityBuffsImport.get(entity as unknown as import('@forgeax/engine-ecs').EntityHandle) ?? [];
        return arr.map((b) => ({ id: b.id, remaining: Number(b.remaining.toFixed(2)), isDebuff: b.isDebuff }));
      },
      // `morphBuilding(buildingEntity, targetTypeId)` begins a building morph
      // (e.g. hatchery->lair). Charges the cost diff, flips to MORPHING; over the
      // target's build time `probeBuildings()` shows morphProgress climb, then the
      // typeId swaps to the target. Returns true if the morph started.
      morphBuilding: (buildingEntity: number, targetTypeId: string) =>
        buildingSystem?.morphBuilding(
          buildingEntity as unknown as import('@forgeax/engine-ecs').EntityHandle, targetTypeId,
        ) ?? false,
      // `probeLarva(buildingEntity)` -> {larvaCount, larvae[]} for a Zerg town hall.
      // A complete hatchery spawns larvae over time (up to 3+); `train(hatchery,
      // 'zergling')` consumes an idle larva into a hatching egg (state 'morphing'),
      // which hatches into the unit after its build time.
      probeLarva: (buildingEntity: number) =>
        buildingSystem?.probeLarva(
          buildingEntity as unknown as import('@forgeax/engine-ecs').EntityHandle,
        ) ?? null,
      // `spawnHatchery(x, z)` drops a COMPLETE player hatchery (a Zerg larva
      // producer) so larva spawn + larva-train + egg-hatch are verifiable. Returns
      // the entity id. After ~1-2s `probeLarva(id)` shows larvae; `train(id,
      // 'zergling')` then hatches one.
      spawnHatchery: (x = 0, z = 0) => {
        if (!factoryCtxRef) return null;
        const e = spawnUnit(world, factoryCtxRef, {
          typeId: 'hatchery', x, z,
          playerId: PLAYER_ID.PLAYER, playerColor: factionColor(PLAYER_ID.PLAYER),
          isComplete: true,
        });
        return e ? (e as unknown as number) : null;
      },
      // ── M10 fog of war / vision / minimap verify helpers ──────────────────
      // `isVisible(x,z)` / `isExplored(x,z)` query the LOCAL player's vision grid
      // at a world point. An enemy unit far from any player unit sits on a cell
      // that is NOT visible (false); moving a player unit near it makes the cell
      // visible (true) next frame — that is the fog reveal verification.
      isVisible: (x = 0, z = 0) => visionSystem?.isVisible(x, z) ?? false,
      isExplored: (x = 0, z = 0) => visionSystem?.isExplored(x, z) ?? false,
      // `probeVision()` -> counts of visible / explored cells (+ resolution) for the
      // local player. visible should be a small fraction of total (the army's
      // footprint); explored grows as the army moves.
      probeVision: () => visionSystem?.probe() ?? null,
      // `toggleFog(on)` enables/disables fog. With `false`, ALL enemy units/buildings
      // are shown (no hiding) + the ground-fog decals are cleared — use it to
      // confirm a hidden enemy reappears (the hide is fog, not a despawn). Returns
      // the new state.
      toggleFog: (on = true) => { fogSystem?.toggleFog(on); return fogSystem?.enabled() ?? null; },
      // `probeFog()` -> {enabled, hidden, decals}: how many enemies are currently
      // fog-hidden + how many ground-fog decals are live.
      probeFog: () => fogSystem?.probe() ?? null,
      // `minimapActive()` -> true if the minimap canvas was created (DOM present).
      minimapActive: () => minimap?.active() ?? false,
      // ── M12 HUD verify helpers ────────────────────────────────────────────
      // `hudState()` -> a live snapshot of the HUD reflecting CURRENT game state:
      // the resource-bar numbers + text, the selection-panel summary (count +
      // single-unit hp/shield/energy), the command-card button ids/labels/enabled
      // flags + costs, and the selected building's production queue. Rebuilt from
      // live handles on every call, so a headless run can assert the HUD tracks
      // state (e.g. resourceBar.minerals matches resources().minerals; selecting a
      // Command Center shows a `train_scv` button).
      hudState: () => hud?.hudState() ?? null,
      // `clickCommand(buttonId)` simulates a command-card click: looks up the
      // button by id in the live registry and invokes its real action (train /
      // build / research / cast). Returns true if the action was performed.
      // e.g. select a complete CC, then `clickCommand('train_scv')` enqueues an
      // SCV + drops minerals (confirm via `hudState().resourceBar` + `probeBuildings`).
      clickCommand: (buttonId: string) => hud?.clickCommand(buttonId) ?? false,
      // `hudActive()` -> true if the DOM HUD was created (document present).
      hudActive: () => hud?.active() ?? false,
      // ── M19 win/lose verify helpers ───────────────────────────────────────
      // `probeVictory()` -> {resolved, isVictory, reason, player/enemyBuildings,
      // kills/losses, gameTime}. `forceEliminate(playerId)` kills all of a player's
      // buildings (+units), then `checkVictory()` resolves → GameOverScreen shows.
      // `probeAlerts()` -> {active, total}; `pushAlert(type,msg,x?,z?)` fires one.
      // Alerts also fire from the bus: under_attack (local combat:damage_taken),
      // unit_died (local combat:kill), build/train/upgrade_complete (building-system).
      probeAlerts: () => ({ active: alerts?.active() ?? 0, total: alerts?.total() ?? 0 }),
      pushAlert: (type = 'under_attack', msg = 'Test', x?: number, z?: number) => { alerts?.push(type, msg, x, z); return type; },
      // `probeControlGroups()` -> {groups:{n:count}, active}. `assignGroup(n)` snapshots
      // the current selection into group n; `recallGroup(n)` selects it. (In-game:
      // Ctrl+N assigns, N recalls, N-twice centres.)
      probeControlGroups: () => controlGroups?.probe() ?? { groups: {}, active: -1 },
      assignGroup: (n = 1) => { controlGroups?.assign(n); return controlGroups?.probe() ?? null; },
      recallGroup: (n = 1) => { controlGroups?.recall(n); return selection?.getSelected().length ?? 0; },
      // `probeTimeApm()` -> {time, apm}; `probeIdle()` -> {idleWorkers, idleProduction}.
      probeTimeApm: () => gameTimeApm?.probe() ?? { time: '00:00', apm: 0 },
      probeIdle: () => idleTracker?.probe() ?? { idleWorkers: 0, idleProduction: 0 },
      // `probeRally()` -> count of rally line/flag markers drawn for selected buildings.
      probeRally: () => ({ markers: rallyRenderer?.active() ?? 0 }),
      // `probeMinimapPings()` -> count of live minimap alert pings (positioned alerts add one).
      probeMinimapPings: () => ({ count: minimapPingsRef?.count() ?? 0 }),
      // `probeUpgradeMarkers()` -> [{id,level}] of the local player's shown upgrade badges.
      probeUpgradeMarkers: () => upgradeMarkers?.probe() ?? [],
      // `openSettings()`/`probeSettings()` — the SettingsPanel (F10 in-game).
      openSettings: () => { settingsPanel?.open(); return settingsPanel?.isOpen() ?? false; },
      probeSettings: () => settingsPanel?.get() ?? null,
      probeVictory: () => victory?.probe() ?? { resolved: false },
      checkVictory: () => { victory?.check(); return victory?.probe() ?? null; },
      forceEliminate: (playerId = PLAYER_ID.ENEMY) => {
        let killed = 0;
        for (let raw = 0; raw < 9000; raw++) {
          const e = raw as unknown as import('@forgeax/engine-ecs').EntityHandle;
          const f = world.get(e, Faction);
          if (!f.ok || f.value.playerId !== playerId) continue;
          // kill buildings (win condition) + units of this player.
          const isB = world.get(e, Building).ok;
          const isU = world.get(e, UnitType).ok;
          if (!isB && !isU) continue;
          const h = world.get(e, Health);
          if (h.ok && !h.value.isDead) { world.set(e, Health, { hp: 0, isDead: true }); killed++; }
        }
        return killed;
      },
      // ── M11 VFX verify helpers ────────────────────────────────────────────
      // `spawnVfx(kind, x, z, opts?)` spawns a CORE effect at terrain height under
      // (x,z): kind in impact|explosion|muzzle|spark|blood|shield_hit|cast_flash|
      // death_debris|slash|flame|slime|shockwave (the last four are M11 ch2
      // per-weapon bespoke effects). The effect's transient particle entities appear then self-
      // despawn within their lifetime (verify: `probeVfx()` count rises then
      // returns to ~0). Deterministic (seeded RNG, no input). Returns the kind.
      spawnVfx: (kind: VfxKind = 'explosion', x = 0, z = 0, opts?: { color?: [number, number, number]; size?: number; dirX?: number; dirZ?: number }) => {
        vfx?.spawnVfxOnGround(kind, x, z, opts ?? {});
        return kind;
      },
      // `probeVfx()` -> the count of LIVE VFX particle entities. After a burst it
      // rises (one effect = several entities) then returns to ~0 once they expire
      // (the no-leak verification). Combat/kills also auto-spawn VFX via the bus,
      // so during a skirmish it stays > 0 while fighting, then drains to 0.
      probeVfx: () => ({ active: vfx?.active() ?? 0 }),
      // ── M17 chunk C: persistent buff-aura verify helpers ──────────────────
      // `probeBuffAuras()` -> one row per LIVE aura {entity, buffId, marker, ground}.
      probeBuffAuras: () => buffAuras?.probe() ?? [],
      // `probeStatefulVfx()` -> one row per LIVE bespoke ability VFX {entity, buffId,
      // kind, parts} (e.g. the stellar_insight floating eye = kind 'eye', 5 parts).
      probeStatefulVfx: () => statefulVfx?.probe() ?? [],
      // `applyTestBuff(entity, buffId)` drives the REAL aura path from data: it looks
      // up the buff's declarative config (findBuffConfig), actually adds the buff to
      // the entity (so hasBuff stays true → the aura persists), and emits the same
      // `ability:buff_applied` the effect-executor emits on a real cast. Self-buffs
      // with a top-level apply_buff+vfx: stim_pack / missile_barrage / stellar_insight.
      applyTestBuff: (entity: number, buffId = 'stim_pack') => {
        const cfg = findBuffConfig(buffId);
        if (!cfg) return { ok: false, reason: 'no such buff' };
        const eh = entity as unknown as import('@forgeax/engine-ecs').EntityHandle;
        if (!world.get(eh, Transform).ok) return { ok: false, reason: 'no such entity' };
        addBuff(eh as unknown as never, makeBuff({
          id: buffId, duration: cfg.duration, modifiers: cfg.modifiers,
          sourceEntity: entity, isDebuff: cfg.isDebuff, vfx: cfg.vfx,
        }));
        EventBus.instance.emit('ability:buff_applied', { entity, buffId, duration: cfg.duration, vfx: cfg.vfx });
        return { ok: true, buffId, hasVfx: !!cfg.vfx };
      },
      // `removeTestBuff(entity, buffId)` — symmetric teardown: removes the real buff
      // AND emits `ability:buff_removed` (the aura despawns its marker/ground meshes;
      // motes self-expire). Verifies the no-orphan teardown path deterministically.
      removeTestBuff: (entity: number, buffId = 'stim_pack') => {
        const eh = entity as unknown as import('@forgeax/engine-ecs').EntityHandle;
        const removed = removeBuff(eh as unknown as never, buffId);
        EventBus.instance.emit('ability:buff_removed', { entity, buffId });
        return { ok: removed };
      },
      // ── M16 audio / BGM verify helpers ────────────────────────────────────
      // `audioState()` -> the BGM manager's live status: the current phase
      // (menu|economy|battle|gameover), the desired track KEY + resolved served
      // URL, whether a track is actually playing, whether autoplay has been armed
      // (a user gesture happened), audioAvailable, master/bgm/effective volume,
      // the local race, and seconds since the last local-player combat. Verify:
      //  • at boot: phase 'economy', desiredKey 'economy:terran', desiredUrl a
      //    .mp3 under .../assets/music/ (fetch it -> 200); isPlaying false + armed
      //    false (autoplay not yet allowed) — silent, no console error.
      //  • fetch(audioState().desiredUrl) resolves (the mp3 is served).
      //  • run `spawnSkirmish()` near player units (or ensure the local army
      //    fights) — within ~0.5s audioState().phase flips to 'battle' + desiredKey
      //    'battle:terran'; when combat stops, after ~5s it flips back to 'economy'.
      //  • `audioArm()` then audioState().armed=true and (if Audio present)
      //    isPlaying=true after a moment.
      audioState: () => audio?.state() ?? null,
      // `setVolume(master, bgm)` sets the master + bgm volume (0..1 each). Confirm
      // via audioState().masterVolume/bgmVolume/effectiveVolume.
      setVolume: (master = 0.8, bgm = 0.6) => { audio?.setVolume(master, bgm); return audio?.state() ?? null; },
      // `audioArm()` force-arms autoplay (simulates the first user gesture) so a
      // headless verify can start playback without a real pointer/key event.
      // Returns the post-arm state.
      audioArm: () => { audio?.arm(); return audio?.state() ?? null; },
      // Verify probe: read the first selected unit's Transform pos + Movement
      // fields + its current command (debugging M5 movement integration).
      probe: () => {
        const sel = selection?.getSelected() ?? [];
        if (!sel.length) return { selected: 0 };
        const e = sel[0];
        const t = world.get(e, Transform);
        const mv = world.get(e, Movement);
        return {
          selected: sel.length,
          entity: e as unknown as number,
          pos: t.ok ? { x: t.value.pos[0], z: t.value.pos[2], y: t.value.pos[1] } : 'no-transform',
          movement: mv.ok ? {
            speed: mv.value.speed, currentSpeed: mv.value.currentSpeed,
            hasTarget: mv.value.hasTarget, targetX: mv.value.targetX, targetZ: mv.value.targetZ,
            useFlowField: mv.value.useFlowField, flowDirX: mv.value.flowDirX, flowDirZ: mv.value.flowDirZ,
          } : 'no-movement',
          command: commandCurrent.get(e) ?? null,
        };
      },
      // Debug: count orphaned ChildOf children (parent not alive) — the
      // hierarchy-broken RhiError source. Reports how many + a sample.
      countOrphans: () => {
        let orphans = 0; const sample: Array<Record<string, unknown>> = [];
        for (let raw = 0; raw < 8000; raw++) {
          const e = raw as unknown as import('@forgeax/engine-ecs').EntityHandle;
          const co = world.get(e, ChildOf);
          if (!co.ok) continue;
          const parent = co.value.parent as unknown as import('@forgeax/engine-ecs').EntityHandle;
          const pAlive = world.get(parent, Transform).ok;
          if (!pAlive) {
            orphans++;
            if (sample.length < 5) sample.push({ entity: raw, parent: parent as unknown as number });
          }
        }
        return { orphans, sample };
      },
      // Debug: enemy (faction 1) workers' harvest state — diagnose AI economy.
      probeAiWorkers: () => {
        const out: Array<Record<string, unknown>> = [];
        for (let raw = 0; raw < 6000 && out.length < 10; raw++) {
          const e = raw as unknown as import('@forgeax/engine-ecs').EntityHandle;
          const f = world.get(e, Faction);
          if (!f.ok || f.value.playerId !== PLAYER_ID.ENEMY) continue;
          const h = world.get(e, Harvester);
          if (!h.ok) continue; // workers only
          const cmd = commandCurrent.get(e);
          const t = world.get(e, Transform);
          const mv = world.get(e, Movement);
          out.push({
            entity: raw, state: h.value.state, targetMineral: h.value.targetMineral,
            targetBase: h.value.targetBase, carryAmount: h.value.carryAmount,
            isHarvesting: h.value.isHarvesting, command: cmd ? cmd.type : null,
            pos: t.ok ? { x: +t.value.pos[0].toFixed(1), z: +t.value.pos[2].toFixed(1) } : null,
            mv: mv.ok ? { hasTarget: mv.value.hasTarget, tx: +mv.value.targetX.toFixed(1), tz: +mv.value.targetZ.toFixed(1), spd: mv.value.speed, cur: +mv.value.currentSpeed.toFixed(2) } : null,
          });
        }
        return out;
      },
      // ── M13 chunk 1 enemy-AI verify helpers ───────────────────────────────
      // `aiState()` -> the enemy AI's live status: build-order index/total +
      // current step + block reason, the attack phase + wave + threshold + army
      // size, worker count, and its resources. Over ~30-60s: buildOrderIndex
      // advances, workerCount + armySize climb, and attackPhase transitions
      // idle -> rallying -> attacking once armySize >= attackThreshold.
      aiState: () => enemyAi?.state() ?? null,
      // `aiMicro()` -> the enemy AI's live COMBAT-MICRO + advanced-behavior status
      // (M13 chunk 2): threatLevel + own/enemy strength, units currently
      // retreating, the current focus-fire target entity, whether workers are
      // defending, scouting status + completed runs, expansions started,
      // researches started, and building morphs started. Over a multi-minute
      // game with fights: focusTarget becomes >=0 during a base defense,
      // retreating>0 when wounded units pull back, threatLevel changes, and
      // expansions/researches climb past 0.
      aiMicro: () => enemyAi?.micro() ?? null,
      // `setAiDifficulty(name)` swaps the enemy AI's difficulty config
      // ('easy'|'normal'|'hard') live. Returns true if applied.
      setAiDifficulty: (name: 'easy' | 'normal' | 'hard') => enemyAi?.setDifficulty(name) ?? false,
      // `probeAiUnits()` -> the enemy player's unit/building counts by typeId
      // (army + workers + buildings) so a verify run can confirm the AI's forces
      // grow following its build order. Scans a raw-id range via world.get (same
      // gen-0 handle trick probeCombat uses; fine for the never-recycled AI army).
      probeAiUnits: () => {
        const units: Record<string, number> = {};
        const buildings: Record<string, number> = {};
        let army = 0, workers = 0;
        for (let raw = 0; raw < 8000; raw++) {
          const eh = raw as unknown as import('@forgeax/engine-ecs').EntityHandle;
          const f = world.get(eh, Faction);
          if (!f.ok || f.value.playerId !== PLAYER_ID.ENEMY) continue;
          const b = world.get(eh, Building);
          if (b.ok) {
            const tid = buildingTypeId.get(eh) ?? 'unknown';
            buildings[tid] = (buildings[tid] ?? 0) + 1;
            continue;
          }
          const ut = world.get(eh, UnitType);
          if (!ut.ok) continue;
          const tid = unitTypeId.get(eh) ?? 'unknown';
          if (tid === 'overlord' || tid === 'larva' || tid === 'egg') continue;
          units[tid] = (units[tid] ?? 0) + 1;
          if (ut.value.category === 0 /* WORKER */) workers++;
          else if (ut.value.category !== 3 /* not BUILDING */) army++;
        }
        return { army, workers, units, buildings };
      },
      // ── M15 chunk 1: deterministic lockstep verify helpers ────────────────
      // `lockstepState()` -> the live driver status when `?lockstep=1` is set:
      // current turn, whether the sim is stalled (waiting on a player's turn
      // commands), the buffer-health grade + speedScale, the turn duration /
      // ticks-per-turn, and the most recent recorded world checksum. Returns
      // { enabled:false } when lockstep mode is off (default play).
      lockstepState: () => lockstep ? { enabled: true, ...lockstep.state() } : { enabled: false },
      // `lockstepMove(entity, x, z, playerId?)` queues a MOVE command for a unit
      // into the current turn's batch (lockstep mode only). It executes when the
      // driver steps that turn — proving commands flow through the turn buffer.
      lockstepMove: (entity: number, x: number, z: number, playerId: number = PLAYER_ID.PLAYER) => {
        if (!lockstep) return false;
        lockstep.queueCommand(playerId, entity, { type: 'move', targetX: x, targetZ: z });
        return true;
      },
      // `checksumNow()` -> compute the deterministic world checksum on demand
      // (works with or without lockstep mode). Same world state -> same number;
      // fields: { checksum, entityCount, rngState, rngCallCount }. Call it twice
      // with no intervening state change to confirm stability.
      checksumNow: () => computeGameChecksum(world),
      // `determinismCheck()` -> THE determinism guarantee proof. Runs a fixed
      // seeded command sequence TWICE from the same seed (via the single seeded
      // RNG source + ordered/quantized hashing) and returns whether the two
      // resulting checksums are identical: { match:true, seed, turns, checksumA,
      // checksumB }. `match:true` demonstrates same-seed + same-commands ->
      // identical state. Note: it re-seeds the global sim RNG (dev/verify helper).
      determinismCheck: (seed?: number) => determinismCheck(seed),
      // `determinismDiscriminates()` -> negative control: two DIFFERENT seeds
      // yield DIFFERENT checksums ({ discriminates:true, ... }), proving the
      // checksum actually distinguishes divergent sims (not a constant).
      determinismDiscriminates: () => determinismDiscriminates(),
    };
  }

  console.info('[marscraft] M12 chunk 1 bootstrap complete — core in-game HUD as DOM overlays (resource bar / selection panel + portrait / 3x5 command card / production-queue strip / SC2 CursorManager) + tiny i18n (EN source + ZH overlay). Command-card buttons invoke the REAL systems. Hooks: hudState() + clickCommand(id) + hudActive().');
  console.info('[marscraft] M17 chunk C.1 — pre-game MainMenu (singleplayer setup) + command-card hover TooltipSystem. Menu shows on ?game=marscraft (no ?started); Start sets ?started=1&map=&race=&airace=&difficulty= + reloads. Applied this run: ' + JSON.stringify({ started: matchCfg.started, map: mapId, difficulty: matchCfg.difficulty, race: matchCfg.playerRaceChosen, aiRace: matchCfg.aiRaceChosen }) + '. Player race threads into town hall/worker/army + audio; AI race+difficulty into SimpleAI. Multiplayer/map-editor/settings = disabled seams (client-only, no server). Hooks: menuVisible() / startMatch(opts) / matchConfig().');
}
