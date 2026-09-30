"""Bake attributed markerless goalkeeper trials onto the approved character."""
import bpy, json, sys
from pathlib import Path
from mathutils import Matrix, Vector
sys.path.insert(0,str(Path(__file__).parent))
import create_striker_prototype as base
from refine_football_model import refine_character
clips=json.loads(Path('/tmp/penalty-keeper-poses.json').read_text())
bpy.ops.wm.open_mainfile(filepath=str(base.OUTPUT/'striker-mocap.blend'))
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
rig.animation_data_clear()
for action in list(bpy.data.actions):bpy.data.actions.remove(action)
objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and any(m.type=='ARMATURE' and m.object==rig for m in o.modifiers)]
for obj in objects:
    glove_index=next(i for i,m in enumerate(obj.data.materials) if m.name=='Socks')
    hand_groups={g.index for g in obj.vertex_groups if g.name.startswith('hand.')}
    for face in obj.data.polygons:
        weight=sum(sum(g.weight for g in obj.data.vertices[v].groups if g.group in hand_groups) for v in face.vertices)/len(face.vertices)
        if weight>.6:face.material_index=glove_index
    kit=next(m for m in obj.data.materials if m.name=='Kit')
    next(n for n in kit.node_tree.nodes if n.type=='BSDF_PRINCIPLED').inputs['Base Color'].default_value=(.7,.29,.08,1)
refine_character(rig,True)
objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and any(m.type=='ARMATURE' and m.object==rig for m in o.modifiers)]

def v(p):return Vector((p[0],-p[2],p[1]))
scene=bpy.context.scene; scene.render.fps=120;scene.frame_start=0
rig.animation_data_create()
for clip in clips:
    for bone in rig.pose.bones:bone.matrix_basis=Matrix.Identity(4)
    action=bpy.data.actions.new('Keeper_'+clip['name'])
    rig.animation_data.action=action
    previous={}
    for frame,p in enumerate(clip['frames']):
        scene.frame_set(frame)
        up=v(p['up']);right=v(p['right']);back=up.cross(right).normalized()
        rot=Matrix((right,back,up)).transposed()
        hip=v(p['hip']);shoulder=v(p['shoulder'])
        matrices={'root':Matrix.Identity(4)}
        for name,offset in [('pelvis',0),('spine',.19),('chest',.43),('neck',.51),('head',.63)]:
            matrices[name]=Matrix.Translation(hip+up*offset)@rot.to_4x4()@rig.data.bones[name].matrix_local.to_3x3().to_4x4()
        for i,side in enumerate(['L','R']):
            points={k:v(p[k][i]) for k in ['shoulders','elbows','hands','hips','knees','feet']}
            def segment(name,a,b):matrices[name+'.'+side]=base.segment_matrix(a,b)
            segment('clavicle',shoulder,points['shoulders'])
            segment('upper_arm',points['shoulders'],points['elbows'])
            segment('forearm',points['elbows'],points['hands'])
            direction=(points['hands']-points['elbows']).normalized()
            segment('hand',points['hands'],points['hands']+direction*.08)
            segment('thigh',points['hips'],points['knees'])
            segment('shin',points['knees'],points['feet'])
            toe=points['feet']+v(p['footDirections'][i])*.16
            segment('foot',points['feet'],toe)
            segment('toe',toe,toe+v(p['footDirections'][i])*.09)
        # Small source/target proportion differences must not put the shoes below turf.
        lift=max(0,.075-min(v(f).z for f in p['feet']))
        for name in base.BONE_NAMES:
            bone=rig.pose.bones[name]
            bone.matrix=matrices[name] if name=='root' else Matrix.Translation(Vector((0,0,lift)))@matrices[name]
            bpy.context.view_layer.update()
        # Evaluate the actual deformed skin, including gloves and soles at landing.
        depsgraph=bpy.context.evaluated_depsgraph_get()
        lowest=min((obj.matrix_world @ vertex.co).z for obj in objects for vertex in obj.evaluated_get(depsgraph).data.vertices)
        rig.pose.bones['root'].matrix=Matrix.Translation(Vector((0,0,max(0,.002-lowest))))@rig.pose.bones['root'].matrix
        bpy.context.view_layer.update()
        for name in base.BONE_NAMES:
            bone=rig.pose.bones[name]
            bone.rotation_mode='QUATERNION'
            if name in previous and previous[name].dot(bone.rotation_quaternion)<0:bone.rotation_quaternion.negate()
            previous[name]=bone.rotation_quaternion.copy()
            bone.keyframe_insert(data_path='location',frame=frame,group=name)
            bone.keyframe_insert(data_path='rotation_quaternion',frame=frame,group=name)
    for layer in action.layers:
        for strip in layer.strips:
            for bag in strip.channelbags:
                for curve in bag.fcurves:
                    for key in curve.keyframe_points:key.interpolation='LINEAR'
    track=rig.animation_data.nla_tracks.new();track.name=action.name
    strip=track.strips.new(action.name,0,action);strip.action_slot=action.slots[0]
    track.mute=True
rig.animation_data.action=action
scene.frame_end=len(clip['frames'])-1;scene.frame_set(0)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
for obj in objects:obj.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=str(base.OUTPUT/'keeper-prototype.blend'))
from io_scene_gltf2.io.exp import meshopt
meshopt.QUAT_FILTER_BITS=16
bpy.ops.export_scene.gltf(filepath=str(base.OUTPUT/'keeper-prototype.glb'),export_format='GLB',use_selection=True,
    export_animations=True,export_animation_mode='ACTIONS',export_frame_range=False,export_skins=True,
    export_force_sampling=True,export_optimize_animation_size=True,export_meshopt_compression_enable=True,
    export_image_format='JPEG',export_image_quality=85,export_lights=False,export_cameras=False)
meta=json.loads((base.OUTPUT/'striker-mocap.json').read_text())
meta.update(source='Monteiro et al. 2024, Figshare 23507793; markerless goalkeeper trials N05D and O05E',license='CC BY 4.0 motion data; CC0 Quaternius model',framesPerSecond=120,
    glbBytes=(base.OUTPUT/'keeper-prototype.glb').stat().st_size,clips=[{'name':'Keeper_'+c['name'],'durationSeconds':(len(c['frames'])-1)/120} for c in clips])
for key in ['contactSeconds','sourceStartSeconds','kickingSide','durationSeconds']:meta.pop(key,None)
meta['triangles']=0
for obj in objects:
    obj.data.calc_loop_triangles();meta['triangles']+=len(obj.data.loop_triangles)
(base.OUTPUT/'keeper-prototype.json').write_text(json.dumps(meta,indent=2)+'\n')
print('KEEPER',json.dumps(meta))
