import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { Camera, pick, Transform } from '@forgeax/engine-runtime';
import { RigidBody, RigidBodyTypeValue } from '@forgeax/engine-physics';
import { mat4, ray as rayNs } from '@forgeax/engine-math';

export interface IceDragTarget {
  entity: EntityHandle;
  label: string;
}

export interface IceDragController {
  isDragging(): boolean;
  isHoldingIce(): boolean;
  activeTarget(): IceDragTarget | null;
}

type WorldView = World & {
  _getArrayView?(
    entity: EntityHandle,
    component: typeof Transform,
    fieldName: string,
  ): Float32Array | undefined;
};

/** Viewport pixel coords — must match game-default pick() (canvas backing store, not CSS px). */
function canvasPickCoords(canvas: HTMLCanvasElement, e: MouseEvent): { x: number; y: number; w: number; h: number } {
  const r = canvas.getBoundingClientRect();
  const scaleX = canvas.width / Math.max(1, r.width);
  const scaleY = canvas.height / Math.max(1, r.height);
  return {
    x: (e.clientX - r.left) * scaleX,
    y: (e.clientY - r.top) * scaleY,
    w: canvas.width,
    h: canvas.height,
  };
}

function readWorldMatrix(world: WorldView, entity: EntityHandle): Float32Array | undefined {
  const view = world._getArrayView?.(entity, Transform, 'world');
  if (!view) return undefined;
  return new Float32Array(view);
}

function rayOnPlaneY(
  world: World,
  camera: EntityHandle,
  sx: number,
  sy: number,
  vpW: number,
  vpH: number,
  planeY: number,
): [number, number, number] | null {
  const camRes = world.get(camera, Camera);
  const camWorld = readWorldMatrix(world as WorldView, camera);
  if (!camRes.ok || !camWorld) return null;

  const view = mat4.create();
  if (!mat4.invert(view, camWorld)) return null;

  const cam = camRes.value;
  const aspect = cam.aspect > 0 ? cam.aspect : vpW / vpH;
  const proj = mat4.create();
  mat4.perspective(proj, cam.fov, aspect, cam.near, cam.far);

  const r = rayNs.create();
  rayNs.screenToRay(r, sx, sy, vpW, vpH, view, proj, 'perspective');
  const oy = r[1]!;
  const dy = r[4]!;
  if (Math.abs(dy) < 1e-5) return null;
  const t = (planeY - oy) / dy;
  if (t < 0) return null;
  return [r[0]! + r[3]! * t, planeY, r[2]! + r[5]! * t];
}

function setBodyKinematic(world: World, entity: EntityHandle, kinematic: boolean): void {
  const rb = world.get(entity, RigidBody);
  if (!rb.ok) return;
  world.set(entity, RigidBody, {
    ...rb.value,
    type: kinematic ? RigidBodyTypeValue.kinematic : RigidBodyTypeValue.dynamic,
    gravityScale: kinematic ? 0 : 1,
    linearDamping: kinematic ? 1 : 0.35,
    angularDamping: kinematic ? 1 : 0.5,
  });
}

function setEntityPosition(world: World, entity: EntityHandle, x: number, y: number, z: number): void {
  const t = world.get(entity, Transform);
  if (!t.ok) return;
  world.set(entity, Transform, {
    ...t.value,
    posX: x,
    posY: y,
    posZ: z,
  });
}

function findTarget(targets: IceDragTarget[], entity: EntityHandle): IceDragTarget | null {
  for (const t of targets) {
    if (t.entity === entity) return t;
  }
  return null;
}

export function installIceDrag(opts: {
  world: World;
  camera: EntityHandle;
  canvas: HTMLCanvasElement | null;
  targets: () => IceDragTarget[];
  canDrag?: () => boolean;
  onGrab?: (t: IceDragTarget) => void;
  onRelease?: (t: IceDragTarget) => void;
}): IceDragController {
  const { world, camera, canvas, targets, canDrag, onGrab, onRelease } = opts;

  let active: IceDragTarget | null = null;
  let lmbDown = false;
  let offsetX = 0;
  let offsetY = 0;
  let offsetZ = 0;
  let planeY = 0;
  let lastMx = 0;
  let lastMy = 0;

  const tryPick = (e: MouseEvent): IceDragTarget | null => {
    if (!canvas) return null;
    const { x, y, w, h } = canvasPickCoords(canvas, e);
    const hit = pick(world, camera, x, y, w, h);
    if (!hit) return null;
    return findTarget(targets(), hit.entity);
  };

  const beginDrag = (target: IceDragTarget, e: MouseEvent): void => {
    active = target;
    const t = world.get(target.entity, Transform);
    if (!t.ok) return;
    const { x, y, w, h } = canvasPickCoords(canvas!, e);
    const hit = pick(world, camera, x, y, w, h);
    const px = t.value.posX ?? 0;
    const py = t.value.posY ?? 0;
    const pz = t.value.posZ ?? 0;
    planeY = py;
    if (hit) {
      offsetX = px - hit.point[0]!;
      offsetY = py - hit.point[1]!;
      offsetZ = pz - hit.point[2]!;
    } else {
      offsetX = offsetY = offsetZ = 0;
    }
    setBodyKinematic(world, target.entity, true);
    onGrab?.(target);
  };

  const endDrag = (): void => {
    if (!active) return;
    const released = active;
    setBodyKinematic(world, released.entity, false);
    active = null;
    onRelease?.(released);
  };

  const moveDrag = (e: MouseEvent): void => {
    if (!active || !canvas) return;
    const { x, y, w, h } = canvasPickCoords(canvas, e);
    const hit = rayOnPlaneY(world, camera, x, y, w, h, planeY);
    if (!hit) return;
    const nx = Math.max(-3.2, Math.min(3.2, hit[0]! + offsetX));
    const nz = Math.max(-3.2, Math.min(3.2, hit[2]! + offsetZ));
    setEntityPosition(world, active.entity, nx, planeY, nz);
    lastMx = e.clientX;
    lastMy = e.clientY;
  };

  canvas?.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (canDrag && !canDrag()) return;
    lmbDown = true;
    lastMx = e.clientX;
    lastMy = e.clientY;
    const target = tryPick(e);
    if (target) {
      e.preventDefault();
      beginDrag(target, e);
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!lmbDown || !active) return;
    moveDrag(e);
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button !== 0) return;
    lmbDown = false;
    if (active) endDrag();
  });

  return {
    isDragging: () => active !== null && (Math.abs(lastMx) > 0 || Math.abs(lastMy) > 0),
    isHoldingIce: () => lmbDown && active !== null,
    activeTarget: () => active,
  };
}
