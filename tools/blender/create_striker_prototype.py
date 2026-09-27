"""Build the original, low-texture striker prototype for motion-lab."""
from __future__ import annotations

import json
import math
import argparse
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "assets" / "characters"
parser = argparse.ArgumentParser()
parser.add_argument('--name', default='striker-prototype-refined')
options = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
GLB_PATH = OUTPUT / (options.name + '.glb')
BLEND_PATH = OUTPUT / (options.name + '.blend')
META_PATH = OUTPUT / (options.name + '.json')
FPS = 60
DURATION = 3.55
IDLE_DURATION = 0.35
ACTION_DURATION = DURATION - IDLE_DURATION
CONTACT_TIME = 1.55
CLIP_CONTACT_TIME = IDLE_DURATION + CONTACT_TIME
SAMPLES = int(DURATION * FPS)
SUPPORT_TOUCHDOWN = 1.22
CLIP_SUPPORT_TOUCHDOWN = IDLE_DURATION + SUPPORT_TOUCHDOWN
SUPPORT_RELEASE = 2.34
CLIP_SUPPORT_RELEASE = IDLE_DURATION + SUPPORT_RELEASE

MATERIAL_COLORS = {
    "Skin": (0.43, 0.22, 0.14, 1.0),
    "Kit": (0.48, 0.78, 0.64, 1.0),
    "Shorts": (0.035, 0.075, 0.082, 1.0),
    "Socks": (0.77, 0.82, 0.77, 1.0),
    "Boots": (0.018, 0.032, 0.035, 1.0),
}

BONE_NAMES = (
    "root", "pelvis", "spine", "chest", "neck", "head",
    "clavicle.L", "upper_arm.L", "forearm.L", "hand.L",
    "clavicle.R", "upper_arm.R", "forearm.R", "hand.R",
    "thigh.L", "shin.L", "foot.L", "toe.L",
    "thigh.R", "shin.R", "foot.R", "toe.R",
)


def bound(value, lower=0.0, upper=1.0):
    return max(lower, min(upper, value))


def smooth(value):
    value = bound(value)
    return value * value * (3.0 - 2.0 * value)


def smoother(value):
    value = bound(value)
    return value**3 * (value * (value * 6.0 - 15.0) + 10.0)


