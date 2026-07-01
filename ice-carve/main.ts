// ice-carve Stage A — fixed guillotine, voxel ice, RMB rotate ice, Space cut, WASD camera.

import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { BootstrapContext } from '@forgeax/engine-app';
import type { MaterialAsset } from '@forgeax/engine-types';
import {
  Camera,
  DirectionalLight,
  Materials,
  Skylight,
  Transform,
  perspective,
  quat,
} from '@forgeax/engine-runtime';

import { bindAudioGesture, playBladeThunk, playCutClean, startBgm } from './src/core/audio';
import {
  BLADE_COOLDOWN,
  BLADE_DROP_SEC,
  BLADE_WORLD_X,
  BLADE_Y_BOTTOM,
  BLADE_Y_TOP,
  CAM_MAX_Y,
  CAM_MIN_Y,
  CAM_MOVE_SPEED,
  CAM_PITCH,
  CAM_POS_X,
  CAM_POS_Y,
  CAM_POS_Z,
  CAM_YAW,
  ICE_ROT_X_SENS,
  ICE_ROT_Y_SENS,
  MOTHER_CELL_SIZE,
  MOTHER_GRID_SIZE,
  MOTHER_ICE_CENTER,
  TIME_SCALE_MAX,
  TIME_SCALE_MIN,
  TIME_SCALE_SPEED,
  WORKPIECE_CENTER,
} from './src/core/constants';
import { IceGrid, cutByWorldPlane } from './src/ice/ice-grid';
import { buildCutContourLocalMesh } from './src/ice/ice-cut-contour';
import {
  buildWorkpieceEdgeMesh,
  buildWorkpieceSilhouetteMesh,
  gridHalfExtents,
  spawnIceOverlay,
  spawnIceVoxel,
  updateIceVoxelMesh,
  updateOverlayMesh,
} from './src/ice/ice-visual';
import { installIceDrag } from './src/input/ice-drag';
import { disablePickingExcept } from './src/input/pick-filter';
import { spawnWorkshopColliders } from './src/physics/workshop-colliders';
import {
  spawnCarveTable,
  spawnDeliveryPlatform,
  spawnGuillotine,
  spawnMotherPedestal,
} from './src/props/stage-a-props';
import { installRendererErrorTap, logBootstrapMode } from './src/debug/ice-diagnostics';
import { loadScenePack } from './src/scene-loader';
import { installIceHud } from './src/ui/hud';

type MatHandle = ReturnType<World['allocSharedRef']>;

/** Visible sky-ish clear — without this WebGPU clears to black. */
const SKY_CLEAR = { clearR: 0.32, clearG: 0.42, clearB: 0.55 } as const;

/** Opaque unlit ice body — stable, no alpha flicker. */
function createIceMaterial(world: World): MatHandle {
  const base = Materials.unlit([0.48, 0.78, 0.98, 1], { castShadow: false });
  const passes = base.passes.map((p) => ({
    ...p,
    renderState: { ...p.renderState, cullMode: 'none' as const },
  }));
  return world.allocSharedRef<'MaterialAsset', MaterialAsset>(
    'MaterialAsset',
    { ...base, passes },
  );
}

function createOverlayMaterial(
  world: World,
  rgba: readonly [number, number, number, number],
): MatHandle {
  const base = Materials.unlit(rgba, { castShadow: false });
  const passes = base.passes.map((p) => ({
    ...p,
    renderState: { ...p.renderState, cullMode: 'none' as const },
  }));
  return world.allocSharedRef<'MaterialAsset', MaterialAsset>(
    'MaterialAsset',
    { ...base, passes },
  );
}

/** PBR needs Skylight ambient; keep a single directional (scene Sun or fallback). */
function ensureWorkshopLighting(world: World, sceneAlreadyLoaded: boolean): void {
  world.spawn({
    component: Skylight,
    data: { colorR: 1, colorG: 1, colorB: 1, intensity: 1.15 },
  });
  if (!sceneAlreadyLoaded) {
    world.spawn(
      { component: Transform, data: {} },
      {
        component: DirectionalLight,
        data: {
          directionX: -0.4, directionY: -1, directionZ: -0.3,
          colorR: 1, colorG: 0.96, colorB: 0.88, intensity: 3.2, castShadow: false,
        },
      },
    );
  }
}

