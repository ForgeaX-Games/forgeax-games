import type { WeaponProfile } from '../../assets/lib/weapons/types.ts';

function shortestAngle(delta: number): number {
  return Math.atan2(Math.sin(delta), Math.cos(delta));
}
function targetYaw(targetX: number, targetZ: number, weaponX: number, weaponZ: number): number {
  return Math.atan2(targetX - weaponX, targetZ - weaponZ);
}

export function hitsThrust(
  weaponX: number,
  weaponZ: number,
  aimX: number,
  aimZ: number,
  profile: WeaponProfile,
  targetX: number,
  targetZ: number,
  targetRadius: number,
): boolean {
  const aimLength = Math.hypot(aimX, aimZ);
  if (aimLength <= Number.EPSILON) return false;
  const ax = aimX / aimLength;
  const az = aimZ / aimLength;
  const dx = targetX - weaponX;
  const dz = targetZ - weaponZ;
  const along = dx * ax + dz * az;
  const perpendicular = Math.abs(dx * az - dz * ax);
  return along >= 0 && along <= profile.range + targetRadius && perpendicular <= (profile.thrustWidth ?? 0) / 2 + targetRadius;
}

export function hitsSweep(
  weaponX: number,
  weaponZ: number,
  aimX: number,
  aimZ: number,
  profile: WeaponProfile,
  targetX: number,
  targetZ: number,
  targetRadius: number,
): boolean {
  const distance = Math.hypot(targetX - weaponX, targetZ - weaponZ);
  if (distance > profile.range + targetRadius) return false;
  const aimYaw = Math.atan2(aimX, aimZ);
  const targetAngle = targetYaw(targetX, targetZ, weaponX, weaponZ);
  return Math.abs(shortestAngle(targetAngle - aimYaw)) <= (profile.arcDegrees * Math.PI) / 360;
}

export function hitsShape(
  weaponX: number,
  weaponZ: number,
  aimX: number,
  aimZ: number,
  profile: WeaponProfile,
  targetX: number,
  targetZ: number,
  targetRadius: number,
): boolean {
  return profile.shape === 'thrust'
    ? hitsThrust(weaponX, weaponZ, aimX, aimZ, profile, targetX, targetZ, targetRadius)
    : hitsSweep(weaponX, weaponZ, aimX, aimZ, profile, targetX, targetZ, targetRadius);
}
