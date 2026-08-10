import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { Handle, MaterialAsset } from '@forgeax/engine-runtime';
import animatedTargetShader from '../shaders/animated-target.wgsl';

export const ANIMATED_TARGET_SHADER_ID = 'game_default::animated_target';
export const ANIMATED_TARGET_SHADER_SOURCE = animatedTargetShader.wgsl;

type MutableMaterial = {
  passes?: MaterialAsset['passes'];
  values?: Readonly<Record<string, unknown>>;
};

export type AnimatedMaterialTarget = {
  e: EntityHandle;
  mat: Handle<'MaterialAsset', 'shared'>;
  baseHue: number;
  baseColor: readonly [number, number, number, number];
  baseMaterial: MaterialAsset;
  shaderAnimated: boolean;
  shaderTime: number;
};

export function createAnimatedMaterialTarget(
  world: World,
  source: Pick<AnimatedMaterialTarget, 'e' | 'mat'>,
  baseHue: number,
): AnimatedMaterialTarget {
  const result = world.sharedRefs.resolve<'MaterialAsset', MaterialAsset>(source.mat);
  const values = result.ok ? result.value.values as Record<string, unknown> | undefined : undefined;
  const rawColor = values?.baseColor;
  const color: [number, number, number, number] = Array.isArray(rawColor) && rawColor.length === 4
    ? [Number(rawColor[0]), Number(rawColor[1]), Number(rawColor[2]), Number(rawColor[3])]
    : [1, 1, 1, 1];
  const baseMaterial = result.ok ? { ...result.value } : { kind: 'material' as const };
  let shaderAnimated = false;
  if (result.ok) {
    const material = result.value as unknown as MutableMaterial;
    material.passes = [{ name: 'Forward', program: { module: ANIMATED_TARGET_SHADER_ID }, renderState: { tags: { LightMode: 'Forward' }, queue: 2000 } }];
    material.values = { baseColor: color, time: 0 };
    shaderAnimated = true;
  }
  return { ...source, baseHue, baseColor: color, baseMaterial, shaderAnimated, shaderTime: 0 };
}

function hueToRgb(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

function hslToRgb(hue: number): readonly [number, number, number] {
  const h = (((hue % 360) + 360) % 360) / 360;
  const saturation = 0.86;
  const lightness = 0.5;
  const q = lightness * (1 + saturation);
  const p = 2 * lightness - q;
  return [hueToRgb(p, q, h + 1 / 3), hueToRgb(p, q, h), hueToRgb(p, q, h - 1 / 3)];
}

export function stepAnimatedMaterial(world: World, target: AnimatedMaterialTarget, elapsed: number): void {
  const result = world.sharedRefs.resolve<'MaterialAsset', MaterialAsset>(target.mat);
  if (!result.ok) return;
  const values = result.value.values as Record<string, unknown> | undefined;
  if (values === undefined) return;
  if (target.shaderAnimated) {
    values.time = elapsed;
    target.shaderTime = elapsed;
    return;
  }
  values.baseColor = [...hslToRgb(target.baseHue + elapsed * 38), 1];
}

export function resetAnimatedMaterial(world: World, target: AnimatedMaterialTarget): void {
  const result = world.sharedRefs.resolve<'MaterialAsset', MaterialAsset>(target.mat);
  if (!result.ok) return;
  if (target.shaderAnimated) {
    const material = result.value as unknown as Record<string, unknown>;
    for (const key of Object.keys(material)) delete material[key];
    Object.assign(material, target.baseMaterial);
    target.shaderTime = 0;
    return;
  }
  const values = result.value.values as Record<string, unknown> | undefined;
  if (values !== undefined) values.baseColor = [...target.baseColor];
}

export function animatedShaderEnabled(target: AnimatedMaterialTarget | undefined): boolean {
  return target?.shaderAnimated === true;
}

export function animatedShaderTime(target: AnimatedMaterialTarget | undefined): number {
  return target?.shaderTime ?? 0;
}
