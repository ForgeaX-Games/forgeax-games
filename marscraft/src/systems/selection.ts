/**
 * MarsCraft -> forgeax-engine — unit selection (Milestone M4)
 * =============================================================================
 * Port of the Three.js source `web/systems/SelectionSystem.ts`. The source did:
 *   - left-CLICK (no drag)      -> single-pick the highest-priority OWN unit
 *                                  under the cursor; Shift adds/toggles; clicking
 *                                  empty ground clears (unless Shift held).
 *   - left-DRAG (marquee box)   -> on release, select every OWN unit whose screen
 *                                  -projected center falls inside the box. Priority
 *                                  filter: if the box contains any non-worker
 *                                  combat units, ONLY those are kept (drag-select
 *                                  ignores workers when soldiers are present),
 *                                  exactly like the source `_finishBoxSelect`.
 *   - double-CLICK              -> select ALL on-screen units of the clicked
 *                                  unit's type (own faction), like SC2.
 *   - selection RING            -> a flat green ring on the ground under each
 *                                  selected unit, toggled with the selection flag.
 *   - marquee BOX               -> a DOM overlay div drawn over the canvas while
 *                                  dragging, hidden on release.
 *
 * ── forgeax mapping ──────────────────────────────────────────────────────────
 * The source ran in THREE with a Raycaster + `camera.project()`. forgeax has no
 * scene-graph picking, so picking is done in SCREEN SPACE: each frame the system
 * builds the camera view-projection from the camera entity's Transform (pos +
 * quat) + Camera (fov/aspect/near/far), projects every selectable OWN unit's
 * world center to NDC -> pixel, and does 2D hit tests. This is correct for the
 * pitched RTS rig (the camera quaternion + perspective fully define the
 * projection) and sidesteps terrain-height ambiguity that a ground-plane ray
 * would hit (units sit on a heightfield at varying Y).
 *
 * Picking always resolves to the PARENT unit entity (the one carrying
 * `Selectable` / `Faction` / `Transform`), never the ChildOf model-part children
 * (those have no Selectable and are skipped by the query).
 *
 * The selection ring is a child entity (engine `ChildOf` of the unit) carrying a
 * flat torus mesh + an unlit-ish bright-green material, spawned ONCE per unit and
 * shown/hidden by toggling its Transform scale (scale 0 = hidden). The ring mesh
 * + material are shared singletons (built once on first ring).
 *
 * No engine import beyond what M3 already uses; DOM is guarded so a headless load
 * cannot crash bootstrap (the system then runs logic-only with no overlay/ring
 * visuals only if document is present — rings need the renderer either way).
 */

import {
  Transform, Camera, MeshFilter, MeshRenderer, ChildOf,
  createTorusGeometry, quat,
  type Handle, type MeshAsset,
} from '@forgeax/engine-runtime';
import { Entity, type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Selectable, Faction, UnitType, PLAYER_ID, UNIT_CATEGORY,
} from '../components';
import type { TintFn } from '../world/unit-models';
import type { InputState } from '../input';

// =============================================================================
// Options + public handle
// =============================================================================

export interface SelectionOptions {
  /** Tint fn (closes over the PBR base GUID) for the ring material. */
  tint: TintFn;
  /** Player id whose units are selectable (source: local player). Default 0. */
  localPlayerId?: number;
  /** Pixel drag threshold to switch from click to box-select (source ~6px). */
  dragThreshold?: number;
  /** Double-click window in ms (source ~300ms). */
  doubleClickMs?: number;
  /** Ring color [r,g,b] 0..1 (source bright SC-green). */
  ringColor?: [number, number, number];
}

export interface SelectionHandle {
  /** Live array of currently-selected unit entities (consumed by M5+ commands). */
  getSelected(): EntityHandle[];
  /** True if `e` is currently selected. */
  isSelected(e: EntityHandle): boolean;
  /** Clear the whole selection (deselect all + hide rings). */
  clear(): void;
  /** Programmatically select exactly these entities (replaces current). */
  select(entities: EntityHandle[]): void;
  /** Test helper: select every OWN-faction unit (used by verify hook). */
  selectAll(): void;
  /**
   * Notify that an entity was despawned (e.g. by the M6 death-system): drop it
   * from the selection set and despawn its ground ring so no stale id / orphan
   * ring lingers. Idempotent; safe to call for non-selected entities.
   */
  notifyDespawned(e: EntityHandle): void;
  /** Detach DOM listeners + overlay (idempotent). */
  dispose(): void;
}

