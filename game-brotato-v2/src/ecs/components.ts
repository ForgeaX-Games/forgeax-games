import { defineComponent } from '@forgeax/engine-ecs';

export const Player = defineComponent('BrotatoV2Player', {});

export const PlayerMotion = defineComponent('BrotatoV2PlayerMotion', {
  inputX: 'f32',
  inputZ: 'f32',
  velocityX: 'f32',
  velocityZ: 'f32',
  facing: 'f32',
});

/** Root-owned animation clock and normalized movement speed. */
export const ActorAnimState = defineComponent('BrotatoV2ActorAnimState', {
  speed01: 'f32',
  clock: 'f32',
});

/** Limb-local motion parameters; base position prevents frame-to-frame drift. */
export const ActorLimbMotion = defineComponent('BrotatoV2ActorLimbMotion', {
  kind: 'u32',
  axis: 'u32',
  idleAmplitude: 'f32',
  idleFrequency: 'f32',
  moveAmplitude: 'f32',
  moveFrequency: 'f32',
  phase: 'f32',
  baseX: 'f32',
  baseY: 'f32',
  baseZ: 'f32',
});

export const Health = defineComponent('BrotatoV2Health', {
  current: 'f32',
  max: 'f32',
  invulnerability: 'f32',
});

/** Enemy identity plus whether this pooled entity currently participates in play. */
export const Enemy = defineComponent('BrotatoV2Enemy', {
  active: 'f32',
});

export const EnemyBrain = defineComponent('BrotatoV2EnemyBrain', {
  speed: 'f32',
  attackCooldown: 'f32',
  hopClock: 'f32',
  birthClock: 'f32',
});

export const WeaponSlot = defineComponent('BrotatoV2WeaponSlot', {
  slotIndex: 'u32',
  profileIndex: 'u32',
  cooldown: 'f32',
  slotAngle: 'f32',
  swingPhase: 'f32',
  aimYaw: 'f32',
});

export const SwingState = defineComponent('BrotatoV2SwingState', {
  active: 'f32',
  hitApplied: 'f32',
  /** World-space direction captured when this attack started. */
  attackYaw: 'f32',
});

export const RangeIndicator = defineComponent('BrotatoV2RangeIndicator', {
  slotIndex: 'u32',
  baseScale: 'f32',
});

export const HitFlash = defineComponent('BrotatoV2HitFlash', { ttl: 'f32' });

export const SpawnMarker = defineComponent('BrotatoV2SpawnMarker', {
  ttl: 'f32',
  total: 'f32',
  blinkPhase: 'f32',
  enemyKind: 'u32',
});

export const Dying = defineComponent('BrotatoV2Dying', { ttl: 'f32', total: 'f32' });

export const M1_COMPONENTS = [Player, PlayerMotion, ActorAnimState, ActorLimbMotion] as const;

export const M2_COMPONENTS = [
  Health,
  Enemy,
  EnemyBrain,
  WeaponSlot,
  SwingState,
  RangeIndicator,
  HitFlash,
  SpawnMarker,
  Dying,
] as const;
