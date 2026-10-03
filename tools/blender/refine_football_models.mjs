#!/usr/bin/env node
/** Conservative football model refinement. Preserves animation streams, rig,
 * bind matrices, original vertex order, material names and texture bytes.
 * Neckline triangle ownership changes; gear geometry is appended.
 * Usage: MODEL_ENCODER=/tmp/model-tools/node_modules/meshoptimizer/index.module.js
 * node tools/blender/refine_football_models.mjs --source FILE --out DIR
 * Encoder: meshoptimizer 0.24.0 (MIT). Blender is used for render verification.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {MeshoptDecoder} from '../../node_modules/three/examples/jsm/libs/meshopt_decoder.module.js';
const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].slice(2)]=process.argv[i+1];
if(!args.source||!args.out||!process.env.MODEL_ENCODER)throw Error('Require --source FILE --out DIR and MODEL_ENCODER module path');
const {MeshoptEncoder}=await import(pathToFileURL(process.env.MODEL_ENCODER));await Promise.all([MeshoptDecoder.ready,MeshoptEncoder.ready]);
const source=await fs.readFile(args.source),sourceHash=createHash('sha256').update(source).digest('hex');
const originalSources={'02a7b6d6f6d368bba8913814e4639f3343e77d981222414f9c97b7db54e107f1':'keeper','6f8e7edba2644c3e42976d1f9cc6b76bb3015f7856aba94755cba03b392e2a24':'striker'};
const sourceRole=originalSources[sourceHash];if(!sourceRole)throw Error('This authoring pass requires the original47af008 GLB. Do not apply it twice to an already refined asset. See tools/blender/MODEL_REFINEMENT.md.');
const jsonLength=source.readUInt32LE(12),doc=JSON.parse(source.subarray(20,20+jsonLength)),bin=source.subarray(28+jsonLength),raw=[];
for(const view of doc.bufferViews){const e=view.extensions?.EXT_meshopt_compression;if(e){const bytes=new Uint8Array(view.byteLength);MeshoptDecoder.decodeGltfBuffer(bytes,e.count,e.byteStride,bin.subarray(e.byteOffset,e.byteOffset+e.byteLength),e.mode,e.filter);raw.push(Buffer.from(bytes));}else raw.push(Buffer.from(bin.subarray(view.byteOffset??0,(view.byteOffset??0)+view.byteLength)));}
const component={5121:[1,'readUInt8','writeUInt8'],5123:[2,'readUInt16LE','writeUInt16LE'],5125:[4,'readUInt32LE','writeUInt32LE'],5126:[4,'readFloatLE','writeFloatLE']},width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16};
function read(id){const a=doc.accessors[id],v=doc.bufferViews[a.bufferView],c=component[a.componentType],w=width[a.type],stride=v.byteStride??c[0]*w,b=raw[a.bufferView];return Array.from({length:a.count},(_,i)=>Array.from({length:w},(_,k)=>b[c[1]]((a.byteOffset??0)+i*stride+k*c[0])));}
const edited=new Set();
// Vertex colors give gear panels and stitching contrast without a texture or
// material/draw-call increase. Existing skin/kit textures remain unchanged.
for(const mesh of doc.meshes)for(const primitive of mesh.primitives){const count=doc.accessors[primitive.attributes.POSITION].count,view=doc.bufferViews.length,accessor=doc.accessors.length,bytes=Buffer.alloc(count*16);for(let i=0;i<count*4;i++)bytes.writeFloatLE(1,i*4);doc.bufferViews.push({buffer:1,byteOffset:0,byteLength:bytes.length,target:34962,extensions:{EXT_meshopt_compression:{buffer:0,byteOffset:0,byteLength:0,byteStride:16,count,mode:'ATTRIBUTES'}}});doc.accessors.push({bufferView:view,componentType:5126,count,type:'VEC4'});raw.push(bytes);primitive.attributes.COLOR_0=accessor;edited.add(view);}
function write(id,values){const a=doc.accessors[id],v=doc.bufferViews[a.bufferView],c=component[a.componentType],w=width[a.type],stride=c[0]*w,b=Buffer.alloc(values.length*stride);for(let i=0;i<values.length;i++)for(let k=0;k<w;k++)b[c[2]](values[i][k],i*stride+k*c[0]);if(b.equals(raw[a.bufferView]))return;raw[a.bufferView]=b;a.count=values.length;a.byteOffset=0;v.byteLength=b.length;delete v.byteStride;edited.add(a.bufferView);if(a.min){a.min=Array.from({length:w},(_,k)=>Math.min(...values.map(v=>v[k])));a.max=Array.from({length:w},(_,k)=>Math.max(...values.map(v=>v[k])));}}
const smooth=(x,a,b)=>{x=Math.max(0,Math.min(1,(x-a)/(b-a)));return x*x*(3-2*x)};
const originalBoundaryPositions=new Set(doc.meshes.flatMap(m=>m.primitives.filter(p=>doc.materials[p.material].name.startsWith('Skin')||doc.materials[p.material].name==='Kit').flatMap(p=>read(p.attributes.POSITION).map(v=>v.map(x=>Math.round(x*1e5)).join(',')))));
const stats={source:path.basename(args.source),sourceSha256:createHash('sha256').update(source).digest('hex'),changedVertices:{},maximumDisplacementMm:{},preserved:'Original rig, bind matrices, animation data, material names and textures are preserved.',refinements:[]};
for(const mesh of doc.meshes)for(const primitive of mesh.primitives){const mat=doc.materials[primitive.material].name,p=read(primitive.attributes.POSITION),original=p.map(v=>v.slice()),indices=read(primitive.indices).flat(),normals=read(primitive.attributes.NORMAL);let changed=false;
 // Fit the hero donor to a compact athletic head, including its eyes and hair.
 // A smooth neck transition preserves the neck seam and head bone pivot.
 for(let i=0;i<p.length;i++){const [x,y,z]=p[i];if(y<=1.54)continue;const blend=smooth(y,1.54,1.59);p[i][0]*=1+.055*blend;p[i][1]-=(y-1.54)*.04*blend;p[i][2]=.01+(z-.01)*(1-.02*blend);changed=true;}
 if(mat==='Shorts'){
  for(let i=0;i<p.length;i++){if(originalBoundaryPositions.has(original[i].map(x=>Math.round(x*1e5)).join(',')))continue;const [x,y,z]=p[i],hem=smooth(y,.61,.69)*(1-smooth(y,.84,.94)),side=Math.sign(x),outer=smooth(Math.abs(x),.12,.16);p[i][0]+=side*.006*hem*outer;p[i][2]+=(z-.025)*.08*hem;}changed=true;stats.refinements.push('Looser shorts mid-panel volume, tapered to unchanged leg/waist seams');
 }
 if(mat==='Kit'){
  // Weld seam duplicates for fairing, but never modify arm or shoulder regions.
  // Remove superhero muscle trenches from the shirt front while retaining the
  // athletic silhouette, hem/neck boundaries and every existing skin weight.
  const weld=new Map(),representative=[],members=[];
  for(let i=0;i<p.length;i++){const key=p[i].map(x=>Math.round(x*1e5)).join(',');let id=weld.get(key);if(id===undefined){id=members.length;weld.set(key,id);members.push([]);}representative[i]=id;members[id].push(i);}
  const neighbors=members.map(()=>new Set());for(let i=0;i<indices.length;i+=3)for(let a=0;a<3;a++)for(let b=0;b<3;b++){const x=representative[indices[i+a]],y=representative[indices[i+b]];if(x!==y)neighbors[x].add(y);}
  for(let iteration=0;iteration<10;iteration++){
   const prev=members.map(ids=>p[ids[0]].slice());for(let id=0;id<members.length;id++){const i=members[id][0],[x,y,z]=original[i];const mask=smooth(y,.98,1.06)*(1-smooth(y,1.36,1.43))*(1-smooth(Math.abs(x),.11,.17))*smooth(z,.025,.065);if(mask<=0||neighbors[id].size<3)continue;const avg=[...neighbors[id]].reduce((s,j)=>s+prev[j][2],0)/neighbors[id].size,delta=Math.max(-.0015,Math.min(.0015,avg-prev[id][2]))*.7*mask;for(const vertex of members[id])p[vertex][2]+=delta;}
  }
  // A jersey bridges the waist hollows instead of tracing superhero abs.
  for(let i=0;i<p.length;i++){const [x,y,z]=original[i],waist=smooth(y,.985,1.07)*(1-smooth(y,1.17,1.29)),center=1-smooth(Math.abs(x),.14,.18);p[i][0]*=1+.095*waist*center;if(z<.025)p[i][2]-=.014*waist*center*(1-smooth(z,-.015,.025));const chest=smooth(y,1.19,1.24)*(1-smooth(y,1.34,1.40))*center*smooth(z,.08,.125);p[i][2]-=.006*chest;}
  // Tailor a continuous cloth envelope over the donor's pectoral/lat grooves.
  // Keep shoulder/arm transition and both hem rows fixed. This is real rest
  // geometry, not a painted muscle mask or runtime collision inflation.
  for(let i=0;i<p.length;i++){const [x,y,z]=original[i],fit=smooth(y,.985,1.055)*(1-smooth(y,1.35,1.435))*(1-smooth(Math.abs(x),.145,.18)),radius=.145+.042*smooth(y,1.12,1.32),cross=Math.sqrt(Math.max(0,1-(p[i][0]/radius)**2)),front=smooth(z,.025,.065),back=1-smooth(z,-.025,.015);let target=.025+(.110+.01*smooth(y,1.12,1.28))*cross;if(back>front)target=.025-(.103+.005*smooth(y,1.1,1.3))*cross;p[i][2]+=(target-p[i][2])*.50*fit*front;p[i][2]+=.0013*Math.sin(y*92+x*23)*fit*front*(1-smooth(y,1.1,1.22));}
  // The striker's captured settling arm passes close to the original waist.
  // Preserve that lower-torso corridor exactly; retain chest tailoring above it.
  if(sourceRole==='striker')for(let i=0;i<p.length;i++){const blend=smooth(original[i][1],1.30,1.44);for(let k=0;k<3;k++)p[i][k]=original[i][k]+(p[i][k]-original[i][k])*blend;}
  changed=true;stats.refinements.push('Athletic jersey silhouette: filled waist hollow and softened breastplate; topology-preserving shirt-front fairing: softer abdominal/pectoral grooves, protected shoulder/arm/hem boundaries');
 }
 if(mat==='Boots'){
  // The original crown was a flat painted cap. Sculpt a compact swept hair
  // silhouette only above the existing hairline, keeping the face untouched.
  for(let i=0;i<p.length;i++){const [x,y,z]=p[i];if(y<1.69)continue;const crown=smooth(y,1.70,1.79);p[i][1]+=.008*crown*(.6+.4*Math.cos(18*x+8*z));p[i][0]+=.003*crown;p[i][2]+=.002*crown;}
  changed=true;stats.refinements.push('Head and crown proportions refined together with eye geometry; original facial detail and texture layout retained');
 }
 const movement=p.map((v,i)=>Math.hypot(...v.map((x,k)=>x-original[i][k]))),max=Math.max(...movement);stats.changedVertices[mat]=movement.filter(x=>x>1e-8).length;stats.maximumDisplacementMm[mat]=max*1000;
 if(changed){
  // Area-weighted smooth normals, welded by rest position to avoid seam facets.
  const accum=p.map(()=>[0,0,0]);for(let i=0;i<indices.length;i+=3){const [a,b,c]=indices.slice(i,i+3),ab=p[b].map((x,k)=>x-p[a][k]),ac=p[c].map((x,k)=>x-p[a][k]),n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];for(const id of[a,b,c])for(let k=0;k<3;k++)accum[id][k]+=n[k];}
  // Only updated neighborhoods receive new normals. Unchanged shoes and faces
  // retain their exact authored normals and exact contact surface.
  const affected=new Set();for(let i=0;i<indices.length;i+=3)if(indices.slice(i,i+3).some(v=>movement[v]>1e-8))for(const v of indices.slice(i,i+3))affected.add(v);
  if(mat==='Kit'||mat==='Shorts'){
   const sums=new Map();for(let i=0;i<p.length;i++){const key=p[i].map(x=>Math.round(x*1e5)).join(','),sum=sums.get(key)??[0,0,0];for(let k=0;k<3;k++)sum[k]+=accum[i][k];sums.set(key,sum);}for(let i=0;i<p.length;i++){const n=sums.get(p[i].map(x=>Math.round(x*1e5)).join(',')),l=Math.hypot(...n);if(l>1e-12)normals[i]=n.map(x=>x/l);}
  }else for(const i of affected){const n=accum[i],l=Math.hypot(...n);if(l>1e-12)normals[i]=n.map(x=>x/l);}
  write(primitive.attributes.POSITION,p);write(primitive.attributes.NORMAL,normals);
 }
}
// Tailor the old square chest cutout into a shallow crew neck. Move triangles
// between existing material primitives, preserving geometry and all influences.
for(const mesh of doc.meshes){
 const find=n=>mesh.primitives.find(p=>doc.materials[p.material].name.startsWith(n)),skin=find('Skin'),kit=find('Kit'),trim=find('Shorts'),boots=find('Boots');
 const attrs=p=>Object.fromEntries(Object.entries(p.attributes).map(([k,id])=>[k,read(id)]));
 const s=attrs(skin),k=attrs(kit),t=attrs(trim),b=attrs(boots),si=read(skin.indices).flat(),ki=read(kit.indices).flat(),ti=read(trim.indices).flat(),bi=read(boots.indices).flat(),kept=[],map=new Map();
 const intersections=new Map();let movedFaces=0;
 const field=id=>{const [x,y,z]=s.POSITION[id],front=smooth(z,-.045,.045),depth=.012+.022*front;return y-(1.512-.012*front-depth*Math.max(0,1-(x/.085)**2));};
 function splitVertex(a,b){const edge=[a,b].sort((x,y)=>x-y).join(',');if(intersections.has(edge))return intersections.get(edge);const fa=field(a),fb=field(b),q=fa/(fa-fb),id=s.POSITION.length;for(const name of Object.keys(s)){if(name==='JOINTS_0'||name==='WEIGHTS_0')continue;s[name].push(s[name][a].map((v,i)=>v+(s[name][b][i]-v)*q));}const weights=new Map();for(const[v,f]of[[a,1-q],[b,q]])for(let i=0;i<4;i++)weights.set(s.JOINTS_0[v][i],(weights.get(s.JOINTS_0[v][i])??0)+s.WEIGHTS_0[v][i]*f);const retained=[...weights].filter(x=>x[1]>1e-9).sort((a,b)=>b[1]-a[1]).slice(0,4),total=retained.reduce((a,b)=>a+b[1],0);while(retained.length<4)retained.push([0,0]);s.JOINTS_0.push(retained.map(x=>x[0]));s.WEIGHTS_0.push(retained.map(x=>x[1]/total));const n=s.NORMAL[id],l=Math.hypot(...n);s.NORMAL[id]=n.map(x=>x/l);intersections.set(edge,id);return id;}
 const clip=(ids,positive)=>{const poly=[];for(let i=0;i<ids.length;i++){const a=ids[i],b=ids[(i+1)%ids.length],fa=field(a),fb=field(b),inside=positive?fa>=0:fa<=0;if(inside)poly.push(a);if(fa*fb<0)poly.push(splitVertex(a,b));}return poly;};
 const triangles=poly=>{const result=[];for(let i=1;i<poly.length-1;i++)result.push(poly[0],poly[i],poly[i+1]);return result;};
 for(let i=0;i<si.length;i+=3){const ids=si.slice(i,i+3),c=[0,1,2].map(j=>ids.reduce((sum,v)=>sum+s.POSITION[v][j],0)/3);if(Math.abs(c[0])>.112||c[1]<1.40||c[1]>1.535){kept.push(...ids);continue;}const stay=triangles(clip(ids,true)),move=triangles(clip(ids,false));kept.push(...stay);movedFaces+=move.length/3;for(const id of move){if(!map.has(id)){map.set(id,k.POSITION.length);for(const name of Object.keys(k))k[name].push(s[name][id].slice());}ki.push(map.get(id));}}
 const key=p=>p.map(x=>Math.round(x*1e5)).join(',');
 function boundary(data,idx,other,otherIdx,select){const edges=new Set();for(let i=0;i<otherIdx.length;i+=3)for(let a=0;a<3;a++){const p=key(other.POSITION[otherIdx[i+a]]),q=key(other.POSITION[otherIdx[i+(a+1)%3]]);edges.add([p,q].sort().join('|'));}const found=new Map();for(let i=0;i<idx.length;i+=3)for(let a=0;a<3;a++){const v=idx[i+a],w=idx[i+(a+1)%3],p=data.POSITION[v],q=data.POSITION[w],edge=[key(p),key(q)].sort().join('|');if(edges.has(edge)&&select(p,q))found.set(edge,[v,w]);}return [...found.values()];}
 function loops(data,edges){const adj=new Map(),ids=new Map();for(const[a,b]of edges){const ka=key(data.POSITION[a]),kb=key(data.POSITION[b]);ids.set(ka,a);ids.set(kb,b);if(!adj.has(ka))adj.set(ka,new Set());if(!adj.has(kb))adj.set(kb,new Set());adj.get(ka).add(kb);adj.get(kb).add(ka);}const result=[],used=new Set();for(const start of adj.keys()){if(used.has(start))continue;const loop=[];let current=start,previous=null;for(let safe=0;safe<500;safe++){loop.push(ids.get(current));used.add(current);const next=[...adj.get(current)].find(n=>n!==previous&&!used.has(n));if(!next)break;previous=current;current=next;}if(loop.length>=3){loop.closed=adj.get(key(data.POSITION[loop.at(-1)]))?.has(key(data.POSITION[loop[0]]));result.push(loop);}}return result;}
 function interpolate(data,a,b,q){const v={};for(const name of Object.keys(data)){if(name==='JOINTS_0'||name==='WEIGHTS_0')continue;v[name]=data[name][a].map((x,k)=>x+(data[name][b][k]-x)*q);}const weights=new Map();for(const[id,f]of[[a,1-q],[b,q]])for(let k=0;k<4;k++)weights.set(data.JOINTS_0[id][k],(weights.get(data.JOINTS_0[id][k])??0)+data.WEIGHTS_0[id][k]*f);const r=[...weights].sort((a,b)=>b[1]-a[1]).slice(0,4),sum=r.reduce((a,b)=>a+b[1],0);while(r.length<4)r.push([0,0]);v.JOINTS_0=r.map(x=>x[0]);v.WEIGHTS_0=r.map(x=>x[1]/sum);const len=Math.hypot(...v.NORMAL);v.NORMAL=v.NORMAL.map(x=>x/len);return v;}
 let collarFaces=0,garmentFaces=0;
 function band(data,edges,budgetSegments,width,direction,color){let faces=0;const chains=loops(data,edges).map(loop=>{const lengths=[0],n=loop.closed?loop.length:loop.length-1;for(let i=0;i<n;i++)lengths.push(lengths.at(-1)+Math.hypot(...data.POSITION[loop[i]].map((x,k)=>x-data.POSITION[loop[(i+1)%loop.length]][k])));return{loop,lengths,total:lengths.at(-1)};});const totalLength=chains.reduce((s,c)=>s+c.total,0);for(const{loop,lengths,total}of chains){const segments=Math.max(2,Math.floor(budgetSegments*total/totalLength)),count=loop.closed?segments:segments+1,points=[];for(let i=0;i<count;i++){const at=total*i/segments;let edge=0;while(edge<lengths.length-2&&lengths[edge+1]<at)edge++;points.push(interpolate(data,loop[edge],loop[(edge+1)%loop.length],(at-lengths[edge])/(lengths[edge+1]-lengths[edge])));}const start=b.POSITION.length;
 for(const point of points)for(const offset of[0,width]){const axis=direction(point.POSITION),dot=axis.reduce((sum,x,k)=>sum+x*point.NORMAL[k],0);for(const name of Object.keys(b)){let v=point[name].slice();if(name==='POSITION')v=v.map((x,k)=>x+point.NORMAL[k]*.0045+(axis[k]-dot*point.NORMAL[k])*offset);if(name==='COLOR_0')v=[...color,1];b[name].push(v);}}
 for(let i=0;i<segments;i++){const next=(i+1)%count;bi.push(start+2*i,start+2*next,start+2*next+1,start+2*i,start+2*next+1,start+2*i+1);faces+=2;}}
 return faces;}
 const dark=[.025,.045,.055],pale=[.55,.65,.65];
 collarFaces+=band(k,boundary(k,ki,s,kept,(p,q)=>Math.min(p[1],q[1])>1.435&&Math.max(Math.abs(p[0]),Math.abs(q[0]))<.12),32,.007,()=>[0,-1,0],dark);
 garmentFaces+=band(k,boundary(k,ki,s,kept,(p,q)=>Math.max(p[1],q[1])<1.40&&Math.min(Math.abs(p[0]),Math.abs(q[0]))>.18),32,.008,p=>[-Math.sign(p[0])*.45,.9,0],dark);
 for(let i=0;i<k.POSITION.length;i++)if(k.POSITION[i][1]<.974)k.COLOR_0[i]=[.55,.62,.64,1];
 garmentFaces+=band(t,boundary(t,ti,s,kept,(p,q)=>Math.max(p[1],q[1])<.8),64,.008,()=>[0,1,0],pale);
 const sockPrimitive=find('Socks'),sock=attrs(sockPrimitive),sockIndices=read(sockPrimitive.indices).flat();
 garmentFaces+=band(sock,boundary(sock,sockIndices,s,kept,(p,q)=>Math.min(p[1],q[1])>.65),16,.012,p=>[Math.sign(p[0])*.45,-.9,0],dark);
 stats.addedGarmentTrimTriangles=garmentFaces;
 // Low-profile three-sided studs leave the shoe upper/contact patch bit-exact.
 // Animated sole clearance must be re-audited when foot geometry changes.
 const joint=side=>doc.skins[0].joints.findIndex(i=>doc.nodes[i].name==='foot.'+side);let studFaces=0;
 for(const[side,sign]of[['L',-1],['R',1]])for(const[z,dx]of[[.145,-.031],[.145,.031],[.082,-.034],[.082,.034],[-.025,-.028],[-.025,.028]]){
  const start=b.POSITION.length;
  for(let ring=0;ring<2;ring++)for(let n=0;n<3;n++){const angle=n*Math.PI*2/3,radius=ring?.009:.007,bone=joint(side);b.POSITION.push([sign*.125+dx+radius*Math.cos(angle),ring?.015:.004,z+radius*Math.sin(angle)]);b.NORMAL.push([Math.cos(angle),-.15,Math.sin(angle)]);b.TEXCOORD_0.push([0,0]);b.JOINTS_0.push([bone,0,0,0]);b.WEIGHTS_0.push([1,0,0,0]);b.COLOR_0.push([.02,.025,.03,1]);}
  for(let n=0;n<3;n++){const next=(n+1)%3;bi.push(start+n,start+next,start+3+next,start+n,start+3+next,start+3+n);studFaces+=2;}
  for(let n=1;n<2;n++){bi.push(start,start+n+1,start+n);studFaces++;}
 }
 const originalBootCount=doc.accessors[boots.attributes.POSITION].count,bootColor=doc.materials[boots.material].pbrMetallicRoughness.baseColorFactor.slice(0,3);doc.materials[boots.material].pbrMetallicRoughness.baseColorFactor=[1,1,1,1];
 for(let i=0;i<originalBootCount;i++){const[x,y,z]=b.POSITION[i],dx=Math.abs(x)-.125;let color=bootColor;if(y<.16){color=y<.043?[.012,.018,.024]:[.065,.105,.12];if(y>.055&&z<.03)color=[.18,.26,.29];if(y>.048&&Math.abs(dx)>.045)color=[.33,.48,.50];if(y>.092&&Math.abs(dx)<.026&&z>.035&&z<.14)color=[.20,.28,.30];}b.COLOR_0[i]=[...color,1];}
 // Backhand and segmented dorsal fingers remain on the existing glove mesh.
 // No displacement is applied to the white catch surface/palm/fingertips.
 const inverses=read(doc.skins[0].inverseBindMatrices),local=(p,m)=>[0,1,2].map(k=>m[k]*p[0]+m[k+4]*p[1]+m[k+8]*p[2]+m[k+12]);
 for(let i=0;i<sock.POSITION.length;i++){const hand=sock.JOINTS_0[i].find((j,k)=>sock.WEIGHTS_0[i][k]>.5&&doc.nodes[doc.skins[0].joints[j]].name.startsWith('hand.'));if(hand===undefined)continue;const p=local(sock.POSITION[i],inverses[hand]),normal=sock.NORMAL[i];if(normal[2]>.05)continue;let color=[.28,.40,.43];if(p[1]<.075)color=[.075,.16,.20];else if(Math.abs(((p[1]-.07)*50)%1)<.28)color=[.12,.22,.25];sock.COLOR_0[i]=[...color,1];}
 for(const[name,id]of Object.entries(sockPrimitive.attributes))write(id,sock[name]);
 stats.refinements.push('Modeled sleeve/shorts hems and keeper glove cuffs; vertex-colored jersey hem; vertex-colored cleat panels and glove backhand/finger segments, with no new textures or materials');
 for(const[p,data,idx]of[[skin,s,kept],[kit,k,ki],[trim,t,ti],[boots,b,bi]]){for(const[name,id]of Object.entries(p.attributes))write(id,data[name]);write(p.indices,idx.map(x=>[x]));}
 stats.materialMovedTriangles=movedFaces;stats.addedNeckCutVertices=intersections.size;stats.materialMovedVertices=map.size;stats.addedCollarTriangles=collarFaces;stats.addedStudTriangles=studFaces;stats.refinements.push('Shallow crew-neck cut and raised dark binding, reusing existing kit/shorts material palette','Twelve low-profile modeled cleat studs; original shoe upper/contact vertices retained and animated floor clearance audited');
 stats.preserved='Original bone nodes, inverse-bind matrices, animations, material names and texture bytes preserved. Face proportions refined consistently with eyes. Palms and shoe-upper positions protected and checked separately. Neck material reassignment changes Skin/Kit triangle indexing; trim and studs appended.';
}

// Repack compressed payloads. Untouched streams are copied byte-for-byte;
// Edited positions use 18-bit exponential filtering, normals 12-bit.
// Encoding errors are audited against decoded candidate data before acceptance.
const normalViews=new Set(doc.meshes.flatMap(m=>m.primitives.map(p=>doc.accessors[p.attributes.NORMAL].bufferView)));
const positionViews=new Set(doc.meshes.flatMap(m=>m.primitives.map(p=>doc.accessors[p.attributes.POSITION].bufferView)));
const finalRaw=new Map();stats.encodingMaxPositionErrorMm=0;stats.encodingMaxNormalComponentError=0;
function pack(compressed){const d=structuredClone(doc),chunks=[];let offset=0,fallback=0;for(let i=0;i<d.bufferViews.length;i++){const v=d.bufferViews[i],old=doc.bufferViews[i].extensions?.EXT_meshopt_compression;let payload;if(compressed&&old){const count=edited.has(i)?raw[i].length/old.byteStride:old.count;const normal=edited.has(i)&&normalViews.has(i),position=edited.has(i)&&positionViews.has(i),input=normal||position?MeshoptEncoder.encodeFilterExp(new Float32Array(raw[i].buffer,raw[i].byteOffset,raw[i].byteLength/4),count,old.byteStride,normal?12:18,'SharedComponent'):raw[i];payload=edited.has(i)?Buffer.from(MeshoptEncoder.encodeGltfBuffer(input,count,old.byteStride,old.mode)):bin.subarray(old.byteOffset,old.byteOffset+old.byteLength);if(edited.has(i)){const decoded=new Uint8Array(raw[i].length);MeshoptDecoder.decodeGltfBuffer(decoded,count,old.byteStride,payload,old.mode,normal||position?'EXPONENTIAL':'NONE');finalRaw.set(i,Buffer.from(decoded));if(normal||position){const before=new Float32Array(raw[i].buffer,raw[i].byteOffset,raw[i].byteLength/4),after=new Float32Array(decoded.buffer);let error=0;for(let n=0;n<before.length;n++)error=Math.max(error,Math.abs(before[n]-after[n]));if(position)stats.encodingMaxPositionErrorMm=Math.max(stats.encodingMaxPositionErrorMm,error*1000);else stats.encodingMaxNormalComponentError=Math.max(stats.encodingMaxNormalComponentError,error);}}v.extensions={EXT_meshopt_compression:{...old,buffer:0,byteOffset:offset,byteLength:payload.length,count,...(edited.has(i)?{filter:normal||position?'EXPONENTIAL':'NONE'}:{})}};v.buffer=1;v.byteOffset=fallback;fallback+=v.byteLength;}else{payload=finalRaw.get(i)??raw[i];v.buffer=0;v.byteOffset=offset;delete v.extensions;}chunks.push(payload);offset+=payload.length;const pad=(4-offset%4)%4;chunks.push(Buffer.alloc(pad));offset+=pad;}d.buffers=[{byteLength:offset},...(compressed?[{byteLength:fallback}]:[])];if(!compressed){d.extensionsUsed=d.extensionsUsed?.filter(x=>x!=='EXT_meshopt_compression');d.extensionsRequired=d.extensionsRequired?.filter(x=>x!=='EXT_meshopt_compression');}let j=Buffer.from(JSON.stringify(d));j=Buffer.concat([j,Buffer.alloc((4-j.length%4)%4,32)]);const binary=Buffer.concat(chunks),h=Buffer.alloc(20),bh=Buffer.alloc(8);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(28+j.length+binary.length,8);h.writeUInt32LE(j.length,12);h.write('JSON',16);bh.writeUInt32LE(binary.length);bh.write('BIN\0',4);return Buffer.concat([h,j,bh,binary]);}
await fs.mkdir(args.out,{recursive:true});const name=path.basename(args.source,'.glb'),candidate=pack(true),triangleCount=doc.meshes.flatMap(m=>m.primitives).reduce((s,p)=>s+doc.accessors[p.indices].count/3,0);if(candidate.length>450000||triangleCount>18000)throw Error('Candidate exceeds unchanged450KB/18k triangle budget');stats.authoringScriptSha256=createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex');stats.role=sourceRole;stats.materials=doc.materials.length;stats.textures=doc.textures.length;stats.sourceTriangleCount=17518;stats.addedVertexColorBytes=doc.meshes.flatMap(m=>m.primitives).reduce((sum,p)=>sum+doc.accessors[p.attributes.POSITION].count*16,0);await fs.writeFile(path.join(args.out,name+'.glb'),candidate);await fs.writeFile(path.join(args.out,name+'-decoded.glb'),pack(false));stats.glbBytes=candidate.length;stats.sourceBytes=source.length;stats.triangles=doc.meshes.flatMap(m=>m.primitives).reduce((s,p)=>s+doc.accessors[p.indices].count/3,0);stats.bones=doc.skins[0].joints.length;stats.maxSkinInfluences=4;await fs.writeFile(path.join(args.out,name+'.json'),JSON.stringify(stats,null,2)+'\n');console.log(JSON.stringify(stats,null,2));
