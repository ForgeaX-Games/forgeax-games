#!/usr/bin/env python3
"""Bake the game's source prop GLBs into src/props-data.ts.

WHY BAKE INSTEAD OF IMPORT
--------------------------
The engine has a glTF importer, but it wants a `.glb.meta.json` sidecar with
minted GUIDs per sub-asset that `runImport` consumes rather than generates. The
Kenney inputs declare KHR_materials_unlit -- the same class of extension the old
head GLB had flagged as unsupported -- and every input is recoloured into this
planet's palette. The importer would therefore add a failure mode without
preserving a visual feature the game needs.

So: parse the GLB here, bake the node TRS, normalise, and emit the 8-float
interleaved form meshFromInterleaved already eats. Same path buildSurfaceMesh
uses.

Run:  python3 tools/bake-props.py tools/models
Sources live in tools/models/ and have mixed provenance. See its LICENSE.md.
"""
import base64
import glob
import json
import os
import struct
import sys

CT = {5120: ('b', 1), 5121: ('B', 1), 5122: ('h', 2), 5123: ('H', 2), 5125: ('I', 4), 5126: ('f', 4)}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}

# Role comes from each source GLB's MATERIAL NAME, not its colour. Kenney paints
# `dirt` (a boulder's body) and `woodBark` (a trunk) with the exact same
# orange-brown, so a colour-distance classifier cannot tell a rock from a tree
# and has to be told which category the model belongs to. The names are
# unambiguous and already carry the semantics we want.
ROLE_BY_MATERIAL = {
    'dirt': 'dirt',                # a boulder's earthy body
    'stone': 'stone',
    'grass': 'grass',              # the tuft sitting on a rock
    'leafsGreen': 'leaf',
    'leafsDark': 'leaf',
    'woodBark': 'bark',
    'woodBarkDark': 'bark',
    'colorRed': 'red',
    '_defaultMat': 'pale',         # small unpainted chips and mushroom stalks
}


def read_accessor(js, bin_, idx):
    acc = js['accessors'][idx]
    bv = js['bufferViews'][acc['bufferView']]
    fmt, sz = CT[acc['componentType']]
    n = NC[acc['type']]
    base = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    stride = bv.get('byteStride') or sz * n
    return [struct.unpack_from('<' + fmt * n, bin_, base + i * stride) for i in range(acc['count'])]


