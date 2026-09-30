"""Retarget CMU 10_01 positions to the existing fixed-length football rig.
Run node tools/mocap/sample-cmu.mjs first. Sources/terms accompany the BVH.
"""
import json, math, sys
from pathlib import Path
import bpy
from mathutils import Vector, Matrix
sys.path.insert(0, str(Path(__file__).parent))
import create_striker_prototype as base
from refine_football_model import refine_character

DATA=json.loads(Path('/tmp/penalty-cmu-samples.json').read_text())
OUTPUT=base.OUTPUT
NAME='striker-mocap'
FPS=60
CONTACT=1.85
SCALE=.0103
bpy.ops.wm.open_mainfile(filepath=str(OUTPUT/'striker-quaternius.blend'))
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
rig.animation_data_clear()
for b in rig.pose.bones: b.matrix_basis=Matrix.Identity(4)
bpy.context.view_layer.update()
# BVH is Y-up facing +Z; Blender authoring is Z-up facing -Y.
# The existing rig's L/R labels are opposite the donor's anatomical labels.
def convert(p): return Vector((p[0],-p[2],p[1]))*SCALE
frames=[{k:convert(v) for k,v in f.items()} for f in DATA['frames']]

def body_rotation(f, lower=False):
    x=(f['lThigh']-f['rThigh'] if lower else f['lShldr']-f['rShldr']).normalized()
    z=(f['neck']-f['hip']).normalized()
    y=z.cross(x).normalized(); x=y.cross(z).normalized()
    return Matrix((x,y,z)).transposed()

