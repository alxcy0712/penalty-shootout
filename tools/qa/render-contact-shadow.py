"""CPU diagnostic of actual runtime shadow scale/alpha samples; not WebGL gameplay.
Usage: python tools/qa/render-contact-shadow.py samples.json output.png
Samples come from ballContactShadow(height), with the previous constants alongside.
"""
import json,sys,math
from PIL import Image,ImageDraw
samples=json.load(open(sys.argv[1]));im=Image.new('RGB',(1080,640),'#102128');d=ImageDraw.Draw(im)
d.text((24,18),'CONTACT SHADOW / CPU diagnostic from runtime values (not WebGL)',fill='#dce5e2')
for row,version in enumerate(['before','after']):
 for col,sample in enumerate(samples):
  x0=col*360;y0=55+row*285;cx=x0+180;cy=y0+218;state=sample[version];h=sample['height'];r=36*state['scale'];ry=r*.32
  d.rectangle((x0+8,y0,x0+352,y0+274),fill='#295449');d.text((x0+20,y0+12),f'{version.upper()}   height {h:.2f} m',fill='#e1e8e4')
  for y in range(int(cy-ry)-1,int(cy+ry)+2):
   for x in range(int(cx-r)-1,int(cx+r)+2):
    q=math.hypot((x-cx)/r,(y-cy)/ry)
    if q>=1:continue
    alpha=1 if version=='before' else .9+(.64-.9)*q/.38 if q<.38 else .64*(1-q)/.62
    alpha*=state['opacity'];im.putpixel((x,y),tuple(round(v*(1-alpha)) for v in (41,84,73)))
  by=cy-h*86;rr=16
  for y in range(int(by-rr),int(by+rr)+1):
   for x in range(cx-rr,cx+rr+1):
    q=((x-cx)/rr)**2+((y-by)/rr)**2
    if q<=1:
     light=.45+.5*math.sqrt(1-q);im.putpixel((x,y),tuple(int(v*light) for v in (239,244,234)))
  d.text((x0+20,y0+249),f"scale {state['scale']:.2f} / alpha {state['opacity']:.3f}",fill='#d3ddd4')
im.save(sys.argv[2])
