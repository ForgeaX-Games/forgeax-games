import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { ChildOf, Name, Transform } from '@forgeax/engine-scene';
import { MeshFilter, MeshRenderer } from '@forgeax/engine-render';
import { COMBAT } from '../config/combat.ts';
import { RangeIndicator, SwingState, WeaponSlot } from '../ecs/components.ts';
import type { CombatAssets } from './combat-assets.ts';
import { WEAPON_PROFILES } from '../../assets/lib/weapons/index.ts';

export interface WeaponRig {
  readonly roots: readonly EntityHandle[];
  readonly indicators: readonly EntityHandle[];
}

function yawQuaternion(yaw: number): readonly [number, number, number, number] {
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}

/** Attach the two hand-held weapon pivots, enlarged visual models, and ground footprints to the player. */
export function spawnWeapons(world: World, player: EntityHandle, assets: CombatAssets): WeaponRig {
  const profiles = [
    { slotIndex: 0, profile: WEAPON_PROFILES.spear },
    { slotIndex: 1, profile: WEAPON_PROFILES.axe },
  ] as const;
  const roots: EntityHandle[] = [];
  const indicators: EntityHandle[] = [];
  for (const { slotIndex, profile } of profiles) {
    const slotAngle = COMBAT.weapons.slots[slotIndex] ?? 0;
    const root = world.spawn(
      { component: Name, data: { value: `${profile.displayName} Weapon` } },
      { component: Transform, data: {
        pos: [Math.sin(slotAngle) * COMBAT.weapons.ringRadius, 0.5, Math.cos(slotAngle) * COMBAT.weapons.ringRadius],
        scale: [1, 1, 1],
        quat: yawQuaternion(profile.model.restYaw),
      } },
      { component: ChildOf, data: { parent: player } },
      { component: WeaponSlot, data: {
        slotIndex,
        profileIndex: slotIndex,
        cooldown: 0,
        slotAngle,
        swingPhase: 0,
        aimYaw: profile.model.restYaw,
      } },
      { component: SwingState, data: { active: 0, hitApplied: 0, attackYaw: profile.model.restYaw } },
    );
    if (!root.ok) throw new Error(`Brotato v2 ${profile.displayName} spawn failed: ${root.error.hint}`);
    const model = world.spawn(
      { component: Name, data: { value: `${profile.displayName} Model` } },
      { component: Transform, data: {
        pos: [0, 0, 0],
        scale: [COMBAT.weapons.modelScale, COMBAT.weapons.modelScale, COMBAT.weapons.modelScale],
        quat: [0, 0, 0, 1],
      } },
      { component: MeshFilter, data: { assetHandle: slotIndex === 0 ? assets.spearMesh : assets.axeMesh } },
      { component: MeshRenderer, data: { materials: [assets.weaponWoodMaterial, assets.weaponSteelMaterial] } },
      { component: ChildOf, data: { parent: root.value } },
    );
    if (!model.ok) throw new Error(`Brotato v2 ${profile.displayName} model spawn failed: ${model.error.hint}`);
    roots.push(root.value);
    const range = world.spawn(
      { component: Name, data: { value: `${profile.displayName} Attack Range` } },
      { component: Transform, data: { pos: [0, -0.49, 0], scale: [COMBAT.attackRangeVisual.idleScale, 1, COMBAT.attackRangeVisual.idleScale], quat: [0, 0, 0, 1] } },
      { component: MeshFilter, data: { assetHandle: slotIndex === 0 ? assets.spearRangeMesh : assets.axeRangeMesh } },
      { component: MeshRenderer, data: { materials: [assets.attackRangeMaterial] } },
      { component: ChildOf, data: { parent: root.value } },
      { component: RangeIndicator, data: { slotIndex, baseScale: COMBAT.attackRangeVisual.idleScale } },
    );
    if (!range.ok) throw new Error(`Brotato v2 ${profile.displayName} range spawn failed: ${range.error.hint}`);
    indicators.push(range.value);
  }
  return { roots, indicators };
}