function composeRotQuat(rotX: number, rotY: number): ReturnType<typeof quat.create> {
  const qy = quat.create();
  quat.fromAxisAngle(qy, [0, 1, 0], rotY);
  const qx = quat.create();
  quat.fromAxisAngle(qx, [1, 0, 0], rotX);
  const q = quat.create();
  quat.multiply(q, qy, qx);
  return q;
}

function worldFromEntityTransform(
  world: World,
  entity: EntityHandle,
  lx: number, ly: number, lz: number,
): [number, number, number] {
  const t = world.get(entity, Transform);
  if (!t.ok) return [lx, ly, lz];
  const v = t.value;
  const q: [number, number, number, number] = [
    v.quatX ?? 0, v.quatY ?? 0, v.quatZ ?? 0, v.quatW ?? 1,
  ];
  const out = quat.create();
  quat.transformVec3(out, q, [lx, ly, lz]);
  return [
    out[0]! + (v.posX ?? 0),
    out[1]! + (v.posY ?? 0),
    out[2]! + (v.posZ ?? 0),
  ];
}

function localFromEntityTransform(
  world: World,
  entity: EntityHandle,
  wx: number, wy: number, wz: number,
): [number, number, number] {
  const t = world.get(entity, Transform);
  if (!t.ok) return [wx, wy, wz];
  const v = t.value;
  const px = v.posX ?? 0, py = v.posY ?? 0, pz = v.posZ ?? 0;
  const q: [number, number, number, number] = [
    v.quatX ?? 0, v.quatY ?? 0, v.quatZ ?? 0, v.quatW ?? 1,
  ];
  const inv = quat.create();
  quat.invert(inv, q);
  const out = quat.create();
  quat.transformVec3(out, inv, [wx - px, wy - py, wz - pz]);
  return [out[0]!, out[1]!, out[2]!];
}

function workpieceTransformSig(world: World, entity: EntityHandle): string {
  const t = world.get(entity, Transform);
  if (!t.ok) return '';
  const v = t.value;
  const f = (n: number | undefined) => (n ?? 0).toFixed(5);
  return [
    f(v.posX), f(v.posY), f(v.posZ),
    f(v.quatX), f(v.quatY), f(v.quatZ), f(v.quatW),
  ].join('|');
}

function resolveCanvas(): HTMLCanvasElement | null {
  return document.querySelector('canvas') ?? document.querySelector<HTMLCanvasElement>('#app canvas');
}

function resizeCanvas(canvas: HTMLCanvasElement | null): number {
  if (!canvas) {
    return window.innerWidth / Math.max(1, window.innerHeight);
  }
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  return canvas.clientWidth / Math.max(1, canvas.clientHeight);
}

/** Free camera position + yaw/pitch look direction. */
function updateCameraTransform(
  camera: EntityHandle,
  world: World,
  camX: number,
  camY: number,
  camZ: number,
  camYaw: number,
  camPitch: number,
  aspect: number,
): void {
  const qy = quat.create();
  quat.fromAxisAngle(qy, [0, 1, 0], camYaw);
  const qx = quat.create();
  quat.fromAxisAngle(qx, [1, 0, 0], camPitch);
  const cq = quat.create();
  quat.multiply(cq, qy, qx);

  world.set(camera, Transform, {
    posX: camX,
    posY: camY,
    posZ: camZ,
    quatX: cq[0]!, quatY: cq[1]!, quatZ: cq[2]!, quatW: cq[3]!,
  });
  world.set(camera, Camera, {
    ...perspective({ fov: Math.PI / 3.2, aspect, near: 0.1, far: 80 }),
    ...SKY_CLEAR,
  });
}

function cameraPlanarAxes(camYaw: number): {
  fwdX: number; fwdZ: number; rightX: number; rightZ: number;
} {
  const fwdX = -Math.sin(camYaw);
  const fwdZ = -Math.cos(camYaw);
  return { fwdX, fwdZ, rightX: fwdZ, rightZ: -fwdX };
}

