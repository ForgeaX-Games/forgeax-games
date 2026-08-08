import { HANDLE_CUBE, HANDLE_SPHERE } from '@forgeax/engine-assets-runtime';
import type { EntityHandle, World } from '@forgeax/engine-ecs';
import { quat } from '@forgeax/engine-math';
import { Materials, MeshFilter, MeshRenderer } from '@forgeax/engine-render';
import type { Handle, MaterialAsset } from '@forgeax/engine-runtime';
import { ChildOf, Name, Transform } from '@forgeax/engine-scene';

type MaterialHandle = Handle<'MaterialAsset', 'shared'>;
type Vec3 = [number, number, number];
type Quat = [number, number, number, number];

export type WardenMotion = {
  elapsed: number;
  moving: boolean;
  sprinting: boolean;
  grounded: boolean;
  verticalVelocity: number;
};

export type WardenPose = {
  cadence: number;
  stride: number;
  bob: number;
  torsoLean: number;
  shoulderCounter: number;
  kneeLeft: number;
  kneeRight: number;
  capeLift: number;
  capeFlutter: number;
  corePulse: number;
};

export type WardenRig = {
  root: EntityHandle;
  torso: EntityHandle;
  head: EntityHandle;
  armLeft: EntityHandle;
  armRight: EntityHandle;
  elbowLeft: EntityHandle;
  elbowRight: EntityHandle;
  hipLeft: EntityHandle;
  hipRight: EntityHandle;
  kneeLeft: EntityHandle;
  kneeRight: EntityHandle;
  capeUpper: EntityHandle;
  capeMiddle: EntityHandle;
  capeLower: EntityHandle;
  echoCore: EntityHandle;
};

type PartOptions = {
  parent: EntityHandle;
  name: string;
  pos: Vec3;
  scale?: Vec3;
  material?: MaterialHandle;
  mesh?: 'cube' | 'sphere';
  quat?: Quat;
};

function pbr(
  world: World,
  baseColor: [number, number, number, number],
  metallic: number,
  roughness: number,
  emissive?: [number, number, number],
  emissiveIntensity?: number,
): MaterialHandle {
  return world.allocSharedRef<'MaterialAsset', MaterialAsset>('MaterialAsset', Materials.standard({
    baseColor,
    metallic,
    roughness,
    ...(emissive ? { emissive, emissiveIntensity: emissiveIntensity ?? 1 } : {}),
  }));
}

function node(world: World, options: PartOptions): EntityHandle {
  if (options.material && options.mesh) {
    return world.spawn(
      { component: Name, data: { value: options.name } },
      { component: Transform, data: {
        pos: options.pos,
        ...(options.scale ? { scale: options.scale } : {}),
        ...(options.quat ? { quat: options.quat } : {}),
      } },
      { component: ChildOf, data: { parent: options.parent } },
      { component: MeshFilter, data: { assetHandle: options.mesh === 'sphere' ? HANDLE_SPHERE : HANDLE_CUBE } },
      { component: MeshRenderer, data: { materials: [options.material] } },
    ).unwrap();
  }
  return world.spawn(
    { component: Name, data: { value: options.name } },
    { component: Transform, data: {
      pos: options.pos,
      ...(options.scale ? { scale: options.scale } : {}),
      ...(options.quat ? { quat: options.quat } : {}),
    } },
    { component: ChildOf, data: { parent: options.parent } },
  ).unwrap();
}

function axisRotation(axis: Vec3, radians: number): Quat {
  const rotation = quat.create();
  quat.fromAxisAngle(rotation, axis, radians);
  return [rotation[0]!, rotation[1]!, rotation[2]!, rotation[3]!];
}

function compoundRotation(x: number, z: number): Quat {
  const aroundX = quat.create();
  const aroundZ = quat.create();
  const result = quat.create();
  quat.fromAxisAngle(aroundX, [1, 0, 0], x);
  quat.fromAxisAngle(aroundZ, [0, 0, 1], z);
  quat.multiply(result, aroundZ, aroundX);
  return [result[0]!, result[1]!, result[2]!, result[3]!];
}

/**
 * Produces a deterministic authored pose. The runtime rig consumes this projection,
 * keeping locomotion semantics independently testable from the ECS hierarchy.
 */
