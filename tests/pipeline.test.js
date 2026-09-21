import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {CreationPipeline,compositionWarnings,normalizedBox,selectGenerationReferences} from '../server/pipeline.js';
import {normalizeObservations} from '../server/direction.js';
import {creationInput,validateAdvance} from '../server/plan.js';
import {createStore} from '../server/store.js';
import {archiveHasPeople,assemble,retrieveArchive} from '../server/compose.js';
import {coverageReader} from '../server/coverage.js';
import {creativeExcerpt} from '../server/context.js';
import {transformImage} from '../server/transforms.js';
const json=(data,annotations=[])=>({choices:[{message:{content:JSON.stringify(data),annotations}}],usage:{cost:.001}});
const region={key:'stone',label:'Stone',box:[100,100,900,900],point:[500,500],reason:'A solid form'};
const prices=async o=>({text:{vision:{bound:.04,maxTokens:4000},research:{bound:.03,maxTokens:2000},planner:{bound:.04,maxTokens:5000}},images:[{model:'bytedance-seed/seedream-4.5',provider:'seed',reserved:.048,referenceLimit:2,resolution:'2K'}],total:.15+o.generatedCount*.048});
const fakeVision={available:async()=>true,request:async r=>r.action==='health'?{ready:true}:r.action==='detect'?{detections:[],width:120,height:80}:{cuts:r.regions.map(q=>({...q,file:r.path,cropBox:[0,0,120,80],coverage:.5,detector:'VLM-directed',segmenter:'SAM test double'})),detections:[]},close(){}};
async function fixture(t,n=5){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'situated-v4-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=await createStore(dir);
 for(let i=0;i<n;i++)await store.addImage(await sharp({create:{width:120,height:80,channels:3,background:{r:40+i*8,g:70,b:130}}}).png().toBuffer(),`source-${i}.png`,{allowReference:i===0});
 const old=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='test-only';t.after(()=>{if(old)process.env.OPENROUTER_API_KEY=old;else delete process.env.OPENROUTER_API_KEY;});return store;
}
function direction(archive,job,generatedCount,referenceArchive=archive){
 return {title:'Material relations',logic:'Water interrupts ground',rationale:'Broad overlapping fields support smaller cuts',palette:'Earth',light:'Diffuse',horizon:'Refused',background:'#eeeeee',supported:['Archive surfaces'],uncertain:['Unknown locality'],rules:['Every source remains visible'],images:Array.from({length:job.count},(_,i)=>{
  const generated=i>=job.count-generatedCount,generationIndex=i-(job.count-generatedCount),role=!generated?'environment':job.requiresGeneratedEnvironment&&generationIndex===0?'environment':job.requiresGeneratedPeople&&generationIndex===(job.requiresGeneratedEnvironment?1:0)?'people':'material';
  return {key:`F${String(i+1).padStart(2,'0')}`,sourceId:generated?null:archive[i].id,label:`Material ${i}`,prompt:generated?`A photograph of a distinct broad stone surface numbered ${i} with a crisp material edge`:'',segment:role==='people'?'The complete fictional group of people':'The stone and water surface',reason:'A material relation',referenceIds:generated&&job.useReferences&&referenceArchive[0]?[referenceArchive[0].id]:[],role,boundary:role==='environment'&&generated?'field':i<2?'field':'silhouette',transform:{type:generated&&job.requiresWaterTransformation&&generationIndex===0?'water-flow':generated&&job.transformations?'misregistration':'none',strength:.5,reason:'Generated material follows the direction of water'},placement:role==='environment'&&generated?{x:.5,y:.5,width:1,rotation:0}:job.count>10&&i>=2?{x:.08+((i-2)%6)*.17,y:.16+Math.floor((i-2)/6)*.33,width:.12,rotation:0}:{x:i<2?(i===0?.15:.85):(.25+(i%2)*.45),y:i<2?.5:(i<4?.3:.7),width:i<2?.85:.23,rotation:0}};
 })};
}
function requestDouble(store,{onBody=()=>{},noCitations=false,mutatePlan=p=>p}={}){
 let plan;return async(endpoint,body)=>{
  onBody(endpoint,body);
  if(endpoint==='images')return {data:[{b64_json:(await sharp({create:{width:1600,height:1000,channels:3,background:{r:100+store.state.assets.length,g:150,b:200}}}).png().toBuffer()).toString('base64')}],usage:{cost:.04}};
  const stage=body.response_format.json_schema?.name;
  if(stage==='advance_collage_plan'){
   const data=JSON.parse(body.messages[1].content[0].text);
   assert.equal(Object.keys(data.sourceSlots).length,data.count-data.generatedCount);
   Object.entries(data.sourceSlots).forEach(([key,a],i)=>{assert.equal(key,`F${String(i+1).padStart(2,'0')}`);assert.ok(data.archive.some(item=>item.id===a.id));assert.equal(data.humanContextIds.includes(a.id),false);});
   plan=mutatePlan(direction(Object.values(data.sourceSlots),data,data.generatedCount,data.archive));plan.layerOrder=[...plan.images].sort((a,b)=>Number(!b.sourceId&&b.role==='environment')-Number(!a.sourceId&&a.role==='environment')).map(i=>i.key);return json({...plan,images:Object.fromEntries(plan.images.map(i=>[i.key,i]))});
  }
  if(stage==='transformed_image_grounding'){
   const targets=JSON.parse(body.messages[1].content[0].text).targets;
   return json({images:targets.map(t=>({id:t.id,description:'A material surface',coordinateSpace:'normalized_1000',regions:[region]}))});
  }
  if(stage==='collage_critique')return json({assessment:'Dense, visible sources',issues:[],revise:false,layout:{background:plan.background,rationale:plan.rationale,negativeSpace:'Small seams',layers:plan.images.map(i=>({assetId:i.key,name:i.label,...i.placement,opacity:1,reason:i.reason}))}});
  return json({summary:'Water follows terrain',findings:[{claim:'Flow',url:'https://example.org/water'}],uncertain:[],mustNotInfer:[]},noCitations?[]:[{type:'url_citation',url_citation:{url:'https://example.org/water'}}]);
 };
}
const input=extra=>creationInput.parse({prompt:'Water, surfaces and a gathering',requestId:randomUUID(),...extra});

