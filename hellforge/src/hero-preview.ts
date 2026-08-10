// CharSelect / CharList 3D stage — hero GLB with looping idle, auto-yaw spin,
// foot halo + rising ember motes (campfire-like) so the pick reads as the focus.
// Lives outside initializeRuntime so campaign shell can preview before combat boot.
// main.ts owns show/hide/tick wiring.

import {
  Camera,
  DirectionalLight,
  Materials,
  MeshFilter,
  MeshRenderer,
  PointLight,
  SceneInstance,
  perspective,
} from '@forgeax/engine-render';
import {
  Transform,
} from '@forgeax/engine-scene';
import {
  quat,
} from '@forgeax/engine-runtime';
import { AssetGuid } from '@forgeax/engine-pack/guid';
import { ENTITY_NULL_RAW, type EntityHandle, type World } from '@forgeax/engine-ecs';
import { armSkinnedAnimationPlayer } from './bind-skinned-animation';
import type { AnimationClip, Handle, MaterialAsset, MeshAsset, SceneAsset } from '@forgeax/engine-types';
import { HANDLE_CUBE, type AssetRegistry } from '@forgeax/engine-assets-runtime';

import { getHeroDef, type HeroDef } from './heroes';
import type { ClassId } from './classes';
import {
  releasePreviewLightSlots,
  type PreviewLightSlots,
} from './preview-light-ownership';

/** From prop-select-ring.glb.meta.json (bake-select-ring.ts). */
const SELECT_RING_MESH_GUID = '1ada3896-0ee6-3468-d185-6ba3161bf8e2';
const RING_BASE_SCALE = 1.0;

export type HeroPreviewHandle = {
  /** Ensure preview is visible for `classId` (swap model if needed). */
  show(classId: ClassId): Promise<void>;
  hide(): void;
  /** Drive idle spin + camera look-at + foot FX — call while CharSelect/CharList is up. */
  tick(dt: number): void;
  dispose(): void;
  readonly classId: ClassId | null;
};

export type InstallHeroPreviewArgs = {
  world: World;
  assets: AssetRegistry;
  /** BootCamera (or any Camera entity) written each tick while shown. */
  camera: EntityHandle;
  getAspect: () => number;
  proj: { fov: number; near: number; far: number };
};

const SPIN_RAD_PER_SEC = 0.55;
// Sit the hero just in front of the campfire (origin) so they don't stand in the logs.
const STAGE = { x: 0, y: 0, z: 1.15 } as const;
// Mild 3/4 orbit — hero stays on look-at (screen center). CharList name/CTA
// are anchored to the same full-viewport center (see char-list.ts).
const CAM_OFFSET = { x: 1.2, y: 1.7, z: 3.75 } as const;
const LOOK_AT_Y = 1.05;

type MatHandle = Handle<'MaterialAsset', 'shared'>;

interface EmberMote {
  e: EntityHandle;
  age: number;
  life: number;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  s0: number;
}

