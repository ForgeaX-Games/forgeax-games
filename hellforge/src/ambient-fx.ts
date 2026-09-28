// AmbientFx — three-layer ambient particles (ember / ash / snow).
//
// ONE ECS entity per layer with Instances{transforms}. Engine 0.1.38 owns the
// storage/uniform fallback and chunks uniform batches when the device lacks a
// storage buffer, so the game keeps one authoritative transform array and the
// same instance count on every renderer backend.
//
// ZERO lights — particles are unlit HDR cubes only (ember blooms via HDR).

import {
  Transform,
} from '@forgeax/engine/scene';
import {
  MeshFilter,
  MeshRenderer,
  Instances,
  Materials,
} from '@forgeax/engine/render';
import type { EntityHandle, World } from '@forgeax/engine/ecs';
import type { Handle, MaterialAsset } from '@forgeax/engine/types';
import { primitiveMesh } from './primitive-mesh';

export type AmbientArea = 'camp' | 'wild' | 'den';
export type ParticleStyle = 'auto' | 'ash' | 'snow' | 'off';

type MatHandle = Handle<'MaterialAsset', 'shared'>;
type LayerKind = 'ember' | 'ash' | 'snow';

// N4 #6 particle budget (density default 1.15, range 0–2): the per-layer clamp
// min(BASE[k], round(BASE[k]*mult*density)) is the real ceiling — auto/den at
// default ≈ 245 ≤ 320; global worst path (snow style, den) = 296 ≤ 320; density
// 2 across all styles/areas ≤ 389 ≤ 500; MAX_TOTAL stays as a defensive rescale,
// not the active cap.
const BASE: Record<LayerKind, number> = { ember: 200, ash: 130, snow: 170 };
const BOX_X = 12;
const BOX_Y = 4.6;
const BOX_Z = 12;
const HALF_X = BOX_X * 0.5;
const HALF_Z = BOX_Z * 0.5;
const Y_MIN = 0.15;
const Y_MAX = Y_MIN + BOX_Y;
const MAX_TOTAL = 500;

const COLOR: Record<LayerKind, readonly [number, number, number, number]> = {
  // Soft ember glow (still blooms) — avoid harsh neon squares on dark vault.
  ember: [1.05, 0.21, 0.045, 1],
  // Dim warm ash dust against dark sky (not bright chalk cubes).
  ash: [0.38, 0.28, 0.22, 1],
  snow: [0.85, 0.90, 1.05, 1],
};

/** Area multipliers for style === 'auto'. */
const AUTO_MULT: Record<AmbientArea, Record<LayerKind, number>> = {
  // Fewer bright motes — dark vault must not look like a neon particle field.
  camp: { ember: 0.35, ash: 0.22, snow: 0 },
  wild: { ember: 0.55, ash: 0.50, snow: 0 },
  den: { ember: 1.1, ash: 0.30, snow: 0 },
};

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function writeDummyMat(out: Float32Array, off = 0): void {
  out.fill(0, off, off + 16);
  out[off + 15] = 1;
}

function writeMat(
  out: Float32Array,
  off: number,
  x: number, y: number, z: number,
  s: number,
  rotY: number,
): void {
  const cy = Math.cos(rotY);
  const sy = Math.sin(rotY);
  out[off] = s * cy; out[off + 1] = 0; out[off + 2] = -s * sy; out[off + 3] = 0;
  out[off + 4] = 0; out[off + 5] = s; out[off + 6] = 0; out[off + 7] = 0;
  out[off + 8] = s * sy; out[off + 9] = 0; out[off + 10] = s * cy; out[off + 11] = 0;
  out[off + 12] = x; out[off + 13] = y; out[off + 14] = z; out[off + 15] = 1;
}

interface LayerSoA {
  kind: LayerKind;
  capacity: number;
  active: number;
  px: Float32Array;
  py: Float32Array;
  pz: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  scale: Float32Array;
  phase: Float32Array;
  spin: Float32Array;
  rot: Float32Array;
  sway: Float32Array;
  transforms: Float32Array;
  entity: EntityHandle | null;
  mat: MatHandle;
}

