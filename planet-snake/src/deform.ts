// Ground you can actually dig.
//
// the reference's spells all write into a terrain STATE BUFFER — Sweep ploughs a
// channel and throws berms, Bloom blows a crater with a raised rim — and their
// note on why is the one that matters: "the channel is not a decal chased after
// the fact. Each frame the live crest writes brushes into the terrain state
// buffer at the position the mesh is actually drawing, so the mark and the wave
// cannot disagree."
//
// We could not do that, and the reason is worth writing down because it decides
// the whole shape of this file.
//
// WHY NOT JUST DEFORM THE TERRAIN
//
// The planet's surface is one mesh built from a 340 x 224 lattice — 76,725
// vertices, 614k floats. `updateMesh` takes the whole buffer, so deforming the
// terrain directly means rebuilding and re-uploading 2.4 MB every frame that
// anything is digging. The water sheet, which this game already rebuilds every
// frame without trouble, is 64 x 64.
//
// A PATCH OVER THE TERRAIN WAS TRIED FIRST, AND IT CANNOT WORK
//
// The obvious cheap answer is a small mesh that follows the snake and draws
// base terrain plus the delta, riding a hair above the real surface. It was
// built, it uploaded cleanly — 84 meshes, zero failures, real world-space
// vertices — and it changed 0.00% of the pixels on screen.
//
// Because a hole goes DOWN. The patch inside a crater sits below the terrain
// mesh, and the terrain mesh has not moved, so it is simply in front. You
// cannot show a hole in a surface that is still being drawn over it. A patch
// can add berms and can never dig, which is half of every stroke in this file.
//
// SO: DEFORM THE REAL MESH, AND ONLY WHILE SOMETHING IS DIGGING
//
// Two pieces.
//
//   the STORE   a coarse height-delta lattice over the whole sphere. Brushes
//               write here. It is the memory: a channel you ploughed is still
//               there when you swim back, and it costs 1.2 MB once.
//   the SKIN    the planet's own 341 x 225 vertex buffer, rewritten in place
//               over the cells the store has touched and pushed with
//               updateMesh.
//
// The upload is the whole 3.7 MB buffer because updateMesh takes the whole
// buffer, and that is the reason this only runs while a stroke is LIVE: a
// channel is cut over about two seconds and is then static forever. The CPU
// side is bounded much harder than the upload — only the touched rectangle of
// vertices is recomputed, which for a channel is a few hundred out of 76,725.

import type { Renderer } from '@forgeax/engine-render';
import { updateMesh, updateMeshVertexRange } from './engine-bridge';

export type V3 = [number, number, number];

/** Store resolution. Longitude x latitude. */
const SW = 768;
const SH = 384;

/** Patch resolution and half-extent in radians — set from the world extent by
 *  the caller, because a bigger planet must not silently coarsen it. */
const PW = 128;

export interface DeformStore {
  /**
   * Add a stroke.
   *
   * `depth` sinks the ground, `berm` raises a ring outside it — the mass has to
   * go somewhere and that is where. `yaw` and `aspect` stretch the brush along
   * a direction, which is what makes a channel continuous rather than a row of
   * round pits.
   */
  brush(
    dir: V3, radius: number, depth: number, berm: number,
    along?: V3, aspect?: number,
  ): void;
  /** Height delta at a unit direction, bilinear. */
  at(d: V3): number;
  /** Everything back to flat (restart). */
  clear(): void;
  /** True once anything has been written. */
  readonly dirty: boolean;
  /**
   * The lattice rectangle written since the last call, in TERRAIN lattice
   * indices, or undefined if nothing was. Clears the record.
   *
   * The consumer rewrites the planet's vertex buffer, and the whole reason this
   * is bounded is that a stroke touches a few hundred vertices out of 76,725.
   * Handing back "something changed" without saying WHERE would make every
   * flush a full rebuild.
   */
  takeDirtyRect(): { i0: number; i1: number; j0: number; j1: number } | undefined;
}

