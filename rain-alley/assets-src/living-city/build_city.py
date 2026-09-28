"""Derive living-city assets from shipping GLB. Blender background, no Cycles.
Coordinates below are Blender Z-up; exporter converts to game Y-up.
Original GLB/Blend never overwritten. Source images are all packed.
"""
import bpy,math,json,random,hashlib
from pathlib import Path
from mathutils import Vector
H=Path(__file__).resolve().parent;G=H.parents[1];OUT=G/'assets/living-city';OUT.mkdir(exist_ok=True)
rng=random.Random(19900909)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(G/'assets/weather/district-rain.glb'))
original=list(bpy.context.scene.objects);original_names={o.name for o in original};materials={};created=[];colliders=[]
def mat(name):
 if name in materials:return materials[name]
 m=bpy.data.materials.new('LC_'+name);m.use_nodes=True;nodes=m.node_tree.nodes;links=m.node_tree.links;p=nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(1,1,1,1)
 def tex(kind):
  t=nodes.new('ShaderNodeTexImage');t.image=bpy.data.images.load(str(H/'textures'/f'{name}-{kind}.png'),check_existing=True);t.image.colorspace_settings.name='sRGB' if kind=='base' else 'Non-Color';t.image.pack();return t
 links.new(tex('base').outputs['Color'],p.inputs['Base Color'])
 if (H/'textures'/f'{name}-orm.png').exists():
  t=tex('orm');sep=nodes.new('ShaderNodeSeparateColor');links.new(t.outputs['Color'],sep.inputs['Color']);links.new(sep.outputs['Green'],p.inputs['Roughness']);links.new(sep.outputs['Blue'],p.inputs['Metallic'])
  t=tex('normal');normal=nodes.new('ShaderNodeNormalMap');normal.inputs['Strength'].default_value=.65;links.new(t.outputs['Color'],normal.inputs['Color']);links.new(normal.outputs['Normal'],p.inputs['Normal'])
 else:p.inputs['Roughness'].default_value=.95
 materials[name]=m;return m

def box(name,loc,size,material='iron',bevel=0):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.name=name;o.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat(material));created.append(o)
 if bevel:
  mod=o.modifiers.new('Worn edge','BEVEL');mod.width=bevel;mod.segments=1;bpy.ops.object.modifier_apply(modifier=mod.name)
 return o

def rod(name,a,b,r=.015,material='iron',vertices=8):
 v=Vector(b)-Vector(a);bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=v.length,location=(Vector(a)+Vector(b))/2);o=bpy.context.object;o.name=name;o.rotation_euler=v.to_track_quat('Z','Y').to_euler();o.data.materials.append(mat(material));created.append(o);return o

def ellipsoid(name,loc,scale,material):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=12,ring_count=6,location=loc);o=bpy.context.object;o.name=name;o.scale=scale;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);o.data.materials.append(mat(material));created.append(o);return o

def mesh(name,verts,faces,material):
 bpy.ops.object.select_all(action='DESELECT')
 m=bpy.data.meshes.new(name);m.from_pydata(verts,[],faces);m.update();o=bpy.data.objects.new(name,m);bpy.context.collection.objects.link(o);o.data.materials.append(mat(material));created.append(o)
 bpy.context.view_layer.objects.active=o;o.select_set(True);bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT');bpy.ops.uv.smart_project(island_margin=.02);bpy.ops.object.mode_set(mode='OBJECT');o.select_set(False);return o

def thicken(o):
 bpy.context.view_layer.objects.active=o
 mod=o.modifiers.new('Physical front and back','SOLIDIFY');mod.thickness=.004;mod.offset=0;bpy.ops.object.modifier_apply(modifier=mod.name)

def join(obs,name):
 obs=[o for o in obs if o.name in bpy.data.objects]
 if not obs:return None
 bpy.ops.object.select_all(action='DESELECT')
 for o in obs:o.select_set(True)
 bpy.context.view_layer.objects.active=obs[0];bpy.ops.object.join();o=bpy.context.object;o.name=name;return o

