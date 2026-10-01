"""Blender CPU offline renderer for export-character-poses.mjs outputs.
blender -b -t 4 --python tools/qa/render-character-poses.py -- --input /tmp/keeper-qa --samples 12
For sequences: ffmpeg -framerate 24 -i /tmp/keeper-qa/frames/frame-%04d.png -c:v libx264 -pix_fmt yuv420p review.mp4
Materials are deliberately simplified; this does not test browser/WebGL rendering.
"""
import argparse,json,math,os
import bpy,numpy as np
from mathutils import Vector
import sys
parser=argparse.ArgumentParser();parser.add_argument('--input',required=True);parser.add_argument('--samples',type=int,default=4);parser.add_argument('--width',type=int,default=1152);parser.add_argument('--height',type=int,default=540);parser.add_argument('--views',type=int,choices=[1,2,3],default=3)
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);path=os.path.abspath(args.input);meta=json.load(open(os.path.join(path,'poses.json')));data=np.fromfile(os.path.join(path,'poses.bin'),dtype='<f4').reshape(meta['frames'],meta['components']);out=os.path.join(path,'frames');os.makedirs(out,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False);objects=[];character_parts=[data[:,item['offset']:item['offset']+item['count']*3].reshape(-1,3) for item in meta['meshes'] if item.get('role')!='ball'];all_points=np.concatenate(character_parts);extent=np.max(np.abs(all_points[:,:2]));spacing=max(1.8,float(extent*2+.35));angles=[0] if args.views==1 else [0,math.pi/2] if args.views==2 else [0,math.pi/2,math.pi];bounds=[]
for side,angle in enumerate(angles):
 offset=(side-(args.views-1)/2)*spacing
 for item in meta['meshes']:
  mesh=bpy.data.meshes.new(item['name']);vertices=data[0,item['offset']:item['offset']+item['count']*3].reshape(-1,3);mesh.from_pydata(vertices,[],[face[::-1] for face in item['faces']]);mesh.update();obj=bpy.data.objects.new(item['name'],mesh);bpy.context.collection.objects.link(obj);obj.rotation_euler.z=angle;obj.location.x=offset;objects.append((obj,item))
  material=bpy.data.materials.new(item['material']);material.diffuse_color=(*item['color'],1);material.use_nodes=True;material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(*item['color'],1);material.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.8;mesh.materials.append(material)
  for face in mesh.polygons:face.use_smooth=True
 for x in [float(all_points[:,0].min()),float(all_points[:,0].max())]:
  for y in [float(all_points[:,1].min()),float(all_points[:,1].max())]:
   for z in [float(all_points[:,2].min()),float(all_points[:,2].max())]:bounds.append(Vector((math.cos(angle)*x-math.sin(angle)*y+offset,math.sin(angle)*x+math.cos(angle)*y,z)))
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.014));mat=bpy.data.materials.new('pitch');mat.diffuse_color=(.06,.12,.1,1);bpy.context.object.data.materials.append(mat)
world=bpy.context.scene.world;world.use_nodes=True;world.node_tree.nodes['Background'].inputs[0].default_value=(.1,.14,.12,1);world.node_tree.nodes['Background'].inputs[1].default_value=.8
for location,power in [((-3,4,7),700),((4,-3,5),500)]:
 bpy.ops.object.light_add(type='AREA',location=location);light=bpy.context.object;light.data.energy=power;light.data.size=5;light.rotation_euler=(Vector((0,0,1))-light.location).to_track_quat('-Z','Y').to_euler()
center=sum(bounds,Vector())/len(bounds);bpy.ops.object.camera_add(location=center+Vector((0,6,1.7)));camera=bpy.context.object;camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';inverse=camera.rotation_euler.to_matrix().transposed();projected=[inverse@(point-center) for point in bounds];width=max(p.x for p in projected)-min(p.x for p in projected);height=max(p.y for p in projected)-min(p.y for p in projected);camera.data.ortho_scale=max(width,height*args.width/args.height)*1.12;bpy.context.scene.camera=camera
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=args.samples;scene.cycles.use_denoising=False;scene.render.resolution_x=args.width;scene.render.resolution_y=args.height;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG'
for frame in range(meta['frames']):
 for obj,item in objects:obj.data.vertices.foreach_set('co',data[frame,item['offset']:item['offset']+item['count']*3]);obj.data.update()
 scene.render.filepath=os.path.join(out,f'frame-{frame:04d}.png');bpy.ops.render.render(write_still=True)
