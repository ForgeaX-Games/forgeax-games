import { get } from "./src/localization";
//  localized comment
//  localized comment
//
// STATIC content (town buildings, plaza, stands, signup booth, the Player rig
// and 5 NPC humanoid rigs, sun + sky) is authored in assets/scene.pack.json —
// ✎ Edit and ▶ Play instantiate the SAME pack. This file adds ONLY dynamics:
//   - mode state machine: 'town' (free roam, third-person cam) ↔ 'match' (arena)
//   - digital-life residents (src/town.ts): needs → work/stroll/chat/rest/watch
//  localized comment
//  localized comment
//   - transient entities: bubbles, blasts, power-ups, soft blocks (PCG per match)
//
//  localized comment

import {
  Camera, perspective, Materials, MeshFilter, MeshRenderer,
  SceneInstance, TONEMAP_REINHARD_EXTENDED, BLOOM_ENABLED, ANTIALIAS_FXAA, PointLight,
} from '@forgeax/engine-render';
import { Transform } from '@forgeax/engine-scene';
import { quat, type MaterialAsset } from '@forgeax/engine-runtime';
import { HANDLE_CUBE, HANDLE_SPHERE } from '@forgeax/engine-assets-runtime';
import { createSphereGeometry } from '@forgeax/engine-geometry';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { Time, Update, type EntityHandle, type World } from '@forgeax/engine-ecs';
import type { BootstrapContext } from '@forgeax/engine-app';
import {
  createInputSnapshot, INPUT_MAP_KEY, INPUT_SNAPSHOT_RESOURCE_KEY,
  type ActionConfig, type InputSnapshot,
} from '@forgeax/engine-input';
import type { SceneAsset } from '@forgeax/engine-types';
import { installHud } from './src/hud';
import { PaopaotangNpcBrain, installChatInput } from './src/npc-brain';
import { npcDefinitions } from './src/npcs';
import { HumanoidRig, Actor } from './src/rig';
import { TownSim, type Resident, type ResidentDef, WAYPOINT_NAMES } from './src/town';
import {
  ENEMY_DEATH_LINES, ENEMY_GLOAT_LINES, ENEMY_NAMES, PLAYER_KILL_LINES,
  PLAYER_WIN_LINE, pick, pickIntroScript, type BanterLine,
  TOWN_CHAT_SCRIPTS, HECKLE_LINES, DUEL_TAUNTS, DUEL_WIN_LINES, DUEL_LOSE_LINES,
  REFEREE_NAME, REFEREE_SIGNUP_LINES, REFEREE_DUEL_LINES, REFEREE_BUSY_LINES,
} from './src/trashtalk';
import type { TopicDef } from './src/npc-dialogue.gen';

type Ctx = { world: World; assets?: BootstrapContext['assets'] };

// forge.json defaultScene — assets/scene.pack.json assets[0].guid.
const SCENE_GUID = '279b6439-2794-41bc-97ea-158a7b144f0d';

interface PackNode { localId: number; components: Record<string, Record<string, unknown>> }

// Canonical scene load (same shape as every template game): loadByGuid<SceneAsset>
// -> allocSharedRef -> assets.instantiate -> read SceneInstance.mapping.
async function loadScene(
  ctx: Ctx,
): Promise<{ mapping: ReadonlyMap<number, EntityHandle>; nodes: PackNode[] } | null> {
  const { world, assets } = ctx;
  if (!assets) return null;
  const sceneGuid = AssetGuid.parse(SCENE_GUID);
  if (!sceneGuid.ok) return null;
  const loadRes = await assets.loadByGuid<SceneAsset>(sceneGuid.value);
  if (!loadRes.ok) { console.error('[game] scene loadByGuid failed:', loadRes.error); return null; }
  const sceneHandle = world.allocSharedRef('SceneAsset', loadRes.value);
  const instRes = assets.instantiate<SceneAsset>(sceneHandle, world);
  if (!instRes.ok) { console.error('[game] scene instantiate failed:', (instRes.error as { code?: string })?.code); return null; }
  const sceneInst = world.get(instRes.value, SceneInstance);
  if (!sceneInst.ok) { console.error('[game] SceneInstance lookup failed:', sceneInst.error); return null; }
  const mappingArr = sceneInst.value.mapping;
  const nodes = loadRes.value.entities as unknown as PackNode[];
  const mapping = new Map<number, EntityHandle>();
  for (const n of nodes) {
    const e = mappingArr[n.localId];
    if (e !== undefined) mapping.set(n.localId, e as EntityHandle);
  }
  return { mapping, nodes };
}

// Minimal fallback (ground only) so Play still boots if the pack is unreadable.
function spawnFallbackScene(world: World): void {
  const ground = world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset',
    Materials.standard({ baseColor: [0.56, 0.78, 0.55, 1], roughness: 0.95, metallic: 0 }));
  world.spawn(
    { component: Transform, data: { pos: [0, -0.1, 0], scale: [15, 0.2, 13]} },
    { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
    { component: MeshRenderer, data: { materials: [ground] } },
  );
}

// ── grid constants (balance.md: 13×11, classic odd-lattice board) ─────────────
const GRID_W = 13, GRID_H = 11;         // tiles; world x = gx - HALF_X, z = gz - HALF_Z
const HALF_X = 6, HALF_Z = 5;
const EMPTY = 0, HARD = 1, SOFT = 2, BUBBLE = 3;
const ARENA_Y = 0.75;                   // player/fighter root height on the arena floor
const TOWN_Y = 0.55;                    // root height on the town apron

//  localized comment
const FUSE = 2.5;                       //  localized comment
const WARN_T = 0.4;                     //  localized comment
const BLAST_LINGER = 0.5;               //  localized comment
const SPLASH_LIFE = 0.5;                // splash visual lifetime matches lethality
const SOFT_FILL = 0.7;                  //  localized comment
const DROP_CHANCE = 0.25;               //  localized comment
const FIRE_START = 1, FIRE_MAX = 6;     //  localized comment
const BUBBLE_CAP_START = 1, BUBBLE_CAP_MAX = 5;
const SPEED_START = 4.0, SPEED_STEP = 0.6, SPEED_MAX = 6.4;
const ENEMY_SPEED = 3.4;                // slower than the player — outrun with brains
const AI_TICK_BASE = 0.6;               //  localized comment
const AI_TICK_ENDGAME = 0.4;            //  localized comment
const ENDGAME_SPEED_BONUS = 0.4;
const ENDGAME_SOFT_RATIO = 0.3;
const ENEMY_BOMB_DIST = 2;              // manhattan range that tempts a bomb
const ENEMY_BOMB_CHANCE = 0.6;          // 60% per think when in range
const ENEMY_DIG_CHANCE = 0.35;          // bomb a soft block toward the player
const SCORE_BLOCK = 10, SCORE_KILL = 100, SCORE_PICKUP = 5;
const HINT_TIMEOUT_S = 12;              // onboarding strip self-destructs regardless
const BANTER_LINE_S = 1.9;              //  localized comment
const PLAYER_TALKBACK_CHANCE = 0.6;     // player claps back after a kill

// town-mode constants (docs/town-plan.md P1)
const TOWN_WALK_SPEED = 4.4;
const PLAYER_R = 0.35;                  // player collision radius in town
const JUMP_V = 7.2;                     //  localized comment
const GRAVITY = 22;                     // town-mode vertical gravity
const GATE = { x: 9.2, z: 9.4 };        // arena gate (exit spot after a match)
const BOOTH_SPOT = { x: 10.9, z: 9.7 }; //  localized comment
const DUEL_FIRST_DELAY = 18;            // first NPC duel ~18s after boot
const DUEL_COOLDOWN_MIN = 40, DUEL_COOLDOWN_VAR = 30;
const DUEL_TIMEOUT = 75;                // hard draw timeout (s)
const FIGHTER_SPEED = 3.2;
const FIGHTER_RANGE = 2;                // duel bubbles hit harder → shorter matches
// town collision is DERIVED from the loaded pack nodes (see buildTownObstacles
// in bootstrap) so it always matches what you SEE — hand-synced coordinate
// tables drift (that's how trees/gumdrops ended up walk-through).
// Name pattern → [extra padding, isRound]. Sizing rule per builtin mesh:
// cube geometry is UNIT-sized (scale s → half-extent s/2), but the builtin
// sphere is RADIUS-1 (scale s → visual radius s, twice the cube rule) — sizing
// spheres as s/2 boxes is exactly how you clipped through gumdrop edges.
// Round obstacles collide as ellipses and carry a bottom, so low canopies
// block your body while high lamp bulbs stay walk-under.
const OBSTACLE_SOURCES: ReadonlyArray<readonly [RegExp, number, boolean]> = [
  [/^HouseBody_/, 0.2, false], [/^FactoryBody$/, 0.2, false], [/^FountainBase$/, 0.15, false],
  [/^Bench_/, 0.1, false], [/^LampPost_/, 0.05, false], [/^BoothBase$/, 0.15, false],
  [/^BoothPost_/, 0.05, false], [/^StandTier_/, 0.15, false], [/^StandStripe_/, 0, false],
  [/^TreeTrunk_/, 0.3, false], [/^TowerPost_/, 0.1, false], [/^GatePillar_/, 0.1, false],
  [/^Gumdrop_/, 0.05, true], [/^TreeHead_/, 0, true], [/^TowerCap_/, 0, true],
  [/^LampBulb_/, 0.05, true], [/^FountainSpout$/, 0.05, true], [/^GateBall_/, 0, true],
];
// top/bot = surface heights ABOVE the apron ground (feet level −0.2).
//  localized comment
interface TownOb { cx: number; cz: number; hx: number; hz: number; top: number; bot: number; round: boolean }
const ARENA_OB: TownOb = { cx: 0, cz: 0, hx: 7.6, hz: 6.6, top: 99, bot: 0, round: false };
const PLAYER_H = 1.55;                  // feet → hat top; overhangs above this clear the head
// static fallback, used ONLY when the pack could not be read at all
const TOWN_OBSTACLES_FALLBACK: ReadonlyArray<readonly [number, number, number, number]> = [
  [-16, 2, 1.9, 1.7], [-16, 8, 1.9, 1.7], [-16, 14, 1.9, 1.7], [-16, 20, 1.9, 1.7],
  [19, -3, 3.2, 2.7],        // candy factory
  [0, 14, 1.45, 1.45],       // fountain
  [10.9, 8.4, 1.25, 0.65],   // signup booth
  [11.1, 0, 1.75, 4.6],      // spectator stands
  [-4.2, 16.6, 0.95, 0.4], [4.2, 16.6, 0.95, 0.4],   // benches
  [-5.5, 11.2, 0.22, 0.22], [5.5, 11.2, 0.22, 0.22], // lamp posts
];
//  localized comment
const TALK_RANGE = 1.9;                 // prompt shows within arm's reach
const TALK_BREAK_DIST = 3.4;            // walking away ends the chat
const TALK_LINE_S = 2.1;                // seconds per line (E skips ahead)
const TOWN_BOUND_X = 29, TOWN_BOUND_Z_MIN = -23, TOWN_BOUND_Z_MAX = 24;