export function createDeformStore(
  planetRadius: number,
  /** Terrain lattice size, so a stroke can report which of ITS cells moved. */
  terrainWs = 340,
  terrainHs = 224,
): DeformStore {
  const data = new Float32Array(SW * SH);
  let touched = false;
  let dI0 = 1e9, dI1 = -1e9, dJ0 = 1e9, dJ1 = -1e9;

  /** Unit direction of store cell (i, j). Same parametrisation as the terrain
   *  lattice, so the two agree cell for cell. */
  const cellDir = (i: number, j: number, out: V3): void => {
    const u = (i / SW) * Math.PI * 2;
    const v = ((j + 0.5) / SH) * Math.PI;
    const sv = Math.sin(v);
    out[0] = Math.cos(u) * sv;
    out[1] = Math.cos(v);
    out[2] = Math.sin(u) * sv;
  };

  const scratch: V3 = [0, 0, 1];

  return {
    get dirty() { return touched; },

    takeDirtyRect() {
      if (dI1 < dI0) return undefined;
      const r = { i0: dI0, i1: dI1, j0: dJ0, j1: dJ1 };
      dI0 = 1e9; dI1 = -1e9; dJ0 = 1e9; dJ1 = -1e9;
      return r;
    },

    brush(dir, radius, depth, berm, along, aspect = 1) {
      if (radius <= 0 || (depth === 0 && berm === 0)) return;
      touched = true;
      // Record the TERRAIN lattice cells this stroke can reach. Same
      // parametrisation as buildHeightLattice: i over longitude, j over polar
      // angle, and the longitude span widens toward the poles.
      {
        const angR = (radius * 2.1) / planetRadius;
        const pol = Math.acos(Math.min(1, Math.max(-1, dir[1])));
        const tj0 = Math.max(0, Math.floor(((pol - angR) / Math.PI) * terrainHs) - 1);
        const tj1 = Math.min(terrainHs, Math.ceil(((pol + angR) / Math.PI) * terrainHs) + 1);
        const sv = Math.max(1e-3, Math.sin(pol));
        const span = Math.ceil(((angR / sv) / (Math.PI * 2)) * terrainWs) + 2;
        const ic = Math.round(
          ((Math.atan2(dir[2], dir[0]) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * terrainWs,
        );
        if (tj0 < dJ0) dJ0 = tj0;
        if (tj1 > dJ1) dJ1 = tj1;
        if (ic - span < dI0) dI0 = ic - span;
        if (ic + span > dI1) dI1 = ic + span;
      }
      // Angular radius, plus the berm's reach outside it.
      const angR = (radius * 1.9) / planetRadius;
      // Latitude band. j runs 0..SH over 0..PI of polar angle.
      const v0 = Math.acos(Math.min(1, Math.max(-1, dir[1]))) - angR;
      const v1 = Math.acos(Math.min(1, Math.max(-1, dir[1]))) + angR;
      const j0 = Math.max(0, Math.floor((v0 / Math.PI) * SH));
      const j1 = Math.min(SH - 1, Math.ceil((v1 / Math.PI) * SH));

      // Along-axis for the stretch, projected into the tangent plane.
      let ax = 0, ay = 0, az = 0;
      if (along && aspect !== 1) {
        ax = along[0]; ay = along[1]; az = along[2];
        const d0 = ax * dir[0] + ay * dir[1] + az * dir[2];
        ax -= dir[0] * d0; ay -= dir[1] * d0; az -= dir[2] * d0;
        const al = Math.hypot(ax, ay, az) || 1;
        ax /= al; ay /= al; az /= al;
      }

      for (let j = j0; j <= j1; j++) {
        // Longitude span widens toward the poles — a fixed i-range would write
        // a band that pinches to nothing at the top of the sphere.
        const v = ((j + 0.5) / SH) * Math.PI;
        const sv = Math.max(1e-3, Math.sin(v));
        const iSpan = Math.ceil(((angR / sv) / (Math.PI * 2)) * SW) + 1;
        const iC = Math.round(
          ((Math.atan2(dir[2], dir[0]) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * SW,
        );
        for (let n = -iSpan; n <= iSpan; n++) {
          const i = ((iC + n) % SW + SW) % SW;
          cellDir(i, j, scratch);
          // Great-circle distance, in world units.
          const c = Math.min(1, Math.max(-1,
            scratch[0] * dir[0] + scratch[1] * dir[1] + scratch[2] * dir[2]));
          let dist = Math.acos(c) * planetRadius;
          if (aspect !== 1 && (ax !== 0 || ay !== 0 || az !== 0)) {
            // Squash the measured distance ALONG the axis, which stretches the
            // stroke along it. A channel has to be one long dent, not beads.
            let ox = scratch[0] - dir[0] * c;
            let oy = scratch[1] - dir[1] * c;
            let oz = scratch[2] - dir[2] * c;
            const ol = Math.hypot(ox, oy, oz);
            if (ol > 1e-6) {
              ox /= ol; oy /= ol; oz /= ol;
              const alongF = Math.abs(ox * ax + oy * ay + oz * az);
              dist *= 1 - alongF * (1 - 1 / aspect);
            }
          }
          if (dist > radius * 1.9) continue;
          const q = dist / radius;
          // The hole: a flat-ish floor and a fast shoulder. A boot compresses a
          // floor, it does not dimple.
          const hole = q < 1 ? 1 - q * q * q : 0;
          // The rim, just outside it.
          const rq = (q - 1.22) / 0.42;
          const rim = Math.exp(-rq * rq);
          const k = j * SW + i;
          data[k] = (data[k] ?? 0) - hole * depth + rim * berm;
        }
      }
    },

    at(d) {
      const len = Math.hypot(d[0], d[1], d[2]) || 1;
      const y = Math.max(-1, Math.min(1, d[1] / len));
      const v = Math.acos(y) / Math.PI;
      let u = Math.atan2(d[2] / len, d[0] / len) / (Math.PI * 2);
      if (u < 0) u += 1;
      const fi = u * SW;
      const fj = Math.max(0, Math.min(SH - 1e-6, v * SH - 0.5));
      const i0 = Math.floor(fi) % SW;
      const i1 = (i0 + 1) % SW;
      const j0 = Math.floor(fj);
      const j1 = Math.min(SH - 1, j0 + 1);
      const a = fi - Math.floor(fi);
      const b = fj - j0;
      const h00 = data[j0 * SW + i0]!, h10 = data[j0 * SW + i1]!;
      const h01 = data[j1 * SW + i0]!, h11 = data[j1 * SW + i1]!;
      return (h00 * (1 - a) + h10 * a) * (1 - b) + (h01 * (1 - a) + h11 * a) * b;
    },

    clear() {
      data.fill(0);
      touched = false;
      // Report the WHOLE lattice as dirty so the consumer re-flattens the mesh
      // rather than leaving the last run's trenches on screen.
      dI0 = 0; dI1 = terrainWs; dJ0 = 0; dJ1 = terrainHs;
    },
  };
}

// ── the skin: NOT LANDED ────────────────────────────────────────────────────
//
// WRITE-BACK IS UNSOLVED. Everything above this line works and is measured: a
// Sweep cuts troughs of -1.6 world units and berms of +0.2 into the store, and
// `at()` reads them back. What does not work is handing the result to the
// planet's mesh.
//
// What was tried, and what each one proved:
//
//   a PATCH laid over the terrain    Uploaded cleanly — 84 meshes, zero
//                                    failures, real world-space vertices — and
//                                    changed 0.00% of the pixels. Because a
//                                    hole goes DOWN, and the terrain mesh that
//                                    is still drawn over it has not moved. A
//                                    patch can add berms and can never dig.
//   rewriting the REAL mesh, 12      A rebuild that is arithmetically identical
//   floats per vertex                to buildSurfaceMesh, with the store empty,
//                                    still changed 41% of the screen: flat
//                                    sheets and a dark lattice flung across the
//                                    sky. That is a stride/layout mismatch, not
//                                    a maths error — the zero-deformation test
//                                    is what proved it, and it is the test to
//                                    start from next time.
//   the same at 8 floats             40%. So it is not simply 12-vs-8 either.
//
// The next thing to find out is what layout `updateMesh` actually wants back
// for a mesh seeded through `meshFromInterleaved` with Uint32 indices — the
// swept tubes in this game all use Uint16 and 12 floats and work, so the
// difference is in there somewhere. Until then this is not wired into the
// update loop and `terrainHeight` does not read the store, because a world that
// believes in channels it cannot draw is worse than a flat one.

import type { World } from '@forgeax/engine-ecs';

/** Floats per vertex: position(3) + normal(3) + uv(2) + tangent(4).
 *
 *  This was briefly set to 8 while chasing the mangled planet, on a guess that
 *  the mesh wanted back the same 8-float interleave it was seeded from. The
 *  guess was wrong and the 8 was never reverted, so every push after that was a
 *  buffer of the wrong stride — 613,800 floats where the engine expects
 *  920,700. Caught by diffing this buffer against the engine's own expansion of
 *  the same source, which is the check to run first next time and not fifth. */
const FPV = 12;

export interface DeformSkin {
  /** Push whatever the store has changed since the last call. Cheap no-op when
   *  nothing has. */
  flush(): void;
  /** Rebuild and push the WHOLE mesh with whatever the store currently holds.
   *  With an empty store this must be a no-op ON SCREEN — if it is not, the
   *  rebuild does not reproduce the mesh it is replacing, and no amount of
   *  digging on top of it will look right. */
  rebuildAll(): void;
  debug(): {
    pushes: number;
    fails: number;
    lastErr: string;
    cells: number;
    sent: number;
    transport: 'engine-owned';
  };
  /** Build and upload the complete terrain buffer before live strokes begin. */
  prime(): void;
  /** Keep CPU deformation active while suppressing its GPU upload. */
  mute(on: boolean): boolean;
  /** The live vertex buffer, for diffing against a known-good expansion. */
  peek(): Float32Array | undefined;
}

/**
 * Rewrite the planet's surface mesh from a height lattice plus the store.
 *
 * `latticeDirAt` and `baseHeightAt` must be the SAME functions the mesh was
 * built from, or the first flush silently re-lands every vertex somewhere
 * slightly else and the whole planet shivers.
 */
export function createDeformSkin(
  renderer: Renderer | undefined,
  meshHandle: number,
  indices: Uint16Array,
  ws: number,
  hs: number,
  latticeDirAt: (i: number, j: number, out: V3) => void,
  baseHeightAt: (i: number, j: number) => number,
  baseRadius: number,
  store: DeformStore,
): DeformSkin {
  const N = ws + 1;
  const vCount = N * (hs + 1);
  const verts = new Float32Array(vCount * FPV);
  const R = new Float32Array(vCount);
  const D = new Float32Array(vCount * 3);
  let built = false;
  let pushes = 0;
  /** Frames since the last upload, so a live stroke does not push 3.7 MB every
   *  single frame. */
  let sincePush = 99;
  /** CPU buffer has changes the GPU has not seen. */
  let dirtyPush = false;
  /** Debug: skip the upload, keep the CPU work. */
  let muted = false;
  /** Vertices in the last upload — the direct read on how much bus it cost. */
  let pushedRows = 0;
  let fails = 0;
  let lastErr = '';
  let cellsTouched = 0;

  const d: V3 = [0, 0, 1];

  /** Radius at vertex k, base + whatever has been dug there. */
  const radiusAt = (i: number, j: number, k: number): number => {
    latticeDirAt(i, j, d);
    D[k * 3] = d[0]; D[k * 3 + 1] = d[1]; D[k * 3 + 2] = d[2];
    return baseRadius + baseHeightAt(i, j) + store.at(d);
  };

  const writeVertex = (i: number, j: number): void => {
    const k = j * N + i;
    const o = k * FPV;
    const r = R[k]!;
    const dx = D[k * 3]!, dy = D[k * 3 + 1]!, dz = D[k * 3 + 2]!;
    verts[o] = dx * r; verts[o + 1] = dy * r; verts[o + 2] = dz * r;
    // Normal from the neighbours' world positions. A displaced surface whose
    // normals stay radial reads as a texture no matter how far it moved, and a
    // channel is nothing BUT its walls catching the light.
    const kL = j * N + Math.max(0, i - 1);
    const kR = j * N + Math.min(N - 1, i + 1);
    const kD = Math.max(0, j - 1) * N + i;
    const kU = Math.min(hs, j + 1) * N + i;
    const lx = D[kR * 3]! * R[kR]! - D[kL * 3]! * R[kL]!;
    const ly = D[kR * 3 + 1]! * R[kR]! - D[kL * 3 + 1]! * R[kL]!;
    const lz = D[kR * 3 + 2]! * R[kR]! - D[kL * 3 + 2]! * R[kL]!;
    const mx = D[kU * 3]! * R[kU]! - D[kD * 3]! * R[kD]!;
    const my = D[kU * 3 + 1]! * R[kU]! - D[kD * 3 + 1]! * R[kD]!;
    const mz = D[kU * 3 + 2]! * R[kU]! - D[kD * 3 + 2]! * R[kD]!;
    let nx = ly * mz - lz * my;
    let ny = lz * mx - lx * mz;
    let nz = lx * my - ly * mx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;
    if (nx * dx + ny * dy + nz * dz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    verts[o + 3] = nx; verts[o + 4] = ny; verts[o + 5] = nz;
    verts[o + 6] = i / ws;
    verts[o + 7] = j / hs;
    const tl = Math.hypot(lx, ly, lz) || 1;
    verts[o + 8] = lx / tl; verts[o + 9] = ly / tl; verts[o + 10] = lz / tl;
    verts[o + 11] = 1;
  };

  // Index-format ownership stays in the engine. The synced local engine fork
  // preserves each resident mesh's uint16/uint32 format during updateMesh, so
  // this game no longer reaches into meshGpuHandles to repair private state.
  /** Rows whose vertices the GPU has not seen yet, or -1 for "none". A row
   *  range is all we need to remember: the buffer is row-major in latitude, so
   *  any run of whole rows is a CONTIGUOUS byte range, and unioning two of them
   *  can only ever over-send rows that are already correct. */
  let pj0 = -1, pj1 = -1;

  /** Whole buffer, indices and all. Boot and rebuilds only. */
  const push = (): void => {
    try {
      if (!updateMesh(renderer, meshHandle, verts, indices)) {
        lastErr = 'no updateMesh';
        return;
      }
      pushes++;
      pj0 = pj1 = -1;
    } catch (e) { fails++; lastErr = String((e as Error)?.message ?? e); }
  };

  /**
   * Just the dirty rows.
   *
   * This is the whole reason a Sweep is free now. `updateMesh` sends 3.7 MB
   * whatever moved, and measured against a run with the upload muted and every
   * other path left running, that cost nothing on the median frame and +10.5 ms
   * on the 90th percentile — 23 frames over 33 ms where the muted run had none.
   * A crest touches on the order of four rows, which is about 150 KB.
   *
   * Falls back to the whole buffer if the engine in front of us has no range
   * path, so the game still runs against a stock build.
   */
  const pushRows = (): void => {
    if (pj0 < 0) return;
    const first = pj0 * N;
    const count = (pj1 - pj0 + 1) * N;
    try {
      if (!updateMeshVertexRange(renderer, meshHandle, verts, first, count)) { push(); return; }
      pushes++;
      pushedRows = count;
      pj0 = pj1 = -1;
    } catch (e) { fails++; lastErr = String((e as Error)?.message ?? e); }
  };


  return {
    debug() {
      return { pushes, fails, lastErr, cells: cellsTouched, sent: pushedRows, transport: 'engine-owned' as const };
    },

    /** Suppress the GPU upload while leaving every CPU path running. The only
     *  way to attribute a frame-time spike to the upload rather than to the
     *  work that produced it. */
    mute(on: boolean) { muted = on; return muted; },

    peek() { return built ? verts : undefined; },

    rebuildAll() {
      built = true;
      for (let j = 0; j <= hs; j++) {
        for (let i = 0; i <= ws; i++) R[j * N + i] = radiusAt(i, j, j * N + i);
      }
      for (let j = 0; j <= hs; j++) for (let i = 0; i <= ws; i++) writeVertex(i, j);
      cellsTouched = vCount;
      push();
    },

    /** Build the full buffer ONCE, at a moment of the caller's choosing.
     *
     *  Without this the first dig of a run pays for 76,725 vertices AND a 3.7 MB
     *  upload inside the frame a skill fires, which is the worst possible frame
     *  to spend it in. Called at boot instead, where nobody is looking. */
    prime() {
      // NOT early-return-if-built: a restart calls this after clearing the
      // store, and the whole point is to push the flattened planet back.
      built = true;
      for (let j = 0; j <= hs; j++) {
        for (let i = 0; i <= ws; i++) R[j * N + i] = radiusAt(i, j, j * N + i);
      }
      for (let j = 0; j <= hs; j++) for (let i = 0; i <= ws; i++) writeVertex(i, j);
      cellsTouched = vCount;
      push();
    },

    flush() {
      const rect = store.takeDirtyRect();
      sincePush++;
      // THE CPU WORK AND THE UPLOAD ARE THROTTLED SEPARATELY, and binding them
      // together is what made a Sweep still cost frames after the first attempt
      // at this.
      //
      // The upload is a FIXED 3.7 MB whatever changed, because updateMesh takes
      // the whole buffer — so it wants to happen rarely. The CPU rewrite is
      // proportional to the dirty rect — so it wants the rect to stay SMALL.
      // The first version skipped both on the same counter, which meant the
      // skipped frames' rects were unioned into one, and a crest seventeen units
      // wide travelling for two seconds grows that union monotonically: by the
      // end each flush was recomputing a band tens of thousands of vertices
      // across, in one frame.
      //
      // So: rewrite the fresh rect EVERY frame (small, bounded by how far the
      // wave moved since the last one), and let only the push wait.
      if (rect !== undefined) {
        if (!built) {
          built = true;
          for (let jj = 0; jj <= hs; jj++) {
            for (let ii = 0; ii <= ws; ii++) R[jj * N + ii] = radiusAt(ii, jj, jj * N + ii);
          }
          for (let jj = 0; jj <= hs; jj++) for (let ii = 0; ii <= ws; ii++) writeVertex(ii, jj);
          cellsTouched = vCount;
          push();
          sincePush = 0;
          dirtyPush = false;
          return;
        }
        // Only the touched band, plus one ring so the neighbour-difference
        // normals on its edge are right.
        const j0 = Math.max(0, rect.j0 - 1), j1 = Math.min(hs, rect.j1 + 1);
        const i0 = rect.i0 - 1, i1 = rect.i1 + 1;
        // LONGITUDE WRAPS MODULO `ws`, NOT `N`.
        //
        // There are N = ws + 1 columns but only ws distinct meridians: column
        // ws sits at u = 2*PI, which is column 0 again, duplicated so the mesh
        // can close with continuous UVs. Wrapping by N therefore sends ii = -1
        // to column ws — the same meridian as column 0 — instead of to ws - 1,
        // and the westmost column the brush actually dug is left holding the
        // height it had before the stroke. One stale column is a cliff a single
        // cell wide running down a meridian, and meridians converge, so near a
        // pole it draws as a hard flat wedge with its point at the axis. That
        // is exactly what a crater dug on the seam produced.
        const wrap = (ii: number): number => ((ii % ws) + ws) % ws;
        let n = 0;
        for (let jj = j0; jj <= j1; jj++) {
          for (let ii = i0; ii <= i1; ii++) {
            const k = jj * N + wrap(ii);
            R[k] = radiusAt(wrap(ii), jj, k);
            n++;
          }
          // The duplicate. `wrap` never yields it, and it has to carry column
          // 0's height or the seam itself becomes the cliff.
          const kd = jj * N + ws;
          R[kd] = radiusAt(ws, jj, kd);
        }
        for (let jj = j0; jj <= j1; jj++) {
          for (let ii = i0; ii <= i1; ii++) writeVertex(wrap(ii), jj);
          writeVertex(ws, jj);
        }
        cellsTouched = n;
        pj0 = pj0 < 0 ? j0 : Math.min(pj0, j0);
        pj1 = pj1 < 0 ? j1 : Math.max(pj1, j1);
        dirtyPush = true;
      }
      // The buffer is now correct on the CPU; the GPU can catch up on its own
      // schedule. Three frames at 50 fps is 60 ms of lag on a channel the wave
      // takes two seconds to cut — invisible, and a third of the bus traffic.
      if (muted || !dirtyPush || sincePush < 3) return;
      sincePush = 0;
      dirtyPush = false;
      pushRows();

    },
  };
}
