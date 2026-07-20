# Hellforge Sorceress ARPG Vertical Slice Implementation Plan

> **Status 2026-07-17:** Code milestones M1–M4, M5.1–5.2, and M6 are on games
> branch `laurenceelu/feat-20260716-hellforge-optimize` (`a7d4f40`, ahead of
> `origin/main`, not pushed). **M5.3–5.4 audio is deferred by owner.** Browser
> acceptance is pending human. Handoff SSOT:
> `docs/handoff/2026-07-16-hellforge-optimize.md` (studio worktree).
>
> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task-by-task. Steps use
> checkbox syntax for tracking. Do **not** resume M5.3–5.4 until licensed audio
> assets exist.

**Goal:** Deliver a 15–20 minute, single-player Sorceress Act-1 slice with an
AIDiablo-aligned loop, operation grammar, and UI information architecture;
D2R-inspired visual language; persistent progression; a real 15-node skill
tree; quest/dialogue loop; Frost Fang VFX/audio; and camp-only third-person
showcase mode.

**Architecture:** Replace distributed closure state with a persistent character
domain and derived combat state. Route click movement and WASD through one
intent module, route all skills through one resolver, route quests through one
state machine, and let `main.ts` remain the composition root. Existing scene
packs, item generation, monsters, dungeon, and game-owned DOM UI remain the
implementation base.

**Tech Stack:** TypeScript, Bun, forgeax-engine ECS/runtime, DOM overlays,
localStorage, WGSL, WebAudio, glTF assets, deterministic grid navigation.

**Design SSOT:** [`ARPG-VERTICAL-SLICE-SPEC.md`](./ARPG-VERTICAL-SLICE-SPEC.md)

## Global constraints

- Work only in `packages/games/hellforge` and the `packages/games` package
  manifest/lockfile unless a separately approved engine feedback is required.
- Do not edit `forgeax-engine`.
- Do not enable third-person combat or true first-person mode.
- Do not make Barbarian or Necromancer playable.
- Do not add STR/DEX/VIT/ENERGY allocation, multiplayer, multi-cell inventory,
  sockets, runes, cube, durability, or difficulty tiers.
- Keep static visible authored entities in scene packs; do not hide missing
  required assets behind debug primitives.
- Do not mutate host-owned `ctx.uiRoot` styles. Interactive game descendants may
  use `pointer-events:auto`.
- All new product text and assets must be original to Hellforge. D2R is a
  visual-language benchmark only.
- Audio samples must carry team-owned/commercially usable/CC0 provenance.
- One task below equals one reviewable commit in the `forgeax-games` branch.
- Before the first source task, run `bun install` from the studio worktree root
  so engine workspace packages/types are present. A missing engine checkout or
  generated type dependency is a setup failure, not a Hellforge type failure.
- After every source task run:
  - `bun test packages/games/hellforge/src` from the studio worktree root;
  - `bunx tsc -p packages/games/hellforge/tsconfig.check.json --noEmit`;
  - `bun run lint:game-imports`;
  - `bun run lint:game-input`.
- Every milestone ends with browser acceptance at 1920×1080 and 1280×720.
- Do not bump the studio `packages/games` pin until the games branch is pushed
  and the user explicitly requests the bump.

---

## Milestone 1 — Isometric camera, navigation, input, and locomotion

**Outcome:** Sorceress-only gameplay starts in a low-distortion fixed isometric
view. LMB navigation/interaction, RMB selected-skill cast, and WASD takeover
share one movement authority. The old shoulder-camera combat path is disabled.

### Task 1.0 — Establish compile gate, content IDs, and character authority

**Files**

- Modify: `tsconfig.check.json`
- Create: `src/content-ids.ts`
- Create: `src/deep-readonly.ts`
- Create: `src/deep-readonly.test.ts`
- Create: `src/character-domain.ts`
- Create: `src/character-domain.test.ts`
- Modify: `src/state.ts`
- Modify: `src/classes.ts`
- Modify: `src/heroes.ts`
- Modify: `src/items.ts`
- Modify: `src/save.ts`
- Modify: `src/char-select.ts`
- Modify: `src/char-list.ts`
- Modify: `src/selection-gate.ts`
- Modify: `main.ts`

**Interfaces**

```ts
type ActiveSkillId = "magma" | "frost" | "arc" | "blink";
type SkillNodeId =
  | "magma-bolt" | "kindling" | "scorch" | "volatile-core" | "hellfire-catalyst"
  | "frost-fang" | "permafrost" | "piercing-ice" | "shatter" | "winters-grasp"
  | "arc-surge" | "conduction" | "phase-step" | "phase-echo" | "overcharge";
type QuestId = "purge-slagdeep-hollow";
type QuestStatus = "available" | "active" | "ready" | "completed";
type AreaId = "cinderwatch" | "ashen-reach" | "slagdeep-hollow";
type AreaExitId = "cinderwatch-to-reach" | "reach-to-cinderwatch"
  | "reach-to-slagdeep" | "slagdeep-to-reach";
type NpcId = "npc-cinderwarden-veyra";
type InteractionRef =
  | { kind: "monster"; id: string }
  | { kind: "npc"; id: NpcId }
  | { kind: "loot"; id: string }
  | { kind: "exit"; id: AreaExitId };
interface QuestSave { readonly status: QuestStatus }

type DeepReadonly<T> =
  T extends (...args: never[]) => unknown ? T
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T;

interface CharacterSnapshot {
  readonly identity: Readonly<CharacterIdentity>;
  readonly level: number;
  readonly xp: number;
  readonly gold: number;
  readonly unspentSkillPoints: number;
  readonly skillRanks: Readonly<Record<SkillNodeId, number>>;
  readonly hotbar: readonly [
    ActiveSkillId | null,
    ActiveSkillId | null,
    ActiveSkillId | null,
    ActiveSkillId | null
  ];
  readonly selectedHotbarSlot: 0 | 1 | 2 | 3;
  readonly bag: readonly (Readonly<ItemInstance> | null)[];
  readonly equipment: Readonly<Equipment>;
  readonly quests: Readonly<Record<QuestId, QuestSave>>;
}

interface CharacterDomain {
  dispatch(command: CharacterCommand): CharacterResult;
  snapshot(): DeepReadonly<CharacterSnapshot>;
}
```