export function wardenPose(motion: WardenMotion): WardenPose {
  const locomotion = motion.moving ? (motion.sprinting ? 1 : 0.72) : 0;
  const cadence = motion.sprinting ? 12.5 : motion.moving ? 9.2 : 2.15;
  const cycle = motion.elapsed * cadence;
  const stride = Math.sin(cycle) * (motion.sprinting ? 0.82 : motion.moving ? 0.58 : 0.018);
  const bob = motion.grounded
    ? Math.abs(Math.sin(cycle)) * (motion.sprinting ? 0.07 : motion.moving ? 0.045 : 0) + Math.sin(cycle) * (motion.moving ? 0 : 0.012)
    : Math.max(-0.08, Math.min(0.08, motion.verticalVelocity * 0.012));
  const airborneTuck = motion.grounded ? 0 : Math.min(0.8, 0.28 + Math.abs(motion.verticalVelocity) * 0.035);
  return {
    cadence,
    stride,
    bob,
    torsoLean: locomotion * (motion.sprinting ? 0.2 : 0.08) - (motion.grounded ? 0 : motion.verticalVelocity * 0.018),
    shoulderCounter: Math.sin(cycle + Math.PI / 2) * locomotion * 0.045,
    kneeLeft: Math.max(0, -stride) * 0.62 + airborneTuck,
    kneeRight: Math.max(0, stride) * 0.62 + airborneTuck,
    capeLift: 0.12 + locomotion * (motion.sprinting ? 0.34 : 0.16),
    capeFlutter: Math.sin(motion.elapsed * 5.3) * 0.05 + Math.sin(motion.elapsed * 9.7) * 0.022,
    corePulse: 1 + Math.sin(motion.elapsed * 3.4) * 0.12 + locomotion * 0.1,
  };
}