const DEFAULTS = {
  localPlayerId: PLAYER_ID.PLAYER,
  dragThreshold: 6,
  doubleClickMs: 300,
  ringColor: [0.25, 1.0, 0.35] as [number, number, number],
};

// =============================================================================
// Shared ring mesh + material (built once, reused by every selection ring)
// =============================================================================

interface RingAssets {
  mesh: Handle<'MeshAsset', 'shared'>;
  mat: Handle<'MaterialAsset', 'shared'>;
}

let _ringAssets: RingAssets | null = null;

function ringAssets(world: World, tint: TintFn, color: [number, number, number]): RingAssets | null {
  if (_ringAssets) return _ringAssets;
  // A thin flat ring: radius 1 (scaled per-unit by selectionRadius), small tube.
  const geo = createTorusGeometry(1.0, 0.08, 4, 32);
  if (!geo.ok) {
    console.error('[marscraft] selection ring geometry failed:', geo.error.code);
    return null;
  }
  const mesh = world.allocSharedRef('MeshAsset', geo.value as MeshAsset);
  // Bright, flat-reading green. roughness=1/metallic=0 + the strong Skylight makes
  // it read near-unlit; emissive would need the unlit material parent (kept simple).
  const mat = tint(color, { metallic: 0, roughness: 1 });
  _ringAssets = { mesh, mat };
  return _ringAssets;
}

// =============================================================================
// Math: project a world point to canvas pixel space via the camera VP
// =============================================================================

// quat.transformVec3 wants the engine's branded `Vec3` (a Float32Array with a
// phantom tag) for its `out` param; a plain Float32Array satisfies it at runtime,
// so we cast the scratch buffers to that param type. `Parameters<>` recovers the
// brand without importing the (non-runtime-re-exported) Vec3 alias.
type Vec3Out = Parameters<typeof quat.transformVec3>[0];
const _fwd = new Float32Array(3) as unknown as Vec3Out;
const _right = new Float32Array(3) as unknown as Vec3Out;
const _up = new Float32Array(3) as unknown as Vec3Out;

interface CamProj {
  px: number; py: number; pz: number;      // camera world position
  rx: number; ry: number; rz: number;      // world right axis
  ux: number; uy: number; uz: number;      // world up axis
  // forward is -(view z); we keep the view-forward (the dir the cam looks).
  fx: number; fy: number; fz: number;
  tanHalfFovY: number;                       // tan(fov/2)
  aspect: number;
  near: number;
}

/** Build the per-frame camera projection basis from the camera entity. */
function readCamera(world: World, cameraEntity: EntityHandle): CamProj | null {
  const tr = world.get(cameraEntity, Transform);
  const cam = world.get(cameraEntity, Camera);
  if (!tr.ok || !cam.ok) return null;
  const t = tr.value;
  const c = cam.value;
  const q: [number, number, number, number] = [t.quatX, t.quatY, t.quatZ, t.quatW];
  // Default camera looks down -Z, right +X, up +Y (engine convention). Rotate the
  // basis by the camera quaternion to get world-space axes.
  quat.transformVec3(_fwd, q, [0, 0, -1]);
  quat.transformVec3(_right, q, [1, 0, 0]);
  quat.transformVec3(_up, q, [0, 1, 0]);
  return {
    px: t.posX, py: t.posY, pz: t.posZ,
    rx: _right[0], ry: _right[1], rz: _right[2],
    ux: _up[0], uy: _up[1], uz: _up[2],
    fx: _fwd[0], fy: _fwd[1], fz: _fwd[2],
    tanHalfFovY: Math.tan((c.fov as number) / 2),
    aspect: c.aspect as number,
    near: c.near as number,
  };
}

interface Projected {
  x: number; y: number;   // canvas pixel coords (y-down, matching input.x/y)
  depth: number;          // camera-space forward distance (>0 = in front)
  visible: boolean;       // in front of the near plane
}

/**
 * Project a world point to canvas pixels. Returns depth (forward distance) so the
 * caller can z-sort / reject points behind the camera.
 */
