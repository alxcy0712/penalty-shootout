"""Retarget a distinct CMU take to the existing fixed-length football rig.
Run node tools/mocap/sample-cmu-variants.mjs first. Sources/terms accompany the BVH.
"""
import json, math, sys, argparse
from pathlib import Path
import bpy
from mathutils import Vector, Matrix
ROOT=Path(__file__).resolve().parents[2]
parser=argparse.ArgumentParser()
parser.add_argument('--samples',default='/tmp/penalty-cmu-10_03.json')
parser.add_argument('--rig-json',default='/tmp/penalty-variant-rig.json')
parser.add_argument('--preview-dir',default=str(ROOT.parent/'character-qa'/'mocap-variants'))
options=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
sys.path.insert(0, str(Path(__file__).parent))
# The existing helper owns an older CLI; isolate its argument parser.
sys.argv=[sys.argv[0]]
import create_striker_prototype as base
DATA=json.loads(Path(options.samples).read_text())
OUTPUT=Path(options.preview_dir);OUTPUT.mkdir(parents=True,exist_ok=True)
NAME='cmu-'+DATA['take']+'-candidate'
FPS=DATA['fps'];RECIPE=DATA['recipe'];CONTACT=RECIPE['contactSource']-DATA['start']
SCALE=.0103
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
rig=base.create_armature()
RIG_DATA=json.loads(Path(options.rig_json).read_text())
for item in RIG_DATA['meshes']:
    mesh=bpy.data.meshes.new(item['name']);mesh.from_pydata(item['vertices'],[],item['faces']);mesh.update()
    obj=bpy.data.objects.new(item['name'],mesh);bpy.context.collection.objects.link(obj)
    material=bpy.data.materials.get(item['material']) or bpy.data.materials.new(item['material']);material.diffuse_color=(*item['color'],1);material.use_nodes=True
    material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(*item['color'],1);material.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.8
    mesh.materials.append(material)
    groups={name:obj.vertex_groups.new(name=name) for name in base.BONE_NAMES}
    for vertex,weights in enumerate(item['weights']):
        for name,weight in weights:groups[name].add([vertex],weight,'REPLACE')
    modifier=obj.modifiers.new('SourceRig','ARMATURE');modifier.object=rig
    for poly in mesh.polygons:poly.use_smooth=True
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

def foot_matrix(ankle,direction,right_hint):
    # A captured pelvis-lateral reference keeps the shoe stable through vertical
    # toe-off and the near-180-degree forward axis without a yaw/roll singularity.
    y=direction.normalized();x=(right_hint-y*right_hint.dot(y)).normalized();z=x.cross(y).normalized()
    rotation=Matrix((x,y,z)).transposed().to_4x4();rotation.translation=ankle
    return rotation

# Offline rotation-minimizing transport preserves the sampled toe axis without
# inventing 180-degree sole rolls at a reference-axis singularity. Near-ground
# portions softly return toward the captured pelvis frame; baked playback stays
# deterministic and has no runtime history dependence.
foot_cache={};previous_feet={}
for frame in frames:
    for source,side in [('r','L'),('l','R')]:
        ankle=frame[source+'Foot'].copy();ankle.z=max(.065,ankle.z-floors[source]+.065)
        direction=(frame[source+'FootEnd']-frame[source+'Foot']).normalized();direction.z+=.28;direction.normalize()
        right_hint=body_rotation(frame,True).col[0]
        desired=foot_matrix(ankle,direction,right_hint).to_quaternion()
        if side in previous_feet:
            previous=previous_feet[side]
            rotation=(previous@Vector((0,1,0))).rotation_difference(direction)@previous
            stable=(1-smooth((abs(direction.z)-.6)/.3))*(1-smooth((abs(right_hint.dot(direction))-.6)/.3))
            rotation=rotation.slerp(desired,(1-math.exp(-12/FPS))*stable)
        else:rotation=desired
        rotation.normalize();previous_feet[side]=rotation.copy()
        transform=Matrix.Translation(ankle)@rotation.to_matrix().to_4x4()@rig.data.bones['foot.'+side].matrix_local.inverted()
        lowest=min((transform@point).z for point in shoe_vertices[side]);ankle.z+=max(0,.004-lowest)
        foot_cache[(id(frame),source)]=(ankle,rotation)