Replace the current permissive `tsconfig.check.json` (notably
`types:[]`, `noImplicitAny:false`, and no scripts include) with this exact
contract:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["bun-types", "@webgpu/types"],
    "strict": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["main.ts", "src/**/*.ts", "scripts/**/*.ts"]
}
```

- [ ] Add a strict local TypeScript config covering `main.ts` and `src/**/*.ts`
  with DOM/ES2022/WebGPU types and `noEmit:true`.
- [ ] Make `CharacterDomain` the only mutable owner of long-term state.
- [ ] Keep all domain fields private; expose only `dispatch()` and immutable
  `snapshot()`.
- [ ] Return a detached deep clone from `snapshot()` and deep-freeze it in
  development/test builds. The mapped type must preserve the four-slot hotbar
  tuple. Add a runtime test that casts away readonly, attempts to mutate nested
  item affixes/quest state, asserts the frozen mutation throws, and proves the
  next domain snapshot is unchanged.
- [ ] Define `ItemInstance extends Item` with stable `instanceId` and make every
  current roll create one so the domain type is complete in M1.
- [ ] Reduce `PlayerStats` to runtime-only HP/MP/dead/hurt/cooldown state; level,
  XP, gold, skills, inventory, equipment, and quests move to the domain.
- [ ] Route every existing long-term mutation through character-domain commands.
- [ ] Create only Sorceress domains. Display legacy/non-Sorceress cards as
  disabled “In development” and reject entering them at the domain seam.
- [ ] New characters start with Frost Fang rank 1, hotbar
  `[frost,null,null,null]`, and selected slot 0.
- [ ] Keep the current shallow localStorage adapter temporarily reading/writing
  only projections from this domain; Task 2.1 replaces its wire format.
- [ ] Make the development `play-config.json` den-direct path create an explicit
  ephemeral Sorceress `CharacterDomain` through the same constructor; it may
  skip the title UI but may not bypass domain invariants.
- [ ] Run the new typecheck plus all global gates.
- [ ] Browser acceptance: only Sorceress starts, its domain snapshot contains
  Frost Fang rank 1 and `[frost,null,null,null]`, and disabled legacy cards
  cannot enter gameplay.

**Commit**

```bash
git commit -m "refactor(hellforge): establish character domain authority"
```

### Task 1.1 — Establish major UI ownership before new input paths

**Files**

- Create: `src/ui-layer-manager.ts`
- Create: `src/ui-layer-manager.test.ts`
- Modify: `src/inventory-ui.ts`
- Modify: `src/skill-panel.ts`
- Modify: `src/render-settings.ts`
- Modify: `main.ts`

**Interface**

```ts
type MajorPanel =
  | "inventory" | "skills" | "quests" | "character" | "dialogue" | "settings";

interface UiLayerManager {
  open(panel: MajorPanel): void;
  close(panel: MajorPanel): void;
  closeAll(): void;
  active(): MajorPanel | null;
  blocksWorldInput(): boolean;
}
```

- [ ] Prove in tests that opening a panel closes the previous owner and that
  dialogue has the same single-owner contract.
- [ ] Register current inventory/skill/settings surfaces through the manager.
- [ ] Clear movement/interaction intent when ownership changes.
- [ ] Keep game UI pointer handling on descendants; do not mutate `ctx.uiRoot`.
- [ ] Run gates.
- [ ] Browser acceptance: panel switching cannot leave overlapping surfaces or
  leak clicks into the world.

**Commit**

```bash
git commit -m "refactor(hellforge): centralize game UI ownership"
```

### Task 1.2 — Extract a pure camera rig

**Files**

- Create: `src/camera-rig.ts`
- Create: `src/camera-rig.test.ts`
- Modify: `main.ts`
- Modify: `src/render-settings.ts`
- Modify: `PLAY_EXPERIENCE.md`
- Modify: `AGENTS.md`

**Interface**

```ts
type CameraMode = "arpg" | "showcase";

interface CameraRigState {
  mode: CameraMode;
  focus: readonly [number, number, number];
  eye: readonly [number, number, number];
  yaw: number;
  pitch: number;
  distance: number;
  verticalFovRad: number;
}

interface CameraRigInput {
  target: readonly [number, number, number];
  dt: number;
  zoomDelta: number;
  shakeImpulse: readonly [number, number, number];
}

function updateArpgCamera(
  previous: CameraRigState,
  input: CameraRigInput,
  preset: ArpgCameraPreset,
): CameraRigState;
```

`CameraRigState` is the only source for Camera projection, world-to-screen,
cursor unprojection, aim direction, and Transform writes.

- [ ] Write tests proving exponential damping is frame-rate independent within
  tolerance (`60 × 1/60` and `30 × 1/30` produce near-equal results).
- [ ] Add three A/B presets using `degToRad()` at definition:
  - `fov48-distance12-yaw30`;
  - `fov50-distance12-yaw37`;
  - `fov55-distance12-yaw45`.
- [ ] Move current `FOV`, `TOP_DY`, `TOP_DZ`, camera quaternion, and
  `worldToScreen` assumptions behind the module.
- [ ] Keep `render-settings.applyCamera` as the sole writer of the engine
  `Camera` component. It consumes `verticalFovRad` from the rig; gameplay writes
  only the camera `Transform` pose returned by the rig.
- [ ] Replace full-amplitude per-frame random shake with a decaying impulse.
- [ ] Add bounded wheel zoom (10–14 m) without changing pitch.
- [ ] Remove the legacy `fps` naming and document `arpg/showcase`.
- [ ] Run unit and game-import gates.
- [ ] Browser A/B in camp, wilderness, and dungeon; record the selected preset
  in `PLAY_EXPERIENCE.md`.

**Commit**

```bash
git commit -m "refactor(hellforge): centralize camera rig and projection state"
```

### Task 1.3 — Add one movement-intent authority and navigation

**Files**

- Create: `src/movement-intent.ts`
- Create: `src/movement-intent.test.ts`
- Create: `src/navigation.ts`
- Create: `src/navigation.test.ts`
- Create: `src/skill-resolver.ts`
- Create: `src/skill-resolver.test.ts`
- Add: `assets/scenes/rogue-encampment.obstacles.json`
- Add: `assets/scenes/ashen-reach.layout.json`
- Modify: `src/dungeon.ts`
- Modify: `src/wild-terrain.ts`
- Modify: `src/skills.ts`
- Modify: `main.ts`

**Interface**

```ts
type MovementIntent =
  | { kind: "none" }
  | { kind: "point"; world: readonly [number, number] }
  | { kind: "target"; target: InteractionRef }
  | { kind: "vector"; x: number; z: number };

interface NavigationQuery {
  path(
    from: readonly [number, number],
    to: readonly [number, number],
  ): readonly (readonly [number, number])[];
  walkable(point: readonly [number, number], radius: number): boolean;
}

interface InteractionRegistry {
  resolve(ref: InteractionRef): ResolvedInteraction | null;
}

