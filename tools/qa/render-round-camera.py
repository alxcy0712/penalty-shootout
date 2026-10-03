"""Rasterize actual exported CPU projections; not a WebGL screenshot.
python3 tools/qa/render-round-camera.py /tmp/round-camera-review
"""
import json,math,sys,os
from collections import defaultdict
import numpy as np
from PIL import Image,ImageDraw,ImageFont

root=sys.argv[1] if len(sys.argv)>1 else '/tmp/round-camera-review'
meta=json.load(open(os.path.join(root,'comparison.json')))
font_path='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font=lambda size: ImageFont.truetype(font_path,size)
os.makedirs(os.path.join(root,'frames'),exist_ok=True)
cache={}
for key,g in meta['geometries'].items():
 data=np.fromfile(os.path.join(root,g['file']),dtype='<f4')
 cache[key]=[(m,data[m['offset']:m['offset']+m['count']*3].reshape(-1,3)) for m in g['meshes']]

def srgb(color):
 c=np.clip(color,0,1)
 c=np.where(c<=.0031308,c*12.92,1.055*np.power(c,1/2.4)-.055)
 return tuple(np.round(c*255).astype(int))

def clip_polygon(points):
 # Homogeneous clip planes match Three's standard perspective clip volume.
 for plane in [lambda p:p[3]+p[0],lambda p:p[3]-p[0],lambda p:p[3]+p[1],lambda p:p[3]-p[1],lambda p:p[3]+p[2],lambda p:p[3]-p[2]]:
  if not points:return []
  result=[];a=points[-1];da=plane(a)
  for b in points:
   db=plane(b)
   if (da>=0)!=(db>=0):result.append(a+(b-a)*da/(da-db))
   if db>=0:result.append(b)
   a=b;da=db
  points=result
 return points

def render(frame):
 w,h=frame['width'],frame['height'];scale=2
 image=Image.new('RGB',(w*scale,h*scale),'#0a1b20');draw=ImageDraw.Draw(image)
 matrix=np.array(frame['camera']['viewProjection']).reshape(4,4,order='F');primitives=[]
 light=np.array([-.3,.9,.3]);light/=np.linalg.norm(light)
 for mesh,positions in cache[frame['geometry']]:
  clip=np.column_stack((positions,np.ones(len(positions))))@matrix.T
  ids=np.array(mesh['indices']);corners=clip[ids]
  plane=np.stack([corners[:,:,3]+corners[:,:,k] for k in range(3)]+[corners[:,:,3]-corners[:,:,k] for k in range(3)],axis=2)
  keep=~np.any(np.all(plane<0,axis=1),axis=1)
  if mesh['primitive']=='triangles':
   world=positions[ids];normals=np.cross(world[:,1]-world[:,0],world[:,2]-world[:,0]);length=np.linalg.norm(normals,axis=1);normals/=np.maximum(length[:,None],1e-8)
   shading=.68+.32*np.abs(normals@light)
  else:shading=np.ones(len(ids))
  colors=np.array(mesh['colors'])*np.array(mesh['color']) if mesh.get('colors') else np.tile(mesh['color'],(len(ids),1))
  if np.ptp(positions[:,0])>60 and np.ptp(positions[:,2])>100:
   # The production pitch color lives in a CanvasTexture omitted by this QA.
   # Show its base green as an explicitly simplified solid, with no filtering claim.
   colors=np.tile([.0185,.0865,.0670],(len(ids),1))
  for i in np.flatnonzero(keep):
   points=corners[i]
   if not np.all(plane[i]>=0):
    if mesh['primitive']=='lines':
     # Nets never cross the near plane in these endpoint/transition samples.
     if np.any(points[:,3]<=0):continue
    else:
     points=np.array(clip_polygon(list(points)))
     if len(points)<3:continue
   xy=points[:,:2]/points[:,3,None];xy[:,0]=(xy[:,0]+1)*w/2*scale;xy[:,1]=(1-xy[:,1])*h/2*scale
   color=srgb(colors[i]*shading[i])
   if mesh['role']=='net':color=(85,115,109)
   # The pitch and paint are the ground layer, always behind above-ground
   # actors/goal. A huge clipped pitch triangle's mean depth is not reliable.
   depth=float('inf') if mesh['role']=='field' else float(np.mean(points[:,3]))
   primitives.append((depth,xy.tolist(),color,mesh['primitive']))
 for depth,points,color,kind in sorted(primitives,key=lambda p:-p[0]):
  if kind=='lines':draw.line([tuple(x) for x in points],fill=color,width=1)
  else:draw.polygon([tuple(x) for x in points],fill=color)
 return image.resize((w,h),Image.Resampling.LANCZOS)

