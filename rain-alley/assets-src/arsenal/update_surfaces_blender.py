"""Update material nodes in the existing arsenal assembly, preserving every object."""
from pathlib import Path
import bpy,json,hashlib
here=Path(__file__).resolve().parent;recipes=json.loads((here/'surface-audit.json').read_text())['recipes']
def sig():
 h=hashlib.sha256()
 for o in sorted(bpy.context.scene.objects,key=lambda o:o.name):
  h.update(repr((o.name,tuple(v for row in o.matrix_world for v in row))).encode())
  if o.type=='MESH':h.update(repr(([tuple(v.co) for v in o.data.vertices],[tuple(p.vertices) for p in o.data.polygons])).encode())
 return h.hexdigest()
before=sig();changed=[]
for name,(family,color,metal) in recipes.items():
 m=bpy.data.materials.get(name)
 if not m:continue
 m.use_nodes=True;n=m.node_tree.nodes;l=m.node_tree.links;p=next(n for n in n if n.type=='BSDF_PRINCIPLED')
 for node in list(n):
  if node.name.startswith('Storm_'):n.remove(node)
 def image(kind):
  node=n.new('ShaderNodeTexImage');node.name='Storm_'+kind;node.image=bpy.data.images.load(str(here/'textures'/f'{family}-{kind}.png'),check_existing=True);node.image.colorspace_settings.name='sRGB' if kind=='base' else 'Non-Color';node.image.pack();return node
 base=image('base');mix=n.new('ShaderNodeMix');mix.name='Storm_Color';mix.data_type='RGBA';mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[7].default_value=color;l.new(base.outputs['Color'],mix.inputs[6]);l.new(mix.outputs[2],p.inputs['Base Color'])
 orm=image('orm');sep=n.new('ShaderNodeSeparateColor');sep.name='Storm_ORM';l.new(orm.outputs['Color'],sep.inputs['Color']);l.new(sep.outputs['Green'],p.inputs['Roughness']);p.inputs['Metallic'].default_value=metal
 normal=image('normal');bump=n.new('ShaderNodeNormalMap');bump.name='Storm_Normal';bump.inputs['Strength'].default_value=.8;l.new(normal.outputs['Color'],bump.inputs['Color']);l.new(bump.outputs['Normal'],p.inputs['Normal']);changed.append(name)
assert sig()==before
bpy.ops.wm.save_as_mainfile(filepath=str(here/'rain-alley-arsenal.blend'))
(here/'surface-blender-audit.json').write_text(json.dumps(dict(geometryBefore=before,geometryAfter=sig(),changedMaterials=changed),indent=2)+'\n')
print('ARSENAL_SURFACES_SAVED',len(changed))
