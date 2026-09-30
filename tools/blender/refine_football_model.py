"""Refine the shared football body and keeper gloves without changing the rig."""
import json
import math
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix, Vector


def refine_character(rig, keeper=False):
    objects = [o for o in bpy.context.scene.objects if o.type == 'MESH'
               and any(m.type == 'ARMATURE' and m.object == rig for m in o.modifiers)]
    for obj in objects:
        groups = {g.index: g.name for g in obj.vertex_groups}
        if not obj.data.get('football_refinement'):
            for vertex in obj.data.vertices:
                weights = {groups[g.group]: g.weight for g in vertex.groups}
                torso = sum(weights.get(n, 0) for n in ['pelvis', 'spine', 'chest'])
                vertex.co.x *= 1 - .035 * torso
                vertex.co.y = -.04 + (vertex.co.y + .04) * (1 - .10 * torso)
                for side in ['L', 'R']:
                    for part, taper in [('upper_arm', .07), ('forearm', .05), ('thigh', .045), ('shin', -.045)]:
                        name = part + '.' + side
                        weight = weights.get(name, 0)
                        bone = rig.data.bones[name]
                        axis = (bone.tail_local - bone.head_local).normalized()
                        offset = vertex.co - bone.head_local
                        vertex.co -= (offset - axis * offset.dot(axis)) * taper * weight
                # The shoulder cap follows arm elevation; the inner sleeve
                # carries a gradual blend across the chest and clavicle.
                for side, sign in [('L', -1), ('R', 1)]:
                    x = sign * vertex.co.x
                    if x < .12 or vertex.co.z < 1.32:
                        continue
                    names = ['clavicle.' + side, 'upper_arm.' + side, 'chest']
                    total = sum(weights.get(n, 0) for n in names)
                    if total < .01:
                        continue
                    q = max(0, min(1, (x - .12) / .075))
                    blend = q * q * (3 - 2 * q)
                    for name, weight in zip(names, [total * (1 - blend), total * blend, 0]):
                        obj.vertex_groups[name].add([vertex.index], weight, 'REPLACE')
            obj.data['football_refinement'] = 1
        if not obj.data.get('cloth_smoothing'):
            mesh = bmesh.new()
            mesh.from_mesh(obj.data)
            cloth = [v for v in mesh.verts if 1.04 < v.co.z < 1.43 and abs(v.co.x) < .18]
            for _ in range(6):
                bmesh.ops.smooth_vert(mesh, verts=cloth, factor=.35, use_axis_x=False, use_axis_y=True, use_axis_z=False)
            mesh.to_mesh(obj.data)
            mesh.free()
            obj.data['cloth_smoothing'] = 1
        if keeper and not obj.data.get('keeper_refinement'):
            for vertex in obj.data.vertices:
                for group in vertex.groups:
                    name = groups[group.group]
                    if not name.startswith('hand.') or group.weight < .01:
                        continue
                    bind = rig.data.bones[name].matrix_local
                    point = bind.inverted() @ vertex.co
                    padded = Vector((point.x * 1.16, point.y * 1.04, point.z * 1.32))
                    vertex.co = vertex.co.lerp(bind @ padded, group.weight)
            obj.data['keeper_refinement'] = 1
        obj.data.normals_split_custom_set_from_vertices([(0, 0, 0)] * len(obj.data.vertices))
        obj.data.update()
        for material in obj.data.materials:
            if material.name in ['Kit', 'Shorts', 'Socks']:
                node = next(n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
                node.inputs['Roughness'].default_value = .9
    if keeper and not rig.get('glove_cuffs'):
        vertices, faces, assignments = [], [], []
        sides = 12
        for side in ['L', 'R']:
            bind = rig.data.bones['hand.' + side].matrix_local
            start = len(vertices)
            for along, width, depth in [(-.025, .039, .027), (-.008, .043, .031), (.014, .040, .028)]:
                for i in range(sides):
                    angle = math.tau * i / sides
                    vertices.append(bind @ Vector((width * math.cos(angle), along, depth * math.sin(angle))))
                    assignments.append(side)
            for row in range(2):
                for i in range(sides):
                    a = start + row * sides + i
                    b = start + row * sides + (i + 1) % sides
                    faces.append((a, a + sides, b + sides, b))
        data = bpy.data.meshes.new('GloveCuffs')
        data.from_pydata(vertices, [], faces)
        cuffs = bpy.data.objects.new('GloveCuffs', data)
        bpy.context.collection.objects.link(cuffs)
        cuffs.data.materials.append(next(m for m in objects[0].data.materials if m.name == 'Shorts'))
        for side in ['L', 'R']:
            group = cuffs.vertex_groups.new(name='hand.' + side)
            group.add([i for i, s in enumerate(assignments) if s == side], 1, 'REPLACE')
        cuffs.parent = rig
        cuffs.matrix_parent_inverse = Matrix.Identity(4)
        modifier = cuffs.modifiers.new('Armature', 'ARMATURE')
        modifier.object = rig
        for face in data.polygons:
            face.use_smooth = True
        bpy.ops.object.select_all(action='DESELECT')
        cuffs.select_set(True)
        objects[0].select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        rig['glove_cuffs'] = 1
    if keeper:
        from repair_keeper_skin import repair_jersey
        repair_jersey(rig)


def rebuild():
    assets = Path(__file__).resolve().parents[2] / 'assets' / 'characters'
    bpy.context.preferences.filepaths.save_version = 0
    for name in ['striker-mocap', 'keeper-prototype']:
        bpy.ops.wm.open_mainfile(filepath=str(assets / (name + '.blend')))
        rig = next(o for o in bpy.context.scene.objects if o.type == 'ARMATURE')
        refine_character(rig, name.startswith('keeper'))
        bpy.ops.object.select_all(action='DESELECT')
        rig.select_set(True)
        objects = [o for o in bpy.context.scene.objects if o.type == 'MESH'
                   and any(m.type == 'ARMATURE' and m.object == rig for m in o.modifiers)]
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.wm.save_as_mainfile(filepath=str(assets / (name + '.blend')))
        from io_scene_gltf2.io.exp import meshopt
        meshopt.QUAT_FILTER_BITS = 16
        bpy.ops.export_scene.gltf(filepath=str(assets / (name + '.glb')), export_format='GLB', use_selection=True,
            export_animations=True, export_animation_mode='ACTIONS', export_frame_range=False, export_skins=True,
            export_force_sampling=True, export_optimize_animation_size=True, export_meshopt_compression_enable=True,
            export_image_format='JPEG', export_image_quality=85, export_lights=False, export_cameras=False)
        triangles = 0
        for obj in objects:
            obj.data.calc_loop_triangles()
            triangles += len(obj.data.loop_triangles)
        meta = json.loads((assets / (name + '.json')).read_text())
        meta.update(triangles=triangles, glbBytes=(assets / (name + '.glb')).stat().st_size)
        (assets / (name + '.json')).write_text(json.dumps(meta, indent=2) + '\n')
        print('REFINED', name, triangles, meta['glbBytes'])


if __name__ == '__main__':
    rebuild()
