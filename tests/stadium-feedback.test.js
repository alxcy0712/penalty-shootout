import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
const renders=[];
class Renderer{
 constructor(){this.shadowMap={};this.domElement={};this.info={autoReset:true,render:{calls:0,triangles:0},memory:{geometries:0,textures:0},reset(){renders.push('reset');this.render.calls=0;}};}
 setPixelRatio(){}setSize(){}
 render(){renders.push('render');this.info.render.calls+=5;}
}
class Character{constructor(scene){this.group=new THREE.Group();scene.add(this.group);this.ready=Promise.resolve();}pose(){}kick(){}setColor(){}}
const context=new Proxy({createRadialGradient:()=>({addColorStop(){}})},{get:(object,key)=>object[key]??(()=>{})});
globalThis.document={createElement:()=>({style:{},getContext:()=>context}),body:{appendChild(){}}};
globalThis.window={matchMedia:()=>({matches:false}),devicePixelRatio:2};globalThis.location={search:''};globalThis.ResizeObserver=class{observe(){}};
globalThis.FeedbackRenderer=Renderer;globalThis.FeedbackCharacter=Character;
let source=await readFile(new URL('../src/scene.js',import.meta.url),'utf8');
source=source.replace("import {GameCharacter} from './game-character.js';",'const GameCharacter=globalThis.FeedbackCharacter;').replace('new THREE.WebGLRenderer(','new globalThis.FeedbackRenderer(').replaceAll(/from '(\.\/[^']+)'/g,(_,path)=>`from '${new URL(path,new URL('../src/scene.js',import.meta.url))}'`).replace("from 'three'",`from '${new URL('../node_modules/three/build/three.module.js',import.meta.url)}'`);
const {Stadium}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
function stadium(profile=false){location.search=profile?'?profile':'';return new Stadium({appendChild(){},getBoundingClientRect:()=>({width:390,height:844})});}
function goal(){return{ball:{x:3.5,y:2,z:-1.65},velocity:{x:8,y:4,z:-24},result:{goal:true},animationTime:0,t:0,aim:{x:0,power:.7},poseAt:()=>({})};}
function sample(fps){const s=stadium(),shot=goal(),events=[];const impact=s.netMotion.impact.bind(s.netMotion);s.netMotion.impact=(hit,time)=>{events.push([hit.surface,time]);return impact(hit,time);};for(let i=0;i<fps/2;i++)s.update(1/fps,(i+1)/fps,shot);return{s,shot,events,positions:Array.from(s.net.geometry.attributes.position.array)};}
test('actual Stadium consumes every net event once with equivalent 30/60/120Hz presentation',()=>{
 const frames=[30,60,120].map(sample);for(const value of frames.slice(1)){assert.deepEqual(value.events,frames[0].events);for(let i=0;i<value.positions.length;i++)assert.ok(Math.abs(value.positions[i]-frames[0].positions[i])<1e-6);}
 const {s,shot,events}=frames[0],n=events.length,positions=[...s.net.geometry.attributes.position.array];s.needsRender=true;s.update(0,.5,shot);assert.equal(events.length,n);assert.deepEqual([...s.net.geometry.attributes.position.array],positions);
});
test('mode/shot changes restore existing net buffer instead of leaving the preceding impulse',()=>{
 const {s}=sample(60),attribute=s.net.geometry.attributes.position;assert.notDeepEqual(attribute.array,s.netOriginal);const version=attribute.version;s.setMode('game');assert.deepEqual(attribute.array,s.netOriginal);assert.equal(attribute.version,version+1);s.resetNet();assert.equal(attribute.version,version+1);
});
test('opt-in render counters reset before submission and retain shadow-inclusive totals',()=>{
 const s=stadium(true);assert.equal(s.renderer.info.autoReset,false);renders.length=0;s.update(1/60,0);assert.deepEqual(renders,['reset','render']);assert.equal(s.renderer.info.render.calls,5);
 const normal=stadium();assert.equal(normal.renderer.info.autoReset,true);renders.length=0;normal.update(1/60,0);assert.deepEqual(renders,['render']);
});
test('soft contact shadow reuses one map/draw and no longer casts another shadow',()=>{
 const s=stadium();assert.equal(s.ballShadow.castShadow,false);assert.equal(s.ballShadow.receiveShadow,false);assert.equal(s.ballShadow.material.map.image.width,64);const state=s.ballShadowState;s.update(1/60,0);assert.equal(s.ballShadowState,state);
});
