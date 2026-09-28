"""Convert generated sRGB panorama to linear Radiance RGBE; no invented HDR range."""
from pathlib import Path
import numpy as np
from PIL import Image
here=Path(__file__).resolve().parent
im=np.asarray(Image.open(here/'kowloon-storm.png').convert('RGB'),dtype=np.float32)/255
rgb=np.where(im<=.04045,im/12.92,((im+.055)/1.055)**2.4)
h,w,_=rgb.shape
maximum=rgb.max(axis=2); mantissa,exponent=np.frexp(maximum)
scale=np.divide(mantissa*256,maximum,out=np.zeros_like(maximum),where=maximum>0)
rgbe=np.zeros((h,w,4),dtype=np.uint8);rgbe[:,:,:3]=np.minimum(255,rgb*scale[:,:,None]).astype(np.uint8);rgbe[:,:,3]=np.where(maximum>0,exponent+128,0)
out=here.parents[2]/'assets/weather/kowloon-storm.hdr'
with out.open('wb') as f:
 f.write(f'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y {h} +X {w}\n'.encode())
 for row in rgbe:
  f.write(bytes([2,2,w>>8,w&255]))
  for channel in row.T:
   for offset in range(0,w,127):
    values=channel[offset:offset+127];f.write(bytes([len(values)]));f.write(values.tobytes())
print(out, w,h)