def grounded_foot(frame,source,side):
    ankle,rotation=foot_cache[(id(frame),source)]
    return ankle.copy(),rotation@Vector((0,1,0)),rotation.copy()

poses=[]
for frame,f in enumerate(frames):
    hip=f['hip'].copy(); hip.z+=.055
    pelvis=body_rotation(f,True); chest=body_rotation(f)
    feet={}; hips={}; footdirs={}; footrotations={}
    for side,source,sign in [('L','r',-1),('R','l',1)]:
        ankle,footdir,footrotation=grounded_foot(f,source,side)
        time=frame/FPS
        if source=='l':
            lock=smooth((time-(RECIPE['lockStartSource']-DATA['start']))/(RECIPE['plantSource']-RECIPE['lockStartSource']))*(1-smooth((time-(RECIPE['releaseSource']-DATA['start']))/(RECIPE['lockEndSource']-RECIPE['releaseSource'])))
            anchor,anchor_direction,anchor_rotation=grounded_foot(frames[round((RECIPE['plantSource']-DATA['start'])*FPS)],source,side)
            ankle=ankle.lerp(anchor,lock)
            footdir=footdir.lerp(anchor_direction,lock).normalized()
            footrotation=footrotation.slerp(anchor_rotation,lock).normalized()
            footdir=footrotation@Vector((0,1,0))
        feet[side]=ankle
        footdirs[side]=footdir
        footrotations[side]=footrotation
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
        matrices['clavicle.'+side]=Matrix.Translation(shoulder_center)@chest.to_4x4()@rig.data.bones['clavicle.'+side].matrix_local.to_3x3().to_4x4()
        # Retain this take's actual arm directions, shoulder counterbalance and
        # follow-through; no take01 resting/approach animation is substituted.
        motion_blend=1.0  # Preserve this take's genuinely different captured arm balance.
        upper_capture=(f[source+'ForeArm']-f[source+'Shldr']).normalized()
        lower_capture=(f[source+'Hand']-f[source+'ForeArm']).normalized()
        upper_rest=chest@Vector((sign*.08,-.015,-1)).normalized()
        lower_rest=chest@Vector((sign*.04,-.14,-1)).normalized()
        upper_direction=upper_rest.lerp(upper_capture,motion_blend).normalized()
        lower_direction=lower_rest.lerp(lower_capture,motion_blend).normalized()
        elbow=shoulder+upper_direction*.29
        wrist=elbow+lower_direction*.27
        # Carry roll from the chest through the elbow instead of independently
        # aiming each segment from a fixed world axis (which flips at -Y).
        upper_rotation=chest.to_quaternion()@rig.data.bones['upper_arm.'+side].matrix_local.to_quaternion()
        front=chest@Vector((0,-1,0));rest=upper_rotation@Vector((0,1,0))
        upper_rotation=front.rotation_difference(upper_direction)@rest.rotation_difference(front)@upper_rotation
        lower_local=upper_rotation.inverted()@lower_direction
        lower_rotation=upper_rotation@Vector((0,1,0)).rotation_difference(lower_local)
        matrices['upper_arm.'+side]=Matrix.Translation(shoulder)@upper_rotation.to_matrix().to_4x4()
        matrices['forearm.'+side]=Matrix.Translation(elbow)@lower_rotation.to_matrix().to_4x4()
        # Daz finger joints are synthetic, not captured wrist/finger motion.
        # Keep the wrist aligned with its forearm with a small relaxed flexion.
        hand_direction=(lower_direction+chest@Vector((0,-.045,-.025))).normalized()
        hand=wrist+hand_direction*rig.data.bones['hand.'+side].length
        hand_rotation=lower_rotation@Vector((0,1,0)).rotation_difference(lower_rotation.inverted()@hand_direction)
        matrices['hand.'+side]=Matrix.Translation(wrist)@hand_rotation.to_matrix().to_4x4()
        thigh=hip+hips[side]; ankle=feet[side]
        knee=Vector(base.solve_joint(thigh,ankle,.43,.43,f[source+'Shin']-(thigh+ankle)*.5))
        segment('thigh.'+side,thigh,knee); segment('shin.'+side,knee,ankle)
        footdir=footdirs[side]
        toe=ankle+footdir*rig.data.bones['foot.'+side].length
        matrices['foot.'+side]=Matrix.Translation(ankle)@footrotations[side].to_matrix().to_4x4()
        matrices['toe.'+side]=Matrix.Translation(toe)@footrotations[side].to_matrix().to_4x4()
    poses.append(matrices)