def v_lerp(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def mix_weights(a, b, t):
    t = smooth(t)
    return {a: 1.0 - t, b: t}


class MeshBuilder:
    """Collect a few material meshes with vertex groups ready for skinning."""

    def __init__(self):
        self.parts = {
            name: {"vertices": [], "faces": [], "weights": []}
            for name in MATERIAL_COLORS
        }

    def add_surface(self, vertices, faces, face_materials, weights):
        buckets = {}
        for face, material in zip(faces, face_materials):
            buckets.setdefault(material, []).append(face)
        for material, material_faces in buckets.items():
            part = self.parts[material]
            remap = {}
            for face in material_faces:
                mapped = []
                for vertex_id in face:
                    if vertex_id not in remap:
                        remap[vertex_id] = len(part["vertices"])
                        part["vertices"].append(vertices[vertex_id])
                        part["weights"].append(weights[vertex_id])
                    mapped.append(remap[vertex_id])
                part["faces"].append(mapped)

    def loft(self, controls, material, weight_at, sides=24, rows=20, cap=True):
        vertices, weights, faces = [], [], []
        for row in range(rows + 1):
            t = row / rows
            scaled = t * (len(controls) - 1)
            segment = min(len(controls) - 2, int(scaled))
            q = scaled - segment
            q = q * q * (3.0 - 2.0 * q)
            a, b = controls[segment], controls[segment + 1]
            z, rx, ry = (a[i] + (b[i] - a[i]) * q for i in range(3))
            for side in range(sides):
                angle = side / sides * math.tau
                point = (rx * math.cos(angle), -ry * math.sin(angle), z)
                vertices.append(point)
                weights.append(weight_at(z, t))
        for row in range(rows):
            for side in range(sides):
                a = row * sides + side
                b = row * sides + (side + 1) % sides
                c = (row + 1) * sides + side
                d = (row + 1) * sides + (side + 1) % sides
                faces.extend(((a, c, b), (b, c, d)))
        if cap:
            bottom = len(vertices)
            vertices.append((0.0, 0.0, controls[0][0]))
            weights.append(weight_at(controls[0][0], 0.0))
            top = len(vertices)
            vertices.append((0.0, 0.0, controls[-1][0]))
            weights.append(weight_at(controls[-1][0], 1.0))
            for side in range(sides):
                faces.append((bottom, side, (side + 1) % sides))
                a = rows * sides + side
                b = rows * sides + (side + 1) % sides
                faces.append((top, b, a))
        self.add_surface(vertices, faces, [material] * len(faces), weights)

    def tube(self, controls, material_at, weight_at, sides=14, rows=40):
        path = [Vector(item[0]) for item in controls]
        vertices, weights, row_materials = [], [], []
        for row in range(rows + 1):
            t = row / rows
            scaled = t * (len(path) - 1)
            segment = min(len(path) - 2, int(scaled))
            q = scaled - segment
            p0 = path[max(0, segment - 1)]
            p1, p2 = path[segment], path[segment + 1]
            p3 = path[min(len(path) - 1, segment + 2)]
            center = 0.5 * (
                2.0 * p1
                + (-p0 + p2) * q
                + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * q * q
                + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * q**3
            )
            tangent = (p2 - p1).normalized()
            if tangent.length_squared < 1e-6:
                tangent = Vector((0.0, 0.0, -1.0))
            hint = Vector((0.0, 1.0, 0.0))
            if abs(tangent.dot(hint)) > 0.94:
                hint = Vector((1.0, 0.0, 0.0))
            axis_x = tangent.cross(hint).normalized()
            axis_y = axis_x.cross(tangent).normalized()
            q_radius = q * q * (3.0 - 2.0 * q)
            rx = controls[segment][1] + (controls[segment + 1][1] - controls[segment][1]) * q_radius
            ry = controls[segment][2] + (controls[segment + 1][2] - controls[segment][2]) * q_radius
            for side in range(sides):
                angle = side / sides * math.tau
                point = center + axis_x * (rx * math.cos(angle)) + axis_y * (ry * math.sin(angle))
                vertices.append(tuple(point))
                weights.append(weight_at(t, tuple(center)))
            row_materials.append(material_at(t))
        faces, face_materials = [], []
        for row in range(rows):
            material = material_at((row + 0.5) / rows)
            for side in range(sides):
                a = row * sides + side
                b = row * sides + (side + 1) % sides
                c = (row + 1) * sides + side
                d = (row + 1) * sides + (side + 1) % sides
                faces.extend(((a, c, b), (b, c, d)))
                face_materials.extend((material, material))
        cap_start = len(vertices)
        vertices.append(tuple(path[0]))
        weights.append(weight_at(0.0, tuple(path[0])))
        vertices.append(tuple(path[-1]))
        weights.append(weight_at(1.0, tuple(path[-1])))
        for side in range(sides):
            faces.append((cap_start, (side + 1) % sides, side))
            face_materials.append(material_at(0.0))
            a = rows * sides + side
            b = rows * sides + (side + 1) % sides
            faces.append((cap_start + 1, a, b))
            face_materials.append(material_at(1.0))
        self.add_surface(vertices, faces, face_materials, weights)

    def sphere(self, center, scale, material, bone_weights, sides=20, rows=14):
        cx, cy, cz = center
        sx, sy, sz = scale
        first_vertex = len(self.parts[material]["vertices"])
        controls = []
        for row in range(rows + 1):
            angle = math.pi * row / rows
            z = cz - sz * math.cos(angle)
            radius = math.sin(angle)
            controls.append((z, sx * radius, sy * radius))
        self.loft(
            controls,
            material,
            lambda _z, _t: bone_weights,
            sides=sides,
            rows=rows,
        )
        vertices = self.parts[material]["vertices"]
        # The loft is centered at x/y=0. Offset the vertices added by this sphere.
        for index in range(first_vertex, len(vertices)):
            x, y, z = vertices[index]
            vertices[index] = (x + cx, y + cy, z)

    def torus(self, center, major, minor, material, bone_weights, sides=32, tube_sides=8):
        cx, cy, cz = center
        vertices, weights, faces = [], [], []
        for ring in range(sides):
            angle = ring / sides * math.tau
            for tube in range(tube_sides):
                around = tube / tube_sides * math.tau
                radius = major + minor * math.cos(around)
                vertices.append((cx + radius * math.cos(angle), cy + radius * math.sin(angle), cz + minor * math.sin(around)))
                weights.append(bone_weights)
        for ring in range(sides):
            for tube in range(tube_sides):
                a = ring * tube_sides + tube
                b = ring * tube_sides + (tube + 1) % tube_sides
                c = ((ring + 1) % sides) * tube_sides + tube
                d = ((ring + 1) % sides) * tube_sides + (tube + 1) % tube_sides
                faces.extend(((a, c, b), (b, c, d)))
        self.add_surface(vertices, faces, [material] * len(faces), weights)

    def create_objects(self, armature, materials):
        objects = []
        for material_name, part in self.parts.items():
            if not part["faces"]:
                continue
            mesh = bpy.data.meshes.new("Prototype_" + material_name)
            mesh.from_pydata(part["vertices"], [], part["faces"])
            mesh.materials.append(materials[material_name])
            mesh.update()
            mesh.calc_loop_triangles()
            bm = bmesh.new()
            bm.from_mesh(mesh)
            bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
            bm.to_mesh(mesh)
            bm.free()
            for polygon in mesh.polygons:
                polygon.use_smooth = True
            obj = bpy.data.objects.new("Skinned_" + material_name, mesh)
            bpy.context.collection.objects.link(obj)
            obj.parent = armature
            for name in BONE_NAMES:
                obj.vertex_groups.new(name=name)
            for index, assignments in enumerate(part["weights"]):
                for name, weight in assignments.items():
                    if weight > 1e-5:
                        obj.vertex_groups[name].add([index], weight, "REPLACE")
            modifier = obj.modifiers.new("Player deformation", "ARMATURE")
            modifier.object = armature
            modifier.use_deform_preserve_volume = False
            objects.append(obj)
        return objects


def jersey_weights(z, _t):
    if z < 0.98:
        return mix_weights("pelvis", "spine", (z - 0.84) / 0.14)
    if z < 1.32:
        return mix_weights("spine", "chest", (z - 0.98) / 0.34)
    return {"chest": 1.0}


def shorts_weights(z, _t):
    if z < 0.87:
        return {"pelvis": 0.72, "thigh.L": 0.14, "thigh.R": 0.14}
    return {"pelvis": 1.0}


def make_leg_weights(side, t, point):
    # Use anatomical height, including for the separate sock surface.
    t = bound((0.92 - point[2]) / 0.855)
    thigh, shin, foot = f"thigh.{side}", f"shin.{side}", f"foot.{side}"
    if t < 0.43:
        return {thigh: 1.0}
    if t < 0.57:
        return mix_weights(thigh, shin, (t - 0.43) / 0.14)
    if t < 0.88:
        return {shin: 1.0}
    return mix_weights(shin, foot, (t - 0.88) / 0.12)


def make_arm_weights(side, t, _point):
    clavicle, upper, forearm, hand = (
        f"clavicle.{side}", f"upper_arm.{side}", f"forearm.{side}", f"hand.{side}"
    )
    if t < 0.13:
        return mix_weights(clavicle, upper, t / 0.13)
    if t < 0.42:
        return {upper: 1.0}
    if t < 0.58:
        return mix_weights(upper, forearm, (t - 0.42) / 0.16)
    if t < 0.84:
        return {forearm: 1.0}
    return mix_weights(forearm, hand, (t - 0.84) / 0.16)


def make_leg_material(t):
    if t < 0.34:
        return "Shorts"
    if t < 0.49:
        return "Skin"
    return "Socks"


def make_arm_material(t):
    if t < 0.22:
        return "Kit"
    if t < 0.245:
        return "Socks"
    return "Skin"


def create_materials():
    materials = {}
    for name, color in MATERIAL_COLORS.items():
        material = bpy.data.materials.new(name)
        material.diffuse_color = color
        material.use_nodes = True
        nodes = material.node_tree.nodes
        principled = next(
            (node for node in nodes if node.bl_idname == "ShaderNodeBsdfPrincipled"),
            None,
        )
        if principled is None:
            principled = nodes.new("ShaderNodeBsdfPrincipled")
        output = next(
            (node for node in nodes if node.bl_idname == "ShaderNodeOutputMaterial"),
            None,
        )
        if output is None:
            output = nodes.new("ShaderNodeOutputMaterial")
        material.node_tree.links.new(principled.outputs["BSDF"], output.inputs["Surface"])
        principled.inputs["Base Color"].default_value = color
        principled.inputs["Roughness"].default_value = {"Skin": 0.64, "Kit": 0.88, "Shorts": 0.92, "Socks": 0.95, "Boots": 0.5}[name]
        materials[name] = material
    return materials


def create_armature():
    armature_data = bpy.data.armatures.new("StrikerRig")
    armature = bpy.data.objects.new("StrikerRig", armature_data)
    bpy.context.collection.objects.link(armature)
    bpy.context.view_layer.objects.active = armature
    armature.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    positions = {
        "root": ((0, 0, 0), (0, 0, 0.82), None),
        "pelvis": ((0, 0, 0.92), (0, 0, 1.11), "root"),
        "spine": ((0, 0, 1.11), (0, 0, 1.35), "pelvis"),
        "chest": ((0, 0, 1.35), (0, 0, 1.43), "spine"),
        "neck": ((0, 0, 1.43), (0, 0, 1.56), "chest"),
        "head": ((0, 0, 1.55), (0, 0, 1.77), "neck"),
    }
    for side, sign in (("L", -1), ("R", 1)):
        shoulder = (sign * 0.195, 0, 1.41)
        wrist = (sign * 0.40, -0.22, 0.94)
        elbow = solve_joint(shoulder, wrist, 0.29, 0.27, (sign * 0.45, -0.8, 0.35))
        positions.update({
            f"clavicle.{side}": ((0, 0, 1.41), (sign * 0.195, 0, 1.41), "chest"),
            f"upper_arm.{side}": (shoulder, elbow, f"clavicle.{side}"),
            f"forearm.{side}": (elbow, wrist, f"upper_arm.{side}"),
            f"hand.{side}": (wrist, (sign * 0.40, -0.30, 0.92), f"forearm.{side}"),
            f"thigh.{side}": ((sign * 0.125, 0, 0.92), (sign * 0.125, 0, 0.49), "pelvis"),
            f"shin.{side}": ((sign * 0.125, 0, 0.49), (sign * 0.125, 0, 0.06), f"thigh.{side}"),
            f"foot.{side}": ((sign * 0.125, 0, 0.06), (sign * 0.125, -0.16, 0.055), f"shin.{side}"),
            f"toe.{side}": ((sign * 0.125, -0.16, 0.055), (sign * 0.125, -0.25, 0.05), f"foot.{side}"),
        })
    edits = {}
    for name in BONE_NAMES:
        head, tail, parent = positions[name]
        bone = armature.data.edit_bones.new(name)
        bone.head, bone.tail = head, tail
        bone.use_deform = name != "root"
        bone.head_radius = 0.035
        bone.tail_radius = 0.025
        edits[name] = bone
        if parent:
            bone.parent = edits[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    armature.show_in_front = False
    armature.data.display_type = "OCTAHEDRAL"
    return armature


def add_character_meshes(armature, materials):
    body = MeshBuilder()
    body.loft(
        [
            (0.89, 0.16, 0.105), (0.93, 0.17, 0.112), (0.99, 0.16, 0.113),
            (1.07, 0.17, 0.116), (1.17, 0.195, 0.125), (1.28, 0.225, 0.129),
            (1.36, 0.235, 0.119), (1.40, 0.21, 0.102), (1.43, 0.10, 0.075),
        ],
        "Kit", jersey_weights, sides=24, rows=26,
    )
    body.loft(
        [
            (0.81, 0.15, 0.10), (0.83, 0.16, 0.105), (0.86, 0.17, 0.11),
            (0.90, 0.16, 0.111), (0.95, 0.145, 0.10),
        ],
        "Shorts", shorts_weights, sides=20, rows=16,
    )
    body.torus((0.0, 0.0, 1.421), 0.078, 0.006, "Kit", {"chest": 1.0})
    # A softly tapered neck, shaped head, ears, hairline, eyes and nose.
    body.tube(
        [((0, 0, 1.415), 0.063, 0.060), ((0, 0, 1.49), 0.060, 0.057), ((0, 0, 1.56), 0.058, 0.056)],
        lambda _t: "Skin", lambda _t, _p: {"neck": 0.65, "head": 0.35}, sides=16, rows=10,
    )
    body.sphere((0, 0, 1.685), (0.105, 0.103, 0.135), "Skin", {"head": 1.0}, sides=22, rows=16)
    for sign in (-1, 1):
        body.sphere((sign * 0.104, 0, 1.675), (0.022, 0.028, 0.036), "Skin", {"head": 1.0}, sides=14, rows=10)
        body.sphere((sign * 0.041, -0.093, 1.703), (0.013, 0.010, 0.009), "Socks", {"head": 1.0}, sides=10, rows=7)
        body.sphere((sign * 0.041, -0.102, 1.704), (0.0055, 0.004, 0.006), "Boots", {"head": 1.0}, sides=8, rows=6)
        body.sphere((sign * 0.042, -0.089, 1.728), (0.022, 0.006, 0.006), "Boots", {"head": 1.0}, sides=10, rows=5)
    body.sphere((0, -0.105, 1.674), (0.019, 0.026, 0.038), "Skin", {"head": 1.0}, sides=12, rows=8)
    body.sphere((0, -0.098, 1.635), (0.020, 0.009, 0.004), "Boots", {"head": 1.0}, sides=10, rows=5)
    body.loft(
        [(1.742, 0.094, 0.090), (1.752, 0.097, 0.094), (1.765, 0.093, 0.093),
         (1.78, 0.080, 0.082), (1.815, 0.043, 0.048), (1.831, 0.004, 0.006)],
        "Boots", lambda _z, _t: {"head": 1.0}, sides=20, rows=14, cap=True,
    )

    for side, sign in (("L", -1), ("R", 1)):
        arm_weights = lambda t, point, s=side: make_arm_weights(s, t, point)
        shoulder = (sign * 0.195, 0, 1.41)
        wrist = (sign * 0.40, -0.22, 0.94)
        elbow = solve_joint(shoulder, wrist, 0.29, 0.27, (sign * 0.45, -0.8, 0.35))
        body.tube(
            [
                (shoulder, 0.082, 0.077),
                (v_lerp(shoulder, elbow, 0.5), 0.077, 0.070),
                (elbow, 0.059, 0.056),
                (v_lerp(elbow, wrist, 0.5), 0.061, 0.055),
                (wrist, 0.043, 0.040),
            ],
            make_arm_material, arm_weights, sides=14, rows=38,
        )
        # Shirt seams wrap the shoulder and echo the original mint kit.
        body.tube(
            [((sign * 0.025, -0.102, 1.393), 0.006, 0.006), ((sign * 0.11, -0.104, 1.405), 0.006, 0.006),
             ((sign * 0.18, -0.085, 1.397), 0.005, 0.005)],
            lambda _t: "Socks", lambda _t, _p: {"chest": 1.0}, sides=8, rows=6,
        )
        leg_weights = lambda t, point, s=side: make_leg_weights(s, t, point)
        leg_controls = [
            ((sign * 0.125, 0.0, 0.92), 0.126, 0.112),
            ((sign * 0.13, -0.005, 0.72), 0.105, 0.100),
            ((sign * 0.125, -0.015, 0.49), 0.075, 0.073),
            ((sign * 0.125, -0.02, 0.27), 0.068, 0.067),
            ((sign * 0.125, -0.025, 0.065), 0.053, 0.052),
        ]
        body.tube(leg_controls, make_leg_material, leg_weights, sides=14, rows=42)
        body.tube(
            [((sign * 0.125, -0.022, 0.46), 0.078, 0.076),
             ((sign * 0.125, -0.025, 0.30), 0.072, 0.070),
             ((sign * 0.125, -0.030, 0.12), 0.059, 0.061),
             ((sign * 0.125, -0.030, 0.075), 0.055, 0.055)],
            lambda _t: "Socks", leg_weights, sides=14, rows=22,
        )
        shoe_weights = {f"foot.{side}": 0.85, f"toe.{side}": 0.15}
        x = sign * 0.125
        body.sphere((x, -0.080, 0.066), (0.064, 0.150, 0.051), "Boots", shoe_weights, sides=18, rows=12)
        body.sphere((x, -0.078, 0.025), (0.067, 0.157, 0.022), "Boots", shoe_weights, sides=18, rows=8)
        for y in (-0.19, -0.12, -0.04, 0.035):
            body.sphere((x, y, 0.008), (0.011, 0.012, 0.006), "Boots", shoe_weights, sides=8, rows=6)
        for y in (-0.12, -0.075, -0.03):
            body.tube(
                [((x - 0.024, y, 0.108), 0.0038, 0.0038), ((x + 0.024, y, 0.108), 0.0038, 0.0038)],
                lambda _t: "Socks", lambda _t, _p, s=side: {f"foot.{s}": 1.0}, sides=6, rows=4,
            )
        wrist_y, wrist_z = -0.22, 0.94
        body.sphere((sign * 0.40, wrist_y - 0.035, wrist_z - 0.008), (0.045, 0.058, 0.030), "Skin", {f"hand.{side}": 1.0}, sides=14, rows=9)
        for finger in range(4):
            spread = (finger - 1.5) * 0.020
            length = (0.071, 0.080, 0.074, 0.059)[finger]
            body.tube(
                [((sign * 0.40 + spread, wrist_y - 0.065, wrist_z - 0.009), 0.011, 0.011),
                 ((sign * 0.40 + spread * 1.12, wrist_y - 0.095 - length * 0.30, wrist_z - 0.012), 0.009, 0.009),
                 ((sign * 0.40 + spread * 1.18, wrist_y - 0.095 - length * 0.55, wrist_z - 0.017), 0.006, 0.006)],
                lambda _t: "Skin", lambda _t, _p, s=side: {f"hand.{s}": 1.0}, sides=8, rows=7,
            )
        body.tube(
            [((sign * 0.40, wrist_y - 0.03, wrist_z + 0.005), 0.013, 0.013),
             ((sign * 0.40 + sign * 0.055, wrist_y - 0.06, wrist_z - 0.010), 0.010, 0.010),
             ((sign * 0.40 + sign * 0.065, wrist_y - 0.09, wrist_z - 0.015), 0.007, 0.007)],
            lambda _t: "Skin", lambda _t, _p, s=side: {f"hand.{s}": 1.0}, sides=8, rows=7,
        )
    return body.create_objects(armature, materials)


def _tangent(keys, index, component):
    if index == 0:
        a, b = keys[0], keys[1]
        return (b[component] - a[component]) / (b[0] - a[0])
    if index == len(keys) - 1:
        a, b = keys[-2], keys[-1]
        return (b[component] - a[component]) / (b[0] - a[0])
    before, key, after = keys[index - 1], keys[index], keys[index + 1]
    left = (key[component] - before[component]) / (key[0] - before[0])
    right = (after[component] - key[component]) / (after[0] - key[0])
    if left * right <= 0.0:
        return 0.0
    left_dt, right_dt = key[0] - before[0], after[0] - key[0]
    return (left * right_dt + right * left_dt) / (left_dt + right_dt)


def hermite_keys(keys, time):
    """C1-continuous, shape-preserving interpolation for planted foot targets."""
    if time <= keys[0][0]:
        return keys[0][1:]
    if time >= keys[-1][0]:
        return keys[-1][1:]
    for index, (a, b) in enumerate(zip(keys, keys[1:])):
        if time <= b[0]:
            dt = b[0] - a[0]
            u = (time - a[0]) / dt
            h00, h10 = 2*u**3 - 3*u**2 + 1, u**3 - 2*u**2 + u
            h01, h11 = -2*u**3 + 3*u**2, u**3 - u**2
            return tuple(
                h00*a[c] + h10*dt*_tangent(keys, index, c)
                + h01*b[c] + h11*dt*_tangent(keys, index + 1, c)
                for c in range(1, len(a))
            )
    return keys[-1][1:]


def hermite_velocity(keys, time, component):
    epsilon = 1.0 / FPS
    before = hermite_keys(keys, max(0.0, time - epsilon))[component - 1]
    after = hermite_keys(keys, min(ACTION_DURATION, time + epsilon))[component - 1]
    span = min(ACTION_DURATION, time + epsilon) - max(0.0, time - epsilon)
    return (after - before) / span if span else 0.0


def action_pose(time, ambient_time=None):
    ambient_time = time if ambient_time is None else ambient_time
    root_keys = [
        (0.00, 1.34), (0.18, 1.32), (0.43, 1.10), (0.62, 0.94),
        (0.86, 0.65), (1.02, 0.50), (SUPPORT_TOUCHDOWN, 0.37),
        (CONTACT_TIME, 0.20), (1.72, 0.17), (2.08, 0.15), (2.46, 0.15),
        (ACTION_DURATION, 0.15),
    ]
    root_y = hermite_keys(root_keys, time)[0]
    speed = -hermite_velocity(root_keys, time, 1)
    run = smoother(time / 0.90) * (1.0 - smoother((time - 1.02) / 0.20))
    windup = smoother((time - 0.91) / 0.19) * (1.0 - smoother((time - 1.27) / 0.12))
    release = smoother((time - SUPPORT_TOUCHDOWN) / 0.30) * (1.0 - smoother((time - 1.78) / 0.34))
    settle = smoother((time - 1.68) / 0.78)
    plant_load = math.exp(-((time - 1.30) / 0.14) ** 2)
    push_off = math.exp(-((time - 1.50) / 0.16) ** 2)
    hip_z = 0.89 - 0.055 * plant_load + 0.008 * push_off + 0.010 * settle
    breath = math.sin(ambient_time * math.tau * 0.52) * 0.006 * (1.0 - run)
    idle_shift = 0.012 * math.sin(ambient_time * math.tau * 0.45) * (1.0 - run)
    pelvis_yaw = -0.19 * windup + 0.24 * release + 0.035 * math.sin(ambient_time * 3.1) * (1.0 - run)
    chest_yaw = 0.11 * windup + 0.17 * release
    trunk_lean = 0.035 + min(0.11, max(0.0, speed) * 0.12) * run
    trunk_lean += 0.055 * release - 0.028 * windup - 0.04 * settle

    left_foot = hermite_keys([
        (0.00, -0.125, 1.52, 0.065), (0.12, -0.125, 1.52, 0.065),
        (0.20, -0.125, 1.43, 0.13), (0.32, -0.125, 1.22, 0.19),
        (0.43, -0.125, 1.10, 0.065), (0.55, -0.125, 1.10, 0.065),
        (0.64, -0.125, 0.99, 0.13), (0.77, -0.125, 0.83, 0.18),
        (0.88, -0.125, 0.76, 0.065), (1.00, -0.125, 0.76, 0.065),
        (1.08, -0.125, 0.60, 0.13), (1.14, -0.125, 0.40, 0.17),
        (1.20, -0.125, 0.23, 0.10), (SUPPORT_TOUCHDOWN, -0.125, 0.20, 0.065),
        (2.34, -0.125, 0.20, 0.065), (2.44, -0.125, 0.16, 0.12),
        (2.57, -0.125, 0.12, 0.17), (2.70, -0.125, 0.10, 0.065),
        (ACTION_DURATION, -0.125, 0.10, 0.065),
    ], time)
    right_foot = hermite_keys([
        (0.00, 0.125, 1.52, 0.065), (0.07, 0.125, 1.52, 0.065),
        (0.16, 0.125, 1.36, 0.14), (0.27, 0.125, 1.16, 0.18),
        (0.36, 0.125, 1.09, 0.065), (0.50, 0.125, 1.09, 0.065),
        (0.58, 0.125, 0.96, 0.14), (0.72, 0.125, 0.82, 0.19),
        (0.84, 0.125, 0.75, 0.065), (0.91, 0.125, 0.75, 0.065),
        (1.03, 0.125, 0.92, 0.28), (1.12, 0.125, 0.94, 0.35),
        (SUPPORT_TOUCHDOWN, 0.125, 0.80, 0.37), (1.36, 0.125, 0.56, 0.26),
        (1.46, 0.125, 0.47, 0.15), (1.52, 0.125, 0.40, 0.09),
        (CONTACT_TIME, 0.125, 0.25, 0.065), (1.63, 0.125, 0.02, 0.26),
        (1.75, 0.125, -0.12, 0.43), (1.88, 0.125, -0.16, 0.35),
        (2.02, 0.125, 0.05, 0.16), (2.13, 0.125, 0.20, 0.065),
        (2.40, 0.125, 0.20, 0.065), (2.51, 0.125, 0.24, 0.13),
        (2.66, 0.125, 0.28, 0.16), (2.80, 0.125, 0.25, 0.065),
        (ACTION_DURATION, 0.125, 0.25, 0.065),
    ], time)
    left_foot = (left_foot[0], left_foot[1], max(0.065, left_foot[2]))
    strike_align = smoother((time - 1.03) / (CONTACT_TIME - 1.03)) * (1.0 - smoother((time - 1.75) / 0.38))
    right_foot = (right_foot[0] * (1.0 - strike_align), right_foot[1], max(0.065, right_foot[2]))
    center = (idle_shift, root_y, hip_z)
    positions = {"root": (0.0, root_y, 0.0)}
    for side, sign, foot in (("L", -1, left_foot), ("R", 1, right_foot)):
        hip = (idle_shift + sign * 0.125, root_y, hip_z)
        ankle = tuple(foot)
        knee = solve_joint(hip, ankle, 0.43, 0.43, (0.0, -0.65, 0.35))
        positions[f"thigh.{side}"] = segment_matrix(hip, knee)
        positions[f"shin.{side}"] = segment_matrix(knee, ankle)
        toe = (ankle[0], ankle[1] - 0.16, max(0.045, ankle[2] - 0.01))
        positions[f"foot.{side}"] = segment_matrix(ankle, toe)
        toe_end = (toe[0], toe[1] - 0.09, toe[2] - 0.005)
        positions[f"toe.{side}"] = segment_matrix(toe, toe_end)

    pelvis_top = (idle_shift, root_y - trunk_lean * 0.17, hip_z + 0.19)
    spine_top = (idle_shift, root_y - trunk_lean * 0.55, hip_z + 0.43 + breath)
    chest_top = (idle_shift, root_y - trunk_lean * 0.70, hip_z + 0.51 + breath)
    neck_top = (idle_shift, root_y - trunk_lean * 0.80, hip_z + 0.63 + breath)
    head_top = (idle_shift, root_y - trunk_lean * 0.84, hip_z + 0.85 + breath)
    positions["pelvis"] = segment_matrix(center, pelvis_top, pelvis_yaw)
    positions["spine"] = segment_matrix(pelvis_top, spine_top, chest_yaw * 0.72)
    positions["chest"] = segment_matrix(spine_top, chest_top, chest_yaw)
    positions["neck"] = segment_matrix(chest_top, neck_top, chest_yaw * 0.25)
    positions["head"] = segment_matrix(neck_top, head_top, chest_yaw * 0.15)

    for side, sign in (("L", -1), ("R", 1)):
        shoulder = (idle_shift + sign * 0.195, root_y - 0.01, hip_z + 0.49 + breath)
        positions[f"clavicle.{side}"] = segment_matrix((idle_shift, root_y - 0.005, hip_z + 0.49), shoulder, chest_yaw)
        stride = math.sin((time - (0.10 if side == "L" else 0.28)) * math.tau * 2.1) * run
        weight_shift = math.sin(ambient_time * math.tau * 0.45) * 0.035 * (1.0 - run)
        counter = stride + weight_shift + (0.72 * windup - 0.85 * release if side == "L" else -0.52 * windup + 0.45 * release)
        recovery = settle
        wrist = (
            idle_shift + sign * (0.43 + 0.035 * recovery),
            root_y - 0.025 + counter * 0.16,
            hip_z + 0.04 + 0.07 * windup + counter * 0.085 + 0.10 * recovery,
        )
        reach = Vector(wrist) - Vector(shoulder)
        width, limit = 0.025, 0.555
        blend = max(width-abs(reach.length-limit),0.0)/width
        distance = min(reach.length,limit)-blend*blend*width/4
        wrist = tuple(Vector(shoulder)+reach.normalized()*distance)
        elbow = solve_joint(shoulder, wrist, 0.29, 0.27, (sign * 0.45, -0.8, 0.35))
        positions[f"upper_arm.{side}"] = segment_matrix(shoulder, elbow)
        positions[f"forearm.{side}"] = segment_matrix(elbow, wrist)
        hand_end = (wrist[0] + sign * 0.01, wrist[1] - 0.065, wrist[2] - 0.015)
        positions[f"hand.{side}"] = segment_matrix(wrist, hand_end)
    return positions


def solve_joint(root, target, upper, lower, pole):
    a, b = Vector(root), Vector(target)
    delta = b - a
    distance = bound(delta.length, abs(upper - lower) + 0.005, upper + lower - 0.005)
    direction = delta.normalized()
    end = a + direction * distance
    along = (upper * upper - lower * lower + distance * distance) / (2.0 * distance)
    height = math.sqrt(max(0.0, upper * upper - along * along))
    perpendicular = Vector(pole) - direction * Vector(pole).dot(direction)
    if perpendicular.length_squared < 1e-6:
        perpendicular = Vector((0.0, 1.0, 0.0)) - direction * direction.y
    joint = a + direction * along + perpendicular.normalized() * height
    return tuple(joint)


def segment_matrix(head, tail, yaw=0.0):
    a, b = Vector(head), Vector(tail)
    direction = b - a
    if direction.length_squared < 1e-8:
        direction = Vector((0.0, 0.0, 1.0))
    # Match Blender's zero-roll rest bones. Using X as the tracking up axis
    # twisted the torso by 90 degrees and folded adjacent weighted rings.
    rotation = Vector((0, 1, 0)).rotation_difference(direction.normalized())
    if yaw:
        rotation = Quaternion((0.0, 0.0, 1.0), yaw) @ rotation
    return Matrix.LocRotScale(a, rotation, Vector((1.0, 1.0, 1.0)))


def create_animation(armature):
    animation = bpy.data.actions.new("Striker_Idle_Runup_Kick_Recovery")
    armature.animation_data_create()
    armature.animation_data.action = animation
    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = SAMPLES
    previous_rotations = {}
    for frame in range(SAMPLES + 1):
        time = frame / FPS
        motion_time = max(0.0, time - IDLE_DURATION)
        target = action_pose(motion_time, time)
        scene.frame_set(frame)
        for name in BONE_NAMES:
            matrix = target[name]
            bone = armature.pose.bones[name]
            if name == "root":
                bone.matrix = Matrix.Translation(Vector(matrix))
            else:
                bone.matrix = matrix
            bpy.context.view_layer.update()
            bone.rotation_mode = "QUATERNION"
            previous = previous_rotations.get(name)
            if previous is not None and previous.dot(bone.rotation_quaternion) < 0:
                bone.rotation_quaternion.negate()
            previous_rotations[name] = bone.rotation_quaternion.copy()
            bone.keyframe_insert(data_path="location", frame=frame, group=name)
            bone.keyframe_insert(data_path="rotation_quaternion", frame=frame, group=name)
    curves = list(getattr(animation, "fcurves", ()))
    if not curves:
        curves = [
            curve
            for layer in animation.layers
            for strip in layer.strips
            for bag in strip.channelbags
            for curve in bag.fcurves
        ]
    for curve in curves:
        for key in curve.keyframe_points:
            key.interpolation = "LINEAR"
            key.handle_left_type = "AUTO_CLAMPED"
            key.handle_right_type = "AUTO_CLAMPED"
    scene.frame_start = 0
    scene.frame_end = SAMPLES
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    scene.frame_set(round(CLIP_CONTACT_TIME * FPS))
    return animation


def create_studio():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 16
    scene.world.color = (0.05, 0.07, 0.07)
    floor_mat = bpy.data.materials.new("Studio Ground")
    floor_mat.diffuse_color = (0.075, 0.12, 0.105, 1.0)
    floor = bpy.data.meshes.new("Studio Ground")
    floor.from_pydata([(-8, -8, -0.015), (8, -8, -0.015), (8, 8, -0.015), (-8, 8, -0.015)], [], [(0, 1, 2, 3)])
    floor.materials.append(floor_mat)
    ground = bpy.data.objects.new("Studio Ground", floor)
    bpy.context.collection.objects.link(ground)
    for polygon in floor.polygons:
        polygon.use_smooth = False
    camera_data = bpy.data.cameras.new("Studio Camera")
    camera = bpy.data.objects.new("Studio Camera", camera_data)
    bpy.context.collection.objects.link(camera)
    camera.location = (3.0, -5.8, 2.15)
    target = Vector((0.0, 0.0, 0.96))
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.lens = 55
    scene.camera = camera
    camera.hide_set(True)
    for name, location, energy, size, color in (
        ("Key", (1.4, -3.4, 4.0), 520, 4.0, (0.83, 1.0, 0.92)),
        ("Fill", (-3.0, -1.0, 2.5), 300, 3.0, (0.63, 0.78, 1.0)),
        ("Rim", (1.0, 2.3, 3.1), 460, 2.8, (1.0, 0.71, 0.48)),
    ):
        data = bpy.data.lights.new(name, "AREA")
        data.energy = energy
        data.shape = "DISK"
        data.size = size
        data.color = color
        light = bpy.data.objects.new(name, data)
        bpy.context.collection.objects.link(light)
        light.location = location
        light.rotation_euler = (target - light.location).to_track_quat("-Z", "Y").to_euler()
        light.hide_set(True)
    scene.render.resolution_x = 1080
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 60
    scene.view_settings.view_transform = "AgX"


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.actions, bpy.data.armatures):
        for datablock in list(datablocks):
            if datablock.users == 0:
                datablocks.remove(datablock)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.render.fps = FPS
    materials = create_materials()
    armature = create_armature()
    objects = add_character_meshes(armature, materials)
    create_animation(armature)
    create_studio()
    bpy.ops.object.select_all(action="DESELECT")
    armature.select_set(True)
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    bpy.ops.export_scene.gltf(
        filepath=str(GLB_PATH),
        export_format="GLB",
        use_selection=True,
        export_animations=True,
        export_skins=True,
        export_yup=True,
        export_force_sampling=False,
        export_nla_strips=False,
        export_lights=False,
        export_cameras=False,
        export_meshopt_compression_enable=True,
    )
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.scene.frame_set(round(CLIP_CONTACT_TIME * FPS))
    bpy.context.view_layer.objects.active = None
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_PATH))
    print("PROTOTYPE", json.dumps({
        "blend": str(BLEND_PATH),
        "glb": str(GLB_PATH),
        "blender": bpy.app.version_string,
        "bones": len(armature.data.bones),
        "materials": len(materials),
        "textures": 0,
        "meshes": len(objects),
        "triangles": sum(len(obj.data.loop_triangles) for obj in objects),
        "durationSeconds": DURATION,
        "contactSeconds": CLIP_CONTACT_TIME,
        "supportFootLock": {
            "side": "L",
            "fromSeconds": CLIP_SUPPORT_TOUCHDOWN,
            "toSeconds": CLIP_SUPPORT_RELEASE,
            "assetSceneTargetMeters": [-0.125, 0.065, -0.20],
            "blenderAuthoringTargetMeters": [-0.125, 0.20, 0.065],
        },
        "source": "Original procedural mesh and animation authored in-project with Blender; no third-party assets",
        "license": "No third-party assets; the repository has no stated license",
    }, ensure_ascii=False))
    stats = {
        "blender": bpy.app.version_string,
        "source": "Original procedural mesh and animation authored in-project with Blender; no third-party assets",
        "license": "No third-party assets; the repository has no stated license",
        "framesPerSecond": FPS,
        "durationSeconds": DURATION,
        "contactSeconds": CLIP_CONTACT_TIME,
        "supportFootLock": {
            "side": "L",
            "fromSeconds": CLIP_SUPPORT_TOUCHDOWN,
            "toSeconds": CLIP_SUPPORT_RELEASE,
            "assetSceneTargetMeters": [-0.125, 0.065, -0.20],
            "blenderAuthoringTargetMeters": [-0.125, 0.20, 0.065],
        },
        "bones": len(armature.data.bones),
        "materials": len(materials),
        "textures": 0,
        "meshes": len(objects),
        "triangles": sum(len(obj.data.loop_triangles) for obj in objects),
        "glbBytes": GLB_PATH.stat().st_size,
        "budgets": {"triangles": 18000, "bones": 24, "materials": 5, "textures": 0, "glbBytes": 275000},
    }
    META_PATH.write_text(json.dumps(stats, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