export async function bootstrap(world: World, ctx?: BootstrapContext) {
  const assets = ctx?.assets;
  const registerUpdate = ctx?.registerUpdate ?? (() => {});
  if (!assets) {
    console.error('[ice-carve] bootstrap missing ctx.assets — aborting');
    return;
  }

  logBootstrapMode(world, world);
  installRendererErrorTap(ctx?.app);

  const canvas = resolveCanvas();
  let aspect = resizeCanvas(canvas);

  const camera = world.spawn(
    { component: Transform, data: {} },
    {
      component: Camera,
      data: {
        ...perspective({ fov: Math.PI / 3.2, aspect, near: 0.1, far: 80 }),
        ...SKY_CLEAR,
      },
    },
  ).unwrap();

  const sceneOk = await loadScenePack({ world, assets });
  ensureWorkshopLighting(world, sceneOk);

  const woodMat = world.allocSharedRef<'MaterialAsset', MaterialAsset>(
    'MaterialAsset',
    Materials.standard({ baseColor: [0.45, 0.32, 0.2, 1], roughness: 0.88, metallic: 0, castShadow: false }),
  );
  const metalMat = world.allocSharedRef<'MaterialAsset', MaterialAsset>(
    'MaterialAsset',
    Materials.standard({ baseColor: [0.78, 0.8, 0.85, 1], roughness: 0.28, metallic: 0.9, castShadow: false }),
  );
  const iceMat = createIceMaterial(world);
  const iceEdgeMat = createOverlayMaterial(world, [0.05, 0.24, 0.48, 1]);
  const cutLineMat = createOverlayMaterial(world, [0.95, 0.12, 0.1, 1]);

  spawnCarveTable(world, woodMat, metalMat);
  spawnDeliveryPlatform(world, woodMat);
  spawnMotherPedestal(world, woodMat, metalMat);
  const { blade } = spawnGuillotine(world, woodMat, metalMat);
  spawnWorkshopColliders(world);

  const grid = new IceGrid();
  const motherGrid = new IceGrid(MOTHER_GRID_SIZE, MOTHER_CELL_SIZE);
  const workpieceY = 0.07 + gridHalfExtents(grid).hy;
  const motherY = 0.24 + gridHalfExtents(motherGrid).hy;
  const workpiece = spawnIceVoxel(
    world, iceMat, grid,
    { x: WORKPIECE_CENTER.x, y: workpieceY, z: WORKPIECE_CENTER.z },
    'Workpiece',
  );
  const workpieceEdges = spawnIceOverlay(
    world,
    iceEdgeMat,
    buildWorkpieceSilhouetteMesh(grid),
    { x: WORKPIECE_CENTER.x, y: workpieceY, z: WORKPIECE_CENTER.z },
    'WorkpieceEdges',
  );
  const motherIce = spawnIceVoxel(
    world, iceMat, motherGrid,
    { x: MOTHER_ICE_CENTER.x, y: motherY, z: MOTHER_ICE_CENTER.z },
    'MotherIce',
  );
  disablePickingExcept(world, new Set([workpiece, motherIce]));

  const hud = installIceHud();
  bindAudioGesture();

  let gridLinesVisible = false;

  function refreshWorkpieceEdges(): void {
    updateOverlayMesh(
      world,
      workpieceEdges,
      gridLinesVisible
        ? buildWorkpieceEdgeMesh(grid)
        : buildWorkpieceSilhouetteMesh(grid),
    );
  }

  function setGridLinesVisible(visible: boolean): void {
    gridLinesVisible = visible;
    refreshWorkpieceEdges();
  }

  hud.bindGridToggle(setGridLinesVisible);

  const keys: Record<string, boolean> = {};
  window.addEventListener('keydown', (e) => {
    keys[e.code] = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { keys[e.code] = false; });

  let camX = CAM_POS_X;
  let camY = CAM_POS_Y;
  let camZ = CAM_POS_Z;
  let camYaw = CAM_YAW;
  let camPitch = CAM_PITCH;
  let timeScale = 1;
  let rmbDown = false;
  let lastMx = 0;
  let lastMy = 0;

  canvas?.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas?.addEventListener('mousedown', (e) => {
    if (e.button === 2) {
      rmbDown = true;
      lastMx = e.clientX;
      lastMy = e.clientY;
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 2) rmbDown = false;
  });
  canvas?.addEventListener('wheel', (e) => {
    const cp = Math.cos(camPitch);
    const sp = Math.sin(camPitch);
    const lookX = -cp * Math.sin(camYaw);
    const lookY = sp;
    const lookZ = -cp * Math.cos(camYaw);
    const step = e.deltaY * 0.003;
    camX += lookX * step;
    camY += lookY * step;
    camZ += lookZ * step;
    camY = Math.max(CAM_MIN_Y, Math.min(CAM_MAX_Y, camY));
  }, { passive: true });
  window.addEventListener('resize', () => {
    aspect = resizeCanvas(resolveCanvas());
  });

  let rotX = 0;
  let rotY = 0;
  let cutCount = 0;
  let bladeAnim = 0;
  let bladePhase: 'idle' | 'down' | 'up' = 'idle';
  let cutCooldown = 0;
  let pendingCut = false;
  let prevSpace = false;
  let contourDirty = true;
  let lastWorkpieceSig = '';

  const workpieceToWorld = (lx: number, ly: number, lz: number) =>
    worldFromEntityTransform(world, workpiece, lx, ly, lz);
  const workpieceToLocal = (wx: number, wy: number, wz: number) =>
    localFromEntityTransform(world, workpiece, wx, wy, wz);

  const cutContour = spawnIceOverlay(
    world,
    cutLineMat,
    buildCutContourLocalMesh(grid, BLADE_WORLD_X, workpieceToWorld, workpieceToLocal, 0.005),
    { x: WORKPIECE_CENTER.x, y: workpieceY, z: WORKPIECE_CENTER.z },
    'CutContour',
  );

  const iceDrag = installIceDrag({
    world,
    camera,
    canvas,
    targets: () => [
      { entity: workpiece, label: 'Workpiece' },
      { entity: motherIce, label: 'MotherIce' },
    ],
    canDrag: () => bladePhase === 'idle',
    onGrab: (t) => hud.setStatus(`抓住${t.label === 'Workpiece' ? '冰坯' : '母冰'} · 拖动放置 · 松开落下`),
    onRelease: () => hud.setStatus(''),
  });

  function rebuildWorkpieceMesh(): void {
    updateIceVoxelMesh(world, workpiece, grid);
    refreshWorkpieceEdges();
    contourDirty = true;
  }

  function refreshCutContourIfDirty(): void {
    if (!contourDirty) return;
    updateOverlayMesh(
      world,
      cutContour,
      buildCutContourLocalMesh(grid, BLADE_WORLD_X, workpieceToWorld, workpieceToLocal, 0.005),
    );
    contourDirty = false;
  }

  function syncWorkpieceOverlays(): void {
    const t = world.get(workpiece, Transform);
    if (!t.ok) return;
    const tr = { ...t.value };
    world.set(cutContour, Transform, tr);
    world.set(workpieceEdges, Transform, tr);
  }

  function applyWorkpieceTransform(): void {
    const t = world.get(workpiece, Transform);
    if (!t.ok) return;
    const rq = composeRotQuat(rotX, rotY);
    world.set(workpiece, Transform, {
      ...t.value,
      quatX: rq[0]!, quatY: rq[1]!, quatZ: rq[2]!, quatW: rq[3]!,
    });
    syncWorkpieceOverlays();
  }

  window.addEventListener('mousemove', (e) => {
    if (!rmbDown) return;
    const dx = e.clientX - lastMx;
    const dy = e.clientY - lastMy;
    lastMx = e.clientX;
    lastMy = e.clientY;
    if (bladePhase !== 'idle' || iceDrag.isHoldingIce()) return;
    rotY += dx * ICE_ROT_Y_SENS;
    rotX += dy * ICE_ROT_X_SENS;
    applyWorkpieceTransform();
  });

  function performCut(): void {
    const removed = cutByWorldPlane(grid, BLADE_WORLD_X, workpieceToWorld);
    if (removed > 0) {
      rebuildWorkpieceMesh();
      playCutClean();
      hud.setStatus(`切掉 ${removed} 微格`);
    } else {
      hud.setStatus('未切到冰体');
    }
    cutCount++;
    hud.setCuts(cutCount);
  }

  applyWorkpieceTransform();
  contourDirty = true;
  refreshCutContourIfDirty();
  lastWorkpieceSig = workpieceTransformSig(world, workpiece);
  updateCameraTransform(camera, world, camX, camY, camZ, camYaw, camPitch, aspect);
  console.info('[ice-carve] ready sceneOk=%s', sceneOk);

  registerUpdate((dt) => {
    if (keys['ArrowUp']) {
      timeScale = Math.min(TIME_SCALE_MAX, timeScale + TIME_SCALE_SPEED * dt);
    }
    if (keys['ArrowDown']) {
      timeScale = Math.max(TIME_SCALE_MIN, timeScale - TIME_SCALE_SPEED * dt);
    }
    if (keys['ArrowRight']) {
      timeScale = Math.min(TIME_SCALE_MAX, timeScale + TIME_SCALE_SPEED * 0.55 * dt);
    }
    if (keys['ArrowLeft']) {
      timeScale = Math.max(TIME_SCALE_MIN, timeScale - TIME_SCALE_SPEED * 0.55 * dt);
    }

    const simDt = dt * timeScale;
    cutCooldown = Math.max(0, cutCooldown - simDt);
    syncWorkpieceOverlays();

    const { fwdX, fwdZ, rightX, rightZ } = cameraPlanarAxes(camYaw);
    const move = CAM_MOVE_SPEED * dt;
    if (keys['KeyW']) { camX += fwdX * move; camZ += fwdZ * move; }
    if (keys['KeyS']) { camX -= fwdX * move; camZ -= fwdZ * move; }
    if (keys['KeyA']) { camX -= rightX * move; camZ -= rightZ * move; }
    if (keys['KeyD']) { camX += rightX * move; camZ += rightZ * move; }
    camY = Math.max(CAM_MIN_Y, Math.min(CAM_MAX_Y, camY));

    const animLock = bladePhase !== 'idle';
    const dragLock = iceDrag.isHoldingIce();
    if (!animLock && !dragLock) {
      const space = !!keys['Space'];
      if (space && !prevSpace && cutCooldown <= 0) {
        pendingCut = true;
        bladePhase = 'down';
        bladeAnim = 0;
        cutCooldown = BLADE_COOLDOWN;
        playBladeThunk();
      }
      prevSpace = space;
    }

    if (bladePhase === 'down') {
      bladeAnim += simDt / BLADE_DROP_SEC;
      const t = Math.min(1, bladeAnim);
      const y = BLADE_Y_TOP + (BLADE_Y_BOTTOM - BLADE_Y_TOP) * t;
      world.set(blade, Transform, {
        posX: BLADE_WORLD_X, posY: y, posZ: 0,
        scaleX: 1, scaleY: 1, scaleZ: 1,
      });
      if (t >= 1) {
        if (pendingCut) {
          performCut();
          pendingCut = false;
        }
        bladePhase = 'up';
        bladeAnim = 0;
      }
    } else if (bladePhase === 'up') {
      bladeAnim += simDt / BLADE_DROP_SEC;
      const t = Math.min(1, bladeAnim);
      const y = BLADE_Y_BOTTOM + (BLADE_Y_TOP - BLADE_Y_BOTTOM) * t;
      world.set(blade, Transform, {
        posX: BLADE_WORLD_X, posY: y, posZ: 0,
        scaleX: 1, scaleY: 1, scaleZ: 1,
      });
      if (t >= 1) bladePhase = 'idle';
    }

    updateCameraTransform(camera, world, camX, camY, camZ, camYaw, camPitch, aspect);

    const sig = workpieceTransformSig(world, workpiece);
    if (sig !== lastWorkpieceSig) {
      contourDirty = true;
      lastWorkpieceSig = sig;
    }
    refreshCutContourIfDirty();
  });

  void startBgm();
}
