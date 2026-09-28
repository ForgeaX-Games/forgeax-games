"""Deterministic original PBR surfaces, no external image/licensing dependencies."""
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont
p=Path(__file__).resolve().parent/'textures';p.mkdir(exist_ok=True)
rng=np.random.default_rng(9091990);n=512;y,x=np.mgrid[:n,:n];noise=rng.random((n,n));coarse=np.asarray(Image.fromarray((rng.random((32,32))*255).astype('uint8')).resize((n,n),Image.Resampling.BICUBIC))/255
spec={'iron':([70,91,86],.8,.5),'cloth':([105,93,70],0,.95),'brick':([119,70,47],0,.88),'plaster':([139,133,113],0,.88),'trash':([40,44,39],0,.55),'feather':([26,31,35],0,.63),'fur':([83,69,57],0,.92),'roach':([84,45,25],.15,.42)}
for name,(color,metal,rough) in spec.items():
 h=.55+.25*coarse+.12*noise;rgb=np.ones((n,n,3))*color*h[:,:,None];r=np.ones((n,n))*rough;m=np.ones((n,n))*metal
 if name=='iron':
  rust=coarse>.55;rgb[rust]=np.stack([101+noise[rust]*45,48+noise[rust]*24,23+noise[rust]*18],axis=-1);m[rust]=.08;r[rust]=.92
  for i in range(85):
   a,b=rng.integers(0,n,2);length=rng.integers(8,90);rgb[b:min(n,b+length),a:a+1]=[153,146,126];h[b:min(n,b+length),a:a+1]=.1
 if name=='brick':
  mortar=(y%64<6)|((x+(y//64%2)*64)%128<5);rgb[mortar]=[71,73,67];h[mortar]=.15
 if name in ('cloth','fur','feather'):
  weave=.85+.15*np.sin(x*(2.1 if name=='cloth' else .28)+coarse*8);rgb*=weave[:,:,None];h*=weave
 if name=='plaster':
  chips=coarse>.65;rgb[chips]=[74,70,60];h[chips]=.05
 rgb=np.clip(rgb,0,255).astype('uint8');Image.fromarray(rgb).save(p/f'{name}-base.png')
 dy,dx=np.gradient(h);normal=np.stack([-dx*1.8,-dy*1.8,np.ones_like(h)],axis=-1);normal/=np.linalg.norm(normal,axis=-1,keepdims=True)
 Image.fromarray(((normal*.5+.5)*255).astype('uint8')).save(p/f'{name}-normal.png')
 orm=np.stack([.8+.2*h,r,m],axis=-1);Image.fromarray((np.clip(orm,0,1)*255).astype('uint8')).save(p/f'{name}-orm.png')
font=ImageFont.truetype('/System/Library/Fonts/Supplemental/Songti.ttc',86)
for name,words in [('couplet-left','出入平安'),('couplet-right','生意興隆')]:
 a=np.zeros((512,128,3),dtype='uint8');a[:]=[125,32,24];a=np.clip(a.astype(float)*(rng.random(a.shape[:2])*.3+.65)[:,:,None],0,255).astype('uint8');im=Image.fromarray(a);d=ImageDraw.Draw(im)
 for i,c in enumerate(words):d.text((20,10+i*123),c,font=font,fill=(192,157,91))
 for i in range(85):
  xx,yy=rng.integers(0,128),rng.integers(0,512);d.line((xx,yy,xx+int(rng.integers(2,17)),yy+1),fill=(78,60,43),width=2)
 im.save(p/f'{name}-base.png')
print('TEXTURES_READY',len(list(p.glob('*.png'))))
