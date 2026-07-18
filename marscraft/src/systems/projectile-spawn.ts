/**
 * MarsCraft -> forgeax-engine — projectile spawning (Milestone M6)
 * =============================================================================
 * The Three.js source spawned a projectile with a JS `AttackPayload` object held
 * on the `CProjectile` component (`proj.payload`). forgeax components are SoA
 * numeric-only, so the payload's numeric fields go into the `Projectile` SoA
 * columns and the few non-numeric ones (weaponId, splashFalloff) into the M2
 * companion Maps (`projectileWeaponId`, and a small per-projectile falloff Map
 * here). On hit, the projectile-system rebuilds the `AttackPayload` behaviour from
 * those columns + the damage/splash resolvers.
 *
 * Visuals: each projectile is a tiny emissive-ish sphere (shared mesh, per-color
 * shared material cached by packed color), parented to nothing (it flies in world
 * space). Source colored bullets yellow / missiles orange / bounce green; ported.
 */

import { type EntityHandle, type World } from '@forgeax/engine-ecs';
import {
  Transform, MeshFilter, MeshRenderer,
  type Handle,
} from '@forgeax/engine-runtime';
import { type MeshAsset } from '@forgeax/engine-assets-runtime';
import {
  Projectile, PROJECTILE_TYPE,
  projectileWeaponId,
  type CombatTypeCode,
} from '../components';
import type { TintFn } from '../world/unit-models';

/**
 * Per-projectile attack-payload behaviour data (the SoA-incompatible fields of
 * the source `AttackPayload`). Keyed by the projectile entity; cleared by the
 * projectile-system when the projectile despawns. Lives here (not components.ts)
 * because it is M6-combat-specific and strongly typed.
 */
export interface ProjectilePayloadData {
  damage: number;
  damageCount: number;
  damageType: 'normal' | 'spell';
  splashRadius: number;
  splashShape: number;
  splashFalloff: number[];
  splashAngle: number;
  splashWidth: number;
  attackerCombatType: CombatTypeCode;
}

export const projectilePayloadData = new Map<EntityHandle, ProjectilePayloadData>();

/** Shared projectile render assets (sphere mesh + per-color material cache). */
export interface ProjectileAssets {
  sphere: Handle<'MeshAsset', 'shared'>;
  tint: TintFn;
  /** Packed-color -> shared material handle cache. */
  matCache: Map<number, Handle<'MaterialAsset', 'shared'>>;
}

/** Build the shared projectile asset bundle (call once in bootstrap). */
export function makeProjectileAssets(sphere: Handle<'MeshAsset', 'shared'>, tint: TintFn): ProjectileAssets {
  return { sphere, tint, matCache: new Map() };
}

function projMaterial(assets: ProjectileAssets, packed: number): Handle<'MaterialAsset', 'shared'> {
  const cached = assets.matCache.get(packed);
  if (cached) return cached;
  const r = ((packed >> 16) & 0xff) / 255;
  const g = ((packed >> 8) & 0xff) / 255;
  const bl = (packed & 0xff) / 255;
  // bright/flat-reading (roughness 1) so it stands out without bloom accumulation.
  const mat = assets.tint([r, g, bl], { metallic: 0, roughness: 1 });
  assets.matCache.set(packed, mat);
  return mat;
}

function projectileColor(projType: number): number {
  switch (projType) {
    case PROJECTILE_TYPE.BULLET: return 0xffff44;   // yellow
    case PROJECTILE_TYPE.MISSILE: return 0xff8844;  // orange
    case PROJECTILE_TYPE.BOUNCE: return 0x44ff44;   // green
    default: return 0xffffff;
  }
}

function projectileSize(projType: number): number {
  return projType === PROJECTILE_TYPE.MISSILE ? 0.3 : 0.15;
}

export interface SpawnProjectileArgs {
  sourceEntity: EntityHandle;
  sourcePlayerId: number;
  startX: number; startY: number; startZ: number;
  target: EntityHandle;
  targetX: number; targetY: number; targetZ: number;
  projectileType: number;
  speed: number;
  damage: number;
  damageCount: number;
  damageType: 'normal' | 'spell';
  splashRadius: number;
  splashShape: number;
  splashFalloff: number[];
  splashAngle: number;
  splashWidth: number;
  bounceCount: number;
  bounceDamageDecay: number;
  attackerCombatType: CombatTypeCode;
  weaponId: string;
}

/** Spawn a projectile entity (Transform + Projectile + sphere mesh). */
export function spawnProjectile(
  world: World, assets: ProjectileAssets, a: SpawnProjectileArgs,
): EntityHandle | null {
  const color = projectileColor(a.projectileType);
  const size = projectileSize(a.projectileType);
  const mat = projMaterial(assets, color);

  const res = world.spawn(
    {
      component: Transform,
      data: {
        pos: [a.startX, a.startY, a.startZ],
        scale: [size, size, size],
      },
    },
    {
      component: Projectile,
      data: {
        sourceEntity: (a.sourceEntity as unknown as number) >>> 0,
        sourcePlayerId: a.sourcePlayerId,
        sourceX: a.startX,
        sourceZ: a.startZ,
        targetEntity: (a.target as unknown as number) >>> 0,
        targetX: a.targetX,
        targetY: a.targetY,
        targetZ: a.targetZ,
        speed: a.speed,
        lifetime: 0,
        maxLifetime: 5,
        bounceRemaining: a.bounceCount,
        bounceDamageDecay: a.bounceDamageDecay,
        bounceIndex: 0,
      },
    },
    { component: MeshFilter, data: { assetHandle: assets.sphere } },
    { component: MeshRenderer, data: { materials: [mat] } },
  );
  if (!res.ok) {
    console.error('[marscraft] spawnProjectile failed:', res.error.code);
    return null;
  }
  const proj = res.value;

  // Non-numeric + per-projectile payload data -> companion Maps.
  projectileWeaponId.set(proj, a.weaponId);
  projectilePayloadData.set(proj, {
    damage: a.damage,
    damageCount: a.damageCount,
    damageType: a.damageType,
    splashRadius: a.splashRadius,
    splashShape: a.splashShape,
    splashFalloff: a.splashFalloff.slice(),
    splashAngle: a.splashAngle,
    splashWidth: a.splashWidth,
    attackerCombatType: a.attackerCombatType,
  });
  return proj;
}
