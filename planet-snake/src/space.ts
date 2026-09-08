// Space background wiring.
//
// Registers src/space.wgsl as a fullscreen post effect and keeps its params UBO
// fed with the camera basis so the starfield stays fixed in world space while
// the camera swings around the planet.
//
// Two engine facts this depends on, both verified against the engine tree rather
// than docs (the docs' `ShaderRegistry.registerMaterialShader` does not exist):
//   - the post-effect binding surface is exactly sceneTexture / sceneSampler /
//     params UBO / depthTexture / depthSampler on @group(1)
//     (packages/render/src/pipeline-spec.ts:686-766)
//   - `postEffects` is an array, so further passes chain after this one
// Precedent: apps/bevy/fog/src/fog.ts.

import type { EntityHandle, World } from '@forgeax/engine-ecs';
import type { Renderer } from '@forgeax/engine-render';
import spaceShader from './space.wgsl';
import {
  installUrpPostProcessPipeline,
  PostProcessParams,
  registerPostProcess,
} from './engine-bridge';
import { landFieldWgsl, noiseModuleWgsl } from './surface';

export const SPACE_POSTPROCESS_ID = 'planet-snake::space';

/** Number of trail samples the wake field is drawn from. */
// MEASURED. At 8, the samples sat 3.45 world units apart while Coilstrike's
// wind-up compresses the body wave to 3.36 — one sample per wavelength, half
// the Nyquist rate. Every chord of the polyline then joined two points at
// nearly the SAME phase, so the line the wake is drawn from flattened out and
// the body wove across its own furrow instead of lying in it: measured, the
// body strayed 0.46 units from it at cruise (inside its own 0.62 radius) and
// 1.55 units while coiling, growing the longer the wind-up was held.
export const WAKE_SAMPLES = 16;
/** 9 header vec4s + 8 dent vec4s + WAKE_SAMPLES trail vec4s. */
const SPACE_PARAMS_BYTES = 144 + 128 + WAKE_SAMPLES * 16;   // header, dents, wake

export interface SpaceCamera {
  right: readonly [number, number, number];
  up: readonly [number, number, number];
  forward: readonly [number, number, number];
  tanHalfFov: number;
  aspect: number;
  time: number;
  sun: readonly [number, number, number];
  sunIntensity: number;
  /** Camera position in planet-centred space (the planet sits at the origin). */
  camPos: readonly [number, number, number];
  planetRadius: number;
  atmosRadius: number;
  near: number;
  far: number;
  /** How far the live water sheet floats above the painted sea
   *  (src/water-patch.ts HOVER, plus the painted sea's own 0.05 base offset).
   *  The post pass's water band has to accept BOTH surfaces: with one window
   *  centred on the painted sea, raising the sheet dropped it out of the band
   *  and the whole patch lost its sky reflection and swell — it read as a dark
   *  quadrilateral sitting on the ocean. */
  waterLift: number;
  /** Maelstrom: xyz = unit direction of the orbit centre, w = strength 0..1.
   *
   *  The vortex is drawn in TWO places on purpose, and the split is the one this
   *  project already uses everywhere for the sea: the water patch carries the
   *  BOWL, which is what gives it a silhouette and parallax up close; this field
   *  carries the DARK THROAT and the spiral arms, which is what makes it read as
   *  a maelstrom rather than as a bright patch. Geometry alone cannot do the
   *  second — a smooth tilted bowl catches the sun across its whole face. */
  /** Where the live water sheet is: unit anchor, and the cosine of its angular
   *  half-extent. The dents below only mean anything inside it. */
  patch: readonly [number, number, number, number];
  /** cos(0.94 * half), cos(0.66 * half) — the edge fade, shared with the sheet's
   *  own vertices so geometry and shading fade together. */
  sheetFade: readonly [number, number];
  /** 0..1 totality and the real sun elevation at the player's surface point. */
  eclipse: number;
  eclipseElevation: number;
  /** View-ray direction of the clamped eclipse centre. Computed once in TS and
   *  shared by the hand mesh and the post pass so geometry and corona cannot
   *  drift apart when the real solar elevation is outside the visible band. */
  eclipseAnchor: readonly [number, number, number];
  /** What the skills have pushed the sea into: 4 x (centre xyz, radius,
   *  depth, rim, drive, _). See the DENTS note in src/water-patch.ts — this is
   *  the same description, handed to the pass that has to agree with it. */
  dents?: Float32Array;
  /** The wake, as WAKE_SAMPLES x (world-space surface position, normalised age
   *  0..1). Water consumers normalise xyz; the land trail keeps its radius so a
   *  path in a valley cannot be projected through a neighbouring ridge.
   *
   *  The wake is drawn as a FIELD here rather than as swept geometry. Reference
   *  frames (reference/frames/snake/f06, f09) show one broad soft-edged white
   *  mass many body-widths across with no straight edge anywhere — three swept
   *  ribbons could not read like that however they were tuned, because their
   *  silhouette is a polygon. A per-pixel distance field has no silhouette, and
   *  it is also the shape of the reference's own deformation buffer: a field the
   *  surface queries, not a mesh laid on top of it. */
  wake: Float32Array;
}

