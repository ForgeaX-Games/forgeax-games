// ============================================================================
//  ForgeaX: Hellforge — Diablo-like ARPG sample with an original world:
//  the great Hellforge's dying embers corrupt the land.
//
//  Act 1 slice: 余烬哨站 Cinderwatch (safe camp) → 灰烬荒原 Ashen Reach
//  (wilderness spawns) → 熔渣深窟 Slagdeep Hollow (PCG dungeon, clear-the-
//  hollow quest, boss 熔渣督军). Witch hero with full skinned mesh + 5
//  clips, active-cast skills, monsters, loot, leveling, ARPG HUD.
//
//  Controls
//    WASD            move (vector intent; cancels click path/target)
//    Space           dodge roll (free; i-frames during movement phase)
//    Mouse           aim (ground cursor unprojection from camera rig)
//    Wheel           zoom ARPG distance 10–14 m (pitch fixed)
//    Left-click      ground → path; enemy → pursue + frost; npc/loot/exit → interact
//    Right-click     cast domain-selected hotbar skill
//    1/2/3/4         select hotbar slot only (no cast)
//    C               character / combat-stat sheet
//    V               toggle arpg ⇄ showcase (camp-only; spring-arm; combat off)
//    R               respawn after death
//    F10             toggle render-settings panel (post / lighting / atmosphere)
//    Esc             close major panels / automap
//
//  Areas live in ONE world: the camp scene pack at the origin, the PCG
//  dungeon offset at (300, 300) — beyond the camera far plane, so neither
//  renders while you're in the other. Entering/leaving is a player teleport
//  (no engine scene switch → no full-rebuild renderer bug).
// ============================================================================

import {
  AnimationPlayer,
} from '@forgeax/engine-animation';
import {
  Camera,
  DirectionalLight,
  Materials,
  MeshFilter,
  MeshRenderer,
  PointLight,
  SceneInstance,
  Skylight,
  SkyboxBackground,
  SKYBOX_MODE_CUBEMAP,
  SpotLight,
  perspective,
} from '@forgeax/engine-render';
import {
  Name,
  Transform,
} from '@forgeax/engine-scene';
import { armSkinnedAnimationPlayer, collectRootJointTargetIds } from './src/bind-skinned-animation';
import {
  quat,
} from '@forgeax/engine-runtime';
import {
  type MaterialAsset,
} from '@forgeax/engine-types';
import {
  HANDLE_CUBE,
  HANDLE_QUAD,
} from '@forgeax/engine-assets-runtime';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import {
  ENTITY_NULL_RAW,
  Time,
  Update,
  type EntityHandle,
  type World,
} from '@forgeax/engine-ecs';
import type { BootstrapContext } from '@forgeax/engine-app';
import type { AnimationClip, EquirectAsset, Handle, MeshAsset, SceneAsset } from '@forgeax/engine-types';

import {
  createPlayerFromCombatStats,
  damagePlayer,
  syncRuntimeFromCombatStats,
  tickPlayer,
  xpForLevel,
} from './src/state';
import { deriveCombatStats, type CombatStats } from './src/combat-stats';
import { resolveIncomingDamage } from './src/damage';
import { FxSystem } from './src/fx';
import { COMBAT_EFFECT_DEFS, combatBeat } from './src/fx/defs';
import { upgradeFxSheetsFromPacks } from './src/fx/texture-packs';
import { createPerfProbe, readFoldedDraws } from './src/perf-probe';
import { createOwnerLedger, HELLFORGE_UPDATE_SYSTEMS } from './src/owner-ledger';
import { cutsceneBlocksChromeKey } from './src/cutscene-input';
import { MonsterManager, MONSTERS, DEN_MONSTER_KINDS, WILD_MONSTER_KINDS, type Monster } from './src/monsters';
import { LoadTracker } from './src/load-tracker';
import {
  createSkillCaster,
  skillDefForRanks,
  SkillSystem,
  type CastResult,
} from './src/skills';
import { clampFinisherTarget, FINISHER_ID } from './src/finisher';
import { resolveSkill } from './src/skill-resolver';
import { buildSkillTreeViewModel, installSkillPanel } from './src/skill-panel';
import {
  stateFromProgression,
  type SkillTreeFailReason,
  type SkillTreeResult,
} from './src/skill-tree';
import { installSkillFixture } from './src/dev-skill-fixture';
import { getHeroDef } from './src/heroes';
import { LOCOMOTION_IDLE_SPEED, selectLocomotionClip } from './src/locomotion';
import {
  abortDodge,
  cancelDodgeForSkillOrMove,
  createDodgeState,
  DODGE_MOVEMENT_S,
  dodgeAllowsSkillOrMove,
  dodgeHitReactionAborts,
  dodgeLocksTranslation,
  isDodging,
  isDodgeInvulnerable,
  tickDodge,
  tryStartDodge,
  type DodgeState,
} from './src/dodge';
import { normalizeClipRoot } from './src/anim-root';
import { BuffDisplay } from './src/buff-display';
import { createCharacterSelectionGate } from './src/selection-gate';
import {
  createSorceressDomain,
  type CharacterDomain,
} from './src/character-domain';
import { LootSystem } from './src/loot';
import { installHud, type SkillSlotState, type TargetViewModel } from './src/hud';
import { installCharacterPanel } from './src/character-panel';
import { Dungeon, DUNGEON_ORIGIN, denMountainRingOrigin } from './src/dungeon';
import { CELL, CELLS } from './src/dungeon-layout';
import {
  branchCurseDamageMul,
  createRoomEventState,
  noteMonsterKill,
  resetRoomEventState,
  showVaultCurseCard,
  tickVaultPresence,
} from './src/dungeon-room-events';
import { Sfx } from './src/sfx';
import {
  equipSlotsFor,
  rollDrop,
  RARITY_META,
  type Equipment, type ItemInstance,
} from './src/items';
import { hasFreeCell, type BagAnchor } from './src/bag-grid';
import { installInventory } from './src/inventory-ui';
import { installStashPanel } from './src/stash-ui';
import { installCubeUI } from './src/cube-ui';
import { salvageYield } from './src/crafting';
import {
  installRenderSettings,
  loadRenderSettings,
  type RenderSettings,
  type RenderSettingsApi,
} from './src/render-settings';
import {
  installHellforgePipeline,
  type HellforgeAtmosphereApi,
} from './src/render-pipeline';
import {
  CAMP_CAMPFIRE_BASE,
  CAMP_MOON_SPOT,
  CAMP_TORCH_BASE,
  DEN_FIXTURE_SPOT,
  PARKED_LIGHT_POS,
  SPOT_SLOT_BUDGET,
  ambientForArea,
  areaLightSeating,
  campMoonSpotPosition,
  denPointSeatPositions,
  denSpotSeatPositions,
  exposureMulForArea,
} from './src/light-director';
import { AmbientFx } from './src/ambient-fx';
import { installShell, type ShellHandle } from './src/shell';
import { installCharSelect, type CharSelectHandle } from './src/char-select';
import { installCharList, type CharListHandle } from './src/char-list';
import { installIntroVideo } from './src/intro-video';
import { installHeroPreview, type HeroPreviewHandle } from './src/hero-preview';
import { CLASS_DEFS, getClassDef, type CharacterRecord, type ClassId } from './src/classes';
import {
  ensureCharacterEnvelope,
  flushCharacterSaves,
  flushReturnToTitle,
  hydrateCharacter,
  installSaveLifecycleHooks,
  listCharacters,
  MAX_CHARACTERS,
  saveSnapshot,
} from './src/save';
import {
  filterReachedLandmarks,
  installAutomap,
  resolveRuntimeExitPosition,
  type AutomapSnapshot,
} from './src/automap';
import { createUiLayerManager, type MajorPanel } from './src/ui-layer-manager';
import { installFatalOverlay } from './src/fatal-overlay';
import { ensureUiStyles } from './src/ui-styles';
import { installUiCursors } from './src/ui-cursors';
import { installUiTooltip } from './src/ui-tooltip';
import { installUiTransition } from './src/ui-transition';
import { installCutsceneUi } from './src/cutscene-ui';
import { installLootCelebration } from './src/loot-celebration';
import {
  buildBossDefeatBeat,
  buildBossEntranceBeat,
  buildCampArrivalBeat,
  buildQuestAcceptanceBeat,
} from './src/cinematic-beats';
import {
  BEAT_FINISHER_FACE_CU,
  BEAT_FINISHER_HERO_SHOT,
  shouldFreezeAi,
  shouldPlayerBeInvulnerable,
} from './src/cinematic-policy';
import {
  takeBossDefeatTrigger,
  takeBossEntranceTrigger,
} from './src/cinematic-triggers';
import {
  buildFinisherFaceCu,
  buildFinisherHeroShot,
  FINISHER_FACE_CU_FALLBACK_Y,
  FINISHER_FACE_CU_ID,
  FINISHER_HERO_SHOT_ID,
  sampleCutscene,
  type CutsceneScript,
} from './src/cutscene';
import {
  createSeamRestoreGuard,
  type SeamRestoreGuard,
} from './src/hero-shot-seam';
import {
  eyeBiasForBone,
  eyeFocusFromHeadWorld,
  pickBestEyeFocusBone,
  translationFromWorldMat4,
} from './src/player-eye-focus';
import { ASHEN_REACH_BOUNDS, installWildTerrain, resetWildTerrainCache } from './src/wild-terrain';
import {
  bgmPhaseForMusic,
  CINEMATIC_BGM_DUCK_DB,
  installBgm,
  type BgmHandle,
} from './src/bgm';
import { ensureShadowCasters } from './src/ensure-shadow-casters';
import { contactRadiusForScale, installContactShadows } from './src/contact-shadow';
import {
  ARPG_DISTANCE_MAX,
  ARPG_DISTANCE_MIN,
  CAMERA_MODE_BLEND_S,
  DEFAULT_ARPG_PRESET,
  SHOWCASE_DISTANCE,
  aimOnGround,
  cameraBlendWeight,
  cameraQuat,
  createArpgCamera,
  lerpCameraRig,
  snapCameraFocus,
  updateArpgCamera,
  updateShowcaseCamera,
  worldToScreen as projectWorldToScreen,
  type CameraMode,
  type CameraRigState,
} from './src/camera-rig';
import { createObstacleCameraProbe } from './src/camera-probe';
import {
  buildCampFadeRegistry,
  createFadeDriver,
  selectBlockersNeedingFade,
  type FadeBlockerEntry,
} from './src/camera-fade';
import type { ActiveSkillId, AreaExitId } from './src/content-ids';
import {
  canEnterArea,
  canEnterSlagdeep,
  chooseSeededDecor,
  chooseSeededEncounters,
  enterArea as resolveAreaTransition,
  getAreaDef,
  nextWildSpawn,
  nextWildSpawnDelay,
  slagdeepCaveMouth,
} from './src/areas';
import {
  createCombatRunDomain,
  deriveAreaSeed,
  resetCombatRun,
  type CombatTransientResetters,
} from './src/combat-run';
import { dialogueFor } from './src/dialogue';
import { installDialogueUi } from './src/dialogue-ui';
import { installQuestLog, type QuestViewModel } from './src/quest-log';
import {
  acceptQuest,
  markQuestReady,
  PURGE_QUEST_ID,
  QUEST_TITLE,
  turnInQuest,
} from './src/quests';
import {
  createHellforgeNavigation,
  type AshenReachLayout,
  type ObstacleDoc,
} from './src/navigation';
import {
  createInteractionRegistry,
  LMB_PURSUIT_SKILL,
  reduceIntent,
  tickTargetIntent,
  wasdVectorFromKeys,
  type InteractionCandidate,
  type MovementIntent,
} from './src/movement-intent';
import {
  followPathDirection,
  integratePerAxisSlide,
  PATH_ARRIVE,
  PLAYER_SPRINT_SPEED,
  PLAYER_WALK_SPEED,
  shouldRepathPursuit,
} from './src/path-follower';
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// Active hero resolves inside initializeRuntime from the CharacterDomain
// (ephemeral Sorceress for play-config den launch).
// Fallback background clear while equirect projection is pending / failed /
// unsupported (WebKit). Linear/pre-tonemap (ACES). Camera writes that spread
// perspective() must re-apply clear (and, after C2, all post settings) — see
// installRenderSettings.applyCamera.
// Keep RGB in sync with render-settings.ts SKY_CLEAR (WebKit / no-skybox fallback).
const SKY_CLEAR = { clearR: 0.055, clearG: 0.018, clearB: 0.012 } as const;

// ── HDR sky (Play runtime only — never declare equirect in the pack) ──────
// Engine pin: Skylight.equirect + SkyboxBackground.equirect (shared EquirectAsset).
// Projection is internalized (caps-gated; no UA / private upload API). Spawn a
// solid Skylight first (ambient on frame 1 everywhere), attach equirect to kick
// lazy projection, then spawn SkyboxBackground ONLY when getCubemapStatus ===
// 'ready' (spawning earlier samples unready GPU memory → rainbow garbage).
// Pack must not declare Skylight/SkyboxBackground equirect — Edit≠Play.
const SKY_HDR_GUID = 'c4061caa-8127-42a8-a1bb-54ef1a83d6d2';

type SkyCtx = {
  world: World;
  assets?: import('@forgeax/engine-assets-runtime').AssetRegistry;
  app?: import('@forgeax/engine-app').App;
};

type EquirectHandle = Handle<'EquirectAsset', 'shared'>;

// Lighting director retunes tint/intensity; equirect stays on the entity.
// `ibl` flips true once cubemap projection reports ready (main-loop poll).
type SkyLight = { ent: EntityHandle; ibl: boolean; equirect: EquirectHandle | null };

async function installHdrSky(ctx: SkyCtx): Promise<SkyLight> {
  // Dim warm fill suits the forge until IBL is ready (then applyAreaLighting
  // switches to a neutral tint so the HDR drives color).
  const skylight = ctx.world.spawn(
    { component: Skylight, data: { color: [0.55, 0.28, 0.18], intensity: 0.16 } },
  ).unwrap() as EntityHandle;
  const solid: SkyLight = { ent: skylight, ibl: false, equirect: null };

  if (!ctx.assets) {
    console.info('[hellforge] no asset registry — solid-color skylight + SKY_CLEAR');
    return solid;
  }
  const guidRes = AssetGuid.parse(SKY_HDR_GUID);
  if (!guidRes.ok) return solid;
  const podRes = await ctx.assets.loadByGuid<EquirectAsset>(guidRes.value);
  if (!podRes.ok) {
    console.warn('[hellforge] sky.hdr loadByGuid failed:', (podRes.error as { code?: string }).code);
    return solid;
  }
  const equirect = ctx.world.allocSharedRef<'EquirectAsset', EquirectAsset>('EquirectAsset', podRes.value);
  // Attach equirect → engine lazy-projects (caps permitting). Keep warm solid
  // tint until status==='ready'; do NOT spawn SkyboxBackground yet.
  ctx.world.set(skylight, Skylight, {
    equirect,
    color: [0.55, 0.28, 0.18], intensity: 0.16,
  });
  console.log('[hellforge] HDR equirect attached (awaiting cubemap projection)');
  return { ent: skylight, ibl: false, equirect };
}

async function readLaunchMode(): Promise<'campaign' | 'den'> {
  try {
    const response = await fetch(new URL('./play-config.json', import.meta.url), { cache: 'no-store' });
    if (!response.ok) return 'campaign';
    const config = await response.json() as { mode?: string; level?: string };
    return config.mode === 'level' && config.level === 'slagdeep-hollow' ? 'den' : 'campaign';
  } catch {
    return 'campaign';
  }
}

