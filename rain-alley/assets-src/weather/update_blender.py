"""Run with the original district .blend; changes material nodes only, saves a new file."""
from pathlib import Path
import bpy, json, hashlib
HERE=Path(__file__).resolve().parent
report=json.loads((HERE/'material-audit.json').read_text())
def signature():
 h=hashlib.sha256()
 for o in sorted(bpy.context.scene.objects,key=lambda x:x.name):
  h.update(o.name.encode());h.update(str(tuple(v for row in o.matrix_world for v in row)).encode())
  if o.type=='MESH':
   h.update(str([(tuple(v.co)) for v in o.data.vertices]).encode());h.update(str([tuple(p.vertices) for p in o.data.polygons]).encode())
 return h.hexdigest()
before=signature(); changed=[]
for name,recipe in report['recipes'].items():
 mat=bpy.data.materials.get(name)
 if mat is None:continue
 mat.use_nodes=True;n=mat.node_tree.nodes;l=mat.node_tree.links
 p=next(x for x in n if x.type=='BSDF_PRINCIPLED')
 def image(kind):
  tex=n.new('ShaderNodeTexImage');tex.name='Rain_'+kind
  tex.image=bpy.data.images.load(str(HERE/'textures'/f"{recipe['family']}-{kind}.png"),check_existing=True)
  tex.image.colorspace_settings.name='sRGB' if kind=='base' else 'Non-Color';tex.image.pack();return tex
 if recipe['family']=='asphalt':p.inputs['Base Color'].default_value=(.065,.075,.085,1)
 if not recipe['keepBase']:
  tex=image('base');mix=n.new('ShaderNodeMix');mix.data_type='RGBA';mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1
  mix.inputs[7].default_value=p.inputs['Base Color'].default_value[:];l.new(tex.outputs['Color'],mix.inputs[6]);l.new(mix.outputs[2],p.inputs['Base Color'])
 orm=image('orm');sep=n.new('ShaderNodeSeparateColor');l.new(orm.outputs['Color'],sep.inputs['Color']);l.new(sep.outputs['Green'],p.inputs['Roughness']);p.inputs['Metallic'].default_value=0
 group=bpy.data.node_groups.get('glTF Material Output')
 if group is None:
  group=bpy.data.node_groups.new('glTF Material Output','ShaderNodeTree');group.interface.new_socket(name='Occlusion',in_out='INPUT',socket_type='NodeSocketFloat')
 occ=n.new('ShaderNodeGroup');occ.node_tree=group;l.new(sep.outputs['Red'],occ.inputs['Occlusion'])
 if not p.inputs['Normal'].is_linked or recipe['family'] in ('asphalt','paving'):
  tex=image('normal');normal=n.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.7;l.new(tex.outputs['Color'],normal.inputs['Color']);l.new(normal.outputs['Normal'],p.inputs['Normal'])
 changed.append(name)
for name,color in {'FluorescentWarmWhite':(1,.65,.28,1),'NeonCyan':(.03,.55,.85,1),'NeonWarmRed':(.85,.045,.012,1)}.items():
 m=bpy.data.materials.get(name)
 if m and m.use_nodes:
  p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED');p.inputs['Emission Color'].default_value=color;p.inputs['Emission Strength'].default_value=1
m=bpy.data.materials.get('WarmWindow')
if m and m.use_nodes:
 p=next(n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
 if p.inputs['Base Color'].is_linked:m.node_tree.links.new(p.inputs['Base Color'].links[0].from_socket,p.inputs['Emission Color'])
 p.inputs['Emission Strength'].default_value=.25
assert before==signature()
for image in bpy.data.images:
 if image.source=='FILE' and not image.packed_file:image.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(HERE/'rain-alley-district-rain.blend'))
(HERE/'blender-audit.json').write_text(json.dumps({'geometryAndTransformsBefore':before,'geometryAndTransformsAfter':signature(),'changedMaterials':changed,'source':'assets-src/district/rain-alley-district.blend','output':'assets-src/weather/rain-alley-district-rain.blend'},indent=2)+'\n')
print('RAIN_MATERIALS_SAVED',len(changed))
