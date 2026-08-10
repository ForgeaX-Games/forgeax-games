import { defineComponent } from '@forgeax/engine-ecs';

/** ECS payload owned by the projectile system rather than a bootstrap-local array. */
export const Projectile = defineComponent('GameDefaultProjectile', {
  age: 'f32',
  velocityX: 'f32',
  velocityY: 'f32',
  velocityZ: 'f32',
  impactScale: { type: 'f32', default: 1 },
  hitMask: { type: 'u32', default: 0 },
}, { transient: true });

/** Variable-rate player intent and collision state; Transform remains the pose owner. */
export const PlayerMotion = defineComponent('GameDefaultPlayerMotion', {
  faceX: { type: 'f32', default: 0 },
  faceZ: { type: 'f32', default: -1 },
  jumpY: { type: 'f32', default: 0.75 },
  freeY: { type: 'f32', default: 0.75 },
  velocityY: { type: 'f32', default: 0 },
  grounded: { type: 'u32', default: 1 },
  shootCooldown: { type: 'f32', default: 0 },
}, { transient: true });

/** Input intent written by engine-input systems and consumed by gameplay systems. */
export const GameplayInput = defineComponent('GameDefaultGameplayInput', {
  lookYaw: { type: 'f32', default: 0 },
  lookPitch: { type: 'f32', default: 0 },
  wantShoot: { type: 'u32', default: 0 },
  shotDirX: { type: 'f32', default: 0 },
  shotDirZ: { type: 'f32', default: -1 },
  shotDirValid: { type: 'u32', default: 0 },
}, { transient: true });

/** ECS-owned hold/release state for the player-visible charged shot. */
export const ChargeShot = defineComponent('GameDefaultChargeShot', {
  active: { type: 'u32', default: 0 },
  release: { type: 'u32', default: 0 },
  elapsed: { type: 'f32', default: 0 },
  power: { type: 'f32', default: 1 },
}, { transient: true });

/** Tunable FPS camera velocity; the free-camera helper operates on this ECS payload. */
export const FreeCameraMotion = defineComponent('GameDefaultFreeCameraMotion', {
  velocityX: { type: 'f32', default: 0 },
  velocityY: { type: 'f32', default: 0 },
  velocityZ: { type: 'f32', default: 0 },
  walkSpeed: { type: 'f32', default: 3 },
  runSpeed: { type: 'f32', default: 9 },
}, { transient: true });

/** Player-owned projectile presentation policy; render choice is not bootstrap state. */
export const ProjectilePolicy = defineComponent('GameDefaultProjectilePolicy', {
  visualMode: { type: 'u32', default: 0 },
}, { transient: true });

/** Authored body-part scale used by the FPS presentation system. */
export const PlayerBodyPart = defineComponent('GameDefaultPlayerBodyPart', {
  baseScaleX: { type: 'f32', default: 1 },
  baseScaleY: { type: 'f32', default: 1 },
  baseScaleZ: { type: 'f32', default: 1 },
}, { transient: true });

/** Authored pose snapshot used by reset; the scene asset remains the source of truth. */
export const ResetPose = defineComponent('GameDefaultResetPose', {
  posX: 'f32', posY: 'f32', posZ: 'f32',
  quatX: 'f32', quatY: 'f32', quatZ: 'f32', quatW: 'f32',
  scaleX: 'f32', scaleY: 'f32', scaleZ: 'f32',
}, { transient: true });

/** Asset projection for a target's authored material slots and clearcoat flag. */
export const TargetPresentation = defineComponent(
  'GameDefaultTargetPresentation',
  { authoredMaterials: 'array<shared<MaterialAsset>>', clearcoat: { type: 'u32', default: 0 } },
  { transient: true },
);

/** Camera policy and smoothing state; Camera stores projection data, this stores intent. */
export const CameraRig = defineComponent('GameDefaultCameraRig', {
  mode: { type: 'u32', default: 0 },
  followX: { type: 'f32', default: 0 },
  followZ: { type: 'f32', default: 9 },
  panX: { type: 'f32', default: 0 },
  panZ: { type: 'f32', default: 9 },
  panHalfHeight: { type: 'f32', default: 8 },
  perspectiveFov: { type: 'f32', default: Math.PI / 3 },
}, { transient: true });

/** Transient target feedback state; material swaps are a render projection of this value. */
export const HitFlash = defineComponent('GameDefaultHitFlash', {
  remaining: { type: 'f32', default: 0 },
}, { transient: true });

export type ProjectileVisual = 'mesh' | 'sprite' | 'sprite-lit';