floors={s:sorted(f[s+'Foot'].z for f in frames)[len(frames)//10] for s in ['l','r']}
def smooth(q):
    q=max(0,min(1,q));return q*q*q*(10+q*(-15+6*q))

shoe_vertices={side:[] for side in ['L','R']}
for obj in bpy.context.scene.objects:
    if obj.type!='MESH':continue
    for side in ['L','R']:
        group=obj.vertex_groups.get('foot.'+side)
        if group:
            shoe_vertices[side].extend(v.co.copy() for v in obj.data.vertices if any(g.group==group.index and g.weight>.99 for g in v.groups))

def grounded_foot(f,source,side):
    ankle=f[source+'Foot'].copy()
    ankle.z=max(.065,ankle.z-floors[source]+.065)
    direction=(f[source+'FootEnd']-f[source+'Foot']).normalized()
    direction.z+=.28;direction.normalize()
    transform=base.segment_matrix(ankle,ankle+direction)@rig.data.bones['foot.'+side].matrix_local.inverted()
    lowest=min((transform@point).z for point in shoe_vertices[side])
    ankle.z+=max(0,.004-lowest)
    return ankle,direction

poses=[]
for frame,f in enumerate(frames):
    hip=f['hip'].copy(); hip.z+=.055
    pelvis=body_rotation(f,True); chest=body_rotation(f)
    feet={}; hips={}; footdirs={}
    for side,source,sign in [('L','r',-1),('R','l',1)]:
        ankle,footdir=grounded_foot(f,source,side)
        time=frame/FPS
        if source=='l':
            lock=smooth((time-1.48)/.17)*(1-smooth((time-2.55)/.35))
            anchor,anchor_direction=grounded_foot(frames[99],source,side)
            ankle=ankle.lerp(anchor,lock)
            footdir=footdir.lerp(anchor_direction,lock).normalized()
        feet[side]=ankle
        footdirs[side]=footdir
        hips[side]=pelvis@Vector((sign*.125,0,0))
    # Lower the pelvis only when needed to keep the captured foot targets reachable.
    for side in ['L','R']:
        offset=hips[side]; foot=feet[side]
        horizontal=(hip.x+offset.x-foot.x)**2+(hip.y+offset.y-foot.y)**2
        hip.z=min(hip.z,foot.z+math.sqrt(max(.01,.854**2-horizontal))-offset.z)
    matrices={}
    def segment(name,a,b): matrices[name]=base.segment_matrix(a,b)
    def torso(name,head,rotation):
        b=rig.data.bones[name]
        matrices[name]=Matrix.Translation(head)@rotation.to_4x4()@b.matrix_local.to_3x3().to_4x4()
        return head+rotation@(b.tail_local-b.head_local)
    spine=torso('pelvis',hip,pelvis)
    top=torso('spine',spine,chest)
    torso('chest',top,chest)
    neck=top+chest@Vector((0,0,.08))
    torso('neck',neck,chest)
    torso('head',neck+chest@Vector((0,0,.12)),chest)
    shoulder_center=top+chest@Vector((0,0,.06))
    for side,source,sign in [('L','r',-1),('R','l',1)]:
        shoulder=shoulder_center+chest@Vector((sign*.195,0,0))
        segment('clavicle.'+side,shoulder_center,shoulder)
        # The capture starts in a prepared, open-arm stance. Fade from a relaxed
        # rest pose before the run-up; retain captured arm directions in the kick.
        motion_blend=smooth((frame/FPS-.35)/.60)
        upper_capture=(f[source+'ForeArm']-f[source+'Shldr']).normalized()
        lower_capture=(f[source+'Hand']-f[source+'ForeArm']).normalized()
        upper_rest=chest@Vector((sign*.08,-.015,-1)).normalized()
        lower_rest=chest@Vector((sign*.04,-.14,-1)).normalized()
        upper_direction=upper_rest.lerp(upper_capture,motion_blend).normalized()
        lower_direction=lower_rest.lerp(lower_capture,motion_blend).normalized()
        elbow=shoulder+upper_direction*.29
        wrist=elbow+lower_direction*.27
        segment('upper_arm.'+side,shoulder,elbow)
        segment('forearm.'+side,elbow,wrist)
        # Daz finger joints are synthetic, not captured wrist/finger motion.
        # Keep the wrist aligned with its forearm with a small relaxed flexion.
        hand_direction=(lower_direction+chest@Vector((0,-.045,-.025))).normalized()
        hand=wrist+hand_direction*rig.data.bones['hand.'+side].length
        segment('hand.'+side,wrist,hand)
        thigh=hip+hips[side]; ankle=feet[side]
        knee=Vector(base.solve_joint(thigh,ankle,.43,.43,f[source+'Shin']-(thigh+ankle)*.5))
        segment('thigh.'+side,thigh,knee); segment('shin.'+side,knee,ankle)
        footdir=footdirs[side]
        toe=ankle+footdir*rig.data.bones['foot.'+side].length
        segment('foot.'+side,ankle,toe)
        segment('toe.'+side,toe,toe+footdir*rig.data.bones['toe.'+side].length)
    poses.append(matrices)
# Anchor the kicking shoe at the preview's physical ball at the contact event.
anchor=poses[round(CONTACT*FPS)]['foot.L']@Vector((0,.23,0))
shift=Vector((-anchor.x,-anchor.y+.105,0))
animation=bpy.data.actions.new('CMU_10_01_Runup_Kick_Recovery')
rig.animation_data_create();rig.animation_data.action=animation
previous={}
for frame,pose in enumerate(poses):
    bpy.context.scene.frame_set(frame)
    for name in base.BONE_NAMES:
        b=rig.pose.bones[name]
        b.matrix=Matrix.Identity(4) if name=='root' else Matrix.Translation(shift)@pose[name]
        bpy.context.view_layer.update();b.rotation_mode='QUATERNION'
        if name in previous and previous[name].dot(b.rotation_quaternion)<0:b.rotation_quaternion.negate()
        previous[name]=b.rotation_quaternion.copy()
        b.keyframe_insert(data_path='location',frame=frame,group=name)
        b.keyframe_insert(data_path='rotation_quaternion',frame=frame,group=name)
for layer in animation.layers:
    for strip in layer.strips:
        for bag in strip.channelbags:
            for curve in bag.fcurves:
                for key in curve.keyframe_points:key.interpolation='LINEAR'
scene=bpy.context.scene;scene.frame_start=0;scene.frame_end=len(poses)-1;scene.render.fps=FPS
scene.timeline_markers.clear();scene.timeline_markers.new('BALL CONTACT',frame=round(CONTACT*FPS))
scene.frame_set(0)
refine_character(rig)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
for o in scene.objects:
    if o.type=='MESH' and any(m.type=='ARMATURE' and m.object==rig for m in o.modifiers):o.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT/(NAME+'.blend')))
from io_scene_gltf2.io.exp import meshopt
meshopt.QUAT_FILTER_BITS=16
bpy.ops.export_scene.gltf(filepath=str(OUTPUT/(NAME+'.glb')),export_format='GLB',use_selection=True,
    export_animations=True,export_skins=True,export_yup=True,export_force_sampling=True,export_optimize_animation_size=True,
    export_nla_strips=False,export_lights=False,export_cameras=False,export_meshopt_compression_enable=True,
    export_image_format='JPEG',export_image_quality=85)
meta=json.loads((OUTPUT/'striker-quaternius.json').read_text());meta.pop('supportFootLock',None)
meta.update(source='CMU 10_01 via cgspeed Daz-friendly conversion; Quaternius character',
    license='CC0 character; CMU motion data terms (see mocap/cmu-soccer/README.md)',
    durationSeconds=(len(poses)-1)/FPS,contactSeconds=CONTACT,sourceStartSeconds=DATA['start'],
    kickingSide='L',glbBytes=(OUTPUT/(NAME+'.glb')).stat().st_size)
meta['budgets']['glbBytes']=450000
(OUTPUT/(NAME+'.json')).write_text(json.dumps(meta,indent=2)+'\n')
print('MOCAP',json.dumps(meta))