function allocLayer(kind: LayerKind, capacity: number, mat: MatHandle): LayerSoA {
  return {
    kind,
    capacity,
    active: 0,
    px: new Float32Array(capacity),
    py: new Float32Array(capacity),
    pz: new Float32Array(capacity),
    vx: new Float32Array(capacity),
    vy: new Float32Array(capacity),
    vz: new Float32Array(capacity),
    scale: new Float32Array(capacity),
    phase: new Float32Array(capacity),
    spin: new Float32Array(capacity),
    rot: new Float32Array(capacity),
    sway: new Float32Array(capacity),
    transforms: new Float32Array(Math.max(capacity, 1) * 16),
    entity: null,
    mat,
  };
}

function seedParticle(layer: LayerSoA, i: number, cx: number, cz: number): void {
  layer.px[i] = cx + rand(-HALF_X, HALF_X);
  layer.py[i] = rand(Y_MIN, Y_MAX);
  layer.pz[i] = cz + rand(-HALF_Z, HALF_Z);
  // Ash used to be 0.02–0.05 — large enough to silhouette as black tiles on HDR sky.
  layer.scale[i] = layer.kind === 'ash' ? rand(0.006, 0.014)
    : layer.kind === 'ember' ? rand(0.007, 0.022)
      : rand(0.02, 0.05);
  layer.phase[i] = rand(0, Math.PI * 2);
  layer.rot[i] = rand(0, Math.PI * 2);
  layer.vx[i] = 0;
  layer.vz[i] = 0;

  switch (layer.kind) {
    case 'ember':
      layer.vy[i] = rand(0.5, 1.3);
      layer.spin[i] = 0;
      layer.sway[i] = rand(0.15, 0.35);
      break;
    case 'ash':
      layer.vy[i] = rand(-0.8, -0.35);
      layer.spin[i] = rand(0.4, 1.2) * (Math.random() < 0.5 ? 1 : -1);
      layer.sway[i] = rand(0.08, 0.2);
      break;
    case 'snow':
      layer.vy[i] = rand(-1.0, -0.5);
      layer.spin[i] = rand(0.2, 0.6) * (Math.random() < 0.5 ? 1 : -1);
      layer.sway[i] = rand(0.35, 0.7);
      break;
  }
}

function wrapAxis(v: number, center: number, half: number): number {
  const min = center - half;
  const max = center + half;
  const span = max - min;
  if (v < min) return v + span * Math.ceil((min - v) / span);
  if (v > max) return v - span * Math.ceil((v - max) / span);
  return v;
}

function wrapY(y: number): number {
  if (y > Y_MAX) return Y_MIN + (y - Y_MAX) % BOX_Y;
  if (y < Y_MIN) return Y_MAX - (Y_MIN - y) % BOX_Y;
  return y;
}

export class AmbientFx {
  private world: World;
  private density = 1;
  private style: ParticleStyle = 'auto';
  private area: AmbientArea = 'wild';
  private layers: Record<LayerKind, LayerSoA>;
  private elapsed = 0;
  private lastCx = 0;
  private lastCz = 0;
  private disposed = false;

  constructor(world: World) {
    this.world = world;

    const mkMat = (rgba: readonly [number, number, number, number]): MatHandle =>
      world.allocSharedRef<'MaterialAsset', MaterialAsset>(
        'MaterialAsset',
        Materials.unlit(rgba, { castShadow: false }),
      );

    this.layers = {
      ember: allocLayer('ember', BASE.ember, mkMat(COLOR.ember)),
      ash: allocLayer('ash', BASE.ash, mkMat(COLOR.ash)),
      snow: allocLayer('snow', BASE.snow, mkMat(COLOR.snow)),
    };

    for (const layer of Object.values(this.layers)) {
      writeDummyMat(layer.transforms, 0);
      const spawned = world.spawn(
        { component: Transform, data: {} },
        { component: MeshFilter, data: { assetHandle: primitiveMesh(this.world, 'cube') } },
        { component: MeshRenderer, data: { materials: [layer.mat] } },
        { component: Instances, data: { transforms: layer.transforms.subarray(0, 16) } },
      );
      if (spawned.ok) layer.entity = spawned.value as EntityHandle;
    }

    this.applyCounts(0, 0);
  }

  configure(density: number, style: ParticleStyle): void {
    this.density = Math.max(0, density);
    this.style = style;
    this.applyCounts(this.lastCx, this.lastCz);
  }

