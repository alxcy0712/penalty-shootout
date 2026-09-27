"""Fit the CC0 Quaternius Standard human to the project's striker prototype rig."""
import json
import sys
from pathlib import Path
import bpy
import bmesh
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).parent))
import create_striker_prototype as base
from striker_body_motion import action_pose

SOURCE = base.OUTPUT / 'quaternius-source'
NAME = 'striker-quaternius'


def make_character(rig, materials):
    # Preserve the vendor input while omitting maps unused by this prototype.
    data = json.loads((SOURCE / 'Superhero_Male_FullBody.gltf').read_text())
    for material in data['materials']:
        material.pop('normalTexture', None)
        material.pop('occlusionTexture', None)
        material.get('pbrMetallicRoughness', {}).pop('metallicRoughnessTexture', None)
    source_path = SOURCE / 'prototype-import.gltf'
    source_path.write_text(json.dumps(data))
    try:
        bpy.ops.import_scene.gltf(filepath=str(source_path))
    finally:
        source_path.unlink()
    donor = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE' and o != rig)
    objects = [bpy.data.objects[n] for n in ['SuperHero_Male', 'Eyes', 'Eyebrows']]
    mapping = {'root':'root', 'pelvis':'pelvis', 'spine_01':'spine', 'spine_02':'spine',
               'spine_03':'chest', 'neck_01':'neck', 'Head':'head'}
    for old, new in [('l','R'), ('r','L')]:
        for a,b in [('clavicle','clavicle'), ('upperarm','upper_arm'), ('lowerarm','forearm'),
                    ('hand','hand'), ('thigh','thigh'), ('calf','shin'), ('foot','foot'), ('ball','toe')]:
            mapping[a+'_'+old] = b+'.'+new
        for bone in donor.data.bones:
            if bone.name.endswith('_'+old) and bone.name not in mapping:
                mapping[bone.name] = 'hand.'+new if 'ball_' not in bone.name else 'toe.'+new
    transforms = {}
    for old, new in mapping.items():
        source = donor.data.bones[old]
        target = rig.data.bones[new]
        if new.startswith('hand.'):
            source = donor.data.bones['hand_'+('l' if new.endswith('R') else 'r')]
        source_head, target_head = source.head_local, target.head_local.copy()
        if old == 'spine_02': target_head = Vector((0,0,1.23))
        rotation = (source.tail_local-source.head_local).rotation_difference(target.tail_local-target.head_local)
        if old in ['pelvis','spine_01','spine_02','spine_03','neck_01','Head']:
            rotation = Matrix.Identity(3).to_quaternion()
        transform = Matrix.Translation(target_head) @ rotation.to_matrix().to_4x4() @ Matrix.Translation(-source_head)
        transforms[old] = transform

    # Two small color maps preserve authored facial detail; cloth shares flat kit colors.
    skin = objects[0].data.materials[0]
    eyes = objects[1].data.materials[0]
    skin.name = 'Skin'; eyes.name = 'Eyes'
    for material, size in [(skin,512),(eyes,128)]:
        for node in material.node_tree.nodes:
            if node.type == 'TEX_IMAGE' and node.image:
                node.image.scale(size,size)
                node.image.pack()
        principled = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
        principled.inputs['Roughness'].default_value = 0.72
    palette = [skin,materials['Kit'],materials['Shorts'],materials['Socks'],materials['Boots'],eyes]
    for obj in objects:
        while len(obj.data.uv_layers)>1:obj.data.uv_layers.remove(obj.data.uv_layers[-1])
        for color in list(obj.data.color_attributes):obj.data.color_attributes.remove(color)
        if obj.name == 'SuperHero_Male':
            bm=bmesh.new();bm.from_mesh(obj.data)
            # Cut clean garment edges into the existing topology before recoloring.
            for axis, level in [(2,0.105),(2,0.47),(2,0.67),(2,1.01),(2,1.47),(2,1.75),(0,-0.36),(0,0.36),(0,-0.075),(0,0.075)]:
                point=Vector();point[axis]=level
                normal=Vector();normal[axis]=1
                bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=0.000001,
                    plane_co=point,plane_no=normal,clear_inner=False,clear_outer=False)
            bmesh.ops.delete(bm,geom=[v for v in bm.verts if v.co.z<0.1049],context='VERTS')
            bm.to_mesh(obj.data);bm.free()
        original_points = [v.co.copy() for v in obj.data.vertices]
        assignments = []
        for vertex in obj.data.vertices:
            weights = {}
            position = Vector()
            total = 0
            for group in vertex.groups:
                name = obj.vertex_groups[group.group].name
                if name not in mapping: continue
                weight = group.weight
                target_name = mapping[name]
                weights[target_name] = weights.get(target_name,0)+weight
                fitted = transforms[name] @ vertex.co
                if target_name in ['pelvis','spine','chest','neck'] or target_name.startswith('clavicle.'):
                    # One continuous torso warp avoids conflicting per-bone
                    # translations bunching the chest and clavicle surface.
                    fitted=vertex.co + Vector((0,-.04,-.0498))
                position += fitted*weight
                total += weight
            if total:
                vertex.co = position / total
                weights = {key:value/total for key,value in weights.items()}
                # Remove tiny remote thigh influences on the lower calf while
                # preserving the donor's knee blend above this region.
                calf_blend = base.smooth((vertex.co.z-0.30)/0.10)
                for side in ['L','R']:
                    thigh,shin=f'thigh.{side}',f'shin.{side}'
                    transfer=weights.get(thigh,0)*(1-calf_blend)
                    if transfer:
                        weights[thigh]-=transfer
                        weights[shin]=weights.get(shin,0)+transfer
            # Shape the torso and arm cross-sections in Blender rest space.
            # Facial geometry, UVs and its skin weights stay untouched.
            if obj.name == 'SuperHero_Male' and weights:
                torso_weight = sum(weights.get(n,0) for n in ['pelvis','spine','chest'])
                vertex.co.x *= 1 - .065 * torso_weight
                vertex.co.y *= 1 - .055 * torso_weight
                for side in ['L','R']:
                    for name in [f'upper_arm.{side}',f'forearm.{side}']:
                        weight = weights.get(name,0)
                        if not weight: continue
                        bone = rig.data.bones[name]
                        axis = (bone.tail_local-bone.head_local).normalized()
                        offset = vertex.co-bone.head_local
                        radial = offset-axis*offset.dot(axis)
                        vertex.co -= radial * (.13*weight)
                for side in ['L','R']:
                    hand_weight=weights.get(f'hand.{side}',0)
                    wrist=rig.data.bones[f'hand.{side}'].head_local
                    # Taper the scale change into the wrist; preserve forearm length.
                    vertex.co=wrist+(vertex.co-wrist)*(1-.12*hand_weight)
            assignments.append(weights)
        obj.vertex_groups.clear()
        for name in base.BONE_NAMES: obj.vertex_groups.new(name=name)
        for i, weights in enumerate(assignments):
            for name, weight in weights.items(): obj.vertex_groups[name].add([i],weight,'REPLACE')
        obj.data.materials.clear()
        for material in palette: obj.data.materials.append(material)
        for face in obj.data.polygons:
            center = sum((original_points[i] for i in face.vertices),Vector())/len(face.vertices)
            x,y,z = center
            if obj.name == 'Eyes': material_index=5
            elif obj.name == 'Eyebrows': material_index=4
            elif z > 1.75: material_index=4
            elif z < 0.105: material_index=4
            elif z < 0.47: material_index=3
            elif 0.67 < z < 1.01: material_index=2
            elif 1.01 <= z < 1.58 and abs(x)<0.36 and (z<1.47 or abs(x)>0.075): material_index=1
            else: material_index=0
            face.material_index=material_index
            face.use_smooth=True
        for modifier in obj.modifiers:
            if modifier.type=='ARMATURE':modifier.object=rig
        obj.parent=rig
        obj.matrix_parent_inverse=Matrix.Identity(4)
        # The imported custom normals describe the donor's T-pose. Recompute
        # them after rest-fitting so the chest and sleeves shade continuously.
        obj.data.normals_split_custom_set_from_vertices([(0.0,0.0,0.0)]*len(obj.data.vertices))
        obj.data.update()
    bpy.data.objects.remove(donor,do_unlink=True)
    shoes=base.MeshBuilder()
    for side, sign in [('L',-1),('R',1)]:
        weights={f'foot.{side}':1.0}
        shoes.sphere((sign*0.125,-0.080,0.066),(0.064,0.150,0.051),'Boots',weights,sides=18,rows=12)
        shoes.sphere((sign*0.125,-0.078,0.025),(0.067,0.157,0.022),'Boots',weights,sides=18,rows=8)
        for y in [-0.12,-0.075,-0.03]:
            shoes.tube([((sign*0.125-0.024,y,0.108),0.0038,0.0038),((sign*0.125+0.024,y,0.108),0.0038,0.0038)],
                lambda _t:'Socks',lambda _t,_p,w=weights:w,sides=6,rows=4)
    objects.extend(shoes.create_objects(rig,materials))
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.join()
    return [bpy.context.view_layer.objects.active]