# Anchor the kicking shoe at the preview's physical ball at the contact event.
anchor=poses[round(CONTACT*FPS)]['foot.L']@Vector((0,.23,0))
shift=Vector((-anchor.x,-anchor.y+.105,0))
animation=bpy.data.actions.new('CMU_'+DATA['take']+'_Kick')
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
curves=list(animation.fcurves) if hasattr(animation,'fcurves') else [curve for layer in animation.layers for strip in layer.strips for bag in strip.channelbags for curve in bag.fcurves]
for curve in curves:
    for key in curve.keyframe_points:key.interpolation='LINEAR'
scene=bpy.context.scene;scene.frame_start=0;scene.frame_end=len(poses)-1;scene.render.fps=FPS
scene.timeline_markers.clear();scene.timeline_markers.new('BALL CONTACT',frame=round(CONTACT*FPS))
scene.frame_set(0)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
for o in scene.objects:
    if o.type=='MESH' and any(m.type=='ARMATURE' and m.object==rig for m in o.modifiers):o.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=str(OUTPUT/(NAME+'.blend')))
# Export a standalone full-mesh preview. The delivery finalizer strips all
# mesh/material/image payloads and retains only compatible skeleton + animation.
bpy.ops.export_scene.gltf(filepath=str(OUTPUT/(NAME+'.glb')),export_format='GLB',use_selection=True,
    export_animations=True,export_skins=True,export_yup=True,export_force_sampling=True,export_optimize_animation_size=True,
    export_nla_strips=False,export_lights=False,export_cameras=False,export_image_format='JPEG',export_image_quality=85)
meta={"take":DATA['take'],"source":DATA['source'],"sourceSha256":DATA['sourceSha256'],"sourceStartSeconds":DATA['start'],
    "sourceEndSeconds":DATA['start']+(len(frames)-1)/FPS,"durationSeconds":(len(frames)-1)/FPS,"contactSeconds":CONTACT,
    "approachStartSeconds":RECIPE['approachStartSeconds'],"supportPlantSeconds":RECIPE['plantSource']-DATA['start'],
    "supportReleaseSeconds":RECIPE['releaseSource']-DATA['start'],"kickingSide":"L","supportSide":"R","framesPerSecond":FPS,
    "clipName":'CMU_'+DATA['take']+'_Kick',"sourceKind":"real CMU take, retargeted to existing 22-bone rig",
    "adaptations":["fixed-length IK retarget","chest-referenced arm roll frame","support-foot lock","shoe-floor correction","offline rotation-minimizing foot frame with gentle captured-pelvis correction","contact-space translation"],
    "license":DATA['license'],"previewGlb":str(OUTPUT/(NAME+'.glb'))}
(OUTPUT/(NAME+'.json')).write_text(json.dumps(meta,indent=2)+'\n')
print('MOCAP_VARIANT',json.dumps(meta))
