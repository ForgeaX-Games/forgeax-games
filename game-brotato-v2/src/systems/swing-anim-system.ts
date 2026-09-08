import { Time, Update, type World } from '@forgeax/engine-ecs';
import { ChildOf, Transform } from '@forgeax/engine-scene';
import { WEAPON_PROFILES } from '../../assets/lib/weapons/index.ts';
import { COMBAT } from '../config/combat.ts';
import { PlayerMotion, RangeIndicator, SwingState, WeaponSlot } from '../ecs/components.ts';

export const SWING_ANIMATION_SYSTEM_NAME = 'brotato-v2/swing-animation';

function yawQuaternion(yaw: number): readonly [number, number, number, number] {
  return [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
}

export function installSwingAnimationSystem(world: World): () => void {
  world
    .addSystem(Update, {
      name: SWING_ANIMATION_SYSTEM_NAME,
      queries: [
        { write: [Transform, WeaponSlot, SwingState], read: [ChildOf] },
        { write: [Transform, RangeIndicator], read: [ChildOf] },
      ],
      fn: (world, [weapons, indicators]) => {
        const dt = Math.max(0, world.getResource(Time).delta);
        for (const row of weapons) {
          const slot = row.mut(WeaponSlot);
          const swing = row.mut(SwingState);
          const transform = row.mut(Transform);
          const profile = slot.profileIndex === 0 ? WEAPON_PROFILES.spear : WEAPON_PROFILES.axe;
          const total = profile.windup + profile.strike + profile.recover;
          const phase = swing.active > 0 ? slot.swingPhase + dt : total;
          if (swing.active > 0) {
            slot.swingPhase = phase;
            if (phase >= total) swing.active = 0;
          }
          const parent = row.get(ChildOf).parent;
          const playerFacing = parent === null ? 0 : world.get(parent, PlayerMotion).ok
            ? world.get(parent, PlayerMotion).unwrap().facing
            : 0;
          const attackYaw = swing.active > 0 ? swing.attackYaw : slot.aimYaw;
          const baseYaw = attackYaw - playerFacing + profile.model.restYaw;
          if (profile.shape === 'thrust') {
            let thrust = 0;
            if (swing.active > 0) {
              if (phase < profile.windup) thrust = -0.06 * (phase / profile.windup);
              else if (phase < profile.windup + profile.strike) thrust = 0.18;
              else thrust = 0.18 * Math.max(0, 1 - (phase - profile.windup - profile.strike) / profile.recover);
            }
            transform.pos[0] = Math.sin(slot.slotAngle) * COMBAT.weapons.ringRadius;
            transform.pos[2] = Math.cos(slot.slotAngle) * COMBAT.weapons.ringRadius + thrust;
            const quaternion = yawQuaternion(baseYaw);
            transform.quat[0] = quaternion[0] ?? 0;
            transform.quat[1] = quaternion[1] ?? 0;
            transform.quat[2] = quaternion[2] ?? 0;
            transform.quat[3] = quaternion[3] ?? 1;
          } else {
            const quaternion = yawQuaternion(baseYaw);
            transform.quat[0] = quaternion[0] ?? 0;
            transform.quat[1] = quaternion[1] ?? 0;
            transform.quat[2] = quaternion[2] ?? 0;
            transform.quat[3] = quaternion[3] ?? 1;
          }
        }
        for (const row of indicators) {
          const marker = row.mut(RangeIndicator);
          const transform = row.mut(Transform);
          const parent = row.get(ChildOf).parent;
      const swing = parent === null ? undefined : world.get(parent, SwingState);
      const active = swing?.ok === true && swing.value.active > 0;
      const scale = active
        ? COMBAT.attackRangeVisual.activeScale * COMBAT.attackRangeVisual.strikeScale
        : marker.baseScale;
          transform.scale[0] = scale;
          transform.scale[2] = scale;
        }
      },
    })
    .unwrap();
  return () => {
    const result = world.removeSystem(Update, SWING_ANIMATION_SYSTEM_NAME);
    if (!result.ok && result.error.code !== 'system-before-unknown') throw result.error;
  };
}