def collider(name,loc,size):
 colliders.append({'name':name,'center':[loc[0],loc[2],-loc[1]],'size':[size[0],size[2],size[1]],'blocksSight':True})

def bounds(o):
 pts=[o.matrix_world@Vector(c) for c in o.bound_box];return [min(p[i] for p in pts) for i in range(3)],[max(p[i] for p in pts) for i in range(3)]
# Height changes affect only upper storeys; store/door ground dimensions stay fixed.
heights={'01':6.4,'02':10.9,'03':6.8,'04':11.6,'06':7.4,'07':8.1,'08':6.2,'09':7.0,'11':8.3,'12':6.6,'13':7.2,'14':5.6,'15':9.1,'17':7.1,'18':5.3,'19':10.8,'20':6.0}
heightAudit=[]
for o in original:
 if not o.name.startswith('BLD_Block_') or o.type!='MESH':continue
 key=o.name.split('_')[2]
 if key not in heights:continue
 lo,hi=bounds(o);height=heights[key];inv=o.matrix_world.inverted();o.data=o.data.copy()
 for v in o.data.vertices:
  p=o.matrix_world@v.co
  if p.z>3.55:p.z=3.55+(p.z-3.55)*(height-3.55)/(hi[2]-3.55)
  v.co=inv@p
 heightAudit.append({'name':o.name,'old':hi[2],'height':height})
# Open iron doors occupy the same thin planes as existing door collision proxies.
for o in [o for o in original if o.name.startswith('DOOR_') and o.type=='MESH']:
 lo,hi=bounds(o);name=o.name;x0,x1=lo[0],hi[0];y=(lo[1]+hi[1])/2;z0,z1=lo[2],hi[2];parts=[];start=len(created)
 bpy.data.objects.remove(o,do_unlink=True)
 box(name+'_kickplate',((x0+x1)/2,y,z0+.23),(x1-x0,.07,.46),'iron',.012)
 for x in [x0+.025,x1-.025]:rod('Gate stile',(x,y,z0),(x,y,z1),.025)
 for z in [z0+.47,z0+1.23,z1-.02]:rod('Gate rail',(x0,y,z),(x1,y,z),.022)
 for i in range(max(4,int((x1-x0)/.16))):
  x=x0+.1+i*.16
  rod('Grille',(x,y,z0+.45),(x,y,z1),.009)
  if x+.16<x1:rod('Diagonal',(x,y,z0+.65),(x+.16,y,z0+1.2),.011)
 rod('Handle',(x1-.12,y-.07,z0+.95),(x1-.12,y-.07,z0+1.2),.02)
 join(created[start:],name)
# Shop entrance decor: local tangent along Blender Y, surface normal along X.
shops=[('Pawn',-4.43,12,1.4),('Tea',3.58,31.5,1.8),('Grocery',12.43,53.5,1.6),('Kitchen',30.43,52,1.4)]
for name,x,y,w in shops:
 start=len(created)
 for side,label in [(-1,'couplet-left'),(1,'couplet-right')]:
  yy=y+side*(w/2+.13)
  # Explicit full-face UV so text stays legible.
  mesh('Paper_'+name,[(x,yy-.09,.65),(x,yy+.09,.65),(x,yy+.09,2.45),(x,yy-.09,2.45)],[(0,1,2,3)],label)
  o=created[-1]
  for loop,uv in zip(o.data.uv_layers.active.data,[(0,0),(1,0),(1,1),(0,1)]):loop.uv=uv
  thicken(o)
  # tied-back fabric: narrow at middle, never closes the passage
  verts=[]
  for j in range(9):
   z=.65+j*.25;width=.09 if j in (3,4) else .16
   for k in range(5):verts.append((x+.045*math.sin(k*math.pi),y+side*(w/2-.02-k*width/4),z))
  mesh('TiedCurtain_'+name,verts,[(j*5+k,j*5+k+1,(j+1)*5+k+1,(j+1)*5+k) for j in range(8) for k in range(4)],'cloth')
  thicken(created[-1])
  rod('Curtain tie',(x+.02,y+side*(w/2-.2),1.5),(x+.02,y+side*w/2,1.5),.014,'cloth')
 box('Meter box',(x,y+w/2+.4,1.85),(.16,.28,.4),'iron',.015)
 for dz in [.1,.24]:box('Meter face',(x+(.085 if x<10 else -.085),y+w/2+.4,1.75+dz),(.014,.17,.075),'plaster')
 join(created[start:],'LC_Entrance_'+name)