interface SkillCaster {
  cast(skillId: ActiveSkillId, aim: readonly [number, number]): CastResult;
}

interface ResolvedActiveSkill {
  damage: number;
  manaCost: number;
  cooldown: number;
  projectileSpeed: number;
  projectileLifetime: number;
  projectileCount: number;
  splashRadius: number;
  splashRatio: number;
  slowMagnitude: number;
  slowDuration: number;
  pierceCount: number;
  blinkRange: number;
}
```

- [ ] Write reducer tests:
  - WASD vector replaces point/target intent;
  - opening a major panel clears intent;
  - target interaction fires once at range;
  - stale target despawn clears intent;
  - ECS handle reuse cannot redirect an old interaction;
  - monster/NPC/loot/exit hit priority is deterministic.
- [ ] Adapt the existing dungeon walk grid to deterministic A*.
- [ ] Author Cinderwatch wall/prop blockers in
  `rogue-encampment.obstacles.json` and consume them through the same
  `NavigationQuery`.
- [ ] Create the Ashen Reach layout with its authored route and 2D navigation
  blockers now; `navigation.ts` consumes it. Task 4.2 later adds landmarks and
  seeded encounter/decor markers to the same file.
- [ ] Do not infer navigation from render meshes every frame.
- [ ] Implement the stable M1 `resolveSkill()`/`SkillCaster` seam using the full
  base-skill table from the specification, including projectile speed/lifetime,
  slow magnitude/duration, splash ratio/radius, pierce count, and Blink range.
  Task 3.2 extends this module with tree effects; it does not create another
  resolver or copy constants.
- [ ] Convert LMB ground pick to `point`.
- [ ] Convert LMB enemy/NPC/loot/entrance pick to `target`.
- [ ] Make LMB enemy pursuit call the same `SkillCaster.cast("frost")` seam as RMB,
  sharing rank, mana, cooldown, pierce, slow, and equipment modifiers.
- [ ] Make RMB cast the currently selected hotbar skill.
- [ ] Make 1–4 select slots only.
- [ ] Block world input whenever a major UI/dialogue owner is open.
- [ ] Run gates.
- [ ] Browser acceptance: click around a dungeon corner; interrupt with WASD;
  open inventory during movement; verify no stale movement resumes. Confirm LMB
  and RMB Frost consume the same mana/cooldown through `SkillCaster`. In camp,
  click behind a wall/prop and verify the route goes around its authored blocker.

**Commit**

```bash
git commit -m "feat(hellforge): unify click navigation and WASD intent"
```

### Task 1.4 — Close the walk/run animation contract

**Files**

- Modify: `CHARACTER-ANIMATION-CONTRACT.md`
- Modify: `src/heroes.ts`
- Modify: `main.ts`
- Modify: `scripts/merge-gen3d-motions.ts`
- Input: `assets/3d/characters/charactery.animated_model.motion-meshy-free-walk.glb`
- Input: `assets/3d/characters/charactery.animated_model.motion-meshy-free-run.glb`
- Modify: Sorceress merged GLB + sidecars

**Interface**

```ts
type HeroGltfClipName = "idle" | "walk" | "run" | "attack" | "hit" | "death";

function selectLocomotionClip(
  speed: number,
  isPathDriven: boolean,
): LocomotionClip;
```

- [ ] Resolve and validate the fixed walk/run inputs above; missing source blobs
  are a hard asset-preparation blocker.
- [ ] Extend the merge contract to the six slots
  `idle/walk/run/attack/hit/death`; update sidecar subAssets and
  `HeroGltfClipName`.
- [ ] Drive walk/run by actual velocity, not input key state.
- [ ] Calibrate playback rate to eliminate obvious foot sliding for point
  movement and WASD.
- [ ] Preserve attack/hit/death one-shot transitions.
- [ ] Run gates.
- [ ] Browser acceptance: long click-path walk, WASD takeover, and high-speed run
  all transition without animation reset loops.

**Commit**

```bash
git commit -m "feat(hellforge): add velocity-driven walk and run locomotion"
```

**Milestone 1 browser gate**

- Barbarian/Necromancer cannot start.
- Fixed isometric camera has no fisheye discomfort.
- LMB/WASD never fight over movement.
- RMB/1–4 follow the confirmed selection-and-cast contract.
- Dungeon corner navigation works.
- Old `fps` combat mode is unavailable.

---

## Milestone 2 — Persistent domain, combat derivation, and equipment

**Outcome:** The M1 `CharacterDomain` remains the sole long-term authority; a
versioned adapter persists it. Equipment changes one derived combat state and
persists with stable item instances.

### Task 2.1 — Introduce versioned character saves and migration

**Files**

- Create: `src/save-schema.ts`
- Create: `src/save-schema.test.ts`
- Rewrite: `src/save.ts`
- Modify: `src/classes.ts`
- Modify: `src/selection-gate.ts`
- Modify: `src/char-list.ts`
- Modify: `src/char-select.ts`
- Modify: `main.ts`

**Interface**

```ts
interface CharacterSaveEnvelope {
  readonly schemaVersion: 1;
  readonly character: Readonly<CharacterIdentity>;
  readonly progression: Readonly<ProgressionSave>;
  readonly inventory: Readonly<InventorySave>;
  readonly quests: Readonly<Record<QuestId, QuestSave>>;
  readonly checkpointId: "cinderwatch";
}

