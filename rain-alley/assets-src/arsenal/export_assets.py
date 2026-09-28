"""Run with Blender --background <shipping.blend> --python export_assets.py.
Exports only root asset assemblies from the opened shipping file. Keeps canonical names.
"""
from pathlib import Path
import bpy
output = Path(__file__).resolve().parents[2] / 'assets' / 'arsenal'
allowed = {'car15','type56','mp5','uzi','hipower','model10','m16','minimi','sks','l96','m870','spas12','lookout','enforcer','boss'}
scene = bpy.context.scene
for root in [o for o in scene.objects if o.parent is None and o.name in allowed]:
    saved = root.location.copy()
    root.location = (0, 0, 0)
    bpy.ops.object.select_all(action='DESELECT')
    root.select_set(True)
    for obj in root.children_recursive:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(
        filepath=str(output / f'{root.name}.glb'), export_format='GLB',
        use_selection=True, use_active_scene=True, export_apply=True,
        export_cameras=False, export_lights=False, export_extras=True,
        export_animations=False, export_yup=True, export_tangents=True,
    )
    root.location = saved
    print('EXPORTED', root.name)
