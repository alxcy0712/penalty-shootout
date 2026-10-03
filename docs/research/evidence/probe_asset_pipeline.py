"""Inspect production assets and apply the new helper only in unsaved memory.

Run from the repository root:
  blender -b --python docs/research/evidence/probe_asset_pipeline.py -- \
    --repo . --out docs/research/evidence/asset-pipeline-probe-run.json

This diagnostic never calls rebuild, save_as_mainfile, or export_scene.gltf.
Only an explicitly requested JSON beneath docs/research/evidence can be written.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys

import bpy


parser = argparse.ArgumentParser()
parser.add_argument('--repo', default=str(Path(__file__).resolve().parents[3]))
parser.add_argument('--out')
args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
repo = Path(args.repo).resolve()
out = (repo / args.out).resolve() if args.out else None
if out:
    out.relative_to(repo / 'docs/research/evidence')

monitored = [
    'assets/characters/keeper-prototype.glb',
    'assets/characters/striker-mocap.glb',
    'assets/characters/keeper-prototype.blend',
    'assets/characters/striker-mocap.blend',
    'tools/blender/refine_football_model.py',
    'tools/blender/repair_keeper_skin.py',
]


def hashes():
    return {name: hashlib.sha256((repo / name).read_bytes()).hexdigest()
            for name in monitored}


def mesh_inventory(rig):
    result = []
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH' or not any(
                mod.type == 'ARMATURE' and mod.object == rig for mod in obj.modifiers):
            continue
        obj.data.calc_loop_triangles()
        result.append({
            'name': obj.name, 'vertices': len(obj.data.vertices),
            'polygons': len(obj.data.polygons), 'triangles': len(obj.data.loop_triangles),
            'materials': [material.name for material in obj.data.materials],
            'meshProperties': list(obj.data.keys()), 'objectProperties': list(obj.keys()),
        })
    return result


before_hashes = hashes()
bpy.ops.wm.open_mainfile(filepath=str(repo / 'assets/characters/keeper-prototype.blend'))
rig = next(obj for obj in bpy.context.scene.objects if obj.type == 'ARMATURE')
action = next(iter(bpy.data.actions))
props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
report = {
    'scope': 'Read assets; inspect APIs; apply refine_character only in unsaved memory',
    'blender': bpy.app.version_string,
    'beforeHashes': before_hashes,
    'before': {'bones': [bone.name for bone in rig.data.bones],
               'rigProperties': list(rig.keys()), 'meshes': mesh_inventory(rig)},
    'capabilities': {
        'actionLayers': hasattr(action, 'layers'),
        'actionSlots': hasattr(action, 'slots'),
        'meshoptExportProperty': 'export_meshopt_compression_enable' in props,
        'meshoptModule': importlib.util.find_spec('io_scene_gltf2.io.exp.meshopt') is not None,
    },
}
sys.path.insert(0, str(repo / 'tools/blender'))
from refine_football_model import refine_character

refine_character(rig, True)
report['afterInMemory'] = {'rigProperties': list(rig.keys()), 'meshes': mesh_inventory(rig)}
report['afterHashes'] = hashes()
report['filesUnchanged'] = report['beforeHashes'] == report['afterHashes']
report['totalTrianglesBefore'] = sum(mesh['triangles'] for mesh in report['before']['meshes'])
report['totalTrianglesAfterInMemory'] = sum(mesh['triangles'] for mesh in report['afterInMemory']['meshes'])
assert report['filesUnchanged'], 'Unexpected production-file or helper mutation'
if out:
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print('ASSET_PIPELINE_PROBE', json.dumps(report, ensure_ascii=False, sort_keys=True))
