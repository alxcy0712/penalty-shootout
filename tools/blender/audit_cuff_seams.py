"""Measure coincident rest Skin/glove seam weight equality, without modifying it."""
import argparse,collections,hashlib,json
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--rig',required=True);p.add_argument('--output',required=True);a=p.parse_args()
d=json.load(open(a.input));r=json.load(open(a.rig));groups=collections.defaultdict(list)
for pi,part in enumerate(d):
 for i,(point,joints,weights) in enumerate(zip(part['positions'],part['joints'],part['weights'])):
  if any(r['names'][bone].startswith('hand.') and weight>.1 for bone,weight in zip(joints,weights)):
   groups[tuple(round(x*1e6) for x in point)].append((pi,i))
records=[]
for key,members in groups.items():
 mats={d[pi]['material'] for pi,i in members}
 if not ('Skin.001' in mats and 'Socks' in mats):continue
 weights=[]
 for pi,i in members:
  total=collections.defaultdict(float)
  for j,w in zip(d[pi]['joints'][i],d[pi]['weights'][i]):total[r['names'][j]]+=w
  weights.append(dict(total))
 maximum=max(abs(u.get(k,0)-v.get(k,0)) for u in weights for v in weights for k in set(u)|set(v))
 records.append({'point':[k/1e6 for k in key],'members':members,'weights':weights,'maxWeightDifference':maximum})
summary={'inputSha256':hashlib.sha256(open(a.input,'rb').read()).hexdigest(),'rigSha256':hashlib.sha256(open(a.rig,'rb').read()).hexdigest(),'scriptSha256':hashlib.sha256(open(__file__,'rb').read()).hexdigest(),'weldPrecisionMetres':1e-6,'coincidentSkinGloveSeamPoints':len(records),'mismatchedPoints':sum(c['maxWeightDifference']>1e-8 for c in records),'maxDifference':max(c['maxWeightDifference'] for c in records),'records':records}
json.dump(summary,open(a.output,'w'),indent=2);print(json.dumps({k:v for k,v in summary.items() if k!='records'}))
