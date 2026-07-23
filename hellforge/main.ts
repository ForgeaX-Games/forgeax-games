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
  Camera,
  ChildOf,
  DirectionalLight,
  Materials,
  MeshFilter,
  MeshRenderer,
  Name,
  PointLight,
  PointLightShadow,
  SceneInstance,
  Skin,
  Skylight,
  SkyboxBackground,
  SKYBOX_MODE_CUBEMAP,
  Transform,
  perspective,
  quat,
  type MaterialAsset,
} from '@forgeax/engine-runtime';
import {
  HANDLE_CUBE,
  HANDLE_QUAD,
} from '@forgeax/engine-assets-runtime';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { createQueryState, queryRun, Entity, Time, Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
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
import { createPerfProbe, readFoldedDraws } from './src/perf-probe';
import { createOwnerLedger, HELLFORGE_UPDATE_SYSTEMS } from './src/owner-ledger';
import { cutsceneBlocksChromeKey } from './src/cutscene-input';
import { MonsterManager, MONSTERS, type Monster } from './src/monsters';
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
import { selectLocomotionClip } from './src/locomotion';
import {
  abortDodge,
  cancelDodgeForSkillOrMove,
  createDodgeState,
  DODGE_MOVEMENT_S,
  dodgeAllowsSkillOrMove,
  dodgeHitReactionAborts,
  dodgeLocksTranslation,
  isDodgeInvulnerable,
  tickDodge,
  tryStartDodge,
  type DodgeState,
} from './src/dodge';
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
import { Sfx } from './src/sfx';
import {
  rollDrop,
  RARITY_META,
  type Equipment, type ItemInstance,
} from './src/items';
import { installInventory } from './src/inventory-ui';
import {
  installRenderSettings,
  loadRenderSettings,
  type RenderSettings,
  type RenderSettingsApi,
} from './src/render-settings';
import { AmbientFx } from './src/ambient-fx';
import { installShell, type ShellHandle } from './src/shell';
import { installCharSelect, type CharSelectHandle } from './src/char-select';
import { installCharList, type CharListHandle } from './src/char-list';
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
import { installAutomap } from './src/automap';
import { createUiLayerManager, type MajorPanel } from './src/ui-layer-manager';
import { installFatalOverlay } from './src/fatal-overlay';
import { ensureUiStyles } from './src/ui-styles';
import { installUiCursors } from './src/ui-cursors';
import { installUiTooltip } from './src/ui-tooltip';
import { installUiTransition } from './src/ui-transition';
import { installCutsceneUi } from './src/cutscene-ui';
import {
  buildFinisherHeroShot,
  sampleCutscene,
  type CutsceneScript,
} from './src/cutscene';
import {
  createSeamRestoreGuard,
  isFinisherHeroShotActive,
  type SeamRestoreGuard,
} from './src/hero-shot-seam';
import { ASHEN_REACH_BOUNDS, installWildTerrain } from './src/wild-terrain';
import { bgmPhaseForMusic, installBgm, type BgmHandle } from './src/bgm';
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
      if (!ephemeral) {
        character.dispatch({ op: 'touch' });
        flushReturnToTitle(character.snapshot());
      } else {
        flushCharacterSaves();
      }
      uninstallSaveHooks();
    });
    const hero = getHeroDef(character.snapshot().identity.classId);
    const playerScale = hero.scale;

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
    try {
      if (!assets) throw new Error('no asset registry');
      const sceneGuid = AssetGuid.parse(hero.gltf.scene);
      if (!sceneGuid.ok) throw new Error('witch scene guid parse');
      // engine e53f4616: `loadByGuid` returns the PAYLOAD. `instantiate` wants a
      // Handle, so mint one via `world.allocSharedRef`; clip handles passed to
      // AnimationPlayer are likewise minted from each clip payload, and the clip
      // duration is read straight off the payload (no more `assets.get`).
      const sceneRes = await assets.loadByGuid<SceneAsset>(sceneGuid.value);
      if (!sceneRes.ok) throw new Error('witch scene loadByGuid: ' + ((sceneRes.error as { code?: string }).code ?? '?'));
      for (const def of hero.gltf.clips) {
        const g = AssetGuid.parse(def.guid);
        if (!g.ok) { console.warn('[hellforge] clip guid parse:', def.name); continue; }
        const r = await assets.loadByGuid<AnimationClip>(g.value);
        if (!r.ok) { console.warn('[hellforge] clip loadByGuid:', def.name, (r.error as { code?: string }).code); continue; }
        const clipHandle = world.allocSharedRef<'AnimationClip', AnimationClip>('AnimationClip', r.value);
        clipHandles.set(def.name, clipHandle);
        // Record clip duration so one-shot clips (attack/hit/death) can auto-end.
        clipDur.set(def.name, (r.value as unknown as { duration: number }).duration);
      }
      // Parent the witch scene under playerRig (3rd arg) so the rig drives her.
      const sceneHandle = world.allocSharedRef<'SceneAsset', SceneAsset>('SceneAsset', sceneRes.value);
      const instRes = assets.instantiate<SceneAsset>(sceneHandle, world, playerRig);
      if (!instRes.ok) throw new Error('witch instantiate: ' + ((instRes.error as { code?: string }).code ?? '?'));
      witchRoot = instRes.value as EntityHandle;
      const sceneInst = world.get(witchRoot, SceneInstance);
      if (sceneInst.ok) {
        // Find the Skin entity in the spawned hierarchy (= same idiom as hello-skin).
        // Only needed to drive the AnimationPlayer clip, never to move her.
        for (let i = 0; i < sceneInst.value.mapping.length; i++) {
          const ent = sceneInst.value.mapping[i];
          if (ent === undefined || ent === 0) continue;
          if (world.get(ent as EntityHandle, Skin).ok) {
            witchSkinEnt = ent as EntityHandle;
            break;
          }
        }
      }
      if (witchSkinEnt !== null && clipHandles.has('idle')) {
        world.addComponent(witchSkinEnt, {
          component: AnimationPlayer,
          data: { clips: [clipHandles.get('idle')!], times: new Float32Array([0]), weights: new Float32Array([1]), speeds: new Float32Array([1]), paused: false, looping: true },
        });
        // ── engine skinning-contract fix ──────────────────────────────────
        // default-standard-pbr-skin.wgsl computes the final vertex as
        //   world = meshNode.worldFromLocal * (palette * pos)
        // and palette already = jointWorld * IBM (full world, incl. ancestors).
        // The skinned mesh node (CH_Witch_001) is a ChildOf the Armature, so it
        // shares every ancestor with the joints — any rig transform would be
        // applied TWICE (once via meshNode.worldFromLocal, once via the palette).
        // The engine's contract (glTF skinning) is that the mesh node sits at
        // world identity and the palette carries everything. We enforce that by
        // detaching the mesh node from the Armature subtree and pinning its local
        // transform to identity. Movement then lives purely in the palette, which
        // the playerRig drives through the joints — single, correct transform.
        world.removeComponent(witchSkinEnt, ChildOf);
        world.set(witchSkinEnt, Transform, {
          pos: [0, 0, 0],
          quat: [0, 0, 0, 1],
          scale: [1, 1, 1],
        });
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
      const qState = createQueryState({ with: [Name, Transform, Entity] as const });
      queryRun(qState, world, (bundle) => {
        const ents = bundle.Entity.self;
        for (let i = 0; i < ents.length; i++) {
          const e = ents[i] as EntityHandle | undefined;
          if (e === undefined) continue;
          const n = world.get(e, Name);
          if (!n.ok || n.value.value !== 'NpcVeyraAnchor') continue;
          const t = world.get(e, Transform);
          if (!t.ok) continue;
          anchorEnt = e;
          anchorPos = [t.value.pos[0]!, t.value.pos[1]!, t.value.pos[2]!];
          if (t.value.quat) {
            anchorQuat = [t.value.quat[0]!, t.value.quat[1]!, t.value.quat[2]!, t.value.quat[3]!];
          }
          break;
        }
      });
      if (anchorEnt === null) {
        // Anchor missing from loaded scene — still place at authored contract.
        console.warn('[hellforge] NpcVeyraAnchor not found in world — using authored [3.2,0,2.0]');
      }
      veyraPos = [anchorPos[0], anchorPos[2]];
      try {
        if (!assets) throw new Error('no asset registry for Veyra');
        const sceneGuid = AssetGuid.parse(VEYRA_SCENE_GUID);
        if (!sceneGuid.ok) throw new Error('Veyra scene guid parse');
        const sceneRes = await assets.loadByGuid<SceneAsset>(sceneGuid.value);
        if (!sceneRes.ok) {
          throw new Error('Veyra witch.glb scene load failed: ' + ((sceneRes.error as { code?: string }).code ?? '?'));
        }
        const idleGuid = AssetGuid.parse(VEYRA_IDLE_GUID);
        if (!idleGuid.ok) throw new Error('Veyra idle guid parse');
        const idleRes = await assets.loadByGuid<AnimationClip>(idleGuid.value);
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
        const sceneInst = world.get(veyraRoot, SceneInstance);
        let veyraSkin: EntityHandle | null = null;
        if (sceneInst.ok) {
          for (let i = 0; i < sceneInst.value.mapping.length; i++) {
            const ent = sceneInst.value.mapping[i];
            if (ent === undefined || ent === 0) continue;
            if (world.get(ent as EntityHandle, Skin).ok) {
              veyraSkin = ent as EntityHandle;
              break;
            }
          }
        }
        if (veyraSkin !== null) {
          world.addComponent(veyraSkin, {
            component: AnimationPlayer,
            data: {
              clips: [idleClip],
              times: new Float32Array([0]),
              weights: new Float32Array([1]),
              speeds: new Float32Array([1]),
              paused: false,
              looping: true,
            },
          });
          world.removeComponent(veyraSkin, ChildOf);
          world.set(veyraSkin, Transform, {
            pos: [0, 0, 0],
            quat: [0, 0, 0, 1],
            scale: [1, 1, 1],
          });
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
    const fx = new FxSystem(world, app);
    fx.setCampfire(0, 0.9, 0);      // pack's CampfireGlow sits at (0, 0.7, 0)
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
    const loot = new LootSystem(world);
    const sfx = new Sfx();
    onCleanup(ownerLedger.trackSfx());
    sfx.install();
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
    if (await dungeon.installGeometry(assets) === 'fallback') degraded.push('地牢场景');
    console.log(`[hellforge] den generated — ${dungeon.roomCount} rooms, ${dungeon.monsterSpawns.length} monsters`);
    if (stopped) return;

    // Distant irregular lava cones (ground-only) — camp wild rim + den cavern rim.
    await installWildTerrain(world, assets, { label: 'camp' });
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
    // Second pass: any late-resolved prop materials from terrain/geometry installs.
    ensureShadowCasters(world);

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
    const campObstacles = await loadSceneJson<ObstacleDoc>(
      './assets/scenes/rogue-encampment.obstacles.json', emptyObstacles,
    );
    // Camp + boss-antechamber doorframe proxies (world-space; den install already ran).
    const cameraProbeBlockers = [
      ...campObstacles.blockers,
      ...dungeon.antechamberProbeBlockers,
    ];
    const campCameraProbe = createObstacleCameraProbe(cameraProbeBlockers);
    // Foreground fade registry (diagnostics / future material-alpha). PR1 does
    // NOT mutate prop Transform — scale squash looked broken. Engine PBR
    // hardcodes baseColor.a=1 until Track A. Visibility = probe floor only.
    const fadeNamed: Array<{ localId: number; name: string }> = [];
    {
      const qState = createQueryState({ with: [Name, Entity] as const });
      queryRun(qState, world, (bundle) => {
        const ents = bundle.Entity.self;
        for (let i = 0; i < ents.length; i++) {
          const e = ents[i] as EntityHandle | undefined;
          if (e === undefined) continue;
          const n = world.get(e, Name);
          if (!n.ok || !n.value.value) continue;
          fadeNamed.push({ localId: e as unknown as number, name: n.value.value });
        }
      });
    }
    const fadeRegistry = buildCampFadeRegistry(cameraProbeBlockers, fadeNamed);
    const fadeEntries: FadeBlockerEntry[] = [...fadeRegistry.values()];
    const campFadeDriver = createFadeDriver({
      blockerIds: fadeEntries.map((e) => e.blockerId),
      setAlpha: () => {
        /* no-op — never scale authored props */
      },
    });
    const ashenLayout = await loadSceneJson<AshenReachLayout>(
      './assets/scenes/ashen-reach.layout.json', emptyAshen,
    );
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
    const questStatus = () => character.snapshot().quests[PURGE_QUEST_ID].status;
    const questCompleted = (): boolean => questStatus() === 'completed';
    // Cutscene playback state is mutated by play/endCutscene (defined later).
    // Hoisted so onPlayerHit / monsters.tick can gate Hero Shot world policy.
    let cutscene: { script: CutsceneScript; startMs: number } | null = null;
    let cutsceneSeam: SeamRestoreGuard | null = null;
    const heroShotActive = (): boolean =>
      isFinisherHeroShotActive(cutscene?.script ?? null);
    // Late-bound: playCutscene exists after the camera/cutscene block.
    let startFinisherHeroShot: (targetXZ: readonly [number, number]) => void =
      () => { /* filled after cutscene helpers */ };
    const monsters = new MonsterManager(world, fx, {
      onPlayerHit: (rawDmg, source) => {
        if (area === 'camp') return;                       // camp is sacred
        // PR2a T5/L6: invulnerable for the Hero Shot window (≤1.2 s).
        if (heroShotActive()) return;
        // PR2a L2: i-frames only during dodge Movement phase.
        if (isDodgeInvulnerable(dodgeState)) return;
        // L3: hit during buildup/recover aborts the roll (no i-frames).
        if (dodgeHitReactionAborts(dodgeState)) {
          dodgeState = abortDodge(dodgeState);
        }
        const dmg = resolveIncomingDamage(rawDmg, combatStats);
        if (damagePlayer(player, dmg)) {
          hud.damageFlash();
          addShake(source === 'slaglord' ? 0.4 : 0.16);
          sfx.play('player-hurt');
          // Shove the witch a step away from the closest attacker — weight.
          const src = monsters.nearest(state.px, state.pz, 3.2);
          if (src) {
            const kx = state.px - src.x, kz = state.pz - src.z;
            const kl = Math.hypot(kx, kz) || 1;
            const push = source === 'slaglord' ? 0.75 : 0.3;
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
          const drop = rollDrop(mLevel, isBoss, combatStats.magicFind);
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

    // Skinned GLB monster visuals (assets/monsters/*.glb) — load BEFORE the
    // den pre-spawn so every monster gets the real rig; kinds that fail fall
    // back to the lowpoly parts assemblies.
    const loadedMonsterKinds = assets ? await monsters.loadVisuals(assets) : [];
    if (loadedMonsterKinds.length < Object.keys(MONSTERS).length) degraded.push('怪物模型');
    if (stopped) return;
    for (const s of dungeon.monsterSpawns) {
      if (monsters.spawn(s.kind, s.x, s.z, 'den')) denTotal++;
    }

    // ── equipment + bag (打宝核心) — CharacterDomain is the authority ─────
    // 6-slot paper doll + 24-slot bag. Pickups / swaps / melts dispatch domain
    // commands; HUD/inventory read deep-frozen snapshots at render time (no
    // writable bag/equipment mirrors). CombatStats is re-derived; resource
    // ratios are preserved so re-equip cannot heal.
    let moveMul = 1;
    const applyEquipment = (opts: { refill?: boolean } = {}): void => {
      const snap = character.snapshot();
      const { equipment, bag, level, gold } = snap;
      combatStats = deriveCombatStats({ character: snap, classDef });
      syncRuntimeFromCombatStats(player, combatStats, { refill: opts.refill });
      skills.applyCombatStats(combatStats);
      moveMul = combatStats.moveSpeed;
      const eq = equipment as Equipment;
      inv.update(eq, bag as Array<ItemInstance | null>, level, gold);
      hud.setGold(gold);
      refreshCharacterPanel();
    };

    /** Pickup → domain take-item (empty slot or bag). */
    const takeItem = (item: ItemInstance, sx: number | null, sy: number | null): void => {
      const before = character.snapshot();
      const equippedEmpty = !before.equipment[item.slot] && before.level >= item.reqLevel;
      const res = character.dispatch({ op: 'take-item', item });
      if (!res.ok) {
        if (res.reason === 'bag-full') hud.banner('背包已满', '#ff6a6a', 1200);
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
      if (item.rarity === 'legendary') {
        hud.banner(`传奇！ ${item.name}`, meta.color, 2600);
        sfx.play('quest');
        addShake(0.15);
      } else if (item.rarity === 'rare') {
        sfx.play('equip');
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
        fx.rise(state.px, 0.2, state.pz, 'shadow', 8, 0.5);
        state.px = bx; state.pz = bz;
        fx.rise(bx, 0.2, bz, 'shadow', 8, 0.5);
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

    // ── inventory panel (B) — mutations dispatch through CharacterDomain ──
    const inv = installInventory({
      onEquipFromBag: (idx) => {
        const item = character.snapshot().bag[idx];
        if (!item) return false;
        const res = character.dispatch({ op: 'equip-from-bag', index: idx });
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
    }, uiMount, { tooltip: uiTooltip });
    const charPanel = installCharacterPanel(uiMount);
    onCleanup(() => { hud.dispose(); inv.dispose(); charPanel.dispose(); });

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
    // right where the Sun's shadow falls, washing the shadow out. Tighter range
    // keeps the ground-shadow contrast.
    // Low fill so CSM from the hero proxy stays readable on the floor.
    const playerLight = world.spawn(
      { component: Transform, data: { pos: [0, 2.4, 6.6] } },
      { component: PointLight, data: { color: [1.0, 0.78, 0.62], intensity: 5.5, range: 3.8 } },
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
          shader: 'forgeax::default-shadow-caster',
          tags: { LightMode: 'ShadowCaster' },
          queue: 2000,
          passKind: 'shadow-caster',
        },
      ],
      paramValues: {},
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
    const endCutscene = (
      reason: 'complete' | 'skip' | 'error' | 'stop' = 'complete',
    ): void => {
      if (!cutscene && !cutsceneSeam) return;
      cutscene = null;
      const guard = cutsceneSeam;
      cutsceneSeam = null;
      guard?.restoreOnce(reason);
    };
    const playCutscene = (script: CutsceneScript): void => {
      if (cutscene) return;
      cutsceneSeam = createSeamRestoreGuard(restoreCutsceneSeam);
      cutscene = { script, startMs: performance.now() };
      uiLayers.open('cutscene'); // worldInputBlocked ← onOwnershipChange funnel
    };
    startFinisherHeroShot = (targetXZ) => {
      try {
        playCutscene(buildFinisherHeroShot({
          targetXZ,
          playerXZ: [state.px, state.pz],
          camera: camRig,
        }));
      } catch (error) {
        console.error('[hellforge] finisher Hero Shot failed:', error);
        endCutscene('error');
      }
    };
    /** Camp-arrival cinematic: black → wide push-in → letterbox off (skippable). */
    const buildCampIntro = (): CutsceneScript => {
      const arpg = makeArpgAtPlayer();
      const wide = snapCameraFocus({ ...arpg, distance: 24 }, [state.px, 0, state.pz]);
      return {
        id: 'camp-intro',
        skippable: true,
        duration: 3.4,
        initialFade: 1,
        initialCamera: wide,
        cameraKeys: [{ at: 0, dur: 3.0, pose: arpg }],
        fades: [{ at: 0, to: 0, dur: 1.4 }],
        letterbox: [
          { at: 0, on: true },
          { at: 2.7, on: false },
        ],
        captions: [
          { at: 0.7, dur: 2.1, text: '余烬哨站', sub: 'Cinderwatch · 第一幕' },
        ],
      };
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
    const SUN_LOOK = {
      camp: { direction: [-0.3853, -0.4258, -0.8187], color: [1.0, 0.18, 0.08], intensity: 1.35 },
      den:  { direction: [-0.52, -0.58, -0.63], color: [1, 0.48, 0.24], intensity: 1.85 },
    } as const;
    const sun = world.spawn(
      { component: DirectionalLight, data: { ...SUN_LOOK.camp, castShadow: true, cascadeCount: 1, mapSize: 2048, shadowDistance: 42 } },
    ).unwrap();
    // Point pool: campfire (fixed; casts REAL point shadows — logs, props and
    // the witch proxy throw radial flickering shadows around the fire) + two
    // roaming torch slots + the player fill light = exactly 4. In camp the
    // roaming slots sit on the gate torches; in the den they re-seat onto the
    // two nearest fire fixtures. Seats sit ABOVE the emissive flame meshes —
    // a shadow-casting light inside its own fixture would be occluded by it.
    const GATE_L = { x: -2.5, y: 2.25, z: 13.5 } as const;
    const GATE_R = { x: 2.5, y: 2.25, z: 13.5 } as const;
    const campfireLight = world.spawn(
      { component: Transform, data: { pos: [0, 1.2, 0] } },
      { component: PointLight, data: { color: [1, 0.58, 0.22], intensity: 13, range: 16 } },
      { component: PointLightShadow, data: { mapSize: 512, farPlane: 18 } },
    ).unwrap();
    const torchA = world.spawn(
      { component: Transform, data: { pos: [GATE_L.x, GATE_L.y, GATE_L.z] } },
      { component: PointLight, data: { color: [1, 0.52, 0.16], intensity: 9.5, range: 12 } },
      { component: PointLightShadow, data: { mapSize: 512, farPlane: 14 } },
    ).unwrap();
    const torchB = world.spawn(
      { component: Transform, data: { pos: [GATE_R.x, GATE_R.y, GATE_R.z] } },
      { component: PointLight, data: { color: [1, 0.52, 0.16], intensity: 9.5, range: 12 } },
    ).unwrap();
    let torchBaseA = 9.5, torchBaseB = 9.5;   // flicker centre per slot
    let torchSeatTimer = 0;
    let flickT = 0;
    const seatDenTorches = (): void => {
      // Two nearest fire fixtures within 26 m; an unused slot parks below the
      // floor (range 12 ≪ 60 m of rock → contributes nothing).
      const near = dungeon.firePoints
        .map((p) => ({ p, d: Math.hypot(p.x - state.px, p.z - state.pz) }))
        .filter((e) => e.d < 26)
        .sort((a, b) => a.d - b.d);
      const slots = [torchA, torchB] as const;
      for (let i = 0; i < slots.length; i++) {
        const seat = near[i]?.p;
        world.set(slots[i]!, Transform, seat
          ? { pos: [seat.x, seat.y, seat.z] }
          : { pos: [0, -60, 0] });
      }
      torchBaseA = 9; torchBaseB = 9;
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
        // Den ambient: dimmer + ember-tinted so torch pools and the sun shaft
        // carry the read; outdoors: neutral IBL (when ready) / warm solid fallback.
        // Always re-pass equirect so world.set does not drop the IBL source handle.
        // Outdoors: warm, dim IBL — Belfast HDR is hot; don't let sky bleach the camp.
        // Very dim brown ambient — sky vault is LDR ash; torch/campfire carry the read.
        const tint = a === 'den'
          ? (sky.ibl ? { color: [0.72, 0.38, 0.24] as [number, number, number], intensity: 0.07 } : { color: [0.55, 0.28, 0.18] as [number, number, number], intensity: 0.14 })
          : (sky.ibl ? { color: [0.65, 0.34, 0.20] as [number, number, number], intensity: 0.055 } : { color: [0.55, 0.28, 0.18] as [number, number, number], intensity: 0.14 });
        const ambTint = tempShiftRgb(tint.color, lightSettings.atmoTemp);
        const amb = { ...ambTint, intensity: tint.intensity * lightSettings.ambientMul };
        world.set(sky.ent, Skylight, sky.equirect
          ? { equirect: sky.equirect, ...amb }
          : amb);
      }
      if (a === 'den') {
        seatDenTorches();
      } else {
        world.set(torchA, Transform, { pos: [GATE_L.x, GATE_L.y, GATE_L.z] });
        world.set(torchB, Transform, { pos: [GATE_R.x, GATE_R.y, GATE_R.z] });
        torchBaseA = 9.5; torchBaseB = 9.5;
      }
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
    };

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
    });
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
    const SPEED = 3.4, SPRINT = 5.4;
    const FACING_SIGN = 1;
    // Stride = ground speed (m/s) each locomotion clip matches at playback
    // rate 1. free-walk ≈ 1.07 s / free-run ≈ 0.67 s loops — calibrate
    // separately so feet don't slide when selectLocomotionClip swaps clips.
    // SPEED 3.4 → walk rate ≈ 2.4; SPRINT 5.4 → run rate ≈ 1.5.
    const ANIM_STRIDE_WALK = 1.4;
    const ANIM_STRIDE_RUN = 3.6;
    const ANIM_SPEED_MIN = 0.5, ANIM_SPEED_MAX = 4.8;

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
    // fps compensation: the engine's advanceAnimationPlayer steps clips a
    // FIXED 1/60 s per rendered frame (measured rate == fps/60), so below
    // 60 fps every skeletal animation plays in slow motion. Until the engine
    // takes real dt (ENGINE-ISSUES-for-ubpa.md), every AnimationPlayer
    // `speeds` write is multiplied by this smoothed real-dt×60 rate — witch
    // here, monsters via monsters.animRate.
    let animRate = 1;
    let witchAnimBase = 1;
    const swapClip = (name: string) => {
      if (witchSkinEnt === null) return;
      const h = clipHandles.get(name);
      if (h === undefined || state.currentClip === name) return;
      state.currentClip = name;
      witchAnimBase = 1;
      world.set(witchSkinEnt, AnimationPlayer, {
        clips: [h], times: new Float32Array([0]), weights: new Float32Array([1]), speeds: new Float32Array([animRate]), looping: true, paused: state.paused,
      });
    };
    const playOnce = (name: string, speed = 1, lockScale = 1) => {
      if (witchSkinEnt === null) return;
      if (performance.now() < state.oneShotUntil && name !== 'death') return;
      const h = clipHandles.get(name);
      if (h === undefined) return;
      state.currentClip = name;
      // lockScale < 1 releases control before the clip's tail (recovery frames)
      // finishes — the state machine then swaps to move/idle, i.e. the follow-
      // through is cancellable, ARPG-style.
      state.oneShotUntil = performance.now() + ((clipDur.get(name) ?? 1) / speed) * 1000 * lockScale;
      witchAnimBase = speed;
      world.set(witchSkinEnt, AnimationPlayer, {
        clips: [h], times: new Float32Array([0]), weights: new Float32Array([1]), speeds: new Float32Array([speed * animRate]), looping: false, paused: state.paused,
      });
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
      if (res === 'ok') dodgeState = cancelDodgeForSkillOrMove(dodgeState);
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
    const refreshQuest = (): void => {
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

    const enterArea = (next: Area): void => {
      if (next === area) return;
      area = next;
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
      refreshQuest();
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
      state.px = dungeon.entry.x;
      state.pz = dungeon.entry.z;
      camRig = snapCameraFocus(camRig, [state.px, 0, state.pz]);
      enterArea('den');
    } else {
      persistCharacter();
      charSelect?.hide();
      charList?.hide();
      shell?.goTo('inGame');
      shellPhase = 'inGame';
      inGame = true;
      hud.show();
      queuedCampIntro = true; // area title rides the intro cutscene caption instead
    }
    if (degraded.length > 0) {
      hud.banner(`部分资产降级：${degraded.join('、')}`, '#ffb070', 5000);
    }

    // ── automap (den) + skill sheet (SPEC §6, uiRoot-mounted) ─────────────
    const automap = installAutomap(uiMount, {
      getDungeon: () => dungeon,
      getPlayerPos: () => ({ x: state.px, z: state.pz }),
      isInDen: () => area === 'den',
    });
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
    let followIdx = 0;
    let targetRepathAcc = 0;
    const PATH_ARRIVE = 0.45;
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
        if (id === 'reach-to-slagdeep' || id === 'cinderwatch-to-reach') {
          return { x: CAVE_MOUTH.x, z: CAVE_MOUTH.z };
        }
        if (id === 'slagdeep-to-reach' || id === 'reach-to-cinderwatch') {
          return { x: DEN_EXIT.x, z: DEN_EXIT.z };
        }
        return null;
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
          out.push({
            ref: { kind: 'exit', id: 'reach-to-slagdeep' },
            position: [CAVE_MOUTH.x, CAVE_MOUTH.z],
            pickRadius: 2.2,
          });
        } else {
          out.push({
            ref: { kind: 'exit', id: 'slagdeep-to-reach' },
            position: [DEN_EXIT.x, DEN_EXIT.z],
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
        const ev = loot.collectById(id, () => character.snapshot().bag.includes(null));
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
          state.px = CAVE_MOUTH.x;
          state.pz = CAVE_MOUTH.z;
          return 'ok';
        }
        if (id === 'slagdeep-to-reach' || id === 'reach-to-cinderwatch') {
          if (area !== 'den') return 'failed';
          state.px = DEN_EXIT.x;
          state.pz = DEN_EXIT.z;
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
      if (next.kind === 'point') {
        followPath = navigation.path([state.px, state.pz], next.world);
      } else if (next.kind === 'target') {
        const resolved = interactions.resolve(next.target);
        if (resolved) followPath = navigation.path([state.px, state.pz], resolved.position);
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
    const uiLayers = createUiLayerManager({
      onOwnershipChange: (_prev, next) => {
        worldInputBlocked = next !== null;
        clearMoveIntent();
        for (const code of MOVE_INTENT_KEYS) keys[code] = false;
      },
    });
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
          if (res.ok) {
            sfx.play('quest');
            hud.banner('已接受：清剿熔渣深窟', '#8aff9a', 2200);
            persistCharacter();
            refreshQuest();
            refreshQuestLog();
          }
          uiLayers.close('dialogue');
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

    uiLayers.register('inventory', { show: () => inv.show(), hide: () => inv.hide() });
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
    });
    ((window as unknown as { __hf: Record<string, unknown> }).__hf).uiLayers = uiLayers;
    ((window as unknown as { __hf: Record<string, unknown> }).__hf).owners = () =>
      ownerLedger.snapshot(uiLayers.active());
    ((window as unknown as { __hf: Record<string, unknown> }).__hf).assertSingleOwners = () =>
      ownerLedger.assertSingleOwners(uiLayers.active(), HELLFORGE_UPDATE_SYSTEMS);
    // Dev/QA hook: replay the camp-arrival cinematic (used by browser walkthroughs).
    ((window as unknown as { __hf: Record<string, unknown> }).__hf).playCampIntro = () => playCutscene(buildCampIntro());
    ((window as unknown as { __hf: Record<string, unknown> }).__hf).moveIntent = {
      get: () => moveIntent,
      clear: clearMoveIntent,
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
          // Roll clip is T2 (merge-gen3d); until then code-driven lunge only (plan §9).
        }
      }
      // Cutscene owns UI + world input — only Esc (skip) may steal ownership.
      if (!cutsceneBlocksChromeKey(uiLayers.active())) {
        if (e.code === 'KeyB' || e.code === 'KeyI') {
          automap.setOpen(false);
          applyEquipment();
          toggleMajorPanel('inventory');
        }
        if (e.code === 'KeyK') {
          automap.setOpen(false);
          toggleMajorPanel('skills');
        }
        if (e.code === 'KeyQ') {
          automap.setOpen(false);
          refreshQuestLog();
          toggleMajorPanel('quests');
        }
        if (e.code === 'KeyC') {
          automap.setOpen(false);
          refreshCharacterPanel();
          toggleMajorPanel('character');
        }
        if (e.code === 'F10') {
          e.preventDefault();
          automap.setOpen(false);
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
        if (automap.isOpen()) { automap.setOpen(false); return; }
        if (uiLayers.active() !== null) { uiLayers.closeAll(); return; }
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown, true));

    const onKeyUp = (e: KeyboardEvent) => { keys[e.code] = false; };
    window.addEventListener('keyup', onKeyUp, true);
    onCleanup(() => window.removeEventListener('keyup', onKeyUp, true));

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
      dodgeState = cancelDodgeForSkillOrMove(dodgeState);
      const world: readonly [number, number] = [hit.x, hit.z];
      const picked = interactions.pickAt(world, CLICK_PICK_R);
      if (picked) {
        setMoveIntent(reduceIntent(moveIntent, { op: 'set-target', target: picked }));
      } else {
        setMoveIntent(reduceIntent(moveIntent, { op: 'set-point', world }));
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
      // fps compensation rate for AnimationPlayer speeds (see clip helpers).
      // Smoothed so a single hitchy frame doesn't pulse the animations.
      animRate += (clamp(dt * 60, 0.3, 3) - animRate) * Math.min(1, dt * 10);

      if (inGame) automap.tick();

      // ── shell gate: preview-only frame until CharacterRecord hand-off ──
      if (!inGame) {
        if (witchSkinEnt !== null && !state.paused) {
          if (state.currentClip !== 'idle') swapClip('idle');
          witchAnimBase = 1;
          world.set(witchSkinEnt, AnimationPlayer, {
            speeds: new Float32Array([witchAnimBase * animRate]),
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
          dodgeState = cancelDodgeForSkillOrMove(dodgeState);
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
                followPath = navigation.path([state.px, state.pz], resolved.position);
                followIdx = 0;
              }
            }
            const tick = tickTargetIntent(moveIntent, [state.px, state.pz], interactions);
            moveIntent = tick.intent;
            if (moveIntent.kind !== 'target') {
              followPath = [];
              followIdx = 0;
            }
          }
          while (followIdx < followPath.length) {
            const wp = followPath[followIdx]!;
            const dx = wp[0] - state.px;
            const dz = wp[1] - state.pz;
            const dist = Math.hypot(dx, dz);
            if (dist <= PATH_ARRIVE) {
              followIdx += 1;
              continue;
            }
            mvx = dx / dist;
            mvz = dz / dist;
            break;
          }
          if (moveIntent.kind === 'point' && followIdx >= followPath.length) {
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
        const nx = mvx / len, nz = mvz / len;
        faceX = nx; faceZ = nz;
        const nxp = state.px + nx * spd;
        const nzp = state.pz + nz * spd;
        if (walkableAt(nxp, state.pz)) state.px = nxp;
        if (walkableAt(state.px, nzp)) state.pz = nzp;
      }
      // Actual ground speed after collision slide (not key/sprint flags).
      const groundSpeed = Math.hypot(state.px - prevPx, state.pz - prevPz) / Math.max(dt, 1e-6);
      const isPathDriven = moveIntent.kind === 'point' || moveIntent.kind === 'target';

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
      if (witchSkinEnt !== null) {
        world.set(witchSkinEnt, AnimationPlayer, { speeds: new Float32Array([witchAnimBase * animRate]) });
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
      // Roaming torch slots follow the player through the den.
      if (area === 'den') {
        torchSeatTimer -= dt;
        if (torchSeatTimer <= 0) { torchSeatTimer = 0.4; seatDenTorches(); }
      }
      // Ember flicker: two incommensurate sines ≈ organic wobble, no RNG churn.
      flickT += dt;
      const flick = (ph: number): number => 0.86 + 0.14 * Math.sin(flickT * 9.7 + ph) * Math.sin(flickT * 5.3 + ph * 1.7);
      const fireMul = lightSettings.fireMul;
      world.set(campfireLight, PointLight, { intensity: 12 * fireMul * flick(0) });
      world.set(torchA, PointLight, { intensity: torchBaseA * fireMul * flick(2.1) });
      world.set(torchB, PointLight, { intensity: torchBaseB * fireMul * flick(4.4) });
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
      monsters.animRate = animRate;
      // PR2a T5/L6: freeze monsters during finisher Hero Shot (camp-safe
      // cutscene assumption does not hold in the den). skills.tick still runs
      // so damage at 0.4 s stays independent of the shot.
      if (!heroShotActive()) {
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
        for (const ev of loot.tick(dt, state.px, state.pz, () => character.snapshot().bag.includes(null))) {
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
            portalArmed = false;
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
          }
        } else if (area === 'den' && dExit < 1.5) {
          portalArmed = false;
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
      if (!portalArmed && dCave > 3.5 && dExit > 3.5) portalArmed = true;
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
        // Camp + antechamber occluders (ARPG + showcase share one probe).
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
      // Keep CharSelect readable — full grade haze/vignette crush the stage.
      const haze = document.getElementById('hf-rs-haze');
      const vig = document.getElementById('hf-rs-vignette');
      if (haze) haze.style.opacity = on ? '0.22' : String(titleRs?.get().haze ?? 0.7);
      if (vig) vig.style.opacity = on ? '0.28' : String(titleRs?.get().vignette ?? 0.65);
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
    return;
  }

  try {
    await startRuntime(null);
  } catch (error) {
    failBoot('游戏初始化失败', error);
  }
}
