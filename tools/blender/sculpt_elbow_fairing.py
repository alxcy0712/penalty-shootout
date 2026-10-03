"""Bounded secondary elbow fairing on the exact grip-recovery production mesh.
No topology, material, weight, bind or action changes. The diagnostic welded work
surface never replaces the production primitive order. All hand-influenced (>0.1)
vertices and all glove/boot material vertices stay byte-exact through packing.
"""
import argparse, json, sys, math, hashlib
import bpy
from mathutils import Matrix, Vector
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--rig',required=True);p.add_argument('--output',required=True);p.add_argument('--strength',type=float,default=1);p.add_argument('--normals',choices=['keep','update'],default='update');p.add_argument('--blend');a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
data=json.load(open(a.input));rig=json.load(open(a.rig));bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
inv=[Matrix([m[i::4] for i in range(4)]) for m in rig['inverseBindMatrices']]
def smooth(x,lo,hi):
 t=max(0,min(1,(x-lo)/(hi-lo)));return t*t*(3-2*t)
def window(x,lo,li,ri,ro):return smooth(x,lo,li)*(1-smooth(x,ri,ro))
points=[];lookup={};maps=[];faces=[];members=[]
for pi,part in enumerate(data):
 ids=[]
 for vi,xyz in enumerate(part['positions']):
  key=tuple(round(v,5) for v in xyz)
  if key not in lookup:lookup[key]=len(points);points.append(xyz);members.append([])
  idx=lookup[key];ids.append(idx);members[idx].append((pi,vi))
 maps.append(ids)
 for i in range(0,len(part['indices']),3):
  face=tuple(ids[k] for k in part['indices'][i:i+3])
  if len(set(face))==3:faces.append(face)
mesh=bpy.data.meshes.new('Welded secondary elbow work surface');mesh.from_pydata(points,[],faces);mesh.update();obj=bpy.data.objects.new('Bounded elbow fairing candidate',mesh);bpy.context.collection.objects.link(obj);bpy.context.view_layer.objects.active=obj;obj.select_set(True)
masks=[];protected=[]
for i,xyz in enumerate(points):
 protected.append(any(data[pi]['material'] in ['Socks','Boots'] or any(w>.1 and rig['names'][j].startswith(('hand.','foot.','toe.')) for j,w in zip(data[pi]['joints'][vi],data[pi]['weights'][vi])) for pi,vi in members[i]))
 skin=all(data[pi]['material'].startswith('Skin') for pi,vi in members[i]);x,y,z=xyz;side='R' if x>0 else 'L';j=rig['names'].index('forearm.'+side);local=inv[j]@Vector(xyz)
 masks.append(window(local.y,-.085,-.035,.045,.100)*smooth(abs(x),.23,.27)*a.strength if skin and not protected[i] else 0)
g=obj.vertex_groups.new(name='Elbow cap only')
for i,m in enumerate(masks):
 if m:g.add([i],m,'REPLACE')
mod=obj.modifiers.new('Bounded elbow cap fairing','SMOOTH');mod.vertex_group=g.name;mod.factor=.55;mod.iterations=8;bpy.ops.object.modifier_apply(modifier=mod.name)
for i,v in enumerate(mesh.vertices):
 delta=v.co-Vector(points[i]);cap=.0035*min(1,masks[i])
 if not masks[i] or protected[i]:v.co=points[i]
 elif delta.length>cap:v.co=Vector(points[i])+delta.normalized()*cap
mesh.update();changed={i for i,v in enumerate(mesh.vertices) if (v.co-Vector(points[i])).length>1e-8};affected=set(changed)
for poly in mesh.polygons:
 if any(i in changed for i in poly.vertices):affected.update(poly.vertices)
for part,ids in zip(data,maps):
 for vi,j in enumerate(ids):
  if j in changed:part['positions'][vi]=list(mesh.vertices[j].co)
  if a.normals=='update' and j in affected and not protected[j]:part['normals'][vi]=list(mesh.vertices[j].normal)
json.dump(data,open(a.output,'w'))
summary={'inputSha256':hashlib.sha256(open(a.input,'rb').read()).hexdigest(),'rigSha256':hashlib.sha256(open(a.rig,'rb').read()).hexdigest(),'authoringScriptSha256':hashlib.sha256(open(__file__,'rb').read()).hexdigest(),'parameters':vars(a),'weldedVertices':len(points),'changedWeldedVertices':len(changed),'maximumDisplacementMm':1000*max((v.co-Vector(points[i])).length for i,v in enumerate(mesh.vertices)),'maskVertices':sum(x>0 for x in masks),'protectedMoved':sum(j in changed for j,p in enumerate(protected) if p)}
json.dump(summary,open(a.output.replace('.json','-receipt.json'),'w'),indent=2)
if a.blend:obj.rotation_euler.x=math.pi/2;bpy.ops.wm.save_as_mainfile(filepath=a.blend)
print(json.dumps(summary))
