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
//    WASD            move                Shift          sprint
//    Mouse           aim (2.5D: ground cursor · 3rd person: look)
//    Left-click      cast selected skill
//    1/2/3/4         select + cast skill (熔火弹/霜牙/电弧涌/影踏)
//    V               toggle 2.5D ⇄ third-person view
//    R               respawn after death
//    Esc             release pointer-lock
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
  Materials,
  MeshFilter,
  MeshRenderer,
  Name,
  PointLight,
  SceneInstance,
  Skin,
  Skylight,
  SkyboxBackground,
  SKYBOX_MODE_CUBEMAP,
  TONEMAP_ACES_FILMIC,
  Transform,
  HANDLE_CUBE,
  HANDLE_QUAD,
  perspective,
  quat,
  type MaterialAsset,
} from '@forgeax/engine-runtime';
import { createCylinderGeometry } from '@forgeax/engine-geometry';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { BootstrapContext } from '@forgeax/engine-app';
import type { AnimationClip, Handle, MeshAsset, SceneAsset, TextureAsset } from '@forgeax/engine-types';
import { SKY_DOME_MESH_GUID, SKY_DOME_MATERIAL_GUID } from './src/sky-dome.gen';

import { createPlayer, damagePlayer, grantXp, respawnPlayer, tickPlayer } from './src/state';
import { FxSystem } from './src/fx';
import { MonsterManager, MONSTERS, type Monster } from './src/monsters';
import { SkillSystem, SKILLS } from './src/skills';
import { LootSystem } from './src/loot';
import { installHud, type EquipSlotState, type SkillSlotState } from './src/hud';
import { Dungeon, DUNGEON_ORIGIN } from './src/dungeon';
import { Sfx } from './src/sfx';
import {
  computeBonus, emptyEquipment, itemTooltipLines, rollDrop,
  RARITY_META, SLOT_META, SLOT_ORDER,
  type EquipBonus, type Item,
} from './src/items';
import { installInventory } from './src/inventory-ui';

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

// ── asset GUIDs (mirror assets/characters/characterw-merged.glb.meta.json
//    subAssets[]). characterw = wb-gen3d meshy humanoid (24-joint rig); the
//    per-motion GLBs were merged by scripts/merge-gen3d-motions.ts. Var kept
//    as WITCH to avoid churning every reference; the hero is now characterw. ─
const WITCH = {
  scene:  '019f41e5-1d62-78b4-81b6-8effb359372c',
  clips: [
    { name: 'idle',   guid: '019f41e5-1d62-78b4-81b6-8f039bda8de4' },
    { name: 'move',   guid: '019f41e5-1d62-78b4-81b6-8f04bb5542cd' },
    { name: 'attack', guid: '019f41e5-1d62-78b4-81b6-8f058d93bc4f' },
    { name: 'hit',    guid: '019f41e5-1d62-78b4-81b6-8f066f46b331' },
    { name: 'death',  guid: '019f41e5-1d62-78b4-81b6-8f077d27f1a5' },
  ] as const,
  } as const;
// characterw (meshy humanoid) renders smaller + slighter than witch; a uniform
// rig scale ups the whole skinned mesh. The skinning fix below pins the mesh
// node to identity, so rig scale reaches vertices exactly once via the palette
// — no double-transform. Tune by eye against the scene tiles.
const PLAYER_SCALE = 1.3;
// Fallback background clear. The visible sky is the emissive dome (installSkyDome,
// a plain textured mesh → works on every platform incl. WebKit), but it loads
// async; this dark hellish red-orange fills the frame until it pops in and shows
// through if the dome ever fails to load, instead of clearing to black. Needs no
// GPU feature. Linear/pre-tonemap (ACES). perspective() carries clearR/G/B=0, so
// spread SKY_CLEAR AFTER it on every Camera write (spawn + resize re-apply).
const SKY_CLEAR = { clearR: 0.32, clearG: 0.07, clearB: 0.035 } as const;

// ── HDR sky (code-side — the cow-level / fps pattern) ─────────────────────
// `SkyboxBackground` and the IBL `Skylight` ONLY accept a runtime `cubemap`
// handle, produced by `uploadCubemapFromEquirect` — a path that exists solely
// in the game runtime on Chromium (it needs rgba16float render targets the
// editor and WebKit/WKWebView lack). So the sky MUST be installed here in code,
// never declaratively in the pack: a declarative SkyboxBackground has no cubemap
// to bind and samples uninitialised GPU memory → rainbow static (what broke the
// editor). We always spawn a solid-color Skylight first (binds the engine's 1×1
// white irradiance cube → ambient on frame 1, works everywhere), then upgrade
// to the projected HDR cubemap + a visible skybox only where the projection is
// available. Everywhere else the Camera's SKY_CLEAR red-orange is the sky.
const SKY_HDR_GUID = 'c4061caa-8127-42a8-a1bb-54ef1a83d6d2';

type SkyCtx = {
  world: World;
  assets?: import('@forgeax/engine-runtime').AssetRegistry;
  app?: import('@forgeax/engine-app').App;
};

async function installHdrSky(ctx: SkyCtx): Promise<void> {
  // Dim warm fill suits the forge; the HDR cubemap overrides it on Chromium.
  const skylight = ctx.world.spawn(
    { component: Skylight, data: { colorR: 0.95, colorG: 0.6, colorB: 0.45, intensity: 0.28 } },
  ).unwrap() as EntityHandle;

  // WebKit/WKWebView (desktop app) can't project → keep the solid ambient.
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (!/Chrome|Chromium|Edg/.test(ua)) {
    console.info('[hellforge] non-Chromium WebGPU: solid-color skylight only (no IBL/skybox)');
    return;
  }
  const store = (ctx.app as unknown as { renderer?: { store?: Record<string, unknown> } })?.renderer?.store;
  // The projector was renamed to the private `_uploadCubemapFromEquirect` in
  // this engine build; the old public name is gone. Accept either.
  const uploadFn = store?.uploadCubemapFromEquirect ?? store?._uploadCubemapFromEquirect;
  if (!ctx.assets || typeof uploadFn !== 'function') {
    console.info('[hellforge] no equirect→cubemap projector on the render store — solid ambient + SKY_CLEAR sky');
    return;
  }
  const guidRes = AssetGuid.parse(SKY_HDR_GUID);
  if (!guidRes.ok) return;
  const podRes = await ctx.assets.loadByGuid<TextureAsset>(guidRes.value);
  if (!podRes.ok) { console.warn('[hellforge] sky.hdr loadByGuid failed:', (podRes.error as { code?: string }).code); return; }
  const srcHandle = ctx.world.allocSharedRef<'TextureAsset', TextureAsset>('TextureAsset', podRes.value);
  const upload = uploadFn as (w: unknown, h: unknown, p: unknown) => Promise<{ ok: boolean; value?: unknown }>;
  const cubemapRes = await upload.call(store, ctx.world, srcHandle, podRes.value);
  if (!cubemapRes.ok || cubemapRes.value === undefined) { console.warn('[hellforge] equirect→cubemap projection failed'); return; }
  // Upgrade to image-based lighting (neutral tint lets the HDR drive color).
  ctx.world.set(skylight, Skylight, { cubemap: cubemapRes.value, colorR: 1, colorG: 1, colorB: 1, intensity: 0.14 });
  ctx.world.spawn({ component: SkyboxBackground, data: { cubemap: cubemapRes.value, mode: SKYBOX_MODE_CUBEMAP } });
  console.log('[hellforge] HDR sky installed (cubemap skybox + IBL)');
}