/** Builds a layered, readable third-person silhouette from engine-owned geometry. */
export function createWardenRig(world: World, player: EntityHandle): WardenRig {
  const mantle = pbr(world, [0.035, 0.09, 0.14, 1], 0.08, 0.7);
  const cloth = pbr(world, [0.025, 0.055, 0.085, 1], 0, 0.92);
  const silver = pbr(world, [0.29, 0.38, 0.43, 1], 0.82, 0.25);
  const edge = pbr(world, [0.56, 0.38, 0.16, 1], 0.72, 0.29);
  const leather = pbr(world, [0.12, 0.055, 0.028, 1], 0.04, 0.86);
  const echo = pbr(world, [0.04, 0.5, 0.78, 1], 0.18, 0.18, [0.04, 0.62, 1], 7.5);

  const root = node(world, { parent: player, name: 'WardenRig', pos: [0, 0, 0] });
  const torso = node(world, { parent: root, name: 'WardenTorsoJoint', pos: [0, 0.28, 0] });
  node(world, { parent: torso, name: 'WardenChest', pos: [0, 0, 0], scale: [0.72, 0.56, 0.4], material: mantle, mesh: 'cube' });
  node(world, { parent: torso, name: 'WardenChestPlate', pos: [0, 0.08, -0.29], scale: [0.58, 0.42, 0.12], material: silver, mesh: 'cube' });
  node(world, { parent: torso, name: 'WardenBackPlate', pos: [0, 0.08, 0.29], scale: [0.54, 0.38, 0.1], material: silver, mesh: 'cube' });
  node(world, { parent: root, name: 'WardenWaist', pos: [0, -0.22, 0], scale: [0.52, 0.24, 0.34], material: leather, mesh: 'cube' });
  node(world, { parent: root, name: 'WardenBelt', pos: [0, -0.1, 0], scale: [0.61, 0.1, 0.38], material: edge, mesh: 'cube' });

  const head = node(world, { parent: torso, name: 'WardenHeadJoint', pos: [0, 0.66, -0.015] });
  node(world, { parent: head, name: 'WardenHood', pos: [0, 0, 0], scale: [0.43, 0.42, 0.4], material: cloth, mesh: 'cube' });
  node(world, { parent: head, name: 'WardenHelmCrown', pos: [0, 0.08, -0.24], scale: [0.38, 0.3, 0.1], material: silver, mesh: 'cube' });
  node(world, { parent: head, name: 'WardenHelmCrest', pos: [0, 0.34, 0.02], scale: [0.075, 0.28, 0.28], material: edge, mesh: 'cube', quat: axisRotation([1, 0, 0], -0.18) });
  node(world, { parent: head, name: 'WardenHelmWingL', pos: [-0.31, 0.11, 0.02], scale: [0.24, 0.07, 0.13], material: silver, mesh: 'cube', quat: axisRotation([0, 0, 1], -0.42) });
  node(world, { parent: head, name: 'WardenHelmWingR', pos: [0.31, 0.11, 0.02], scale: [0.24, 0.07, 0.13], material: silver, mesh: 'cube', quat: axisRotation([0, 0, 1], 0.42) });

  node(world, { parent: torso, name: 'WardenPauldronL', pos: [-0.63, 0.25, 0], scale: [0.38, 0.22, 0.48], material: silver, mesh: 'cube', quat: axisRotation([0, 0, 1], -0.18) });
  node(world, { parent: torso, name: 'WardenPauldronR', pos: [0.63, 0.25, 0], scale: [0.38, 0.22, 0.48], material: silver, mesh: 'cube', quat: axisRotation([0, 0, 1], 0.18) });

  const armLeft = node(world, { parent: torso, name: 'WardenArmJointL', pos: [-0.53, 0.2, 0] });
  const armRight = node(world, { parent: torso, name: 'WardenArmJointR', pos: [0.53, 0.2, 0] });
  node(world, { parent: armLeft, name: 'WardenUpperArmL', pos: [0, -0.26, 0], scale: [0.2, 0.48, 0.22], material: mantle, mesh: 'cube' });
  node(world, { parent: armRight, name: 'WardenUpperArmR', pos: [0, -0.26, 0], scale: [0.2, 0.48, 0.22], material: mantle, mesh: 'cube' });
  const elbowLeft = node(world, { parent: armLeft, name: 'WardenElbowL', pos: [0, -0.52, 0] });
  const elbowRight = node(world, { parent: armRight, name: 'WardenElbowR', pos: [0, -0.52, 0] });
  node(world, { parent: elbowLeft, name: 'WardenForearmL', pos: [0, -0.21, -0.015], scale: [0.22, 0.42, 0.24], material: silver, mesh: 'cube' });
  node(world, { parent: elbowRight, name: 'WardenForearmR', pos: [0, -0.21, -0.015], scale: [0.22, 0.42, 0.24], material: silver, mesh: 'cube' });
  node(world, { parent: elbowLeft, name: 'WardenHandL', pos: [0, -0.45, -0.02], scale: [0.17, 0.17, 0.17], material: leather, mesh: 'sphere' });
  node(world, { parent: elbowRight, name: 'WardenHandR', pos: [0, -0.45, -0.02], scale: [0.17, 0.17, 0.17], material: leather, mesh: 'sphere' });

  const hipLeft = node(world, { parent: root, name: 'WardenHipL', pos: [-0.23, -0.34, 0] });
  const hipRight = node(world, { parent: root, name: 'WardenHipR', pos: [0.23, -0.34, 0] });
  node(world, { parent: hipLeft, name: 'WardenThighL', pos: [0, -0.28, 0], scale: [0.27, 0.52, 0.3], material: cloth, mesh: 'cube' });
  node(world, { parent: hipRight, name: 'WardenThighR', pos: [0, -0.28, 0], scale: [0.27, 0.52, 0.3], material: cloth, mesh: 'cube' });
  const kneeLeft = node(world, { parent: hipLeft, name: 'WardenKneeL', pos: [0, -0.55, 0] });
  const kneeRight = node(world, { parent: hipRight, name: 'WardenKneeR', pos: [0, -0.55, 0] });
  node(world, { parent: kneeLeft, name: 'WardenGreaveL', pos: [0, -0.25, -0.025], scale: [0.25, 0.47, 0.29], material: silver, mesh: 'cube' });
  node(world, { parent: kneeRight, name: 'WardenGreaveR', pos: [0, -0.25, -0.025], scale: [0.25, 0.47, 0.29], material: silver, mesh: 'cube' });
  node(world, { parent: kneeLeft, name: 'WardenBootL', pos: [0, -0.52, -0.1], scale: [0.29, 0.18, 0.48], material: leather, mesh: 'cube' });
  node(world, { parent: kneeRight, name: 'WardenBootR', pos: [0, -0.52, -0.1], scale: [0.29, 0.18, 0.48], material: leather, mesh: 'cube' });

  const capeUpper = node(world, { parent: torso, name: 'WardenCapeUpper', pos: [0, 0.2, 0.35] });
  node(world, { parent: capeUpper, name: 'WardenCapeMantle', pos: [0, -0.25, 0.04], scale: [0.72, 0.52, 0.075], material: mantle, mesh: 'cube' });
  const capeMiddle = node(world, { parent: capeUpper, name: 'WardenCapeMiddle', pos: [0, -0.51, 0.03] });
  node(world, { parent: capeMiddle, name: 'WardenCapePanelMiddle', pos: [0, -0.28, 0], scale: [0.62, 0.55, 0.065], material: mantle, mesh: 'cube' });
  const capeLower = node(world, { parent: capeMiddle, name: 'WardenCapeLower', pos: [0, -0.54, 0] });
  node(world, { parent: capeLower, name: 'WardenCapePanelLower', pos: [0, -0.25, 0], scale: [0.5, 0.48, 0.055], material: cloth, mesh: 'cube' });

  const echoCore = node(world, { parent: torso, name: 'WardenEchoCore', pos: [0, 0.08, 0.4], scale: [0.18, 0.18, 0.1], material: echo, mesh: 'sphere' });
  node(world, { parent: torso, name: 'WardenEchoRailL', pos: [-0.24, 0.08, 0.4], scale: [0.05, 0.4, 0.07], material: edge, mesh: 'cube' });
  node(world, { parent: torso, name: 'WardenEchoRailR', pos: [0.24, 0.08, 0.4], scale: [0.05, 0.4, 0.07], material: edge, mesh: 'cube' });
  node(world, { parent: torso, name: 'WardenRelicBlade', pos: [0.34, -0.12, 0.46], scale: [0.075, 1.08, 0.075], material: edge, mesh: 'cube', quat: axisRotation([0, 0, 1], -0.56) });
  node(world, { parent: torso, name: 'WardenRelicPommel', pos: [-0.23, 0.76, 0.46], scale: [0.14, 0.14, 0.14], material: echo, mesh: 'sphere' });

  return {
    root, torso, head, armLeft, armRight, elbowLeft, elbowRight,
    hipLeft, hipRight, kneeLeft, kneeRight, capeUpper, capeMiddle, capeLower, echoCore,
  };
}

