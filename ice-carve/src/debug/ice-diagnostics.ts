import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { App } from '@forgeax/engine-app';
import {
  Camera,
  MeshFilter,
  MeshRenderer,
  Name,
  Transform,
  resolveAssetHandle,
} from '@forgeax/engine-runtime';
import { handleSlot } from '@forgeax/engine-types';
import type { MaterialAsset, MeshAsset } from '@forgeax/engine-types';

type MatHandle = ReturnType<World['allocSharedRef']>;

const LOG = '[ice-carve:diag]';

export function logBootstrapMode(worldOrCtx: unknown, world: World): void {
  const mode = typeof worldOrCtx === 'object' && worldOrCtx !== null && 'world' in worldOrCtx
    ? 'GameContext'
    : 'World';
  console.info(`${LOG} bootstrap mode=${mode} worldTag=${Object.prototype.toString.call(world)}`);
}

export function installRendererErrorTap(app: App | undefined): () => void {
  if (!app?.onError) {
    console.warn(`${LOG} app.onError unavailable — renderer errors may be silent`);
    return () => {};
  }
  const errors: string[] = [];
  const unsub = app.onError((e: { code?: string; hint?: string; message?: string }) => {
    const line = `${e.code ?? '?'} ${e.hint ?? e.message ?? ''}`.trim();
    errors.push(line);
    console.error(`${LOG} renderer error:`, line);
  });
  return () => {
    unsub?.();
    if (errors.length > 0) {
      console.warn(`${LOG} renderer error count=${errors.length}`, errors.slice(0, 8));
    }
  };
}

export function logHandleResolve(
  world: World,
  label: string,
  meshHandle: unknown,
  matHandle: unknown,
): void {
  const mh = meshHandle as Parameters<typeof resolveAssetHandle>[1];
  const ah = matHandle as Parameters<typeof resolveAssetHandle>[1];
  const meshSlot = typeof meshHandle === 'number' ? handleSlot(meshHandle as never) : -1;
  const matSlot = typeof matHandle === 'number' ? handleSlot(matHandle as never) : -1;
  const meshRes = resolveAssetHandle<MeshAsset>(world, mh);
  const matRes = resolveAssetHandle<MaterialAsset>(world, ah);
  const mesh = meshRes.ok ? meshRes.value : null;
  console.info(
    `${LOG} ${label} meshSlot=${meshSlot} matSlot=${matSlot} `
    + `meshOk=${meshRes.ok} matOk=${matRes.ok} `
    + `verts=${mesh?.vertices?.length ?? 0} indices=${mesh?.indices?.length ?? 0} `
    + `submeshes=${mesh?.submeshes?.length ?? 0}`,
  );
  if (!meshRes.ok) console.warn(`${LOG} ${label} mesh resolve err`, meshRes.error);
  if (!matRes.ok) console.warn(`${LOG} ${label} mat resolve err`, matRes.error);
}

export function logEntity(world: World, entity: EntityHandle, label: string): void {
  const name = world.get(entity, Name);
  const t = world.get(entity, Transform);
  const mf = world.get(entity, MeshFilter);
  const mr = world.get(entity, MeshRenderer);
  console.info(
    `${LOG} entity ${label} id=${entity} `
    + `name=${name.ok ? name.value.value : '?'} `
    + `pos=${t.ok ? `${t.value.posX?.toFixed(2)},${t.value.posY?.toFixed(2)},${t.value.posZ?.toFixed(2)}` : '?'} `
    + `scale=${t.ok ? `${t.value.scaleX ?? 1},${t.value.scaleY ?? 1},${t.value.scaleZ ?? 1}` : '?'} `
    + `meshFilter=${mf.ok} meshRenderer=${mr.ok} materials=${mr.ok ? mr.value.materials?.length : '?'}`,
  );
  if (mf.ok) logHandleResolve(world, `${label}:handle`, mf.value.assetHandle, mr.ok ? mr.value.materials[0] : 0);
}

export function logCamera(world: World, camera: EntityHandle): void {
  const t = world.get(camera, Transform);
  const c = world.get(camera, Camera);
  if (!t.ok || !c.ok) {
    console.warn(`${LOG} camera missing components`, t.ok, c.ok);
    return;
  }
  console.info(
    `${LOG} camera pos=${t.value.posX?.toFixed(2)},${t.value.posY?.toFixed(2)},${t.value.posZ?.toFixed(2)} `
    + `fov=${c.value.fov?.toFixed(3)} aspect=${c.value.aspect?.toFixed(3)} near=${c.value.near} far=${c.value.far}`,
  );
}

export function installFrameSampler(
  registerUpdate: (fn: (dt: number) => void) => void,
  world: World,
  camera: EntityHandle,
  entities: EntityHandle[],
): void {
  let frames = 0;
  registerUpdate(() => {
    frames++;
    if (frames !== 1 && frames !== 30 && frames !== 120) return;
    console.info(`${LOG} frame=${frames} sampling…`);
    logCamera(world, camera);
    for (const e of entities) logEntity(world, e, `f${frames}`);
  });
}

export function spawnDebugProbe(
  world: World,
  mat: MatHandle,
  meshHandle: unknown,
  name: string,
  px: number, py: number, pz: number,
  scale: number,
): EntityHandle {
  return world.spawn(
    { component: Name, data: { value: name } },
    {
      component: Transform,
      data: { posX: px, posY: py, posZ: pz, scaleX: scale, scaleY: scale, scaleZ: scale },
    },
    { component: MeshFilter, data: { assetHandle: meshHandle as never } },
    { component: MeshRenderer, data: { materials: [mat], frustumCulled: 0 } },
  ).unwrap();
}
