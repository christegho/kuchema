import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import {createStore} from '../server/store.js';
import {inspectCut} from '../server/crops.js';
import {TRANSFORM_OPTIONS,DEFAULT_TRANSFORMS,transformImage,treatedImage,treatedCut,restrainTreatments} from '../server/transforms.js';
import {creationInput,advanceFor,advanceSchema,repairPlan} from '../server/plan.js';
import {assignTargets} from '../server/direction.js';
import {detailAssignments} from '../server/fragments.js';
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
 // Generated slots must carry a visible enabled treatment, never none or a token strength.
 assert.deepEqual(selected.F01.shape.transform.shape.type.options,['reflection-echo']);
 assert.equal(selected.F01.shape.transform.safeParse({type:'reflection-echo',strength:.3,reason:'Too faint'}).success,false);
 assert.equal(selected.F01.shape.transform.safeParse({type:'none',strength:.1,reason:'Untreated'}).success,false);
});
test('every generated fragment keeps a treatment; a fourth kind folds into the strongest chosen kind',()=>{
 const job={transformations:true,recolouring:true,enabledTransforms:['water-flow','sediment-wash','contour-etch','print-grain']};
 const three=Array.from({length:8},(_,i)=>({key:`F${i}`,sourceId:null,transform:{type:['water-flow','sediment-wash','contour-etch'][i%3],strength:1-i*.02,reason:'Water and soil'}}));
 assert.deepEqual(restrainTreatments({images:three},job),[]);assert.ok(three.every(i=>i.transform.type!=='none'));
 const four=Array.from({length:8},(_,i)=>({key:`F${i}`,sourceId:null,transform:{type:job.enabledTransforms[i%4],strength:1-i*.02,reason:'Water and soil'}}));
 const adjustments=restrainTreatments({images:four},job);
 assert.equal(adjustments.length,2);assert.ok(four.every(i=>i.transform.type!=='none'));
 assert.equal(new Set(four.map(i=>i.transform.type)).size,3);assert.ok(four.filter(i=>adjustments.some(a=>a.key===i.key)).every(i=>i.transform.type==='water-flow'));
 assert.throws(()=>restrainTreatments({images:[{key:'F1',sourceId:'person',transform:{type:'water-flow',strength:.7,reason:''}}]},job),/archive person/);
 assert.throws(()=>restrainTreatments({images:[{key:'F1',sourceId:null,transform:{type:'posterize',strength:.7,reason:''}}]},job),/disabled/);
});
test('every treatment visibly changes textured material at a planned strength',async t=>{
 const W=240,H=160,data=Buffer.alloc(W*H*4);
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=(y*W+x)*4,check=((x>>3)+(y>>3))%2;data[i]=check?190:50+x%60;data[i+1]=check?150:80+y%50;data[i+2]=check?70:120;data[i+3]=255;}
 const store=await fixture(t),bytes=await sharp(data,{raw:{width:W,height:H,channels:4}}).png().toBuffer(),source=await store.addImage(bytes,'texture.png',{kind:'generated',allowTransform:true});
 const before=await sharp(bytes).removeAlpha().raw().toBuffer();
 for(const option of TRANSFORM_OPTIONS){
  const {image}=await treatedImage(store,source,{type:option.id,strength:.6,palette:'#183f3b #68764a #9c6b40 #d6c8a5'}),after=await image.removeAlpha().raw().toBuffer();
  let difference=0;for(let i=0;i<after.length;i++)difference+=Math.abs(after[i]-before[i]);
  // Mean absolute change per channel; the earlier restrained settings stayed below 2 for six treatments.
  assert.ok(difference/after.length>=3.5,`${option.id}: ${(difference/after.length).toFixed(1)}`);
 }
});
test('segment, treat, crop: a treated cut keeps the SAM alpha and matches the treated full image',async t=>{
 const store=await fixture(t),bytes=await pattern(),source=await store.addImage(bytes,'texture.png',{kind:'generated',allowTransform:true});
 const mask=Buffer.from('<svg width="120" height="80"><ellipse cx="70" cy="45" rx="30" ry="20" fill="white"/></svg>'),cropBox=[40,25,100,65];
 const file=path.join(store.root,'cut.png');await sharp(await sharp(path.join(store.root,'media',`${source.id}.png`)).ensureAlpha().composite([{input:mask,blend:'dest-in'}]).png().toBuffer()).extract({left:40,top:25,width:60,height:40}).png().toFile(file);
 const cut={file,cropBox},transform={type:'sediment-wash',strength:.8,reason:'Soil carried by water',palette:'#183f3b #9c6b40'};
 const treated=await treatedCut(store,source,cut,transform);
 assert.equal(treated.transform.type,'sediment-wash');assert.equal(treated.transform.effectiveStrength,.8);assert.equal(treated.transform.simulated,true);
 const [raw,result]=await Promise.all([sharp(file).raw().toBuffer(),sharp(treated.bytes).raw().toBuffer()]);
 const expected=await (await treatedImage(store,source,transform)).image.extract({left:40,top:25,width:60,height:40}).removeAlpha().raw().toBuffer();
 for(let i=0,j=0;i<result.length;i+=4,j+=3){assert.equal(result[i+3],raw[i+3]);for(let c=0;c<3;c++)assert.equal(result[i+c],expected[j+c]);}
 assert.deepEqual(await treatedCut(store,source,cut,{type:'none',strength:.1}),{bytes:await fs.readFile(file),transform:null});
 await assert.rejects(treatedCut(store,source,{file,cropBox:[0,0,60,41]},transform),/crop box/);
 await assert.rejects(treatedCut(store,{...source,kind:'source',archive:{category:'people'}},cut,transform),/not permitted/);
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

test('grounding regions map to fragment keys: exact keys first, then the remaining targets in order',()=>{
 const targets=[{id:'a',key:'F04'},{id:'a',key:'D01'},{id:'a',key:'D04'},{id:'b',key:'F05'}];
 const [a,b]=assignTargets([{id:'a',regions:[{key:'x'},{key:'D04'},{key:'y'},{key:'z'}]},{id:'b',regions:[{key:'F05'}]}],targets);
 assert.deepEqual(a.regions.map(r=>r.targetKey),['F04','D04','D01']);assert.deepEqual(b.regions.map(r=>r.targetKey),['F05']);
});

test('coverage is kept per fragment while every source image counts once',async t=>{
 const store=await fixture(t),bytes=await sharp({create:{width:200,height:120,channels:4,background:{r:90,g:120,b:80,alpha:1}}}).png().toBuffer();
 const big=await store.addImage(bytes,'big.png',{kind:'generated',allowCrop:true}),small=await store.addImage(await sharp(bytes).resize(60,36).png().toBuffer(),'small.png',{kind:'generated',allowCrop:true,derived:{parentId:'root'}});
 const materials=[{key:'F04',rootId:'root',asset:big},{key:'D01',rootId:'root',asset:small}];
 const layer=(assetId,x,width,height)=>({id:assetId,assetId,x,y:100,width,height,rotation:0,opacity:1,visible:true});
 const measure=await coverageReader(store,materials),m=measure({layers:[layer(big.id,100,800,480),layer(small.id,1200,90,54)]});
 assert.equal(m.keyedBy,'fragment');assert.deepEqual(Object.keys(m.visible).sort(),['D01','F04']);assert.equal(m.distinctVisible,1);
 // A small, fully visible detail is not reported as obscured just for being small.
 assert.ok(m.visible.D01<COMPOSITION_LIMITS.minVisible);assert.equal(m.obscuredIds.includes('D01'),false);
 assert.ok(measure({layers:[layer(small.id,150,90,54),layer(big.id,100,800,480)]}).obscuredIds.includes('D01'));
});

test('plan schema: detail slots tie to generated images, tiers are required, torn edges follow the option',()=>{
 const base={prompt:'Water and collective memory',requestId:'af4bbf1a-a20a-4622-8b71-290d6b4b3997'};
 const archive=[{id:'p1'},{id:'p2'},{id:'p3'}],withEdges={...creationInput.parse(base),detailAssignments:detailAssignments(6,3)};
 const schema=advanceFor(archive,withEdges,3).shape;
 assert.deepEqual(Object.values(withEdges.detailAssignments),['F04','F05','F06','F04','F05','F06']);
 assert.deepEqual(Object.keys(schema.details.shape),['D01','D02','D03','D04','D05','D06']);
 assert.equal(schema.details.shape.D01.shape.sourceKey.value,'F04');
 assert.deepEqual(schema.images.shape.F04.shape.edge.options,['clean','torn']);assert.equal(schema.images.shape.F01.shape.edge.value,'clean');
 assert.deepEqual(schema.images.shape.F01.shape.tier.options,['dominant','medium','small']);
 const plain=advanceFor(archive,{...creationInput.parse({...base,tornEdges:false}),detailAssignments:detailAssignments(6,3)},3).shape;
 assert.equal(plain.images.shape.F04.shape.edge.value,'clean');assert.equal(plain.details.shape.D01.shape.edge.value,'clean');
 assert.equal(advanceFor(archive,creationInput.parse(base),3).shape.details.shape,undefined); // no detail slots without assignments
});

test('a paid plan is repaired: out-of-range numbers clamp, invalid details are skipped, layer order completes',()=>{
 const job={...creationInput.parse({prompt:'Water and collective memory',requestId:'af4bbf1a-a20a-4622-8b71-290d6b4b3997'}),detailAssignments:detailAssignments(6,3)};
 const schema=advanceFor([{id:'p1'},{id:'p2'},{id:'p3'}],job,3);
 const detail=(key,sourceKey,extra={})=>({key,sourceKey,label:'Detail',segment:'A closer texture of the stone',boundary:'silhouette',tier:'small',edge:'clean',placement:{x:.5,y:.5,width:.12,rotation:0},reason:'An echo',...extra});
 const raw={images:{F01:{placement:{x:1.2,y:.5,width:.05,rotation:50}},F04:{transform:{type:'water-flow',strength:.3},placement:{x:.5,y:.5,width:.5,rotation:0}}},
  details:{D01:detail('D01','F04',{placement:{x:.5,y:.5,width:.02,rotation:0}}),D02:detail('D02','F05',{segment:''}),D03:detail('D03','F04'),D09:detail('D09','F04')},layerOrder:['D01','F04','F04','unknown']};
 const {raw:fixed,notes,skipped}=repairPlan(raw,schema);
 assert.deepEqual(fixed.images.F01.placement,{x:1,y:.5,width:.1,rotation:35});assert.equal(fixed.images.F04.transform.strength,.5);
 // A detail that is merely too small is kept at the smallest planned width.
 assert.equal(fixed.details.D01.placement.width,.06);assert.deepEqual(Object.keys(fixed.details),['D01']);
 // Missing subject, wrong source image, and a slot that was never planned are skipped.
 assert.deepEqual(skipped.map(s=>s.key),['D02','D03','D09']);assert.match(skipped[0].reason,/segment/);assert.match(skipped[2].reason,/not a planned detail slot/);
 assert.deepEqual(fixed.layerOrder,['D01','F04','F01']);assert.ok(notes.some(n=>/layerOrder completed/.test(n)));assert.equal(notes.filter(n=>/→/.test(n)).length,5);
 // Every width the planner may give is accepted by the saved-plan schema too.
 assert.equal(advanceSchema.shape.details.unwrap().element.shape.placement.safeParse({x:.5,y:.5,width:.06,rotation:0}).success,true);
});