function projectPoint(
  cam: CamProj, wx: number, wy: number, wz: number,
  canvasW: number, canvasH: number, out: Projected,
): void {
  const dx = wx - cam.px;
  const dy = wy - cam.py;
  const dz = wz - cam.pz;
  // Camera-space coords: x=right, y=up, z=forward (into the scene).
  const csx = dx * cam.rx + dy * cam.ry + dz * cam.rz;
  const csy = dx * cam.ux + dy * cam.uy + dz * cam.uz;
  const csz = dx * cam.fx + dy * cam.fy + dz * cam.fz; // forward distance
  out.depth = csz;
  if (csz <= cam.near) { out.visible = false; out.x = 0; out.y = 0; return; }
  // Perspective divide -> NDC [-1,1].
  const ndcX = csx / (csz * cam.tanHalfFovY * cam.aspect);
  const ndcY = csy / (csz * cam.tanHalfFovY);
  // NDC (y-up) -> canvas pixels (y-down).
  out.x = (ndcX * 0.5 + 0.5) * canvasW;
  out.y = (1 - (ndcY * 0.5 + 0.5)) * canvasH;
  out.visible = true;
}

// =============================================================================
// DOM marquee overlay (guarded; no-op when no document)
// =============================================================================

interface Overlay {
  show(x0: number, y0: number, x1: number, y1: number): void;
  hide(): void;
  dispose(): void;
}

function makeOverlay(): Overlay {
  if (typeof document === 'undefined') {
    return { show() {}, hide() {}, dispose() {} };
  }
  const host = document.querySelector<HTMLElement>('#app')?.parentElement ?? document.body;
  const div = document.createElement('div');
  div.style.cssText = [
    'position:absolute',
    'pointer-events:none',
    'border:1px solid rgba(80,255,120,0.9)',
    'background:rgba(80,255,120,0.12)',
    'z-index:9999',
    'display:none',
    'left:0', 'top:0', 'width:0', 'height:0',
  ].join(';');
  // Ensure the host is a positioning context so absolute coords align to it.
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.appendChild(div);
  return {
    show(x0, y0, x1, y1) {
      const left = Math.min(x0, x1);
      const top = Math.min(y0, y1);
      div.style.left = `${left}px`;
      div.style.top = `${top}px`;
      div.style.width = `${Math.abs(x1 - x0)}px`;
      div.style.height = `${Math.abs(y1 - y0)}px`;
      div.style.display = 'block';
    },
    hide() { div.style.display = 'none'; },
    dispose() { div.remove(); },
  };
}

// =============================================================================
// installSelection
// =============================================================================

const _qe = quat.create();