/**
 * Replace space.wgsl's stub noise + land field with the real emitters.
 *
 * Anchored on FUNCTION SIGNATURES, not on marker comments. What `import
 * './space.wgsl'` hands back is the naga_oil-COMPOSED source: comments are
 * stripped and parameters are SSA-renamed (`x` becomes `x_1`), so a
 * `// @@MARKER@@` cannot survive to be found — the first attempt spliced
 * nothing, fell back to the stubs, and the ocean ran on `ps_hash(floor(x))`
 * with no interpolation, which painted flat axis-aligned squares over the sea.
 * It also ran on a stub land field that reports everything as water.
 *
 * The stubs are contiguous in the source, from `ps_hash` through `ps_landField`,
 * so one span replaces all four.
 */
function spliceSurfaceField(src: string): string {
  const a = src.indexOf('fn ps_hash(');
  const lf = src.indexOf('fn ps_landField(');
  const end = lf < 0 ? -1 : src.indexOf('\n}', lf);
  if (a < 0 || lf < 0 || end < 0 || lf < a) {
    console.warn('[planet-snake] space: stub anchors not found — ocean stays static');
    return src;
  }
  return `${src.slice(0, a)}${noiseModuleWgsl()}\n${landFieldWgsl()}\n${src.slice(end + 2)}`;
}

export function packSpaceParams(c: SpaceCamera): Uint8Array {
  const bytes = new ArrayBuffer(SPACE_PARAMS_BYTES);
  const f = new Float32Array(bytes);
  f[0] = c.right[0];   f[1] = c.right[1];   f[2] = c.right[2];   f[3] = c.tanHalfFov;
  f[4] = c.up[0];      f[5] = c.up[1];      f[6] = c.up[2];      f[7] = c.aspect;
  f[8] = c.forward[0]; f[9] = c.forward[1]; f[10] = c.forward[2]; f[11] = c.time;
  f[12] = c.sun[0];    f[13] = c.sun[1];    f[14] = c.sun[2];     f[15] = c.sunIntensity;
  f[16] = c.camPos[0]; f[17] = c.camPos[1]; f[18] = c.camPos[2];  f[19] = c.planetRadius;
  f[20] = c.atmosRadius; f[21] = c.near;    f[22] = c.far;        f[23] = c.waterLift;
  // Nine header vec4s, then dents, then the wake. All are packed by this game rather
  // than by the engine, so the offsets here and the struct in space.wgsl are
  // the same fact written twice — moving one without the other silently feeds
  // the wake the dents' memory, which renders as a wake that has snapped to
  // nowhere.
  f[24] = c.patch[0]; f[25] = c.patch[1]; f[26] = c.patch[2]; f[27] = c.patch[3];
  f[28] = c.sheetFade[0]; f[29] = c.sheetFade[1];
  // These were the two deliberate holes at the end of the original eight-vec4
  // header. The shared eclipse anchor adds vec4 nine, so dents now begin at 36.
  f[30] = c.eclipse; f[31] = c.eclipseElevation;
  f[32] = c.eclipseAnchor[0]; f[33] = c.eclipseAnchor[1]; f[34] = c.eclipseAnchor[2];
  if (c.dents) f.set(c.dents.subarray(0, 32), 36);
  f.set(c.wake.subarray(0, WAKE_SAMPLES * 4), 68);

  return new Uint8Array(bytes);
}

/**
 * Install the space background. Returns the entity carrying PostProcessParams so
 * the caller can push fresh camera basis vectors into it each frame, or
 * `undefined` when the host gave us no renderer (headless / editor probe).
 *
 * Registration is idempotent per page load: the shader registry rejects a
 * same-name re-register outright (ShaderRegistry.ts:363), which HMR would
 * otherwise trip on every save.
 */
let registered = false;

export function installSpaceBackground(
  renderer: Renderer | undefined,
  world: World,
  initial: SpaceCamera,
): EntityHandle | undefined {
  if (renderer === undefined) return undefined;

  const initialParams = packSpaceParams(initial);

  if (!registered) {
    registerPostProcess(renderer, SPACE_POSTPROCESS_ID, {
      // The noise + land field are SPLICED IN rather than duplicated: one
      // definition of the coastline, in surface.ts. space.wgsl carries stubs so
      // the build-time naga_oil validation passes (see the block there); this
      // swaps them for the real thing at registration.
      source: spliceSurfaceField(spaceShader.wgsl ?? spaceShader),
      reads: [{ key: 'sceneColor' }, { key: 'depth', sampleType: 'depth' }],
      params: { byteSize: SPACE_PARAMS_BYTES, defaultValue: initialParams },
    });
    registered = true;
  }

  const entity = world
    .spawn({ component: PostProcessParams, data: { shader: SPACE_POSTPROCESS_ID, data: initialParams } })
    .unwrap();

  const installed = installUrpPostProcessPipeline(renderer, [SPACE_POSTPROCESS_ID]);
  if (installed?.ok === false) {
    console.error('[planet-snake] space background installPipeline failed:', installed.error);
    return undefined;
  }
  return entity;
}

export function updateSpaceParams(world: World, entity: EntityHandle, c: SpaceCamera): void {
  world.set(entity, PostProcessParams, { shader: SPACE_POSTPROCESS_ID, data: packSpaceParams(c) });
}
