import type { ActorPart } from '../model-kit.ts';

export type AttackShape = 'thrust' | 'sweep';

export interface WeaponProfile {
  readonly id: string;
  readonly displayName: string;
  readonly shape: AttackShape;
  readonly damage: number;
  readonly cooldown: number;
  readonly range: number;
  readonly arcDegrees: number;
  readonly thrustWidth?: number;
  readonly maxTargets: number;
  readonly windup: number;
  readonly strike: number;
  readonly recover: number;
  readonly model: {
    readonly parts: readonly ActorPart[];
    readonly materialSlots: readonly string[];
    readonly restYaw: number;
  };
}
