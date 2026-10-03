"""Blender topology-preserving shoulder fairing and football shorts fitting.
Imports decoded primitive data so original rig, stream indexing and contact data can be preserved by the packer.
"""
import bpy, json, sys, argparse, math
from mathutils import Vector
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--blend');a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
data=json.load(open(a.input));bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def smooth(x,lo,hi):
 t=max(0,min(1,(x-lo)/(hi-lo)));return t*t*(3-2*t)
# Weld duplicate seam vertices for a continuous modifier mask, without changing export topology.
points=[];lookup={};maps=[];faces=[]
for part in data:
 ids=[]
 for xyz in part['positions']:
  key=tuple(round(v,5) for v in xyz)
  if key not in lookup:lookup[key]=len(points);points.append((xyz[0],-xyz[2],xyz[1]))
  ids.append(lookup[key])
 maps.append(ids)
 for i in range(0,len(part['indices']),3):
  f=tuple(ids[k] for k in part['indices'][i:i+3])
  if len(set(f))==3:faces.append(f)
mesh=bpy.data.meshes.new('Welded body authoring surface');mesh.from_pydata(points,[],faces);mesh.update();o=bpy.data.objects.new('Football anatomy and cloth fit',mesh);bpy.context.collection.objects.link(o);bpy.context.view_layer.objects.active=o;o.select_set(True)
g=o.vertex_groups.new(name='Bounded shoulder fairing')
for v in mesh.vertices:
 x,z,y=v.co;mask=smooth(abs(x),.145,.18)*(1-smooth(abs(x),.27,.31))*smooth(y,1.28,1.36)*(1-smooth(y,1.49,1.54))
 if mask:g.add([v.index],mask,'REPLACE')
mod=o.modifiers.new('Remove angular deltoid ridges','SMOOTH');mod.vertex_group=g.name;mod.factor=.48;mod.iterations=6;bpy.ops.object.modifier_apply(modifier=mod.name)
for v,orig in zip(mesh.vertices,points):
 x,z,y=orig
 # Reduce the donor's oversized chest; protected waist corridor stays exact.
 chest=smooth(y,1.24,1.30)*(1-smooth(y,1.40,1.46))*(1-smooth(abs(x),.15,.19))
 if z<-.025:v.co.y += .008*chest*smooth(-z,.045,.10)
 v.co.x *= 1-.035*chest
mesh.update()
# Smooth vertex normals are computed on the welded edited surface, and copied
# only onto changed face neighborhoods; protected footwear/palms remain exact.
changed={i for i,v in enumerate(mesh.vertices) if (v.co-Vector(points[i])).length>1e-9};affected=set(changed)
for poly in mesh.polygons:
 if any(i in changed for i in poly.vertices):affected.update(poly.vertices)
for part,ids in zip(data,maps):
 for i,j in enumerate(ids):
  v=mesh.vertices[j].co.copy();x,z,y=points[j]
  # A separate garment hem leaves the thigh narrow under the opening.
  # Top skin follows the raised hem vertically, not the garment's radial flare.
  if y<.94 and abs(x)<.25:
   shorts=smooth(y,.575,.62)*(1-smooth(y,.84,.94));outer=smooth(abs(x),.065,.115)
   if part['material']=='Shorts':
    theta=math.atan2((z+.025)/.115,(abs(x)-.12)/.095)
    fit=smooth(y,.59,.63)*(1-smooth(y,.77,.91))*smooth(abs(x),.09,.14)
    target_x=math.copysign(.12+.095*math.cos(theta),x);target_z=-.025+.115*math.sin(theta)
    v.x+=(target_x-x)*fit;v.y+=(target_z-z)*fit
   if part['material'] in ['Shorts','Skin.001','Skin']:
    hem=smooth(y,.575,.62)*(1-smooth(y,.70,.81));v.z += .045*hem
  part['positions'][i]=[v.x,v.z,-v.y]
  if j in affected:
   n=mesh.vertices[j].normal;part['normals'][i]=[n.x,n.z,-n.y]
json.dump(data,open(a.output,'w'))
if a.blend:bpy.ops.wm.save_as_mainfile(filepath=a.blend)
print('Changed welded vertices',len(changed),'of',len(points))
