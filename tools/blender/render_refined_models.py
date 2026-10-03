"""Actual decoded GLB comparison renders, with an optional editable Blender save.
No generated illustrations, browser screenshots or device performance claims.
Blender 4.3: --input decoded.glb --output image.png --focus full|upper|head|boots
"""
import argparse,sys,math
import bpy
from mathutils import Vector
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);p.add_argument('--focus',choices=['full','upper','head','boots','gloves'],default='full');p.add_argument('--samples',type=int,default=128);p.add_argument('--save-model');a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=a.input)
rig=next(o for o in bpy.data.objects if o.type=='ARMATURE')
if a.save_model:
 # Keep original imported actions and bind pose in this editable model file.
 # Rendering changes below are never saved into the editable authoring asset.
 bpy.ops.wm.save_as_mainfile(filepath=a.save_model)
rig.animation_data_clear()
for b in rig.pose.bones:b.matrix_basis.identity()
rig.data.pose_position='REST'
for mat in bpy.data.materials:
 if mat.name=='Kit':
  node=mat.node_tree.nodes.get('Principled BSDF');socket=node.inputs['Base Color']
  for link in list(socket.links):mat.node_tree.links.remove(link)
  socket.default_value=(.226,.479,.905,1)
  color_name=next((o.data.color_attributes[0].name for o in bpy.data.objects if o.type=='MESH' and o.data.color_attributes),None)
  if color_name:
   color=mat.node_tree.nodes.new('ShaderNodeVertexColor');color.layer_name=color_name;mix=mat.node_tree.nodes.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=1;mix.inputs[2].default_value=(.226,.479,.905,1);mat.node_tree.links.new(color.outputs['Color'],mix.inputs[1]);mat.node_tree.links.new(mix.outputs['Color'],socket)
# The same game-runtime blue keeper color is used in both comparison images.
spacing={'full':1.25,'upper':.82,'head':.40,'boots':.42,'gloves':.24}[a.focus]
for angle,x in [(0,-spacing),(math.pi/2,0),(math.pi,spacing)]:
 if angle==0:r=rig
 else:
  r=rig.copy();r.data=rig.data.copy();bpy.context.collection.objects.link(r)
  for obj in list(rig.children):
   if obj.type=='MESH':
    c=obj.copy();c.data=obj.data.copy();bpy.context.collection.objects.link(c);c.parent=r
    for m in c.modifiers:
     if m.type=='ARMATURE':m.object=r
 r.location.x=x;r.rotation_mode='XYZ';r.rotation_euler.z=angle
 if a.focus=='gloves':
  bone=r.data.bones.get('hand.R') or r.data.bones.get('handR');center=(bone.head_local+bone.tail_local)*.5;offset=r.rotation_euler.to_matrix()@center;r.location=Vector((x,0,0))-offset
if a.focus not in ['boots','gloves']:
 bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.014));m=bpy.data.materials.new('Floor');m.diffuse_color=(.04,.055,.06,1);bpy.context.object.data.materials.append(m)
scene=bpy.context.scene;scene.world.color=(.15,.15,.15)
for loc,power in [((-3,-4,6),900),((4,-2,4),600),((0,4,4),800)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.data.energy=power;o.data.size=4;o.rotation_euler=(Vector((0,0,1))-o.location).to_track_quat('-Z','Y').to_euler()
height={'full':1,'upper':1.35,'head':1.655,'boots':.075,'gloves':0}[a.focus];elevation={'full':1.5,'upper':.5,'head':.08,'boots':-.35,'gloves':.05}[a.focus]
bpy.ops.object.camera_add(location=(0,-6,height+elevation));o=bpy.context.object;o.rotation_euler=(Vector((0,0,height))-o.location).to_track_quat('-Z','Y').to_euler();o.data.type='ORTHO';o.data.ortho_scale={'full':4.3,'upper':2.8,'head':1.38,'boots':1.5,'gloves':.90}[a.focus];scene.camera=o
scene.render.engine='CYCLES';scene.cycles.use_denoising=False;scene.cycles.samples=a.samples;scene.render.resolution_x=1920;scene.render.resolution_y=1080;scene.render.resolution_percentage=100;scene.render.filepath=a.output;bpy.ops.render.render(write_still=True)