def main():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    materials=base.create_materials()
    rig=base.create_armature()
    objects=make_character(rig,materials)
    base.action_pose = action_pose
    base.create_animation(rig)
    base.create_studio()
    bpy.ops.object.select_all(action='DESELECT')
    rig.select_set(True)
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.context.scene.render.fps=base.FPS
    bpy.ops.wm.save_as_mainfile(filepath=str(base.OUTPUT/(NAME+'.blend')))
    # Blender 5.2 defaults to 8-bit quaternion filtering, causing visible foot
    # drift through a two-bone chain. Use 16 bits within this export process.
    from io_scene_gltf2.io.exp import meshopt
    meshopt.QUAT_FILTER_BITS = 16
    bpy.ops.export_scene.gltf(filepath=str(base.OUTPUT/(NAME+'.glb')), export_format='GLB',use_selection=True,
        export_animations=True,export_skins=True,export_yup=True,export_force_sampling=True,export_optimize_animation_size=False,
        export_nla_strips=False,export_lights=False,export_cameras=False,export_meshopt_compression_enable=True,
        export_image_format='JPEG',export_image_quality=85)
    triangles=0
    for obj in objects:obj.data.calc_loop_triangles();triangles+=len(obj.data.loop_triangles)
    metadata=json.loads((base.OUTPUT/'striker-prototype-refined.json').read_text())
    metadata.update(source='Quaternius Universal Base Characters Standard; original in-project football animation',
        license='CC0-1.0 (Quaternius model); in-project animation has no stated repository license',
        triangles=triangles,materials=6,textures=2,meshes=sum(len(set(p.material_index for p in o.data.polygons)) for o in objects),glbBytes=(base.OUTPUT/(NAME+'.glb')).stat().st_size,
        textureSizes=[512,128],budgets={'triangles':18000,'bones':24,'materials':6,'textures':2,'glbBytes':400000})
    (base.OUTPUT/(NAME+'.json')).write_text(json.dumps(metadata,indent=2)+'\n')
    print('CANDIDATE',json.dumps(metadata))

if __name__=='__main__':main()