export async function bootstrap(world: World, ctx?: BootstrapContext) {
  const { assets, app } = ctx ?? {};
  // Host-controlled UI mount + cleanup sink (■ Stop teardown). UI must attach
  // to uiMount (not document.body); non-DOM side effects register via onCleanup.
  const uiMount: HTMLElement = ctx?.uiRoot ?? (typeof document !== 'undefined' ? document.body : (undefined as never));
  const onCleanup = ctx?.registerCleanup ?? (() => {});

  // ── HDR-chain atmosphere pipeline (T1 / PR2c) ───────────────────────────
  // Clone URP + pre-tonemap hellforge::atmosphere. Must run before first frame
  // so Title + gameplay share the same graded HDR path. Forbidden: config.postEffects.
  let atmosphereApi: HellforgeAtmosphereApi | null = null;
  if (app) {
    const bootAtmo = loadRenderSettings();
    const installed = installHellforgePipeline(app as never, world, {
      vignette: bootAtmo.vignette,
      haze: bootAtmo.haze,
      atmoTemp: bootAtmo.atmoTemp,
    });
    if (installed.ok) {
      atmosphereApi = installed;
      onCleanup(() => atmosphereApi?.dispose());
      console.log(
        '[hellforge] pipeline: shadow* → skybox → main → bloom* → atmosphere → tonemap → fxaa',
      );
    } else {
      console.warn('[hellforge] atmosphere pipeline install failed:', installed.error);
    }
  }

  // ── shared UI layer (UI-CUTSCENE-UPGRADE-PLAN Phase A1) ─────────────────
  // Fonts/styles, gauntlet cursors, global tooltip, screen transitions. These
  // span shell + in-game, so they install before either and die with cleanup.
  ensureUiStyles();
  const uiCursors = installUiCursors();
  const uiTooltip = installUiTooltip(uiMount);
  const uiTransition = installUiTransition(uiMount);
  onCleanup(() => {
    uiCursors.dispose();
    uiTooltip.dispose();
    uiTransition.dispose();
  });

  let disposeFatal: (() => void) | null = null;
  onCleanup(() => disposeFatal?.());
  const failBoot = (title: string, error: unknown): void => {
    const detail = error instanceof Error ? error.message : String(error);
    console.error(`[hellforge] ${title}:`, detail);
    disposeFatal?.();
    disposeFatal = installFatalOverlay(uiMount, title, detail);
  };

  if (ctx?.defaultSceneRoot === undefined || ctx.defaultScene === undefined) {
    failBoot('营地场景加载失败', 'defaultScene 未实例化。请检查资产目录后重新加载。');
    return;
  }

  // ── canvas ────────────────────────────────────────────────────────────
  const canvas = document.querySelector<HTMLCanvasElement>('#app')!;
  const dpr = window.devicePixelRatio || 1;
  let renderScale = loadRenderSettings().renderScale;
  let fpsCap = loadRenderSettings().fpsCap;
  let fpsAccum = 0;
  const sizeCanvas = () => {
    const scale = Math.max(0.25, renderScale);
    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr * scale));
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr * scale));
  };
  sizeCanvas();
  let aspect = canvas.width / canvas.height;

  const applyDisplaySettings = (s: RenderSettings): void => {
    renderScale = s.renderScale;
    fpsCap = s.fpsCap;
    sizeCanvas();
    aspect = canvas.width / canvas.height;
  };

  /** Skip a frame when under the FPS cap (0 = unlimited). */
  const allowUpdateFrame = (dt: number): boolean => {
    if (fpsCap <= 0) return true;
    fpsAccum += dt;
    const minDt = 1 / fpsCap;
    if (fpsAccum < minDt) return false;
    fpsAccum %= minDt;
    return true;
  };

  const startedInDen = await readLaunchMode() === 'den';
  let shellPhase: 'title' | 'charSelect' | 'charList' | 'inGame' =
    startedInDen ? 'inGame' : 'title';
  let shell: ShellHandle | null = null;
  let charSelect: CharSelectHandle | null = null;
  let charList: CharListHandle | null = null;
  let heroPreview: HeroPreviewHandle | null = null;
  let runtimeStart: Promise<void> | null = null;
  let bootCamera: EntityHandle | null = null;
  /** Title-era F10 panel; disposed when gameplay camera settings take over. */
  let titleRs: RenderSettingsApi | null = null;
  // Scene BGM (camp/den mp3) — lives outside startRuntime so title UI gets camp
  // music before character hand-off. enterArea retargets den vs camp/wild.
  // Single tick registration (do not also tick from title/game loops — double ramp).
  const bgm: BgmHandle = installBgm(uiMount);
  bgm.setPhase(startedInDen ? 'den' : 'camp');
  /** Wired when combat Sfx is constructed inside startRuntime. */
  let sfxForAudio: { setVolume(v: number): void } | null = null;
  const ownerLedger = createOwnerLedger();
  onCleanup(ownerLedger.trackBgm());
  const applyAudioSettings = (s: RenderSettings): void => {
    bgm.setVolume(1, s.bgmVolume);
    sfxForAudio?.setVolume(s.sfxVolume);
  };
  applyAudioSettings(loadRenderSettings());
  world.addSystem(Update, {
    name: 'hellforge-bgm-update', queries: [],
    fn: () => bgm.tick(world.getResource(Time).delta),
  });
  onCleanup(ownerLedger.trackSystem('hellforge-bgm-update'));
  onCleanup(() => bgm.dispose());
  let stopped = false;
  onCleanup(() => { stopped = true; });

  async function initializeRuntime(selectedRecord: CharacterRecord | null): Promise<void> {
    if (stopped) return;
    // Den-direct play-config skips title UI but must still construct a Sorceress
    // domain through the same factory (ephemeral — no localStorage projection).
    const ephemeral = selectedRecord === null;
    // Validate→hydrate→discard: migrate legacy Sorceress once, then own progression
    // in CharacterDomain. Reload always starts at Cinderwatch with full HP/MP
    // (camp spawn below); position/cooldowns are never restored from the envelope.
    const character: CharacterDomain = ephemeral
      ? createSorceressDomain({ playerName: 'Dev', ephemeral: true })
      : hydrateCharacter(ensureCharacterEnvelope(selectedRecord));
    const persistCharacter = (): void => {
      if (ephemeral) return;
      character.dispatch({ op: 'touch' });
      saveSnapshot(character.snapshot());
    };
    const uninstallSaveHooks = ephemeral
      ? () => {}
      : installSaveLifecycleHooks(() => character.snapshot());
    onCleanup(() => {
      let saved = true;
      if (!ephemeral) {
        character.dispatch({ op: 'touch' });
        saved = flushReturnToTitle(character.snapshot());
      } else {
        saved = flushCharacterSaves();
      }
      if (!saved) {
        // hud is declared later in this boot scope — a very-early abort may
        // hit the TDZ; the console.warn from save.ts is the fallback signal.
        try { hud.banner('存档失败：进度未能写入本地存储', '#ff6a6a', 4000); }
        catch { /* hud not installed yet */ }
      }
      uninstallSaveHooks();
    });
    const hero = getHeroDef(character.snapshot().identity.classId);
    const playerScale = hero.scale;

    // ── PR11 T2: determinate boot-load tracker → shell cover bar ─────────
    // Count-weighted, NOT byte-weighted: source analysis of the engine asset
    // runtime (T1's engine unknowns, resolved from code — not yet a live
    // waterfall) shows the browser downloads cooked pack artifacts (not raw
    // GLBs) and the hero GLB is cache-warm from the CharSelect preview, so raw
    // GLB byte weights would front-load the bar and lie (§9). Every load call
    // site below reports each item as it SETTLES (success or fail); 'ready'
    // completes last, right before the cover hides, so the bar hits 100%
    // exactly on hide (§5.4). Den packs are NOT here — they moved to the lazy
    // ensureDenLoaded() transition tracker (T4).
    const bootTracker = new LoadTracker()
      .register('hero', 1 + hero.gltf.clips.length)          // scene + N clips
      .register('veyra', 2)                                   // scene + idle clip
      .register('monsters-wild', WILD_MONSTER_KINDS.length * 6) // kind × (scene + 5 clips)
      .register('volcano', 1 + 8)                             // slag material + 8 cone meshes
      .register('jsons', 2)                                   // obstacles + ashen layout
      .register('ready', 1);                                  // finalize — completes last
    const unbindBootProgress = bootTracker.onChange((f) => shell?.setLoadingProgress(f));
    onCleanup(unbindBootProgress);

    // ── 1. encampment scene (engine-native pack) ──────────────────────────
    // The host resolves + instantiates the defaultScene before entry runs; the
    // encampment root is a side-effect spawn (hellforge never reads its mapping).
    //
    // The pack carries EditAmbient (Skylight) + EditSun (DirectionalLight) so the
    // editor viewport can see authored meshes (editor no longer injects a fill
    // light — North Star §8). Play owns the real lighting director below, so
    // strip those edit-only entities first: engine lighting is first-hit-wins,
    // and a leftover pack Skylight would block installHdrSky / sun retunes.
    {
      const root = ctx?.defaultSceneRoot;
      const sceneAsset = ctx?.defaultScene;
      if (root !== undefined && sceneAsset?.entities) {
        const inst = world.get(root, SceneInstance);
        if (inst.ok) {
          const mapping = inst.value.mapping as ArrayLike<number>;
          for (const e of sceneAsset.entities) {
            const name = (e.components as { Name?: { value?: string } } | undefined)?.Name?.value;
            if (name !== 'EditAmbient' && name !== 'EditSun') continue;
            const localId = (e as { localId?: number }).localId;
            if (typeof localId !== 'number') continue;
            const raw = mapping[localId];
            if (raw === undefined || raw === 0) continue;
            world.despawn(raw as EntityHandle);
          }
        }
      }
    }

    // ── 2. HDR sky (code-side; see installHdrSky above). Fire-and-forget: solid
    //       Skylight lands immediately; equirect attach kicks lazy projection.
    // `skyLightDirty` defers area re-tint; main loop polls getCubemapStatus and
    // spawns SkyboxBackground only when ready (see update loop below).
    let sky: SkyLight | null = null;
    let skyLightDirty = false;
    let skyboxSpawned = false;
    let skyPollAccum = 0;
    let skyPollStopped = false;
    void installHdrSky({ world, assets, app }).then((s) => { sky = s; skyLightDirty = true; });

    // ── 3. witch GLB — via gltfImporter sub-assets ────────────────────────
    type ClipHandle = Handle<'AnimationClip', 'shared'>;
    const clipHandles = new Map<string, ClipHandle>();
    const clipDur = new Map<string, number>(); // clip name → duration (seconds)

    // ── player rig: the ONE coordinate frame we move ──────────────────────
    // We never touch the witch's internal joints / scene mapping. The entire
    // witch scene is parented under this rig entity; moving the rig rigidly
    // carries her whole body + skeleton via the engine's ChildOf → Transform
    // propagation. Spawn it BEFORE instantiate so we can pass it as parent.
    const playerRig = world.spawn(
      { component: Transform, data: { pos: [0, 0, 5], scale: [playerScale, playerScale, playerScale] } },
    ).unwrap() as EntityHandle;

    let witchRoot: EntityHandle | null = null;
    let witchSkinEnt: EntityHandle | null = null;
    /** SceneInstance root — hosts AnimationPlayer (joints stay under this). */
    let witchAnimPlayer: EntityHandle | null = null;
    /** Face CU eye marker — headfront/Head bone under the hero SceneInstance. */
    let playerEyeFocusEnt: EntityHandle | null = null;
    let playerEyeFocusBone = '';
    try {
      if (!assets) throw new Error('no asset registry');
      const sceneGuid = AssetGuid.parse(hero.gltf.scene);
      if (!sceneGuid.ok) throw new Error('witch scene guid parse');
      // engine e53f4616: `loadByGuid` returns the PAYLOAD. `instantiate` wants a
      // Handle, so mint one via `world.allocSharedRef`; clip handles passed to
      // AnimationPlayer are likewise minted from each clip payload, and the clip
      // duration is read straight off the payload (no more `assets.get`).
      const sceneRes = await assets.loadByGuid<SceneAsset>(sceneGuid.value);
      bootTracker.complete('hero');
      if (!sceneRes.ok) throw new Error('witch scene loadByGuid: ' + ((sceneRes.error as { code?: string }).code ?? '?'));
      // PR11 T3: the N clip loads now race each other. Per-clip failure is still
      // warn-and-continue (only the scene load is fatal), and instantiate below
      // still waits for every clip to settle. Each settled clip advances the bar.
      const clipPayloads: AnimationClip[] = [];
      await Promise.all(hero.gltf.clips.map(async (def) => {
        const g = AssetGuid.parse(def.guid);
        if (!g.ok) { console.warn('[hellforge] clip guid parse:', def.name); bootTracker.complete('hero'); return; }
        const r = await assets.loadByGuid<AnimationClip>(g.value);
        bootTracker.complete('hero');
        if (!r.ok) { console.warn('[hellforge] clip loadByGuid:', def.name, (r.error as { code?: string }).code); return; }
        clipPayloads.push(r.value);
        const clipHandle = world.allocSharedRef<'AnimationClip', AnimationClip>('AnimationClip', r.value);
        clipHandles.set(def.name, clipHandle);
        // Record clip duration so one-shot clips (attack/hit/death) can auto-end.
        clipDur.set(def.name, (r.value as unknown as { duration: number }).duration);
      }));
      // Parent the witch scene under playerRig (3rd arg) so the rig drives her.
      const sceneHandle = world.allocSharedRef<'SceneAsset', SceneAsset>('SceneAsset', sceneRes.value);
      const instRes = assets.instantiate<SceneAsset>(sceneHandle, world, playerRig);
      if (!instRes.ok) throw new Error('witch instantiate: ' + ((instRes.error as { code?: string }).code ?? '?'));
      witchRoot = instRes.value as EntityHandle;
      // Same normalization monsters get, and it has to run after instantiate:
      // clip channels address joints by opaque targetId, so the root is only
      // identifiable through the scene. gen3d motions bake a rig scale onto Hips
      // (walk ships 1.17647 → the hero inflates ~18% for exactly as long as that
      // clip plays) and bake horizontal root motion (dodge travels ~4 m, which
      // stacks on the dodge stepper and snaps back at clip end).
      const rootTargetIds = collectRootJointTargetIds(world, witchRoot);
      for (const payload of clipPayloads) normalizeClipRoot(payload, rootTargetIds);
      const sceneInst = world.get(witchRoot, SceneInstance);
      if (sceneInst.ok) {
        const namedBones: { ent: number; name: string }[] = [];
        for (let i = 0; i < sceneInst.value.mapping.length; i++) {
          const ent = sceneInst.value.mapping[i];
          if (ent === undefined || ent === ENTITY_NULL_RAW) continue;
          const nm = world.get(ent as EntityHandle, Name);
          if (nm.ok && typeof nm.value.value === 'string' && nm.value.value.length > 0) {
            namedBones.push({ ent: ent as number, name: nm.value.value });
          }
        }
        const eyeBone = pickBestEyeFocusBone(namedBones);
        if (eyeBone !== null) {
          playerEyeFocusEnt = eyeBone.ent as EntityHandle;
          playerEyeFocusBone = eyeBone.name;
          console.log('[hellforge] Face CU eye marker:', playerEyeFocusBone);
        } else {
          console.warn('[hellforge] no headfront/Head bone for Face CU — using Y fallback');
        }
      }
      const idleClip = clipHandles.get('idle');
      const armed = idleClip
        ? armSkinnedAnimationPlayer(world, witchRoot, { clips: [idleClip] })
        : null;
      if (armed !== null) {
        witchSkinEnt = armed.skin;
        witchAnimPlayer = armed.player;
        console.log(`[hellforge] witch anim bound — ${armed.targetCount} targets`);
      } else {
        console.warn('[hellforge] witch spawned but Skin entity / idle clip missing — animation off');
      }
      console.log('[hellforge] witch loaded — clips:', [...clipHandles.keys()]);
    } catch (error) {
      failBoot('角色资产加载失败', error);
      return;
    }
    if (stopped) return;

    // ── Veyra quest NPC (authored NpcVeyraAnchor + witch.glb) ─────────────
    const VEYRA_SCENE_GUID = '5e3028dd-ddf6-4104-86d9-318d3e8fb5a6';
    const VEYRA_IDLE_GUID = 'c530adf2-8de6-486a-afaa-9af3a6e6dfd1';
    const VEYRA_SCALE = 1.15;
    const VEYRA_FALLBACK_POS: readonly [number, number, number] = [3.2, 0, 2.0];
    const VEYRA_YAW_QUAT: readonly [number, number, number, number] = [0, 1, 0, 0]; // yaw π
    let veyraPos: readonly [number, number] = [VEYRA_FALLBACK_POS[0], VEYRA_FALLBACK_POS[2]];
    {
      let anchorEnt: EntityHandle | null = null;
      let anchorPos = [...VEYRA_FALLBACK_POS] as [number, number, number];
      let anchorQuat = [...VEYRA_YAW_QUAT] as [number, number, number, number];
      const query = world.query({ read: [Name, Transform] }).unwrap();
      for (const row of query) {
        const n = row.get(Name);
        if (n.value !== 'NpcVeyraAnchor') continue;
        const t = row.get(Transform);
        anchorEnt = row.entity;
        anchorPos = [t.pos[0]!, t.pos[1]!, t.pos[2]!];
        anchorQuat = [t.quat[0]!, t.quat[1]!, t.quat[2]!, t.quat[3]!];
        break;
      }
      if (anchorEnt === null) {
        // Anchor missing from loaded scene — still place at authored contract.
        console.warn('[hellforge] NpcVeyraAnchor not found in world — using authored [3.2,0,2.0]');
      }
      veyraPos = [anchorPos[0], anchorPos[2]];
      try {
        if (!assets) throw new Error('no asset registry for Veyra');
        const sceneGuid = AssetGuid.parse(VEYRA_SCENE_GUID);
        if (!sceneGuid.ok) throw new Error('Veyra scene guid parse');
        const idleGuid = AssetGuid.parse(VEYRA_IDLE_GUID);
        if (!idleGuid.ok) throw new Error('Veyra idle guid parse');
        // PR11 T3: Veyra scene + idle clip now load in parallel (both fatal on
        // failure, unchanged); the two settled loads advance the bar together.
        const [sceneRes, idleRes] = await Promise.all([
          assets.loadByGuid<SceneAsset>(sceneGuid.value),
          assets.loadByGuid<AnimationClip>(idleGuid.value),
        ]);
        bootTracker.complete('veyra', 2);
        if (!sceneRes.ok) {
          throw new Error('Veyra witch.glb scene load failed: ' + ((sceneRes.error as { code?: string }).code ?? '?'));
        }
        if (!idleRes.ok) {
          throw new Error('Veyra idle clip load failed: ' + ((idleRes.error as { code?: string }).code ?? '?'));
        }
        const idleClip = world.allocSharedRef<'AnimationClip', AnimationClip>('AnimationClip', idleRes.value);
        const veyraRig = world.spawn({
          component: Transform,
          data: {
            pos: [anchorPos[0], anchorPos[1], anchorPos[2]],
            quat: [anchorQuat[0], anchorQuat[1], anchorQuat[2], anchorQuat[3]],
            scale: [VEYRA_SCALE, VEYRA_SCALE, VEYRA_SCALE],
          },
        }).unwrap() as EntityHandle;
        world.addComponent(veyraRig, { component: Name, data: { value: 'NpcVeyraVisual' } });
        const sceneHandle = world.allocSharedRef<'SceneAsset', SceneAsset>('SceneAsset', sceneRes.value);
        const instRes = assets.instantiate<SceneAsset>(sceneHandle, world, veyraRig);
        if (!instRes.ok) throw new Error('Veyra instantiate failed: ' + ((instRes.error as { code?: string }).code ?? '?'));
        const veyraRoot = instRes.value as EntityHandle;
        const veyraArmed = armSkinnedAnimationPlayer(world, veyraRoot, { clips: [idleClip] });
        if (veyraArmed === null) {
          console.warn('[hellforge] Veyra skinned anim arm failed — static mesh');
        } else {
          console.log(`[hellforge] Veyra anim bound — ${veyraArmed.targetCount} targets`);
        }
        console.log('[hellforge] Veyra loaded at', veyraPos, 'scale', VEYRA_SCALE);
      } catch (error) {
        failBoot('烬守者维拉资产加载失败（witch.glb）', error);
        return;
      }
    }
    if (stopped) return;

    // ── player + game systems ─────────────────────────────────────────────
    const keys: Record<string, boolean> = {};

    const classDef = getClassDef(hero.id);
    let combatStats: CombatStats = deriveCombatStats({
      character: character.snapshot(),
      classDef,
    });
    const player = createPlayerFromCombatStats(combatStats);
    // CC0 sheet upgrade (PR8 T9a — plan §4 L2): swap the weak procedural
    // sheets (flame/impact/smoke) for the shipped Kenney Particle Pack frames
    // BEFORE the first sprite spawn — SpriteSystem.textureFor caches the
    // first generate() call, so a late upgrade would never reach the GPU.
    // Per-sheet failure warns and keeps the procedural sheet (the plan's §9
    // L2 fallback); a missing pack file must never stall boot.
    // Camp torch glow positions (rogue-encampment.pack.json Torch*_Glow),
    // flame centre lowered 0.25 into the post so the tongue seats in the bowl.
    const CAMP_TORCH_GLOWS = [
      [-2.5, 1.75, 13.5], [2.5, 1.75, 13.5],
      [-5, 1.75, -3.5], [5, 1.75, -3.5],
      [-2.5, 1.75, -9], [2.5, 1.75, -9],
    ] as const;
    await upgradeFxSheetsFromPacks(
      new URL('./assets/vfx/packs/kenney-particle-pack', import.meta.url).href,
    );
    if (stopped) return;
    const fx = new FxSystem(world, app);
    fx.setCampfire(0, 0.9, 0);      // pack's CampfireGlow sits at (0, 0.7, 0)
    // PR8 ambient fire — camp torch glows (gate / huts / back row, positions
    // from rogue-encampment.pack.json Torch*_Glow entities).
    for (const [tx, ty, tz] of CAMP_TORCH_GLOWS) {
      fx.addAmbientFire(tx, ty, tz, { scale: 0.55 });
    }
    const hud = installHud(uiMount, {
      tooltip: uiTooltip,
      onQuickAction: (action) => {
        if (cutsceneBlocksChromeKey(uiLayers.active())) return;
        if (action === 'map') {
          uiLayers.closeAll();
          automap.toggle();
          return;
        }
        toggleMajorPanel(action as MajorPanel);
      },
    });
    // PR2a L2: invulnerable buff chrome (Movement i-frames).
    const buffDisplay = new BuffDisplay(uiMount);
    onCleanup(() => buffDisplay.clear());
    const cutsceneUi = installCutsceneUi(uiMount);
    onCleanup(() => cutsceneUi.dispose());
    // Rare/legendary drop celebration card (gacha-style strong notify).
    const celebration = installLootCelebration(uiMount);
    onCleanup(() => celebration.dispose());
    const loot = new LootSystem(world, fx);
    const sfx = new Sfx();
    onCleanup(ownerLedger.trackSfx());
    sfx.install();
    onCleanup(() => sfx.dispose());
    sfxForAudio = sfx;
    applyAudioSettings(loadRenderSettings());

    // Screen shake — directional impulse applied once, then decays inside the
    // camera rig (no full-amplitude random offset every frame).
    let pendingShake: readonly [number, number, number] = [0, 0, 0];
    const addShake = (m: number) => {
      const mag = Math.min(0.55, Math.abs(m));
      pendingShake = [
        pendingShake[0]! + (Math.random() - 0.5) * 2 * mag,
        pendingShake[1]! + (Math.random() - 0.5) * 1.2 * mag,
        pendingShake[2]! + (Math.random() - 0.5) * 2 * mag,
      ];
    };

    // Areas. camp+wild share the encampment map; den = the PCG dungeon.
    type Area = 'camp' | 'wild' | 'den';
    let area: Area = 'camp';
    const CAMP_RECT = { x0: -11.5, x1: 8.5, z0: -14.5, z1: 14.5 };
    // Walkable rim — SSOT with wild-terrain + ashen-reach.layout.json.
    const WILD_BOUNDS = ASHEN_REACH_BOUNDS;
    const inCamp = (x: number, z: number) =>
      x > CAMP_RECT.x0 && x < CAMP_RECT.x1 && z > CAMP_RECT.z0 && z < CAMP_RECT.z1;

    // ── PCG dungeon (熔渣深窟) ─────────────────────────────────────────────
    // Layout (walkability/spawns) regenerates from the fixed seed; the static
    // geometry comes from the EDITABLE baked scene pack (see src/dungeon.ts).
    const dungeon = new Dungeon(world);
    const degraded: string[] = [];
    // PR11 T4: den GEOMETRY (slagdeep-hollow + boss-antechamber packs, ~the
    // largest single download) is LAZY — ensureDenLoaded() (below) instantiates
    // it on first den entry / wild prefetch / den-direct boot, NOT here. The
    // seed layout (walkability, monsterSpawns, entry) is constructor-cheap and
    // stays on the boot path, so navigation/automap/camera probes work as before.
    console.log(`[hellforge] den layout ready — ${dungeon.roomCount} rooms, ${dungeon.monsterSpawns.length} monsters (geometry lazy)`);
    // Session-only information-layer discovery. It is intentionally not part
    // of save v2 and is consumed by automap as an already-authorized set.
    const exploredDenCells = new Set<string>();
    const reachedWildLandmarks = new Set<string>();

    // Distant irregular lava cones (ground-only) — camp wild rim + den cavern rim.
    // The camp install loads the shared peak bank (slag material + 8 cone meshes,
    // parallel — T3) and advances the bar; the den rim reuses that module cache
    // (spawn-only, no new fetches — plan keeps it at boot).
    await installWildTerrain(world, assets, { label: 'camp', onItem: () => bootTracker.complete('volcano') });
    {
      // Den floor is CELLS×CELL metres at DUNGEON_ORIGIN; ring the map centre
      // so peaks sit outside walls but inside the camera far plane (~200).
      const denHalf = (CELLS * CELL) / 2;
      await installWildTerrain(world, assets, {
        origin: denMountainRingOrigin(),
        seed: 0x51a9de01,
        half: denHalf,
        label: 'den',
      });
    }
    onCleanup(() => resetWildTerrainCache());
    // Second pass: any late-resolved prop materials from terrain installs.
    // (Den-pack props get their own pass inside ensureDenLoaded — T4.)
    ensureShadowCasters(world);
    if (stopped) return;

    // Authored 2D nav blockers (never sampled from render meshes per frame).
    const emptyObstacles: ObstacleDoc = { version: 1, blockers: [] };
    const emptyAshen: AshenReachLayout = { version: 1, route: [], blockers: [], landmarks: [] };
    const loadSceneJson = async <T>(rel: string, fallback: T): Promise<T> => {
      try {
        const res = await fetch(new URL(rel, import.meta.url), { cache: 'no-store' });
        if (!res.ok) return fallback;
        return await res.json() as T;
      } catch {
        return fallback;
      }
    };
    // PR11 T3: the two scene JSONs now fetch in parallel (each settle → bar +1).
    // ashenLayout is consumed later (navigation + encounter markers) — hoisting
    // its fetch here is safe: nothing between reads it before navigation.
    const [campObstacles, ashenLayout] = await Promise.all([
      loadSceneJson<ObstacleDoc>('./assets/scenes/rogue-encampment.obstacles.json', emptyObstacles)
        .then((d) => { bootTracker.complete('jsons'); return d; }),
      loadSceneJson<AshenReachLayout>('./assets/scenes/ashen-reach.layout.json', emptyAshen)
        .then((d) => { bootTracker.complete('jsons'); return d; }),
    ]);
    // Camp + den wall + antechamber — each source once (no double-register).
    const cameraProbeBlockers = [
      ...campObstacles.blockers,
      ...dungeon.denProbeBlockers,
      ...dungeon.antechamberProbeBlockers,
    ];
    const campCameraProbe = createObstacleCameraProbe(cameraProbeBlockers);
    // Foreground fade registry (diagnostics / future material-alpha). PR1 does
    // NOT mutate prop Transform — scale squash looked broken. Engine PBR
    // hardcodes baseColor.a=1 until Track A. Visibility = probe floor only.
    const fadeNamed: Array<{ localId: number; name: string }> = [];
    {
      const query = world.query({ read: [Name] }).unwrap();
      for (const row of query) {
        const name = row.get(Name).value;
        if (!name) continue;
        fadeNamed.push({ localId: row.entity as unknown as number, name });
      }
    }
    const fadeRegistry = buildCampFadeRegistry(cameraProbeBlockers, fadeNamed);
    const fadeEntries: FadeBlockerEntry[] = [...fadeRegistry.values()];
    const campFadeDriver = createFadeDriver({
      blockerIds: fadeEntries.map((e) => e.blockerId),
      setAlpha: () => {
        /* no-op — never scale authored props */
      },
    });
    const navigation = createHellforgeNavigation({
      dungeon: {
        contains: (wx, wz) => dungeon.contains(wx, wz),
        worldToCell: (wx, wz) => dungeon.worldToCell(wx, wz),
        cellToWorld: (cx, cy) => dungeon.cellToWorld(cx, cy),
        isWalkCell: (cx, cy) => dungeon.isWalkCell(cx, cy),
        walkable: (wx, wz) => dungeon.walkable(wx, wz),
      },
      campObstacles,
      ashenLayout,
      wildBounds: { x0: WILD_BOUNDS.x0, x1: WILD_BOUNDS.x1, z0: WILD_BOUNDS.z0, z1: WILD_BOUNDS.z1 },
      openCellSize: 1,
    });

    // Combined walkability: dungeon A* grid + authored camp/wild blockers.
    const walkableAt = (x: number, z: number): boolean => navigation.walkable([x, z], 0.35);
    /** PR2a Space dodge — code-driven phases (see src/dodge.ts). Declared
     *  before MonsterManager so onPlayerHit can close over the binding. */
    let dodgeState: DodgeState = createDodgeState();

    // ── monsters + combat-run objectives (transient; never saved) ─────────
    let denTotal = 0;
    const combatRun = createCombatRunDomain();
    /** L4 Option B — room-clear once-fire + cursed-vault enter/exit. */
    const roomEvents = createRoomEventState();
    let disposeVaultCard: (() => void) | null = null;
    onCleanup(() => { disposeVaultCard?.(); disposeVaultCard = null; });
    const questStatus = () => character.snapshot().quests[PURGE_QUEST_ID].status;
    const questCompleted = (): boolean => questStatus() === 'completed';
    // Cutscene playback state is mutated by play/endCutscene (defined later).
    // Hoisted so onPlayerHit / monsters.tick can gate cinematic world policy.
    let cutscene: { script: CutsceneScript; startMs: number } | null = null;
    let cutsceneSeam: SeamRestoreGuard | null = null;
    /** Single freeze/invuln writer: seam → CinematicOwner.policy (null when idle). */
    const activeWorldPolicy = () => cutsceneSeam?.policy ?? null;
    // Late-bound: playCutscene exists after the camera/cutscene block.
    let startFinisherHeroShot: (targetXZ: readonly [number, number]) => void =
      () => { /* filled after cutscene helpers */ };
    let playBossDefeatBeat: (bossXZ: readonly [number, number]) => void =
      () => { /* filled after cutscene helpers */ };
    /** True while Hero Shot / face CU (or a queued finisher climax) owns the stage. */
    let isFinisherClimaxBusy: () => boolean = () => false;
    /** PR4a T3 — Boss entrance / defeat once-fire latches (hoisted for onDeath). */
    let bossEntrancePlayed = false;
    let bossDefeatPlayed = false;
    const monsters = new MonsterManager(world, fx, {
      onAggro: () => { sfx.play('monster-aggro'); },
      onAttack: () => { sfx.play('monster-attack'); },
      onPlayerHit: (rawDmg, source) => {
        if (area === 'camp') return;                       // camp is sacred
        // PR4a T2: den cinematic invuln (Boss / Hero Shot) via owner policy.
        if (shouldPlayerBeInvulnerable(activeWorldPolicy())) return;
        // PR2a L2: i-frames only during dodge Movement phase.
        if (isDodgeInvulnerable(dodgeState)) return;
        // L3: hit during buildup/recover aborts the roll (no i-frames) —
        // release the clip lock too so the roll tail doesn't play on air.
        if (dodgeHitReactionAborts(dodgeState)) {
          dodgeState = abortDodge(dodgeState);
          state.oneShotUntil = 0;
        }
        // L4 B2: temporary taken-damage mul while inside the slag-cursed vault.
        const curseMul = dungeon.encounters
          ? branchCurseDamageMul(roomEvents, dungeon.encounters)
          : 1;
        const dmg = resolveIncomingDamage(rawDmg * curseMul, combatStats);
        if (damagePlayer(player, dmg)) {
          hud.damageFlash();
          addShake(source === 'slaglord' ? 0.4 : 0.16);
          sfx.play('player-hurt');
          // Shove the witch a step away from the closest attacker — weight.
          const src = monsters.nearest(state.px, state.pz, 3.2);
          if (src) {
            const kx = state.px - src.x, kz = state.pz - src.z;
            const kl = Math.hypot(kx, kz) || 1;
            const push = source === 'slaglord' ? 0.5 : 0.3;
            const nxp = state.px + (kx / kl) * push;
            const nzp = state.pz + (kz / kl) * push;
            if (walkableAt(nxp, state.pz)) state.px = nxp;
            if (walkableAt(state.px, nzp)) state.pz = nzp;
          }
          hud.setOrbs(player.hp, player.maxHp, player.mana, player.maxMana);
          if (player.dead) {
            playOnce('death');
            sfx.play('player-die');
            hud.showDeath(true);
            persistCharacter();
          }
        }
      },
      onDeath: (m: Monster) => {
        player.kills += 1;
        hud.setKills(player.kills);
        loot.dropFrom(m);
        // ── equipment drops (打宝) ──
        // Item level rides the monster's level (+1 inside the den); MAGIC
        // FIND from gear shifts the rarity weights; the boss loot-explodes.
        const mLevel = MONSTERS[m.kind].level + (m.zone === 'den' ? 1 : 0);
        const isBoss = !!MONSTERS[m.kind].isBoss;
        const rolls = isBoss ? 3 + Math.floor(Math.random() * 3) : 1;
        for (let i = 0; i < rolls; i++) {
          const drop = rollDrop(mLevel, isBoss, combatStats.magicFind, character.snapshot().level);
          if (drop) loot.spawnItem(drop, m.x, m.z);
        }
        if (combatStats.lifeOnKill > 0) {
          player.hp = Math.min(player.maxHp, player.hp + combatStats.lifeOnKill);
        }
        addShake(isBoss ? 0.45 : 0.1);
        sfx.play(isBoss ? 'boss-kill' : 'kill');
        if (isBoss) {
          hud.setBoss(null);
          hud.banner('熔渣督军 已被消灭', '#ffd066', 2400);
          // PR4a T3: once-fire defeat sting. Consumed without play when finisher
          // Hero Shot / face CU owns the climax (face CU follows Hero Shot).
          const defeat = takeBossDefeatTrigger({
            alreadyPlayed: bossDefeatPlayed,
            finisherClimaxBusy: isFinisherClimaxBusy(),
          });
          bossDefeatPlayed = defeat.played;
          if (defeat.shouldPlay) playBossDefeatBeat([m.x, m.z]);
        }
        // L4 B1 — room-clear beat (once per combat room pack).
        if (m.zone === 'den' && !isBoss && dungeon.encounters) {
          const beat = noteMonsterKill(
            roomEvents,
            dungeon.encounters,
            m.x - DUNGEON_ORIGIN.x,
            m.z - DUNGEON_ORIGIN.z,
          );
          if (beat) {
            hud.banner('房间肃清', '#8aff9a', 1800);
            sfx.play('quest');
            loot.spawn('gold', 6 + Math.floor(Math.random() * 8), m.x, m.z);
            fx.rise(m.x, 0.3, m.z, 'gold', 10, 0.7);
          }
        }
      },
    });
    const denMinionAliveCount = (): number => {
      let n = 0;
      for (const m of monsters.monsters) {
        if (m.zone === 'den' && !MONSTERS[m.kind].isBoss) n++;
      }
      return n;
    };
    // Soft contact discs must exist BEFORE den pre-spawn — skinned GLBs cannot
    // fill the directional shadow atlas (18F vs 12F), and den torch light washes
    // CSM even when static props cast. Wire the shared kit first.
    const contactShadows = installContactShadows(world);
    onCleanup(() => contactShadows.dispose());
    monsters.setContactShadows(contactShadows);

    // Skinned GLB monster visuals (assets/monsters/*.glb). PR11 T5: only WILD
    // kinds (imp/ashwalker/charred) load at boot — authored wild spawns exist
    // from frame one (below) and must never pop in or fall back. Den-only kinds
    // (flamecaller/slaglord) load lazily inside ensureDenLoaded(), and the den
    // pre-spawn moved there too, so no den monster can exist before its visual.
    // Kinds that fail still fall back to the lowpoly parts assemblies.
    const loadedWildKinds = assets
      ? await monsters.loadVisualsFor(WILD_MONSTER_KINDS, assets, () => bootTracker.complete('monsters-wild'))
      : [];
    if (loadedWildKinds.length < WILD_MONSTER_KINDS.length) degraded.push('怪物模型');
    if (stopped) return;

    // ── equipment + bag (打宝核心) — CharacterDomain is the authority ─────
    // 10-slot paper doll + 60-slot bag. Pickups / swaps / melts dispatch domain
    // commands; HUD/inventory read deep-frozen snapshots at render time (no
    // writable bag/equipment mirrors). CombatStats is re-derived; resource
    // ratios are preserved so re-equip cannot heal.
    let moveMul = 1;
    const applyEquipment = (opts: { refill?: boolean } = {}): void => {
      const snap = character.snapshot();
      const { equipment, bag, level, gold, materials, potions } = snap;
      combatStats = deriveCombatStats({ character: snap, classDef });
      syncRuntimeFromCombatStats(player, combatStats, { refill: opts.refill });
      skills.applyCombatStats(combatStats);
      moveMul = combatStats.moveSpeed;
      const eq = equipment as Equipment;
      inv.update(eq, bag as BagAnchor[], level, gold, materials, potions);
      // N-Stash dual-open pair — keep the stash grid on the same refresh beat
      // as the bag (stashUI is installed just after inv; applyEquipment only
      // runs after both exist).
      stashUI.update(snap.stash, level);
      hud.setGold(gold);
      refreshCharacterPanel();
    };

    /** Pickup → domain take-item (empty slot or bag). */
    const takeItem = (item: ItemInstance, sx: number | null, sy: number | null): void => {
      const before = character.snapshot();
      const equippedEmpty = equipSlotsFor(item.slot).some((s) => !before.equipment[s])
        && before.level >= item.reqLevel;
      const res = character.dispatch({ op: 'take-item', item });
      if (!res.ok) {
        if (res.reason === 'bag-full') {
          hud.banner('背包已满', '#ff6a6a', 1200);
          // Multi-cell items can fail placement after the 1×1 magnet probe —
          // re-drop on the ground instead of deleting the gear.
          loot.spawnItem(item, state.px, state.pz);
        }
        return;
      }
      const meta = RARITY_META[item.rarity];
      if (equippedEmpty) {
        sfx.play('equip');
        applyEquipment();
        if (sx !== null && sy !== null) hud.floatText(`装备了 ${item.name}`, sx, sy, { color: meta.color, size: 16 });
      } else {
        sfx.play('pickup');
        if (sx !== null && sy !== null) hud.floatText(`${item.name} → 背包`, sx, sy, { color: meta.color, size: 14 });
        applyEquipment();
      }
      persistCharacter();
      if (item.rarity === 'legendary' || item.rarity === 'rare') {
        celebration.show(item);
        sfx.play(item.rarity === 'legendary' ? 'quest' : 'equip');
        if (item.rarity === 'legendary') addShake(0.15);
      }
    };

    // ── skills ────────────────────────────────────────────────────────────
    const skills = new SkillSystem(world, fx, {
      tryBlink: (dirX, dirZ, range) => {
        // step along the aim direction, keep the last walkable spot
        let bx = state.px, bz = state.pz;
        for (let d = 0.4; d <= range; d += 0.4) {
          const nx = state.px + dirX * d, nz = state.pz + dirZ * d;
          if (!walkableAt(nx, nz)) break;
          bx = nx; bz = nz;
        }
        const moved = Math.hypot(bx - state.px, bz - state.pz);
        if (moved < 1) return false;
        fx.playEffect(combatBeat('blink', ['depart']), state.px, 0.2, state.pz);
        state.px = bx; state.pz = bz;
        fx.playEffect(combatBeat('blink', ['arrive']), bx, 0.2, bz);
        return true;
      },
      onHit: (x, _y, z, dmg, killed, crit) => {
        const s = worldToScreen(x, 1.4, z);
        if (s) {
          hud.floatText(
            crit ? `${Math.round(dmg)}!` : `${Math.round(dmg)}`,
            s.x, s.y,
            {
              color: killed ? '#ff8a3c' : crit ? '#ffb028' : '#ffe28a',
              size: killed ? 24 : crit ? 24 : 17,
            },
          );
        }
        if (!killed) sfx.play(crit ? 'crit' : 'hit');
        if (crit) addShake(0.07);
      },
      // T5: presentation only — damage never waits on Hero Shot playback.
      onFinisherHeroShot(targetXZ) {
        startFinisherHeroShot(targetXZ);
      },
    }, hero.skills);

    const groundAimXZ = (): readonly [number, number] | null => {
      const hit = aimOnGround(
        camRig, mouseX, mouseY, aspect, canvas.clientWidth, canvas.clientHeight,
      );
      if (!hit) return null;
      return clampFinisherTarget(hit.x, hit.z, state.px, state.pz, walkableAt);
    };

    const skillCaster = createSkillCaster({
      skills,
      getOrigin: () => [state.px, state.pz],
      getPlayer: () => player,
      getLevel: () => character.snapshot().level,
      getSkillRanks: () => character.snapshot().skillRanks,
      getGroundXZ: groundAimXZ,
    });

    // ── inventory panel (I; 营地 B opens the stash dual-open pair) ──────────
    // Mutations dispatch through CharacterDomain.
    const inv = installInventory({
      onEquipFromBag: (idx, target) => {
        const item = character.snapshot().bag[idx]?.item;
        if (!item) return false;
        const res = character.dispatch({ op: 'equip-from-bag', index: idx, target });
        if (!res.ok) {
          if (res.reason === 'level-req') {
            hud.banner(`需要等级 ${item.reqLevel}`, '#ff6a6a', 1200);
          }
          return false;
        }
        sfx.play('equip');
        applyEquipment();
        persistCharacter();
        return true;
      },
      onUnequip: (slot) => {
        const res = character.dispatch({ op: 'unequip', slot });
        if (!res.ok) {
          if (res.reason === 'bag-full') hud.banner('背包已满', '#ff6a6a', 1100);
          return false;
        }
        sfx.play('pickup');
        applyEquipment();
        persistCharacter();
        return true;
      },
      onMelt: (idx) => {
        const res = character.dispatch({ op: 'melt-bag', index: idx });
        if (!res.ok) return;
        sfx.play('pickup');
        if (res.goldGained) hud.banner(`熔毁 +${res.goldGained} 金`, '#e0b84a', 1100);
        applyEquipment();
        persistCharacter();
      },
      // N-Stash dual-open drop target — bag item dragged onto the stash grid.
      onStashFromBag: (index) => {
        const res = character.dispatch({
          op: 'stash-bag',
          index,
          areaId: area === 'camp' ? 'cinderwatch' : area === 'den' ? 'slagdeep-hollow' : 'ashen-reach',
        });
        if (!res.ok) {
          // Domain rejected the transfer — surface it; a silent no-op after the
          // green drop-glow reads as a bug.
          if (res.reason === 'stash-full') hud.banner('仓库已满', '#ff6a6a', 1100);
          else if (res.reason === 'bag-full') hud.banner('背包已满', '#ff6a6a', 1100);
          return false;
        }
        // Stash transfers reorder the bag → drop stale cube selection (mirrors
        // cube-ui's own heal semantics).
        cube.clearItems();
        applyEquipment();
        persistCharacter();
        return true;
      },
      // Close button must release the manager owner, not only hide DOM. In
      // dual-open mode active() is 'stash' — closing it hides both panels.
      onClose: () => { const a = uiLayers.active(); if (a) uiLayers.close(a); },
    }, uiMount, { tooltip: uiTooltip });
    // N-Stash personal stash (营地专属 12×10 grid) — left dock of the dual-open
    // pair; inventory owns the right half. Transfers dispatch domain commands
    // (stash-bag / unstash-bag) and ride the applyEquipment refresh beat.
    const stashUI = installStashPanel({
      onMoveToBag: (index) => {
        const res = character.dispatch({
          op: 'unstash-bag',
          index,
          areaId: area === 'camp' ? 'cinderwatch' : area === 'den' ? 'slagdeep-hollow' : 'ashen-reach',
        });
        if (!res.ok) {
          // Domain rejected the transfer — surface it; a silent no-op after the
          // green drop-glow reads as a bug.
          if (res.reason === 'stash-full') hud.banner('仓库已满', '#ff6a6a', 1100);
          else if (res.reason === 'bag-full') hud.banner('背包已满', '#ff6a6a', 1100);
          return false;
        }
        // Stash transfers reorder the bag → drop stale cube selection (mirrors
        // cube-ui's own heal semantics).
        cube.clearItems();
        applyEquipment();
        persistCharacter();
        return true;
      },
      // Same routing as the inventory ✕ — closes whichever layer is active.
      onClose: () => { const a = uiLayers.active(); if (a) uiLayers.close(a); },
    }, uiMount, { tooltip: uiTooltip });
    const charPanel = installCharacterPanel(uiMount);
    onCleanup(() => { hud.dispose(); inv.dispose(); stashUI.dispose(); charPanel.dispose(); });

    const refreshCharacterPanel = (): void => {
      const snap = character.snapshot();
      const equipScore = Object.values(snap.equipment)
        .filter((it): it is ItemInstance => !!it)
        .reduce((sum, it) => sum + it.score, 0);
      const skillInvested = Object.values(snap.skillRanks).reduce((a, b) => a + Math.max(0, b), 0);
      charPanel.update({
        playerName: snap.identity.playerName,
        className: classDef.name,
        level: snap.level,
        unspentSkillPoints: snap.unspentSkillPoints,
        equipScore,
        skillInvested,
        stats: combatStats,
      });
    };

    // ── portals (camp cave-mouth ⇄ den entry) — pads from AreaDef ────────
    const caveMouth = slagdeepCaveMouth();
    const CAVE_MOUTH = { x: caveMouth[0], z: caveMouth[1] };
    const portalMat = fx.portalMaterial([0.9, 0.25, 0.08]);
    const portalMatBack = fx.portalMaterial([0.3, 0.5, 1.0]);
    const flatQuad = (x: number, z: number, s: number, mat: ReturnType<typeof fx.portalMaterial>): void => {
      if (!mat) return;
      const q = quat.create();
      quat.fromAxisAngle(q, [1, 0, 0], -Math.PI / 2);
      world.spawn(
        { component: Transform, data: { pos: [x, 0.06, z], quat: [q[0]!, q[1]!, q[2]!, q[3]!], scale: [s, s, s] } },
        { component: MeshFilter, data: { assetHandle: HANDLE_QUAD } },
        { component: MeshRenderer, data: { materials: [mat] } },
      );
    };
    flatQuad(CAVE_MOUTH.x, CAVE_MOUTH.z, 3.4, portalMat);
    // Den-side return portal: prefer 3 m south of the arrival pad, but fall
    // back through offsets until the pad is actually walkable (small entry
    // rooms could otherwise strand the player without an exit).
    const DEN_EXIT = { x: dungeon.entry.x, z: dungeon.entry.z + 3 };
    for (const [ox, oz] of [[0, 3], [3, 0], [0, -3], [-3, 0], [2, 2], [-2, -2]] as const) {
      if (dungeon.walkable(dungeon.entry.x + ox, dungeon.entry.z + oz)) {
        DEN_EXIT.x = dungeon.entry.x + ox;
        DEN_EXIT.z = dungeon.entry.z + oz;
        break;
      }
    }
    flatQuad(DEN_EXIT.x, DEN_EXIT.z, 3.0, portalMatBack);
    const CAMP_GATE = { x: 0, z: 14 } as const;
    const runtimeExitPosition = (id: AreaExitId): { readonly x: number; readonly z: number } | null =>
      resolveRuntimeExitPosition(id, {
        caveMouth: CAVE_MOUTH,
        campGate: CAMP_GATE,
        denExit: DEN_EXIT,
      });
    // Cave-mouth framing: a weathered stone archway (reused camp gate props —
    // two columns + a lintel) so the portal reads as a real gateway from afar.
    // GUIDs are prop-gate-column / prop-gate-lintel mesh+material sub-assets
    // (already catalogued by the encampment scene, so loadByGuid resolves them).
    if (assets) {
      const loadProp = async (meshG: string, matG: string) => {
        const mp = AssetGuid.parse(meshG);
        const tp = AssetGuid.parse(matG);
        if (!mp.ok || !tp.ok) return null;
        const [mr, tr] = await Promise.all([
          assets.loadByGuid<MeshAsset>(mp.value),
          assets.loadByGuid<MaterialAsset>(tp.value),
        ]);
        if (!mr.ok || !tr.ok) return null;
        return {
          mesh: world.allocSharedRef<'MeshAsset', MeshAsset>('MeshAsset', mr.value),
          mat: world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', tr.value),
        };
      };
      const col = await loadProp('01a96efc-af0d-c3bd-3279-4cdf1171e13f', '05bb83e3-79dd-2235-eb12-5fb62a10f90b');
      const lintel = await loadProp('20b5893c-9192-122f-784d-cf5cda04236d', '3889dd23-72ba-4ed6-92c9-dcfb70f7a339');
      if (col) {
        for (const dx of [-2.5, 2.5]) {
          world.spawn(
            { component: Transform, data: { pos: [CAVE_MOUTH.x + dx, 1.5, CAVE_MOUTH.z], scale: [1.5, 1.5, 1.5] } },
            { component: MeshFilter, data: { assetHandle: col.mesh } },
            { component: MeshRenderer, data: { materials: [col.mat] } },
          );
        }
      } else {
        console.warn('[hellforge] portal arch: gate columns failed to load');
      }
      if (lintel) {
        world.spawn(
          { component: Transform, data: { pos: [CAVE_MOUTH.x, 3.2, CAVE_MOUTH.z], scale: [2.8, 1, 0.8] } },
          { component: MeshFilter, data: { assetHandle: lintel.mesh } },
          { component: MeshRenderer, data: { materials: [lintel.mat] } },
        );
      }
    }
    if (stopped) return;
    let portalArmed = true;
    let portalMoteTimer = 0;

    // ── wilderness spawner (灰烬荒原) — seeded; never Math.random() ───────
    let wildTimer = 2;
    let wildSpawnTick = 0;
    const WILD_MAX = 8;
    const ashenAreaSeed = (): number =>
      deriveAreaSeed(character.snapshot().identity.id, PURGE_QUEST_ID, 'ashen-reach');
    // Authored encounter/decor markers — deterministic choices from area seed.
    {
      const encMarkers = ashenLayout.encounterMarkers ?? [];
      const decorMarkers = ashenLayout.decorMarkers ?? [];
      const seed = ashenAreaSeed();
      const encPicks = chooseSeededEncounters(encMarkers, seed);
      const decorPicks = chooseSeededDecor(decorMarkers, seed);
      for (const pick of encPicks) {
        if (!inCamp(pick.pos[0], pick.pos[1]) && walkableAt(pick.pos[0], pick.pos[1])) {
          monsters.spawn(pick.kind, pick.pos[0], pick.pos[1], 'wild');
        }
      }
      void decorPicks; // reserved for Task 4.3/6 prop scatter; choices are deterministic
    }
    const tickWildSpawner = (dt: number): void => {
      if (area !== 'wild') return;
      wildTimer -= dt;
      if (wildTimer > 0) return;
      wildSpawnTick += 1;
      const seed = ashenAreaSeed();
      wildTimer = nextWildSpawnDelay(seed, wildSpawnTick);
      let wildAlive = 0;
      for (const m of monsters.monsters) if (m.zone === 'wild') wildAlive++;
      if (wildAlive >= WILD_MAX) return;
      const spawn = nextWildSpawn(seed, wildSpawnTick, [state.px, state.pz], {
        inCamp,
        walkable: walkableAt,
        inDungeon: (x, z) => dungeon.contains(x, z),
      });
      if (spawn) monsters.spawn(spawn.kind, spawn.x, spawn.z, 'wild');
    };

    // ── player state ──────────────────────────────────────────────────────
    // Player-following key light. Sits camera-side of the head (the top-down rig
    // looks from +z) so the FACE catches light instead of just hair + shoulders,
    // in a near-white warm tone — the old straight-overhead deep-orange torch
    // (1.0/0.55/0.35 @ y3.0) drowned facial detail in red and lit the ground
    // right where the Sun's shadow falls, washing the shadow out. Range stays
    // tight enough to preserve ground-shadow contrast.
    // Low fill so CSM from the hero proxy stays readable on the floor.
    // N4 G2: restrained bump (5.5→6.2 / 3.8→4.2) so the hero reads in the
    // deliberately dim camp — small enough that the shadow contrast survives.
    const playerLight = world.spawn(
      { component: Transform, data: { pos: [0, 2.4, 6.6] } },
      { component: PointLight, data: { color: [1.0, 0.78, 0.62], intensity: 6.2, range: 4.2 } },
    ).unwrap();

    // Camp/den glTF props historically had Forward-only materials — inject
    // ShadowCaster so moonlight CSM actually receives depth from static meshes.
    {
      const n = ensureShadowCasters(world);
      if (n > 0) console.log(`[hellforge] ShadowCaster injected on ${n} material(s)`);
    }

    // Hero shadow proxy (ShadowCaster-only). Skinned GLB can't use
    // default-shadow-caster (18F vs 12F) — ARPG practice: tight invisible
    // capsule/box for directional CSM, not a painted foot blob.
    const shadowProxyMat = world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
      kind: 'material',
      passes: [
        {
          name: 'ShadowCaster',
          program: { module: 'forgeax::default-shadow-caster' },
          renderState: { tags: { LightMode: 'ShadowCaster' }, queue: 2000 },
        },
      ],
      values: {},
    });
    const shadowProxy = world.spawn(
      {
        component: Transform,
        data: {
          pos: [0, 0.9, 5],
          scale: [0.42 * playerScale, 1.55 * playerScale, 0.32 * playerScale],
        },
      },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [shadowProxyMat] } },
    ).unwrap();

    // Player soft contact disc (kit already wired for monsters above).
    const playerContactR = contactRadiusForScale(playerScale);
    const playerContact = contactShadows.spawn(0, 5, playerContactR);
    const state = {
      px: 0, pz: 5,
      currentClip: 'idle' as string,
      paused: false,
      moving: false,
      // One-shot clip (attack/hit/death): plays once, LOCKS locomotion until it
      // ends. `oneShotUntil` is the performance.now() ms at which it ends.
      oneShotUntil: 0,
    };
    // Camera rig SSOT (arpg default). Showcase is camp-only with spring-arm probe.
    let camRig: CameraRigState = createArpgCamera([state.px, 0, state.pz], DEFAULT_ARPG_PRESET);
    const arpgPreset = DEFAULT_ARPG_PRESET;
    /** Preserved across showcase toggles so wheel zoom is not lost. */
    let arpgZoomDistance = arpgPreset.distance;
    let zoomDelta = 0;
    /** Active gameplay mode (blend may still be interpolating pose). */
    let camMode: CameraMode = 'arpg';
    let camBlend: { from: CameraRigState; toMode: CameraMode; elapsed: number } | null = null;
    let orbitDragging = false;
    let orbitYawAcc = 0;
    let orbitPitchAcc = 0;
    let lastOrbitMx = 0;
    let lastOrbitMy = 0;
    const makeArpgAtPlayer = (): CameraRigState =>
      createArpgCamera(
        [state.px, 0, state.pz],
        { ...arpgPreset, distance: arpgZoomDistance },
      );

    // ── cutscene playback (cutscene.ts timeline + cutscene-ui.ts chrome) ────
    // Input blocking rides the UiLayerManager funnel (registered below);
    // camera writes replace the per-frame follow in the update loop while active.
    // Wall-clock timed (not dt-summed) — a NaN/dropped dt can never wedge it.
    // cutscene / cutsceneSeam are hoisted above monsters for Hero Shot gates.
    const restoreCutsceneSeam = (): void => {
      cutsceneUi.reset();
      uiLayers.close('cutscene');
      camBlend = null;
      camRig = makeArpgAtPlayer();
      rs.applyCamera();
    };
    /** Queued beats play only after a clean complete; skip/error/stop drains. */
    let cutsceneQueue: CutsceneScript[] = [];
    const endCutscene = (
      reason: 'complete' | 'skip' | 'error' | 'stop' = 'complete',
    ): void => {
      if (!cutscene && !cutsceneSeam) {
        if (reason !== 'complete') cutsceneQueue = [];
        return;
      }
      cutscene = null;
      const guard = cutsceneSeam;
      cutsceneSeam = null;
      guard?.restoreOnce(reason);
      if (reason === 'complete') {
        const next = cutsceneQueue.shift();
        if (next) playCutscene(next);
      } else {
        cutsceneQueue = [];
      }
    };
    const playCutscene = (script: CutsceneScript): void => {
      if (cutscene) {
        cutsceneQueue.push(script);
        return;
      }
      // Never orphan an active seam — would leak CinematicOwner / strand restore.
      if (cutsceneSeam) {
        cutsceneSeam.restoreOnce('error');
        cutsceneSeam = null;
      }
      // Seam acquires CinematicOwner with L1 policy + L2 BGM duck for this beat.
      cutsceneSeam = createSeamRestoreGuard(restoreCutsceneSeam, script.id, {
        audio: {
          acquire: () => bgm.duck(CINEMATIC_BGM_DUCK_DB),
          release: () => bgm.unduck(),
        },
      });
      cutscene = { script, startMs: performance.now() };
      uiLayers.open('cutscene'); // worldInputBlocked ← onOwnershipChange funnel
    };
    const enqueueCutscene = (script: CutsceneScript): void => {
      if (cutscene) cutsceneQueue.push(script);
      else playCutscene(script);
    };
    isFinisherClimaxBusy = () => {
      const id = cutscene?.script.id;
      if (id === FINISHER_HERO_SHOT_ID || id === FINISHER_FACE_CU_ID) return true;
      return cutsceneQueue.some(
        (s) => s.id === FINISHER_HERO_SHOT_ID || s.id === FINISHER_FACE_CU_ID
          || s.id === BEAT_FINISHER_HERO_SHOT || s.id === BEAT_FINISHER_FACE_CU,
      );
    };
    /** Camp-arrival cinematic: black → wide push-in → letterbox off (skippable). */
    const buildCampIntro = (): CutsceneScript =>
      buildCampArrivalBeat({
        camera: makeArpgAtPlayer(),
        playerXZ: [state.px, state.pz],
      });
    /** Live eye look-at from headfront/Head bone world mat4 (+ face bias). */
    const resolvePlayerEyeWorld = (): readonly [number, number, number] => {
      if (playerEyeFocusEnt !== null) {
        const tr = world.get(playerEyeFocusEnt, Transform);
        if (tr.ok) {
          const worldMat = (tr.value as { world?: ArrayLike<number> }).world;
          if (worldMat !== undefined && worldMat.length >= 15) {
            const head = translationFromWorldMat4(worldMat);
            const nearPlayer = Math.hypot(head[0]! - state.px, head[2]! - state.pz) < 2.5;
            const plausibleY =
              head[1]! > 0.8 * playerScale && head[1]! < 3.5 * playerScale;
            if (nearPlayer && plausibleY) {
              return eyeFocusFromHeadWorld(
                head,
                [faceX, faceZ],
                playerScale,
                eyeBiasForBone(playerEyeFocusBone || 'Head'),
              );
            }
          }
        }
      }
      return [state.px, FINISHER_FACE_CU_FALLBACK_Y, state.pz];
    };
    startFinisherHeroShot = (targetXZ) => {
      try {
        // L4 Option A: Hero Shot, then short face CU (queued; skip drains both).
        playCutscene(buildFinisherHeroShot({
          targetXZ,
          playerXZ: [state.px, state.pz],
          camera: camRig,
        }));
        enqueueCutscene(buildFinisherFaceCu({
          playerXZ: [state.px, state.pz],
          camera: camRig,
          // Front-of-face orbit yaw (not ARPG behind-back yaw).
          faceXZ: [faceX, faceZ],
          headWorld: resolvePlayerEyeWorld(),
        }));
      } catch (error) {
        console.error('[hellforge] finisher Hero Shot failed:', error);
        endCutscene('error');
      }
    };
    playBossDefeatBeat = (bossXZ) => {
      try {
        playCutscene(buildBossDefeatBeat({
          camera: camRig,
          playerXZ: [state.px, state.pz],
          bossXZ,
        }));
      } catch (error) {
        console.error('[hellforge] boss-defeat beat failed:', error);
        endCutscene('error');
      }
    };

    // ── lighting director ─────────────────────────────────────────────────
    // ONE world, TWO looks. The URP forward path renders at most 4 point lights
    // (LIGHT_ARRAY_MAX_SLOTS) and a directional light is global, so per-scene
    // lights can't work — instead the game owns ONE sun + the whole point-light
    // budget and RETUNES them on area change (only one area is ever on screen;
    // the den sits 300 m out, past the camera far plane). The camp pack only
    // carries EditAmbient/EditSun for the editor viewport; Play strips them
    // above and owns the real lights here.
    //
    // Sun: cool moonlight outdoors, warm shaft-glow in the den. shadowDistance
    // 42 (not the 200 default) packs the 2048² CSM into the actually-visible
    // frustum → ~5× denser shadow texels, so the witch proxy reads as a crisp
    // silhouette instead of a blur. The direction's horizontal component points
    // AWAY from the camera-side fill light so her shadow lands on unlit floor.
    // Camp key = baked blood-moon on sky.hdr (bake-sky.ts BLOOD_MOON_U/V →
    // BLOOD_MOON_SUN_DIR). Den stays ember shaft.
    // Den key light must stay angled (not near-vertical): overhead sun collapses
    // the hero CSM into a tiny under-foot patch that reads as "no shadow".
    // Intensities are pre-`sunMul` (0.55), so camp lands at 3.2 and den at 3.4.
    // The old 1.35/1.85 put the key at ~0.74/1.02, which only ever registered on
    // surfaces the campfire and den braziers were already lighting: step outside
    // a fixture's range and characters went to black silhouettes. Ambient cannot
    // pick up that slack — a 10× skylight lift barely moves the frame — so the
    // floor has to come off the key. Camp also trades the near-monochrome red
    // (green 0.18 / blue 0.08 leave dark rock with almost no luminance to
    // reflect) for the den's warmer balance.
    const SUN_LOOK = {
      camp: { direction: [-0.3853, -0.4258, -0.8187], color: [1.0, 0.42, 0.24], intensity: 5.8 },
      den:  { direction: [-0.52, -0.58, -0.63], color: [1, 0.48, 0.24], intensity: 6.2 },
    } as const;
    const sun = world.spawn(
      { component: DirectionalLight, data: { ...SUN_LOOK.camp, castShadow: true, cascadeCount: 1, mapSize: 2048, shadowDistance: 42 } },
    ).unwrap();
    // Point pool (cap 4): campfire + two torch slots + player fill. Camp keeps
    // campfire fixed + gate torches; den re-seats all three non-fill points onto
    // the nearest fire fixtures so pools (not ambient) carry the read. Seats sit
    // ABOVE emissive flame meshes — a caster inside its own fixture occludes.
    // Spot L5 budget: 2 den fixtures + 1 camp moon (T3) live; combat (PR2a G1)
    // reserved — see SPOT_SLOT_BUDGET. Point + spot shadows omitted: custom
    // hellforge::pipeline has no point/spot caster passes (barrel gap) — do not
    // attach PointLightShadow (would take shadowed PBR path with empty atlas).
    const GATE_L = { x: -2.5, y: 2.25, z: 13.5 } as const;
    const GATE_R = { x: 2.5, y: 2.25, z: 13.5 } as const;
    const CAMPFIRE_POS = [0, 1.2, 0] as const;
    const campfireLight = world.spawn(
      { component: Transform, data: { pos: [...CAMPFIRE_POS] } },
      { component: PointLight, data: { color: [1, 0.58, 0.22], intensity: CAMP_CAMPFIRE_BASE, range: 16 } },
    ).unwrap();
    const torchA = world.spawn(
      { component: Transform, data: { pos: [GATE_L.x, GATE_L.y, GATE_L.z] } },
      { component: PointLight, data: { color: [1, 0.52, 0.16], intensity: CAMP_TORCH_BASE, range: 12 } },
    ).unwrap();
    const torchB = world.spawn(
      { component: Transform, data: { pos: [GATE_R.x, GATE_R.y, GATE_R.z] } },
      { component: PointLight, data: { color: [1, 0.52, 0.16], intensity: CAMP_TORCH_BASE, range: 12 } },
    ).unwrap();
    // 2 den fixture spots + 1 camp moon (L5). Combat slot NOT spawned — reserved
    // in SPOT_SLOT_BUDGET (exposed on __hf.lighting).
    const denSpotA = world.spawn(
      { component: Transform, data: { pos: [...PARKED_LIGHT_POS] } },
      {
        component: SpotLight,
        data: {
          direction: [...DEN_FIXTURE_SPOT.direction],
          color: [...DEN_FIXTURE_SPOT.color],
          intensity: 0,
          range: DEN_FIXTURE_SPOT.range,
          innerConeDeg: DEN_FIXTURE_SPOT.innerConeDeg,
          outerConeDeg: DEN_FIXTURE_SPOT.outerConeDeg,
          castShadow: DEN_FIXTURE_SPOT.castShadow,
        },
      },
    ).unwrap();
    const denSpotB = world.spawn(
      { component: Transform, data: { pos: [...PARKED_LIGHT_POS] } },
      {
        component: SpotLight,
        data: {
          direction: [...DEN_FIXTURE_SPOT.direction],
          color: [...DEN_FIXTURE_SPOT.color],
          intensity: 0,
          range: DEN_FIXTURE_SPOT.range,
          innerConeDeg: DEN_FIXTURE_SPOT.innerConeDeg,
          outerConeDeg: DEN_FIXTURE_SPOT.outerConeDeg,
          castShadow: DEN_FIXTURE_SPOT.castShadow,
        },
      },
    ).unwrap();
    const campMoonSpot = world.spawn(
      { component: Transform, data: { pos: [...PARKED_LIGHT_POS] } },
      {
        component: SpotLight,
        data: {
          direction: [...CAMP_MOON_SPOT.direction],
          color: [...CAMP_MOON_SPOT.color],
          intensity: 0,
          range: CAMP_MOON_SPOT.range,
          innerConeDeg: CAMP_MOON_SPOT.innerConeDeg,
          outerConeDeg: CAMP_MOON_SPOT.outerConeDeg,
          castShadow: CAMP_MOON_SPOT.castShadow,
        },
      },
    ).unwrap();
    let torchBaseA = CAMP_TORCH_BASE, torchBaseB = CAMP_TORCH_BASE;   // flicker centre per slot
    let campfireBase = CAMP_CAMPFIRE_BASE;
    let spotBaseA = 0, spotBaseB = 0;
    let moonBase = 0;
    let torchSeatTimer = 0;
    let flickT = 0;
    /** Set after installRenderSettings — re-apply Camera so area exposure mul sticks. */
    let refreshCameraExposure: () => void = () => {};
    const seatDenFixtures = (): void => {
      // 3 nearest fire fixtures → campfire + torchA/B; 2 nearest → den spots.
      // Unused slots park below the floor (range ≪ burial → no contribution).
      const pointSeats = denPointSeatPositions(dungeon.firePoints, { x: state.px, z: state.pz });
      const pointSlots = [campfireLight, torchA, torchB] as const;
      for (let i = 0; i < pointSlots.length; i++) {
        world.set(pointSlots[i]!, Transform, { pos: [...pointSeats[i]!] });
      }
      const spotSeats = denSpotSeatPositions(dungeon.firePoints, { x: state.px, z: state.pz });
      const spotSlots = [denSpotA, denSpotB] as const;
      for (let i = 0; i < spotSlots.length; i++) {
        const pos = spotSeats[i]!;
        const live = pos[1]! > -30;
        world.set(spotSlots[i]!, Transform, { pos: [...pos] });
        if (i === 0) spotBaseA = live ? DEN_FIXTURE_SPOT.intensity : 0;
        else spotBaseB = live ? DEN_FIXTURE_SPOT.intensity : 0;
      }
      campfireBase = 11;
      torchBaseA = 10;
      torchBaseB = 10;
    };
    const parkDenSpots = (): void => {
      world.set(denSpotA, Transform, { pos: [...PARKED_LIGHT_POS] });
      world.set(denSpotB, Transform, { pos: [...PARKED_LIGHT_POS] });
      world.set(denSpotA, SpotLight, { intensity: 0 });
      world.set(denSpotB, SpotLight, { intensity: 0 });
      spotBaseA = 0;
      spotBaseB = 0;
    };
    const seatCampMoon = (): void => {
      world.set(campMoonSpot, Transform, { pos: [...campMoonSpotPosition()] });
      moonBase = CAMP_MOON_SPOT.intensity;
    };
    const parkCampMoon = (): void => {
      world.set(campMoonSpot, Transform, { pos: [...PARKED_LIGHT_POS] });
      world.set(campMoonSpot, SpotLight, { intensity: 0 });
      moonBase = 0;
    };
    // Multipliers from F10 render-settings (updated via onLighting).
    let lightSettings: Pick<RenderSettings, 'sunMul' | 'ambientMul' | 'fireMul' | 'fillMul' | 'atmoTemp'> = {
      sunMul: 1, ambientMul: 1, fireMul: 1, fillMul: 1, atmoTemp: 0,
    };
    const tempShiftRgb = (c: readonly [number, number, number], t: number): { color: [number, number, number] } => {
      const tt = clamp(t, -1, 1);
      return {
        color: [
          Math.max(0, c[0] * (1 + 0.18 * tt)),
          Math.max(0, c[1]),
          Math.max(0, c[2] * (1 - 0.22 * tt)),
        ],
      };
    };
    const applyAreaLighting = (a: Area): void => {
      // Wild keeps the same blood-moon sun as camp; den uses warm shaft.
      const look = SUN_LOOK[a === 'den' ? 'den' : 'camp'];
      const sunTint = tempShiftRgb(look.color, lightSettings.atmoTemp);
      // Always re-assert CSM knobs — look spread only carries dir/color/intensity.
      world.set(sun, DirectionalLight, {
        ...look,
        ...sunTint,
        intensity: look.intensity * lightSettings.sunMul,
        castShadow: true,
        cascadeCount: 1,
        mapSize: 2048,
        shadowDistance: 48,
        depthBias: 0.003,
        normalBias: 0.04,
        pcfKernelSize: 3,
      });
      if (sky) {
        // Den: Pekla-grade near-black (T2). Camp dusk + wild outdoor IBL (T3).
        // Always re-pass equirect so world.set does not drop the IBL source handle.
        const tint = ambientForArea(a, sky.ibl);
        const ambTint = tempShiftRgb(tint.color, lightSettings.atmoTemp);
        const amb = { ...ambTint, intensity: tint.intensity * lightSettings.ambientMul };
        world.set(sky.ent, Skylight, sky.equirect
          ? { equirect: sky.equirect, ...amb }
          : amb);
      }
      // Pure seating plan (light-director) drives live vs park — no zone bypass.
      const seating = areaLightSeating(a);
      if (seating.pointFixtures === 'outdoor-fixed') {
        // Camp + wild: fixed outdoor point seats (distant camp fixtures for wild).
        world.set(campfireLight, Transform, { pos: [...CAMPFIRE_POS] });
        world.set(torchA, Transform, { pos: [GATE_L.x, GATE_L.y, GATE_L.z] });
        world.set(torchB, Transform, { pos: [GATE_R.x, GATE_R.y, GATE_R.z] });
        campfireBase = CAMP_CAMPFIRE_BASE;
        torchBaseA = CAMP_TORCH_BASE;
        torchBaseB = CAMP_TORCH_BASE;
      }
      if (seating.denSpots === 'seat-nearest') seatDenFixtures();
      else parkDenSpots();
      if (seating.campMoon === 'seat') seatCampMoon();
      else parkCampMoon();
      refreshCameraExposure();
    };

    // faceX/faceZ: witch facing on XZ (also drives showcase stub yaw).
    let faceX = 0, faceZ = -1;
    const perfProbe = createPerfProbe(600);
    (window as unknown as { __hf?: unknown }).__hf = {
      state,
      player,
      playerRig,
      monsters,
      skills,
      loot,
      fx,
      dungeon,
      character,
      get equipment() { return character.snapshot().equipment; },
      get bag() { return character.snapshot().bag; },
      takeItem,
      inv,
      get witchRoot() { return witchRoot; },
      get witchSkinEnt() { return witchSkinEnt; },
      get camRig() { return camRig; },
      /** Pre-probe desired ARPG arm (zoom); camRig.distance is post-contraction. */
      get desiredArm() { return arpgZoomDistance; },
      get cameraMode() { return camMode; },
      get area() { return area; },
      get sky() { return sky; },
      /** Active projectile / particle / slow-marker counts (Frost VFX lifecycle). */
      get fxCounts() { return fx.debugCounts(); },
      /** EffectExecutor peaks / budgetRejects (PR2b T5 stress vs PR0 baseline). */
      get fxExecutor() { return fx.executorStats(); },
      perf: {
        snapshot: () => perfProbe.snapshot(),
        reset: () => perfProbe.reset(),
      },
      campFade: {
        blockerIds: fadeEntries.map((e) => e.blockerId),
        entityCounts: Object.fromEntries(
          fadeEntries.map((e) => [e.blockerId, e.entityLocalIds.length]),
        ),
      },
      get dodge() { return dodgeState; },
      /** PR2c T2–T3 light-director counters — baseline after area transitions / Stop→Play. */
      lighting: {
        spotBudget: SPOT_SLOT_BUDGET,
        get denSpotsLive() {
          return (spotBaseA > 0 ? 1 : 0) + (spotBaseB > 0 ? 1 : 0);
        },
        get campMoonLive() {
          return moonBase > 0 ? 1 : 0;
        },
        get pointFixtureBases() {
          return { campfire: campfireBase, torchA: torchBaseA, torchB: torchBaseB };
        },
        get spotBases() {
          return { a: spotBaseA, b: spotBaseB, moon: moonBase };
        },
        get exposureMul() {
          return exposureMulForArea(area);
        },
      },
    };
    onCleanup(() => { delete (window as unknown as { __hf?: unknown }).__hf; });

    // ── camera + runtime render-settings (F10) ────────────────────────────
    // Camera *component* fields have a SINGLE writer: rs.applyCamera().
    // FOV comes from camRig.verticalFovRad; gameplay writes only Transform pose
    // from the rig. Spawn with a minimal perspective stub; install overwrites
    // tonemap/exposure/bloom/clear (resize must call applyCamera — never
    // re-spread perspective() alone or slider values reset to engine defaults).
    // Title panel wrote to BootCamera — tear it down before gameplay install.
    if (titleRs !== null) {
      titleRs.dispose();
      titleRs = null;
    }
    const camera = world.spawn(
      { component: Transform, data: { pos: [...camRig.eye] } },
      {
        component: Camera,
        data: perspective({ fov: camRig.verticalFovRad, aspect, near: 0.05, far: 200 }),
      },
    ).unwrap();
    // Drop the Title-era stub only after the gameplay camera exists.
    if (bootCamera !== null) {
      world.despawn(bootCamera);
      bootCamera = null;
    }
    // Filled in C3 (AmbientFx.configure). Starts as no-op so install's sync
    // persistAndNotify can call it before AmbientFx exists.
    let onParticlesHook: (s: RenderSettings) => void = () => {};
    const rs = installRenderSettings({
      mount: uiMount,
      world,
      camera,
      getAspect: () => aspect,
      proj: {
        getVerticalFovRad: () => camRig.verticalFovRad,
        near: 0.05,
        far: 200,
      },
      // UiLayerManager owns F10 exclusivity with inventory/skills (see below).
      bindHotkey: false,
      // PR2c T3: per-area exposure scale stays inside applyCamera (single writer).
      getExposureMul: () => exposureMulForArea(area),
      onLighting: (s) => {
        lightSettings = {
          sunMul: s.sunMul,
          ambientMul: s.ambientMul,
          fireMul: s.fireMul,
          fillMul: s.fillMul,
          atmoTemp: s.atmoTemp,
        };
        world.set(playerLight, PointLight, { intensity: 5.5 * s.fillMul, range: 3.8 });
        applyAreaLighting(area);
      },
      onParticles: (s) => { onParticlesHook(s); },
      onDisplay: (s) => { applyDisplaySettings(s); },
      onAudio: (s) => { applyAudioSettings(s); },
      onAtmosphere: (s) => {
        atmosphereApi?.setParams({
          vignette: s.vignette,
          haze: s.haze,
          atmoTemp: s.atmoTemp,
        });
      },
    });
    refreshCameraExposure = () => rs.applyCamera();
    onCleanup(() => rs.dispose());
    ((window as unknown as { __hf: Record<string, unknown> }).__hf).camera = camera;
    ((window as unknown as { __hf: Record<string, unknown> }).__hf).Camera = Camera;
    ((window as unknown as { __hf: Record<string, unknown> }).__hf).renderSettings = rs;
    ((window as unknown as { __hf: Record<string, unknown> }).__hf).Transform = Transform;
    ((window as unknown as { __hf: Record<string, unknown> }).__hf).AnimationPlayer = AnimationPlayer;
    ((window as unknown as { __hf: Record<string, unknown> }).__hf).Name = Name;
    ((window as unknown as { __hf: Record<string, unknown> }).__hf).world = world;

    // ── ambient particles (ember / ash / snow; zero lights) ────────────────
    const ambientFx = new AmbientFx(world, app);
    onCleanup(() => ambientFx.dispose());
    onParticlesHook = (s) => ambientFx.configure(s.particleDensity, s.particleStyle);
    // Apply persisted particle knobs now that AmbientFx exists (install ran earlier).
    {
      const s = rs.get();
      ambientFx.configure(s.particleDensity, s.particleStyle);
      ambientFx.setArea(area);
    }
    ((window as unknown as { __hf: Record<string, unknown> }).__hf).ambientFx = ambientFx;

    // ── tuning ────────────────────────────────────────────────────────────
    const SPEED = PLAYER_WALK_SPEED;
    const SPRINT = PLAYER_SPRINT_SPEED;
    const FACING_SIGN = 1;
    // Stride = ground speed (m/s) each locomotion clip matches at playback
    // rate 1. Walking_Woman ≈ 1.0 s / free-run ≈ 0.67 s loops — calibrate
    // separately so feet don't slide when selectLocomotionClip swaps clips.
    // SPEED 3.4 → walk rate ≈ 2.6; SPRINT 5.4 → run rate ≈ 1.5.
    // Stride speeds ≈ clip's natural ground speed: playbackRate = speed/stride
    // lands near 1.0–1.25× at walk 3.4 / sprint 5.4 m/s (was 1.3/3.6 → 2.6×
    // fast-forward walk). Cap MAX at 2.0 so buffed speed never looks comical.
    const ANIM_STRIDE_WALK = 3.0;
    const ANIM_STRIDE_RUN = 4.4;
    const ANIM_SPEED_MIN = 0.6, ANIM_SPEED_MAX = 2.0;

    // ── camera math: world↔screen / aim from CameraRigState only ──────────
    const worldToScreen = (wx: number, wy: number, wz: number): { x: number; y: number } | null =>
      projectWorldToScreen(
        camRig, wx, wy, wz, aspect, canvas.clientWidth, canvas.clientHeight,
      );
    // Mouse ground-point aim: unproject via the rig — no pointer lock.
    let mouseX = 0, mouseY = 0;
    const aimDir = (): { x: number; z: number } => {
      const hit = aimOnGround(
        camRig, mouseX, mouseY, aspect, canvas.clientWidth, canvas.clientHeight,
      );
      if (!hit) return { x: faceX, z: faceZ };
      const dx = hit.x - state.px, dz = hit.z - state.pz;
      const len = Math.hypot(dx, dz);
      if (len < 0.01) return { x: faceX, z: faceZ };
      return { x: dx / len, z: dz / len };
    };

    // ── mouse policy: NO pointer lock, gauntlet cursor ─────────────────────
    // The cursor stays free and visible (forge.json pointerLock:false keeps
    // the host shell from grabbing it either). Aiming reads the cursor's
    // ground point from the camera rig. Cursor skin is the ui-cursors.ts
    // gauntlet stylesheet installed at bootstrap (shell + in-game unified).
    const releaseHostCapture = () => {
      try { window.parent.postMessage({ type: 'fx-pointer-capture', capture: false }, '*'); } catch { /* not embedded */ }
    };
    releaseHostCapture();                    // clear any stale grab from before
    try { document.exitPointerLock?.(); } catch { /* ignore */ }

    // ── clip helpers ──────────────────────────────────────────────────────
    // mage_soell_cast_6 has a long wind-up + follow-through; 2.6× keeps the whole
    // cast at ~0.9 s so the wind-up reads as responsive instead of laggy.
    const ATTACK_SPEED = 2.6;
    const HIT_SPEED = 1.7;
    // Roll_Dodge (~1.87 s) dedicated pace: fast enough that the clip nearly
    // completes as the 0.65 s dodge window closes (~0.85 s at 2.2×) — a slow
    // rate leaves the landing tail playing after the roll and reads stuck.
    // NOT derived from DODGE_TOTAL_S (2.9× compression was a cartoon snap).
    const DODGE_CLIP_RATE = 2.2;
    // The engine's advanceAnimationPlayer advances clips by real Time.delta
    // (animation/src/systems/advance-animation-player.ts:776), so playback is
    // wall-clock true in every scene. The retired fixed-1/60 fps compensation
    // (ENGINE-ISSUES-for-ubpa.md, since fixed engine-side) distorted rates at
    // off-60 fps — 120 fps camp ×0.5 slow-mo, 30 fps den ×2.0 fast-forward.
    let witchAnimBase = 1;
    const swapClip = (name: string) => {
      if (witchAnimPlayer === null) return;
      const h = clipHandles.get(name);
      if (h === undefined || state.currentClip === name) return;
      state.currentClip = name;
      witchAnimBase = 1;
      world.set(witchAnimPlayer, AnimationPlayer, {
        clips: [h], times: new Float32Array([0]), weights: new Float32Array([1]), speeds: new Float32Array([1]), looping: true, paused: state.paused,
      });
    };
    const playOnce = (name: string, speed = 1, lockScale = 1) => {
      if (witchAnimPlayer === null) return;
      if (performance.now() < state.oneShotUntil && name !== 'death') return;
      const h = clipHandles.get(name);
      if (h === undefined) return;
      state.currentClip = name;
      // lockScale < 1 releases control before the clip's tail (recovery frames)
      // finishes — the state machine then swaps to move/idle, i.e. the follow-
      // through is cancellable, ARPG-style.
      state.oneShotUntil = performance.now() + ((clipDur.get(name) ?? 1) / speed) * 1000 * lockScale;
      witchAnimBase = speed;
      world.set(witchAnimPlayer, AnimationPlayer, {
        clips: [h], times: new Float32Array([0]), weights: new Float32Array([1]), speeds: new Float32Array([speed]), looping: false, paused: state.paused,
      });
    };

    /**
     * Roll-cancel shared by cast / click-move / WASD: when the cancel actually
     * aborts the roll, also release the clip lock so the next animation takes
     * over immediately instead of sliding in the roll tail.
     */
    const rollCancel = (): void => {
      const next = cancelDodgeForSkillOrMove(dodgeState);
      if (next.phase === 'idle' && dodgeState.phase !== 'idle') state.oneShotUntil = 0;
      dodgeState = next;
    };

    // ── casting — SkillCaster + CharacterDomain hotbar (shared mana/cd/ranks) ─
    const finishCast = (id: ActiveSkillId, aim: { x: number; z: number }, res: CastResult): void => {
      if (res === 'ok') {
        faceX = aim.x; faceZ = aim.z;
        if (id !== 'blink') playOnce('attack', ATTACK_SPEED, 0.7);
        sfx.play(
          id === 'magma' || id === FINISHER_ID ? 'cast-magma'
            : id === 'frost' ? 'cast-frost'
            : id === 'arc' ? 'cast-arc'
            : 'blink',
        );
        refreshSkillBar();
      } else if (res === 'mana') {
        const s = worldToScreen(state.px, 2.0, state.pz);
        if (s) hud.floatText('法力不足', s.x, s.y, { color: '#7da2ff', size: 14 });
      } else if (res === 'locked') {
        const s = worldToScreen(state.px, 2.0, state.pz);
        if (s) {
          hud.floatText('技能未学习', s.x, s.y, { color: '#caa', size: 14 });
        }
      }
    };

    const tryCastSkillId = (id: ActiveSkillId, aimOverride?: { x: number; z: number }): CastResult => {
      if (player.dead || camMode !== 'arpg') return 'dead';
      // L3: no cast during dodge buildup/movement (recover cancel window ok).
      if (!dodgeAllowsSkillOrMove(dodgeState)) return 'cooldown';
      // L5: finisher windup locks further casts.
      if (skills.isFinisherInputLocked()) return 'cooldown';
      const aim = aimOverride ?? aimDir();
      const groundXZ = id === FINISHER_ID ? groundAimXZ() ?? undefined : undefined;
      const res = skillCaster.cast(id, [aim.x, aim.z], groundXZ ? { groundXZ } : undefined);
      // L3 roll-cancel: successful cast during late recover aborts + arms CD.
      if (res === 'ok') rollCancel();
      finishCast(id, aim, res);
      return res;
    };

    /** Digit 1–4: select domain hotbar slot only (Spec §5.3 — no cast). */
    const selectHotbarSlot = (slot: 0 | 1 | 2 | 3): void => {
      character.dispatch({ op: 'select-hotbar', slot });
      refreshSkillBar();
      persistCharacter();
    };

    /** RMB: cast the skill currently selected on the domain hotbar. */
    const tryCastSelectedHotbar = (): CastResult => {
      if (player.dead) return 'dead';
      const snap = character.snapshot();
      const skillId = snap.hotbar[snap.selectedHotbarSlot];
      if (!skillId) return 'locked';
      return tryCastSkillId(skillId);
    };

    // ── HUD wiring ────────────────────────────────────────────────────────
    const refreshSkillBar = (): void => {
      const snap = character.snapshot();
      const slots: SkillSlotState[] = ([0, 1, 2, 3] as const).map((slot) => {
        const skillId = snap.hotbar[slot];
        const selected = snap.selectedHotbarSlot === slot;
        if (!skillId) {
          return {
            icon: '',
            name: '空',
            key: `${slot + 1}`,
            manaCost: 0,
            cooldownPct: 0,
            locked: true,
            unlockLevel: 0,
            affordable: false,
            selected,
            empty: true,
          };
        }
        const idx = skills.indexOf(skillId);
        const def = skillDefForRanks(skillId, snap.skillRanks);
        const resolved = resolveSkill(skillId, {
          skillRanks: snap.skillRanks,
          phaseEchoActive: skills.isPhaseEchoActive(),
        });
        const unlocked = idx >= 0 && skills.unlocked(idx, snap.level, snap.skillRanks);
        return {
          icon: def.icon,
          name: def.name,
          key: `${slot + 1}`,
          manaCost: resolved.manaCost,
          cooldownPct: resolved.cooldown > 0 && idx >= 0
            ? skills.cooldowns[idx]! / resolved.cooldown
            : 0,
          locked: !unlocked,
          unlockLevel: 0,
          affordable: player.mana >= resolved.manaCost,
          selected,
          empty: false,
        };
      });
      // Belt continuation — 5 = life potion, 6 = mana potion (domain counters,
      // NOT hotbar slots; see UI-CUTSCENE-UPGRADE-PLAN §R2).
      const belt: SkillSlotState[] = (['life', 'mana'] as const).map((kind, i) => ({
        icon: '',
        name: kind === 'life' ? '生命药水' : '法力药水',
        key: `${i + 5}`,
        manaCost: 0,
        cooldownPct: 0,
        locked: false,
        unlockLevel: 0,
        affordable: true,
        selected: false,
        empty: snap.potions[kind] <= 0,
        count: snap.potions[kind],
        potion: kind,
      }));
      hud.setSkills([...slots, ...belt]);
    };
    let mapQuestProjection = character.snapshot().quests;
    const refreshQuest = (): void => {
      mapQuestProjection = character.snapshot().quests;
      const st = questStatus();
      if (st === 'completed') {
        hud.setQuest(`✓ ${QUEST_TITLE} — 已完成`);
        return;
      }
      if (st === 'available') {
        hud.setQuest('与烬守者维拉交谈，接受任务');
        return;
      }
      if (st === 'ready') {
        hud.setQuest(`任务就绪：返回营地向维拉交还「${QUEST_TITLE}」`);
        return;
      }
      // active
      const objs = combatRun.snapshot().objectives;
      if (area === 'den') {
        const left = denMinionAliveCount() + (monsters.boss() ? 1 : 0);
        const bits = [
          objs['den-minions-cleared'] ? '✓爪牙' : `爪牙 ${denMinionAliveCount()}`,
          objs['slagdeep-boss-defeated'] ? '✓督军' : '督军',
        ];
        hud.setQuest(`任务：${QUEST_TITLE} · ${bits.join(' · ')}（${left}/${denTotal}）`);
      } else {
        hud.setQuest(`任务：${QUEST_TITLE}（营地大门外，穿过灰烬荒原）`);
      }
    };
    refreshSkillBar();
    refreshQuest();
    applyEquipment();          // paints the (empty) equip slots + baseline mods

    // ── PR11 T4: lazy den packs (~the largest single download) ────────────
    // slagdeep-hollow + boss-antechamber geometry + den-only monster visuals
    // (flamecaller/slaglord) load ONCE here, off the campaign boot path.
    // Triggers: (a) prefetch on first wild entry (idle bandwidth on the cave
    // approach), (b) awaited at the cave portal behind a determinate cover,
    // (c) awaited at boot for den-direct launches. The den pre-spawn + denTotal
    // moved here too, so no den monster exists before its geometry + visual are
    // ready (T5 no-air-monster invariant). One-shot: the same promise serves
    // every caller, so a second entry is instant.
    let denLoadPromise: Promise<void> | null = null;
    let denReady = false;
    /** Portal cover's progress sink — wired only while that cover is up. */
    let denItemSink: (() => void) | null = null;
    const ensureDenLoaded = (): Promise<void> => {
      if (denLoadPromise) return denLoadPromise;
      const note = (): void => { denItemSink?.(); };
      denLoadPromise = (async () => {
        const denDegraded: string[] = [];
        // 1. den geometry (slagdeep + antechamber packs, parallel — T3). On
        //    failure it spawns the same runtime fallback as before (never silent).
        if (await dungeon.installGeometry(assets, note) === 'fallback') denDegraded.push('地牢场景');
        if (stopped) return; // torn down mid-load — skip further world/HUD writes
        // PR8 T3 ambient fire — sprite flame bodies on every den torch/brazier,
        // ignited with the lazy den load (not at camp boot).
        for (const f of dungeon.flameFixtures) {
          fx.addAmbientFire(f.x, f.y, f.z, { scale: f.brazier ? 0.85 : 0.6 });
        }
        // 2. den-only monster visuals (wild kinds are already warm from boot;
        //    the den also spawns those, so every bank it needs is present).
        const denKinds = assets
          ? await monsters.loadVisualsFor(DEN_MONSTER_KINDS, assets, note)
          : [];
        if (denKinds.length < DEN_MONSTER_KINDS.length) denDegraded.push('怪物模型');
        if (stopped) return; // torn down mid-load — don't spawn into a dead world
        // 3. den pre-spawn (moved from boot) + quest denominator.
        for (const s of dungeon.monsterSpawns) {
          if (monsters.spawn(s.kind, s.x, s.z, 'den')) denTotal++;
        }
        // 4. shadow-caster pass for the newly instantiated den entities (T4).
        ensureShadowCasters(world);
        denReady = true;
        if (denDegraded.length > 0) {
          hud.banner(`部分资产降级：${denDegraded.join('、')}`, '#ffb070', 5000);
        }
        refreshQuest();
      })();
      return denLoadPromise;
    };

    // Major UI ownership (single active surface) — hoisted above enterArea:
    // its N-Stash camp latch reads uiLayers, and the den-direct boot branch
    // calls enterArea('den') before the old site → TDZ ReferenceError. The
    // onOwnershipChange body only runs at runtime (panel open/close), by which
    // point its later-declared captures (worldInputBlocked / MOVE_INTENT_KEYS /
    // automap / clearMoveIntent / keys) are all initialized.
    const uiLayers = createUiLayerManager({
      onOwnershipChange: (_prev, next) => {
        worldInputBlocked = next !== null;
        if (next !== null) automap.collapseExpanded();
        clearMoveIntent();
        for (const code of MOVE_INTENT_KEYS) keys[code] = false;
      },
    });

    const enterArea = (next: Area): void => {
      if (next === area) return;
      area = next;
      // N-Stash camp latch: the dual-open pair is camp-only — leaving camp
      // force-closes it (mirrors the showcase force-revert precedent below).
      // Covers both the per-frame boundary detection and den teleports.
      if (next !== 'camp' && uiLayers.active() === 'stash') uiLayers.close('stash');
      applyAreaLighting(next);
      ambientFx.setArea(next);
      const areaId = next === 'camp' ? 'cinderwatch' : next === 'den' ? 'slagdeep-hollow' : 'ashen-reach';
      const def = getAreaDef(areaId);
      bgm.setPhase(bgmPhaseForMusic(def.music));
      hud.showArea(def.displayName, def.displayNameEn);
      if (next === 'den') {
        // Fresh combat-run objectives; seed derived (not saved).
        combatRun.dispatch({
          op: 'enter',
          areaId: 'slagdeep-hollow',
          characterId: character.snapshot().identity.id,
          questId: PURGE_QUEST_ID,
        });
      }
      // PR11 T4a: first wild entry prefetches the den (bandwidth is idle on the
      // cave approach), so the cave portal is usually instant. One-shot/no-op
      // once resolved; leaving the den also lands here with the promise done.
      // .catch is defensive — internals have fallbacks and stopped-guards, so
      // rejection is near-impossible, but if it ever fires it's loud (never an
      // unhandled rejection).
      if (next === 'wild') {
        void ensureDenLoaded().catch((err) => {
          console.error('[hellforge] den prefetch load failed:', err);
        });
      }
      refreshQuest();
    };

    // ── PR11 T4: den zone-transition (cave portal) ────────────────────────
    // The teleport itself is extracted unchanged from the pre-PR11 inline
    // sequence so it can run AFTER the lazy den load completes.
    let denTransitioning = false;
    const doDenTeleport = (): void => {
      const transition = resolveAreaTransition('slagdeep-hollow', 'den-entry', {
        characterId: character.snapshot().identity.id,
        den: { entry: dungeon.entry, exitPad: DEN_EXIT },
      });
      state.px = transition.playerPos[0];
      state.pz = transition.playerPos[1];
      camRig = snapCameraFocus(makeArpgAtPlayer(), [state.px, 0, state.pz]);
      rs.applyCamera();
      sfx.play('portal');
      const denDef = getAreaDef('slagdeep-hollow');
      void uiTransition.zoneCard(denDef.displayName, {
        sub: denDef.displayNameEn,
        tip: '净化窟底的污秽',
      });
      enterArea('den');
      denTransitioning = false; // transition complete — portal may re-arm off-pad
    };
    // Gate: prefetch usually makes entry instant (denReady → no cover, runs
    // synchronously like before). A slow first entry pays the remainder behind
    // the determinate transition cover (T2), then teleports. denTransitioning
    // keeps portalArmed false until the whole transition completes (no double).
    const enterDenViaPortal = (): void => {
      if (denTransitioning) return;
      denTransitioning = true;
      if (denReady) { doDenTeleport(); return; }
      const denTracker = new LoadTracker()
        .register('den', 2 + DEN_MONSTER_KINDS.length * 6); // packs + kind × (scene+5)
      denTracker.onChange((f) => shell?.setLoadingProgress(f));
      denItemSink = () => denTracker.complete('den');
      shell?.showLoading('深入熔渣深窟…');
      const finish = (): void => { denItemSink = null; };
      void ensureDenLoaded()
        .then(() => {
          denTracker.completePhase('den'); // 100% exactly as the cover hides (§5.4)
          shell?.hideLoading();
          finish();
          if (stopped) return; // torn down mid-load — don't teleport a dead world
          doDenTeleport();
        })
        .catch((err) => {
          // ensureDenLoaded has internal fallbacks; never strand the player.
          console.error('[hellforge] den load at portal failed — entering with fallbacks:', err);
          shell?.hideLoading();
          finish();
          if (stopped) return;
          doDenTeleport();
        });
    };

    // Abort BEFORE in-game handoff / input wiring. Returning after hud.show() +
    // shell.goTo('inGame') but before registerUpdate left a frozen scene that
    // looked playable (WASD hints on screen) with no locomotion loop.
    if (stopped) return;

    // ── campaign / den handoff ───────────────────────────────────────────
    let inGame = startedInDen;
    let queuedCampIntro = false;
    if (!startedInDen) {
      hud.hide();
      inv.hide();
    }
    if (startedInDen) {
      // PR11 T4: den-direct pays the lazy den leg at boot (no prefetch benefit)
      // so the handoff below lands in a fully-loaded den — same code path.
      await ensureDenLoaded();
      if (stopped) return;
      state.px = dungeon.entry.x;
      state.pz = dungeon.entry.z;
      camRig = snapCameraFocus(camRig, [state.px, 0, state.pz]);
      enterArea('den');
    } else {
      persistCharacter();
      charSelect?.hide();
      charList?.hide();
      bootTracker.complete('ready'); // 100% exactly as the cover hides (§5.4)
      shell?.goTo('inGame');
      shellPhase = 'inGame';
      inGame = true;
      hud.show();
      queuedCampIntro = true; // area title rides the intro cutscene caption instead
    }
    if (degraded.length > 0) {
      hud.banner(`部分资产降级：${degraded.join('、')}`, '#ffb070', 5000);
    }

    // ── automap (persistent minimap + expanded read-only projection) ───────
    const ASHEN_LANDMARK_LABELS: Readonly<Record<string, string>> = {
      'slag-bridge': '熔渣石桥',
      'fallen-forge': '坠落熔炉遗址',
    };
    const noteMapDiscovery = (): void => {
      if (area === 'den') {
        const cell = dungeon.worldToCell(state.px, state.pz);
        if (cell) exploredDenCells.add(`${cell.cx},${cell.cy}`);
      }
      if (area === 'wild') {
        for (const landmark of ashenLayout.landmarks) {
          if (Math.hypot(landmark.pos[0] - state.px, landmark.pos[1] - state.pz) <= 2.75) {
            reachedWildLandmarks.add(landmark.id);
          }
        }
      }
    };
    const mapExitMarkers = (authorizedOnly: boolean): readonly {
      id: AreaExitId;
      x: number;
      z: number;
      label: string;
    }[] => {
      const areaId = area === 'camp'
        ? 'cinderwatch' as const
        : area === 'wild'
          ? 'ashen-reach' as const
          : 'slagdeep-hollow' as const;
      const quests = mapQuestProjection;
      return getAreaDef(areaId).exits
        .filter((exit) => !authorizedOnly || canEnterArea(exit, quests))
        .flatMap((exit) => {
          const pos = runtimeExitPosition(exit.id);
          if (!pos) return [];
          return [{
            id: exit.id,
            x: pos.x,
            z: pos.z,
            label: getAreaDef(exit.to).displayName,
          }];
        });
    };
    const mapSnapshot = (): AutomapSnapshot => ({
      area,
      player: { x: state.px, z: state.pz },
      exploredDenCells: area === 'den' ? exploredDenCells : undefined,
      denWalkGrid: area === 'den'
        ? { cells: dungeon.getWalkGrid(), columns: CELLS, rows: CELLS }
        : undefined,
      denPlayerCell: area === 'den'
        ? dungeon.worldToCell(state.px, state.pz) ?? undefined
        : undefined,
      landmarks: area === 'wild'
        ? filterReachedLandmarks(
          ashenLayout.landmarks.map((landmark) => ({
            id: landmark.id,
            x: landmark.pos[0],
            z: landmark.pos[1],
            label: ASHEN_LANDMARK_LABELS[landmark.id] ?? landmark.id,
          })),
          reachedWildLandmarks,
        )
        : undefined,
      areaExits: mapExitMarkers(false),
      questAuthorizedDirections: mapExitMarkers(true),
    });
    const automap = installAutomap(uiMount, { getSnapshot: mapSnapshot });
    const treeStateFromDomain = () => {
      const snap = character.snapshot();
      return stateFromProgression({
        level: snap.level,
        unspentSkillPoints: snap.unspentSkillPoints,
        skillRanks: snap.skillRanks,
        hotbar: snap.hotbar,
        selectedHotbarSlot: snap.selectedHotbarSlot,
      });
    };
    const toTreeResult = (res: { ok: true } | { ok: false; reason: string }): SkillTreeResult => {
      if (res.ok) return { ok: true, state: treeStateFromDomain() };
      return { ok: false, reason: res.reason as SkillTreeFailReason };
    };
    const skillPanel = installSkillPanel(uiMount, {
      getViewModel: () => buildSkillTreeViewModel({
        treeState: treeStateFromDomain(),
        inCamp: area === 'camp',
      }),
      invest: (nodeId) => {
        const res = character.dispatch({ op: 'invest-skill', nodeId });
        if (res.ok) { persistCharacter(); refreshSkillBar(); }
        return toTreeResult(res);
      },
      respec: () => {
        const res = character.dispatch({
          op: 'respec-skills',
          areaId: area === 'camp' ? 'cinderwatch' : area === 'den' ? 'slagdeep-hollow' : 'ashen-reach',
        });
        if (res.ok) { persistCharacter(); refreshSkillBar(); }
        return toTreeResult(res);
      },
      assign: (nodeId, slot) => {
        const res = character.dispatch({ op: 'assign-hotbar', nodeId, slot });
        if (res.ok) { persistCharacter(); refreshSkillBar(); }
        return toTreeResult(res);
      },
    });
    const skillFixture = installSkillFixture(uiMount, {
      getDomain: () => character,
      onChange: () => {
        persistCharacter();
        refreshSkillBar();
        if (skillPanel.isOpen()) skillPanel.refresh();
      },
    });
    onCleanup(() => {
      automap.dispose();
      skillPanel.dispose();
      skillFixture.dispose();
    });

    // ── movement intent + interaction registry (Spec §5.3) ────────────────
    let moveIntent: MovementIntent = { kind: 'none' };
    let followPath: readonly (readonly [number, number])[] = [];
    let lastNavPath: readonly (readonly [number, number])[] = [];
    let followIdx = 0;
    let targetRepathAcc = 0;
    /** Last pursuit target position used for a path (hysteresis gate). */
    let lastRepathTarget: readonly [number, number] | null = null;
    let navStuckCount = 0;
    let stuckAcc = 0;
    let stuckOrigin: readonly [number, number] | null = null;
    let stuckRepathed = false;
    const STUCK_WINDOW_SEC = 0.75;
    const STUCK_DISPLACE_M = 0.05;
    const CLICK_PICK_R = 1.6;

    const applyPickupEvent = (ev: {
      kind: string;
      amount: number;
      item?: ItemInstance;
      x: number;
      y: number;
      z: number;
    }): void => {
      const s = worldToScreen(ev.x, ev.y + 0.4, ev.z);
      if (ev.kind === 'xp') {
        const gained = Math.round(ev.amount * (1 + combatStats.xpGain));
        const xpRes = character.dispatch({ op: 'grant-xp', amount: gained });
        sfx.play('pickup');
        if (s) hud.floatText(`+${gained} 经验`, s.x, s.y, { color: '#ffb45e', size: 14 });
        if (xpRes.ok && xpRes.levelUps?.length) {
          for (const up of xpRes.levelUps) {
            hud.banner(`等级提升！ Lv ${up.level}`, '#ffd066', 2000);
            fx.rise(state.px, 0.2, state.pz, 'gold', 16, 0.9);
            sfx.play('levelup');
          }
          refreshSkillBar();
          applyEquipment({ refill: true });
        }
        persistCharacter();
      } else if (ev.kind === 'gold') {
        const gained = Math.round(ev.amount * (1 + combatStats.goldFind));
        character.dispatch({ op: 'add-gold', amount: gained });
        hud.setGold(character.snapshot().gold);
        sfx.play('pickup');
        if (s) hud.floatText(`+${gained} 金币`, s.x, s.y, { color: '#ffcf40', size: 14 });
        persistCharacter();
      } else if (ev.kind === 'healPotion') {
        // Storable belt stock first; instant heal only when the belt is full.
        const res = character.dispatch({ op: 'add-potion', kind: 'life' });
        if (res.ok && (res.potionAdded ?? 0) > 0) {
          sfx.play('potion');
          if (s) hud.floatText('生命药水 +1', s.x, s.y, { color: '#ff6a6a', size: 14 });
          refreshSkillBar();
          persistCharacter();
        } else {
          player.hp = Math.min(player.maxHp, player.hp + ev.amount);
          sfx.play('potion');
          if (s) hud.floatText(`+${ev.amount} 生命`, s.x, s.y, { color: '#ff6a6a', size: 15 });
          fx.rise(state.px, 0.4, state.pz, 'heal', 6, 0.4);
        }
      } else if (ev.kind === 'item' && ev.item) {
        takeItem(ev.item, s?.x ?? null, s?.y ?? null);
      } else if (ev.kind === 'manaPotion') {
        const res = character.dispatch({ op: 'add-potion', kind: 'mana' });
        if (res.ok && (res.potionAdded ?? 0) > 0) {
          sfx.play('potion');
          if (s) hud.floatText('法力药水 +1', s.x, s.y, { color: '#7da2ff', size: 14 });
          refreshSkillBar();
          persistCharacter();
        } else {
          player.mana = Math.min(player.maxMana, player.mana + ev.amount);
          sfx.play('potion');
          if (s) hud.floatText(`+${ev.amount} 法力`, s.x, s.y, { color: '#7da2ff', size: 15 });
        }
      }
    };

    /** Belt potion hotkeys (Digit5/6) — domain consumes, runtime heals. */
    const usePotion = (kind: 'life' | 'mana'): void => {
      const current = kind === 'life' ? player.hp : player.mana;
      const max = kind === 'life' ? player.maxHp : player.maxMana;
      const res = character.dispatch({ op: 'use-potion', kind, current, max });
      if (!res.ok) {
        const msg = !res.ok && res.reason === 'not-needed'
          ? (kind === 'life' ? '生命已满' : '法力已满')
          : (kind === 'life' ? '没有生命药水了' : '没有法力药水了');
        hud.banner(msg, '#ff6a6a', 900);
        return;
      }
      const restore = res.potionUsed?.restore ?? 0;
      if (kind === 'life') {
        player.hp = Math.min(player.maxHp, player.hp + restore);
        fx.rise(state.px, 0.4, state.pz, 'heal', 6, 0.4);
      } else {
        player.mana = Math.min(player.maxMana, player.mana + restore);
      }
      sfx.play('potion');
      hud.setOrbs(player.hp, player.maxHp, player.mana, player.maxMana);
      refreshSkillBar();
      persistCharacter();
    };

    // Filled when UiLayerManager / dialogue UI are installed below.
    let openDialoguePanel: ((node: ReturnType<typeof dialogueFor>) => void) | null = null;
    const openVeyraDialogue = (): void => {
      const node = dialogueFor('npc-cinderwarden-veyra', character.snapshot().quests);
      openDialoguePanel?.(node);
    };

    const interactions = createInteractionRegistry({
      getMonster: (id) => {
        const m = monsters.byId(id);
        return m ? { x: m.x, z: m.z, radius: MONSTERS[m.kind].radius } : null;
      },
      getNpc: (id) => {
        if (id !== 'npc-cinderwarden-veyra') return null;
        if (area === 'den') return null;
        return { x: veyraPos[0], z: veyraPos[1] };
      },
      getLoot: (id) => {
        const g = loot.byId(id);
        return g ? { x: g.x, z: g.z } : null;
      },
      getExit: (id: AreaExitId) => {
        return runtimeExitPosition(id);
      },
      listCandidates: () => {
        const out: InteractionCandidate[] = [];
        for (const m of monsters.monsters) {
          out.push({
            ref: { kind: 'monster', id: m.id },
            position: [m.x, m.z],
            pickRadius: MONSTERS[m.kind].radius + 0.9,
          });
        }
        if (area !== 'den') {
          out.push({
            ref: { kind: 'npc', id: 'npc-cinderwarden-veyra' },
            position: [veyraPos[0], veyraPos[1]],
            pickRadius: 2.2,
          });
        }
        for (const g of loot.listForPick()) {
          out.push({ ref: { kind: 'loot', id: g.id }, position: [g.x, g.z], pickRadius: 1.1 });
        }
        if (area !== 'den') {
          const exit = runtimeExitPosition('reach-to-slagdeep');
          if (!exit) return out;
          out.push({
            ref: { kind: 'exit', id: 'reach-to-slagdeep' },
            position: [exit.x, exit.z],
            pickRadius: 2.2,
          });
        } else {
          const exit = runtimeExitPosition('slagdeep-to-reach');
          if (!exit) return out;
          out.push({
            ref: { kind: 'exit', id: 'slagdeep-to-reach' },
            position: [exit.x, exit.z],
            pickRadius: 2.2,
          });
        }
        return out;
      },
      onMonsterInRange: (id) => {
        if (camMode !== 'arpg') return 'failed';
        const m = monsters.byId(id);
        if (!m) return 'failed';
        const dx = m.x - state.px, dz = m.z - state.pz;
        const len = Math.hypot(dx, dz) || 1;
        const res = tryCastSkillId(LMB_PURSUIT_SKILL, { x: dx / len, z: dz / len });
        if (res === 'ok') return 'ok';
        if (res === 'cooldown' || res === 'mana') return 'failed';
        return 'failed';
      },
      onNpcInteract: (id) => {
        if (camMode !== 'arpg') return 'failed';
        if (id !== 'npc-cinderwarden-veyra') return 'failed';
        openVeyraDialogue();
        return 'consumed';
      },
      onLootInteract: (id) => {
        if (camMode !== 'arpg') return 'failed';
        const ev = loot.collectById(id, () => hasFreeCell(character.snapshot().bag as BagAnchor[]));
        if (!ev) return 'failed';
        applyPickupEvent(ev);
        return 'consumed';
      },
      onExitInteract: (id) => {
        if (camMode !== 'arpg') return 'failed';
        // Walk-into portal pads still work; click-interact nudges the player onto the pad.
        if (id === 'reach-to-slagdeep' || id === 'cinderwatch-to-reach') {
          if (area === 'den') return 'failed';
          if (id === 'reach-to-slagdeep' && !canEnterSlagdeep(character.snapshot().quests)) {
            hud.banner('深窟封锁 — 先与烬守者维拉交谈', '#ffb070', 2200);
            return 'failed';
          }
          const exit = runtimeExitPosition(id);
          if (!exit) return 'failed';
          state.px = exit.x;
          state.pz = exit.z;
          return 'ok';
        }
        if (id === 'slagdeep-to-reach' || id === 'reach-to-cinderwatch') {
          if (area !== 'den') return 'failed';
          const exit = runtimeExitPosition(id);
          if (!exit) return 'failed';
          state.px = exit.x;
          state.pz = exit.z;
          return 'ok';
        }
        return 'failed';
      },
      npcRange: 2.2,
    });

    const setMoveIntent = (next: MovementIntent): void => {
      moveIntent = next;
      followPath = [];
      followIdx = 0;
      targetRepathAcc = 0;
      lastRepathTarget = null;
      stuckAcc = 0;
      stuckOrigin = null;
      stuckRepathed = false;
      if (next.kind === 'point') {
        followPath = navigation.path([state.px, state.pz], next.world);
        lastNavPath = followPath;
      } else if (next.kind === 'target') {
        const resolved = interactions.resolve(next.target);
        if (resolved) {
          followPath = navigation.path([state.px, state.pz], resolved.position);
          lastNavPath = followPath;
          lastRepathTarget = resolved.position;
        }
      }
    };

    const clearMoveIntent = (): void => {
      setMoveIntent({ kind: 'none' });
    };

    const beginCameraMode = (toMode: CameraMode): void => {
      if (camMode === toMode && camBlend === null) return;
      camBlend = { from: { ...camRig }, toMode, elapsed: 0 };
      camMode = toMode;
      clearMoveIntent();
      skills.clearProjectilesAndCooldowns();
      hud.setShowcaseReduced(toMode === 'showcase');
      if (toMode === 'showcase') hud.setTarget(null);
    };

    // ── major UI ownership (inventory / skills / settings; future quests…) ─
    // Opening a major panel clears MovementIntent and blocks world input.
    const MOVE_INTENT_KEYS = [
      'KeyW', 'KeyA', 'KeyS', 'KeyD',
      'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'ShiftLeft', 'ShiftRight', 'Space',
    ] as const;
    let worldInputBlocked = false;
    const questLog = installQuestLog(uiMount);
    const refreshQuestLog = (): void => {
      const st = questStatus();
      const vm: QuestViewModel = {
        id: PURGE_QUEST_ID,
        title: QUEST_TITLE,
        status: st,
        summary:
          st === 'available' ? '与烬守者维拉交谈，接受清剿熔渣深窟的委托。'
            : st === 'active' ? '穿过灰烬荒原进入熔渣深窟，清剿爪牙并击败熔渣督军。'
              : st === 'ready' ? '目标已达成 — 返回营地向维拉交还任务领取霜铸魔杖。'
                : '熔渣深窟已平息。霜铸魔杖已交付。',
      };
      questLog.update([vm]);
    };
    const dialogueUi = installDialogueUi(uiMount, {
      onChoice: (choice) => {
        if (choice.action.kind === 'close' || choice.action.kind === 'continue') {
          uiLayers.close('dialogue');
          return;
        }
        if (choice.action.kind === 'accept') {
          const res = acceptQuest(character);
          uiLayers.close('dialogue');
          if (res.ok) {
            sfx.play('quest');
            hud.banner('已接受：清剿熔渣深窟', '#8aff9a', 2200);
            persistCharacter();
            refreshQuest();
            refreshQuestLog();
            // PR4a T3 L3 — short skippable camera beat after dialogue closes.
            playCutscene(buildQuestAcceptanceBeat({
              camera: camRig,
              playerXZ: [state.px, state.pz],
              veyraXZ: [veyraPos[0], veyraPos[1]],
            }));
          }
          return;
        }
        if (choice.action.kind === 'turn-in') {
          const res = turnInQuest(character);
          if (!res.ok) {
            if (res.reason === 'inventory-full') {
              hud.banner('背包已满 — 腾出空位后再交还', '#ffb070', 2800);
              // Stay ready; keep dialogue open so player can retry after melting.
              dialogueUi.show(dialogueFor('npc-cinderwarden-veyra', character.snapshot().quests));
              return;
            }
            uiLayers.close('dialogue');
            return;
          }
          sfx.play('quest');
          hud.banner('任务完成：获得霜铸魔杖', '#ffd066', 2800);
          hud.setGold(character.snapshot().gold);
          applyEquipment();
          persistCharacter();
          refreshQuest();
          refreshQuestLog();
          refreshSkillBar();
          uiLayers.close('dialogue');
        }
      },
    });
    openDialoguePanel = (node) => {
      uiLayers.open('dialogue');
      dialogueUi.show(node);
    };

    // ── forge cube (F) — salvage / re-roll / fuse via CharacterDomain ─────
    const craftFailBanner = (reason: string): void => {
      if (reason === 'legendary-locked') hud.banner('传奇不可锻造', '#ff8866', 1400);
      else if (reason === 'not-enough-materials') hud.banner('材料不足', '#ff8866', 1400);
      else if (reason === 'bad-recipe') hud.banner('配方不符', '#ff8866', 1400);
      else if (reason === 'bad-index' || reason === 'empty-slot') hud.banner('物品已失效', '#ff8866', 1200);
    };
    const cube = installCubeUI({
      getBag: () => character.snapshot().bag as BagAnchor[],
      getMaterials: () => character.snapshot().materials,
      // N2: settle + persist immediately; SFX/banner deferred via onPresent (reveal).
      onSalvage: (index) => {
        const before = character.snapshot().bag[index]?.item;
        const res = character.dispatch({ op: 'salvage-bag', index });
        if (!res.ok) { craftFailBanner(res.reason); return { ok: false }; }
        const yield_ = before ? salvageYield(before) : null;
        const tierLabel = before?.rarity === 'common' ? '白'
          : before?.rarity === 'magic' ? '蓝'
            : before?.rarity === 'rare' ? '黄' : '';
        const n = yield_ && before && (before.rarity === 'common' || before.rarity === 'magic' || before.rarity === 'rare')
          ? yield_[before.rarity] : 0;
        applyEquipment();
        persistCharacter();
        return {
          ok: true,
          present: {
            sfx: 'pickup',
            banner: n > 0 ? `拆解 +${n} ${tierLabel}` : '拆解完成',
            color: '#c8a84e',
          },
        };
      },
      onReroll: (index) => {
        const res = character.dispatch({ op: 'reroll-bag', index });
        if (!res.ok) { craftFailBanner(res.reason); return { ok: false }; }
        const next = character.snapshot().bag[index]?.item;
        applyEquipment();
        persistCharacter();
        return {
          ok: true,
          present: {
            sfx: 'equip',
            banner: next ? `重铸：${next.name}` : '重铸完成',
            color: '#88ccff',
          },
        };
      },
      onFuse: (indices) => {
        const res = character.dispatch({
          op: 'fuse-bag',
          indices: [indices[0], indices[1], indices[2]],
        });
        if (!res.ok) { craftFailBanner(res.reason); return { ok: false }; }
        const dest = Math.min(indices[0], indices[1], indices[2]);
        const fused = character.snapshot().bag[dest]?.item;
        applyEquipment();
        persistCharacter();
        return {
          ok: true,
          present: {
            sfx: 'equip',
            banner: fused ? `合成：${fused.name}` : '合成完成',
            color: '#ffd066',
          },
        };
      },
      onPresent: (payload) => {
        sfx.play(payload.sfx);
        hud.banner(payload.banner, payload.color, 1200);
      },
      showNotification: (text, color) => { hud.banner(text, color ?? '#ffd066', 1200); },
      onClose: () => { uiLayers.close('craft'); },
    }, uiMount);

    uiLayers.register('inventory', { show: () => inv.show(), hide: () => inv.hide() });
    // N-Stash: dual-open pair surface — one logical owner over two panels
    // (stash left + inventory right). show refreshes both, then displays both;
    // hide closes both at once. Manager behavior is unchanged.
    uiLayers.register('stash', {
      show: () => { applyEquipment(); stashUI.show(); inv.show(); },
      hide: () => { stashUI.hide(); inv.hide(); },
    });
    uiLayers.register('skills', { show: () => skillPanel.show(), hide: () => skillPanel.hide() });
    uiLayers.register('settings', { show: () => rs.open(), hide: () => rs.close() });
    uiLayers.register('character', {
      show: () => { refreshCharacterPanel(); charPanel.show(); },
      hide: () => charPanel.hide(),
    });
    uiLayers.register('dialogue', {
      show: () => { /* show() via dialogueUi.show(node) */ },
      hide: () => dialogueUi.close(),
    });
    uiLayers.register('quests', {
      show: () => questLog.setOpen(true),
      hide: () => questLog.setOpen(false),
    });
    uiLayers.register('craft', { show: () => cube.open(), hide: () => cube.close() });
    // Cutscene surface is a no-op — chrome is driven per-frame from the update
    // loop; registration exists for exclusivity + the input-block funnel.
    uiLayers.register('cutscene', { show: () => {}, hide: () => {} });
    if (queuedCampIntro) {
      queuedCampIntro = false;
      playCutscene(buildCampIntro());
    }
    refreshQuestLog();
    refreshCharacterPanel();
    onCleanup(() => {
      // ■ Stop mid-shot: restore camera/input/UI/world exactly once (before
      // closeAll), then tear down panel surfaces.
      endCutscene('stop');
      uiLayers.closeAll();
      dialogueUi.dispose();
      questLog.dispose();
      cube.dispose();
    });
    ((window as unknown as { __hf: Record<string, unknown> }).__hf).uiLayers = uiLayers;
    ((window as unknown as { __hf: Record<string, unknown> }).__hf).owners = () =>
      ownerLedger.snapshot(uiLayers.active());
    ((window as unknown as { __hf: Record<string, unknown> }).__hf).assertSingleOwners = () =>
      ownerLedger.assertSingleOwners(uiLayers.active(), HELLFORGE_UPDATE_SYSTEMS);
    // Dev/QA hooks: replay cinematics without replaying combat (browser walkthroughs).
    const hf = (window as unknown as { __hf: Record<string, unknown> }).__hf;
    hf.playCampIntro = () => playCutscene(buildCampIntro());
    /** Face CU only — uses live eye marker + facing. */
    hf.playFaceCu = () => {
      playCutscene(buildFinisherFaceCu({
        playerXZ: [state.px, state.pz],
        camera: camRig,
        faceXZ: [faceX, faceZ],
        headWorld: resolvePlayerEyeWorld(),
      }));
    };
    hf.playerEyeFocus = () => ({
      bone: playerEyeFocusBone || null,
      ent: playerEyeFocusEnt,
      world: resolvePlayerEyeWorld(),
    });
    /** Hero Shot → Face CU queue (same path as real finisher commit). */
    hf.playFinisherClimax = () => {
      startFinisherHeroShot([state.px + faceX * 4, state.pz + faceZ * 4]);
    };
    ((window as unknown as { __hf: Record<string, unknown> }).__hf).moveIntent = {
      get: () => moveIntent,
      clear: clearMoveIntent,
    };
    /** PR12 read-only nav debug surface (game-side; mirrors moveIntent). */
    ((window as unknown as { __hf: Record<string, unknown> }).__hf).nav = {
      get position() { return [state.px, state.pz] as const; },
      get path() { return followPath.map((p) => [p[0], p[1]] as const); },
      get followIdx() { return followIdx; },
      get stuck() { return navStuckCount; },
      get lastPath() { return lastNavPath.map((p) => [p[0], p[1]] as const); },
    };

    const toggleMajorPanel = (panel: MajorPanel): void => {
      if (uiLayers.active() === panel) uiLayers.close(panel);
      else uiLayers.open(panel);
    };

    // ── input ─────────────────────────────────────────────────────────────
    ((window as unknown as { __hf: Record<string, unknown> }).__hf).keys = keys;
    // Every host-page / global listener below is registered as a named handler
    // and immediately paired with an onCleanup that removes it, so ■ Stop leaves
    // no dangling listeners on window / document / the persistent #app canvas.
    // Capture phase so we see WASD even if a Studio bubble handler stopPropagates.
    const focusPlayCanvas = (): void => {
      if (!canvas.hasAttribute('tabindex')) canvas.setAttribute('tabindex', '0');
      // Blur Studio chat / leftover shell buttons so key events are not eaten
      // by a contenteditable that stayed focused after 「进入游戏」.
      if (document.activeElement instanceof HTMLElement && document.activeElement !== canvas) {
        document.activeElement.blur();
      }
      canvas.focus({ preventScroll: true });
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (!inGame) return;
      if (keys[e.code]) return;        // repeat → no edge action
      keys[e.code] = true;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
        e.preventDefault();
      }
      // PR2a: Space dodge (edge trigger). Cast commit locks start (L3).
      if (
        e.code === 'Space'
        && !player.dead
        && camMode === 'arpg'
        && !worldInputBlocked
        && !cutsceneBlocksChromeKey(uiLayers.active())
      ) {
        const castingLocked = performance.now() < state.oneShotUntil || skills.isFinisherInputLocked();
        const aim = aimDir();
        const dirX = Math.hypot(aim.x, aim.z) > 0.01 ? aim.x : faceX;
        const dirZ = Math.hypot(aim.x, aim.z) > 0.01 ? aim.z : faceZ;
        const next = tryStartDodge({
          state: dodgeState,
          x: state.px,
          z: state.pz,
          dirX,
          dirZ,
          castingLocked,
        });
        if (next.phase === 'buildup' && dodgeState.phase === 'idle') {
          dodgeState = next;
          clearMoveIntent();
          faceX = next.dirX;
          faceZ = next.dirZ;
          fx.playEffect(COMBAT_EFFECT_DEFS.dodge, state.px, 0.2, state.pz);
          // Roll at its own pace, played to completion (flip peaks as the
          // movement window ends; landing runs past the state window).
          // Cancels (cast/move/WASD) and hits cut it via oneShotUntil = 0;
          // post-roll movement yields the tail via the locomotion branch.
          playOnce('dodge', DODGE_CLIP_RATE);
        }
      }
      // Cutscene owns UI + world input — only Esc (skip) may steal ownership.
      if (!cutsceneBlocksChromeKey(uiLayers.active())) {
        if (e.code === 'KeyB') {
          automap.collapseExpanded();
          applyEquipment();
          // 营地 B = 仓库双开 (stash+inventory pair); 荒野/地牢 B = 背包 (unchanged).
          toggleMajorPanel(area === 'camp' ? 'stash' : 'inventory');
        }
        if (e.code === 'KeyI') {
          automap.collapseExpanded();
          applyEquipment();
          toggleMajorPanel('inventory');
        }
        if (e.code === 'KeyF') {
          automap.collapseExpanded();
          toggleMajorPanel('craft');
        }
        if (e.code === 'KeyK') {
          automap.collapseExpanded();
          toggleMajorPanel('skills');
        }
        if (e.code === 'KeyQ') {
          automap.collapseExpanded();
          refreshQuestLog();
          toggleMajorPanel('quests');
        }
        if (e.code === 'KeyC') {
          automap.collapseExpanded();
          refreshCharacterPanel();
          toggleMajorPanel('character');
        }
        if (e.code === 'F10') {
          e.preventDefault();
          automap.collapseExpanded();
          toggleMajorPanel('settings');
        }
        if (e.code === 'Tab') {
          e.preventDefault();
          uiLayers.closeAll();
          automap.toggle();
        }
        if (e.code === 'KeyV') {
          // Spec §6.2: showcase only in Cinderwatch; force arpg before leave.
          if (camMode === 'arpg') {
            if (area === 'camp') {
              // Keep arpgZoomDistance as the pre-probe desired arm (not contracted).
              beginCameraMode('showcase');
              rs.applyCamera();
            }
          } else {
            beginCameraMode('arpg');
            rs.applyCamera();
          }
        }
      }
      if (!worldInputBlocked) {
        if (e.code === 'Digit1') selectHotbarSlot(0);
        if (e.code === 'Digit2') selectHotbarSlot(1);
        if (e.code === 'Digit3') selectHotbarSlot(2);
        if (e.code === 'Digit4') selectHotbarSlot(3);
        if (e.code === 'Digit5') usePotion('life');
        if (e.code === 'Digit6') usePotion('mana');
      }
      if (e.code === 'KeyR' && player.dead) {
        const failedAreaId =
          area === 'den' ? 'slagdeep-hollow' as const
            : area === 'wild' ? 'ashen-reach' as const
              : 'cinderwatch' as const;
        // Ensure combat-run holds the failed area's derived seed before reset.
        if (combatRun.snapshot().areaId !== failedAreaId) {
          combatRun.dispatch({
            op: 'enter',
            areaId: failedAreaId,
            characterId: character.snapshot().identity.id,
            questId: PURGE_QUEST_ID,
          });
        }
        const encounterResetters: CombatTransientResetters = {
          encounters: {
            clear: () => { monsters.clearAll(); },
            reset: (areaId, seed) => {
              monsters.clearAll();
              if (areaId === 'slagdeep-hollow') {
                denTotal = 0;
                resetRoomEventState(roomEvents);
                disposeVaultCard?.();
                disposeVaultCard = null;
                for (const s of dungeon.monsterSpawns) {
                  if (monsters.spawn(s.kind, s.x, s.z, 'den')) denTotal++;
                }
              } else if (areaId === 'ashen-reach') {
                const markers = ashenLayout.encounterMarkers ?? [];
                for (const pick of chooseSeededEncounters(markers, seed)) {
                  if (!inCamp(pick.pos[0], pick.pos[1]) && walkableAt(pick.pos[0], pick.pos[1])) {
                    monsters.spawn(pick.kind, pick.pos[0], pick.pos[1], 'wild');
                  }
                }
              }
            },
          },
          enemyAttacks: { clear: () => monsters.clearEnemyAttacks() },
          playerSkills: { clearProjectilesAndCooldowns: () => skills.clearProjectilesAndCooldowns() },
          loot: { clearGroundDrops: () => loot.clearGroundDrops() },
          fx: { clearTransient: () => fx.clearTransient() },
        };
        resetCombatRun({
          failedAreaId,
          character,
          run: combatRun,
          runtime: player,
          resetters: encounterResetters,
          returnToCamp: () => {
            const t = resolveAreaTransition('cinderwatch', 'camp-center', {
              characterId: character.snapshot().identity.id,
            });
            state.px = t.playerPos[0];
            state.pz = t.playerPos[1];
            enterArea('camp');
            return {
              areaId: t.areaId,
              entryId: t.entryId,
              playerPos: t.playerPos,
            };
          },
        });
        persistCharacter();
        hud.showDeath(false);
        hud.setOrbs(player.hp, player.maxHp, player.mana, player.maxMana);
        camMode = 'arpg';
        camBlend = null;
        camRig = makeArpgAtPlayer();
        hud.setShowcaseReduced(false);
        rs.applyCamera();
        state.oneShotUntil = 0;
        swapClip('idle');
        refreshQuest();
      }
      if (e.key === 'Escape') {
        if (cutscene) {
          if (cutscene.script.skippable) endCutscene('skip');
          return;
        }
        if (automap.isExpanded()) { automap.collapseExpanded(); return; }
        if (uiLayers.active() !== null) { uiLayers.closeAll(); return; }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown, true));

    const onKeyUp = (e: KeyboardEvent) => { keys[e.code] = false; };
    window.addEventListener('keyup', onKeyUp, true);
    onCleanup(() => window.removeEventListener('keyup', onKeyUp, true));

    // Blurring the tab mid-press leaves keys stuck down (no matching keyup).
    const clearHeldKeys = () => { for (const code of Object.keys(keys)) keys[code] = false; };
    const onVisibilityClear = () => { if (document.hidden) clearHeldKeys(); };
    window.addEventListener('blur', clearHeldKeys);
    document.addEventListener('visibilitychange', onVisibilityClear);
    onCleanup(() => {
      window.removeEventListener('blur', clearHeldKeys);
      document.removeEventListener('visibilitychange', onVisibilityClear);
    });

    const onContextMenu = (e: MouseEvent) => e.preventDefault();
    canvas.addEventListener('contextmenu', onContextMenu);
    onCleanup(() => canvas.removeEventListener('contextmenu', onContextMenu));

    // LMB = move / target; RMB = cast (arpg) or orbit drag (showcase).
    const onMouseDown = (e: MouseEvent) => {
      if (!inGame) return;
      focusPlayCanvas();
      if (player.dead || worldInputBlocked) return;
      if (camMode === 'showcase') {
        if (e.button === 2) {
          e.preventDefault();
          orbitDragging = true;
          lastOrbitMx = e.clientX;
          lastOrbitMy = e.clientY;
        }
        return; // no combat / loot / entrance clicks in showcase
      }
      if (e.button === 2) {
        e.preventDefault();
        tryCastSelectedHotbar();
        return;
      }
      if (e.button !== 0) return;
      // L3/L5: click-move blocked during dodge buildup/movement or finisher windup.
      if (!dodgeAllowsSkillOrMove(dodgeState) || skills.isFinisherInputLocked()) return;
      const hit = aimOnGround(
        camRig, mouseX, mouseY, aspect, canvas.clientWidth, canvas.clientHeight,
      );
      if (!hit) return;
      // L3 roll-cancel: committed click-move during late recover aborts + arms CD.
      rollCancel();
      const world: readonly [number, number] = [hit.x, hit.z];
      const picked = interactions.pickAt(world, CLICK_PICK_R);
      if (picked) {
        setMoveIntent(reduceIntent(moveIntent, { op: 'set-target', target: picked }));
      } else {
        setMoveIntent(reduceIntent(moveIntent, { op: 'set-point', world }));
        // Forged magma chevron cue (move only — not on unit pick).
        fx.moveClickCue(hit.x, hit.z);
      }
    };
    canvas.addEventListener('mousedown', onMouseDown);
    onCleanup(() => canvas.removeEventListener('mousedown', onMouseDown));

    const onMouseUp = (e: MouseEvent) => {
      if (e.button === 2) orbitDragging = false;
    };
    window.addEventListener('mouseup', onMouseUp);
    onCleanup(() => window.removeEventListener('mouseup', onMouseUp));

    // Claim keyboard after shell hand-off (Enter-game button / chat composer
    // otherwise keep focus and Studio looks like WASD is dead).
    focusPlayCanvas();
    requestAnimationFrame(focusPlayCanvas);

    const onResize = () => {
      sizeCanvas();
      aspect = canvas.width / canvas.height;
      rs.applyCamera();
    };
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));

    // Mouse: aim tracking for ground unprojection; showcase RMB orbit (explicit).
    const onMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseX = e.clientX - rect.left;
      mouseY = e.clientY - rect.top;
      if (orbitDragging && camMode === 'showcase') {
        const dx = e.clientX - lastOrbitMx;
        const dy = e.clientY - lastOrbitMy;
        lastOrbitMx = e.clientX;
        lastOrbitMy = e.clientY;
        orbitYawAcc += dx * 0.005;
        orbitPitchAcc += dy * 0.0035;
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    onCleanup(() => window.removeEventListener('mousemove', onMouseMove));

    // Bounded ARPG zoom (10–14 m); pitch unchanged inside the rig.
    const onWheel = (e: WheelEvent) => {
      if (!inGame || camMode !== 'arpg' || worldInputBlocked) return;
      e.preventDefault();
      zoomDelta += clamp(e.deltaY * 0.01, -1.5, 1.5);
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    onCleanup(() => canvas.removeEventListener('wheel', onWheel));

    // ── main loop ─────────────────────────────────────────────────────────
    let hudTimer = 0;
    onCleanup(ownerLedger.trackSystem('hellforge-runtime-update'));
    world.addSystem(Update, { name: 'hellforge-runtime-update', queries: [], fn: () => {
      const dt = world.getResource(Time).delta;
      perfProbe.recordFrame(dt);
      perfProbe.observeFoldedDraws(readFoldedDraws(app));
      perfProbe.observePools({
        ...fx.debugCounts(),
      });
      if (!allowUpdateFrame(dt)) return;

      if (inGame) {
        noteMapDiscovery();
        automap.tick(dt);
      }

      // ── shell gate: preview-only frame until CharacterRecord hand-off ──
      if (!inGame) {
        if (witchAnimPlayer !== null && !state.paused) {
          if (state.currentClip !== 'idle') swapClip('idle');
          witchAnimBase = 1;
          world.set(witchAnimPlayer, AnimationPlayer, {
            speeds: new Float32Array([witchAnimBase]),
          });
        }
        // Face the preview camera (south of the witch, looking north).
        faceX = 0;
        faceZ = 1;
        {
          const yaw = Math.atan2(FACING_SIGN * faceX, FACING_SIGN * faceZ);
          const qy = quat.create();
          quat.fromAxisAngle(qy, [0, 1, 0], yaw);
          world.set(playerRig, Transform, {
            pos: [state.px, 0, state.pz],
            quat: [qy[0]!, qy[1]!, qy[2]!, qy[3]!],
            scale: [playerScale, playerScale, playerScale],
          });
        }
        world.set(playerLight, Transform, { pos: [state.px, 2.4, state.pz + 1.6] });
        if (skyLightDirty) { skyLightDirty = false; applyAreaLighting(area); }
        // Keep HDR sky progressing during Title (otherwise CharSelect would
        // inherit a half-ready skybox if the player confirms quickly).
        if (sky && sky.equirect && !skyPollStopped && !skyboxSpawned) {
          skyPollAccum += dt;
          if (skyPollAccum >= 0.25) {
            skyPollAccum = 0;
            const store = (app as unknown as { renderer?: { store?: { getCubemapStatus?: (h: EquirectHandle) => string | undefined } } })?.renderer?.store;
            const status = store?.getCubemapStatus?.(sky.equirect);
            if (status === 'ready') {
              sky.ibl = true;
              skyLightDirty = true;
              world.spawn({ component: SkyboxBackground, data: { equirect: sky.equirect, mode: SKYBOX_MODE_CUBEMAP } });
              skyboxSpawned = true;
              skyPollStopped = true;
              console.log('[hellforge] HDR sky ready (SkyboxBackground + IBL)');
            } else if (status === 'failed') {
              skyPollStopped = true;
              console.info('[hellforge] equirect projection failed — solid ambient + SKY_CLEAR');
            } else if (status === undefined && store?.getCubemapStatus === undefined) {
              sky.ibl = true;
              skyLightDirty = true;
              world.spawn({ component: SkyboxBackground, data: { equirect: sky.equirect, mode: SKYBOX_MODE_CUBEMAP } });
              skyboxSpawned = true;
              skyPollStopped = true;
              console.info('[hellforge] getCubemapStatus unreachable — spawned SkyboxBackground immediately');
            }
          }
        }
        if (shellPhase === 'charSelect' || shellPhase === 'charList') {
          const tx = state.px, ty = 1.15, tz = state.pz;
          const cx = tx + 2.0, cy = 1.85, cz = tz + 3.8;
          const dx = tx - cx, dy = ty - cy, dz = tz - cz;
          const yaw = Math.atan2(-dx, -dz);
          const pitch = Math.atan2(dy, Math.hypot(dx, dz));
          const qy = quat.create(); quat.fromAxisAngle(qy, [0, 1, 0], yaw);
          const qx = quat.create(); quat.fromAxisAngle(qx, [1, 0, 0], pitch);
          const cq = quat.create(); quat.multiply(cq, qy, qx);
          world.set(camera, Transform, {
            pos: [cx, cy, cz],
            quat: [cq[0]!, cq[1]!, cq[2]!, cq[3]!],
          });
        }
        return;
      }

      // Leaving camp forces arpg (Spec §6.2).
      if (camMode === 'showcase' && area !== 'camp') {
        beginCameraMode('arpg');
        camRig = makeArpgAtPlayer();
        camBlend = null;
        hud.setShowcaseReduced(false);
        rs.applyCamera();
      }

      // MovementIntent authority: WASD vector replaces point/target; panels clear.
      // Transition cover (zone card / fade) also freezes locomotion while black.
      const allowWorldMove = !worldInputBlocked && !uiTransition.coverUp();
      // PR2a dodge tick (walkability stepper) — before locomotion integrate.
      {
        const dodgeWalk = (x: number, z: number, radius: number) =>
          navigation.walkable([x, z], radius);
        // PR8 T5: wisp drips mid-roll — replay the dodge puff beat as the
        // movement phase crosses its 1/3 and 2/3 marks (kept minimal: at
        // most two extra puffs per roll, none on a blocked short roll).
        const prevMoveElapsed =
          dodgeState.phase === 'movement' ? dodgeState.phaseElapsed : 0;
        const dodged = tickDodge({
          state: dodgeState,
          dt: state.paused ? 0 : dt,
          x: state.px,
          z: state.pz,
          walkable: dodgeWalk,
        });
        dodgeState = dodged.state;
        state.px = dodged.x;
        state.pz = dodged.z;
        if (dodgeState.phase === 'movement') {
          for (const mark of [DODGE_MOVEMENT_S / 3, (DODGE_MOVEMENT_S * 2) / 3]) {
            if (prevMoveElapsed < mark && dodgeState.phaseElapsed >= mark) {
              fx.playEffect(combatBeat('dodge', ['puff']), dodged.x, 0.2, dodged.z);
            }
          }
        }
        // L3: only buildup+movement own facing / clear path intent.
        if (dodgeLocksTranslation(dodgeState)) {
          faceX = dodgeState.dirX;
          faceZ = dodgeState.dirZ;
          clearMoveIntent();
        }
        // L2: show invulnerable buff only during Movement i-frames.
        if (isDodgeInvulnerable(dodgeState)) {
          const remainMs = Math.max(
            50,
            (DODGE_MOVEMENT_S - dodgeState.phaseElapsed) * 1000,
          );
          buffDisplay.addBuff(
            'dodge-iframes',
            '★',
            '无敌',
            remainMs,
            '#cc9900',
            { invulnerable: true },
          );
        }
        buffDisplay.update(dt * 1000);
      }
      const allowLoco = allowWorldMove
        && dodgeAllowsSkillOrMove(dodgeState)
        && !skills.isFinisherInputLocked();
      const sprint = allowLoco && (!!keys['ShiftLeft'] || !!keys['ShiftRight']);
      const spd = (sprint ? SPRINT : SPEED) * moveMul * dt;
      let mvx = 0;
      let mvz = 0;

      if (allowLoco && !player.dead) {
        const vec = wasdVectorFromKeys(keys);
        if (vec) {
          // L3 roll-cancel: WASD during late recover aborts the roll.
          rollCancel();
          setMoveIntent(reduceIntent(moveIntent, { op: 'set-vector', x: vec.x, z: vec.z }));
          mvx = vec.x;
          mvz = vec.z;
        } else if (moveIntent.kind === 'vector') {
          setMoveIntent(reduceIntent(moveIntent, { op: 'release-vector' }));
        } else if (moveIntent.kind === 'point' || moveIntent.kind === 'target') {
          if (moveIntent.kind === 'target') {
            targetRepathAcc += dt;
            if (targetRepathAcc >= 0.25) {
              targetRepathAcc = 0;
              const resolved = interactions.resolve(moveIntent.target);
              if (resolved?.valid) {
                if (shouldRepathPursuit(lastRepathTarget, resolved.position, followPath.length === 0)) {
                  followPath = navigation.path([state.px, state.pz], resolved.position);
                  lastNavPath = followPath;
                  followIdx = 0;
                  lastRepathTarget = resolved.position;
                }
              }
            }
            const tick = tickTargetIntent(moveIntent, [state.px, state.pz], interactions);
            moveIntent = tick.intent;
            if (moveIntent.kind !== 'target') {
              followPath = [];
              followIdx = 0;
              lastRepathTarget = null;
            }
          }
          const step = followPathDirection(followPath, followIdx, state.px, state.pz, PATH_ARRIVE);
          followIdx = step.idx;
          if (!step.complete) {
            mvx = step.dirX;
            mvz = step.dirZ;
          }
          if (moveIntent.kind === 'point' && step.complete) {
            clearMoveIntent();
          }
        }
      } else if (
        (worldInputBlocked || !dodgeAllowsSkillOrMove(dodgeState) || skills.isFinisherInputLocked())
        && moveIntent.kind !== 'none'
      ) {
        clearMoveIntent();
      }

      // one-shot clip locks locomotion (attack cast roots the witch briefly)
      const oneShotActive = !state.paused && performance.now() < state.oneShotUntil;
      // Dodge owns translation in buildup+movement only (stepper already integrated).
      const dodgeOwnsMove = dodgeLocksTranslation(dodgeState);

      // integrate position — per-axis walkability so walls slide, not stick
      const len = Math.hypot(mvx, mvz);
      state.moving = !oneShotActive && !dodgeOwnsMove && !player.dead && len > 0;
      const prevPx = state.px;
      const prevPz = state.pz;
      if (state.moving) {
        faceX = mvx / len;
        faceZ = mvz / len;
        const slid = integratePerAxisSlide(state.px, state.pz, mvx, mvz, spd, walkableAt);
        state.px = slid.px;
        state.pz = slid.pz;
      }
      // Actual ground speed after collision slide (not key/sprint flags).
      const groundSpeed = Math.hypot(state.px - prevPx, state.pz - prevPz) / Math.max(dt, 1e-6);
      const isPathDriven = moveIntent.kind === 'point' || moveIntent.kind === 'target';

      // Stuck detection (PR12 T4): geometry-jam safety net for point/target intents.
      // Pause (don't reset) while attack/dodge/finisher root translation — otherwise
      // a one-shot cast looks like zero displacement and false-repaths/clears.
      if (isPathDriven && !player.dead) {
        const motionUnlocked = allowLoco && !oneShotActive && !dodgeOwnsMove && len > 0;
        if (motionUnlocked) {
          if (stuckOrigin == null) {
            stuckOrigin = [state.px, state.pz];
            stuckAcc = 0;
          } else {
            stuckAcc += dt;
            if (stuckAcc >= STUCK_WINDOW_SEC) {
              const disp = Math.hypot(state.px - stuckOrigin[0], state.pz - stuckOrigin[1]);
              if (disp < STUCK_DISPLACE_M) {
                if (!stuckRepathed && followPath.length > 0) {
                  const goal = moveIntent.kind === 'point'
                    ? moveIntent.world
                    : moveIntent.kind === 'target'
                      ? (interactions.resolve(moveIntent.target)?.position ?? null)
                      : null;
                  if (goal) {
                    followPath = navigation.path([state.px, state.pz], goal);
                    lastNavPath = followPath;
                    followIdx = 0;
                    if (moveIntent.kind === 'target') lastRepathTarget = goal;
                  }
                  stuckRepathed = true;
                } else {
                  navStuckCount += 1;
                  clearMoveIntent();
                }
              } else {
                // Healthy window — allow a future jam to try one repath again.
                stuckRepathed = false;
              }
              stuckOrigin = [state.px, state.pz];
              stuckAcc = 0;
            }
          }
        }
      } else {
        stuckAcc = 0;
        stuckOrigin = null;
        stuckRepathed = false;
      }

      // Roll follow-through yields to real movement: the dodge state machine
      // finished but the clip's stand-up tail still holds the one-shot lock —
      // actual ground speed swaps back to locomotion instead of sliding.
      if (oneShotActive && state.currentClip === 'dodge' && !isDodging(dodgeState) && groundSpeed > LOCOMOTION_IDLE_SPEED) {
        state.oneShotUntil = 0;
      }
      // animation state machine — locomotion from velocity; one-shots untouched
      if (!state.paused && !oneShotActive && !player.dead) {
        if (state.oneShotUntil !== 0) state.oneShotUntil = 0;
        const loco = selectLocomotionClip(groundSpeed, isPathDriven);
        swapClip(loco);
        if (loco === 'walk') {
          witchAnimBase = clamp(groundSpeed / ANIM_STRIDE_WALK, ANIM_SPEED_MIN, ANIM_SPEED_MAX);
        } else if (loco === 'run') {
          witchAnimBase = clamp(groundSpeed / ANIM_STRIDE_RUN, ANIM_SPEED_MIN, ANIM_SPEED_MAX);
        } else {
          witchAnimBase = 1;
        }
      }
      // fps-compensated speeds write, every frame (base × real-dt rate).
      if (witchAnimPlayer !== null) {
        world.set(witchAnimPlayer, AnimationPlayer, { speeds: new Float32Array([witchAnimBase]) });
      }

      // drive ONLY the player rig (witch parented under it)
      {
        const yaw = Math.atan2(FACING_SIGN * faceX, FACING_SIGN * faceZ);
        const qy = quat.create();
        quat.fromAxisAngle(qy, [0, 1, 0], yaw);
        world.set(playerRig, Transform, {
          pos: [state.px, 0, state.pz],
          quat: [qy[0]!, qy[1]!, qy[2]!, qy[3]!],
          scale: [playerScale, playerScale, playerScale],
        });
      }
      world.set(playerLight, Transform, { pos: [state.px, 2.4, state.pz + 1.6] });
      ambientFx.tick(dt, state.px, state.pz);
      world.set(shadowProxy, Transform, {
        pos: [state.px, 0.9, state.pz],
        scale: [0.42 * playerScale, 1.55 * playerScale, 0.32 * playerScale],
      });
      contactShadows.move(playerContact, state.px, state.pz, playerContactR);
      // ── lighting director tick ──
      // Sky upgrade resolved after boot → re-tint once for the current area.
      if (skyLightDirty) { skyLightDirty = false; applyAreaLighting(area); }
      // Roaming fixture points + den spots follow the player through the den.
      if (area === 'den') {
        torchSeatTimer -= dt;
        if (torchSeatTimer <= 0) { torchSeatTimer = 0.4; seatDenFixtures(); }
      }
      // Ember flicker: two incommensurate sines ≈ organic wobble, no RNG churn.
      flickT += dt;
      const flick = (ph: number): number => 0.86 + 0.14 * Math.sin(flickT * 9.7 + ph) * Math.sin(flickT * 5.3 + ph * 1.7);
      const fireMul = lightSettings.fireMul;
      world.set(campfireLight, PointLight, { intensity: campfireBase * fireMul * flick(0) });
      world.set(torchA, PointLight, { intensity: torchBaseA * fireMul * flick(2.1) });
      world.set(torchB, PointLight, { intensity: torchBaseB * fireMul * flick(4.4) });
      world.set(denSpotA, SpotLight, { intensity: spotBaseA * fireMul * flick(1.3) });
      world.set(denSpotB, SpotLight, { intensity: spotBaseB * fireMul * flick(3.7) });
      // Moon key is steady (no ember flicker); scales with sunMul like the directional.
      world.set(campMoonSpot, SpotLight, { intensity: moonBase * lightSettings.sunMul });
      // Poll equirect→cubemap status (throttled). Spawn SkyboxBackground only
      // after ready — earlier bind samples unready GPU memory (rainbow garbage).
      if (sky && sky.equirect && !skyPollStopped && !skyboxSpawned) {
        skyPollAccum += dt;
        if (skyPollAccum >= 0.25) {
          skyPollAccum = 0;
          const store = (app as unknown as { renderer?: { store?: { getCubemapStatus?: (h: EquirectHandle) => string | undefined } } })?.renderer?.store;
          const status = store?.getCubemapStatus?.(sky.equirect);
          if (status === 'ready') {
            sky.ibl = true;
            skyLightDirty = true;
            world.spawn({ component: SkyboxBackground, data: { equirect: sky.equirect, mode: SKYBOX_MODE_CUBEMAP } });
            skyboxSpawned = true;
            skyPollStopped = true;
            console.log('[hellforge] HDR sky ready (SkyboxBackground + IBL)');
          } else if (status === 'failed') {
            skyPollStopped = true;
            console.info('[hellforge] equirect projection failed — solid ambient + SKY_CLEAR');
          } else if (status === undefined && store?.getCubemapStatus === undefined) {
            // Host path cannot query status → spawn immediately and accept flash risk (R2).
            sky.ibl = true;
            skyLightDirty = true;
            world.spawn({ component: SkyboxBackground, data: { equirect: sky.equirect, mode: SKYBOX_MODE_CUBEMAP } });
            skyboxSpawned = true;
            skyPollStopped = true;
            console.info('[hellforge] getCubemapStatus unreachable — spawned SkyboxBackground immediately');
          }
        }
      }

      // ── game systems ──
      tickPlayer(player, dt);
      fx.tick(dt);
      const playerSafe = area !== 'den' && inCamp(state.px, state.pz);
      // PR4a T2: skip monsters.tick when active cinematic policy freezes AI
      // (Boss entrance/defeat + Hero Shot). Camp beats keep the world running.
      // skills.tick still runs so finisher damage at 0.4 s stays independent.
      if (!shouldFreezeAi(activeWorldPolicy())) {
        monsters.tick(dt, state.px, state.pz, playerSafe, walkableAt);
      }
      // Finisher telegraph: live preview while selected; commit freezes via SkillSystem.
      if (camMode === 'arpg' && !player.dead) {
        const snap = character.snapshot();
        const selected = snap.hotbar[snap.selectedHotbarSlot];
        if (selected === FINISHER_ID && skills.finisherPhase() === 'idle') {
          const g = groundAimXZ();
          if (g) skills.updateFinisherPreview(g[0], g[1]);
        } else if (skills.finisherPhase() === 'idle') {
          skills.clearFinisherPreview();
        }
      }
      skills.tick(dt, monsters);
      tickWildSpawner(dt);

      // loot pickups — disabled in showcase (Spec §6.2)
      if (camMode === 'arpg') {
        for (const ev of loot.tick(dt, state.px, state.pz, () => hasFreeCell(character.snapshot().bag as BagAnchor[]))) {
          applyPickupEvent(ev);
        }
      }

      // ── area transitions (portal pads) — disabled in showcase ──
      const dCave = Math.hypot(state.px - CAVE_MOUTH.x, state.pz - CAVE_MOUTH.z);
      const dExit = Math.hypot(state.px - DEN_EXIT.x, state.pz - DEN_EXIT.z);
      if (portalArmed && !player.dead && camMode === 'arpg') {
        if (area !== 'den' && dCave < 1.5) {
          if (!canEnterSlagdeep(character.snapshot().quests)) {
            hud.banner('深窟封锁 — 先与烬守者维拉交谈', '#ffb070', 2200);
            portalArmed = false;
          } else {
            // PR11 T4: gate on the lazy den load. Prefetch (first wild entry)
            // usually makes this instant; a slow first entry pays the remainder
            // behind the determinate transition cover, then teleports. The
            // teleport/zone-card/enterArea('den') sequence itself is unchanged.
            portalArmed = false;
            enterDenViaPortal();
          }
        } else if (area === 'den' && dExit < 1.5) {
          portalArmed = false;
          // Leave den — drop vault curse mul / dismiss card (once-fire state stays).
          roomEvents.curseActive = false;
          disposeVaultCard?.();
          disposeVaultCard = null;
          const transition = resolveAreaTransition('ashen-reach', 'cave-mouth', {
            characterId: character.snapshot().identity.id,
          });
          state.px = transition.playerPos[0];
          state.pz = transition.playerPos[1];
          camRig = snapCameraFocus(makeArpgAtPlayer(), [state.px, 0, state.pz]);
          rs.applyCamera();
          sfx.play('portal');
          const wildDef = getAreaDef('ashen-reach');
          void uiTransition.zoneCard(wildDef.displayName, {
            sub: wildDef.displayNameEn,
            tip: '返回烬守营地之路',
          });
          enterArea('wild');
        }
      }
      // PR11 T4: don't re-arm the pads while a den transition is still awaiting
      // its lazy load — portalArmed must stay false until doDenTeleport finishes.
      // Wild landing is ~4.24 from the cave mouth, so 3.5 re-armed instantly
      // and caused BGM ping-pong.
      if (!portalArmed && !denTransitioning && dCave > 6 && dExit > 6) portalArmed = true;
      // camp ⇄ wild label edge (same map, rect boundary)
      if (area !== 'den') {
        const nowCamp = inCamp(state.px, state.pz);
        if (nowCamp && area !== 'camp') enterArea('camp');
        else if (!nowCamp && area !== 'wild') enterArea('wild');
      }
      // portal ambience motes
      portalMoteTimer -= dt;
      if (portalMoteTimer <= 0) {
        portalMoteTimer = 0.5;
        if (area === 'den') fx.rise(DEN_EXIT.x, 0.15, DEN_EXIT.z, 'ice', 2, 1.1);
        else fx.rise(CAVE_MOUTH.x, 0.15, CAVE_MOUTH.z, 'fire', 2, 1.2);
      }

      // L4 B2 — slag-cursed vault enter/exit (DOM card once; mul while inside).
      if (area === 'den' && dungeon.encounters && camMode === 'arpg' && !player.dead) {
        const vaultEv = tickVaultPresence(
          roomEvents,
          dungeon.encounters,
          state.px - DUNGEON_ORIGIN.x,
          state.pz - DUNGEON_ORIGIN.z,
        );
        if (vaultEv?.kind === 'vault-enter' && vaultEv.showCard) {
          disposeVaultCard?.();
          disposeVaultCard = showVaultCurseCard(uiMount, {
            modifierLine: vaultEv.modifierLine,
            rewardLine: vaultEv.rewardLine,
          });
          sfx.play('quest');
        }
      }

      // ── quest objectives (ready only; rewards via Veyra turn-in) ──
      if (area === 'den' && questStatus() === 'active' && denTotal > 0) {
        if (denMinionAliveCount() === 0) {
          combatRun.dispatch({ op: 'mark-objective', id: 'den-minions-cleared' });
        }
        if (!monsters.boss()) {
          combatRun.dispatch({ op: 'mark-objective', id: 'slagdeep-boss-defeated' });
        }
        if (combatRun.objectivesMet()) {
          const ready = markQuestReady(character);
          if (ready.ok && ready.state.status === 'ready') {
            hud.banner('目标达成：返回营地向维拉交还任务', '#8aff9a', 3000);
            sfx.play('quest');
            persistCharacter();
            refreshQuest();
            refreshQuestLog();
          }
        }
      }
      const boss = monsters.boss();
      if (boss && area === 'den' && Math.hypot(boss.x - state.px, boss.z - state.pz) < 18) {
        hud.setBoss(MONSTERS[boss.kind].name, boss.hp, boss.maxHp);
        // PR4a T3 — Boss entrance once on first threat range. If finisher climax
        // already owns the stage (skills.tick runs before this check), consume
        // without play so entrance never queues behind Hero Shot / face CU.
        const entrance = takeBossEntranceTrigger({
          alreadyPlayed: bossEntrancePlayed,
          finisherClimaxBusy: isFinisherClimaxBusy(),
        });
        bossEntrancePlayed = entrance.played;
        if (entrance.shouldPlay) {
          try {
            playCutscene(buildBossEntranceBeat({
              camera: camRig,
              playerXZ: [state.px, state.pz],
              bossXZ: [boss.x, boss.z],
            }));
          } catch (error) {
            console.error('[hellforge] boss-entrance beat failed:', error);
            endCutscene('error');
          }
        }
      } else {
        hud.setBoss(null);
      }

      // Target readout: pursue lock, else nearest living monster in range.
      {
        let targetVm: TargetViewModel | null = null;
        if (camMode === 'arpg' && !player.dead) {
          let m: Monster | null = null;
          if (moveIntent.kind === 'target' && moveIntent.target.kind === 'monster') {
            m = monsters.byId(moveIntent.target.id);
          }
          if (!m) m = monsters.nearest(state.px, state.pz, 14);
          if (m) {
            const def = MONSTERS[m.kind];
            targetVm = { name: def.name, level: def.level, hp: m.hp, maxHp: m.maxHp };
          }
        }
        hud.setTarget(targetVm);
      }

      // HUD refresh (orbs every frame are cheap; skill bar at 8 Hz)
      hud.setOrbs(player.hp, player.maxHp, player.mana, player.maxMana);
      {
        const snap = character.snapshot();
        hud.setXp(snap.level, snap.xp, xpForLevel(snap.level));
      }
      hudTimer -= dt;
      if (hudTimer <= 0) {
        hudTimer = 0.12;
        refreshSkillBar();
        if (skillPanel.isOpen()) skillPanel.refresh();
        if (charPanel.isOpen()) refreshCharacterPanel();
        if (area === 'den') refreshQuest();
      }

      // ── camera (rig owns pose + FOV; applyCamera owns Camera component) ──
      const prevFov = camRig.verticalFovRad;
      if (cutscene) {
        // Timeline owns the rig while a cutscene plays (follow/zoom suspended).
        pendingShake = [0, 0, 0];
        orbitYawAcc = 0;
        orbitPitchAcc = 0;
        let frameDone = false;
        try {
          const frame = sampleCutscene(
            cutscene.script,
            (performance.now() - cutscene.startMs) / 1000,
          );
          cutsceneUi.setLetterbox(frame.letterbox);
          cutsceneUi.setFade(frame.fade);
          cutsceneUi.setCaption(frame.caption);
          camRig = frame.camera;
          frameDone = frame.done;
        } catch (error) {
          console.error('[hellforge] cutscene frame failed:', error);
          endCutscene('error');
        }
        if (frameDone) endCutscene('complete');
      } else {
      const shakeImpulse = pendingShake;
      pendingShake = [0, 0, 0];
      const orbitYaw = orbitYawAcc;
      const orbitPitch = orbitPitchAcc;
      orbitYawAcc = 0;
      orbitPitchAcc = 0;
      const arpgZoom = camMode === 'arpg' ? zoomDelta : 0;
      const camInput = {
        target: [state.px, 0, state.pz] as const,
        dt,
        zoomDelta: arpgZoom,
        shakeImpulse,
        orbitDeltaYaw: orbitYaw,
        orbitDeltaPitch: orbitPitch,
        // Showcase uses fixed arm; ARPG keeps wheel zoom as desired (probe may shorten).
        desiredDistance: camMode === 'showcase' ? SHOWCASE_DISTANCE : arpgZoomDistance,
        // Camp + den + antechamber occluders (ARPG + showcase share one probe).
        probe: campCameraProbe,
      };
      zoomDelta = 0;
      let ideal: CameraRigState;
      if (camMode === 'showcase') {
        const facingYaw = Math.atan2(-faceX, -faceZ);
        ideal = updateShowcaseCamera(camRig, camInput, facingYaw);
      } else {
        ideal = updateArpgCamera(camRig, camInput, arpgPreset);
        arpgZoomDistance = Math.min(
          ARPG_DISTANCE_MAX,
          Math.max(ARPG_DISTANCE_MIN, arpgZoomDistance + arpgZoom),
        );
      }
      if (camBlend) {
        camBlend.elapsed += dt;
        const w = cameraBlendWeight(camBlend.elapsed, CAMERA_MODE_BLEND_S);
        camRig = lerpCameraRig(camBlend.from, ideal, w, camBlend.toMode);
        if (w >= 1) {
          camRig = { ...ideal, mode: camBlend.toMode };
          camBlend = null;
        }
      } else {
        camRig = ideal;
      }
      }
      if (camRig.verticalFovRad !== prevFov) rs.applyCamera();
      const cq = cameraQuat(camRig.yaw, camRig.pitch);
      world.set(camera, Transform, {
        pos: [camRig.eye[0]!, camRig.eye[1]!, camRig.eye[2]!],
        quat: [cq[0]!, cq[1]!, cq[2]!, cq[3]!],
      });
      // Foreground fade when contraction still leaves the player occluded.
      if (fadeEntries.length > 0) {
        const needsFade = selectBlockersNeedingFade(fadeEntries, {
          eye: camRig.eye,
          playerPos: [state.px, 1.0, state.pz],
        });
        campFadeDriver.update(needsFade, dt);
      }
    }});

  }

  function startRuntime(selectedRecord: CharacterRecord | null): Promise<void> {
    if (runtimeStart) return runtimeStart;
    runtimeStart = initializeRuntime(selectedRecord);
    return runtimeStart;
  }

  if (!startedInDen) {
    // Title returns before gameplay camera exists — keep a stub so the host
    // renderer does not fault with render-system-no-camera over the shell.
    // Title/boot stub FOV — gameplay replaces this with CameraRigState FOV.
    const BOOT_FOV = Math.PI / 2.4;
    bootCamera = world.spawn(
      { component: Name, data: { value: 'BootCamera' } },
      { component: Transform, data: { pos: [0, 12, 18] } },
      { component: Camera, data: perspective({ fov: BOOT_FOV, aspect, near: 0.05, far: 200 }) },
    ).unwrap() as EntityHandle;
    onCleanup(() => {
      if (bootCamera !== null) {
        world.despawn(bootCamera);
        bootCamera = null;
      }
    });

    // Title can open the same settings panel before gameplay camera exists.
    titleRs = installRenderSettings({
      mount: uiMount,
      world,
      camera: bootCamera,
      getAspect: () => aspect,
      proj: { getVerticalFovRad: () => BOOT_FOV, near: 0.05, far: 200 },
      onLighting: () => {},
      onParticles: () => {},
      onDisplay: (s) => { applyDisplaySettings(s); },
      onAudio: (s) => { applyAudioSettings(s); },
      onAtmosphere: (s) => {
        atmosphereApi?.setParams({
          vignette: s.vignette,
          haze: s.haze,
          atmoTemp: s.atmoTemp,
        });
      },
    });
    onCleanup(() => {
      titleRs?.dispose();
      titleRs = null;
    });

    if (assets) {
      heroPreview = installHeroPreview({
        world,
        assets,
        camera: bootCamera,
        getAspect: () => aspect,
        proj: { fov: BOOT_FOV, near: 0.05, far: 200 },
      });
      onCleanup(() => {
        heroPreview?.dispose();
        heroPreview = null;
      });
    }

    // N1: click-gate → optional PV → title shell. BGM held so the first gesture
    // arms audio for PV (or missing-asset skip) before camp music.
    const installTitleShell = (): void => {
      const selection = createCharacterSelectionGate();
      const acceptSelection = (record: CharacterRecord): void => {
        if (!selection.select(record)) return;
        heroPreview?.hide();
        dimAtmosphereForPreview(false);
        charSelect?.hide();
        charList?.hide();
        titleRs?.close();
        shell!.showLoading('正在加载角色与场景…');
      };
      const dimAtmosphereForPreview = (on: boolean): void => {
        // Keep CharSelect readable — drive HDR pass params, never CSS overlays (L3).
        const s = titleRs?.get();
        atmosphereApi?.setPreviewDim(on, s
          ? { vignette: s.vignette, haze: s.haze, atmoTemp: s.atmoTemp }
          : undefined);
      };
      const previewClassId = (classId: ClassId): ClassId =>
        (CLASS_DEFS[classId] ? classId : 'sorceress');
      // Shell navigation fades through black (ui-transition.ts; cover sits above
      // the shell z-200). Loading cover handles the charSelected→inGame leg.
      const fadeNav = (fn: () => void): void => {
        void uiTransition.throughBlack(fn, { fadeMs: 260, holdMs: 60 });
      };
      const openCharSelect = (): void => {
        charList?.hide();
        titleRs?.close();
        dimAtmosphereForPreview(true);
        shell!.goTo('charSelect');
        shellPhase = 'charSelect';
        charSelect!.show();
      };
      const openCharList = (): void => {
        charSelect?.hide();
        titleRs?.close();
        dimAtmosphereForPreview(true);
        shell!.goTo('charList');
        shellPhase = 'charList';
        charList!.show();
      };
      shell = installShell(uiMount, {
        onNewGame: () => {
          if (listCharacters().length >= MAX_CHARACTERS) {
            fadeNav(openCharList);
            return;
          }
          fadeNav(openCharSelect);
        },
        onContinue: () => {
          fadeNav(openCharList);
        },
        onSettings: () => { titleRs?.open(); },
        hasSave: () => listCharacters().length > 0,
      });
      charSelect = installCharSelect(shell.root, {
        onConfirm: acceptSelection,
        onBack: () => {
          fadeNav(() => {
            heroPreview?.hide();
            dimAtmosphereForPreview(false);
            charSelect!.hide();
            shell!.goTo('title');
            shellPhase = 'title';
          });
        },
        onClassChange: (classId: ClassId) => {
          void heroPreview?.show(previewClassId(classId));
        },
      });
      charSelect.hide();
      charList = installCharList(shell.root, {
        onEnterGame: acceptSelection,
        onNewChar: () => { fadeNav(openCharSelect); },
        onBack: () => {
          fadeNav(() => {
            heroPreview?.hide();
            dimAtmosphereForPreview(false);
            charList!.hide();
            shell!.goTo('title');
            shellPhase = 'title';
          });
        },
        onSelectionChange: (rec) => {
          if (!rec) {
            heroPreview?.hide();
            return;
          }
          void heroPreview?.show(previewClassId(rec.classId));
        },
      });
      charList.hide();
      // Title particles uncapped; CharSelect/CharList drive 360° idle preview yaw.
      onCleanup(ownerLedger.trackSystem('hellforge-shell-update'));
      world.addSystem(Update, { name: 'hellforge-shell-update', queries: [], fn: () => {
        const dt = world.getResource(Time).delta;
        shell?.tick(dt);
        if (shellPhase === 'charSelect' || shellPhase === 'charList') heroPreview?.tick(dt);
      }});
      onCleanup(() => {
        charSelect?.dispose();
        charList?.dispose();
        shell?.dispose();
      });
      void selection.promise
        .then((record) => startRuntime(record))
        .catch((error) => {
          failBoot('游戏初始化失败', error);
        });
    };

    bgm.holdForIntro();
    const intro = installIntroVideo(uiMount, {
      onComplete: () => {
        intro.dispose();
        bgm.releaseIntroHold();
        installTitleShell();
      },
    });
    onCleanup(() => intro.dispose());
    return;
  }

  try {
    await startRuntime(null);
  } catch (error) {
    failBoot('游戏初始化失败', error);
  }
}
