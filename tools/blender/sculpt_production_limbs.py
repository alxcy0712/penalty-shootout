"""Offline football arm silhouette refinement in Blender, with unchanged topology.
Uses a welded work surface only for bounded fairing. Original primitive ordering,
skin weights, hand/foot contacts and runtime skeleton are retained by the packer.
"""
import bpy,json,sys,argparse,math
from mathutils import Vector,Matrix
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--rig',required=True);p.add_argument('--output',required=True);p.add_argument('--blend');p.add_argument('--back',type=float,default=1);p.add_argument('--arm',type=float,default=1);a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
data=json.load(open(a.input));rig=json.load(open(a.rig));bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def smooth(x,lo,hi):
 t=max(0,min(1,(x-lo)/(hi-lo)));return t*t*(3-2*t)
def window(x,a,b,c,d):return smooth(x,a,b)*(1-smooth(x,c,d))
# Work in the native glTF axes; rotations below only affect the saved diagnostic view.
inv=[Matrix([m[i::4] for i in range(4)]) for m in rig['inverseBindMatrices']];bind=[m.inverted() for m in inv]
points=[];lookup={};maps=[];faces=[];members=[]
for pi,part in enumerate(data):
 ids=[]
 for vi,xyz in enumerate(part['positions']):
  key=tuple(round(v,5) for v in xyz)
  if key not in lookup:lookup[key]=len(points);points.append(xyz);members.append([])
  idx=lookup[key];ids.append(idx);members[idx].append((pi,vi))
 maps.append(ids)
 for i in range(0,len(part['indices']),3):
  f=tuple(ids[k] for k in part['indices'][i:i+3])
  if len(set(f))==3:faces.append(f)
mesh=bpy.data.meshes.new('Welded production authoring surface');mesh.from_pydata(points,[],faces);mesh.update();o=bpy.data.objects.new('Football forearm and jersey fairing',mesh);bpy.context.collection.objects.link(o);bpy.context.view_layer.objects.active=o;o.select_set(True)
armMasks=[];backMasks=[];localInfo=[];protected=[]
for i,xyz in enumerate(points):
 protect=any(any(w>.1 and rig['names'][j].startswith(('hand.','foot.','toe.')) for j,w in zip(data[pi]['joints'][vi],data[pi]['weights'][vi])) for pi,vi in members[i]);protected.append(protect)
 skin=any(data[pi]['material'].startswith('Skin') for pi,vi in members[i]);kit=any(data[pi]['material']=='Kit' for pi,vi in members[i]);x,y,z=xyz
 side='R' if x>0 else 'L';j=rig['names'].index('forearm.'+side);local=inv[j]@Vector(xyz);localInfo.append((j,local))
 mask=window(local.y,-.065,-.012,.17,.235)*smooth(abs(x),.245,.285) if skin and not protect else 0
 armMasks.append(mask*a.arm)
 backMasks.append(window(y,1.115,1.23,1.40,1.475)*(1-smooth(abs(x),.12,.185))*smooth(-z,.035,.07)*a.back if kit and not protect else 0)
for name,masks,iterations,factor in [('Forearm elbow fairing',armMasks,5,.40),('Jersey back panel fairing',backMasks,10,.48)]:
 g=o.vertex_groups.new(name=name)
 for i,m in enumerate(masks):
  if m:g.add([i],m,'REPLACE')
 mod=o.modifiers.new(name,'SMOOTH');mod.vertex_group=g.name;mod.factor=factor;mod.iterations=iterations;bpy.ops.object.modifier_apply(modifier=mod.name)
for i,v in enumerate(mesh.vertices):
 original=Vector(points[i]);delta=v.co-original
 # A strict 4 mm cap bounds fairing near joint transitions.
 if delta.length>.004:v.co=original+delta.normalized()*.004
 if armMasks[i]:
  j,local=localInfo[i];q=inv[j]@v.co
  # Retain elbow width; reduce only the overbuilt mid-forearm belly.
  lean=window(local.y,.005,.05,.13,.225)*.105*a.arm
  q.x*=1-lean;q.z*=1-lean;v.co=bind[j]@q
 if protected[i]:v.co=original
mesh.update();changed={i for i,v in enumerate(mesh.vertices) if (v.co-Vector(points[i])).length>1e-8};affected=set(changed)
for poly in mesh.polygons:
 if any(i in changed for i in poly.vertices):affected.update(poly.vertices)
# Seam vertices share positions and normals; unchanged neighborhoods retain authoring normals.
for part,ids in zip(data,maps):
 for vi,j in enumerate(ids):
  if j in changed:part['positions'][vi]=list(mesh.vertices[j].co)
  if j in affected and not protected[j]:part['normals'][vi]=list(mesh.vertices[j].normal)
json.dump(data,open(a.output,'w'))
if a.blend:
 o.rotation_euler.x=math.pi/2;bpy.ops.wm.save_as_mainfile(filepath=a.blend)
print(json.dumps({'weldedVertices':len(points),'changedVertices':len(changed),'maximumDisplacementMm':1000*max((v.co-Vector(points[i])).length for i,v in enumerate(mesh.vertices)),'armMaskVertices':sum(x>0 for x in armMasks),'backMaskVertices':sum(x>0 for x in backMasks)}))
