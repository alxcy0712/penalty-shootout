"""Give the keeper a rounded jersey with rigid, overlapping shoulder caps."""
from pathlib import Path
import math
import bpy, bmesh, json
from mathutils import Matrix, Vector


def repair_jersey(rig):
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH'
             and any(m.type=='ARMATURE' and m.object==rig for m in o.modifiers)]
    material=next(m for o in objects for m in o.data.materials if m.name=='Kit')
    for obj in objects:
        if obj.get('keeper_jersey'):
            data=obj.data
            bpy.data.objects.remove(obj,do_unlink=True)
            bpy.data.meshes.remove(data)
            continue
        mesh=bmesh.new();mesh.from_mesh(obj.data)
        faces=[f for f in mesh.faces if obj.data.materials[f.material_index].name=='Kit']
        bmesh.ops.delete(mesh,geom=faces,context='FACES')
        mesh.to_mesh(obj.data);mesh.free();obj.data.update()
        if obj.data.get('keeper_sleeve_weights'):continue
        for side in ['L','R']:
            upper=obj.vertex_groups.get('upper_arm.'+side);forearm=obj.vertex_groups.get('forearm.'+side)
            if not upper or not forearm:continue
            inverse=rig.data.bones['upper_arm.'+side].matrix_local.inverted()
            for vertex in obj.data.vertices:
                weights={g.group:g.weight for g in vertex.groups}
                total=weights.get(upper.index,0)+weights.get(forearm.index,0)
                along=(inverse@vertex.co).y
                if total<.5 or along>.27:continue
                blend=max(0,min(1,(along-.18)/.09));blend=blend*blend*(3-2*blend)
                lower=weights.get(forearm.index,0)*blend
                upper.add([vertex.index],total-lower,'REPLACE');forearm.add([vertex.index],lower,'REPLACE')
        obj.data['keeper_sleeve_weights']=1
    vertices,faces,groups=[],[],[]
    sides=24

    def tube(rings,bone,transform=None):
        start=len(vertices)
        for along,width,depth in rings:
            for i in range(sides):
                angle=math.tau*i/sides
                point=Vector((width*math.cos(angle),along,depth*math.sin(angle)))
                vertices.append(transform@point if transform else Vector((point.x,-point.z,point.y)))
                groups.append(bone)
        for row in range(len(rings)-1):
            for i in range(sides):
                a=start+row*sides+i;b=start+row*sides+(i+1)%sides
                faces.append((a,a+sides,b+sides,b))
        if transform:faces.append(tuple(start+i for i in range(sides)))

    tube([(.935,.172,.108),(1.065,.172,.108),(1.16,.174,.113),(1.30,.205,.120),
          (1.415,.225,.114),(1.465,.078,.070)],'chest')
    # Each sleeve includes a spherical cap about the actual shoulder pivot.
    # Its overlap with the torso keeps the seam covered through the full swing.
    for side in ['L','R']:
        bone='upper_arm.'+side
        tube([(-.075,.025,.025),(-.055,.055,.055),(0,.080,.080),
              (.10,.087,.087),(.18,.083,.083)],bone,rig.data.bones[bone].matrix_local)
    data=bpy.data.meshes.new('KeeperJersey');data.from_pydata(vertices,[],faces)
    jersey=bpy.data.objects.new('KeeperJersey',data);bpy.context.collection.objects.link(jersey)
    data.materials.append(material);jersey['keeper_jersey']=1
    for name in ['chest','upper_arm.L','upper_arm.R']:
        group=jersey.vertex_groups.new(name=name)
        group.add([i for i,g in enumerate(groups) if g==name],1,'REPLACE')
    jersey.parent=rig
    modifier=jersey.modifiers.new('Armature','ARMATURE');modifier.object=rig
    for face in data.polygons:face.use_smooth=True


def rebuild():
    asset=Path(__file__).resolve().parents[2]/'assets/characters/keeper-prototype'
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.open_mainfile(filepath=str(asset.with_suffix('.blend')))
    rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
    repair_jersey(rig)
    bpy.ops.object.select_all(action='DESELECT');rig.select_set(True)
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH'
             and any(m.type=='ARMATURE' and m.object==rig for m in o.modifiers)]
    scene=bpy.context.scene;active=rig.animation_data.action
    for action in bpy.data.actions:
        rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
        for frame in range(math.floor(action.frame_range[0]),math.ceil(action.frame_range[1])+1):
            scene.frame_set(frame);depsgraph=bpy.context.evaluated_depsgraph_get()
            lowest=min((obj.matrix_world@v.co).z for obj in objects for v in obj.evaluated_get(depsgraph).data.vertices)
            if lowest<.002:
                root=rig.pose.bones['root'];root.matrix=Matrix.Translation(Vector((0,0,.002-lowest)))@root.matrix
                root.keyframe_insert(data_path='location',frame=frame,group='root')
    rig.animation_data.action=active;scene.frame_set(0)
    for obj in objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.wm.save_as_mainfile(filepath=str(asset.with_suffix('.blend')))
    from io_scene_gltf2.io.exp import meshopt
    meshopt.QUAT_FILTER_BITS=16
    bpy.ops.export_scene.gltf(filepath=str(asset.with_suffix('.glb')),export_format='GLB',use_selection=True,
        export_animations=True,export_animation_mode='ACTIONS',export_frame_range=False,export_skins=True,
        export_force_sampling=True,export_optimize_animation_size=True,export_meshopt_compression_enable=True,
        export_image_format='JPEG',export_image_quality=85,export_lights=False,export_cameras=False)
    meta=json.loads(asset.with_suffix('.json').read_text());meta['glbBytes']=asset.with_suffix('.glb').stat().st_size
    for obj in objects:obj.data.calc_loop_triangles()
    meta['triangles']=sum(len(obj.data.loop_triangles) for obj in objects)
    asset.with_suffix('.json').write_text(json.dumps(meta,indent=2)+'\n')


if __name__=='__main__':rebuild()
