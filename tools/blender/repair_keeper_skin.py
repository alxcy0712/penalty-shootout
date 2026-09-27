"""Redistribute the keeper shoulder cap to follow the upper arm on elevation."""
from pathlib import Path
import bpy, json
ROOT=Path(__file__).resolve().parents[2]
asset=ROOT/'assets/characters/keeper-prototype'
bpy.ops.wm.open_mainfile(filepath=str(asset.with_suffix('.blend')))
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
for obj in bpy.context.scene.objects:
    if obj.type!='MESH':continue
    for side,sign in [('L',-1),('R',1)]:
        clavicle=obj.vertex_groups.get('clavicle.'+side)
        upper=obj.vertex_groups.get('upper_arm.'+side)
        if not clavicle or not upper:continue
        for v in obj.data.vertices:
            x=sign*v.co.x
            if x<.12 or v.co.z<1.32:continue
            weights={g.group:g.weight for g in v.groups}
            chest=obj.vertex_groups.get('chest')
            total=weights.get(clavicle.index,0)+weights.get(upper.index,0)+weights.get(chest.index,0)
            if total<.01:continue
            t=max(0,min(1,(x-.12)/.075));t=t*t*(3-2*t)
            upper.add([v.index],total*t,'REPLACE')
            clavicle.add([v.index],total*(1-t),'REPLACE')
            chest.add([v.index],0,'REPLACE')
bpy.ops.object.select_all(action='DESELECT')
rig.select_set(True)
for obj in bpy.context.scene.objects:
    if obj.type=='MESH' and any(m.type=='ARMATURE' and m.object==rig for m in obj.modifiers):obj.select_set(True)
bpy.context.view_layer.objects.active=rig
bpy.ops.wm.save_as_mainfile(filepath=str(asset.with_suffix('.blend')))
from io_scene_gltf2.io.exp import meshopt
meshopt.QUAT_FILTER_BITS=16
bpy.ops.export_scene.gltf(filepath=str(asset.with_suffix('.glb')),export_format='GLB',use_selection=True,
    export_animations=True,export_animation_mode='ACTIONS',export_frame_range=False,export_skins=True,
    export_force_sampling=True,export_optimize_animation_size=True,export_meshopt_compression_enable=True,
    export_image_format='JPEG',export_image_quality=85,export_lights=False,export_cameras=False)
meta=json.loads(asset.with_suffix('.json').read_text());meta['glbBytes']=asset.with_suffix('.glb').stat().st_size
asset.with_suffix('.json').write_text(json.dumps(meta,indent=2)+'\n')
