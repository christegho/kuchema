import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createStore} from '../server/store.js';
import {inspectCut} from '../server/crops.js';
import {TRANSFORM_OPTIONS,DEFAULT_TRANSFORMS,transformImage,restrainTreatments} from '../server/transforms.js';
import {creationInput,advanceFor} from '../server/plan.js';
import {coverageReader,fillComposition,COMPOSITION_LIMITS} from '../server/coverage.js';

async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'material-rules-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 return createStore(dir);
}
async function pattern(){
 const data=Buffer.alloc(120*80*4);
 for(let y=0;y<80;y++)for(let x=0;x<120;x++){const i=(y*120+x)*4;data[i]=40+x;data[i+1]=65+y;data[i+2]=70+((x+y)%90);data[i+3]=x<5?0:255;}
 return sharp(data,{raw:{width:120,height:80,channels:4}}).png().toBuffer();
}
test('all treatments preserve original pixels, dimensions and alpha; new treatments change material without extreme strength',async t=>{
 const store=await fixture(t),bytes=await pattern(),source=await store.addImage(bytes,'texture.png',{kind:'generated',allowCrop:true,allowTransform:true});
 const before=await sharp(bytes).raw().toBuffer();
 for(const option of TRANSFORM_OPTIONS){
  const result=await transformImage(store,source,{type:option.id,strength:1,reason:'Water, land and printed memory',palette:'#183f3b #68764a #9c6b40 #d6c8a5'});
  assert.notEqual(result.hash,source.hash,option.id);assert.equal(result.width,120);assert.equal(result.height,80);
  assert.equal(result.derived.transform.effectiveStrength,option.maxStrength);
  if(option.id!=='reproduction'){
   const after=await sharp(path.join(store.root,'media',`${result.id}.png`)).ensureAlpha().raw().toBuffer();
   for(let i=3;i<before.length;i+=4)assert.equal(after[i],before[i],`${option.id} alpha`);
  }
 }
 assert.deepEqual(await fs.readFile(path.join(store.root,'media',`${source.id}.png`)),await sharp(bytes).png().toBuffer());
 const person={...source,kind:'source',archive:{category:'people'}};
 await assert.rejects(transformImage(store,person,{type:'water-flow',strength:.3}),/not permitted/);
});
test('near-whole photos are rejected, while an actual irregular cropped subject passes',async t=>{
 const store=await fixture(t),a=await store.addImage(await sharp({create:{width:120,height:80,channels:3,background:'#78845b'}}).png().toBuffer(),'photo.png');
 const file=path.join(store.root,'media',`${a.id}.png`);
 await assert.rejects(inspectCut(file,a),/almost whole rectangular photograph/);
 const mask=Buffer.from('<svg width="120" height="80"><ellipse cx="60" cy="40" rx="50" ry="30" fill="white"/></svg>');
 const cutFile=path.join(store.root,'cut.png');await sharp(file).ensureAlpha().composite([{input:mask,blend:'dest-in'}]).png().toFile(cutFile);
 const audit=await inspectCut(cutFile,a);assert.ok(audit.retainedFraction<.6);assert.ok(audit.transparentFraction>.3);
});
test('treatment selection supports all-off, rejects unknown effects, and constrains the planner schema',()=>{
 const base={prompt:'Water and collective memory',requestId:'af4bbf1a-a20a-4622-8b71-290d6b4b3997'};
 assert.deepEqual(creationInput.parse(base).enabledTransforms,DEFAULT_TRANSFORMS);
 assert.throws(()=>creationInput.parse({...base,enabledTransforms:['neon']}));
 const job=creationInput.parse({...base,enabledTransforms:[]});
 const schema=advanceFor([],job,6).shape.images.shape;
 assert.equal(schema.F01.shape.transform.shape.type.value,'none');
 const selected=advanceFor([],creationInput.parse({...base,enabledTransforms:['reflection-echo']}),6).shape.images.shape;
 assert.deepEqual(selected.F01.shape.transform.shape.type.options,['none','reflection-echo']);
});
test('restraint uses at most two treatments on a minority of generated fragments and rejects excluded effects',()=>{
 const images=Array.from({length:8},(_,i)=>({key:`F${i}`,sourceId:null,transform:{type:['water-flow','sediment-wash','contour-etch'][i%3],strength:1-i*.02,reason:'Water and soil'}}));
 const job={transformations:true,recolouring:true,enabledTransforms:['water-flow','sediment-wash','contour-etch']};
 const adjustments=restrainTreatments({images},job),treated=images.filter(i=>i.transform.type!=='none');
 assert.ok(adjustments.length);assert.equal(treated.length,3);assert.equal(new Set(treated.map(i=>i.transform.type)).size,2);
 assert.throws(()=>restrainTreatments({images:[{key:'F1',sourceId:null,transform:{type:'reflection-echo',strength:.2}}]},job),/disabled/);
});
test('a fully covered stack is detected and repaired instead of accepting a dominant top image',async t=>{
 const store=await fixture(t),materials=[];
 for(let i=0;i<4;i++){
  const a=await store.addImage(await sharp({create:{width:1600,height:1000,channels:3,background:{r:50+i*20,g:95,b:120}}}).png().toBuffer(),`field-${i}.png`,{kind:'generated',allowCrop:true});
  materials.push({asset:a,rootId:a.id});
 }
 const project={layers:materials.map((m,i)=>({id:`L${i}`,assetId:m.asset.id,visible:true,x:0,y:0,width:1600,height:1000,rotation:0,opacity:1}))};
 const measure=await coverageReader(store,materials),before=measure(project);
 assert.equal(before.coverage,1);assert.equal(before.dominantShare,1);assert.equal(before.obscuredIds.length,3);
 const after=await fillComposition(store,project,materials,4);
 assert.ok(after.dominantShare<=.581);assert.equal(after.distinctVisible,4);
 assert.ok(after.obscuredIds.length<before.obscuredIds.length);
 assert.ok(project.layers.every(l=>l.width*l.height<=1600000*COMPOSITION_LIMITS.maxLayerArea+.01));
});
