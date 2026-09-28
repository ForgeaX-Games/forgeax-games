"""Add portable PBR maps to the existing district; preserve all geometry bytes."""
from pathlib import Path
import copy, hashlib, json, struct
import numpy as np
from PIL import Image
ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets/weather'
MAPS = Path(__file__).parent / 'textures'
MAPS.mkdir(exist_ok=True)
source = ROOT / 'assets/district/district.glb'
b = source.read_bytes(); n = struct.unpack_from('<I', b, 12)[0]
j = json.loads(b[20:20+n]); before = copy.deepcopy(j)
original_bin = b[28+n:]; payload = bytearray(original_bin)
rng = np.random.default_rng(1709); size=512
y,x = np.mgrid[0:size,0:size] / size
noise=rng.random((size,size))
# Periodic fields avoid seams on the existing tiled UVs.
def periodic_noise(cells):
 grid=rng.random((cells,cells));xx=x*cells;yy=y*cells
 ix=xx.astype(int);iy=yy.astype(int);fx=xx-ix;fy=yy-iy
 fx=fx*fx*(3-2*fx);fy=fy*fy*(3-2*fy)
 return (grid[iy,ix]*(1-fx)+grid[iy,(ix+1)%cells]*fx)*(1-fy)+(grid[(iy+1)%cells,ix]*(1-fx)+grid[(iy+1)%cells,(ix+1)%cells]*fx)*fy