export function applyWardenPose(world: World, rig: WardenRig, motion: WardenMotion): WardenPose {
  const pose = wardenPose(motion);
  world.set(rig.root, Transform, { pos: [0, pose.bob, 0] });
  world.set(rig.torso, Transform, { quat: compoundRotation(pose.torsoLean, pose.shoulderCounter) });
  world.set(rig.head, Transform, { quat: compoundRotation(-pose.torsoLean * 0.4, -pose.shoulderCounter * 0.65) });
  world.set(rig.armLeft, Transform, { quat: axisRotation([1, 0, 0], pose.stride * 0.78 - pose.torsoLean * 0.45) });
  world.set(rig.armRight, Transform, { quat: axisRotation([1, 0, 0], -pose.stride * 0.78 - pose.torsoLean * 0.45) });
  world.set(rig.elbowLeft, Transform, { quat: axisRotation([1, 0, 0], 0.15 + Math.max(0, -pose.stride) * 0.36) });
  world.set(rig.elbowRight, Transform, { quat: axisRotation([1, 0, 0], 0.15 + Math.max(0, pose.stride) * 0.36) });
  world.set(rig.hipLeft, Transform, { quat: axisRotation([1, 0, 0], -pose.stride) });
  world.set(rig.hipRight, Transform, { quat: axisRotation([1, 0, 0], pose.stride) });
  world.set(rig.kneeLeft, Transform, { quat: axisRotation([1, 0, 0], pose.kneeLeft) });
  world.set(rig.kneeRight, Transform, { quat: axisRotation([1, 0, 0], pose.kneeRight) });
  world.set(rig.capeUpper, Transform, { quat: compoundRotation(-pose.capeLift, pose.capeFlutter * 0.35) });
  world.set(rig.capeMiddle, Transform, { quat: compoundRotation(-pose.capeLift * 0.55 + pose.capeFlutter, -pose.capeFlutter * 0.55) });
  world.set(rig.capeLower, Transform, { quat: compoundRotation(-pose.capeLift * 0.35 - pose.capeFlutter * 1.4, pose.capeFlutter) });
  world.set(rig.echoCore, Transform, { scale: [0.18 * pose.corePulse, 0.18 * pose.corePulse, 0.1 * pose.corePulse] });
  return pose;
}