export function installSelection(
  world: World,
  cameraEntity: EntityHandle,
  input: InputState,
  opts: SelectionOptions,
): SelectionHandle {
  const localPlayerId = opts.localPlayerId ?? DEFAULTS.localPlayerId;
  const dragThreshold = opts.dragThreshold ?? DEFAULTS.dragThreshold;
  const doubleClickMs = opts.doubleClickMs ?? DEFAULTS.doubleClickMs;
  const ringColor = opts.ringColor ?? DEFAULTS.ringColor;

  // ── selection state ────────────────────────────────────────────────────────
  // Set keyed on the entity's numeric id (EntityHandle is a branded number).
  const selectedSet = new Set<number>();
  // ring child entity per selected unit (entity id -> ring entity).
  const ringOf = new Map<number, EntityHandle>();

  const overlay = makeOverlay();

  // ── drag tracking (mirror source _isDragging / _dragStart) ───────────────────
  let leftWasDown = false;
  let dragStartX = 0;
  let dragStartZ = 0;          // dragStartY in pixel space (named Z to avoid world-Y clash)
  let isDragging = false;
  let lastClickTime = 0;
  let lastClickEntity = -1;

  // Reusable projection scratch.
  const proj: Projected = { x: 0, y: 0, depth: 0, visible: false };

  // forgeax queries are only live inside a system's fn (the batch column views are
  // valid only for that frame). Pointer-up resolution therefore runs INSIDE the
  // system fn, against that frame's query bundle, captured here for the helpers.
  // Shapes: each batch exposes `Entity.self[]`, `Transform.posX/Y/Z[]`,
  // `Selectable.selectionRadius/priority[]`, `Faction.playerId[]`, `UnitType.*[]`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type UnitBatch = any;
  let currentBatches: UnitBatch[] = [];

  // A snapshot of OWN-faction unit entities, refreshed every frame in the system
  // fn. Lets synchronous, outside-the-fn callers (the verify hook's selectAll /
  // future minimap / hotkey group select) act on the unit set without a live
  // query bundle. Populated on the first frame after spawns.
  let ownUnitsRegistry: EntityHandle[] = [];
  // Deferred selection requests queued by outside-fn callers, serviced next tick
  // against the live batches (where projection / category data is available).
  type Pending = { kind: 'selectAll' } | { kind: 'select'; entities: EntityHandle[] };
  const pendingActions: Pending[] = [];

  // ── helpers ──────────────────────────────────────────────────────────────

  const isOwn = (playerId: number) => playerId === localPlayerId;

  /** Spawn (once) + show / hide the ground ring for a unit. */
  function setRing(e: EntityHandle, on: boolean): void {
    const id = e as unknown as number;
    if (on) {
      let ring = ringOf.get(id);
      if (ring === undefined) {
        const ra = ringAssets(world, opts.tint, ringColor);
        if (!ra) return;
        const sel = world.get(e, Selectable);
        const radius = sel.ok ? Math.max(0.4, sel.value.selectionRadius * 1.4) : 1.0;
        // Flat on the ground: torus is built in the XY plane -> rotate -90° about
        // X so it lies in XZ. Slight +Y lift so it z-fights neither terrain nor
        // the model. Local Transform; ChildOf the unit so it tracks its position.
        quat.fromAxisAngle(_qe, [1, 0, 0], -Math.PI / 2);
        const yLift = 0.05; // ring sits just above the unit's base
        const res = world.spawn(
          {
            component: Transform,
            data: {
              posX: 0, posY: yLift, posZ: 0,
              quatX: _qe[0], quatY: _qe[1], quatZ: _qe[2], quatW: _qe[3],
              scaleX: radius, scaleY: radius, scaleZ: radius,
            },
          },
          { component: MeshFilter, data: { assetHandle: ra.mesh } },
          { component: MeshRenderer, data: { materials: [ra.mat] } },
          { component: ChildOf, data: { parent: e } },
        );
        if (res.ok) { ring = res.value; ringOf.set(id, ring); }
      } else {
        // Re-show: restore the per-unit scale.
        const sel = world.get(e, Selectable);
        const radius = sel.ok ? Math.max(0.4, sel.value.selectionRadius * 1.4) : 1.0;
        quat.fromAxisAngle(_qe, [1, 0, 0], -Math.PI / 2);
        world.set(ring, Transform, {
          posX: 0, posY: 0.05, posZ: 0,
          quatX: _qe[0], quatY: _qe[1], quatZ: _qe[2], quatW: _qe[3],
          scaleX: radius, scaleY: radius, scaleZ: radius,
        });
      }
    } else {
      const ring = ringOf.get(id);
      if (ring !== undefined) {
        // Hide by collapsing scale to 0 (cheaper than despawn+respawn churn).
        world.set(ring, Transform, { scaleX: 0, scaleY: 0, scaleZ: 0 });
      }
    }
  }

  function deselect(e: EntityHandle): void {
    const id = e as unknown as number;
    if (!selectedSet.has(id)) return;
    selectedSet.delete(id);
    const sel = world.get(e, Selectable);
    if (sel.ok) world.set(e, Selectable, { selected: false });
    setRing(e, false);
  }

  function selectOne(e: EntityHandle): void {
    const id = e as unknown as number;
    if (selectedSet.has(id)) return;
    selectedSet.add(id);
    const sel = world.get(e, Selectable);
    if (sel.ok) world.set(e, Selectable, { selected: true });
    setRing(e, true);
  }

  function clearAll(): void {
    for (const id of Array.from(selectedSet)) {
      deselect(id as unknown as EntityHandle);
    }
    selectedSet.clear();
  }

  // ── pointer-frame processing (runs as an ECS system) ─────────────────────────

  function onLeftDown(px: number, py: number): void {
    dragStartX = px;
    dragStartZ = py;
    isDragging = false;
  }

  function onLeftDrag(px: number, py: number): void {
    if (!isDragging) {
      const dx = px - dragStartX;
      const dy = py - dragStartZ;
      if (dx * dx + dy * dy >= dragThreshold * dragThreshold) isDragging = true;
    }
    if (isDragging) overlay.show(dragStartX, dragStartZ, px, py);
  }

  function onLeftUp(px: number, py: number): void {
    const shift = input.keys.has('ShiftLeft') || input.keys.has('ShiftRight');
    if (isDragging) {
      overlay.hide();
      finishBoxSelect(dragStartX, dragStartZ, px, py, shift);
      isDragging = false;
    } else {
      finishClick(px, py, shift);
    }
  }

  /** Build the camera projection once per resolve. */
  function withCamera(fn: (cam: CamProj, w: number, h: number) => void): void {
    const cam = readCamera(world, cameraEntity);
    if (!cam) return;
    const w = Math.max(1, input.canvasWidth);
    const h = Math.max(1, input.canvasHeight);
    fn(cam, w, h);
  }

  function finishClick(px: number, py: number, shift: boolean): void {
    withCamera((cam, w, h) => {
      // Pick the highest-priority OWN unit whose projected disc contains the cursor;
      // tie-break by nearer depth (source picked the closest on a priority tie).
      let bestE: EntityHandle | null = null;
      let bestPriority = -1;
      let bestDepth = Infinity;

      for (const batch of currentBatches) {
        const n = batch.Entity.self.length;
        for (let i = 0; i < n; i++) {
          if (!isOwn(batch.Faction.playerId[i])) continue;
          const wx = batch.Transform.posX[i];
          const wy = batch.Transform.posY[i];
          const wz = batch.Transform.posZ[i];
          projectPoint(cam, wx, wy, wz, w, h, proj);
          if (!proj.visible) continue;
          // Screen-space pick radius from the unit's selectionRadius, scaled by the
          // perspective so nearer units have a bigger clickable disc (source did a
          // sphere intersect; this is its screen-space equivalent).
          const sel = batch.Selectable.selectionRadius[i];
          const pxRadius = (sel / (proj.depth * cam.tanHalfFovY)) * (h * 0.5);
          const hitR = Math.max(8, pxRadius); // floor so tiny far units stay clickable
          const ddx = px - proj.x;
          const ddy = py - proj.y;
          if (ddx * ddx + ddy * ddy > hitR * hitR) continue;
          const priority = batch.Selectable.priority[i];
          if (priority > bestPriority || (priority === bestPriority && proj.depth < bestDepth)) {
            bestPriority = priority;
            bestDepth = proj.depth;
            bestE = batch.Entity.self[i];
          }
        }
      }

      const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());

      if (bestE === null) {
        // Empty ground: clear unless shift-additive.
        if (!shift) clearAll();
        lastClickEntity = -1;
        lastClickTime = now;
        return;
      }

      const bestId = bestE as unknown as number;

      // Double-click: select all on-screen units of this type (own faction).
      const isDouble =
        now - lastClickTime <= doubleClickMs && lastClickEntity === bestId;
      if (isDouble) {
        selectAllOfTypeOnScreen(bestE, cam, w, h, shift);
        lastClickTime = now;
        lastClickEntity = bestId;
        return;
      }

      if (shift) {
        // Toggle in additive mode (source shift-click behaviour).
        if (selectedSet.has(bestId)) deselect(bestE);
        else selectOne(bestE);
      } else {
        clearAll();
        selectOne(bestE);
      }
      lastClickTime = now;
      lastClickEntity = bestId;
    });
  }

  /** Double-click: add every own on-screen unit sharing bestE's typeId. */
  function selectAllOfTypeOnScreen(
    bestE: EntityHandle, cam: CamProj, w: number, h: number, shift: boolean,
  ): void {
    const targetType = world.get(bestE, UnitType);
    if (!targetType.ok) { selectOne(bestE); return; }
    const wantCategory = targetType.value.category;
    const wantRace = targetType.value.race;
    const wantCombat = targetType.value.combatType;
    if (!shift) clearAll();
    for (const batch of currentBatches) {
      const n = batch.Entity.self.length;
      for (let i = 0; i < n; i++) {
        if (!isOwn(batch.Faction.playerId[i])) continue;
        if (batch.UnitType.category[i] !== wantCategory) continue;
        if (batch.UnitType.race[i] !== wantRace) continue;
        if (batch.UnitType.combatType[i] !== wantCombat) continue;
        const e = batch.Entity.self[i];
        const wx = batch.Transform.posX[i];
        const wy = batch.Transform.posY[i];
        const wz = batch.Transform.posZ[i];
        projectPoint(cam, wx, wy, wz, w, h, proj);
        if (!proj.visible) continue;
        if (proj.x < 0 || proj.x > w || proj.y < 0 || proj.y > h) continue; // on-screen only
        selectOne(e);
      }
    }
  }

  function finishBoxSelect(
    x0: number, y0: number, x1: number, y1: number, shift: boolean,
  ): void {
    withCamera((cam, w, h) => {
      const minX = Math.min(x0, x1);
      const maxX = Math.max(x0, x1);
      const minY = Math.min(y0, y1);
      const maxY = Math.max(y0, y1);

      // Pass 1: collect own units whose projected center is in the box, recording
      // whether each is a combat (non-worker, non-building) unit.
      const inBox: { e: EntityHandle; combat: boolean }[] = [];
      for (const batch of currentBatches) {
        const n = batch.Entity.self.length;
        for (let i = 0; i < n; i++) {
          if (!isOwn(batch.Faction.playerId[i])) continue;
          const wx = batch.Transform.posX[i];
          const wy = batch.Transform.posY[i];
          const wz = batch.Transform.posZ[i];
          projectPoint(cam, wx, wy, wz, w, h, proj);
          if (!proj.visible) continue;
          if (proj.x < minX || proj.x > maxX || proj.y < minY || proj.y > maxY) continue;
          const cat = batch.UnitType.category[i];
          const combat = cat !== UNIT_CATEGORY.WORKER && cat !== UNIT_CATEGORY.BUILDING;
          inBox.push({ e: batch.Entity.self[i], combat });
        }
      }

      if (inBox.length === 0) {
        // Empty box: clear unless additive (source cleared a non-additive empty box).
        if (!shift) clearAll();
        return;
      }

      // Priority filter (source `_finishBoxSelect`): if any combat units are in the
      // box, select ONLY combat units (drag-select ignores workers when soldiers
      // are present). Otherwise select everything in the box.
      const anyCombat = inBox.some((u) => u.combat);
      const keep = anyCombat ? inBox.filter((u) => u.combat) : inBox;

      if (!shift) clearAll();
      for (const u of keep) selectOne(u.e);
    });
  }

  // ── the ECS system: drains pointer transitions each frame ────────────────────
  // The query bundle (own + enemy selectable units, with their UnitType) is live
  // only inside this fn, so pointer-up resolution (which needs to iterate units)
  // runs here against the current frame's batches.
  world.addSystem({
    name: 'mc-selection',
    queries: [{ with: [Entity, Transform, Selectable, Faction, UnitType] }],
    resources: [],
    fn: (_w, queryResults) => {
      currentBatches = queryResults[0] as unknown as UnitBatch[];

      // Refresh the OWN-unit registry from this frame's bundle.
      const reg: EntityHandle[] = [];
      for (const batch of currentBatches) {
        const n = batch.Entity.self.length;
        for (let i = 0; i < n; i++) {
          if (isOwn(batch.Faction.playerId[i])) reg.push(batch.Entity.self[i]);
        }
      }
      ownUnitsRegistry = reg;

      // Service deferred requests from outside-fn callers.
      if (pendingActions.length) {
        for (const a of pendingActions) {
          if (a.kind === 'selectAll') {
            clearAll();
            for (const e of reg) selectOne(e);
          } else {
            clearAll();
            for (const e of a.entities) selectOne(e);
          }
        }
        pendingActions.length = 0;
      }

      const leftDown = input.buttons.left;
      const px = input.x;
      const py = input.y;
      if (leftDown && !leftWasDown) {
        onLeftDown(px, py);
      } else if (leftDown && leftWasDown) {
        onLeftDrag(px, py);
      } else if (!leftDown && leftWasDown) {
        onLeftUp(px, py);
      }
      leftWasDown = leftDown;
      currentBatches = [];
    },
  });

  // ── public handle ────────────────────────────────────────────────────────
  const handle: SelectionHandle = {
    getSelected() {
      return Array.from(selectedSet).map((id) => id as unknown as EntityHandle);
    },
    isSelected(e: EntityHandle) {
      return selectedSet.has(e as unknown as number);
    },
    clear() { clearAll(); },
    select(entities: EntityHandle[]) {
      clearAll();
      for (const e of entities) selectOne(e);
    },
    selectAll() {
      // Select synchronously from the registry (populated after frame 1). If the
      // system hasn't ticked yet (registry empty), defer to the next tick so the
      // call is still deterministic for the verify hook.
      if (ownUnitsRegistry.length > 0) {
        clearAll();
        for (const e of ownUnitsRegistry) selectOne(e);
      } else {
        pendingActions.push({ kind: 'selectAll' });
      }
    },
    notifyDespawned(e: EntityHandle) {
      const id = e as unknown as number;
      selectedSet.delete(id);
      const ring = ringOf.get(id);
      if (ring !== undefined) {
        world.despawn(ring);
        ringOf.delete(id);
      }
    },
    dispose() {
      overlay.dispose();
      clearAll();
    },
  };

  return handle;
}