macro=.65*periodic_noise(5)+.25*periodic_noise(13)+.10*periodic_noise(31)
fine=.55*noise+.45*macro
families={
 'concrete': ['AgedConcreteTrim','PlasterIvory','BrickBrown'],
 'paint': ['PaintBlue','PaintOchre','PlasticBlue','PlasticRed'],
 'paving': ['WetPaving'], 'asphalt':['WetAsphalt'],
 'vinyl':['BoothVinyl'], 'glass':['OpaqueWindowGlass'],
 'ceramic':['CeramicIvory','BottleGreen','BottleAmber'],
 'recess':['DarkRecess'],
 'lamp':['FluorescentWarmWhite','NeonCyan','NeonWarmRed'],
}
recipes={}
for family,names in families.items():
 height=.012*fine; rough=.60+.25*fine; shade=.75+.22*fine; ao=np.ones_like(x)
 if family in ('asphalt','paving'):
  puddle=np.clip((macro-.27)*8,0,1)
  height=.010*fine*(1-puddle*.97)
  rough=.055+.43*(1-puddle)+.016*noise
  shade=.60+.24*fine-.12*puddle
  if family=='paving':
   gx=(x*8+np.floor(y*8)%2*.5)%1; gy=(y*8)%1
   seam=(np.minimum(gx,1-gx)<.023)|(np.minimum(gy,1-gy)<.025)
   height-=seam*.025; shade*=np.where(seam,.42,1);ao=np.where(seam,.62,1)
 if family=='paint':
  chips=(noise>.982)&(macro>.48);height=chips*.014+.003*fine
  shade=np.where(chips,.36,.80+.17*fine);rough=np.where(chips,.88,.42+.17*fine)
 if family=='vinyl':height=.004*noise;rough=.36+.17*macro;shade=.85+.14*fine
 if family=='glass':height=.001*np.sin(x*100*np.pi);rough=.14+.20*macro;shade=.80+.15*macro
 if family=='ceramic':height=.0007*fine;rough=.12+.10*macro;shade=.90+.09*fine
 if family=='recess':height=.009*fine;rough=.72+.2*fine;shade=.68+.30*macro
 if family=='lamp':height=.0002*fine;rough=.17+.08*macro;shade=.95+.05*fine
 # Small surface cavity signal, not a claim of scene AO / baked GI.
 dx=(np.roll(height,-1,axis=1)-np.roll(height,1,axis=1))*8
 dy=(np.roll(height,-1,axis=0)-np.roll(height,1,axis=0))*8
 normal=np.stack([-dx,dy,np.ones_like(x)],axis=-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
 images={'base':np.repeat(shade[:,:,None],3,2),'normal':normal*.5+.5,'orm':np.stack([ao,rough,np.zeros_like(x)],axis=-1)}
 refs={}
 for kind,data in images.items():
  path=MAPS/f'{family}-{kind}.png';Image.fromarray(np.uint8(np.clip(data,0,1)*255)).save(path)
  data=path.read_bytes();payload.extend(b'\0'*((-len(payload))%4));offset=len(payload);payload.extend(data)
  view=len(j['bufferViews']);j['bufferViews'].append({'buffer':0,'byteOffset':offset,'byteLength':len(data)})
  image=len(j.setdefault('images',[]));j['images'].append({'name':f'Rain_{family}_{kind}','mimeType':'image/png','bufferView':view})
  texture=len(j.setdefault('textures',[]));j['textures'].append({'source':image,'sampler':0})
  refs[kind]=texture
 for mat in j['materials']:
  if mat['name'] not in names:continue
  p=mat.setdefault('pbrMetallicRoughness',{})
  # Keep existing authored print / wall / asphalt colour textures.
  if 'baseColorTexture' not in p or family in ('asphalt','paving'):p['baseColorTexture']={'index':refs['base']}
  if family=='asphalt':p['baseColorFactor']=[.065,.075,.085,1]
  p['metallicRoughnessTexture']={'index':refs['orm']};p['roughnessFactor']=1;p['metallicFactor']=0
  if 'normalTexture' not in mat or family in ('asphalt','paving'):mat['normalTexture']={'index':refs['normal'],'scale':.7}
  mat['occlusionTexture']={'index':refs['orm'],'strength':.65}
  recipes[mat['name']]={'family':family,'keepBase':family not in ('asphalt','paving') and 'baseColorTexture' in before['materials'][j['materials'].index(mat)].get('pbrMetallicRoughness',{})}
# Keep signs emissive and bounded; actual light contribution is authored in game TS.
for mat in j['materials']:
 name=mat['name']
 if name=='FluorescentWarmWhite':mat['emissiveFactor']=[1,.65,.28]
 if name=='NeonCyan':mat['emissiveFactor']=[.03,.55,.85]
 if name=='NeonWarmRed':mat['emissiveFactor']=[.85,.045,.012]
 if name=='WarmWindow':
  mat['emissiveTexture']=copy.deepcopy(mat['pbrMetallicRoughness']['baseColorTexture']);mat['emissiveFactor']=[.5,.27,.10]
j['buffers'][0]['byteLength']=len(payload);payload.extend(b'\0'*((-len(payload))%4))
encoded=json.dumps(j,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
result=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(payload))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(payload),0x004e4942)+payload
OUT.mkdir(exist_ok=True);dest=OUT/'district-rain.glb';dest.write_bytes(result)
assert bytes(payload[:len(original_bin)])==original_bin
for field in ('meshes','nodes','accessors','scenes'):assert j[field]==before[field]
report={'source':str(source.relative_to(ROOT)),'output':str(dest.relative_to(ROOT)),'sourceSha256':hashlib.sha256(b).hexdigest(),'outputSha256':hashlib.sha256(result).hexdigest(),'geometryAndNodeTablesIdentical':True,'originalBinaryPrefixIdentical':True,'materials':len(j['materials']),'addedImages':len(j['images'])-len(before['images']),'recipes':recipes,'baseTextureCoverage':sum('baseColorTexture' in m.get('pbrMetallicRoughness',{}) for m in j['materials']),'wetTexelsRoughnessBelowPoint15':float(np.mean((.055+.43*(1-np.clip((macro-.27)*8,0,1))+.016*noise)<.15))}
(Path(__file__).parent/'material-audit.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='recipes'},indent=2))
