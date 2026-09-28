import bpy,json,struct,hashlib
from pathlib import Path
from mathutils import Vector
G=Path(__file__).resolve().parents[2];out=[]
for p in (G/'assets/living-city').glob('*.glb'):
 b=p.read_bytes();j=json.loads(b[20:20+struct.unpack_from('<I',b,12)[0]])
 primitives=[p for m in j['meshes'] for p in m['primitives']]
 assert all('baseColorTexture' in m.get('pbrMetallicRoughness',{}) for m in j['materials']), 'Untextured material'
 if p.name=='district-lived.glb':assert all('TANGENT' in p['attributes'] for p in primitives), 'Missing PBR tangents'
 out.append({'primitives':len(primitives),'tangentPrimitives':sum('TANGENT' in p['attributes'] for p in primitives),'asset':p.name,'bytes':len(b),'triangles':sum(j['accessors'][p['indices']]['count']//3 for m in j['meshes'] for p in m['primitives']),'materials':len(j['materials']),'texturedMaterials':sum('baseColorTexture' in m.get('pbrMetallicRoughness',{}) for m in j['materials']),'sha256':hashlib.sha256(b).hexdigest()})
maxHeight=max((o.matrix_world@Vector(c)).z for o in bpy.context.scene.objects if o.type=='MESH' and o.location.x<45 for c in o.bound_box)
j={'assets':out,'blenderObjects':len(bpy.context.scene.objects),'fileImages':len([im for im in bpy.data.images if im.source=='FILE']),'unpackedImages':[im.name for im in bpy.data.images if im.source=='FILE' and not im.packed_file],'missingPixels':[im.name for im in bpy.data.images if im.source=='FILE' and (im.size[0]==0 or im.size[1]==0)],'maximumCityHeight':maxHeight}
assert maxHeight<=12;assert not j['unpackedImages'];assert not j['missingPixels'];assert next(a for a in out if a['asset']=='district-lived.glb')['triangles']<=450000
(G/'docs/fps/evidence/living-city/asset-audit.json').write_text(json.dumps(j,indent=2));print('AUDIT',len(out),'GLBs; height',maxHeight,'packed',j['fileImages'])