// residents (rigs authored by tools/build-town.mjs; homes = town.ts waypoints)
const RESIDENT_DEFS: readonly ResidentDef[] = npcDefinitions.map((npc) => ({
  key: npc.npcId,
  prefix: npc.body.prefix,
  name: npc.displayName,
  home: npc.body.home,
  workTalk: npc.body.workTalk,
  ...(typeof npc.behavior?.role === 'string' ? { role: npc.behavior.role } : {}),
}));

const DIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// arena spawn tiles: [0] = player corner, rest = the 3 jellies
const SPAWNS: ReadonlyArray<readonly [number, number]> = [[0, 0], [12, 10], [0, 10], [12, 0]];
const DUEL_SPAWNS: ReadonlyArray<readonly [number, number]> = [[0, 0], [12, 10]];

export async function bootstrap(world: World, ctx?: BootstrapContext) {
  // Engine callback-deletion migration: BootstrapContext no longer carries
  // registerUpdate — per-frame work belongs to an ECS Update system. Keep a
  // legacy lookup so older hosts (if any) still drive us, but the canonical
  // path is world.addSystem(Update, ...) below.
  const registerUpdate = (ctx as { registerUpdate?: (fn: (dt: number) => void) => void } | undefined)
    ?.registerUpdate;
  const canvas = document.querySelector<HTMLCanvasElement>('#app')!;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  const aspect = canvas.width / canvas.height || 1;

  // ── load the authored town+arena (host-instantiated instance preferred) ─────
  let loaded: { mapping: ReadonlyMap<number, EntityHandle>; nodes: PackNode[] } | null = null;
  const hostRoot = ctx?.defaultSceneRoot;
  if (hostRoot !== undefined && ctx?.defaultScene !== undefined) {
    const sceneInst = world.get(hostRoot, SceneInstance);
    if (sceneInst.ok) {
      const mappingArr = sceneInst.value.mapping as unknown as { length: number; [i: number]: number };
      const mapping = new Map<number, EntityHandle>();
      for (let localId = 0; localId < mappingArr.length; localId++) {
        const e = mappingArr[localId];
        if (e !== undefined && e !== 0xffffffff && e !== 0) mapping.set(localId, e as EntityHandle);
      }
      loaded = { mapping, nodes: ctx.defaultScene.entities as unknown as PackNode[] };
    } else {
      console.error('[game] SceneInstance lookup on host root failed:', sceneInst.error);
    }
  }
  if (!loaded) {
    try { loaded = await loadScene({ world, assets: ctx?.assets }); }
    catch (err) { console.warn('[game] scene asset unavailable:', err); }
  }
  if (!loaded) spawnFallbackScene(world);

  // ── humanoid rigs: the Player + 4 residents + the referee (src/rig.ts) ──────
  const nodes = loaded?.nodes ?? [];
  const mapping = loaded?.mapping ?? new Map<number, EntityHandle>();
  const playerRig = new HumanoidRig(world, nodes, mapping, 'Player');
  const playerActor = new Actor(world, playerRig);
  playerActor.baseY = TOWN_Y;
  const town = new TownSim(RESIDENT_DEFS, TOWN_CHAT_SCRIPTS);
  const npcActors = new Map<string, Actor>();
  for (const def of RESIDENT_DEFS) {
    const rig = new HumanoidRig(world, nodes, mapping, def.prefix);
    if (rig.found) npcActors.set(def.prefix, new Actor(world, rig));
  }
  const refRig = new HumanoidRig(world, nodes, mapping, 'NpcR');
  const refActor = refRig.found ? new Actor(world, refRig) : null;

  // ── town collision AABBs [cx, cz, halfX, halfZ, top] derived from the pack ──
  const townObstacles: TownOb[] = [ARENA_OB];
  for (const n of nodes) {
    const nm = n.components.Name?.value as string | undefined;
    if (nm === undefined) continue;
    const src = OBSTACLE_SOURCES.find(([re]) => re.test(nm));
    if (!src) continue;
    const t = n.components.Transform as { pos?: number[]; scale?: number[] } | undefined;
    if (!t?.pos) continue;
    const sc = t.scale ?? [1, 1, 1];
    const [, pad, round] = src;
    const hy = round ? sc[1]! : sc[1]! / 2;    // vertical half-size per mesh rule
    townObstacles.push({
      cx: t.pos[0]!, cz: t.pos[2]!,
      hx: (round ? sc[0]! : sc[0]! / 2) + pad,
      hz: (round ? sc[2]! : sc[2]! / 2) + pad,
      top: t.pos[1]! + hy + 0.2, bot: t.pos[1]! - hy + 0.2, round,
    });
  }
  if (townObstacles.length === 1) {
    townObstacles.push(...TOWN_OBSTACLES_FALLBACK.map(
      (o): TownOb => ({ cx: o[0], cz: o[1], hx: o[2], hz: o[3], top: 99, bot: 0, round: false }),
    ));
  }

  //  localized comment
  // position/scale offsets only (rest pose from the pack stays authoritative)
  const gateAnim: Array<{ e: EntityHandle; kind: 'arrow' | 'flag'; ph: number;
    pos: readonly [number, number, number]; scale: readonly [number, number, number] }> = [];
  for (const n of nodes) {
    const nm = n.components.Name?.value as string | undefined;
    if (nm === undefined) continue;
    const isArrow = /^GateArrow_/.test(nm), isFlag = /^GateFlag_/.test(nm);
    if (!isArrow && !isFlag) continue;
    const e = mapping.get(n.localId);
    const t = n.components.Transform as { pos?: number[]; scale?: number[] } | undefined;
    if (e === undefined || !t?.pos) continue;
    const sc = t.scale ?? [1, 1, 1];
    gateAnim.push({
      e, kind: isArrow ? 'arrow' : 'flag', ph: gateAnim.length * 0.9,
      pos: [t.pos[0]!, t.pos[1]!, t.pos[2]!], scale: [sc[0]!, sc[1]!, sc[2]!],
    });
  }
  let gateT = 0;

  // ── one dynamic camera (town follow / arena overview / stands view) ─────────
  const lookYawQ = quat.create(), lookPitchQ = quat.create(), lookQ = quat.create();
  const lookAt = (cx: number, cy: number, cz: number, tx: number, ty: number, tz: number) => {
    const dx = tx - cx, dy = ty - cy, dz = tz - cz;
    const len = Math.hypot(dx, dy, dz) || 1;
    quat.fromAxisAngle(lookYawQ, [0, 1, 0], Math.atan2(-dx, -dz));
    quat.fromAxisAngle(lookPitchQ, [1, 0, 0], Math.asin(dy / len));
    quat.multiply(lookQ, lookYawQ, lookPitchQ);
    return lookQ;
  };
  let camX = 0, camY = 7, camZ = 20;    // eased toward the mode's desired position
  const camE = world.spawn(
    { component: Transform, data: { pos: [camX, camY, camZ]} },
    { component: Camera, data: { ...perspective({ fov: Math.PI / 3, aspect, near: 0.1, far: 220 }), tonemap: TONEMAP_REINHARD_EXTENDED, bloom: BLOOM_ENABLED, antialias: ANTIALIAS_FXAA, clearColor: [0.55, 0.75, 1.0, 1] } },
  ).unwrap();
  // one soft candy accent light over the arena centre
  world.spawn(
    { component: Transform, data: { pos: [0, 7, 0]} },
    { component: PointLight, data: { color: [1, 0.75, 0.88], intensity: 24, range: 30 } },
  );

  // ── HUD (mounted into the host's disposable uiRoot) ─────────────────────────
  const hudHost = ctx?.uiRoot ?? canvas.parentElement ?? undefined;
  const hud = installHud(hudHost ? { host: hudHost } : {});
  const chatBox = installChatInput(hudHost);
  ctx?.registerCleanup?.(() => hud.dispose());

  // ── materials + baked meshes for the dynamic layer ──────────────────────────
  const mat = (baseColor: [number, number, number, number], extra?: { emissive?: [number, number, number]; emissiveIntensity?: number; roughness?: number }) =>
    world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
      baseColor, metallic: 0, roughness: extra?.roughness ?? 0.6,
      ...(extra?.emissive ? { emissive: extra.emissive, emissiveIntensity: extra.emissiveIntensity ?? 1 } : {}),
    }));
  const softMats = [
    mat([0.98, 0.78, 0.4, 1]),   // caramel
    mat([0.95, 0.55, 0.66, 1]),  // strawberry
    mat([0.6, 0.8, 0.95, 1]),    // mint-blue
  ];
  const bubbleMat = mat([1, 0.55, 0.8, 1], { emissive: [1, 0.4, 0.7], emissiveIntensity: 1.2, roughness: 0.3 });
  const enemyBubbleMat = mat([0.5, 0.65, 1, 1], { emissive: [0.35, 0.5, 1], emissiveIntensity: 1.2, roughness: 0.3 });
  const splashMat = mat([1, 0.9, 0.95, 1], { emissive: [1, 0.55, 0.8], emissiveIntensity: 5, roughness: 0.4 });
  const powerMats = [
    mat([0.95, 0.25, 0.3, 1], { emissive: [0.9, 0.15, 0.2], emissiveIntensity: 1.6 }),   // 0 🔥 fire
    mat([0.3, 0.55, 0.95, 1], { emissive: [0.2, 0.45, 0.9], emissiveIntensity: 1.6 }),   // 1 💧 +bubble
    mat([0.98, 0.85, 0.3, 1], { emissive: [0.95, 0.8, 0.2], emissiveIntensity: 1.6 }),   // 2 👟 speed
  ];
  const enemyMats = [
    mat([0.7, 0.4, 0.9, 1]), mat([0.3, 0.8, 0.75, 1]), mat([0.95, 0.6, 0.25, 1]),
  ];
  const hatMat = mat([0.25, 0.22, 0.3, 1]);
  // Bake spheres AT final size (Transform.scale ~1) — scaled unit spheres cast
  // oversized ground shadows (see template note on the shadow-caster path).
  const bubbleMeshRes = createSphereGeometry(0.42, 16, 12);
  const bubbleMesh = bubbleMeshRes.ok ? world.allocSharedRef('MeshAsset', bubbleMeshRes.value) : HANDLE_SPHERE;
  const splashMeshRes = createSphereGeometry(0.55, 12, 8);
  const splashMesh = splashMeshRes.ok ? world.allocSharedRef('MeshAsset', splashMeshRes.value) : HANDLE_SPHERE;
  const enemyMeshRes = createSphereGeometry(0.34, 14, 10);
  const enemyMesh = enemyMeshRes.ok ? world.allocSharedRef('MeshAsset', enemyMeshRes.value) : HANDLE_SPHERE;

  //  localized comment
  const markMat = mat([1, 0.85, 0.2, 1], { emissive: [1, 0.7, 0.1], emissiveIntensity: 2.4, roughness: 0.4 });
  const markBar = world.spawn(
    { component: Transform, data: { pos: [10.9, 3.62, 8.4], scale: [0.22, 0.62, 0.22]} },
    { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
    { component: MeshRenderer, data: { materials: [markMat] } },
  ).unwrap();
  const markDot = world.spawn(
    { component: Transform, data: { pos: [10.9, 3.05, 8.4], scale: [0.26, 0.26, 0.26]} },
    { component: MeshFilter, data: { assetHandle: HANDLE_SPHERE } },
    { component: MeshRenderer, data: { materials: [markMat] } },
  ).unwrap();
  let markT = 0;

  // ── game state ───────────────────────────────────────────────────────────────
  interface Mover { tgx: number; tgz: number; dx: number; dz: number; passIdx: number | null }
  interface Bomber extends Mover { hasBomb: boolean }
  interface Enemy extends Bomber {
    body: EntityHandle; hat: EntityHandle;
    name: string;                  //  localized comment
    x: number; z: number;
    speed: number;
    think: number;
    phase: number;                 // jelly hop/wobble phase
  }
  interface Fighter extends Bomber {
    res: Resident; actor: Actor;
    x: number; z: number;
    speed: number; think: number; alive: boolean;
  }
  interface Bubble { e: EntityHandle; gx: number; gz: number; fuse: number; pulse: number; range: number; owner: 'player' | Bomber }
  interface Splash { e: EntityHandle; age: number }
  interface PowerUp { e: EntityHandle; gx: number; gz: number; kind: 0 | 1 | 2; t: number }

  const grid = new Uint8Array(GRID_W * GRID_H);
  const softAt = new Map<number, EntityHandle>();
  const bubbles: Bubble[] = [];
  const splashes: Splash[] = [];
  const enemies: Enemy[] = [];
  const powerUps: PowerUp[] = [];
  const activeBlasts = new Map<number, number>();  // tile idx -> lethal seconds left

  type Mode = 'town' | 'match';
  let mode: Mode = 'town';
  let state: 'banter' | 'playing' | 'won' | 'lost' = 'banter';  // match sub-state
  //  localized comment
  let banterScript: ReadonlyArray<BanterLine> = [];
  let banterIdx = 0;
  let banterT = 0;
  const sayQueue: Array<{ t: number; who: 'player' | 'enemy'; name: string; text: string }> = [];
  const chatQueue: Array<{ t: number; name: string; text: string }> = [];
  let px = 0, pz = 11;                 // player spawns on the plaza path
  let pH = 0, pVy = 0, pGrounded = true; //  localized comment
  let faceX = 0, faceZ = 1;
  let passIdx: number | null = null;   // own-bubble tile still walkable until stepped off
  let range = FIRE_START, maxBubbles = BUBBLE_CAP_START, speed = SPEED_START;
  let score = 0;
  let initialSoft = 0;
  let endgame = false;
  let aiTick = AI_TICK_BASE;
  let guaranteedFire = true;           // onboarding.md: first soft block always drops 🔥
  // onboarding hint state machine (suzu): 0 move → 1 bomb → 2 done (per session)
  let hintStage = 0;
  let hintElapsed = 0;
  //  localized comment
  let duel: { a: Fighter; b: Fighter; phase: 'walk' | 'fight' | 'over'; t: number } | null = null;
  let duelCooldown = DUEL_FIRST_DELAY;
  let heckleT = 6;
  let lastPrompt: string | null = null;
  // Face-to-face dialogue sends one bounded perception snapshot to NPC Brain.
  // The generated pools remain the offline fallback; the game stores no history.
  type TalkLine = { who: string; text: string };
  let simTime = 0;
  const npcBrain = await PaopaotangNpcBrain.connect({
    residents: () => town.residents,
    playerPosition: () => ({ x: px, z: pz }),
    applyIntent: (npcId, intent, ttlSec) => town.applyBodyIntent(npcId, intent, ttlSec),
    expireIntent: (npcId) => { town.expireBodyIntent(npcId); },
    onEmotion: (npcId, mood, towardsPlayer) => { town.applyEmotion(npcId, mood, towardsPlayer); },
    onUtterance: (npcId, lines) => {
      const name = RESIDENT_DEFS.find((item) => item.key === npcId)?.name ?? npcId;
      for (const line of lines) chatQueue.push({ t: 0.1, name, text: line });
    },
  });
  ctx?.registerCleanup?.(() => npcBrain.disconnect());
  let duelWatchT = 0;                     // seconds spent watching the current duel
  let duelWatchCredited = false;          // noteDuelWatched fired for this duel yet?
  let talk: {
    r: Resident; key: string;             // who we're talking to (ResidentDef.key)
    queue: TalkLine[]; t: number;         // lines still to play + per-line countdown
    menuOpen: boolean; topics: TopicDef[];// question menu (memory-sorted) state
    pending: boolean; reqId: number; dotT: number;   // live-LLM request state
  } | null = null;
  let talkReqSeq = 0;
  // Fire a Brain request for the current talk. Stale replies are dropped and
  // transport/validation failure falls back to the generated offline pool.
  const requestNpcLines = (
    kind: 'greet' | 'topic' | 'free',
    playerText: string | undefined,
    fallback: () => readonly string[],
    topicId?: string,
  ): void => {
    if (!talk) return;
    const t0 = talk;
    const id = ++talkReqSeq;
    t0.reqId = id; t0.pending = true; t0.dotT = 0;
    const name = t0.r.def.name;
    npcBrain.ask({ npcId: t0.key, kind, playerText, topicId, now: simTime })
      .then((lines) => {
        if (talk !== t0 || t0.reqId !== id) return;
        t0.pending = false;
        for (const line of lines ?? fallback()) t0.queue.push({ who: name, text: line });
        t0.t = 0.1;
      })
      .catch(() => {
        if (talk !== t0 || t0.reqId !== id) return;
        t0.pending = false;
        for (const line of fallback()) t0.queue.push({ who: name, text: line });
        t0.t = 0.1;
      });
  };

  const idxOf = (gx: number, gz: number): number => gz * GRID_W + gx;
  const inGrid = (gx: number, gz: number): boolean => gx >= 0 && gx < GRID_W && gz >= 0 && gz < GRID_H;
  const playerTile = (): readonly [number, number] => [Math.round(px + HALF_X), Math.round(pz + HALF_Z)] as const;

  const updateHud = (): void => {
    const mine = bubbles.reduce((n, b) => n + (b.owner === 'player' ? 1 : 0), 0);
    hud.setStats({ bubblesAvail: maxBubbles - mine, bubbleCap: maxBubbles, fire: range, speed, score, enemies: enemies.length });
  };
  const setPrompt = (text: string | null): void => {
    if (text === lastPrompt) return;
    lastPrompt = text;
    hud.prompt(text);
  };
  const matchRunning = (): boolean =>
    (duel !== null && duel.phase === 'fight') ||
    (mode === 'match' && (state === 'playing' || state === 'banter'));

  // ── arena movement collision (pure grid — no physics backend needed) ────────
  const blockedForPlayer = (gx: number, gz: number): boolean => {
    if (!inGrid(gx, gz)) return true;
    const v = grid[idxOf(gx, gz)]!;
    if (v === HARD || v === SOFT) return true;
    if (v === BUBBLE) return idxOf(gx, gz) !== passIdx;
    return false;
  };
  const canStand = (x: number, z: number): boolean => {
    const cgx = Math.round(x + HALF_X), cgz = Math.round(z + HALF_Z);
    for (let gx = cgx - 1; gx <= cgx + 1; gx++) {
      for (let gz = cgz - 1; gz <= cgz + 1; gz++) {
        if (!blockedForPlayer(gx, gz)) continue;
        if (Math.abs(x - (gx - HALF_X)) < 0.84 && Math.abs(z - (gz - HALF_Z)) < 0.84) return false;
      }
    }
    return true;
  };
  const blockedForMover = (m: Mover, gx: number, gz: number): boolean => {
    if (!inGrid(gx, gz)) return true;
    const t = idxOf(gx, gz);
    const v = grid[t]!;
    if (v === EMPTY) return false;
    if (v === BUBBLE) return t !== m.passIdx;
    return true;
  };
  // town collision: circle vs pack-derived obstacles + world bounds.
  // h = feet height above the apron — obstacles whose TOP is at/below your feet
  //  localized comment
  // whose BOTTOM clears the hat (lamp bulbs, gate balls) never block at all.
  // Round props collide as ellipses so their edges match what you see.
  const canStandTown = (x: number, z: number, h: number): boolean => {
    if (Math.abs(x) > TOWN_BOUND_X || z < TOWN_BOUND_Z_MIN || z > TOWN_BOUND_Z_MAX) return false;
    for (const ob of townObstacles) {
      if (h >= ob.top - 0.05 || ob.bot >= h + PLAYER_H) continue;
      const rx = ob.hx + PLAYER_R, rz = ob.hz + PLAYER_R;
      const dx = x - ob.cx, dz = z - ob.cz;
      if (ob.round) {
        const ex = dx / rx, ez = dz / rz;
        if (ex * ex + ez * ez < 1) return false;
      } else if (Math.abs(dx) < rx && Math.abs(dz) < rz) return false;
    }
    return true;
  };
  // highest surface under the feet (0 = the apron itself)
  const supportAt = (x: number, z: number, h: number): number => {
    let s = 0;
    const r = PLAYER_R * 0.6;
    for (const ob of townObstacles) {
      if (ob.top > h + 0.06 || ob.top <= s) continue;
      const rx = ob.hx + r, rz = ob.hz + r;
      const dx = x - ob.cx, dz = z - ob.cz;
      const hit = ob.round
        ? (dx / rx) * (dx / rx) + (dz / rz) * (dz / rz) < 1
        : Math.abs(dx) < rx && Math.abs(dz) < rz;
      if (hit) s = ob.top;
    }
    return s;
  };

  // ── transient spawners ───────────────────────────────────────────────────────
  const spawnSplash = (x: number, z: number): void => {
    const e = world.spawn(
      { component: Transform, data: { pos: [x, 0.45, z]} },
      { component: MeshFilter, data: { assetHandle: splashMesh } },
      { component: MeshRenderer, data: { materials: [splashMat] } },
    ).unwrap();
    splashes.push({ e, age: 0 });
  };
  const spawnPowerUp = (gx: number, gz: number): void => {
    // first destroyed block guarantees 🔥 (suzu's onboarding beat), then 1/3 each
    const kind = guaranteedFire ? 0 : (Math.floor(Math.random() * 3) as 0 | 1 | 2);
    guaranteedFire = false;
    const e = world.spawn(
      { component: Transform, data: { pos: [gx - HALF_X, 0.4, gz - HALF_Z], scale: [0.34, 0.34, 0.34]} },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [powerMats[kind]!] } },
    ).unwrap();
    powerUps.push({ e, gx, gz, kind, t: 0 });
  };
  const onEndgameCheck = (): void => {
    if (endgame || softAt.size > initialSoft * ENDGAME_SOFT_RATIO) return;
    endgame = true;
    aiTick = AI_TICK_ENDGAME;
    for (const en of enemies) en.speed = ENEMY_SPEED + ENDGAME_SPEED_BONUS;
    hud.setEndgame(true);
    console.log(`[paopaotang] endgame: soft ${softAt.size}/${initialSoft} <30% → AI tick ${AI_TICK_BASE}s→${aiTick}s, enemy speed +${ENDGAME_SPEED_BONUS}`);
  };
  const destroySoft = (t: number, gx: number, gz: number): void => {
    const e = softAt.get(t);
    if (e !== undefined) { world.despawn(e); softAt.delete(t); }
    grid[t] = EMPTY;
    if (mode === 'match') {           // NPC duels don't feed the player's snowball
      score += SCORE_BLOCK;
      if (guaranteedFire || Math.random() < DROP_CHANCE) spawnPowerUp(gx, gz);
      onEndgameCheck();
    }
  };

  // ── the cross blast (chains other bubbles, stops at hard blocks) ────────────
  const explode = (b: Bubble): void => {
    const i = bubbles.indexOf(b);
    if (i < 0) return;               // already chain-exploded
    bubbles.splice(i, 1);
    world.despawn(b.e);
    if (b.owner !== 'player') b.owner.hasBomb = false;
    const cIdx = idxOf(b.gx, b.gz);
    if (grid[cIdx] === BUBBLE) grid[cIdx] = EMPTY;
    const preExisting = new Set(powerUps);   // drops from THIS blast must survive it
    const tiles: Array<readonly [number, number]> = [[b.gx, b.gz]];
    for (const [dx, dz] of DIRS) {
      for (let s = 1; s <= b.range; s++) {
        const gx = b.gx + dx * s, gz = b.gz + dz * s;
        if (!inGrid(gx, gz)) break;
        const t = idxOf(gx, gz);
        const v = grid[t]!;
        if (v === HARD) break;
        if (v === SOFT) { destroySoft(t, gx, gz); tiles.push([gx, gz]); break; }
        if (v === BUBBLE) {
          tiles.push([gx, gz]);
          const nb = bubbles.find((x) => x.gx === gx && x.gz === gz);
          if (nb) explode(nb);       // chain reaction
          break;
        }
        tiles.push([gx, gz]);
      }
    }
    const tileSet = new Set(tiles.map(([gx, gz]) => idxOf(gx, gz)));
    // Uncollected drops hit by later splash waves are destroyed.
    for (let k = powerUps.length - 1; k >= 0; k--) {
      const p = powerUps[k]!;
      if (preExisting.has(p) && tileSet.has(idxOf(p.gx, p.gz))) {
        world.despawn(p.e);
        powerUps.splice(k, 1);
      }
    }
    for (const [gx, gz] of tiles) {
      activeBlasts.set(idxOf(gx, gz), BLAST_LINGER);
      spawnSplash(gx - HALF_X, gz - HALF_Z);
    }
    if (mode === 'match') updateHud();
  };

  const killEnemy = (en: Enemy): void => {
    const i = enemies.indexOf(en);
    if (i < 0) return;
    enemies.splice(i, 1);
    world.despawn(en.body);
    world.despawn(en.hat);
    spawnSplash(en.x, en.z);
    score += SCORE_KILL;
    updateHud();
    // The defeated jelly delivers a final taunt.
    hud.say('enemy', en.name, pick(ENEMY_DEATH_LINES), 3600);
    if (enemies.length === 0 && state === 'playing') {
      state = 'won';
      npcBrain.noteWin();      // the town will remember its champion
      sayQueue.push({ t: 1.2, who: 'player', name: get("paopaotang.main.ts:32069:5630b886f9"), text: PLAYER_WIN_LINE });
      hud.showWin(score, get("paopaotang.main.ts:32125:51a0879cdd"));
    } else if (Math.random() < PLAYER_TALKBACK_CHANCE) {
      // The player answers with a delayed taunt.
      sayQueue.push({ t: 0.9, who: 'player', name: get("paopaotang.main.ts:32304:5630b886f9"), text: pick(PLAYER_KILL_LINES) });
    }
  };
  const lose = (): void => {
    if (state !== 'playing') return;
    state = 'lost';
    npcBrain.noteFall();       // ...and the tumble, too — NPCs will tease gently
    playerActor.setVisible(false);
    spawnSplash(px, pz);
    // Surviving jellies heckle the defeated player.
    const taunter = enemies.length > 0 ? pick(enemies).name : get("paopaotang.main.ts:32698:bf1bb45d15");
    hud.say('enemy', taunter, pick(ENEMY_GLOAT_LINES), 4200);
    hud.showLose(get("paopaotang.main.ts:32784:15241a9860"));
  };

  // ── level generation (PCG: soft blocks + jellies per match) ─────────────────
  const genArenaBase = (): void => {
    grid.fill(EMPTY);
    // hard pillar lattice (matches the pack's Pillar_* nodes at even/even tiles)
    for (let gx = 2; gx <= GRID_W - 3; gx += 2) {
      for (let gz = 2; gz <= GRID_H - 3; gz += 2) grid[idxOf(gx, gz)] = HARD;
    }
  };
  const genSofts = (fill: number, spawnSafe: ReadonlyArray<readonly [number, number]>): void => {
    const isSafe = (gx: number, gz: number): boolean =>
      spawnSafe.some(([sx, sz]) => Math.abs(gx - sx) + Math.abs(gz - sz) <= 2);
    for (let gx = 0; gx < GRID_W; gx++) {
      for (let gz = 0; gz < GRID_H; gz++) {
        const t = idxOf(gx, gz);
        if (grid[t] !== EMPTY || isSafe(gx, gz) || Math.random() >= fill) continue;
        grid[t] = SOFT;
        const e = world.spawn(
          { component: Transform, data: { pos: [gx - HALF_X, 0.44, gz - HALF_Z], scale: [0.88, 0.88, 0.88]} },
          { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
          { component: MeshRenderer, data: { materials: [softMats[Math.floor(Math.random() * softMats.length)]!] } },
        ).unwrap();
        softAt.set(t, e);
      }
    }
    initialSoft = softAt.size;
  };
  const spawnJellies = (): void => {
    for (let i = 1; i < SPAWNS.length; i++) {
      const [sx, sz] = SPAWNS[i]!;
      const body = world.spawn(
        { component: Transform, data: { pos: [sx - HALF_X, 0.4, sz - HALF_Z]} },
        { component: MeshFilter, data: { assetHandle: enemyMesh } },
        { component: MeshRenderer, data: { materials: [enemyMats[(i - 1) % enemyMats.length]!] } },
      ).unwrap();
      const phase = Math.random() * Math.PI * 2;
      const hat = world.spawn(
        { component: Transform, data: { pos: [sx - HALF_X, 0.76, sz - HALF_Z], scale: [0.32, 0.14, 0.32]} },
        { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
        { component: MeshRenderer, data: { materials: [hatMat] } },
      ).unwrap();
      enemies.push({
        body, hat, name: ENEMY_NAMES[(i - 1) % ENEMY_NAMES.length]!,
        x: sx - HALF_X, z: sz - HALF_Z, tgx: sx, tgz: sz, dx: 0, dz: 0,
        speed: ENEMY_SPEED, think: Math.random() * AI_TICK_BASE, hasBomb: false, passIdx: null, phase,
      });
    }
  };
  const clearArenaEntities = (): void => {
    for (const b of bubbles) world.despawn(b.e);
    for (const s of splashes) world.despawn(s.e);
    for (const p of powerUps) world.despawn(p.e);
    for (const en of enemies) { world.despawn(en.body); world.despawn(en.hat); }
    for (const e of softAt.values()) world.despawn(e);
    bubbles.length = 0; splashes.length = 0; powerUps.length = 0; enemies.length = 0;
    softAt.clear(); activeBlasts.clear();
    grid.fill(EMPTY);
  };

  // ── mode transitions ─────────────────────────────────────────────────────────
  const resetArena = (): void => {
    clearArenaEntities();
    state = 'banter';
    banterScript = pickIntroScript();
    banterIdx = 0; banterT = 0; sayQueue.length = 0;
    hud.clearSay();
    px = -HALF_X; pz = -HALF_Z; faceX = 0; faceZ = 1; passIdx = null;
    playerActor.baseY = ARENA_Y;
    playerActor.face(0, 1);
    playerActor.snapYaw();
    range = FIRE_START; maxBubbles = BUBBLE_CAP_START; speed = SPEED_START; score = 0;
    endgame = false; aiTick = AI_TICK_BASE; guaranteedFire = true;
    genArenaBase();
    genSofts(SOFT_FILL, SPAWNS);
    spawnJellies();
    playerActor.setVisible(true);
    hud.clearBanner();
    hud.setEndgame(false);
    updateHud();
  };
  const startMatch = (): void => {
    if (talk) { town.endPlayerTalk(talk.r); talk = null; hud.menu(null); chatBox.close(); }
    pH = 0; pVy = 0; pGrounded = true;
    mode = 'match';
    hud.setMode('match');
    setPrompt(null);
    hud.chat(REFEREE_NAME, pick(REFEREE_SIGNUP_LINES));
    hud.announce(get("paopaotang.main.ts:36673:35dc13ac55"));
    resetArena();
  };
  const exitToTown = (): void => {
    clearArenaEntities();
    hud.clearBanner();
    hud.clearSay();
    hud.setEndgame(false);
    hud.hint(null);
    mode = 'town';
    hud.setMode('town');
    px = GATE.x; pz = GATE.z;
    pH = 0; pVy = 0; pGrounded = true;
    faceX = 0; faceZ = 1;
    playerActor.baseY = TOWN_Y;
    playerActor.face(0, 1);
    playerActor.snapYaw();
    playerActor.setVisible(true);
    hud.announce(get("paopaotang.main.ts:37147:14e239b8c4"));
  };
  // The fight starts after the scripted banter (or a skip).
  const startFight = (): void => {
    if (state !== 'banter') return;
    state = 'playing';
    hud.clearSay();
    hud.toast(get("paopaotang.main.ts:37388:d0407cb467"));
    if (hintStage === 0) hud.hint(get("paopaotang.main.ts:37433:d7c9f8b24b"));
  };

  // ── shared grid AI (jellies chase the player; fighters chase each other) ────
  // Danger = active splashes + every tile the pending bubbles WILL cover.
  const dangerTiles = (): Set<number> => {
    const d = new Set<number>(activeBlasts.keys());
    for (const b of bubbles) {
      d.add(idxOf(b.gx, b.gz));
      for (const [dx, dz] of DIRS) {
        for (let s = 1; s <= b.range; s++) {
          const gx = b.gx + dx * s, gz = b.gz + dz * s;
          if (!inGrid(gx, gz)) break;
          const v = grid[idxOf(gx, gz)]!;
          if (v === HARD) break;
          d.add(idxOf(gx, gz));
          if (v === SOFT) break;
        }
      }
    }
    return d;
  };

  // BFS checks for a reachable safe tile within eight steps.
  const hasEscape = (start: number, sx: number, sz: number, avoid: ReadonlySet<number>): boolean => {
    const seen = new Set<number>([start]);
    const q: Array<readonly [number, number, number]> = [[sx, sz, 0]];
    while (q.length > 0) {
      const [gx, gz, d] = q.shift()!;
      if (d > 0 && !avoid.has(idxOf(gx, gz))) return true;
      if (d >= 8) continue;
      for (const [dx, dz] of DIRS) {
        const nx = gx + dx, nz = gz + dz;
        if (!inGrid(nx, nz)) continue;
        const t = idxOf(nx, nz);
        if (seen.has(t)) continue;
        const v = grid[t]!;
        if (v === HARD || v === SOFT) continue;
        if (v === BUBBLE && t !== start) continue;
        seen.add(t);
        q.push([nx, nz, d + 1]);
      }
    }
    return false;
  };

  const placeOwnedBubble = (owner: Bomber, gx: number, gz: number, rng: number, bMat: ReturnType<typeof mat>, danger: ReadonlySet<number>): void => {
    const t = idxOf(gx, gz);
    if (grid[t] !== EMPTY) return;
    // Refuse a bomb when its blast leaves no escape route.
    const ownBlast = new Set<number>(danger);
    ownBlast.add(t);
    for (const [dx, dz] of DIRS) {
      for (let s = 1; s <= rng; s++) {
        const nx = gx + dx * s, nz = gz + dz * s;
        if (!inGrid(nx, nz) || grid[idxOf(nx, nz)] === HARD) break;
        ownBlast.add(idxOf(nx, nz));
        if (grid[idxOf(nx, nz)] === SOFT) break;
      }
    }
    if (!hasEscape(t, gx, gz, ownBlast)) return;
    const e = world.spawn(
      { component: Transform, data: { pos: [gx - HALF_X, 0.42, gz - HALF_Z]} },
      { component: MeshFilter, data: { assetHandle: bubbleMesh } },
      { component: MeshRenderer, data: { materials: [bMat] } },
    ).unwrap();
    grid[t] = BUBBLE;
    owner.hasBomb = true;
    owner.passIdx = t;
    bubbles.push({ e, gx, gz, fuse: FUSE, pulse: 0, range: rng, owner });
  };

  // Pick the next tile: flee danger first, then close on the target.
  const chooseDirFor = (m: Mover, txg: number, tzg: number, danger: ReadonlySet<number>): void => {
    const here = idxOf(m.tgx, m.tgz);
    const options = DIRS.filter(([dx, dz]) => !blockedForMover(m, m.tgx + dx, m.tgz + dz));
    if (options.length === 0) { m.dx = 0; m.dz = 0; return; }
    const scored = options.map(([dx, dz]) => {
      const gx = m.tgx + dx, gz = m.tgz + dz;
      let s = Math.abs(gx - txg) + Math.abs(gz - tzg) + Math.random() * 1.5;
      if (danger.has(idxOf(gx, gz))) s += danger.has(here) ? 50 : 1000; // fleeing may cross; idling never enters
      if (dx === m.dx && dz === m.dz) s -= 0.5;                         // mild momentum
      return { dx, dz, s };
    }).sort((a, b) => a.s - b.s);
    const best = scored[0]!;
    // standing safe + every option lethal → wait the blast out
    if (!danger.has(here) && danger.has(idxOf(m.tgx + best.dx, m.tgz + best.dz))) { m.dx = 0; m.dz = 0; return; }
    m.dx = best.dx; m.dz = best.dz;
    m.tgx += best.dx; m.tgz += best.dz;
  };

  // ── Candy Cup NPC duel (spectate from the stands) ───────────────────────────────
  const mkFighter = (res: Resident): Fighter | null => {
    const actor = npcActors.get(res.def.prefix);
    if (!actor) return null;
    return {
      res, actor, x: res.x, z: res.z, tgx: 0, tgz: 0, dx: 0, dz: 0,
      speed: FIGHTER_SPEED, think: Math.random() * 0.5, hasBomb: false, passIdx: null, alive: true,
    };
  };
  const beginDuelFight = (): void => {
    if (!duel) return;
    genArenaBase();
    genSofts(0.5, DUEL_SPAWNS);
    [duel.a, duel.b].forEach((f, i) => {
      town.enterFight(f.res);
      const [gx, gz] = DUEL_SPAWNS[i]!;
      f.x = gx - HALF_X; f.z = gz - HALF_Z; f.tgx = gx; f.tgz = gz;
      f.actor.baseY = ARENA_Y;
      f.actor.face(i === 0 ? 1 : -1, 0);
      f.actor.snapYaw();
    });
    duel.phase = 'fight';
    duel.t = DUEL_TIMEOUT;
    hud.chat(REFEREE_NAME, pick(REFEREE_DUEL_LINES));
    hud.announce(`🥊 Candy Cup: ${duel.a.res.def.name} vs ${duel.b.res.def.name} begins! Press Space to spectate.`);
  };
  const endDuel = (winner: Fighter | null): void => {
    if (!duel || duel.phase === 'over') return;
    if (winner) {
      const loser = winner === duel.a ? duel.b : duel.a;
      hud.announce(`🏆 ${winner.res.def.name} wins the Candy Cup match!`);
      chatQueue.push({ t: 0.6, name: winner.res.def.name, text: pick(DUEL_WIN_LINES) });
      chatQueue.push({ t: 2.0, name: loser.res.def.name, text: pick(DUEL_LOSE_LINES) });
    } else {
      hud.announce(get("paopaotang.main.ts:42621:bbb3a2c8f3"));
    }
    duel.phase = 'over';
    duel.t = 2.4;
  };
  const finishDuel = (): void => {
    if (!duel) return;
    // clear whatever the duel left on the board (player owns no arena state now)
    for (const b of bubbles) world.despawn(b.e);
    bubbles.length = 0;
    for (const e of softAt.values()) world.despawn(e);
    softAt.clear();
    for (const p of powerUps) world.despawn(p.e);
    powerUps.length = 0;
    activeBlasts.clear();
    grid.fill(EMPTY);
    for (const f of [duel.a, duel.b]) {
      f.actor.setVisible(true);
      f.actor.baseY = TOWN_Y;
      town.releaseFromMatch(f.res);
    }
    duel = null;
    duelCooldown = DUEL_COOLDOWN_MIN + Math.random() * DUEL_COOLDOWN_VAR;
  };
  const updateFighter = (f: Fighter, other: Fighter, danger: ReadonlySet<number>, dt: number): void => {
    if (!f.alive) return;
    const gx = Math.round(f.x + HALF_X), gz = Math.round(f.z + HALF_Z);
    const ogx = Math.round(other.x + HALF_X), ogz = Math.round(other.z + HALF_Z);
    f.think -= dt;
    if (f.think <= 0) {
      f.think = 0.55;
      const md = Math.abs(gx - ogx) + Math.abs(gz - ogz);
      if (!f.hasBomb && !danger.has(idxOf(gx, gz))) {
        const sdx = Math.sign(ogx - gx), sdz = Math.sign(ogz - gz);
        const softToward =
          (sdx !== 0 && inGrid(gx + sdx, gz) && grid[idxOf(gx + sdx, gz)] === SOFT) ||
          (sdz !== 0 && inGrid(gx, gz + sdz) && grid[idxOf(gx, gz + sdz)] === SOFT);
        if ((md <= 2 && Math.random() < 0.55) || (softToward && Math.random() < 0.4)) {
          placeOwnedBubble(f, gx, gz, FIGHTER_RANGE, enemyBubbleMat, danger);
        }
      }
    }
    // tile-to-tile motion; route decisions happen at tile centres
    const tx = f.tgx - HALF_X, tz = f.tgz - HALF_Z;
    const ddx = tx - f.x, ddz = tz - f.z;
    const dist = Math.hypot(ddx, ddz);
    const step = f.speed * dt;
    let moving = true;
    if (dist <= step) {
      f.x = tx; f.z = tz;
      if (f.passIdx !== null && (idxOf(f.tgx, f.tgz) !== f.passIdx || grid[f.passIdx] !== BUBBLE)) f.passIdx = null;
      chooseDirFor(f, ogx, ogz, danger);
      moving = f.dx !== 0 || f.dz !== 0;
    } else {
      f.x += (ddx / dist) * step;
      f.z += (ddz / dist) * step;
    }
    if (moving) f.actor.face(f.dx, f.dz);
    f.actor.update(dt, f.x, f.z, moving, 8);
  };

  // ── input map (engine InputSnapshot — no hand-rolled key listeners) ─────────
  const KEY = (key: string) => ({ type: 'key', key } as const);
  const INPUT_MAP: readonly ActionConfig[] = [
    { action: 'moveForward', bindings: [KEY('w'), KEY('W'), KEY('ArrowUp')] },
    { action: 'moveBack', bindings: [KEY('s'), KEY('S'), KEY('ArrowDown')] },
    { action: 'moveLeft', bindings: [KEY('a'), KEY('A'), KEY('ArrowLeft')] },
    { action: 'moveRight', bindings: [KEY('d'), KEY('D'), KEY('ArrowRight')] },
    { action: 'bomb', bindings: [KEY(' ')] },
    { action: 'interact', bindings: [KEY('e'), KEY('E')] },
    { action: 'restart', bindings: [KEY('r'), KEY('R')] },
    { action: 'topic1', bindings: [KEY('1')] },
    { action: 'topic2', bindings: [KEY('2')] },
    { action: 'topic3', bindings: [KEY('3')] },
    { action: 'topic4', bindings: [KEY('4')] },
    { action: 'topic5', bindings: [KEY('5')] },   // localized (free chat with the model)
  ];
  world.insertResource(INPUT_MAP_KEY, INPUT_MAP);
  const EMPTY_SNAP = createInputSnapshot();
  const readInput = (): InputSnapshot =>
    world.hasResource(INPUT_SNAPSHOT_RESOURCE_KEY)
      ? world.getResource<InputSnapshot>(INPUT_SNAPSHOT_RESOURCE_KEY)
      : EMPTY_SNAP;

  // TownSim callbacks — chats land in the HUD feed
  const townApi = {
    chat: (name: string, text: string): void => { hud.chat(name, text); },
    matchRunning,
  };

  // ── boot into town mode ──────────────────────────────────────────────────────
  hud.setMode('town');
  playerActor.face(0, 1);
  playerActor.snapYaw();
  hud.announce(get("paopaotang.main.ts:46528:17cf714e4a"), 6200);

  // ── main update ──────────────────────────────────────────────────────────────
  const tick = (dt: number) => {
      const snap = readInput();
      simTime += dt;
      npcBrain.pulse(simTime);
      for (const resident of town.residents) {
        const waypoint = town.consumeBrainArrival(resident.def.key);
        if (waypoint) npcBrain.arrived(resident.def.key, waypoint, simTime);
      }
      let movingNow = false;

      // gate arrows bob / flags flutter — cheap sine offsets from the rest pose
      gateT += dt;
      for (const g of gateAnim) {
        if (g.kind === 'arrow') {
          world.set(g.e, Transform, { pos: [g.pos[0], g.pos[1] + Math.sin(gateT * 2.6 + g.ph) * 0.16, g.pos[2]] });
        } else {
          const f = 1 + Math.sin(gateT * 3.4 + g.ph) * 0.14;
          world.set(g.e, Transform, { scale: [g.scale[0] * f, g.scale[1], g.scale[2] * (2 - f)] });
        }
      }

      // delayed lines (comebacks / duel afterglow) — never talk over a dying jelly
      for (let i = sayQueue.length - 1; i >= 0; i--) {
        const q = sayQueue[i]!;
        q.t -= dt;
        if (q.t <= 0) { hud.say(q.who, q.name, q.text); sayQueue.splice(i, 1); }
      }
      for (let i = chatQueue.length - 1; i >= 0; i--) {
        const q = chatQueue[i]!;
        q.t -= dt;
        if (q.t <= 0) { hud.chat(q.name, q.text); chatQueue.splice(i, 1); }
      }

      // ── digital life: residents live their day regardless of mode ───────────
      town.update(dt, townApi, { x: px, z: pz });
      for (const r of town.residents) {
        if (r.activity === 'fight') continue;          // the duel sim drives them
        const a = npcActors.get(r.def.prefix);
        if (!a) continue;
        // Brain 'emote' intents layer a gesture over the walk/idle pose (wave hello)
        a.setEmote(r.activity === 'brain' && r.brainIntent?.action === 'emote'
          ? r.brainIntent.emote : null);
        if (r.activity === 'watch' && !r.moving) a.face(-1, 0);   // face the arena
        else a.face(r.faceX, r.faceZ);
        a.update(dt, r.x, r.z, r.moving, 8.5);
      }
      refActor?.update(dt, 10.9, 7.4, false, 6);       // localized mans the booth

      // spectators heckle whatever match is on (yours included)
      if (matchRunning()) {
        heckleT -= dt;
        if (heckleT <= 0) {
          heckleT = 5 + Math.random() * 6;
          const ws = town.watchers();
          if (ws.length > 0) hud.chat(pick(ws).def.name, pick(HECKLE_LINES));
        }
      }

      // ── localized scheduler: pick two bored residents, walk them to the gate ────
      if (mode === 'town' && !duel) {
        duelCooldown -= dt;
        if (duelCooldown <= 0) {
          const pair = town.requestContestants();
          const a = pair && mkFighter(pair[0]);
          const b = pair && mkFighter(pair[1]);
          if (pair && a && b) {
            duel = { a, b, phase: 'walk', t: 30 };
            hud.announce(`📣 Candy Cup starts soon: ${pair[0].def.name} vs ${pair[1].def.name}!`);
            chatQueue.push({ t: 0.8, name: pair[0].def.name, text: pick(DUEL_TAUNTS) });
            chatQueue.push({ t: 2.2, name: pair[1].def.name, text: pick(DUEL_TAUNTS) });
          } else {
            duelCooldown = 10;   // everyone is busy — try again soon
          }
        }
      }
      if (duel && duel.phase === 'walk') {
        duel.t -= dt;
        if (town.bothAtGate([duel.a.res, duel.b.res]) || duel.t <= 0) beginDuelFight();
      }

      const danger = dangerTiles();

      if (duel && duel.phase === 'fight') {
        updateFighter(duel.a, duel.b, danger, dt);
        updateFighter(duel.b, duel.a, danger, dt);
        duel.t -= dt;
        if (duel.t <= 0) endDuel(null);   // draw — nobody blinked
      } else if (duel && duel.phase === 'over') {
        duel.t -= dt;
        // losers still animate their last frame; winner idles until cleanup
        for (const f of [duel.a, duel.b]) if (f.alive) f.actor.update(dt, f.x, f.z, false, 8);
        if (duel.t <= 0) finishDuel();
      }

      // ══ TOWN MODE ═══════════════════════════════════════════════════════════
      if (mode === 'town') {
        const typing = chatBox.isOpen();   // free-chat box owns the keyboard
        const move = typing
          ? { x: 0, y: 0 }
          : snap.getVector('moveLeft', 'moveRight', 'moveBack', 'moveForward');
        let mvx = move.x, mvz = -move.y;
        const len = Math.hypot(mvx, mvz);
        if (len > 1e-3) {
          movingNow = true;
          mvx /= len; mvz /= len;
          faceX = mvx; faceZ = mvz;
          const step = TOWN_WALK_SPEED * dt;
          const nx = px + mvx * step;
          if (canStandTown(nx, pz, pH)) px = nx;
          const nz = pz + mvz * step;
          if (canStandTown(px, nz, pH)) pz = nz;
        }
        // ── localized: hop onto benches / booth counter / the stand tiers ──────
        if (!typing && pGrounded && snap.action('bomb').justPressed()) {
          pVy = JUMP_V;
          pGrounded = false;
          playerActor.squash();          // take-off crouch — the hop should be felt
        }
        const prevH = pH;
        pVy -= GRAVITY * dt;
        pH = Math.max(0, pH + pVy * dt);
        const support = supportAt(px, pz, Math.max(prevH, pH));
        if (pH <= support && pVy <= 0) {
          if (!pGrounded && pVy < -5.5) playerActor.squash();   // landing plop
          pH = support; pVy = 0; pGrounded = true;
        } else if (pH > support + 1e-3) {
          pGrounded = false;             // walked off an edge → fall
        }
        playerActor.baseY = TOWN_Y + pH;
        // ── interactions: ongoing chat > signup booth > nearby resident ───────
        const nearBooth = Math.hypot(px - BOOTH_SPOT.x, pz - BOOTH_SPOT.z) < 2.1;
        if (talk) {
          const r = talk.r;
          const isLeading = r.activity === 'talkLeading';
          // walking away ends the chat (unless NPC is leading the player)
          // when leading, use a larger break distance so player can follow
          const breakDist = isLeading ? TALK_BREAK_DIST * 2.5 : TALK_BREAK_DIST;
          if ((r.activity !== 'talkPlayer' && r.activity !== 'talkLeading') || Math.hypot(px - r.x, pz - r.z) > breakDist) {
            if (r.activity === 'talkPlayer' || r.activity === 'talkLeading') town.endPlayerTalk(r);
            talk = null;
            hud.menu(null);
            chatBox.close();
            setPrompt(null);
          } else {
            const dx = r.x - px, dz = r.z - pz, L = Math.hypot(dx, dz) || 1;
            if (!movingNow) { faceX = dx / L; faceZ = dz / L; }
            if (isLeading) {
              if (r.leadArrived && !r.leadArrivalAnnounced) {
                hud.chat(r.def.name, 'Here we are! 📍');
                r.leadArrivalAnnounced = true;
              }
            } else {
              // A stationary conversation keeps both actors face to face.
              r.faceX = -dx / L; r.faceZ = -dz / L;
            }
            if (isLeading && !r.leadArrived && talk.menuOpen) {
              talk.menuOpen = false;
              hud.menu(null);
            }
            if (talk.menuOpen && chatBox.isOpen()) {
              // player is typing a free-chat message — the box owns the keys
              setPrompt(get("paopaotang.main.ts:53133:fd51395922"));
            } else if (talk.menuOpen) {
              // question menu — answers are generated LIVE by the model
              setPrompt(get("paopaotang.main.ts:53298:ab9cb6579d"));
              let picked: TopicDef | null = null;
              for (let i = 0; i < talk.topics.length && i < 4; i++) {
                if (snap.action(`topic${i + 1}`).justPressed()) picked = talk.topics[i]!;
              }
              if (picked) {
                talk.menuOpen = false;
                hud.menu(null);
                talk.queue.push({ who: get("paopaotang.main.ts:53690:5630b886f9"), text: picked.ask });
                talk.t = 0.15;
                const tKey = talk.key;
                const topicId = picked.id;
                requestNpcLines('topic', picked.ask,
                  () => npcBrain.fallbackAnswer(tKey, topicId), topicId);
              } else if (snap.action('topic5').justPressed()) {
                // localized — type anything; the model answers in character
                const t0 = talk;
                chatBox.open(`Chat with ${r.def.name}...`, (text) => {
                  if (talk !== t0) return;                    // chat ended meanwhile
                  t0.menuOpen = false;
                  hud.menu(null);
                  t0.queue.push({ who: get("paopaotang.main.ts:54391:5630b886f9"), text });
                  t0.t = 0.15;
                  requestNpcLines('free', text,
                    () => [get("paopaotang.main.ts:54511:2ee976753a")]);
                }, () => { /* Esc — stay on the menu */ });
              } else if (snap.action('interact').justPressed()) {
                const tKey = talk.key;
                const name = r.def.name;
                const fallbackBye = npcBrain.fallbackFarewell(tKey);
                npcBrain.ask({ npcId: tKey, kind: 'farewell', now: simTime })
                  .then((lines) => hud.chat(name, lines?.[0] ?? fallbackBye))
                  .catch(() => hud.chat(name, fallbackBye));
                hud.menu(null);
                town.endPlayerTalk(r);
                talk = null;
                setPrompt(null);
              }
            } else if (talk.pending && talk.queue.length === 0) {
              // the model is composing — animated thinking bubble
              talk.dotT += dt;
              setPrompt(`💭 ${r.def.name} is thinking${'·'.repeat(1 + (Math.floor(talk.dotT * 3) % 3))}`);
            } else {
              const destination = r.leadTarget ? (WAYPOINT_NAMES[r.leadTarget] ?? r.leadTarget) : '';
              setPrompt(isLeading
                ? `Following ${r.def.name}${destination ? ` to ${destination}` : ''}... 🚶`
                : get("paopaotang.main.ts:55484:3d93b61bc9"));
              if (snap.action('interact').justPressed()) talk.t = 0;   // skip ahead
              talk.t -= dt;
              if (talk.t <= 0) {
                const line = talk.queue.shift();
                if (line) {
                  hud.chat(line.who, line.text);
                  talk.t = TALK_LINE_S;
                }
                if (talk.queue.length === 0 && !talk.pending) {
                  if (r.activity === 'talkLeading' && !r.leadArrived) {
                    // Keep the route visible while the NPC is moving. Reopening
                    // the menu here hides the "Following…" state and makes a
                    // successful lead decision look like a failed reply loop.
                    talk.menuOpen = false;
                    hud.menu(null);
                  } else {
                    // Lines done: show the stable menu; memory/order lives in Brain.
                    talk.menuOpen = true;
                    talk.topics = [...npcBrain.topics];
                    hud.menu([
                      ...talk.topics.slice(0, 4).map((tp, i) => `${i + 1} · ${tp.label}`),
                      get("paopaotang.main.ts:56208:8e3ce667e6"),
                      get("paopaotang.main.ts:56243:9114d9adae"),
                    ]);
                  }
                }
              }
            }
          }
        } else if (nearBooth && !duel) {
          setPrompt(get("paopaotang.main.ts:56398:2a279f7552"));
          if (snap.action('interact').justPressed()) startMatch();
        } else if (nearBooth && duel) {
          setPrompt(get("paopaotang.main.ts:56543:15143340af"));
          if (snap.action('interact').justPressed()) hud.chat(REFEREE_NAME, pick(REFEREE_BUSY_LINES));
        } else {
          // nearest chattable resident within arm's reach
          let target: Resident | null = null;
          let bd = TALK_RANGE;
          for (const r of town.residents) {
            if (r.activity === 'fight' || r.activity === 'toArena') continue;
            const d = Math.hypot(px - r.x, pz - r.z);
            if (d < bd) { bd = d; target = r; }
          }
          if (target) {
        setPrompt(`Press E to chat with ${target.def.name} 💬`);
            if (snap.action('interact').justPressed()) {
              town.beginPlayerTalk(target);
              const key = target.def.key;
              const fallbackGreet = npcBrain.fallbackGreeting(key);
              talk = {
                r: target, key, menuOpen: false, topics: [],
                queue: [], t: 0.3, pending: false, reqId: 0, dotT: 0,
              };
              requestNpcLines('greet', undefined, () => [fallbackGreet]);
            }
          } else {
            setPrompt(null);
          }
        }
      }

      // ══ MATCH MODE (the classic arena battle vs 3 jellies) ══════════════════
      if (mode === 'match') {
        // R mid-run restarts instantly; after death/win R returns to town
        // (hud-spec localized: banner localized 0.5s localized R localized)
        if (snap.action('restart').justPressed()) {
          if (state === 'playing') resetArena();
          else if ((state === 'won' || state === 'lost') && hud.retryAllowed()) exitToTown();
        }

        // onboarding strip self-destructs after its window even if unused
        if (state === 'playing' && hintStage < 2) {
          hintElapsed += dt;
          if (hintElapsed > HINT_TIMEOUT_S) { hintStage = 2; hud.hint(null); }
        }

        // — localized: scripted smack-talk exchange before the fight (Space skips) —
        if (state === 'banter') {
          if (snap.action('bomb').justPressed()) startFight();
          else {
            banterT -= dt;
            if (banterT <= 0) {
              if (banterIdx >= banterScript.length) startFight();
              else {
                const line = banterScript[banterIdx++]!;
                hud.say(line.who, line.who === 'player' ? get("paopaotang.main.ts:58830:5630b886f9") : pick(ENEMY_NAMES), line.text, 3400);
                banterT = BANTER_LINE_S;
              }
            }
            // jellies bounce impatiently while talking smack
            for (const en of enemies) {
              en.phase += dt * 9;
              const hop = Math.abs(Math.sin(en.phase)) * 0.09;
              world.set(en.body, Transform, { pos: [en.x, 0.4 + hop, en.z]});
              world.set(en.hat, Transform, { pos: [en.x, 0.76 + hop, en.z]});
            }
          }
        }

        if (state === 'playing') {
          // — player movement (axis-separated → wall sliding) —
          const move = snap.getVector('moveLeft', 'moveRight', 'moveBack', 'moveForward');
          let mvx = move.x, mvz = -move.y;
          const len = Math.hypot(mvx, mvz);
          if (len > 1e-3) {
            movingNow = true;
            mvx /= len; mvz /= len;
            faceX = mvx; faceZ = mvz;
            const step = speed * dt;
            const nx = px + mvx * step;
            if (canStand(nx, pz)) px = nx;
            const nz = pz + mvz * step;
            if (canStand(px, nz)) pz = nz;
            if (hintStage === 0) { hintStage = 1; hud.hint(get("paopaotang.main.ts:60008:e9615b9fe4")); }
          }

          // step off your own bubble's tile → it becomes solid (pillar P2).
          // Cleared by ACTUAL overlap, not tile rounding (0.86 = 0.84 + hysteresis).
          const [pgx, pgz] = playerTile();
          const pIdx = idxOf(pgx, pgz);
          if (passIdx !== null) {
            if (grid[passIdx] !== BUBBLE) passIdx = null;
            else {
              const bx = (passIdx % GRID_W) - HALF_X;
              const bz = Math.floor(passIdx / GRID_W) - HALF_Z;
              if (Math.abs(px - bx) >= 0.86 || Math.abs(pz - bz) >= 0.86) passIdx = null;
            }
          }

          // — place bubble (Space) —
          const mine = bubbles.reduce((n, b) => n + (b.owner === 'player' ? 1 : 0), 0);
          if (snap.action('bomb').justPressed() && mine < maxBubbles && grid[pIdx] === EMPTY) {
            const e = world.spawn(
              { component: Transform, data: { pos: [pgx - HALF_X, 0.42, pgz - HALF_Z]} },
              { component: MeshFilter, data: { assetHandle: bubbleMesh } },
              { component: MeshRenderer, data: { materials: [bubbleMat] } },
            ).unwrap();
            grid[pIdx] = BUBBLE;
            passIdx = pIdx;
            playerActor.squash();   // little "plop" — the drop should be felt
            bubbles.push({ e, gx: pgx, gz: pgz, fuse: FUSE, pulse: 0, range, owner: 'player' });
            if (hintStage <= 1) { hintStage = 2; hud.hint(null); }
            updateHud();
          }

          // — power-up pickup + idle animation —
          for (let i = powerUps.length - 1; i >= 0; i--) {
            const p = powerUps[i]!;
            p.t += dt;
            const q = quat.eulerY(p.t * 2.2);
            world.set(p.e, Transform, { pos: [p.gx - HALF_X, 0.4 + Math.sin(p.t * 3) * 0.08, p.gz - HALF_Z], quat: [q[0]!, q[1]!, q[2]!, q[3]!]});
            if (Math.hypot(px - (p.gx - HALF_X), pz - (p.gz - HALF_Z)) < 0.55) {
              if (p.kind === 0) { range = Math.min(FIRE_MAX, range + 1); hud.toast(get("paopaotang.main.ts:62017:794856b987")); }
              else if (p.kind === 1) { maxBubbles = Math.min(BUBBLE_CAP_MAX, maxBubbles + 1); hud.toast(get("paopaotang.main.ts:62137:f84ac04907")); }
              else { speed = Math.min(SPEED_MAX, speed + SPEED_STEP); hud.toast(get("paopaotang.main.ts:62235:079e4bbdfb")); }
              score += SCORE_PICKUP;
              world.despawn(p.e);
              powerUps.splice(i, 1);
              updateHud();
            }
          }

          // — enemies: flee splash > chase player > bomb-and-block —
          for (const en of enemies) {
            en.think -= dt;
            if (en.think <= 0) {
              en.think = aiTick;
              const egx = Math.round(en.x + HALF_X), egz = Math.round(en.z + HALF_Z);
              const md = Math.abs(egx - pgx) + Math.abs(egz - pgz);
              if (!en.hasBomb && !danger.has(idxOf(egx, egz))) {
                const wantsTrap = md <= ENEMY_BOMB_DIST && Math.random() < ENEMY_BOMB_CHANCE;
                const sdx = Math.sign(pgx - egx), sdz = Math.sign(pgz - egz);
                const softToward =
                  (sdx !== 0 && inGrid(egx + sdx, egz) && grid[idxOf(egx + sdx, egz)] === SOFT) ||
                  (sdz !== 0 && inGrid(egx, egz + sdz) && grid[idxOf(egx, egz + sdz)] === SOFT);
                const wantsDig = softToward && Math.random() < ENEMY_DIG_CHANCE;
                if (wantsTrap || wantsDig) placeOwnedBubble(en, egx, egz, 1, enemyBubbleMat, danger);
              }
            }
            // tile-to-tile motion; route decisions happen at tile centres
            const tx = en.tgx - HALF_X, tz = en.tgz - HALF_Z;
            const ddx = tx - en.x, ddz = tz - en.z;
            const dist = Math.hypot(ddx, ddz);
            const step = en.speed * dt;
            if (dist <= step) {
              en.x = tx; en.z = tz;
              if (en.passIdx !== null && (idxOf(en.tgx, en.tgz) !== en.passIdx || grid[en.passIdx] !== BUBBLE)) en.passIdx = null;
              chooseDirFor(en, pgx, pgz, danger);
            } else {
              en.x += (ddx / dist) * step;
              en.z += (ddz / dist) * step;
            }
            // jelly hop: enemies bounce along instead of gliding like ghosts
            en.phase += dt * (7 + en.speed);
            const hop = Math.abs(Math.sin(en.phase)) * 0.06;
            const jw = Math.sin(en.phase * 2) * 0.07;
            world.set(en.body, Transform, { pos: [en.x, 0.4 + hop, en.z], scale: [1 - jw * 0.6, 1 + jw, 1 - jw * 0.6]});
            world.set(en.hat, Transform, { pos: [en.x, 0.76 + hop + jw * 0.05, en.z]});
          }
        }
      }

      // — bubble fuse (ticks in every mode so pending blasts always resolve) —
      for (const b of bubbles) {
        b.fuse -= dt;
        b.pulse += dt;
        // localized: last 0.4s flashes hard (balance.md)
        const s = b.fuse < WARN_T
          ? 1 + 0.16 * Math.sin(b.pulse * 18)
          : 1 + 0.06 * Math.sin(b.pulse * 6);
        world.set(b.e, Transform, { scale: [s, s, s]});
      }
      for (;;) {
        const due = bubbles.find((b) => b.fuse <= 0);
        if (!due) break;
        explode(due);
      }

      // — blast lethality decay + damage —
      for (const [t, left] of activeBlasts) {
        const nl = left - dt;
        if (nl <= 0) activeBlasts.delete(t);
        else activeBlasts.set(t, nl);
      }
      if (mode === 'match' && state === 'playing') {
        const [pgx, pgz] = playerTile();
        if (activeBlasts.has(idxOf(pgx, pgz))) lose();
        for (let i = enemies.length - 1; i >= 0; i--) {
          const en = enemies[i]!;
          const egx = Math.round(en.x + HALF_X), egz = Math.round(en.z + HALF_Z);
          if (activeBlasts.has(idxOf(egx, egz))) killEnemy(en);
        }
      }
      if (duel && duel.phase === 'fight') {
        for (const f of [duel.a, duel.b]) {
          if (!f.alive) continue;
          const gx = Math.round(f.x + HALF_X), gz = Math.round(f.z + HALF_Z);
          if (activeBlasts.has(idxOf(gx, gz))) {
            f.alive = false;
            spawnSplash(f.x, f.z);
            f.actor.setVisible(false);
          }
        }
        const alive = [duel.a, duel.b].filter((f) => f.alive);
        if (alive.length <= 1) endDuel(alive[0] ?? null);
      }

      // — splash visuals (shrink + fade out) —
      for (let i = splashes.length - 1; i >= 0; i--) {
        const s = splashes[i]!;
        s.age += dt;
        if (s.age >= SPLASH_LIFE) { world.despawn(s.e); splashes.splice(i, 1); continue; }
        const k = 1 - (s.age / SPLASH_LIFE) * 0.7;
        world.set(s.e, Transform, { scale: [k, k, k]});
      }

      // — localized marker: bob + spin so the booth reads from across town —
      markT += dt;
      const mq = quat.eulerY(markT * 2.2);
      const mBob = Math.sin(markT * 3) * 0.14;
      world.set(markBar, Transform, { pos: [10.9, 3.62 + mBob, 8.4], quat: [mq[0]!, mq[1]!, mq[2]!, mq[3]!]});
      world.set(markDot, Transform, { pos: [10.9, 3.05 + mBob, 8.4]});

      // — drive the player rig (walk cycle cadence scales with 👟 in matches) —
      playerActor.face(faceX, faceZ);
      const cadence = 5 + (mode === 'match' ? speed : TOWN_WALK_SPEED) * 1.5;
      playerActor.update(dt, px, pz, movingNow, cadence);

      // — camera: town follow / stands view during a duel / arena overview —
      let wantX: number, wantY: number, wantZ: number;
      let lookX: number, lookY: number, lookZ: number;
      // spectating counts from the fence gap AND from on top of the stands
      const watching = duel !== null && duel.phase !== 'walk' &&
        px > 7.7 && px < 13.4 && Math.abs(pz) < 5.6;
      // linger a moment and the whole town remembers you came to watch
      if (duel !== null && watching && mode === 'town') {
        duelWatchT += dt;
        if (!duelWatchCredited && duelWatchT > 2.5) {
          duelWatchCredited = true;
          npcBrain.noteDuelWatched();
        }
      } else if (duel === null) {
        duelWatchT = 0; duelWatchCredited = false;
      }
      if (mode === 'match') {
        wantX = 0; wantY = 14; wantZ = 8;
        lookX = 0; lookY = 0; lookZ = 0;
      } else if (watching) {
        wantX = 15.5; wantY = 7.5; wantZ = 0;      // over the stands, facing the arena
        lookX = 0; lookY = 0.6; lookZ = 0;
      } else {
        wantX = px; wantY = 6.8; wantZ = pz + 8.6; // third-person follow
        lookX = px; lookY = 1.0; lookZ = pz;
      }
      const ck = Math.min(1, dt * 3.5);
      camX += (wantX - camX) * ck;
      camY += (wantY - camY) * ck;
      camZ += (wantZ - camZ) * ck;
      const cq = lookAt(camX, camY, camZ, lookX, lookY, lookZ);
      world.set(camE, Transform, { pos: [camX, camY, camZ], quat: [cq[0]!, cq[1]!, cq[2]!, cq[3]!]});
  };
  if (playerRig.root !== undefined) {
    if (registerUpdate) {
      registerUpdate(tick);
    } else {
      world.addSystem(Update, {
        name: 'paopaotang-main-update',
        queries: [],
        fn: () => { tick(world.getResource(Time).delta); },
      }).unwrap();
    }
  } else {
    console.error('[paopaotang] Player rig not found in the scene pack — update loop not registered');
  }
}
