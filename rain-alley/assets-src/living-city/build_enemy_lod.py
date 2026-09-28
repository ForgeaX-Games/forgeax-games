"""Derive preloaded 3-part animation LODs. Same geometry/materials, fewer submissions.
Near models remain untouched. Legs retain authored pivots; torso/arms use an aiming pose.
"""
import bpy, math
from pathlib import Path
H=Path(__file__).resolve().parent;G=H.parents[1];OUT=G/'assets/performance'
for kind in ['lookout','enforcer','boss']:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(G/'assets/arsenal'/f'{kind}.glb'))
    # Match game's arm/forearm aim offsets before merging the upper body.
    # Exported glTF is Y-up; this scene is Blender Z-up. Import restores the
    # authored local joint basis, so local X rotations remain the same.
    for o in bpy.context.scene.objects:
        if o.name.endswith('__ARM_R'):
            o.rotation_mode='XYZ';o.rotation_euler=(-2.14,0,0)
        if o.name.endswith('__FOREARM_R'):
            o.rotation_mode='XYZ';o.rotation_euler=(.8,0,0)
    bpy.context.view_layer.update()
    parts=[o for o in bpy.context.scene.objects if o.type=='MESH' and not o.name.endswith(('__LEG_L','__LEG_R'))]
    # Joining flattens the source hierarchy. Preserve every world transform first.
    for o in list(bpy.context.scene.objects):
        matrix=o.matrix_world.copy();o.parent=None;o.matrix_world=matrix
    bpy.ops.object.select_all(action='DESELECT')
    for o in parts:o.select_set(True)
    bpy.context.view_layer.objects.active=next(o for o in parts if o.name.endswith('__BODY'))
    bpy.ops.object.join();body=bpy.context.object;body.name=f'{kind}_lod__BODY'
    for o in bpy.context.scene.objects:
        if o.type=='MESH':o.data.name=o.name
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(OUT/f'{kind}-lod.glb'),export_format='GLB',export_apply=True,
        export_cameras=False,export_lights=False,export_animations=False,export_yup=True,export_tangents=True)
    for im in bpy.data.images:
        if im.source=='FILE' and not im.packed_file:im.pack()
    bpy.ops.wm.save_as_mainfile(filepath=str(H/f'{kind}-lod.blend'))
    print('ENEMY_LOD',kind,len([o for o in bpy.context.scene.objects if o.type=='MESH']))