// ── visible sky dome ──────────────────────────────────────────────────────
// This engine build doesn't render SkyboxBackground, so the HDR only ever
// LIGHTS the scene (IBL). To actually SEE the hellish sky we draw a giant
// inverted sphere with an emissive equirect texture (baked by scripts/bake-sky.ts,
// GUIDs in src/sky-dome.gen.ts). Emissive → unaffected by scene lighting; radius
// < camera far (200); recentred on the player each frame so it reads as infinite.
const SKY_DOME_RADIUS = 160;

async function installSkyDome(ctx: SkyCtx): Promise<EntityHandle | null> {
  if (!ctx.assets) return null;
  const meshGuid = AssetGuid.parse(SKY_DOME_MESH_GUID);
  const matGuid = AssetGuid.parse(SKY_DOME_MATERIAL_GUID);
  if (!meshGuid.ok || !matGuid.ok) { console.warn('[hellforge] sky-dome GUID parse failed'); return null; }
  const meshRes = await ctx.assets.loadByGuid<MeshAsset>(meshGuid.value);
  if (!meshRes.ok) { console.warn('[hellforge] sky-dome mesh load failed:', (meshRes.error as { code?: string }).code); return null; }
  const matRes = await ctx.assets.loadByGuid<MaterialAsset>(matGuid.value);
  if (!matRes.ok) { console.warn('[hellforge] sky-dome material load failed:', (matRes.error as { code?: string }).code); return null; }
  const meshH = ctx.world.allocSharedRef<'MeshAsset', MeshAsset>('MeshAsset', meshRes.value);
  const matH = ctx.world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', matRes.value);
  const dome = ctx.world.spawn(
    { component: Transform, data: { posX: 0, posY: 0, posZ: 0, scaleX: SKY_DOME_RADIUS, scaleY: SKY_DOME_RADIUS, scaleZ: SKY_DOME_RADIUS } },
    { component: MeshFilter, data: { assetHandle: meshH } },
    { component: MeshRenderer, data: { materials: [matH] } },
  ).unwrap() as EntityHandle;
  console.log('[hellforge] sky dome installed (emissive equirect dome)');
  return dome;
}