function loadEnvelope(id: string): DeepReadonly<CharacterSaveEnvelope> | null;
function hydrateCharacter(
  envelope: DeepReadonly<CharacterSaveEnvelope>,
): CharacterDomain;
function serializeCharacter(
  snapshot: DeepReadonly<CharacterSnapshot>,
): CharacterSaveEnvelope;
function saveSnapshot(snapshot: DeepReadonly<CharacterSnapshot>): void;
function migrateLegacySorceress(record: CharacterRecord): CharacterSaveEnvelope;
```

- [ ] Write parse/validation tests for missing, malformed, legacy, and v1 data.
- [ ] Keep `hellforge.characters.v1` read-only and write new envelopes to
  `hellforge.character-saves.v1`.
- [ ] Migrate only legacy Sorceress records; keep other classes visible but
  disabled and never rewrite their class.
- [ ] Make migration atomic/idempotent: write and re-read a valid new envelope
  before marking the in-memory list migrated; never delete legacy data.
- [ ] Test interruption before write, after write, and before UI refresh; each
  retry yields exactly one new envelope with the original identity/level.
- [ ] Create only Sorceress v1 saves; reject disabled classes at the domain seam.
- [ ] Validate→hydrate→discard each loaded envelope. Never retain the envelope
  as mutable gameplay state, and never expose domain internals to the adapter.
- [ ] Add a debounced save coordinator with explicit flush on cleanup.
- [ ] Synchronously flush pending snapshots on `pagehide`,
  `visibilitychange` when hidden, return-to-title, and game cleanup.
- [ ] Test a pending mutation followed by each flush event writes the latest
  immutable snapshot before control returns.
- [ ] Save on level-up, item mutation, skill mutation, quest transition, death,
  and return-to-title.
- [ ] Reload at Cinderwatch with full resources; do not restore position or
  cooldowns.
- [ ] Run gates.
- [ ] Browser acceptance: create, level, close/reopen, continue; legacy list
  remains visible and migrates once selected.

**Commit**

```bash
git commit -m "feat(hellforge): persist versioned character progression"
```

### Task 2.2 — Establish derived CombatStats and damage resolvers

**Files**

- Create: `src/combat-stats.ts`
- Create: `src/combat-stats.test.ts`
- Create: `src/damage.ts`
- Create: `src/damage.test.ts`
- Modify: `src/state.ts`
- Modify: `src/classes.ts`
- Modify: `src/items.ts`
- Modify: `src/skills.ts`
- Modify: `src/monsters.ts`
- Modify: `main.ts`

**Interface**

```ts
function deriveCombatStats(input: {
  character: DeepReadonly<CharacterSnapshot>;
  classDef: ClassDef;
}): CombatStats;

function resolveIncomingDamage(
  rawDamage: number,
  stats: CombatStats,
): number;

function preserveResourceRatio(
  current: number,
  previousMax: number,
  nextMax: number,
): number;
```

- [ ] Write tests for class/level/equipment derivation and stat caps.
- [ ] Write a monotonic defense/damage-reduction test.
- [ ] Prove repeated +HP equipment swap cannot heal.
- [ ] Replace `SkillSystem.mods` as an independently mutated authority with
  values supplied from `CombatStats`.
- [ ] Use only `CharacterDomain` for level/equipment/skill inputs; no closure,
  `PlayerStats`, panel, or save DTO may retain a writable copy.
- [ ] Route monster damage through `resolveIncomingDamage`.
- [ ] Remove or explicitly defer unconsumed attack-speed/base-weapon fields.
- [ ] Grant one skill point per level after level 1 in the persistent domain.
- [ ] Run gates.
- [ ] Browser acceptance: compare baseline damage taken/dealt, equip an item,
  repeat, and verify HUD/float numbers match derived values.

**Commit**

```bash
git commit -m "refactor(hellforge): derive combat stats from progression"
```

### Task 2.3 — Complete item persistence and equipment comparison

**Files**

- Modify: `src/items.ts`
- Create: `src/items.test.ts`
- Modify: `src/inventory-ui.ts`
- Modify: `src/hud.ts`
- Modify: `src/hud-view-model.ts`
- Modify: `src/ui-theme.ts`
- Modify: `main.ts`

**Interface**

```ts
function createFrostforgedWand(): ItemInstance;
function compareItems(
  candidate: ItemInstance,
  equipped: ItemInstance | null,
): readonly StatDelta[];
```

- [ ] Verify stable IDs created since Task 1.0 survive v1 save round trips.
- [ ] Add deterministic `霜铸魔杖` (`+20% frostDmg`, `+8% cdr`).
- [ ] Write round-trip serialization and comparison tests.
- [ ] Restyle the existing six-slot/24-cell UI into the specified paper doll.
- [ ] Show positive/negative/neutral stat deltas in hover comparison.
- [ ] Add melt confirmation and explicit bag-full feedback.
- [ ] Keep single-cell inventory; do not add item dimensions.
- [ ] Run gates.
- [ ] Browser acceptance at both resolutions: equip, swap, unequip, full bag,
  melt, reload.

**Commit**

```bash
git commit -m "feat(hellforge): persist item instances and equipment comparison"
```

**Milestone 2 browser gate**

- Long-term state survives reload.
- Current combat state does not.
- Equipment and displayed stats share one derivation.
- Repeated equip/unequip cannot restore HP.
- D2R-inspired inventory remains usable at 1280×720.

---

## Milestone 3 — Complete Sorceress skill tree

**Outcome:** Flame/Frost/Arcane tabs contain 15 implemented nodes with ranks,
prerequisites, level gates, respec, hotbar assignment, persistence, and actual
runtime effects.

### Task 3.1 — Implement skill-tree definitions and state transitions

**Files**

- Create: `src/skill-tree.ts`
- Create: `src/skill-tree.test.ts`
- Modify: `src/skills.ts`
- Modify: `src/save-schema.ts`

**Interface**

```ts
function nodeAvailability(
  node: SkillNodeDef,
  state: SkillTreeState,
  level: number,
): "locked" | "available" | "invested" | "maxed";

function investPoint(...): SkillTreeResult;
function respecInCamp(...): SkillTreeState;
```

- [ ] Import canonical `SkillNodeId`/`ActiveSkillId` from `content-ids.ts`; do
  not redeclare save-facing IDs.
- [ ] Encode all 15 nodes and the complete trigger/stack/cap formulas from the
  specification.
- [ ] Write tests for every prerequisite path, max rank, level gate, and point
  accounting.
- [ ] Assert the M1 free Frost Fang rank remains present; do not initialize it a
  second time.
- [ ] Keep active-skill identity stable (`magma/frost/arc/blink`) while mapping
  nodes to those existing skills.
- [ ] Reject respec outside Cinderwatch. In camp, preserve the free Frost Fang
  rank, refund only paid ranks, clear hotbar slots whose active skill is now
  unlearned, and select the valid Frost Fang slot.
- [ ] Run gates.

**Commit**

```bash
git commit -m "feat(hellforge): define persistent Sorceress skill tree"
```

### Task 3.2 — Move skill mechanics behind SkillResolver

**Files**

- Modify: `src/skill-resolver.ts`
- Modify: `src/skill-resolver.test.ts`
- Modify: `src/skills.ts`
- Modify: `src/monsters.ts`
- Modify: `main.ts`

**Interface**

```ts
function resolveSkill(
  skillId: ActiveSkillId,
  context: SkillResolveContext,
): ResolvedSkill;

