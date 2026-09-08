// Surface props — real modelled rocks, trees, bushes and mushrooms.
//
// WHY THESE ARE BAKED AND NOT IMPORTED
//
// The engine has a glTF importer, but it consumes a `.glb.meta.json` sidecar
// with minted per-sub-asset GUIDs that `runImport` does not generate. The
// Kenney inputs declare KHR_materials_unlit — the same class of extension the
// head GLB had listed under `unsupportedExtensions`, which came back
// colourless. Every input is recoloured into this planet's palette anyway, so
// the importer would buy nothing but a failure mode.
//
// So tools/bake-props.py parses the GLBs offline and emits props-data.ts in the
// 8-float interleaved form `meshFromInterleaved` already eats — the same path
// buildSurfaceMesh takes. Nothing is fetched and nothing is imported at runtime.
//
// WHAT THE BAKE GUARANTEES, AND WHY IT MATTERS HERE
//
// Every model is normalised so its LARGEST extent is 1, its base sits at y=0
// and it is centred on XZ. The base-at-origin part is the fix for the
// floating-props round: a prop's origin IS its footing, so placement is
// `pos = dir * groundRadius(dir)` with no per-model magic offset to drift out
// of step with the terrain.
//
// Largest-extent rather than height, because this kit's rocks are grid tiles —
// wide and low (rock_largeA is 1.02 across and 0.26 tall). Scaling those by
// height made them four times wider than they were asked to be tall, and they
// rendered as pale pancakes lying across the terrain. Normalised this way one
// `size` number means the same thing for a pine and for a boulder.
//
// Models have mixed provenance; see tools/models/LICENSE.md.

import { PROP_DATA } from './props-data';

/** Which of our materials a primitive takes. Derived at bake time from each
 *  source GLB's MATERIAL NAME — `dirt` and `woodBark` are painted the identical brown,
 *  so colour cannot separate a boulder from a trunk. See tools/bake-props.py. */
export type PropRole = 'dirt' | 'stone' | 'grass' | 'leaf' | 'bark' | 'red' | 'pale';

export type PropName = keyof typeof PROP_DATA;

export interface PropPrim {
  role: PropRole;
  /** Shared-ref handle for the primitive's MeshAsset. */
  mesh: number;
}

export interface PropModel {
  /** Horizontal half-extent, in units of the model's largest extent. */
  footprint: number;
  /** Horizontal half-extent of the ground-level, snake-height slice. Unlike
   *  `footprint`, this excludes a tree's overhead crown. */
  footLow: number;
  /** Height, in the same units. `size` scales the largest extent, so a wide
   *  boulder's height is `size * top` while a pine's is just `size`. */
  top: number;
  prims: PropPrim[];
}

/** Positions are Int16 at this many units per model extent. */
const POS_SCALE = 16384;

function bytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Decode every model and register one MeshAsset per primitive.
 *
 * One mesh per primitive rather than one per model, because a primitive is
 * exactly the granularity at which a source model changes material — trunk vs canopy,
 * boulder vs the grass cap on top of it — and MeshRenderer takes materials per
 * submesh only for meshes that declare submeshes, which meshFromInterleaved
 * does not. Splitting keeps the material assignment honest at the cost of one
 * extra entity per prop, which is what the old stacked-cone tree already spent.
 */
/**
 * Wrap a model onto the planet as it is built.
 *
 * A prop is authored flat: its base is a plane at y=0. That is fine for a rock
 * two units across, and wrong for anything wide enough to notice the curve —
 * the dark gate spans about 24 degrees of arc, so its outer feet stood over a
 * unit clear of the ground while its middle sat on it, and the exposed footing
 * read (correctly) as a model floating over the terrain.
 *
 * `sx` / `sy` are the world units one model unit becomes horizontally and
 * vertically once the entity's scale is applied — the bend has to be baked in
 * the same anisotropy it will be drawn with, or a laterally stretched prop
 * bends by the wrong angle.
 */
export interface PropBend { R: number; sx: number; sy: number }

