/**
 * Deterministic structural budget, NOT a WebGL benchmark or mobile FPS claim.
 * Usage: node tools/qa/audit-render-budget.mjs [--root /repo] [--scene-ref a0db4a3] [--check]
 * --scene-ref substitutes only committed scene.js; current assets/helpers/dependencies
 * remain in use. This isolates scene edits, not an entire historical application.
 * --check gates the current low-cost scene budget (do not use for old baselines).
 * GPU timing, frustum culling, runtime visibility, texture decode, shader compilation,
 * fallback resources and browser memory must be measured separately on target devices.
 */
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';

const args=process.argv.slice(2);
function option(name){const i=args.indexOf(name);if(i<0)return null;if(!args[i+1]||args[i+1].startsWith('--'))throw Error(`Missing ${name} value`);return args[i+1];}
const rootPath=resolve(option('--root')??fileURLToPath(new URL('../../',import.meta.url)));
const root=pathToFileURL(rootPath+'/'),sceneRef=option('--scene-ref');
const THREE=await import(new URL('node_modules/three/build/three.module.js',root));
const {loadCharacter}=await import(new URL('tests/helpers/load-character.js',root));
const actors=[await loadCharacter(true),await loadCharacter(false)];
// The fixture loads real geometry, bones and production skin setup, but removes
// GLB texture references for Node. Reproduce GameCharacter visibility/shadow flags.
// Its two jersey-number planes are accounted explicitly below, not synthesized.
globalThis.AuditCharacter=class{
  constructor(scene,color,keeper){
    this.root=actors[keeper?0:1].root;this.group=new THREE.Group();this.group.add(this.root);scene.add(this.group);
    this.root.traverse(object=>{if(object.isMesh)object.castShadow=object.receiveShadow=true;});this.ready=Promise.resolve();
  }
};
globalThis.AuditRenderer=class{
  constructor(){this.shadowMap={};this.domElement={};this.info={};}
  setPixelRatio(){} setSize(){}
};
const context=new Proxy({createRadialGradient(){return{addColorStop(){}};}},{get:(target,key)=>target[key]??(()=>{})});
globalThis.document={createElement:()=>({getContext:()=>context})};
globalThis.window={matchMedia:()=>({matches:false}),devicePixelRatio:2};
globalThis.location={search:''};globalThis.ResizeObserver=class{observe(){}};
const sceneSource=sceneRef?execFileSync('git',['show',`${sceneRef}:src/scene.js`],{cwd:rootPath,encoding:'utf8'}):await readFile(new URL('src/scene.js',root),'utf8');
if(!sceneSource.includes("import {GameCharacter} from './game-character.js';")||!sceneSource.includes('new THREE.WebGLRenderer('))throw Error('Scene construction changed: review audit adapter before trusting census');
const source=sceneSource
  .replace("import {GameCharacter} from './game-character.js';",'const GameCharacter=globalThis.AuditCharacter;')
  .replace('new THREE.WebGLRenderer(','new globalThis.AuditRenderer(')
  .replaceAll(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL(path,new URL('src/scene.js',root)).href}'`)
  .replace("from 'three'",`from '${new URL('node_modules/three/build/three.module.js',root).href}'`);