def node_matrix(js, ni):
    """Column-major 4x4 for a node's local TRS (these models have no parents)."""
    nd = js['nodes'][ni]
    if 'matrix' in nd:
        m = nd['matrix']
        return [m[0:4], m[4:8], m[8:12], m[12:16]]
    t = nd.get('translation', [0, 0, 0])
    x, y, z, w = nd.get('rotation', [0, 0, 0, 1])
    s = nd.get('scale', [1, 1, 1])
    rot = [[1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
           [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
           [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)]]
    M = [[rot[c][r] * s[c] for r in range(3)] + [0.0] for c in range(3)]
    M.append([t[0], t[1], t[2], 1.0])
    return M


def apply(M, v, isdir=False):
    x, y, z = v
    return (M[0][0] * x + M[1][0] * y + M[2][0] * z + (0 if isdir else M[3][0]),
            M[0][1] * x + M[1][1] * y + M[2][1] * z + (0 if isdir else M[3][1]),
            M[0][2] * x + M[1][2] * y + M[2][2] * z + (0 if isdir else M[3][2]))


def det3(M):
    a, b, c = M[0][:3], M[1][:3], M[2][:3]
    return (a[0] * (b[1] * c[2] - b[2] * c[1])
            - a[1] * (b[0] * c[2] - b[2] * c[0])
            + a[2] * (b[0] * c[1] - b[1] * c[0]))


POS_SCALE = 16384.0   # normalised coords stay inside +-1
# Collision follows the part of a prop the ground-hugging snake can actually
# reach, not a tree crown several body widths overhead. `size` scales the
# model's largest extent at spawn time: 0.14 of the smallest solid tree (4.4)
# is 0.62 world units, the snake body's radius. Larger trees sample slightly
# higher, conservatively including low branches instead of letting the head
# ghost through them.
LOW_FOOT_HEIGHT = 0.14


def main(srcdir, out):
    models = {}
    warnings = []
    for f in sorted(glob.glob(os.path.join(srcdir, '*.glb'))):
        name = os.path.basename(f)[:-4]
        with open(f, 'rb') as fh:
            fh.read(12)
            jlen, _ = struct.unpack('<II', fh.read(8))
            js = json.loads(fh.read(jlen))
            blen, _ = struct.unpack('<II', fh.read(8))
            bin_ = fh.read(blen)

        M = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]
        for ni, nd in enumerate(js.get('nodes', [])):
            if nd.get('mesh') == 0:
                M = node_matrix(js, ni)
                break
        # A mirrored node matrix reverses triangle winding, and the engine culls
        # back faces (frontFace ccw) -- the exact failure that turned the planet
        # inside out earlier. Detect it and flip rather than trust the kit.
        flip = det3(M) < 0
        if flip:
            warnings.append(f'{name}: mirrored node matrix, winding flipped')

        prims = []
        for p in js['meshes'][0]['primitives']:
            if p.get('mode', 4) != 4:
                warnings.append(f'{name}: non-triangle primitive mode {p.get("mode")}, skipped')
                continue
            # Compact each primitive down to the vertices it actually references.
            # This works whether a source shares position/normal accessors across
            # primitives or stores a separate accessor for each one.
            allpos = read_accessor(js, bin_, p['attributes']['POSITION'])
            allnrm = read_accessor(js, bin_, p['attributes']['NORMAL'])
            idx = [i[0] for i in read_accessor(js, bin_, p['indices'])]
            if flip:
                idx = [x for t in range(0, len(idx), 3) for x in (idx[t], idx[t + 2], idx[t + 1])]
            remap = {}
            pos, nrm, local = [], [], []
            for i in idx:
                if i not in remap:
                    remap[i] = len(pos)
                    pos.append(apply(M, allpos[i]))
                    nrm.append(apply(M, allnrm[i], True))
                local.append(remap[i])

            mat = js['materials'][p['material']] if 'material' in p else {}
            mname = mat.get('name', '')
            role = ROLE_BY_MATERIAL.get(mname)
            if role is None:
                role = 'pale'
                warnings.append(f'{name}: unmapped material "{mname}" -> pale')
            prims.append({'pos': pos, 'nrm': nrm, 'idx': local, 'role': role})
        models[name] = prims

    # Normalise so the LARGEST extent is 1, base at y=0, centred on XZ.
    #
    # Not height-1: this kit's rocks are grid tiles, wide and low (rock_largeA is
    # 1.02 across and 0.26 tall). Driving the scale off height made a boulder
    # four times wider than it was asked to be tall, and they rendered as pale
    # pancakes lying across the terrain. With max-extent normalisation one
    # `size` number means the same thing for a pine and for a boulder.
    #
    # Base-at-origin is the part that matters for placement: the model's own
    # origin IS its footing, so a prop sits on the ground with no per-model
    # offset to drift out of step with the terrain.
    packed = {}
    for name, prims in models.items():
        xs = [v[0] for p in prims for v in p['pos']]
        ys = [v[1] for p in prims for v in p['pos']]
        zs = [v[2] for p in prims for v in p['pos']]
        ymin = min(ys)
        cx, cz = (min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2
        span = max(max(xs) - min(xs), max(ys) - ymin, max(zs) - min(zs)) or 1.0
        # All in max-extent units: `foot` is the full horizontal half-extent,
        # `footLow` is the half-extent within the snake-height slice, and `top`
        # is the height. The full footprint still matters for seating a model
        # on sloped ground; only collision should ignore an overhead canopy.
        foot = max(max(abs(x - cx) for x in xs), max(abs(z - cz) for z in zs)) / span
        low_xz = [
            (v[0], v[2])
            for p in prims for v in p['pos']
            if v[1] - ymin <= span * LOW_FOOT_HEIGHT
        ]
        # Every model is based at y=0, but retain a defensive fallback so a
        # malformed future asset cannot silently become non-colliding.
        foot_low = (max(max(abs(x - cx), abs(z - cz)) for x, z in low_xz) / span
                    if low_xz else foot)
        top = (max(ys) - ymin) / span

        P, N, I, roles, counts = [], [], [], [], []
        for p in prims:
            base = len(P) // 3
            for v in p['pos']:
                P += [int(round((v[0] - cx) / span * POS_SCALE)),
                      int(round((v[1] - ymin) / span * POS_SCALE)),
                      int(round((v[2] - cz) / span * POS_SCALE))]
            for v in p['nrm']:
                l = (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) ** 0.5 or 1.0
                N += [max(-127, min(127, int(round(v[0] / l * 127)))),
                      max(-127, min(127, int(round(v[1] / l * 127)))),
                      max(-127, min(127, int(round(v[2] / l * 127))))]
            I += [base + i for i in p['idx']]
            roles.append(p['role'])
            counts.append([len(p['pos']), len(p['idx'])])

        assert max(I) < 65536, f'{name}: index overflow'
        assert all(-32768 <= v < 32768 for v in P), f'{name}: position overflow'
        packed[name] = {
            'foot': round(foot, 4),
            'footLow': round(foot_low, 4),
            'top': round(top, 4),
            'roles': roles,
            'counts': counts,
            'p': base64.b64encode(struct.pack('<%dh' % len(P), *P)).decode(),
            'n': base64.b64encode(struct.pack('<%db' % len(N), *N)).decode(),
            'i': base64.b64encode(struct.pack('<%dH' % len(I), *I)).decode(),
        }

    body = json.dumps(packed, separators=(',', ':'))
    ts = f'''// GENERATED by tools/bake-props.py -- do not edit by hand.
//
// Source prop models with per-file provenance documented in
// tools/models/LICENSE.md, parsed and packed here so the runtime neither fetches
// nor imports anything: positions Int16 at 1/{int(POS_SCALE)} of the model's
// largest extent,
// normals Int8, indices Uint16, all base64.
//
// Each model is normalised so its LARGEST extent is 1, its base sits at y=0 and
// it is centred on XZ. So one `size` number scales a pine and a boulder alike,
// and a prop's origin IS its footing -- placement needs no per-model offset.
// `foot` is the full horizontal half-extent, `footLow` the half-extent below
// {LOW_FOOT_HEIGHT:.2f} model units (the ground-level collision slice), and
// `top` the height, all in those same units. Collision derives from `footLow`;
// `foot` remains authoritative for visual seating on slopes.
//
// `roles` names our material per primitive, taken from each GLB's MATERIAL NAME
// rather than its colour -- `dirt` (a boulder) and `woodBark` (a trunk) are
// painted the identical orange-brown, so colour cannot tell them apart. Nothing
// here carries colour: the original Kenney palette would fight this planet's
// palette, so main.ts assigns every material.

export const PROP_DATA = {body} as const;

export type PropName = keyof typeof PROP_DATA;
'''
    with open(out, 'w') as fh:
        fh.write(ts)

    nv = sum(sum(c[0] for c in m['counts']) for m in packed.values())
    nt = sum(sum(c[1] for c in m['counts']) for m in packed.values()) // 3
    print(f'{len(packed)} models, {nv} verts, {nt} tris -> {out} ({os.path.getsize(out)} bytes)')
    for m, d in sorted(packed.items()):
        print(f'  {m:30s} foot={d["foot"]:.3f} footLow={d["footLow"]:.3f} '
              f'top={d["top"]:.3f} roles={d["roles"]}')
    if warnings:
        print('\nwarnings:')
        for w in warnings:
            print('  ' + w)
    else:
        print('\nno warnings')


if __name__ == '__main__':
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), 'models')
    dst = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), '..', 'src', 'props-data.ts')
    main(src, os.path.normpath(dst))
