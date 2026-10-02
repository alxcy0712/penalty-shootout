"""Open an actual rigged .blend and record a deterministic structural/data fingerprint."""
import bpy,json,sys,argparse,hashlib,struct
p=argparse.ArgumentParser();p.add_argument('--input',required=True);p.add_argument('--output',required=True);a=p.parse_args(sys.argv[sys.argv.index('--')+1:]);bpy.ops.wm.open_mainfile(filepath=a.input)
def digest(values):
 return hashlib.sha256(json.dumps(values,separators=(',',':'),sort_keys=True).encode()).hexdigest()
meshes=[]
for o in sorted(bpy.data.objects,key=lambda o:o.name):
 if o.type!='MESH':continue
 m=o.data;m.calc_loop_triangles();verts=[list(v.co) for v in m.vertices];weights=[[(g.group,g.weight)for g in v.groups]for v in m.vertices]
 meshes.append({'name':o.name,'vertices':len(m.vertices),'triangles':len(m.loop_triangles),'materials':[x.name for x in m.materials],'hideRender':o.hide_render,'positionSha256':digest(verts),'weightsSha256':digest(weights),'maxInfluences':max(len(x)for x in weights),'armatureModifiers':[x.object.name for x in o.modifiers if x.type=='ARMATURE']})
rigs=[{'name':o.name,'bones':len(o.data.bones),'restSha256':digest([(b.name,list(b.head_local),list(b.tail_local),[list(r)for r in b.matrix_local],b.parent.name if b.parent else None)for b in o.data.bones])}for o in bpy.data.objects if o.type=='ARMATURE']
actions=[{'name':a.name,'curves':len(a.fcurves),'keyframes':sum(len(c.keyframe_points)for c in a.fcurves),'curvesSha256':digest([(c.data_path,c.array_index,[(list(k.co),k.interpolation)for k in c.keyframe_points])for c in a.fcurves])}for a in bpy.data.actions]
report={'meshes':meshes,'rigs':rigs,'actions':actions,'triangles':sum(x['triangles']for x in meshes if x['armatureModifiers']),'unboundHelperTriangles':sum(x['triangles']for x in meshes if not x['armatureModifiers'])};json.dump(report,open(a.output,'w'),indent=2);print(json.dumps({'input':a.input,'triangles':report['triangles'],'rigs':rigs,'actions':actions}))