export function installHeroPreview(args: InstallHeroPreviewArgs): HeroPreviewHandle {
  const { world, assets, camera, getAspect, proj } = args;

  let visible = false;
  let classId: ClassId | null = null;
  let yaw = 0;
  let loadGen = 0;
  let rig: EntityHandle | null = null;
  let sceneRoot: EntityHandle | null = null;
  let skinEnt: EntityHandle | null = null;
  /** All SceneInstance.mapping ents + scene root — ChildOf does NOT cascade. */
  let instEntities: EntityHandle[] = [];
  let scale = 1.3;
  let keyLight: EntityHandle | null = null;
  let fillLight: EntityHandle | null = null;
  let rimLight: EntityHandle | null = null;
  let footLight: EntityHandle | null = null;
  let selectRing: EntityHandle | null = null;
  let ringMesh: Handle<'MeshAsset', 'shared'> | null = null;
  let ringMat: MatHandle | null = null;
  let emberMat: MatHandle | null = null;
  let embers: EmberMote[] = [];
  let emberTimer = 0;
  let stagePulse = 0;
  let stageFxLoading: Promise<void> | null = null;
  let loading: Promise<void> | null = null;

  const isCurrent = (gen: number): boolean => visible && gen === loadGen;

  const ensureLights = (): void => {
    // Never create preview lights while hidden — in-flight show()/spawnHero
    // can resume after hide() and must not recreate URP owners.
    if (!visible) return;
    if (keyLight === null) {
      keyLight = world.spawn(
        { component: DirectionalLight, data: {
          direction: [-0.35, -0.75, -0.4],
          color: [1, 0.62, 0.35],
          intensity: 2.4,
          castShadow: false,
        } },
      ).unwrap() as EntityHandle;
    }
    const fx = STAGE.x;
    if (fillLight === null) {
      fillLight = world.spawn(
        { component: Transform, data: { pos: [fx + 0.4, 2.4, STAGE.z + 2.2] } },
        { component: PointLight, data: { color: [1, 0.75, 0.5], intensity: 22, range: 12 } },
      ).unwrap() as EntityHandle;
    } else {
      world.set(fillLight, Transform, { pos: [fx + 0.4, 2.4, STAGE.z + 2.2] });
    }
    if (rimLight === null) {
      rimLight = world.spawn(
        { component: Transform, data: { pos: [fx - 1.6, 1.8, STAGE.z - 1.2] } },
        { component: PointLight, data: { color: [0.55, 0.7, 1], intensity: 12, range: 10 } },
      ).unwrap() as EntityHandle;
    } else {
      world.set(rimLight, Transform, { pos: [fx - 1.6, 1.8, STAGE.z - 1.2] });
    }
  };

  const releaseLights = (): void => {
    const next = releasePreviewLightSlots(
      (e) => {
        world.despawn(e as EntityHandle);
      },
      {
        keyLight: keyLight as number | null,
        fillLight: fillLight as number | null,
        rimLight: rimLight as number | null,
        footLight: footLight as number | null,
      } satisfies PreviewLightSlots,
    );
    keyLight = next.keyLight as EntityHandle | null;
    fillLight = next.fillLight as EntityHandle | null;
    rimLight = next.rimLight as EntityHandle | null;
    footLight = next.footLight as EntityHandle | null;
  };

  const spawnFootLight = (): void => {
    if (footLight !== null || !visible) return;
    footLight = world.spawn(
      { component: Transform, data: { pos: [STAGE.x, 0.55, STAGE.z] } },
      { component: PointLight, data: {
        color: [1, 0.62, 0.28],
        intensity: 28,
        range: 4.5,
      } },
    ).unwrap() as EntityHandle;
  };

  const ensureStageFx = async (gen: number): Promise<void> => {
    // Ring may survive hide(); foot light is released with preview lights and
    // must be recreatable when CharSelect returns.
    if (selectRing !== null) {
      if (isCurrent(gen)) spawnFootLight();
      return;
    }
    if (stageFxLoading) {
      await stageFxLoading;
      if (!isCurrent(gen)) return;
      if (selectRing !== null) {
        spawnFootLight();
        return;
      }
      stageFxLoading = null; // previous attempt failed — allow retry
    }
    if (!isCurrent(gen)) return;
    const loadAt = gen;
    stageFxLoading = (async () => {
      if (emberMat === null) {
        emberMat = world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
          baseColor: [1, 0.35, 0.08, 1], roughness: 0.4, metallic: 0,
          emissive: [1, 0.32, 0.06], emissiveIntensity: 1.5,
        }));
      }
      if (ringMat === null) {
        // Forge-gold / crimson heat — matches Ui theme tokens (emissive for bloom).
        ringMat = world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
          baseColor: [0.88, 0.72, 0.29, 1], roughness: 0.4, metallic: 0.35,
          emissive: [1.0, 0.62, 0.16], emissiveIntensity: 2.8,
        }));
      }
      if (ringMesh === null) {
        const g = AssetGuid.parse(SELECT_RING_MESH_GUID);
        if (!g.ok) throw new Error('select-ring mesh guid');
        const res = await assets.loadByGuid<MeshAsset>(g.value);
        if (!res.ok) throw new Error('select-ring mesh load');
        // hide()/newer show() may have invalidated this load while suspended.
        if (!isCurrent(loadAt)) return;
        ringMesh = world.allocSharedRef<'MeshAsset', MeshAsset>('MeshAsset', res.value);
      }
      if (!isCurrent(loadAt)) return;
      if (selectRing === null && ringMesh !== null && ringMat !== null) {
        const fx = STAGE.x;
        selectRing = world.spawn(
          { component: Transform, data: {
            pos: [fx, 0.015, STAGE.z],
            scale: [RING_BASE_SCALE, 1, RING_BASE_SCALE],
          } },
          { component: MeshFilter, data: { assetHandle: ringMesh } },
          { component: MeshRenderer, data: { materials: [ringMat] } },
        ).unwrap() as EntityHandle;
      }
      spawnFootLight();
    })().catch((err) => {
      console.warn('[hellforge] select-ring stage fx failed:', err);
    });
    await stageFxLoading;
  };

  const clearEmbers = (): void => {
    for (const p of embers) {
      try { world.despawn(p.e); } catch { /* already gone */ }
    }
    embers = [];
    emberTimer = 0;
  };

  const setStageFxVisible = (on: boolean): void => {
    if (!on) {
      clearEmbers();
      if (selectRing !== null) {
        world.set(selectRing, Transform, {
          pos: [STAGE.x, -2, STAGE.z],
          scale: [0.01, 0.01, 0.01],
        });
      }
      if (footLight !== null) {
        world.set(footLight, PointLight, { intensity: 0 });
      }
      return;
    }
    const gen = loadGen;
    void ensureStageFx(gen).then(() => {
      if (!isCurrent(gen) || selectRing === null) return;
      world.set(selectRing, Transform, {
        pos: [STAGE.x, 0.015, STAGE.z],
        scale: [RING_BASE_SCALE, 1, RING_BASE_SCALE],
      });
      if (footLight !== null) {
        world.set(footLight, Transform, { pos: [STAGE.x, 0.55, STAGE.z] });
        world.set(footLight, PointLight, { color: [1, 0.62, 0.28], intensity: 28, range: 4.5 });
      }
    });
  };

  const spawnEmber = (): void => {
    if (emberMat === null) return;
    const ang = Math.random() * Math.PI * 2;
    // Rise along the filigree rim (hairline → spiked crown).
    const r = 0.60 + Math.random() * 0.40;
    const x = STAGE.x + Math.cos(ang) * r;
    const z = STAGE.z + Math.sin(ang) * r;
    const y = 0.05 + Math.random() * 0.08;
    const s0 = 0.04 + Math.random() * 0.045;
    const e = world.spawn(
      { component: Transform, data: { pos: [x, y, z], scale: [s0, s0, s0] } },
      { component: MeshFilter, data: { assetHandle: HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [emberMat] } },
    ).unwrap() as EntityHandle;
    embers.push({
      e, age: 0, life: 0.75 + Math.random() * 0.7,
      x, y, z,
      vx: (Math.random() - 0.5) * 0.35,
      vy: 1.1 + Math.random() * 1.15,
      vz: (Math.random() - 0.5) * 0.35,
      s0,
    });
  };

  const tickStageFx = (dt: number): void => {
    if (!visible) return;
    stagePulse += dt;
    const fx = STAGE.x;
    if (selectRing !== null) {
      const pulse = RING_BASE_SCALE * (1 + Math.sin(stagePulse * 2.2) * 0.04);
      const yawRing = stagePulse * 0.18; // slow gothic turn, separate from hero spin
      const qy = quat.create();
      quat.fromAxisAngle(qy, [0, 1, 0], yawRing);
      world.set(selectRing, Transform, {
        pos: [fx, 0.015, STAGE.z],
        quat: [qy[0]!, qy[1]!, qy[2]!, qy[3]!],
        scale: [pulse, 1, pulse],
      });
    }
    if (footLight !== null) {
      const flick = 26 + Math.sin(stagePulse * 7.3) * 3 + Math.sin(stagePulse * 13.1) * 1.5;
      world.set(footLight, Transform, { pos: [fx, 0.55, STAGE.z] });
      world.set(footLight, PointLight, {
        color: [1, 0.62, 0.28],
        intensity: flick,
        range: 4.5,
      });
    }

    // Steady ember trickle — same cadence feel as FxSystem campfire.
    emberTimer -= dt;
    if (emberTimer <= 0) {
      emberTimer = 0.16 + Math.random() * 0.14;
      spawnEmber();
      if (Math.random() < 0.55) spawnEmber();
    }
    for (let i = embers.length - 1; i >= 0; i--) {
      const p = embers[i]!;
      p.age += dt;
      if (p.age >= p.life) {
        try { world.despawn(p.e); } catch { /* */ }
        embers.splice(i, 1);
        continue;
      }
      p.vy += 0.55 * dt; // slight buoyancy like campfire rise
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const t = p.age / p.life;
      const s = p.s0 * (1 - t * 0.75);
      world.set(p.e, Transform, { pos: [p.x, p.y, p.z], scale: [s, s, s] });
    }
  };

  const clearHero = (): void => {
    // Match monsters.ts: walk every instantiate entity. Skin was detached from
    // Armature (removeComponent ChildOf), so despawn(rig) alone leaves orphans
    // → RhiError hierarchy-broken and a black/broken stage.
    if (skinEnt !== null) {
      try { world.despawn(skinEnt); } catch { /* already gone */ }
      skinEnt = null;
    }
    for (const e of instEntities) {
      try { world.despawn(e); } catch { /* already gone */ }
    }
    instEntities = [];
    sceneRoot = null;
    if (rig !== null) {
      try { world.despawn(rig); } catch { /* already gone */ }
      rig = null;
    }
  };

  const applyCamera = (): void => {
    const tx = STAGE.x, ty = LOOK_AT_Y, tz = STAGE.z;
    const cx = tx + CAM_OFFSET.x, cy = CAM_OFFSET.y, cz = tz + CAM_OFFSET.z;
    const dx = tx - cx, dy = ty - cy, dz = tz - cz;
    const lookYaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const qy = quat.create(); quat.fromAxisAngle(qy, [0, 1, 0], lookYaw);
    const qx = quat.create(); quat.fromAxisAngle(qx, [1, 0, 0], pitch);
    const cq = quat.create(); quat.multiply(cq, qy, qx);
    world.set(camera, Transform, {
      pos: [cx, cy, cz],
      quat: [cq[0]!, cq[1]!, cq[2]!, cq[3]!],
    });
    world.set(camera, Camera, perspective({
      fov: proj.fov,
      aspect: getAspect(),
      near: proj.near,
      far: proj.far,
    }));
  };

  const applyRigTransform = (): void => {
    if (rig === null) return;
    const qy = quat.create();
    quat.fromAxisAngle(qy, [0, 1, 0], yaw);
    world.set(rig, Transform, {
      pos: [STAGE.x, STAGE.y, STAGE.z],
      quat: [qy[0]!, qy[1]!, qy[2]!, qy[3]!],
      scale: [scale, scale, scale],
    });
  };

  const spawnHero = async (hero: HeroDef, gen: number): Promise<void> => {
    await ensureStageFx(gen);
    // Prove the load is still current before creating any preview lights.
    // Calling ensureLights() before this check recreated key/fill/rim after hide().
    if (!isCurrent(gen)) {
      if (!visible) releaseLights();
      return;
    }
    ensureLights();
    // Keep the previous hero on stage until the next instantiate succeeds
    // (atomic swap) so CharSelect never flashes an empty/broken hierarchy.

    const sceneGuid = AssetGuid.parse(hero.gltf.scene);
    if (!sceneGuid.ok) throw new Error(`preview scene guid: ${hero.id}`);
    const sceneRes = await assets.loadByGuid<SceneAsset>(sceneGuid.value);
    if (!sceneRes.ok) throw new Error(`preview scene load: ${hero.id}`);
    if (!isCurrent(gen)) {
      if (!visible) releaseLights();
      return;
    }

    let idleHandle: Handle<'AnimationClip', 'shared'> | null = null;
    for (const def of hero.gltf.clips) {
      if (def.name !== 'idle') continue;
      const g = AssetGuid.parse(def.guid);
      if (!g.ok) continue;
      const r = await assets.loadByGuid<AnimationClip>(g.value);
      if (!r.ok) continue;
      if (!isCurrent(gen)) {
        if (!visible) releaseLights();
        return;
      }
      idleHandle = world.allocSharedRef<'AnimationClip', AnimationClip>('AnimationClip', r.value);
      break;
    }
    if (!isCurrent(gen)) {
      if (!visible) releaseLights();
      return;
    }

    const nextScale = hero.scale;
    const nextRig = world.spawn(
      { component: Transform, data: { pos: [STAGE.x, STAGE.y, STAGE.z], scale: [nextScale, nextScale, nextScale] } },
    ).unwrap() as EntityHandle;

    const sceneHandle = world.allocSharedRef<'SceneAsset', SceneAsset>('SceneAsset', sceneRes.value);
    const instRes = assets.instantiate<SceneAsset>(sceneHandle, world, nextRig);
    if (!instRes.ok) {
      try { world.despawn(nextRig); } catch { /* */ }
      throw new Error(`preview instantiate: ${hero.id}`);
    }
    if (!isCurrent(gen)) {
      // Stale load — tear down the orphan hierarchy (ChildOf does not cascade).
      const orphanRoot = instRes.value as EntityHandle;
      const orphanInst = world.get(orphanRoot, SceneInstance);
      try { world.despawn(nextRig); } catch { /* */ }
      try { world.despawn(orphanRoot); } catch { /* */ }
      if (orphanInst.ok) {
        for (let i = 0; i < orphanInst.value.mapping.length; i++) {
          const ent = orphanInst.value.mapping[i];
          if (ent === undefined || ent === ENTITY_NULL_RAW) continue;
          try { world.despawn(ent as EntityHandle); } catch { /* */ }
        }
      }
      if (!visible) releaseLights();
      return;
    }

    const nextRoot = instRes.value as EntityHandle;
    const nextInst: EntityHandle[] = [nextRoot];
    let nextSkin: EntityHandle | null = null;
    const sceneInst = world.get(nextRoot, SceneInstance);
    if (sceneInst.ok) {
      for (let i = 0; i < sceneInst.value.mapping.length; i++) {
        const ent = sceneInst.value.mapping[i];
        if (ent === undefined || ent === ENTITY_NULL_RAW) continue;
        nextInst.push(ent as EntityHandle);
      }
    }
    if (idleHandle !== null) {
      const armed = armSkinnedAnimationPlayer(world, nextRoot, { clips: [idleHandle] });
      if (armed !== null) {
        nextSkin = armed.skin;
      } else {
        console.warn(`[hellforge] hero preview ${hero.id}: Skin/idle missing — static mesh`);
      }
    } else {
      console.warn(`[hellforge] hero preview ${hero.id}: Skin/idle missing — static mesh`);
    }

    clearHero();
    rig = nextRig;
    sceneRoot = nextRoot;
    skinEnt = nextSkin;
    instEntities = nextInst;
    scale = nextScale;
    yaw = 0;
    applyRigTransform();
    applyCamera();
  };

  return {
    get classId() { return classId; },
    async show(next: ClassId): Promise<void> {
      visible = true;
      // Bump early so hide()/a newer show() can invalidate every await below.
      const gen = ++loadGen;
      await ensureStageFx(gen);
      if (!isCurrent(gen)) {
        if (!visible) releaseLights();
        return;
      }
      ensureLights();
      setStageFxVisible(true);
      if (classId === next && rig !== null) {
        applyCamera();
        return;
      }
      classId = next;
      const hero = getHeroDef(next);
      loading = spawnHero(hero, gen).catch((err) => {
        console.warn('[hellforge] hero preview failed:', err);
      });
      await loading;
    },
    hide(): void {
      visible = false;
      loadGen += 1;
      clearHero();
      clearEmbers();
      // Park stage mesh only — do not leave intensity=0 lights in the world
      // (extraction still packs them and they steal URP point/dir slots).
      if (selectRing !== null) {
        world.set(selectRing, Transform, {
          pos: [STAGE.x, -2, STAGE.z],
          scale: [0.01, 0.01, 0.01],
        });
      }
      releaseLights();
      classId = null;
    },
    tick(dt: number): void {
      if (!visible) return;
      // Hold stage framing even while a swap is loading (rig may briefly lag).
      if (rig !== null) {
        yaw += SPIN_RAD_PER_SEC * dt;
        if (yaw > Math.PI * 2) yaw -= Math.PI * 2;
        applyRigTransform();
      }
      applyCamera();
      tickStageFx(dt);
    },
    dispose(): void {
      visible = false;
      loadGen += 1;
      clearHero();
      clearEmbers();
      if (selectRing !== null) { try { world.despawn(selectRing); } catch { /* */ } selectRing = null; }
      releaseLights();
      ringMesh = null;
      ringMat = null;
      emberMat = null;
      stageFxLoading = null;
      classId = null;
    },
  };
}