interface ResolvedSkill extends ResolvedActiveSkill {
  onHit: readonly SkillEffect[];
}
```

- [ ] Write snapshot-style assertions for all 15 node effects.
- [ ] Assert the shared base table and caps: class crit 5%/1.5×, defense formula,
  45% CDR cap, 40% move cap, Magma 16/6/0.45, Frost 11/7/0.60, Arc
  8-per-bolt/9/0.80, and Phase Step 12/3.0/6.5 m.
- [ ] Replace `unlockLevel` checks with learned active-node checks.
- [ ] Extend the M1 resolver in place; do not introduce a second base table or
  casting seam.
- [ ] Convert boolean Frost pierce to a count.
- [ ] Implement burn, impact shards, slowed-target bonus, Phase Echo, and
  Overcharge at domain/runtime seams.
- [ ] Ensure tooltip values are generated from the same resolved data used by
  gameplay.
- [ ] Run gates.
- [ ] Browser acceptance: invest/respec each early branch and observe an actual
  damage/mechanic change.

**Commit**

```bash
git commit -m "refactor(hellforge): resolve skills from tree and combat state"
```

### Task 3.3 — Replace the information sheet with a real tree UI

**Files**

- Rewrite: `src/skill-panel.ts`
- Create: `src/skill-tree-layout.ts`
- Create: `src/skill-tree-layout.test.ts`
- Create: `src/dev-skill-fixture.ts`
- Modify: `src/hud.ts`
- Modify: `src/hud-view-model.ts`
- Modify: `src/ui-theme.ts`
- Modify: `main.ts`

**Interface**

```ts
interface SkillPanelCallbacks {
  getViewModel(): SkillTreeViewModel;
  invest(nodeId: SkillNodeId): SkillTreeResult;
  respec(): SkillTreeResult;
  assign(nodeId: SkillNodeId, slot: 0 | 1 | 2 | 3): SkillTreeResult;
}
```

- [ ] Render three branch tabs with prerequisite lines and four node states.
- [ ] Render rank, max rank, required level, current effect, and next-rank
  delta.
- [ ] Add an explicit camp-only respec control.
- [ ] Support active-skill assignment to four saved hotbar slots.
- [ ] Change number keys to selection only and visibly highlight the selected
  RMB slot.
- [ ] Enforce one major UI owner so tree/inventory/dialogue cannot overlap.
- [ ] Add a default-off development fixture gated by both
  `import.meta.env.DEV` and `?hfSkillFixture=1`; it can set level/points/ranks
  and restore the pre-fixture domain snapshot. Production builds expose no
  control or query-param effect.
- [ ] Run gates.
- [ ] Browser acceptance at both resolutions: invest, blocked prerequisite,
  max, assign, select, cast, respec, reload. Use the dev fixture in this
  milestone to verify all 15 nodes, including level-6 capstones.

**Commit**

```bash
git commit -m "feat(hellforge): ship three-branch Sorceress skill tree UI"
```

**Milestone 3 browser gate**

- Fifteen nodes render and every node changes gameplay.
- Frost Fang begins learned.
- Points, ranks, prerequisites, respec, and hotbar persist.
- Tooltip and observed combat numbers agree.

---

## Milestone 4 — NPC dialogue, formal quest, and area gates

**Outcome:** A visible camp NPC owns a linear dialogue flow. The formal Slagdeep
quest gates dungeon entry, tracks progress, requires return-to-camp turn-in, and
awards the Frostforged Wand.

### Task 4.1 — Implement quest and dialogue domains before area gates

**Files**

- Create: `src/quests.ts`
- Create: `src/quests.test.ts`
- Create: `src/combat-run.ts`
- Create: `src/combat-run.test.ts`
- Create: `src/dialogue.ts`
- Create: `src/dialogue.test.ts`
- Modify: `src/save-schema.ts`
- Modify: `main.ts`

**Interface**

```ts
function transitionQuest(
  state: QuestSave,
  command: QuestCommand,
): QuestTransitionResult;

function dialogueFor(
  npcId: NpcId,
  quests: Readonly<Record<QuestId, QuestSave>>,
): DialogueNode;

interface CombatRunSnapshot {
  readonly areaId: AreaId;
  readonly areaSeed: number;
  readonly objectives: Readonly<Record<
    "den-minions-cleared" | "slagdeep-boss-defeated",
    boolean
  >>;
}

interface CombatRunDomain {
  dispatch(command: CombatRunCommand): CombatRunResult;
  snapshot(): DeepReadonly<CombatRunSnapshot>;
}

function deriveAreaSeed(
  characterId: string,
  questId: QuestId,
  areaId: AreaId,
): number;
```

- [ ] Encode `purge-slagdeep-hollow` and Veyra's four state-dependent linear
  dialogue branches.
- [ ] Define transient objective IDs `den-minions-cleared` and
  `slagdeep-boss-defeated` in `CombatRunDomain`; both must complete in one active
  run. Do not serialize this run state.
- [ ] Implement `deriveAreaSeed()` as fixed 32-bit FNV-1a over
  `characterId + "|" + questId + "|" + areaId`; test stable vectors so reload
  derives the same seed without a saved duplicate.
- [ ] Add `mark-objective` and `reset` commands; `reset` clears both flags while
  preserving area/derived seed.
- [ ] Test valid/invalid transitions and idempotent reward claim.
- [ ] Replace `questDone` and automatic reward with quest commands.
- [ ] Mark `ready` only when both objective IDs are complete.
- [ ] Turn-in is transactional: if the bag is full, return `inventory-full`,
  grant nothing, and remain `ready`; after successful item insertion, grant
  120 XP and 250 gold, mark `completed`, and save exactly once.
- [ ] Build `霜铸魔杖` from `QuestRewardDef`, generating canonical
  `instanceId/label/score` fields.
- [ ] Autosave acceptance, readiness, and completion.
- [ ] Run gates.

**Commit**

```bash
git commit -m "feat(hellforge): add persistent quest and dialogue domains"
```

### Task 4.2 — Introduce AreaDef and deterministic hybrid wilderness

**Files**

- Create: `src/areas.ts`
- Create: `src/areas.test.ts`
- Modify: `assets/scenes/ashen-reach.layout.json`
- Modify: `src/wild-terrain.ts`
- Modify: `src/dungeon.ts`
- Modify: `src/bgm.ts`
- Modify: `src/automap.ts`
- Modify: `main.ts`

**Interface**

```ts
function getAreaDef(id: AreaId): AreaDef;
function canEnterArea(
  exit: AreaExitDef,
  quests: Readonly<Record<QuestId, QuestSave>>,
): boolean;
function enterArea(id: AreaId, entryId: string): AreaTransition;
```

- [ ] Register Cinderwatch, Ashen Reach, and Slagdeep Hollow.
- [ ] Move entry/exit, environment, music, and navigation selection behind
  `AreaDef`.
- [ ] Keep one-world teleport as an internal adapter; no caller uses the dungeon
  `(300,300)` offset.
- [ ] Allow Slagdeep entry for quest status `active|ready|completed`; deny
  `available`. Do not save a duplicate unlock boolean.
- [ ] Author one Ashen Reach route, landmarks `slag-bridge` and `fallen-forge`,
  navigation blockers, encounter markers, and decor markers in the layout.
- [ ] Inject the area seed into every encounter/decor choice; replace ambient
  `Math.random()` in wilderness generation.
- [ ] Test that the same seed reproduces marker choices and dungeon layout.
- [ ] Run gates.
- [ ] Browser acceptance: rejected entry before quest, accepted after, correct
  automap/BGM/environment, both landmarks visible, and same-seed regeneration
  reproducible.

**Commit**

```bash
git commit -m "refactor(hellforge): register deterministic hybrid areas"
```

### Task 4.3 — Reset failed combat runs through area and encounter contracts

**Files**

- Modify: `src/combat-run.ts`
- Modify: `src/combat-run.test.ts`
- Modify: `src/areas.ts`
- Modify: `src/dungeon.ts`
- Modify: `src/wild-terrain.ts`
- Modify: `src/monsters.ts`
- Modify: `src/loot.ts`
- Modify: `src/skills.ts`
- Modify: `src/fx.ts`
- Modify: `src/state.ts`
- Modify: `main.ts`

**Interface**

```ts
interface EncounterReset {
  clear(): void;
  reset(areaId: AreaId, seed: number): void;
}