export function loadProps(
  // biome-ignore lint/suspicious/noExplicitAny: engine World
  world: any,
  // biome-ignore lint/suspicious/noExplicitAny: engine geometry helper
  meshFromInterleaved: any,
  bend?: Partial<Record<PropName, PropBend>>,
): Record<PropName, PropModel> {
  const out = {} as Record<PropName, PropModel>;

  for (const name of Object.keys(PROP_DATA) as PropName[]) {
    const d = PROP_DATA[name] as {
      foot: number; footLow: number; top: number;
      roles: readonly string[];
      counts: readonly (readonly number[])[];
      p: string; n: string; i: string;
    };
    // Fresh Uint8Arrays from atob start at byte 0 of their own buffer, so these
    // views are always correctly aligned.
    const pos = new Int16Array(bytes(d.p).buffer);
    const nrm = new Int8Array(bytes(d.n).buffer);
    const idx = new Uint16Array(bytes(d.i).buffer);

    const prims: PropPrim[] = [];
    let vOff = 0;
    let iOff = 0;
    for (let k = 0; k < d.roles.length; k++) {
      const vc = d.counts[k]![0]!;
      const ic = d.counts[k]![1]!;
      const verts = new Float32Array(vc * 8);
      for (let v = 0; v < vc; v++) {
        const s = (vOff + v) * 3;
        const o = v * 8;
        let x = pos[s]! / POS_SCALE;
        let y = pos[s + 1]! / POS_SCALE;
        let z = pos[s + 2]! / POS_SCALE;
        let nx = nrm[s]! / 127, ny = nrm[s + 1]! / 127, nz = nrm[s + 2]! / 127;
        const bd = bend?.[name];
        if (bd !== undefined) {
          // Model space -> the world offsets this vertex will actually occupy.
          const wx = x * bd.sx, wy = y * bd.sy, wz = z * bd.sx;
          const h = Math.hypot(wx, wz);
          if (h > 1e-6) {
            // Walk `h` along the surface instead of straight out from the
            // tangent plane: the foot follows the ground, the top leans in.
            const ang = h / bd.R;
            const rr = bd.R + wy;
            const ca = Math.cos(ang), sa = Math.sin(ang);
            const k = (rr * sa) / h;
            x = (wx * k) / bd.sx;
            z = (wz * k) / bd.sx;
            y = (rr * ca - bd.R) / bd.sy;
            // Same rotation on the normal, about the axis perpendicular to the
            // (outward, up) plane. Skipping this leaves the outer pillars lit
            // as if they were still vertical.
            const ux = wx / h, uz = wz / h;
            const ndotu = nx * ux + nz * uz;
            const nOut = ndotu * ca - ny * sa;
            const nUp = ndotu * sa + ny * ca;
            nx += ux * (nOut - ndotu);
            nz += uz * (nOut - ndotu);
            ny = nUp;
          }
        }
        verts[o] = x; verts[o + 1] = y; verts[o + 2] = z;
        verts[o + 3] = nx; verts[o + 4] = ny; verts[o + 5] = nz;
        // A planar top-down UV. The Kenney TEXCOORD_0 data is a palette lookup,
        // while generated inputs are also rendered without source textures.
        // Nothing here samples a texture; this exists only so the tangent frame
        // is real rather than the degenerate-triangle fallback.
        verts[o + 6] = x + 0.5; verts[o + 7] = z + 0.5;
      }
      // Indices were emitted against the model's concatenated vertex array;
      // rebase them onto this primitive's own.
      const ind = new Uint16Array(ic);
      for (let t = 0; t < ic; t++) ind[t] = idx[iOff + t]! - vOff;

      prims.push({
        role: d.roles[k] as PropRole,
        mesh: world.allocSharedRef('MeshAsset', meshFromInterleaved(verts, ind)) as number,
      });
      vOff += vc;
      iOff += ic;
    }
    out[name] = { footprint: d.foot, footLow: d.footLow, top: d.top, prims };
  }
  return out;
}