grouped=defaultdict(list);render_cache={}
for frame in meta['frames']:
 name=f"{frame['mode']}-{frame['width']}x{frame['height']}-{frame['direction']}-{frame['version']}-{frame['index']}.png"
 key=(frame['geometry'],frame['width'],frame['height'],tuple(frame['camera']['viewProjection']))
 if key not in render_cache:render_cache[key]=render(frame)
 render_cache[key].save(os.path.join(root,'frames',name));frame['_image']=name
 grouped[(frame['mode'],frame['width'],frame['height'],frame['direction'])].append(frame)

for (mode,w,h,direction),frames in grouped.items():
 margin=18;rowlabel=32;header=108;footer=62;gap=12
 canvas=Image.new('RGB',(4*w+5*margin,header+2*(h+rowlabel+gap)+footer),'#102128');draw=ImageDraw.Draw(canvas)
 draw.text((margin,15),f'NEXT ROUND / {mode.upper()} / {direction.replace("-"," ").upper()} / {w} x {h}',font=font(22),fill='#e1eee8')
 draw.text((margin,47),'Actual Stadium camera + production skinned meshes. CPU projection diagnostic; NOT a WebGL screenshot.',font=font(15),fill='#c4d5cd')
 for column,label in enumerate(['First next draw (16.7 ms)','+ 0.20 s','+ 0.60 s','+ 1.30 s']):draw.text((margin+column*(w+margin),80),label,font=font(17),fill='#e1eee8')
 for row,version in enumerate(['baseline','candidate']):
  for column in range(4):
   frame=next(f for f in frames if f['version']==version and f['index']==column);x=margin+column*(w+margin);y=header+row*(h+rowlabel+gap)
   c=frame['camera'];label=f'{version.upper()}  angle {math.degrees(c["angle"]):.1f} deg  x={c["position"][0]:.2f} m'
   draw.text((x,y),label,font=font(15),fill='#f0c97b' if version=='baseline' else '#a6e3c8')
   canvas.paste(Image.open(os.path.join(root,'frames',frame['_image'])),(x,y+rowlabel))
 y=canvas.height-footer+5
 draw.text((margin,y),'Same actors reset to ready on the first draw. Candidate lands on the role camera immediately.',font=font(16),fill='#d4e5dc')
 draw.text((margin,y+26),'Textures, game UI, lights, shadows and stadium omitted. Geometry/framing evidence only; no GPU-quality or FPS claim.',font=font(14),fill='#9fb9ad')
 name=f'{mode}-{w}x{h}-{direction}.png';canvas.save(os.path.join(root,name));print(name,flush=True)

# A compact contact sheet keeps all eight role/mode/viewport comparisons together.
names=[f'{mode}-{w}x{h}-{direction}.png' for mode,w,h,direction in grouped]
thumb_width=800;thumbs=[]
for name in names:
 image=Image.open(os.path.join(root,name));image.thumbnail((thumb_width,700));thumbs.append(image.copy())
rh=max(im.height for im in thumbs);overview=Image.new('RGB',(thumb_width*2,rh*4),'#102128')
for i,image in enumerate(thumbs):overview.paste(image,((i%2)*thumb_width,(i//2)*rh))
overview.save(os.path.join(root,'overview.png'))