interface CombatTransientResetters {
  encounters: EncounterReset;
  enemyAttacks: { clear(): void };
  playerSkills: { clearProjectilesAndCooldowns(): void };
  loot: { clearGroundDrops(): void };
  fx: { clearTransient(): void };
}

function resetCombatRun(input: {
  failedAreaId: AreaId;
  character: CharacterDomain;
  run: CombatRunDomain;
  runtime: PlayerRuntimeState;
  resetters: CombatTransientResetters;
  returnToCamp: () => AreaTransition;
}): DeepReadonly<CombatRunSnapshot>;
```

- [ ] Test that reset preserves immutable character identity/level/XP/gold/items,
  skills, and quest status.
- [ ] Clear monsters, boss, enemy attacks, player projectiles/cooldowns,
  transient VFX, ground loot, and active objective counters.
- [ ] If quest status is `active`, dispatch `run.reset`; then clear every
  injected transient resetter for all failed runs.
- [ ] Call `EncounterReset.reset(failedAreaId, run.snapshot().areaSeed)` so
  boss/encounters reproduce from the same derived seed.
- [ ] Transition the player to Cinderwatch and refill HP/MP.
- [ ] Preserve `ready/completed`; reset objective flags only for `active`.
- [ ] Remove the current 10% XP death penalty.
- [ ] Run gates.
- [ ] Browser acceptance: die once in wilderness and once in dungeon; verify
  return to camp, same-seed encounter/boss restoration, no stale
  projectile/drop/effect, and unchanged progression.

**Commit**

```bash
git commit -m "fix(hellforge): reset combat run cleanly on death"
```

### Task 4.4 — Author the NPC and quest/dialogue presentation

**Files**

- Modify: `assets/scenes/rogue-encampment.pack.json`
- Modify: corresponding scene refs/sidecars through the existing authoring
  scripts
- Create: `src/dialogue-ui.ts`
- Create: `src/quest-log.ts`
- Create: `scripts/validate-scene-pack.ts`
- Modify: `src/hud.ts`
- Modify: `src/ui-theme.ts`
- Modify: `main.ts`

**Interfaces**

```ts
interface DialogueHandle {
  show(node: DialogueNode): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

interface QuestLogHandle {
  update(quests: readonly QuestViewModel[]): void;
  setOpen(open: boolean): void;
  dispose(): void;
}
```

- [ ] Add authored `Name: NpcVeyraAnchor` at initial
  `Transform.pos:[3.2,0,2.0]`, `yaw:π`; tune position only from browser overlap
  evidence.
- [ ] Instantiate Veyra from `assets/characters/witch.glb`, scene GUID
  `5e3028dd-ddf6-4104-86d9-318d3e8fb5a6`, idle GUID
  `c530adf2-8de6-486a-afaa-9af3a6e6dfd1`, scale `1.15`, at that authored
  anchor. Asset resolution failure is fatal; no primitive substitute.
- [ ] Preserve contiguous scene `localId` values.
- [ ] Add a deterministic validator that fails on non-contiguous/duplicate
  `localId`, missing/duplicate `NpcVeyraAnchor`, out-of-range ref indices, or
  absent Veyra scene/idle GUID metadata.
- [ ] Register stable NPC ID `npc-cinderwarden-veyra` with interaction radius
  `2.2 m`; add marker and range feedback through `InteractionRegistry`.
- [ ] Add D2R-inspired lower dialogue panel with accept/continue/turn-in.
- [ ] Add `Q` quest log and persistent top-right tracker.
- [ ] Register dialogue and quest log with the M1 `UiLayerManager`; do not add
  panel-open booleans.
- [ ] Run gates and:

```bash
bun packages/games/hellforge/scripts/validate-scene-pack.ts \
  packages/games/hellforge/assets/scenes/rogue-encampment.pack.json
```
- [ ] Browser acceptance: full available→active→ready→completed loop, including
  reload in active and ready states.

**Commit**

```bash
git commit -m "feat(hellforge): author Veyra quest-giver and quest UI"
```

**Milestone 4 browser gate**

- No dungeon access before acceptance.
- No automatic reward on dungeon clear.
- Return dialogue grants the reward exactly once.
- A full bag grants nothing and keeps the quest ready until space is available.
- Active and ready states survive reload.
- Wilderness/dungeon death returns to camp and resets the same seeded run
  without changing character progression.

---

## Milestone 5 — Frost Fang visual benchmark and production SFX

**Outcome:** Frost Fang has coherent cast/projectile/impact/status language, and
the core loop uses licensed sample-based audio through explicit buses.

### Task 5.1 — Register Frost Fang shader assets

**Files**

- Create: `src/shaders/frost-fang.wgsl`
- Create: `src/shaders/frost-fang.wgsl.meta.json`
- Create: `src/shaders/frost-impact.wgsl`
- Create: `src/shaders/frost-impact.wgsl.meta.json`
- Create: `src/shaders/frost-slow.wgsl`
- Create: `src/shaders/frost-slow.wgsl.meta.json`
- Modify: `src/fx.ts`
- Modify: `src/skills.ts`
- Modify: `src/vite-env.d.ts` only if shader module typing requires it

**Interface**

```ts
interface FrostVfxHandles {
  projectile: MatHandle;
  impact: MatHandle;
  slow: MatHandle;
}
```

- [ ] Use the existing material UBO order and registry contract proven by
  `fire-bolt.wgsl`.
- [ ] Keep Edit-runtime emissive fallback.
- [ ] Implement premultiplied blending and ACES-safe peak output.
- [ ] Bind shader time/intensity from the existing mutable material params
  without creating per-projectile materials.
- [ ] Add cast cue, crystal core/trail, collision-aligned impact, and slow marker.
- [ ] Run typecheck/import/input gates.
- [ ] Browser acceptance in camp and dungeon at low/high cast density.

**Commit**

```bash
git commit -m "feat(hellforge): add Frost Fang shader visual language"
```

### Task 5.2 — Connect Shatter and status VFX to gameplay lifecycle

**Files**

- Modify: `src/fx.ts`
- Modify: `src/skills.ts`
- Modify: `src/monsters.ts`
- Modify: `src/skill-resolver.ts`
- Create: `src/fx-lifecycle.test.ts`

- [ ] Make slow-state visuals begin/end from the same gameplay status.
- [ ] Spawn Shatter fragments only when the learned node resolves them.
- [ ] Ensure effects despawn on projectile expiry, target death, area transition,
  and game cleanup.
- [ ] Add a debug counter under `window.__hf` for active projectile/effect counts.
- [ ] Test lifecycle bookkeeping without rendering.
- [ ] Run gates.
- [ ] Browser acceptance: sustained casting returns debug counts near baseline;
  overlapping effects remain readable and do not white out.

**Commit**

```bash
git commit -m "feat(hellforge): synchronize frost effects with skill state"
```

### Task 5.3 — Acquire and verify mandatory audio provenance

**Files**

- Add: `assets/audio/sfx/*.ogg`
- Add: `assets/audio/provenance.json`
- Generate: `assets/audio/LICENSES.md`
- Create: `src/audio-events.ts`
- Create: `scripts/verify-audio-manifest.ts`

**Manifest contract**

```ts
interface AudioManifest {
  events: Record<SfxEvent, {
    classification: "mandatory" | "optional-synthesis" | "remove";
    samples: string[];
  }>;
  music: Record<"camp" | "den", {
    samples: string[];
  }>;
  assets: Record<string, {
    sha256: string;
    source: string;
    license: string;
    attribution: string;
  }>;
}
```

Canonical filenames:

```text
cast-{magma,frost,arc,blink}-{1,2}.ogg
hit-monster-{1,2,3}.ogg
crit-{1,2}.ogg
kill-{1,2}.ogg
loot-{1,2}.ogg
equip-{1,2}.ogg
quest-{accept,complete}.ogg
ui-{confirm,cancel}.ogg
footstep-walk-{1,2,3,4}.ogg
footstep-run-{1,2,3,4}.ogg
boss-kill-1.ogg
player-hurt-{1,2}.ogg
player-die-1.ogg
potion-1.ogg
levelup-1.ogg
portal-1.ogg
```

- [ ] Acquire licensed/team-owned/CC0 OGG files for:
  - two variants each of Magma, Frost, Arc, and Phase Step cast;
  - three monster-hit variants;
  - two critical-hit, kill, loot, and equip variants each;
  - one quest-accept, quest-complete, UI-confirm, and UI-cancel each;
  - four walk and four run footstep variants.
- [ ] Add mandatory boss-kill, player-death, potion, level-up, and portal
  samples plus two player-hurt variants.
- [ ] Classify every existing `SfxEvent` as `mandatory`,
  `optional-synthesis`, or `remove`; no event remains implicit.
- [ ] Export the canonical event tuple/type from `audio-events.ts`; both mixer
  and verifier import it rather than maintaining separate lists.
- [ ] Add both existing `assets/music/bgm-camp.mp3` and `bgm-den.mp3` to the same
  manifest's `music` and `assets` maps; missing BGM provenance blocks this task.
- [ ] Record SHA-256, source URL or team-ownership statement, licence, and
  attribution in the `assets` map of `assets/audio/provenance.json` for every
  shipped track.
- [ ] Put classification/sample references in `.events`; `remove` and
  sample-less `optional-synthesis` entries have no asset record.
- [ ] Make the verifier fail for missing files, hash mismatch, missing mandatory
  groups, unclassified current events, dangling event→asset references,
  dangling music→asset references, unreferenced shipped assets, or blank
  licence/source fields.
- [ ] Generate `LICENSES.md` from `provenance.json`; JSON is the SSOT.
- [ ] Run the verifier. If provenance cannot be established, stop M5 here; do
  not substitute synthesized versions for mandatory events.

**Commit**

```bash
git commit -m "chore(hellforge): add verified combat audio sources"
```

### Task 5.4 — Add sample-based SFX buses

**Files**

- Create: `src/audio-bus.ts`
- Create: `src/audio-bus.test.ts`
- Rewrite: `src/sfx.ts` as the sample adapter
- Modify: `src/bgm.ts`
- Modify: `src/render-settings.ts`
- Modify: `main.ts`

**Interface**

```ts
interface AudioMixer {
  setMasterVolume(value: number): void;
  setBgmVolume(value: number): void;
  setSfxVolume(value: number): void;
  play(event: SfxEvent, options?: { variantSeed?: number }): void;
}
```

- [ ] Add Master/BGM/SFX buses with persisted user settings separate from the
  character save.
- [ ] Replace separate `window` SFX and `uiRoot` BGM unlock listeners with one
  `installAudioMixer(ctx.uiRoot)` gesture contract.
- [ ] Map every current event according to Task 5.3's three-state classification.
- [ ] Use 2–4 deterministic/random variants for repetitive events.
- [ ] Permit synthesis fallback only for explicitly optional projectile whooshes
  and ambient sweeteners; a missing mandatory mapping is a loud startup error.
- [ ] Run gates.
- [ ] Browser acceptance: BGM crossfade, rapid hits without clipping, distinct
  crit/kill weight, walk/run cadence, and volume controls.

**Commit**

```bash
git commit -m "feat(hellforge): layer licensed SFX through audio buses"
```

**Milestone 5 browser gate**

- Frost Fang reads as cast → projectile → impact → slow.
- Shatter appears only when learned.
- No visible effect leak or ACES whiteout.
- Core combat and UI have sample-based audio with documented provenance.

---

## Milestone 6 — D2R UI completion, camp showcase camera, and release acceptance

**Outcome:** The full UI hierarchy is coherent, camp showcase mode is smooth and
collision-safe, and the complete 15–20 minute slice passes at both resolutions.

### Task 6.1 — Complete D2R-inspired visual hierarchy and character panel

**Files**

- Modify: `src/hud.ts`
- Modify: `src/inventory-ui.ts`
- Modify: `src/skill-panel.ts`
- Modify: `src/dialogue-ui.ts`
- Modify: `src/quest-log.ts`
- Create: `src/character-panel.ts`
- Modify: `src/ui-theme.ts`
- Modify: `main.ts`

**New view model**

```ts
interface TargetViewModel {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
}
```

- [ ] Use the M1 `UiLayerManager`; do not introduce new panel ownership.
- [ ] Implement D2R-inspired health/mana globes, bottom skill bar, XP bar,
  quest tracker, automap, and character panel using original CSS/assets.
- [ ] Render current monster name/level/HP from `TargetViewModel`; elite affixes
  are not part of this slice.
- [ ] Add `C` stat sheet sourced only from `CombatStats`.
- [ ] Apply internal scrolling at 1280×720.
- [ ] Hide/reduce combat HUD in showcase mode.
- [ ] Run gates.
- [ ] Browser acceptance: keyboard/pointer ownership, panel switching, tooltips,
  no host UI interference at both resolutions.

**Commit**

```bash
git commit -m "feat(hellforge): unify D2R-inspired HUD and panel ownership"
```

### Task 6.2 — Implement camp-only third-person showcase

**Files**

- Modify: `src/camera-rig.ts`
- Create: `src/camera-probe.ts`
- Create: `src/camera-probe.test.ts`
- Modify: `assets/scenes/rogue-encampment.obstacles.json`
- Modify: `main.ts`
- Modify: `forge.json` only if the probe adapter requires existing physics
  configuration changes

**Interface**

```ts
interface CameraProbe {
  maxDistance(
    origin: readonly [number, number, number],
    desiredEye: readonly [number, number, number],
    skin: number,
  ): number;
}
```

- [ ] Reuse the M1 camp obstacle source for camera probes; only add probe-specific
  thickness/filter metadata where browser evidence requires it.
- [ ] Add 350–500 ms arpg↔showcase interpolation for FOV, eye, focus, yaw,
  pitch, and arm length.
- [ ] Restrict `V` to Cinderwatch and force `arpg` before leaving.
- [ ] Clear movement target, pursuit, and pending casts on transition.
- [ ] Disable combat/loot/entrance actions in showcase.
- [ ] Add spring-arm collision contraction and smoothed recovery.
- [ ] Remove edge-of-screen rotation; keep explicit orbit input.
- [ ] Run gates.
- [ ] Browser acceptance: orbit every camp wall/prop, no clipping, no combat,
  no stale target after returning to arpg.

**Commit**

```bash
git commit -m "feat(hellforge): add camp-only collision-safe showcase camera"
```

### Task 6.3 — Tune and sign off the complete vertical slice

**Files**

- Modify: data values in `src/skills.ts`, `src/skill-tree.ts`,
  `src/monsters.ts`, `src/items.ts`, and quest rewards only as evidence requires
- Modify: `PLAY_EXPERIENCE.md`
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `SHELL-PORT-PROGRESS.md`
- Modify: `package.json`
- Modify: `src/classes.ts`
- Add: browser acceptance notes/screenshots according to repository evidence
  conventions

- [ ] Run from a fresh Sorceress save at 1920×1080 and record total time.
- [ ] Repeat at 1280×720.
- [ ] Verify target time, level, point, drop, normal-monster hit range, and Boss
  duration.
- [ ] Reload at `active`, `ready`, and post-completion quest states.
- [ ] Die in wilderness and dungeon; verify the specified reset.
- [ ] Exercise all 15 skill nodes through the default-off M3 development fixture
  and restore its snapshot afterwards.
- [ ] Verify disabled classes cannot create a save.
- [ ] Verify all audio provenance entries match shipped files.
- [ ] Run:

```bash
bun test packages/games/hellforge/src
bunx tsc -p packages/games/hellforge/tsconfig.check.json --noEmit
bun run lint:game-imports
bun run lint:game-input
bun packages/games/hellforge/scripts/verify-audio-manifest.ts
bun packages/games/hellforge/scripts/validate-scene-pack.ts \
  packages/games/hellforge/assets/scenes/rogue-encampment.pack.json
```

- [ ] Do not cite `ONLY=hellforge bun scripts/website/build-games.mjs` as
  evidence: curation currently filters Hellforge before `ONLY`. Do not cite
  `bun fx check` as a Hellforge source gate: the games package has no such game
  gate. If a static targeted build becomes required, first land a separately
  reviewed build-script contract that truly bypasses curation.
- [ ] Update documentation to match runtime facts; remove superseded “FPS”,
  direct 1–4 cast, auto quest reward, and shallow-save claims.
- [ ] Audit current product copy/metadata and remove Diablo-owned world terms
  such as `扎卡拉姆` plus the package description
  `Diablo II-flavoured`; describe the product as an original dark-fantasy ARPG.

**Commit**

```bash
git commit -m "chore(hellforge): sign off Sorceress ARPG vertical slice"
```

**Milestone 6 / final browser gate**

A fresh user can complete all twelve conditions in
`ARPG-VERTICAL-SLICE-SPEC.md §15` without debug intervention.

---

## Execution order and review gates

```mermaid
flowchart LR
    M1[Domain, UI ownership, camera and input] --> M2[Save and combat]
    M2 --> M3[Skill tree]
    M3 --> M4[Quest and areas]
    M4 --> M5[VFX and audio]
    M5 --> M6[Showcase and signoff]
```

- Do not begin M3 before M2's save/combat state is authoritative.
- Do not begin M4 UI wiring before quest transition tests pass.
- Do not begin M5 audio without approved source files/provenance.
- Do not claim M6 camera collision before camp obstacle proxies exist.
- After each milestone, stop for human browser acceptance before continuing.

## Plan self-review checklist

- Specification coverage: all confirmed product decisions map to a task.
- No product subsystem is implemented only as a visual shell.
- `CharacterDomain` is the sole long-term mutable authority; save, combat,
  skill, quest, and UI modules consume it rather than mirror it.
- Third-person combat, multiplayer, four-stat allocation, multi-cell inventory,
  and copied Diablo assets remain excluded.
- Every new interface is consumed by a later task or replaces an existing
  distributed responsibility.
- Every task has a static gate; every milestone has browser acceptance.

## Execution handoff

Recommended execution mode: **subagent-driven, one task per fresh implementer,
followed by review and browser acceptance before the next task**. The plan does
not authorize implementation until the user selects an execution mode.
