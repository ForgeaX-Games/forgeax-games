import { AXE_PROFILE } from './axe.ts';
import { SPEAR_PROFILE } from './spear.ts';

export const WEAPON_PROFILES = { spear: SPEAR_PROFILE, axe: AXE_PROFILE } as const;
export type WeaponId = keyof typeof WEAPON_PROFILES;
