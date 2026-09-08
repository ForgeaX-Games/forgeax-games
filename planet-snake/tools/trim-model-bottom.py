"""Remove isolated geometry confined to a model's bottom band.

Usage (inside Blender):
  Blender -b -P tools/trim-model-bottom.py -- in.glb out.glb [band_fraction]

Text-to-3D exports sometimes add a disconnected display plinth.  A raw Z cut
can open the wanted mesh, so this keeps every connected component that rises
above the bottom band and deletes only components wholly contained inside it.
The operation is opt-in and intentionally happens before cloud2prop's voxel
remesh, which then closes any microscopic seams left by the source asset.
"""
from __future__ import annotations

import sys

import bmesh
import bpy


argv = sys.argv[sys.argv.index("--") + 1:]
src, dst = argv[0], argv[1]
band_fraction = float(argv[2]) if len(argv) > 2 else 0.06
if not 0.0 < band_fraction < 0.5:
    raise SystemExit("band_fraction must be between 0 and 0.5")

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
if not meshes:
    raise SystemExit("no mesh in glb")
for o in bpy.context.scene.objects:
    o.select_set(o.type == "MESH")
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

bm = bmesh.new()
bm.from_mesh(obj.data)
bm.verts.ensure_lookup_table()
z_min = min(v.co.z for v in bm.verts)
z_max = max(v.co.z for v in bm.verts)
cutoff = z_min + (z_max - z_min) * band_fraction

seen: set[int] = set()
drop = []
dropped_components = 0
kept_components = 0
for seed in bm.verts:
    if seed.index in seen:
        continue
    stack = [seed]
    seen.add(seed.index)
    component = []
    component_max_z = seed.co.z
    while stack:
        cur = stack.pop()
        component.append(cur)
        component_max_z = max(component_max_z, cur.co.z)
        for edge in cur.link_edges:
            nxt = edge.other_vert(cur)
            if nxt.index not in seen:
                seen.add(nxt.index)
                stack.append(nxt)
    if component_max_z <= cutoff:
        drop.extend(component)
        dropped_components += 1
    else:
        kept_components += 1

before = len(bm.verts)
bmesh.ops.delete(bm, geom=drop, context="VERTS")
bm.to_mesh(obj.data)
bm.free()
obj.data.update()

print(
    "[trim-model-bottom] "
    f"band={band_fraction:.3f} cutoff={cutoff:.6f} "
    f"components dropped={dropped_components} kept={kept_components} "
    f"vertices {before}->{len(obj.data.vertices)}"
)
bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format="GLB",
    use_selection=False,
    export_materials="EXPORT",
    export_yup=True,
)
