"""Lossless static spatial/material batching of the delivered living-city GLB.
Blender background only; no render. Does not decimate or touch source assets.
Retains named doors and markers; records every merged source object.
"""
import bpy, json, math, hashlib
from pathlib import Path
from mathutils import Vector

H = Path(__file__).resolve().parent
G = H.parents[1]
SOURCE = G / 'assets/living-city/district-lived.glb'
OUT = G / 'assets/performance'
OUT.mkdir(exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
groups = {}
mapping = {}
before = sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH')
for o in list(bpy.context.scene.objects):
    if o.type != 'MESH' or o.name.startswith('DOOR_'):
        continue
    source_name = o.name
    corners = [o.matrix_world @ Vector(c) for c in o.bound_box]
    cx, cy = [(min(p[i] for p in corners) + max(p[i] for p in corners)) / 2 for i in range(2)]
    cell = (math.floor(cx / 24), math.floor(cy / 24))
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='MATERIAL')
    bpy.ops.object.mode_set(mode='OBJECT')
    for part in list(bpy.context.selected_objects):
        used = {p.material_index for p in part.data.polygons}
        assert len(used) == 1, (part.name, used)
        material = part.data.materials[next(iter(used))]
        key = (*cell, material.name)
        groups.setdefault(key, []).append(part)
        mapping.setdefault(key, set()).add(source_name)

report = []
cells = {}
for (cx, cy, material), objects in sorted(groups.items()):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1: bpy.ops.object.join()
    o = bpy.context.object
    o.name = f'BATCH_{cx}_{cy}_{material}'
    o.data.name = o.name
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    report.append({'node': o.name, 'sources': sorted(mapping[(cx,cy,material)])})
    cells.setdefault((cx, cy), []).append(o)

# The pinned renderer resolves material schemas per mesh, not just per primitive.
# A cell must therefore be ONE multi-material mesh, not one mesh per material.
for (cx, cy), objects in sorted(cells.items()):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects: o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1: bpy.ops.object.join()
    o = bpy.context.object
    o.name = f'CELL_{cx}_{cy}'
    o.data.name = o.name

after = sum(len(o.data.polygons) for o in bpy.context.scene.objects if o.type == 'MESH')
assert before == after, (before, after)
for image in bpy.data.images:
    if image.source == 'FILE' and not image.packed_file: image.pack()
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(OUT / 'district-batched.glb'), export_format='GLB',
    export_apply=True, export_cameras=False, export_lights=False, export_extras=True,
    export_animations=False, export_yup=True, export_tangents=True)
bpy.ops.wm.save_as_mainfile(filepath=str(H / 'rain-alley-batched.blend'))
(H / 'batch-audit.json').write_text(json.dumps({
    'source': str(SOURCE.relative_to(G)), 'sourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
    'cellMeters': 24, 'polygonsBefore': before, 'polygonsAfter': after,
    'materialGroups': report, 'cells': [f'CELL_{x}_{y}' for x,y in sorted(cells)],
}, ensure_ascii=False, indent=2) + '\n')
print('BATCH_COMPLETE', before, after, 'material groups', len(report), 'cells', len(cells))