test('coverage and occlusion checks warn without withholding a rendered image',()=>{
 const warnings=compositionWarnings({coverage:.982,distinctVisible:5},6);
 assert.deepEqual(warnings,['5 of 6 source images remain visibly represented in the final collage.','Canvas coverage is 98.2%; the completed image is shown with the remaining open area.']);
});

test('6–20 means distinct inputs; invalid counts and duplicate sources are rejected',()=>{
 for(const count of [0,5,21])assert.throws(()=>input({count}));
 assert.equal(input({count:20}).count,20);
 const a=Array.from({length:6},(_,i)=>({id:String(i),allowCrop:true})),j=input({}),p=direction(a,j,0);
 p.images[1].sourceId=p.images[0].sourceId;assert.throws(()=>validateAdvance(p,a,j,0),/repeated source/);
 p.images[1].sourceId='1';assert.throws(()=>validateAdvance(p,a,{...j,includeArchive:false},0),/inclusion is off/);
 p.images[0].transform.type='posterize';assert.throws(()=>validateAdvance(p,a,j,0),/transformation permission/);
 const recolourPlan=direction(a.slice(0,5),{...j,recolouring:false},1);recolourPlan.images[5].transform.type='recolour';
 assert.throws(()=>validateAdvance(recolourPlan,a.slice(0,5),{...j,recolouring:false},1),/Recolouring is switched off/);
});
test('Qwen boxes and points reject coordinates outside the requested subject',()=>{
 assert.deepEqual(normalizedBox.parse([100,200,900,800]),[.1,.2,.9,.8]);assert.throws(()=>normalizedBox.parse([900,0,100,800]));
 assert.deepEqual(normalizeObservations({images:[{id:'a',description:'Surface',coordinateSpace:'normalized_1000',regions:[region]}]},[{id:'a',width:276,height:182}])[0].regions[0].point,[.5,.5]);
 const pixel=normalizeObservations({images:[{id:'a',description:'People',coordinateSpace:'pixels',regions:[{...region,box:[0,0,276,182],point:[138,91]}]}]},[{id:'a',width:276,height:182}])[0];
 assert.deepEqual(pixel.regions[0].box,[0,0,1,1]);assert.deepEqual(pixel.regions[0].point,[.5,.5]);
 const mislabeled=normalizeObservations({images:[{id:'a',description:'Fall',coordinateSpace:'pixels',regions:[{...region,box:[450,270,547,547],point:[500,400]}]}]},[{id:'a',width:365,height:547}])[0];
 assert.deepEqual(mislabeled.regions[0].box,[.45,.27,.547,.547]);assert.equal(mislabeled.regions[0].coordinateSpaceResolved,'normalized_1000');
 const large=normalizeObservations({images:[{id:'a',description:'Plant',coordinateSpace:'pixels',regions:[{...region,box:[280,120,750,850],point:[515,485]}]}]},[{id:'a',width:2352,height:1570}])[0];
 assert.deepEqual(large.regions[0].box,[.28,.12,.75,.85]);
 assert.throws(()=>normalizeObservations({images:[{id:'a',description:'Surface',coordinateSpace:'normalized_1000',regions:[{...region,point:[999,999]}]}]},[{id:'a',width:276,height:182}]),/outside/);
});
for(const mode of ['archive','mixed','generated'])test(`${mode}: advance plan, transformed-image grounding, six visible distinct roots and full canvas`,async t=>{
 const store=await fixture(t,mode==='archive'?6:5),calls=[],segments=[];
 const pipeline=new CreationPipeline(store,{prices,vision:{...fakeVision,request:async r=>{if(r.action==='segment'){segments.push(r);assert.ok(store.state.creations[0].plan);assert.equal(r.directed,true);}return fakeVision.request(r);}},request:requestDouble(store,{onBody:(e,b)=>calls.push({e,b})})});
 const job=await pipeline.start(input({includeArchive:mode!=='generated',contextText:'Contributor account: this water connects generations.'}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.equal(job.coverage.distinctVisible,6);assert.ok(job.coverage.coverage>=.92);assert.equal(new Set(job.materials.map(m=>m.rootId)).size,6);
 assert.equal(calls.filter(c=>c.e==='images').length,mode==='generated'?6:1);
 assert.equal(calls.filter(c=>c.e==='chat/completions').length,4);
 assert.ok(calls.find(c=>c.b.response_format?.json_schema?.name==='advance_collage_plan').b.messages[1].content.some(c=>c.type==='image_url'));
 {
  assert.ok(calls.find(c=>c.e==='images').b.input_references.length);
  const transformed=job.workingImages.filter(w=>w.transform.type!=='none');assert.ok(transformed.length);
  assert.ok(transformed.every(w=>segments.some(r=>r.path.endsWith(`${w.assetId}.png`))));
  assert.ok(job.materials.filter(m=>store.state.assets.find(a=>a.id===m.assetId).kind==='generated').every(m=>store.state.assets.find(a=>a.id===store.state.assets.find(a=>a.id===m.assetId).derived.parentId).derived?.operation==='transform'));
 }
 if(mode==='generated')assert.ok(job.project.layers.every(l=>l.kind==='generated'));
 const meta=await sharp(path.join(store.root,'media',job.id+'.png')).metadata();assert.equal(meta.width,2400);assert.equal(meta.height,1500);
 assert.equal((await pipeline.start({...input({}),requestId:job.requestId})).id,job.id);
});
test('twenty originals retain nineteen archive roots plus one high-resolution transformed field',async t=>{
 const store=await fixture(t,20);const pipeline=new CreationPipeline(store,{prices,vision:fakeVision,request:requestDouble(store)});
 const job=await pipeline.start(input({count:20}));await pipeline.running;assert.equal(job.status,'complete',job.error);assert.equal(job.coverage.distinctVisible,20);assert.equal(job.requestedMaterials,1);
});
test('local person detection keeps that archive image context-only and generates the people layer',async t=>{
 const store=await fixture(t,6),humanId=store.state.assets[0].id,calls=[];
 const vision={...fakeVision,request:async r=>r.action==='detect'&&r.path.endsWith(`${humanId}.png`)?{detections:[{label:'person',confidence:.9}],width:120,height:80}:fakeVision.request(r)};
 const pipeline=new CreationPipeline(store,{prices,vision,request:requestDouble(store,{onBody:(e,b)=>calls.push({e,b})})}),job=await pipeline.start(input({count:6}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.equal(job.requestedMaterials,2);assert.ok(job.plan.images.some(i=>!i.sourceId&&i.role==='people'));
 assert.equal(job.project.layers.some(layer=>{const asset=store.state.assets.find(a=>a.id===layer.assetId);return (asset.rootId||asset.id)===humanId;}),false);
 const peopleCall=calls.find(c=>c.e==='images'&&c.b.prompt.includes('ROLE: people'));
 assert.ok(peopleCall);assert.equal(peopleCall.b.input_references.length,1);assert.match(peopleCall.b.prompt,/primary visual evidence/i);
 const peopleAsset=store.state.assets.find(a=>a.generation?.referenceIds.includes(humanId));assert.ok(peopleAsset);assert.equal(peopleAsset.generation.referenceIds[0],humanId);
});
test('a failed SAM cut still publishes a partial study and can retry only that local cut',async t=>{
 const store=await fixture(t,6);let failOne=true,failedPath='';
 const vision={...fakeVision,request:async r=>{if(r.action==='segment'&&failOne){failOne=false;failedPath=r.path;return {cuts:[],detections:[]};}return fakeVision.request(r);}};
 const pipeline=new CreationPipeline(store,{prices,vision,request:requestDouble(store)}),job=await pipeline.start(input({count:6}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.ok(job.outputUrl);assert.equal(job.failedParts.length,1);assert.equal(job.project.layers.length,5);assert.match(job.warnings.join(' '),/absent from this partial study/);
 const part=job.failedParts[0];assert.equal(job.workingImages.find(w=>w.key===part.key).assetId,path.basename(failedPath,'.png'));
 const retried=await pipeline.retryPart(job.id,part.key);
 assert.equal(retried.failedParts[0].status,'resolved');assert.equal(retried.project.layers.length,6);assert.ok(retried.outputUrl);
});
test('people references prioritize permitted human context and deduplicate planner choices',()=>{
 const environmental={id:'land',allowReference:true},humanA={id:'person-a',allowReference:true},humanB={id:'person-b',allowReference:true};
 const item={role:'people',referenceIds:['land','person-b']};
 assert.deepEqual(selectGenerationReferences(item,[environmental,humanA,humanB],[humanA,humanB],2).map(a=>a.id),['person-b','person-a']);
 assert.deepEqual(selectGenerationReferences(item,[environmental,humanA,humanB],[humanA,humanB],2,false),[]);
});
test('unaffordable configurations and premium price uncertainty make zero paid calls',async t=>{
 const store=await fixture(t);let calls=0;
 const pipeline=new CreationPipeline(store,{vision:fakeVision,prices:async()=>{throw new Error('Cannot bound the $1.00 limit');},request:async()=>{calls++;}});
 const job=await pipeline.start(input({count:20,includeArchive:false}));await pipeline.running;
 assert.equal(job.status,'failed');assert.equal(calls,0);assert.equal(job.ledger.length,0);
});
test('unverified research fails before generation; duplicate plans fail before image requests',async t=>{
 const store=await fixture(t);let imageCalls=0;
 for(const options of [{noCitations:true},{mutatePlan:p=>{p.images[1].sourceId=p.images[0].sourceId;return p;}}]){
  const pipeline=new CreationPipeline(store,{vision:fakeVision,prices,request:requestDouble(store,{...options,onBody:e=>{if(e==='images')imageCalls++;}})});
  const job=await pipeline.start(input({}));await pipeline.running;assert.equal(job.status,'failed');
 }
 assert.equal(imageCalls,0);
});
test('reference-off prevents image references but retains archive images in visual planning',async t=>{
 const store=await fixture(t);const calls=[];
 const pipeline=new CreationPipeline(store,{vision:fakeVision,prices,request:requestDouble(store,{onBody:(e,b)=>calls.push({e,b})})});
 const job=await pipeline.start(input({useReferences:false,transformations:false}));await pipeline.running;assert.equal(job.status,'complete',job.error);
 assert.equal(calls.find(c=>c.e==='images').b.input_references,undefined);
 assert.ok(calls.find(c=>c.b.response_format?.json_schema?.name==='advance_collage_plan').b.messages[1].content.filter(c=>c.type==='image_url').length===5);
});
test('alpha coverage detects holes and complete occlusion instead of counting bounding rectangles',async t=>{
 const store=await fixture(t,0),bytes=await sharp({create:{width:100,height:100,channels:4,background:'#00000000'}}).composite([{input:await sharp({create:{width:10,height:100,channels:4,background:'#ffffffff'}}).png().toBuffer(),left:45,top:0}]).png().toBuffer();
 const a=await store.addImage(bytes,'thin.png'),m=[{key:'F01',asset:a,rootId:a.id}],measure=await coverageReader(store,m);
 const p=assemble({title:'Test'},m,'test',{background:'#fff',layers:[{assetId:'F01',name:'Thin cut',x:.5,y:.5,width:1,rotation:0,opacity:1,reason:''}]});
 assert.ok(measure(p).coverage<.12);
});
test('pre-crop transformations preserve originals, enforce permissions and record ancestry',async t=>{
 const store=await fixture(t),a=store.state.assets[0],before=await fs.readFile(path.join(store.root,'media',a.id+'.png'));
 await assert.rejects(transformImage(store,a,{type:'posterize',strength:.5,reason:'Test'}),/not permitted/);
 a.allowTransform=true;const changed=await transformImage(store,a,{type:'posterize',strength:.5,reason:'Material transfer'});
 assert.equal(changed.rootId,a.id);assert.equal(changed.derived.operation,'transform');assert.notEqual(changed.hash,a.hash);assert.deepEqual(await fs.readFile(path.join(store.root,'media',a.id+'.png')),before);
 const recoloured=await transformImage(store,a,{type:'recolour',strength:.65,reason:'Relate water and soil',palette:'#173f3b #9c6b40 #d6c8a5'});
 assert.notEqual(recoloured.hash,a.hash);assert.equal(recoloured.derived.transform.type,'recolour');assert.equal(recoloured.derived.transform.effectiveStrength,.65);
 const flowed=await transformImage(store,a,{type:'water-flow',strength:.55,reason:'Let water movement shape the material'});
 assert.notEqual(flowed.hash,a.hash);assert.equal(flowed.derived.transform.type,'water-flow');
});
test('creative context excludes legal contract and private folder links',()=>{
 const text='Parties and fees\n1. Project Overview\nA situated artwork\nFolder https://drive.google.com/private\n4. Source and Reference Materials\nAccounts\n5. Fees\nPrivate financial terms';
 const excerpt=creativeExcerpt(text);assert.match(excerpt,/situated artwork/);assert.doesNotMatch(excerpt,/private|Fees|Parties|financial/i);
});
test('retrieval prefers supplied locality and excludes derived/generated assets',()=>{
 assert.deepEqual(retrieveArchive([{id:'a',kind:'source',title:'Water'},{id:'b',kind:'source',locality:'Water district'},{id:'c',kind:'generated',locality:'Water district'},{id:'d',kind:'source',derived:{}}],'Water').map(r=>r.asset.id),['b','a']);
});
test('people-bearing archive images are detected as context-only material',()=>{
 assert.equal(archiveHasPeople({title:'Gathering under a roof',caption:'People sit in a circle'}),true);
 assert.equal(archiveHasPeople({title:'Water, rock and a vertical fall',tags:'water, stone, vegetation'}),false);
});