  setArea(a: AmbientArea): void {
    this.area = a;
    this.applyCounts(this.lastCx, this.lastCz);
  }

  tick(dt: number, cx: number, cz: number): void {
    if (this.disposed) return;
    this.elapsed += dt;
    this.lastCx = cx;
    this.lastCz = cz;
    const t = this.elapsed;

    for (const layer of Object.values(this.layers)) {
      const n = layer.active;
      for (let i = 0; i < n; i++) {
        const sway = layer.sway[i]! * Math.sin(t * (layer.kind === 'snow' ? 1.6 : 1.1) + layer.phase[i]!);
        const swayZ = layer.sway[i]! * 0.65 * Math.cos(t * (layer.kind === 'snow' ? 1.3 : 0.9) + layer.phase[i]! * 1.7);
        layer.px[i]! += (layer.vx[i]! + sway) * dt;
        layer.py[i]! += layer.vy[i]! * dt;
        layer.pz[i]! += (layer.vz[i]! + swayZ) * dt;
        layer.rot[i]! += layer.spin[i]! * dt;

        layer.px[i] = wrapAxis(layer.px[i]!, cx, HALF_X);
        layer.pz[i] = wrapAxis(layer.pz[i]!, cz, HALF_Z);
        layer.py[i] = wrapY(layer.py[i]!);
      }

      this.uploadInstances(layer);
    }
  }

  count(): number {
    let n = 0;
    for (const layer of Object.values(this.layers)) n += layer.active;
    return n;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const layer of Object.values(this.layers)) {
      if (layer.entity !== null) {
        this.world.despawn(layer.entity);
        layer.entity = null;
      }
      layer.active = 0;
    }
  }

  // ── internals ──────────────────────────────────────────────────────────

  private multipliers(): Record<LayerKind, number> {
    if (this.style === 'off') return { ember: 0, ash: 0, snow: 0 };
    if (this.style === 'ash') return { ember: 0, ash: 1, snow: 0 };
    if (this.style === 'snow') {
      // Enable snow at full base; keep ash low; soft ember leftover from area.
      const auto = AUTO_MULT[this.area];
      return { ember: auto.ember * 0.35, ash: 0.25, snow: 1 };
    }
    return AUTO_MULT[this.area];
  }

  private applyCounts(cx: number, cz: number): void {
    const mult = this.multipliers();
    const kinds: LayerKind[] = ['ember', 'ash', 'snow'];
    const raw: Record<LayerKind, number> = { ember: 0, ash: 0, snow: 0 };
    let total = 0;
    for (const k of kinds) {
      // round (not floor) so fractional multipliers don't systematically shred
      // the budget (e.g. ash 130×0.5×1.15 → 75, not 74)
      const n = Math.round(BASE[k] * mult[k] * this.density);
      raw[k] = Math.max(0, Math.min(BASE[k], n));
      total += raw[k];
    }
    if (total > MAX_TOTAL && total > 0) {
      const s = MAX_TOTAL / total;
      total = 0;
      for (const k of kinds) {
        raw[k] = Math.floor(raw[k] * s);
        total += raw[k];
      }
    }

    for (const k of kinds) {
      this.resizeLayer(this.layers[k], raw[k], cx, cz);
    }
  }

  private resizeLayer(layer: LayerSoA, n: number, cx: number, cz: number): void {
    const prev = layer.active;
    if (n > prev) {
      for (let i = prev; i < n; i++) seedParticle(layer, i, cx, cz);
    }
    layer.active = n;
    this.uploadInstances(layer);
  }

  private uploadInstances(layer: LayerSoA): void {
    if (layer.entity === null) return;
    const n = layer.active;
    const count = Math.max(n, 1);
    // Reuse backing store; expose only the live prefix (or 1 dummy).
    if (n === 0) {
      writeDummyMat(layer.transforms, 0);
    } else {
      for (let i = 0; i < n; i++) {
        writeMat(
          layer.transforms, i * 16,
          layer.px[i]!, layer.py[i]!, layer.pz[i]!,
          layer.scale[i]!, layer.rot[i]!,
        );
      }
    }
    const transforms = layer.transforms.subarray(0, count * 16);
    this.world.set(layer.entity, Instances, { transforms }).unwrap();
  }
}