const {Stadium}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const stadium=new Stadium({appendChild(){},getBoundingClientRect(){return{width:390,height:844};}});
const counts={meshCandidates:0,lineCandidates:0,spriteCandidates:0,meshTriangles:0,shadowMeshCandidates:0,shadowMeshTriangles:0};
const materials=new Set(),textures=new Set(),rows=[];
stadium.scene.traverseVisible(object=>{
  for(const material of Array.isArray(object.material)?object.material:[object.material]){
    if(!material)continue;materials.add(material);
    for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
  }
  if(object.isMesh){
    const geometry=object.geometry,triangles=(geometry.index?.count??geometry.attributes.position.count)/3*(object.isInstancedMesh?object.count:1);
    const calls=Array.isArray(object.material)?geometry.groups.length:1;
    counts.meshCandidates+=calls;counts.meshTriangles+=triangles;
    if(object.castShadow){counts.shadowMeshCandidates+=calls;counts.shadowMeshTriangles+=triangles;}
    rows.push({name:object.name||object.type,material:object.material.name||object.material.type,triangles,castShadow:object.castShadow});
  }else if(object.isLine)counts.lineCandidates++;else if(object.isSprite)counts.spriteCandidates++;
});
function logicalRGBABytes(width,height,mips){let bytes=0;do{bytes+=width*height*4;if(!mips||width===1&&height===1)break;width=Math.max(1,Math.floor(width/2));height=Math.max(1,Math.floor(height/2));}while(true);return bytes;}
const generatedTextures=[...textures].filter(texture=>texture.isCanvasTexture).map(texture=>({width:texture.image.width,height:texture.image.height,mipmaps:texture.generateMipmaps,logicalRGBABytes:logicalRGBABytes(texture.image.width,texture.image.height,texture.generateMipmaps)})).sort((a,b)=>b.width-a.width||b.height-a.height);
const omittedJerseyNumbers={mainCandidates:2,shadowCandidates:2,mainTriangles:4,shadowTriangles:4};
const totals={mainCandidates:counts.meshCandidates+counts.lineCandidates+counts.spriteCandidates+2,shadowCandidates:counts.shadowMeshCandidates+2,mainMeshTriangles:counts.meshTriangles+4,shadowMeshTriangles:counts.shadowMeshTriangles+4};
const report={scope:'CPU scene candidates before camera/shadow frustum culling; initial visibility includes aim, arc and trail. Not renderer.info, GPU timings or mobile FPS. Transparent double-sided extra passes not modeled.',sceneRef:sceneRef??'working-tree',sceneSha256:createHash('sha256').update(sceneSource).digest('hex'),counts,omittedJerseyNumbers,totals,uniqueMaterialsExcludingNumbers:materials.size,generatedTextures,generatedTextureLogicalBytes:generatedTextures.reduce((sum,texture)=>sum+texture.logicalRGBABytes,0),textureScope:'Generated scene CanvasTextures only; excludes GLB maps, number maps, hidden fallback resources, shadow/depth targets and driver/MSAA allocations. RGBA8 logical mip size, not measured GPU memory.',rows};
// Fingerprint the baked architecture, preserving triangle winding and vertex
// attributes while ignoring batching boundaries, object UUIDs and shadow flags.
// Canvas texels are not rendered by this audit; texture dimensions only are compared.
const architecture=stadium.scene.children.find(object=>object.isGroup&&object.children.every(child=>child.isMesh&&!child.isSkinnedMesh)&&object.children.some(child=>(child.geometry?.attributes.position.count??0)>100));
if(!architecture)throw Error('Architecture group changed: review fingerprint adapter');
architecture.updateWorldMatrix(true,true);
const rigidTriangles=[],position=new THREE.Vector3(),normal=new THREE.Vector3(),normalMatrix=new THREE.Matrix3();
const rounded=value=>Math.round(value*1e5)/1e5;
architecture.traverse(object=>{
  if(!object.isMesh)return;
  const geometry=object.geometry,material=object.material;
  if(Array.isArray(material))throw Error('Review architecture material groups');
  const parameters={type:material.type,color:material.color?.getHex(),roughness:material.roughness,metalness:material.metalness,opacity:material.opacity,transparent:material.transparent,side:material.side,depthTest:material.depthTest,depthWrite:material.depthWrite,map:material.map?{width:material.map.image.width,height:material.map.image.height}:null};
  normalMatrix.getNormalMatrix(object.matrixWorld);
  const vertices=[];
  for(let i=0;i<geometry.attributes.position.count;i++){
    position.fromBufferAttribute(geometry.attributes.position,i).applyMatrix4(object.matrixWorld);
    const values=position.toArray();
    if(geometry.attributes.normal){normal.fromBufferAttribute(geometry.attributes.normal,i).applyNormalMatrix(normalMatrix);values.push(...normal.toArray());}
    for(const name of ['uv','color']){const attribute=geometry.attributes[name];if(attribute)for(let k=0;k<attribute.itemSize;k++)values.push(attribute.getComponent(i,k));}
    vertices.push(values.map(rounded).join(','));
  }
  const count=geometry.index?.count??vertices.length;
  for(let i=0;i<count;i+=3){
    const triangle=[0,1,2].map(k=>vertices[geometry.index?geometry.index.getX(i+k):i+k]);
    const cyclic=triangle.map((_,k)=>[...triangle.slice(k),...triangle.slice(0,k)].join('|')).sort()[0];
    rigidTriangles.push(JSON.stringify(parameters)+':'+cyclic);
  }
});
report.rigidArchitecture={triangles:rigidTriangles.length,sha256:createHash('sha256').update(rigidTriangles.sort().join('\n')).digest('hex'),scope:'Triangle multiset with winding, world positions/normals, UV/colors at1e-5 precision and material parameters; excludes UUID, batching boundaries, cast/receive shadow flags; Canvas image dimensions only, not rendered texels'};
if(args.includes('--check')){
  report.gates={mainCandidates:totals.mainCandidates<=45,shadowCandidates:totals.shadowCandidates<=22,triangles:totals.mainMeshTriangles<=63470,generatedTextureBytes:report.generatedTextureLogicalBytes<=5964000};
  if(Object.values(report.gates).some(pass=>!pass))process.exitCode=1;
}
console.log(JSON.stringify(report,null,2));
