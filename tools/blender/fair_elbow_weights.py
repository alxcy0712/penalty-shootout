"""Separate experimental elbow weight field; never combined with geometry fairing.
Consumes the exact base dump. Only existing positive upper-arm/forearm pairs are
redistributed; every other influence, bind coordinate and calibrated surface stays
unchanged. A bounded blend approaches an axial elbow transition over 120 mm.
"""
import argparse,json,math,hashlib
from pathlib import Path
import numpy as np
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--rig',required=True);p.add_argument('--output',required=True);p.add_argument('--strength',type=float,default=.35);a=p.parse_args()
d=json.load(open(a.input));r=json.load(open(a.rig));changes=[]
def smooth(x,lo,hi):
 t=max(0,min(1,(x-lo)/(hi-lo)));return t*t*(3-2*t)
for pi,part in enumerate(d):
 if not part['material'].startswith('Skin'):continue
 for vi,(point,joints,weights) in enumerate(zip(part['positions'],part['joints'],part['weights'])):
  side='R' if point[0]>0 else 'L';f=r['names'].index('forearm.'+side);u=r['names'].index('upper_arm.'+side)
  if f not in joints or u not in joints:continue
  fi=joints.index(f);ui=joints.index(u);fw=weights[fi];uw=weights[ui]
  if fw<=0 or uw<=0 or fw+uw<.999999 or abs(point[0])<.24:continue
  local=np.asarray(r['inverseBindMatrices'][f]).reshape(4,4).T@np.array([*point,1]);y=float(local[1]);window=smooth(y,-.10,-.04)*(1-smooth(y,.04,.10));target=smooth(y,-.060,.060)
  delta=max(-.15,min(.15,(target-fw)*a.strength*window))
  if abs(delta)<1e-7:continue
  before=weights[:];weights[fi]+=delta;weights[ui]-=delta
  changes.append({'primitive':pi,'vertex':vi,'side':side,'localForearm':local[:3].tolist(),'jointIndices':joints[:],'before':before,'after':weights[:]})
json.dump(d,open(a.output,'w'))
receipt={'inputSha256':hashlib.sha256(open(a.input,'rb').read()).hexdigest(),'rigSha256':hashlib.sha256(open(a.rig,'rb').read()).hexdigest(),'authoringScriptSha256':hashlib.sha256(open(__file__,'rb').read()).hexdigest(),'parameters':vars(a),'changedVertices':len(changes),'maxWeightChange':max(abs(v-w) for c in changes for v,w in zip(c['before'],c['after'])),'changes':changes}
json.dump(receipt,open(a.output.replace('.json','-receipt.json'),'w'),indent=2);print('Changed',len(changes),'vertices; maximum weight delta',receipt['maxWeightChange'])