# Damaged mortar/plaster, chipped masonry and bent eave edges along principal fronts.
fronts=[(-4.45,5,8),(4.42,5,8),(4.43,15,7),(-4.4,22,9),(12.43,25,8),(12.43,35,8),(3.55,60,6),(29.58,61,7)]
for idx,(x,y,length) in enumerate(fronts):
 start=len(created);sign=-1 if x>5 else 1
 for j in range(8):
  yy=y+rng.uniform(-length/2,length/2);zz=rng.uniform(.6,2.7);rad=rng.uniform(.18,.5)
  vertices=[(x+sign*.025,yy,zz)]+[(x+sign*.03,yy+math.cos(k*math.tau/9)*rad*rng.uniform(.7,1),zz+math.sin(k*math.tau/9)*rad*rng.uniform(.7,1)) for k in range(9)]
  mesh('Missing plaster',vertices,[(0,k+1,(k+1)%9+1) for k in range(9)],'brick')
  for k in range(3):box('Exposed brick',(x+sign*.07,yy+(k-1)*.15,zz-.2),(.12,.14,.085),'brick',.014)
 for j in range(14):
  yy=y-length/2+j*length/14;zz=3.0+rng.uniform(-.14,.03)
  o=box('Broken eave',(x+sign*.15,yy,zz),(.4,length/15,.13),'plaster',.045);o.rotation_euler[1]=rng.uniform(-.08,.08)
  if j%3==0:rod('Exposed rebar',(x,yy,3.02),(x+sign*.43,yy+.08,2.84),.008)
 join(created[start:],f'LC_Damage_{idx:02}')
# Two stair flights and an upper gallery; tread rises .15m, width 1.5m.
start=len(created)
for yy,top in [(1.4,.18),(1.7,.35),(18.3,.35),(18.6,.18)]:
 box('Approach tread',(2.25,yy,top/2),(1.5,.3,top),'iron',.012);collider('LC_APPROACH_'+str(yy),(2.25,yy,top/2),(1.5,.3,top))
for flight in range(2):
 for i in range(20):
  yy=2+(i+.5)*.3 if flight==0 else 12+(i+.5)*.3;top=.35+(i+1)*.15 if flight==0 else 3.35-i*.15
  box('Stair tread',(2.25,yy,top-.065),(1.5,.30,.13),'iron',.012)
  # solid thin steps, lower empty volume stays walkable where clearance permits
  collider(f'LC_STEP_{flight}_{i}',(2.25,yy,top-.075),(1.5,.30,.15))
  for xx in [1.5,3.0]:
   if i%4==0:rod('Rail upright',(xx,yy,top),(xx,yy,top+1),.023)
 for xx in [1.5,3.0]:
  a=(xx,2,1.5) if flight==0 else (xx,12,4.35);b=(xx,8,4.35) if flight==0 else (xx,18,1.5)
  rod('Stair handrail',a,b,.026)