export async function bootstrap(world: World, ctx?: BootstrapContext) {
  const { assets, registerUpdate, app } = ctx ?? {};
  // Host-controlled UI mount + cleanup sink (■ Stop teardown). UI must attach
  // to uiMount (not document.body); non-DOM side effects register via onCleanup.
  const uiMount: HTMLElement = ctx?.uiRoot ?? (typeof document !== 'undefined' ? document.body : (undefined as never));
  const onCleanup = ctx?.registerCleanup ?? (() => {});

  // ── canvas ────────────────────────────────────────────────────────────
  const canvas = document.querySelector<HTMLCanvasElement>('#app')!;
  const dpr = window.devicePixelRatio || 1;
  const sizeCanvas = () => {
    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  };
  sizeCanvas();
  let aspect = canvas.width / canvas.height;

  // ── 1. encampment scene (engine-native pack) ──────────────────────────
  // The host resolves + instantiates the defaultScene before entry runs; the
  // encampment root is a side-effect spawn (hellforge never reads its mapping).

  // ── 2. HDR sky (code-side; see installHdrSky above). Fire-and-forget: the
  //       sky pops in when the projection completes; the game never blocks. ──
  void installHdrSky({ world, assets, app });

  // ── 2b. Visible sky dome (emissive equirect sphere; see installSkyDome). The
  //        engine won't render SkyboxBackground, so this is what you actually
  //        see. Fire-and-forget; followed by the update loop once loaded. ──
  let skyDome: EntityHandle | null = null;
  void installSkyDome({ world, assets }).then((e) => { skyDome = e; });

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
    { component: Transform, data: { posX: 0, posY: 0, posZ: 5, scaleX: PLAYER_SCALE, scaleY: PLAYER_SCALE, scaleZ: PLAYER_SCALE } },
  ).unwrap() as EntityHandle;

  let witchRoot: EntityHandle | null = null;
  let witchSkinEnt: EntityHandle | null = null;
  try {
    const sceneGuid = AssetGuid.parse(WITCH.scene);
    if (!sceneGuid.ok) throw new Error('witch scene guid parse');
    // engine e53f4616: `loadByGuid` returns the PAYLOAD. `instantiate` wants a
    // Handle, so mint one via `world.allocSharedRef`; clip handles passed to
    // AnimationPlayer are likewise minted from each clip payload, and the clip
    // duration is read straight off the payload (no more `assets.get`).
    const sceneRes = await assets.loadByGuid<SceneAsset>(sceneGuid.value);
    if (!sceneRes.ok) throw new Error('witch scene loadByGuid: ' + ((sceneRes.error as { code?: string }).code ?? '?'));
    for (const def of WITCH.clips) {
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
        posX: 0, posY: 0, posZ: 0,
        quatX: 0, quatY: 0, quatZ: 0, quatW: 1,
        scaleX: 1, scaleY: 1, scaleZ: 1,
      });
    } else {
      console.warn('[hellforge] witch spawned but Skin entity / idle clip missing — animation off');
    }
    console.log('[hellforge] witch loaded — clips:', [...clipHandles.keys()]);
  } catch (err) {
    console.warn('[hellforge] witch.glb sub-asset load failed — placeholder:', (err as Error).message);
    // engine e53f4616: `assets.register(payload).unwrap()` (payload → handle)
    // is gone; mint the in-code anonymous material/mesh handles via
    // `world.allocSharedRef(tag, payload)` instead.
    const matWitch = world.allocSharedRef<'MaterialAsset', MaterialAsset>(
      'MaterialAsset',
      Materials.standard({ baseColor: [0.25, 0.18, 0.45, 1], roughness: 0.6, metallic: 0.1 }),
    );
    const cyl = world.allocSharedRef<'MeshAsset', MeshAsset>(
      'MeshAsset',
      (createCylinderGeometry(0.5, 0.5, 1, 16) as unknown as { unwrap: () => MeshAsset }).unwrap(),
    );
    witchRoot = world.spawn(
      { component: Transform, data: { posX: 0, posY: 0.85, posZ: 0, scaleX: 0.6, scaleY: 1.7, scaleZ: 0.6 } },
      { component: MeshFilter, data: { assetHandle: cyl } },
      { component: MeshRenderer, data: { materials: [matWitch] } },
      { component: ChildOf, data: { parent: playerRig } },
    ).unwrap();
  }

  // ── player + game systems ─────────────────────────────────────────────
  type ViewMode = 'topdown' | 'fps';
  const keys: Record<string, boolean> = {};

  const player = createPlayer();
  const fx = new FxSystem(world, app);
  fx.setCampfire(0, 0.9, 0);      // pack's CampfireGlow sits at (0, 0.7, 0)
  const hud = installHud(uiMount);
  const loot = new LootSystem(world);
  const sfx = new Sfx();
  sfx.install();

  // Screen shake — one decaying magnitude, random offset per frame, applied
  // to the camera position in BOTH view modes. Small numbers: 0.1 reads as
  // a thump, 0.4 as a boss slam.
  let shakeMag = 0;
  const addShake = (m: number) => { shakeMag = Math.min(0.55, shakeMag + m); };

  // Areas. camp+wild share the encampment map; den = the PCG dungeon.
  type Area = 'camp' | 'wild' | 'den';
  let area: Area = 'camp';
  const CAMP_RECT = { x0: -11.5, x1: 8.5, z0: -14.5, z1: 14.5 };
  const WILD_BOUNDS = { x0: -24, x1: 24, z0: -13, z1: 28 };
  const inCamp = (x: number, z: number) =>
    x > CAMP_RECT.x0 && x < CAMP_RECT.x1 && z > CAMP_RECT.z0 && z < CAMP_RECT.z1;

  // ── PCG dungeon (熔渣深窟) ─────────────────────────────────────────────
  // Layout (walkability/spawns) regenerates from the fixed seed; the static
  // geometry comes from the EDITABLE baked scene pack (see src/dungeon.ts).
  const dungeon = new Dungeon(world);
  await dungeon.installGeometry(assets);
  console.log(`[hellforge] den generated — ${dungeon.roomCount} rooms, ${dungeon.monsterSpawns.length} monsters`);

  // Combined walkability: dungeon grid inside the den, open bounds outside.
  const walkableAt = (x: number, z: number): boolean => {
    if (dungeon.contains(x, z)) return dungeon.walkable(x, z);
    return x > WILD_BOUNDS.x0 && x < WILD_BOUNDS.x1 && z > WILD_BOUNDS.z0 && z < WILD_BOUNDS.z1;
  };

  // ── monsters ──────────────────────────────────────────────────────────
  let denTotal = 0;
  let questDone = false;
  const monsters = new MonsterManager(world, fx, {
    onPlayerHit: (dmg, source) => {
      if (area === 'camp') return;                       // camp is sacred
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
        const drop = rollDrop(mLevel, isBoss, equipBonus.magicFind);
        if (drop) loot.spawnItem(drop, m.x, m.z);
      }
      if (equipBonus.lifeOnKill > 0) {
        player.hp = Math.min(player.maxHp, player.hp + equipBonus.lifeOnKill);
      }
      addShake(isBoss ? 0.45 : 0.1);
      sfx.play(isBoss ? 'boss-kill' : 'kill');
      if (isBoss) {
        hud.setBoss(null);
        hud.banner('熔渣督军 已被消灭', '#ffd066', 2400);
      }
    },
  });
  // Skinned GLB monster visuals (assets/monsters/*.glb) — load BEFORE the
  // den pre-spawn so every monster gets the real rig; kinds that fail fall
  // back to the lowpoly parts assemblies.
  await monsters.loadVisuals(assets);
  for (const s of dungeon.monsterSpawns) {
    if (monsters.spawn(s.kind, s.x, s.z, 'den')) denTotal++;
  }

  // ── equipment + bag (打宝核心) ────────────────────────────────────────
  // 6-slot paper doll + 24-slot bag. Pickups go to the BAG (auto-equip only
  // fills an empty slot); the B-key inventory panel handles swaps and melts.
  // The aggregate bonus feeds hp/mana (as deltas so damage taken persists),
  // regen, skill damage/element/crit/cdr, move speed — and the loot stats
  // (magic find / gold find / xp gain / life-on-kill) close the grind loop.
  const equipment = emptyEquipment();
  const bag: Array<Item | null> = new Array(24).fill(null);
  let equipBonus: EquipBonus = computeBonus(equipment);
  let moveMul = 1;
  const applyEquipment = (): void => {
    const next = computeBonus(equipment);
    player.maxHp += next.maxHp - equipBonus.maxHp;
    player.hp = Math.min(player.maxHp, player.hp + Math.max(0, next.maxHp - equipBonus.maxHp));
    player.maxMana += next.maxMana - equipBonus.maxMana;
    player.mana = Math.min(player.maxMana, player.mana);
    player.manaRegen = 5 + next.manaRegen;
    player.hpRegen = next.hpRegen;
    skills.mods = {
      dmgMul: 1 + next.dmgPct, cdrMul: 1 - next.cdr,
      fireMul: 1 + next.fireDmg, frostMul: 1 + next.frostDmg, arcMul: 1 + next.arcDmg,
      critChance: next.critChance, critMul: next.critDmg,
    };
    moveMul = 1 + next.moveSpd;
    equipBonus = next;
    hud.setEquipment(SLOT_ORDER.map((s): EquipSlotState => ({
      icon: SLOT_META[s].icon,
      color: equipment[s] ? RARITY_META[equipment[s]!.rarity].color : null,
      tooltip: equipment[s]
        ? itemTooltipLines(equipment[s]!, player.level).map(([t]) => t).join('\n')
        : `${SLOT_META[s].label}（空）`,
    })));
    inv.update(equipment, bag, player.level, player.gold);
  };

  /** Pickup → auto-equip an EMPTY slot (req met), else into the bag. The
   *  loot tick's canTakeItem gate guarantees there's bag space here. */
  const takeItem = (item: Item, sx: number | null, sy: number | null): void => {
    const meta = RARITY_META[item.rarity];
    if (!equipment[item.slot] && player.level >= item.reqLevel) {
      equipment[item.slot] = item;
      sfx.play('equip');
      applyEquipment();
      if (sx !== null && sy !== null) hud.floatText(`装备了 ${item.name}`, sx, sy, { color: meta.color, size: 16 });
    } else {
      const i = bag.indexOf(null);
      if (i >= 0) bag[i] = item;
      sfx.play('pickup');
      if (sx !== null && sy !== null) hud.floatText(`${item.name} → 背包`, sx, sy, { color: meta.color, size: 14 });
      inv.update(equipment, bag, player.level, player.gold);
    }
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
  });
  let selectedSkill = 0;

  // ── inventory panel (B) — paper doll + bag, all mutations land here ────
  const inv = installInventory({
    onEquipFromBag: (idx) => {
      const item = bag[idx];
      if (!item) return false;
      if (player.level < item.reqLevel) {
        hud.banner(`需要等级 ${item.reqLevel}`, '#ff6a6a', 1200);
        return false;
      }
      const prev = equipment[item.slot];
      equipment[item.slot] = item;
      bag[idx] = prev;                      // swap the worn piece into the bag
      sfx.play('equip');
      applyEquipment();
      return true;
    },
    onUnequip: (slot) => {
      const item = equipment[slot];
      if (!item) return false;
      const i = bag.indexOf(null);
      if (i < 0) { hud.banner('背包已满', '#ff6a6a', 1100); return false; }
      bag[i] = item;
      equipment[slot] = null;
      sfx.play('pickup');
      applyEquipment();
      return true;
    },
    onMelt: (idx) => {
      const item = bag[idx];
      if (!item) return;
      const gold = Math.round(3 + item.ilvl * 2 +
        (item.rarity === 'legendary' ? 60 : item.rarity === 'rare' ? 18 : item.rarity === 'magic' ? 7 : 0));
      bag[idx] = null;
      player.gold += gold;
      hud.setGold(player.gold);
      sfx.play('pickup');
      inv.update(equipment, bag, player.level, player.gold);
    },
  }, uiMount);
  onCleanup(() => { hud.dispose(); inv.dispose(); });
  onCleanup(() => { document.body.style.cursor = ''; canvas.style.cursor = ''; });

  // ── portals (camp cave-mouth ⇄ den entry) ─────────────────────────────
  const CAVE_MOUTH = { x: 14, z: 24 };       // out past the camp gate
  const portalMat = fx.portalMaterial([0.9, 0.25, 0.08]);
  const portalMatBack = fx.portalMaterial([0.3, 0.5, 1.0]);
  const flatQuad = (x: number, z: number, s: number, mat: ReturnType<typeof fx.portalMaterial>): void => {
    if (!mat) return;
    const q = quat.create();
    quat.fromAxisAngle(q, [1, 0, 0], -Math.PI / 2);
    world.spawn(
      { component: Transform, data: { posX: x, posY: 0.06, posZ: z, quatX: q[0]!, quatY: q[1]!, quatZ: q[2]!, quatW: q[3]!, scaleX: s, scaleY: s, scaleZ: s } },
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
  // Cave-mouth framing: two crooked stones so the portal reads from afar.
  const stoneMat = world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
    baseColor: [0.25, 0.20, 0.18, 1], roughness: 0.95, metallic: 0.02,
  }));
  world.spawn(
    { component: Transform, data: { posX: CAVE_MOUTH.x - 2.2, posY: 1.2, posZ: CAVE_MOUTH.z, quatX: 0, quatY: 0.13, quatZ: 0.09, quatW: 0.987, scaleX: 0.9, scaleY: 2.4, scaleZ: 0.9 } },
    { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
    { component: MeshRenderer, data: { materials: [stoneMat] } },
  );
  world.spawn(
    { component: Transform, data: { posX: CAVE_MOUTH.x + 2.2, posY: 1.0, posZ: CAVE_MOUTH.z, quatX: 0, quatY: -0.16, quatZ: -0.08, quatW: 0.984, scaleX: 0.8, scaleY: 2.0, scaleZ: 0.8 } },
    { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
    { component: MeshRenderer, data: { materials: [stoneMat] } },
  );
  let portalArmed = true;
  let portalMoteTimer = 0;

  // ── wilderness spawner (灰烬荒原) ──────────────────────────────────────
  let wildTimer = 2;
  const WILD_MAX = 8;
  const tickWildSpawner = (dt: number): void => {
    if (area !== 'wild') return;
    wildTimer -= dt;
    if (wildTimer > 0) return;
    wildTimer = 2.2 + Math.random() * 1.6;
    let wildAlive = 0;
    for (const m of monsters.monsters) if (m.zone === 'wild') wildAlive++;
    if (wildAlive >= WILD_MAX) return;
    // ring spawn 10–15 m out, biased away from the camp, never inside it
    for (let tries = 0; tries < 8; tries++) {
      const ang = Math.random() * Math.PI * 2;
      const r = 10 + Math.random() * 5;
      const x = state.px + Math.cos(ang) * r;
      const z = state.pz + Math.sin(ang) * r;
      if (inCamp(x, z) || !walkableAt(x, z) || dungeon.contains(x, z)) continue;
      const roll = Math.random();
      const kind = roll < 0.5 ? 'imp' : roll < 0.85 ? 'ashwalker' : 'charred';
      monsters.spawn(kind, x, z, 'wild');
      break;
    }
  };

  // ── player state ──────────────────────────────────────────────────────
  // Player-following warm torch light (cow-survivor level2 night pattern).
  const playerLight = world.spawn(
    { component: Transform, data: { posX: 0, posY: 3.0, posZ: 5 } },
    { component: PointLight, data: { colorR: 1.0, colorG: 0.55, colorB: 0.35, intensity: 10, range: 7 } },
  ).unwrap();

  // Witch shadow proxy: humanoid-sized vertical box at her position.
  // ShadowCaster-only material (no Forward pass) — writes shadow-atlas depth
  // but never renders in colour, so the moonlight projects a real ground
  // shadow while the proxy stays invisible. (The witch's skinned mesh is 18F;
  // the default shadow caster is 12F vertex-only, hence the proxy.)
  const shadowProxyMat = world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', {
    kind: 'material',
    passes: [
      {
        name: 'ShadowCaster',
        shader: 'forgeax::default-shadow-caster',
        tags: { LightMode: 'ShadowCaster' },
        queue: 2000,
      },
    ],
    paramValues: {},
  });
  const shadowDisc = world.spawn(
    { component: Transform, data: { posX: 0, posY: 0.85, posZ: 5, scaleX: 0.6 * PLAYER_SCALE, scaleY: 1.7 * PLAYER_SCALE, scaleZ: 0.45 * PLAYER_SCALE } },
    { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
    { component: MeshRenderer, data: { materials: [shadowProxyMat] } },
  ).unwrap();
  const state = {
    px: 0, pz: 5,
    mode: 'topdown' as ViewMode,
    currentClip: 'idle' as string,
    paused: false,
    moving: false,
    // One-shot clip (attack/hit/death): plays once, LOCKS locomotion until it
    // ends. `oneShotUntil` is the performance.now() ms at which it ends.
    oneShotUntil: 0,
  };
  // lookYaw/lookPitch: third-person orbit angles; faceX/faceZ: witch facing.
  let lookYaw = 0, lookPitch = -0.25;
  let faceX = 0, faceZ = -1;
  (window as unknown as { __hf?: unknown }).__hf = {
    state,
    player,
    playerRig,
    monsters,
    skills,
    loot,
    fx,
    dungeon,
    equipment,
    bag,
    takeItem,
    inv,
    get witchRoot() { return witchRoot; },
    get witchSkinEnt() { return witchSkinEnt; },
    get lookYaw() { return lookYaw; },
    get lookPitch() { return lookPitch; },
    get area() { return area; },
  };

  // ── camera ────────────────────────────────────────────────────────────
  const FOV = Math.PI / 2.4;
  const camera = world.spawn(
    { component: Transform, data: { posY: 1.6, posZ: 0 } },
    { component: Camera, data: { ...perspective({ fov: FOV, aspect, near: 0.05, far: 200 }), tonemap: TONEMAP_ACES_FILMIC, ...SKY_CLEAR } },
  ).unwrap();
  world.set(camera, Camera, { tonemap: TONEMAP_ACES_FILMIC });
  ((window as unknown as { __hf: Record<string, unknown> }).__hf).camera = camera;
  ((window as unknown as { __hf: Record<string, unknown> }).__hf).Transform = Transform;
  ((window as unknown as { __hf: Record<string, unknown> }).__hf).AnimationPlayer = AnimationPlayer;
  ((window as unknown as { __hf: Record<string, unknown> }).__hf).Name = Name;
  ((window as unknown as { __hf: Record<string, unknown> }).__hf).world = world;

  // ── tuning ────────────────────────────────────────────────────────────
  const SPEED = 3.4, SPRINT = 5.4;
  const TURN = 2.6;
  const TOP_DY = 6.3, TOP_DZ = 4.2;
  const CAM_LERP = 8;
  const TP_DIST = 3.2;
  const TP_TARGET_Y = 1.35;
  const FACING_SIGN = 1;
  // characterw move clip = 0.667 s vs witch 1.233 s (≈1.85× shorter loop). The
  // stride is the ground distance covered at base rate 1; scaling it by the
  // loop-duration ratio keeps leg cadence matched to ground speed (base ≈ 1.6
  // at 3.4 m/s → ~2.4 cycles/s, same as witch). Idle/attack/hit/death keep base 1.
  const ANIM_STRIDE = 1.15 * (1.233 / 0.667); // ≈ 2.13
  const ANIM_SPEED_MIN = 0.5, ANIM_SPEED_MAX = 4.8;
  const topPitch = -Math.atan2(TOP_DY, TOP_DZ);
  const topQ = quat.create();
  quat.fromAxisAngle(topQ, [1, 0, 0], topPitch);
  let focusX = state.px;
  let focusZ = state.pz;

  // ── camera math: world↔screen (aim + floating text) ───────────────────
  // Reconstructs the SAME camera the render loop writes (mode-dependent) and
  // projects with the same vertical-FOV perspective. Returns null behind cam.
  const camPose = (): { x: number; y: number; z: number; yaw: number; pitch: number } => {
    if (state.mode === 'fps') {
      const cp = Math.cos(lookPitch), sp = Math.sin(lookPitch);
      const fwdX = -cp * Math.sin(lookYaw), fwdY = sp, fwdZ = -cp * Math.cos(lookYaw);
      return {
        x: state.px - fwdX * TP_DIST, y: TP_TARGET_Y - fwdY * TP_DIST, z: state.pz - fwdZ * TP_DIST,
        yaw: lookYaw, pitch: lookPitch,
      };
    }
    return { x: focusX, y: TOP_DY, z: focusZ + TOP_DZ, yaw: 0, pitch: topPitch };
  };
  const worldToScreen = (wx: number, wy: number, wz: number): { x: number; y: number } | null => {
    const c = camPose();
    const rx = wx - c.x, ry = wy - c.y, rz = wz - c.z;
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    // camera basis (right-handed): right, up, fwd
    const rgt = { x: cy, y: 0, z: -sy };
    const fwd = { x: -cp * sy, y: sp, z: -cp * cy };
    const up = { x: rgt.y * fwd.z - rgt.z * fwd.y, y: rgt.z * fwd.x - rgt.x * fwd.z, z: rgt.x * fwd.y - rgt.y * fwd.x };
    const xc = rx * rgt.x + ry * rgt.y + rz * rgt.z;
    const yc = rx * up.x + ry * up.y + rz * up.z;
    const zc = rx * fwd.x + ry * fwd.y + rz * fwd.z;
    if (zc < 0.05) return null;
    const tanHalf = Math.tan(FOV / 2);
    const ndcX = xc / (zc * tanHalf * aspect);
    const ndcY = yc / (zc * tanHalf);
    return {
      x: (ndcX * 0.5 + 0.5) * canvas.clientWidth,
      y: (1 - (ndcY * 0.5 + 0.5)) * canvas.clientHeight,
    };
  };
  // Mouse ground-point aim (both view modes): unproject the cursor onto the
  // y=0 plane using the current camera pose — no pointer lock anywhere.
  let mouseX = 0, mouseY = 0;
  const aimDir = (): { x: number; z: number } => {
    const c = camPose();
    const cy = Math.cos(c.yaw), sy = Math.sin(c.yaw);
    const cp = Math.cos(c.pitch), sp = Math.sin(c.pitch);
    const rgt = { x: cy, y: 0, z: -sy };
    const fwd = { x: -cp * sy, y: sp, z: -cp * cy };
    const up = { x: rgt.y * fwd.z - rgt.z * fwd.y, y: rgt.z * fwd.x - rgt.x * fwd.z, z: rgt.x * fwd.y - rgt.y * fwd.x };
    const tanHalf = Math.tan(FOV / 2);
    const ndcX = (mouseX / Math.max(1, canvas.clientWidth)) * 2 - 1;
    const ndcY = 1 - (mouseY / Math.max(1, canvas.clientHeight)) * 2;
    const dir = {
      x: fwd.x + rgt.x * ndcX * tanHalf * aspect + up.x * ndcY * tanHalf,
      y: fwd.y + rgt.y * ndcX * tanHalf * aspect + up.y * ndcY * tanHalf,
      z: fwd.z + rgt.z * ndcX * tanHalf * aspect + up.z * ndcY * tanHalf,
    };
    if (Math.abs(dir.y) < 1e-4) return { x: faceX, z: faceZ };
    const t = -c.y / dir.y;
    if (t <= 0) return { x: faceX, z: faceZ };
    const hx = c.x + dir.x * t, hz = c.z + dir.z * t;
    const dx = hx - state.px, dz = hz - state.pz;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return { x: faceX, z: faceZ };
    return { x: dx / len, z: dz / len };
  };

  // ── mouse policy: NO pointer lock, custom cursor ──────────────────────
  // The cursor stays free and visible (forge.json pointerLock:false keeps
  // the host shell from grabbing it either). Aiming reads the cursor's
  // ground point in BOTH view modes; the third-person camera orbits with
  // RIGHT-drag (movementX works without a lock) or the arrow keys. A
  // custom ember-crosshair cursor brands the whole game window.
  const releaseHostCapture = () => {
    try { window.parent.postMessage({ type: 'fx-pointer-capture', capture: false }, '*'); } catch { /* not embedded */ }
  };
  releaseHostCapture();                    // clear any stale grab from before
  try { document.exitPointerLock?.(); } catch { /* ignore */ }
  const CURSOR_SVG = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
    `<g fill="none" stroke="#1a0c06" stroke-width="4" stroke-linecap="round">` +
    `<path d="M14 3v6M14 19v6M3 14h6M19 14h6"/></g>` +
    `<g fill="none" stroke="#ffb15e" stroke-width="2" stroke-linecap="round">` +
    `<path d="M14 3v6M14 19v6M3 14h6M19 14h6"/></g>` +
    `<circle cx="14" cy="14" r="2.6" fill="#ff5a1f" stroke="#1a0c06" stroke-width="1.2"/>` +
    `</svg>`,
  );
  const GAME_CURSOR = `url("data:image/svg+xml,${CURSOR_SVG}") 14 14, crosshair`;
  document.body.style.cursor = GAME_CURSOR;
  canvas.style.cursor = GAME_CURSOR;

  // ── clip helpers ──────────────────────────────────────────────────────
  const ATTACK_SPEED = 1.9;
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
  const playOnce = (name: string, speed = 1) => {
    if (witchSkinEnt === null) return;
    if (performance.now() < state.oneShotUntil && name !== 'death') return;
    const h = clipHandles.get(name);
    if (h === undefined) return;
    state.currentClip = name;
    state.oneShotUntil = performance.now() + ((clipDur.get(name) ?? 1) / speed) * 1000;
    witchAnimBase = speed;
    world.set(witchSkinEnt, AnimationPlayer, {
      clips: [h], times: new Float32Array([0]), weights: new Float32Array([1]), speeds: new Float32Array([speed * animRate]), looping: false, paused: state.paused,
    });
  };

  // ── casting ───────────────────────────────────────────────────────────
  const tryCast = (idx: number): void => {
    if (player.dead) return;
    const aim = aimDir();
    const res = skills.cast(idx, state.px, state.pz, aim.x, aim.z, player);
    if (res === 'ok') {
      selectedSkill = idx;
      faceX = aim.x; faceZ = aim.z;      // snap facing to the cast direction
      const id = SKILLS[idx]!.id;
      if (id !== 'blink') playOnce('attack', ATTACK_SPEED);
      sfx.play(id === 'magma' ? 'cast-magma' : id === 'frost' ? 'cast-frost' : id === 'arc' ? 'cast-arc' : 'blink');
      refreshSkillBar();
    } else if (res === 'mana') {
      const s = worldToScreen(state.px, 2.0, state.pz);
      if (s) hud.floatText('法力不足', s.x, s.y, { color: '#7da2ff', size: 14 });
    } else if (res === 'locked') {
      const s = worldToScreen(state.px, 2.0, state.pz);
      if (s) hud.floatText(`等级 ${SKILLS[idx]!.unlockLevel} 解锁`, s.x, s.y, { color: '#caa', size: 14 });
    }
  };

  // ── HUD wiring ────────────────────────────────────────────────────────
  const refreshSkillBar = (): void => {
    const slots: SkillSlotState[] = SKILLS.map((def, i) => ({
      icon: def.icon,
      name: def.name,
      key: `${i + 1}`,
      manaCost: def.manaCost,
      cooldownPct: def.cooldown > 0 ? skills.cooldowns[i]! / def.cooldown : 0,
      locked: player.level < def.unlockLevel,
      unlockLevel: def.unlockLevel,
      affordable: player.mana >= def.manaCost,
    }));
    hud.setSkills(slots);
  };
  const refreshQuest = (): void => {
    if (questDone) { hud.setQuest('✓ 第一幕切片完成 — 熔渣深窟已清剿'); return; }
    const left = monsters.denAliveCount();
    hud.setQuest(area === 'den'
      ? `任务：清剿熔渣深窟 · 剩余 ${left}/${denTotal}`
      : `任务：清剿熔渣深窟（营地大门外，穿过灰烬荒原）`);
  };
  refreshSkillBar();
  refreshQuest();
  applyEquipment();          // paints the (empty) equip slots + baseline mods

  const enterArea = (next: Area): void => {
    if (next === area) return;
    area = next;
    if (next === 'den') hud.showArea('熔渣深窟', 'Slagdeep Hollow');
    else if (next === 'wild') hud.showArea('灰烬荒原', 'Ashen Reach');
    else hud.showArea('余烬哨站', 'Cinderwatch');
    refreshQuest();
  };

  // ── launcher config (editor Launcher 面板写入 play-config.json) ────────
  // { "mode": "level", "level": "slagdeep-hollow" } → start INSIDE the den
  // (the scene the user picked in the editor). Anything else / missing file
  // = normal campaign start at the camp.
  let startedInDen = false;
  try {
    const r = await fetch(new URL('./play-config.json', import.meta.url), { cache: 'no-store' });
    if (r.ok) {
      const cfg = await r.json() as { mode?: string; level?: string };
      if (cfg.mode === 'level' && cfg.level === 'slagdeep-hollow') {
        state.px = dungeon.entry.x;
        state.pz = dungeon.entry.z;
        focusX = state.px; focusZ = state.pz;
        startedInDen = true;
      }
    }
  } catch { /* no launcher config → campaign */ }
  if (startedInDen) enterArea('den');
  else hud.showArea('余烬哨站', 'Cinderwatch · 第一幕');

  // ── input ─────────────────────────────────────────────────────────────
  ((window as unknown as { __hf: Record<string, unknown> }).__hf).keys = keys;
  // Every host-page / global listener below is registered as a named handler
  // and immediately paired with an onCleanup that removes it, so ■ Stop leaves
  // no dangling listeners on window / document / the persistent #app canvas.
  const onKeyDown = (e: KeyboardEvent) => {
    if (keys[e.code]) return;        // repeat → no edge action
    keys[e.code] = true;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === 'KeyB' || e.code === 'KeyI') {
      inv.update(equipment, bag, player.level, player.gold);
      inv.toggle();
    }
    if (e.code === 'KeyV') {
      state.mode = state.mode === 'topdown' ? 'fps' : 'topdown';
    }
    if (e.code === 'Digit1') tryCast(0);
    if (e.code === 'Digit2') tryCast(1);
    if (e.code === 'Digit3') tryCast(2);
    if (e.code === 'Digit4') tryCast(3);
    if (e.code === 'KeyR' && player.dead) {
      respawnPlayer(player);
      hud.showDeath(false);
      state.px = 0; state.pz = 5;
      focusX = 0; focusZ = 5;
      state.oneShotUntil = 0;
      swapClip('idle');
      enterArea('camp');
    }
    if (e.key === 'Escape' && inv.isOpen()) inv.hide();
  };
  window.addEventListener('keydown', onKeyDown);
  onCleanup(() => window.removeEventListener('keydown', onKeyDown));

  const onKeyUp = (e: KeyboardEvent) => { keys[e.code] = false; };
  window.addEventListener('keyup', onKeyUp);
  onCleanup(() => window.removeEventListener('keyup', onKeyUp));

  const onContextMenu = (e: MouseEvent) => e.preventDefault();
  canvas.addEventListener('contextmenu', onContextMenu);
  onCleanup(() => canvas.removeEventListener('contextmenu', onContextMenu));

  // Left = cast at the cursor; RIGHT-drag = orbit the third-person camera.
  let orbiting = false;
  const onMouseDown = (e: MouseEvent) => {
    if (e.button === 0 && !player.dead) tryCast(selectedSkill);
    if (e.button === 2) orbiting = true;
  };
  canvas.addEventListener('mousedown', onMouseDown);
  onCleanup(() => canvas.removeEventListener('mousedown', onMouseDown));

  const onMouseUp = (e: MouseEvent) => { if (e.button === 2) orbiting = false; };
  window.addEventListener('mouseup', onMouseUp);
  onCleanup(() => window.removeEventListener('mouseup', onMouseUp));

  const onBlur = () => { orbiting = false; };
  window.addEventListener('blur', onBlur);
  onCleanup(() => window.removeEventListener('blur', onBlur));

  const onResize = () => {
    sizeCanvas();
    aspect = canvas.width / canvas.height;
    world.set(camera, Camera, { ...perspective({ fov: FOV, aspect, near: 0.05, far: 200 }), tonemap: TONEMAP_ACES_FILMIC, ...SKY_CLEAR });
  };
  window.addEventListener('resize', onResize);
  onCleanup(() => window.removeEventListener('resize', onResize));

  // Mouse: aim tracking always; right-drag orbits in third person (movement
  // deltas work fine without any pointer lock).
  const onMouseMove = (e: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = e.clientX - rect.left;
    mouseY = e.clientY - rect.top;
    if (state.mode !== 'fps' || !orbiting) return;
    lookYaw -= e.movementX * 0.0045;
    lookPitch = clamp(lookPitch - e.movementY * 0.0045, -1.3, 1.3);
  };
  window.addEventListener('mousemove', onMouseMove);
  onCleanup(() => window.removeEventListener('mousemove', onMouseMove));

  // ── main loop ─────────────────────────────────────────────────────────
  let hudTimer = 0;
  registerUpdate((dt: number) => {
    // fps compensation rate for AnimationPlayer speeds (see clip helpers).
    // Smoothed so a single hitchy frame doesn't pulse the animations.
    animRate += (clamp(dt * 60, 0.3, 3) - animRate) * Math.min(1, dt * 10);

    // Third-person look: arrow keys + CURSOR EDGE-PUSH (no pointer lock —
    // shoving the cursor into the outer band of the screen turns the camera,
    // quadratically faster toward the edge; full 360° by holding it there).
    // Right-drag (mousemove handler) remains the precise orbit.
    if (state.mode === 'fps') {
      if (keys['ArrowLeft']) lookYaw += TURN * dt;
      if (keys['ArrowRight']) lookYaw -= TURN * dt;
      if (keys['ArrowUp']) lookPitch = clamp(lookPitch + TURN * dt, -1.3, 1.3);
      if (keys['ArrowDown']) lookPitch = clamp(lookPitch - TURN * dt, -1.3, 1.3);
      const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
      const nx = mouseX / w, ny = mouseY / h;
      const EDGE = 0.14;                     // outer band that turns the camera
      if (nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1) {   // cursor inside the window
        if (nx < EDGE) {
          const f = (EDGE - nx) / EDGE;
          lookYaw += TURN * 1.6 * f * f * dt;
        } else if (nx > 1 - EDGE) {
          const f = (nx - (1 - EDGE)) / EDGE;
          lookYaw -= TURN * 1.6 * f * f * dt;
        }
        if (ny < EDGE) {
          const f = (EDGE - ny) / EDGE;
          lookPitch = clamp(lookPitch + TURN * 0.8 * f * f * dt, -1.3, 1.3);
        } else if (ny > 1 - EDGE) {
          const f = (ny - (1 - EDGE)) / EDGE;
          lookPitch = clamp(lookPitch - TURN * 0.8 * f * f * dt, -1.3, 1.3);
        }
      }
    }

    // input → world-space movement vector
    const sprint = !!keys['ShiftLeft'] || !!keys['ShiftRight'];
    const spd = (sprint ? SPRINT : SPEED) * moveMul * dt;
    const am = state.mode !== 'fps';
    const fwd = ((keys['KeyW'] || (am && keys['ArrowUp'])) ? 1 : 0) -
                ((keys['KeyS'] || (am && keys['ArrowDown'])) ? 1 : 0);
    const strafe = ((keys['KeyD'] || (am && keys['ArrowRight'])) ? 1 : 0) -
                   ((keys['KeyA'] || (am && keys['ArrowLeft'])) ? 1 : 0);
    let mvx = 0, mvz = 0;
    if (state.mode === 'fps') {
      const fwdX = -Math.sin(lookYaw), fwdZ = -Math.cos(lookYaw);
      const rgtX = -fwdZ, rgtZ = fwdX;
      mvx = fwdX * fwd + rgtX * strafe;
      mvz = fwdZ * fwd + rgtZ * strafe;
    } else {
      mvx = strafe;
      mvz = -fwd;
    }

    // one-shot clip locks locomotion (attack cast roots the witch briefly)
    const oneShotActive = !state.paused && performance.now() < state.oneShotUntil;

    // integrate position — per-axis walkability so walls slide, not stick
    const len = Math.hypot(mvx, mvz);
    state.moving = !oneShotActive && !player.dead && len > 0;
    if (state.moving) {
      const nx = mvx / len, nz = mvz / len;
      faceX = nx; faceZ = nz;
      const nxp = state.px + nx * spd;
      const nzp = state.pz + nz * spd;
      if (walkableAt(nxp, state.pz)) state.px = nxp;
      if (walkableAt(state.px, nzp)) state.pz = nzp;
    }

    // animation state machine
    if (!state.paused && !oneShotActive && !player.dead) {
      if (state.oneShotUntil !== 0) state.oneShotUntil = 0;
      swapClip(state.moving ? 'move' : 'idle');
      if (state.moving && state.currentClip === 'move') {
        const ground = (sprint ? SPRINT : SPEED) * moveMul;
        witchAnimBase = clamp(ground / ANIM_STRIDE, ANIM_SPEED_MIN, ANIM_SPEED_MAX);
      } else if (state.currentClip === 'idle') {
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
        posX: state.px, posY: 0, posZ: state.pz,
        quatX: qy[0]!, quatY: qy[1]!, quatZ: qy[2]!, quatW: qy[3]!,
        scaleX: PLAYER_SCALE, scaleY: PLAYER_SCALE, scaleZ: PLAYER_SCALE,
      });
    }
    world.set(playerLight, Transform, { posX: state.px, posY: 3.0, posZ: state.pz });
    world.set(shadowDisc, Transform, {
      posX: state.px, posY: 0.85, posZ: state.pz,
      scaleX: 0.6 * PLAYER_SCALE, scaleY: 1.7 * PLAYER_SCALE, scaleZ: 0.45 * PLAYER_SCALE,
    });
    // Keep the sky dome centred on the player so it reads as an infinite sky.
    if (skyDome !== null) {
      world.set(skyDome, Transform, {
        posX: state.px, posY: 0, posZ: state.pz,
        scaleX: SKY_DOME_RADIUS, scaleY: SKY_DOME_RADIUS, scaleZ: SKY_DOME_RADIUS,
      });
    }

    // ── game systems ──
    tickPlayer(player, dt);
    fx.tick(dt);
    const playerSafe = area !== 'den' && inCamp(state.px, state.pz);
    monsters.animRate = animRate;
    monsters.tick(dt, state.px, state.pz, playerSafe, walkableAt);
    skills.tick(dt, monsters);
    tickWildSpawner(dt);

    // loot pickups (equipment stays on the ground while the bag is full)
    for (const ev of loot.tick(dt, state.px, state.pz, () => bag.includes(null))) {
      const s = worldToScreen(ev.x, ev.y + 0.4, ev.z);
      if (ev.kind === 'xp') {
        const gained = Math.round(ev.amount * (1 + equipBonus.xpGain));
        const ups = grantXp(player, gained);
        sfx.play('pickup');
        if (s) hud.floatText(`+${gained} 经验`, s.x, s.y, { color: '#ffb45e', size: 14 });
        for (const up of ups) {
          hud.banner(`等级提升！ Lv ${up.level}`, '#ffd066', 2000);
          fx.rise(state.px, 0.2, state.pz, 'gold', 16, 0.9);
          sfx.play('levelup');
          refreshSkillBar();
          inv.update(equipment, bag, player.level, player.gold);
        }
      } else if (ev.kind === 'gold') {
        const gained = Math.round(ev.amount * (1 + equipBonus.goldFind));
        player.gold += gained;
        hud.setGold(player.gold);
        sfx.play('pickup');
        if (s) hud.floatText(`+${gained} 金币`, s.x, s.y, { color: '#ffcf40', size: 14 });
      } else if (ev.kind === 'healPotion') {
        player.hp = Math.min(player.maxHp, player.hp + ev.amount);
        sfx.play('potion');
        if (s) hud.floatText(`+${ev.amount} 生命`, s.x, s.y, { color: '#ff6a6a', size: 15 });
        fx.rise(state.px, 0.4, state.pz, 'heal', 6, 0.4);
      } else if (ev.kind === 'item' && ev.item) {
        takeItem(ev.item, s?.x ?? null, s?.y ?? null);
      } else {
        player.mana = Math.min(player.maxMana, player.mana + ev.amount);
        sfx.play('potion');
        if (s) hud.floatText(`+${ev.amount} 法力`, s.x, s.y, { color: '#7da2ff', size: 15 });
      }
    }

    // ── area transitions (portal pads) ──
    const dCave = Math.hypot(state.px - CAVE_MOUTH.x, state.pz - CAVE_MOUTH.z);
    const dExit = Math.hypot(state.px - DEN_EXIT.x, state.pz - DEN_EXIT.z);
    if (portalArmed && !player.dead) {
      if (area !== 'den' && dCave < 1.5) {
        portalArmed = false;
        state.px = dungeon.entry.x; state.pz = dungeon.entry.z;
        focusX = state.px; focusZ = state.pz;
        sfx.play('portal');
        enterArea('den');
      } else if (area === 'den' && dExit < 1.5) {
        portalArmed = false;
        state.px = CAVE_MOUTH.x - 3; state.pz = CAVE_MOUTH.z - 3;
        focusX = state.px; focusZ = state.pz;
        sfx.play('portal');
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

    // ── quest / boss ──
    if (!questDone && denTotal > 0 && monsters.denAliveCount() === 0) {
      questDone = true;
      hud.banner('任务完成：熔渣深窟已清剿！', '#8aff9a', 3000);
      sfx.play('quest');
      const ups = grantXp(player, 120);
      player.gold += 250;
      hud.setGold(player.gold);
      for (const up of ups) hud.banner(`等级提升！ Lv ${up.level}`, '#ffd066', 2000);
      refreshQuest();
      refreshSkillBar();
    }
    const boss = monsters.boss();
    if (boss && area === 'den' && Math.hypot(boss.x - state.px, boss.z - state.pz) < 18) {
      hud.setBoss(MONSTERS[boss.kind].name, boss.hp, boss.maxHp);
    } else {
      hud.setBoss(null);
    }

    // HUD refresh (orbs every frame are cheap; skill bar at 8 Hz)
    hud.setOrbs(player.hp, player.maxHp, player.mana, player.maxMana);
    hud.setXp(player.level, player.xp, player.xpMax);
    hudTimer -= dt;
    if (hudTimer <= 0) {
      hudTimer = 0.12;
      refreshSkillBar();
      if (area === 'den') refreshQuest();
    }

    // ── camera ──
    // Screen shake: random offset scaled by the decaying magnitude.
    let shX = 0, shY = 0, shZ = 0;
    if (shakeMag > 0.005) {
      shX = (Math.random() - 0.5) * 2 * shakeMag;
      shY = (Math.random() - 0.5) * 1.2 * shakeMag;
      shZ = (Math.random() - 0.5) * 2 * shakeMag;
      shakeMag *= Math.exp(-7 * dt);
    } else {
      shakeMag = 0;
    }
    if (state.mode === 'fps') {
      const qy = quat.create(); quat.fromAxisAngle(qy, [0, 1, 0], lookYaw);
      const qx = quat.create(); quat.fromAxisAngle(qx, [1, 0, 0], lookPitch);
      const cq = quat.create(); quat.multiply(cq, qy, qx);
      const cp = Math.cos(lookPitch), sp = Math.sin(lookPitch);
      const fwdX = -cp * Math.sin(lookYaw);
      const fwdY = sp;
      const fwdZ = -cp * Math.cos(lookYaw);
      const tx = state.px, ty = TP_TARGET_Y, tz = state.pz;
      world.set(camera, Transform, {
        posX: tx - fwdX * TP_DIST + shX,
        posY: ty - fwdY * TP_DIST + shY,
        posZ: tz - fwdZ * TP_DIST + shZ,
        quatX: cq[0]!, quatY: cq[1]!, quatZ: cq[2]!, quatW: cq[3]!,
      });
    } else {
      const a = 1 - Math.exp(-CAM_LERP * dt);
      focusX += (state.px - focusX) * a;
      focusZ += (state.pz - focusZ) * a;
      world.set(camera, Transform, {
        posX: focusX + shX, posY: TOP_DY + shY, posZ: focusZ + TOP_DZ + shZ,
        quatX: topQ[0]!, quatY: topQ[1]!, quatZ: topQ[2]!, quatW: topQ[3]!,
      });
    }
  });
}
