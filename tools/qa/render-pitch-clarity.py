"""CPU projection visualization, not a WebGL screenshot or filtering comparison."""
import json,sys
from PIL import Image,ImageDraw
j=json.load(open(sys.argv[1]));w=j['width'];h=j['height'];scale=4
canvas=Image.new('RGB',(w*2+40,h+105),'#102128');draw=ImageDraw.Draw(canvas);draw.text((15,12),'PITCH PAINT / CPU geometry projection, not WebGL',fill='#dce9e3')
for col in range(2):
 image=Image.new('RGB',(w*scale,h*scale),'#255349');d=ImageDraw.Draw(image)
 transform=lambda p:tuple(v*scale for v in p)
 if col==0:
  for segment in j['segments']:d.line([transform(p) for p in segment],fill='#809e94',width=max(1,round(scale/j['dpr'])))
 else:
  for triangle in j['triangles']:d.polygon([transform(p) for p in triangle],fill='#809e94')
 image=image.resize((w,h),Image.Resampling.LANCZOS);canvas.paste(image,(10+col*(w+20),55))
 draw.text((15+col*(w+20),35),'BEFORE: one buffer pixel' if col==0 else 'AFTER: 8 cm physical paint',fill='#dce9e3')
draw.text((15,h+69),'Same camera, DPR 1.7, colors and field dimensions. No simulated AF improvement.',fill='#b4c9bf');canvas.save(sys.argv[2])