box('Upper gallery',(2.25,10,3.26),(1.5,4,.18),'iron',.02);collider('LC_GALLERY',(2.25,10,3.26),(1.5,4,.18))
for xx in [1.48,3.02]:
 for yy in [8.1,9.3,10.7,11.9]:rod('Gallery post',(xx,yy,3.35),(xx,yy,4.35),.026)
 rod('Gallery rail',(xx,8,4.35),(xx,12,4.35),.028)
 # leave ladder access opening on inner edge
 if xx<2:collider('LC_RAIL_A',(xx,8.55,3.85),(.08,1.1,1));collider('LC_RAIL_B',(xx,11.5,3.85),(.08,1,1))
 else:collider('LC_RAIL_OUT',(xx,10,3.85),(.08,4,1))
 for yy in [8,12]:rod('Steel supports',(xx,yy,.0),(xx,yy,3.25),.055)
for yy in [9.65,10.35]:rod('Ladder rail',(1.35,yy,.1),(1.35,yy,4.05),.028)
for i in range(13):rod('Ladder rung',(1.35,9.65,.3+i*.27),(1.35,10.35,.3+i*.27),.023)
join(created[start:],'LC_WalkableGallery')
# Local rubbish clusters with tilted bins, loose lids, sacks, bottles and scraps.
for idx,(x,y) in enumerate([(-3.55,4.6),(3.7,18.7),(4.1,35.5),(-12.8,47.3),(12,58.6),(30,60.2),(20,66.1)]):
 start=len(created)
 o=rod('Overturned bin',(x-.25,y,.68),(x+.48,y+.24,.5),.31,'iron',16)
 rod('Loose lid',(x+.75,y+.1,.4),(x+.75,y+.1,.43),.34,'iron',16)
 for i in range(5):ellipsoid('Refuse sack',(x+rng.uniform(-.7,.7),y+rng.uniform(-.65,.65),.49),(rng.uniform(.12,.25),.18,.17),'trash')
 for i in range(16):
  xx=x+rng.uniform(-.85,.85);yy=y+rng.uniform(-.85,.85)
  if i%3==0:rod('Discarded bottle',(xx,yy,.41),(xx+.18,yy+.05,.42),.034,'iron')
  else:
   o=box('Paper litter',(xx,yy,.372),(.13,.2,.006),'cloth');o.rotation_euler[2]=rng.random()*math.tau
 join(created[start:],f'LC_Refuse_{idx}')
# Small roof structures reinforce scale variation, staying below 12m.
for idx,key in enumerate(['01','03','08','12','14','18']):
 o=next(o for o in bpy.context.scene.objects if o.name.startswith('BLD_Block_'+key+'_'));lo,hi=bounds(o);start=len(created);x=(lo[0]+hi[0])/2;y=(lo[1]+hi[1])/2;z=hi[2]
 box('Roof service shed',(x,y,z+.55),(min(2.5,hi[0]-lo[0]-.3),1.8,1.1),'plaster',.045)
 for k in range(3):box('Corrugated shed roof',(x,y-.65+k*.65,z+1.14),(2.65,.7,.07),'iron',.015)
 rod('Rooftop water tank',(x+1,y,z+.1),(x+1,y,z+.95),.36,'iron',12)
 join(created[start:],'LC_Rooftop_'+key)
# Export the full derived district, only scene meshes/markers. No animal parking objects yet.
city=[o for o in bpy.context.scene.objects]
def export(objects,name):
 bpy.ops.object.select_all(action='DESELECT')
 for o in objects:
  if o.type=='MESH':
   o.data.name=o.name
   if any(len(p.vertices)>3 for p in o.data.polygons):
    bpy.context.view_layer.objects.active=o
    mod=o.modifiers.new('Export triangles for tangent basis','TRIANGULATE');bpy.ops.object.modifier_apply(modifier=mod.name)
  o.select_set(True)
 bpy.context.view_layer.objects.active=objects[0]
 bpy.ops.export_scene.gltf(filepath=str(OUT/(name+'.glb')),export_format='GLB',use_selection=True,export_apply=True,export_cameras=False,export_lights=False,export_extras=True,export_animations=False,export_yup=True,export_tangents=True)
