"""Project real runtime net snapshots; this is a diagnostic, not a game screenshot.
Inputs are rest/cases snapshots from GoalNetMotion using the actual scene topology.
"""
import json,sys,math
from PIL import Image,ImageDraw
j=json.load(open(sys.argv[1]));im=Image.new('RGB',(1200,480),'#102128');d=ImageDraw.Draw(im)
d.text((20,15),'NET CONTACT / actual 242 runtime vertices; displacement arrows x10 (not WebGL)',fill='#e2ece6')
rest=j['rest'];t=.15
for col,name in enumerate(['back','right','roof']):
 x0=col*400;case=j['cases'][name];p=case['impact']['position'];arr=case['snapshots'][str(t)]
 def project(v):
  x,y,z=v;return(x0+193+x*36+z*21,315-y*65+z*15)
 d.text((x0+18,55),f"{name.upper()} / peak {case['peak']['meters']*100:.2f} cm",fill='#e2ece6')
 for i in range(0,len(rest),6):d.line([project(rest[i:i+3]),project(rest[i+3:i+6])],fill='#607b7b',width=1)
 for i in range(0,len(rest),3):
  v=rest[i:i+3];q=arr[i:i+3];delta=[q[k]-v[k] for k in range(3)];dist=math.sqrt(sum((v[k]-p[k2])**2 for k,k2 in enumerate(['x','y','z'])));age=t-dist/10
  old=-(math.sin(age*26)*math.exp(-age*5-dist*.9)*(1-t*.9)*.16*max(0,min(1,-v[2]/1.7)) if age>0 else 0)
  if abs(old)>.0007:d.line([project(v),project([v[0],v[1],v[2]+old*10])],fill='#e99071',width=2)
  if sum(q*q for q in delta)>.0000005:d.line([project(v),project([v[k]+delta[k]*10 for k in range(3)])],fill='#62e6cd',width=2)
 pos=project([p['x'],p['y'],p['z']]);d.ellipse((pos[0]-4,pos[1]-4,pos[0]+4,pos[1]+4),fill='#f3e493')
 d.text((x0+18,367),'orange: previous Z-only response',fill='#e99071');d.text((x0+18,386),'green: surface-normal response',fill='#62e6cd');d.text((x0+18,405),'yellow: measured contact location',fill='#f3e493')
d.text((20,451),'Unchanged sparse line mesh; front/ground/corners fixed. Response is subtle, not a cloth simulation.',fill='#afc5bf');im.save(sys.argv[2])
