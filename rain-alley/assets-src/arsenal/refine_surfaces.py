"""Add steel/wood/leather PBR to fresh arsenal GLBs without touching geometry or pivots.
Usage: python refine_surfaces.py --source-dir <unmodified GLB directory>
Output is assets/arsenal. The saved Blender file also contains these maps.
"""
from pathlib import Path
import argparse,copy,hashlib,json,struct
import numpy as np
from PIL import Image
here=Path(__file__).resolve().parent; root=here.parents[1];maps=here/'textures';maps.mkdir(exist_ok=True)
rng=np.random.default_rng(1990);size=512;y,x=np.mgrid[:size,:size]/size
noise=rng.random((size,size));wave=.5+.5*np.sin(y*40*np.pi+1.7*np.sin(x*4*np.pi))
# Directional wood grain and pores, fine steel machining and scattered worn scratches.
grain=.5+.5*np.sin(y*150*np.pi+3*np.sin(x*2*np.pi)+np.sin(x*10*np.pi))
scratch=np.zeros_like(x)
for i in range(160):
 px,py=rng.integers(0,size,2);length=int(rng.integers(3,60));scratch[py,px:min(size,px+length)]=rng.uniform(.2,1)
recipes={
 'RA_BluedSteel':('steel',[.18,.215,.25,1],.96),
 'RA_WornEdges':('steel',[.44,.47,.49,1],.94),
 'RA_Brass':('steel',[.64,.39,.12,1],.93),
 'RA_Walnut':('wood',[.42,.18,.065,1],0),
 'RA_Leather':('leather',[.09,.05,.035,1],0),
 'RA_MouldedRubber':('rubber',[.043,.048,.046,1],0),
 'RA_SightPaint':('paint',[.68,.71,.58,1],0),
 'RA_Skin':('skin',[.48,.285,.19,1],0),
 'RA_FadedOlive':('paint',[.16,.18,.075,1],0),
}
for family in sorted({v[0] for v in recipes.values()}):
 h=.004*noise;rough=.48+.12*noise;shade=.78+.20*noise;metal=np.ones_like(x)
 if family=='steel':
  machining=.5+.5*np.sin(y*460*np.pi)
  h=.0018*noise+.003*scratch;rough=.19+.08*noise+.045*machining+.14*scratch;shade=.76+.13*noise+.10*machining+.17*scratch
 if family=='wood':h=.007*grain+.002*noise;rough=.26+.12*grain+.03*noise;shade=.47+.28*grain+.21*wave
 if family=='leather':h=.012*noise;rough=.42+.20*noise;shade=.68+.30*noise
 if family=='rubber':h=.007*noise;rough=.70+.16*noise;shade=.80+.17*noise
 if family=='skin':h=.002*noise;rough=.48+.12*noise;shade=.93+.07*noise
 if family=='paint':h=.0015*noise;rough=.36+.14*noise;shade=.86+.14*noise
 dx=(np.roll(h,-1,axis=1)-np.roll(h,1,axis=1))*10;dy=(np.roll(h,-1,axis=0)-np.roll(h,1,axis=0))*10
 normal=np.stack([-dx,dy,np.ones_like(x)],-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
 for kind,data in {'base':np.repeat(shade[:,:,None],3,2),'normal':normal*.5+.5,'orm':np.stack([np.ones_like(x),rough,metal],-1)}.items():
  Image.fromarray(np.uint8(np.clip(data,0,1)*255)).save(maps/f'{family}-{kind}.png')
args=argparse.ArgumentParser();args.add_argument('--source-dir',type=Path,required=True);args=args.parse_args();reports=[]
for name in ['car15','type56','mp5','uzi','hipower','model10','m16','minimi','sks','l96','m870','spas12']:
 source=args.source_dir/f'{name}.glb';b=source.read_bytes();n=struct.unpack_from('<I',b,12)[0];j=json.loads(b[20:20+n]);before=copy.deepcopy(j);assert not any(i.get('name','').startswith('Storm_') for i in j.get('images',[])), 'Use base-glb inputs, not refined outputs';original=b[28+n:];payload=bytearray(original);refs={}
 for m in j['materials']:
  family,color,metal=recipes[m['name']]
  for kind in ['base','normal','orm']:
   key=(family,kind)
   if key in refs:continue
   data=(maps/f'{family}-{kind}.png').read_bytes();payload.extend(b'\0'*((-len(payload))%4));offset=len(payload);payload.extend(data)
   view=len(j['bufferViews']);j['bufferViews'].append(dict(buffer=0,byteOffset=offset,byteLength=len(data)))
   image=len(j.setdefault('images',[]));j['images'].append(dict(name=f'Storm_{family}_{kind}',mimeType='image/png',bufferView=view))
   tex=len(j.setdefault('textures',[]));j['textures'].append(dict(source=image,sampler=0));refs[key]=tex
  p=m.setdefault('pbrMetallicRoughness',{});p.update(baseColorFactor=color,baseColorTexture=dict(index=refs[family,'base']),metallicFactor=metal,roughnessFactor=1,metallicRoughnessTexture=dict(index=refs[family,'orm']))
  m['normalTexture']=dict(index=refs[family,'normal'],scale=.8);m['occlusionTexture']=dict(index=refs[family,'orm'],strength=.4)
 for field in ('meshes','nodes','accessors','scenes'):assert j[field]==before[field]
 assert payload[:len(original)]==original
 j['buffers'][0]['byteLength']=len(payload);payload.extend(b'\0'*((-len(payload))%4));encoded=json.dumps(j,separators=(',',':')).encode();encoded+=b' '*((-len(encoded))%4)
 result=struct.pack('<III',0x46546c67,2,28+len(encoded)+len(payload))+struct.pack('<II',len(encoded),0x4e4f534a)+encoded+struct.pack('<II',len(payload),0x004e4942)+payload
 (root/'assets/arsenal'/f'{name}.glb').write_bytes(result)
 reports.append(dict(asset=name,geometryAndPivotsIdentical=True,originalBinaryPrefixIdentical=True,materials=len(j['materials']),baseNormalOrmCoverage=len(j['materials']),sha256=hashlib.sha256(result).hexdigest()))
(here/'surface-audit.json').write_text(json.dumps(dict(recipes=recipes,assets=reports),indent=2)+'\n');print('PBR complete:',len(reports),'weapons')