export(city,'district-lived')
# Ambient animals are separate articulated GLBs with role names for inexpensive TS posing.
animals=[]
for animal in ['crow','rat','roach']:
 start=len(created)
 if animal=='crow':
  ellipsoid('crow__BODY',(0,0,.0),(.08,.19,.09),'feather');ellipsoid('crow__HEAD',(0,-.17,.07),(.07,.065,.06),'feather');rod('crow_beak',(0,-.21,.06),(0,-.32,.035),.026,'iron',6)
  for side in [-1,1]:
   wing=mesh('crow__WING_'+('L' if side<0 else 'R'),[(side*.05,0,0),(side*.32,-.08,.025),(side*.53,.16,0),(side*.25,.19,-.02)],[(0,1,2),(0,2,3)],'feather')
   for v in wing.data.vertices:v.co.x-=side*.05
   wing.location.x=side*.05
  mesh('crow_tail',[(-.06,.12,0),(.06,.12,0),(.09,.36,-.02),(-.09,.36,-.02)],[(0,1,2,3)],'feather')
 elif animal=='rat':
  ellipsoid('rat__BODY',(0,0,.1),(.075,.16,.07),'fur');ellipsoid('rat__HEAD',(0,-.16,.105),(.054,.076,.05),'fur');rod('rat_tail',(0,.11,.07),(.06,.39,.025),.012,'fur')
  for side in [-1,1]:
   ellipsoid('rat_ear',(side*.048,-.15,.16),(.026,.012,.028),'fur')
   for y in [-.08,.08]:ellipsoid('rat_foot',(side*.065,y,.035),(.02,.047,.02),'fur')
 else:
  ellipsoid('roach__BODY',(0,0,.016),(.018,.035,.012),'roach')
  for side in [-1,1]:
   for y in [-.02,0,.02]:rod('roach_leg',(side*.01,y,.015),(side*.035,y+.012,.005),.002,'roach',5)
   rod('roach_feeler',(side*.005,-.025,.02),(side*.018,-.075,.012),.0015,'roach',5)
 obs=created[start:]
 if animal=='crow':
  wings=[o for o in obs if 'WING_' in o.name];body=join([o for o in obs if o not in wings],'crow__BODY');obs=[body]+wings
 else:
  body=join(obs,animal+'__BODY');obs=[body]
 export(obs,animal);animals.extend(obs)
 for o in obs:o.location.x+=60
# Simple enemy-held weapon assets (no first-person hands), authored in real dimensions.
for kind in ['pistol','cleaver']:
 start=len(created)
 if kind=='pistol':
  box('weapon__BODY',(0,-.06,0),(.045,.2,.045),'iron',.006);o=box('Grip',(0,.0,-.065),(.042,.065,.105),'trash',.006);o.rotation_euler[0]=.25;rod('Muzzle',(0,-.16,0),(0,-.19,0),.013,'iron')
 else:
  box('weapon__BODY',(0,-.13,0),(.012,.21,.085),'iron',.009);box('Grip',(0,.04,0),(.028,.12,.033),'fur',.005)
 obs=created[start:];join(obs,'gear__BODY');obs=[bpy.context.object];export(obs,kind)
 for o in obs:o.location.x+=62
for im in bpy.data.images:
 if im.source=='FILE' and not im.packed_file:im.pack()
bpy.ops.wm.save_as_mainfile(filepath=str(H/'rain-alley-lived.blend'))
(H/'layout.json').write_text(json.dumps({'heightOverrides':heights,'heights':heightAudit,'colliders':colliders,'gallery':{'entry':[2.25,.9,-1.6],'top':[2.25,4.2,-10],'exit':[2.25,.9,-18.5]},'ladder':{'bottom':[1.0,.9,-10],'top':[2.25,4.2,-10]}},indent=2))
print('LIVED_ASSETS_READY',len(city),len(colliders))
