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
import {DEFAULT_GROUND} from '../shared/ground.js';
import {creativeExcerpt} from '../server/context.js';
import {transformImage,permittedTransforms,treatmentBudget} from '../server/transforms.js';
const json=(data,annotations=[])=>({choices:[{message:{content:JSON.stringify(data),annotations}}],usage:{cost:.001}});
const region={key:'stone',label:'Stone',box:[100,100,900,900],point:[500,500],reason:'A solid form'};
const prices=async o=>({text:{vision:{bound:.04,maxTokens:4000},research:{bound:.03,maxTokens:2000},planner:{bound:.04,maxTokens:5000}},images:[{model:'bytedance-seed/seedream-4.5',provider:'seed',reserved:.048,referenceLimit:2,resolution:'2K'}],total:.15+o.generatedCount*.048});
const fakeVision={available:async()=>true,request:async r=>{
 if(r.action==='health')return {ready:true};
 if(r.action==='detect')return {detections:[],width:120,height:80};
 const cuts=[];
 for(const q of r.regions){
  const {width,height}=await sharp(r.path).metadata(),file=path.join(r.outputDir,`cut-${q.key}.png`);
  const mask=Buffer.from(`<svg width="${width}" height="${height}"><ellipse cx="${width/2}" cy="${height/2}" rx="${width*.46}" ry="${height*.46}" fill="white"/></svg>`);
  await sharp(r.path).ensureAlpha().composite([{input:mask,blend:'dest-in'}]).png().toFile(file);
  cuts.push({...q,file,cropBox:[0,0,width,height],coverage:.66,detector:'VLM-directed',segmenter:'SAM test double'});
 }
 return {cuts,detections:[]};
},close(){}};
async function fixture(t,n=5){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'situated-v4-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));const store=await createStore(dir);
 for(let i=0;i<n;i++)await store.addImage(await sharp({create:{width:120,height:80,channels:3,background:{r:40+i*8,g:70,b:130}}}).png().toBuffer(),`source-${i}.png`,{allowReference:i===0});
 const old=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='test-only';t.after(()=>{if(old)process.env.OPENROUTER_API_KEY=old;else delete process.env.OPENROUTER_API_KEY;});return store;
}
function direction(archive,job,generatedCount,referenceArchive=archive){
 return {...(job.localResearch?{researchComposition:{sourceIds:job.localResearch.map(d=>d.id),direction:'Layer the water pathways across the soil contours, using recurrence and offset scales from the supplied research.'}}:{}),title:'Material relations',logic:'Water interrupts ground',rationale:'Broad overlapping fields support smaller cuts',palette:'Earth',light:'Diffuse',horizon:'Refused',background:'#eeeeee',supported:['Archive surfaces'],uncertain:['Unknown locality'],rules:['Every source remains visible'],images:Array.from({length:job.count},(_,i)=>{
  const generated=i>=job.count-generatedCount,generationIndex=i-(job.count-generatedCount),role=!generated?(job.humanContextIds?.includes(archive[i].id)?'people':'environment'):generationIndex<2?'environment':'material';
  return {...(job.localResearch?{researchIds:job.researchAssignments?.[`F${String(i+1).padStart(2,'0')}`]||[],researchIntent:job.researchAssignments?.[`F${String(i+1).padStart(2,'0')}`]?'The documented relationships between water and land become an interlocking mineral surface.':''}:{}),key:`F${String(i+1).padStart(2,'0')}`,sourceId:generated?null:archive[i].id,label:`Material ${i}`,prompt:generated?`A photograph of a distinct broad stone surface numbered ${i} with a crisp material edge`:'',segment:role==='people'?'The complete archive group of people':'The stone and water surface',reason:'A material relation',referenceIds:generated&&job.useReferences?(job.referenceAssignments?.[`F${String(i+1).padStart(2,'0')}`]||referenceArchive.filter(a=>a.allowReference&&!job.humanContextIds?.includes(a.id)).slice(0,1).map(a=>a.id)):[],role,boundary:role==='people'?'silhouette':role==='environment'&&generated?'field':i<2?'field':'silhouette',transform:{type:generated&&generationIndex<treatmentBudget(generatedCount).maxImages?(permittedTransforms(job)[0]||'none'):'none',strength:.5,reason:'Generated material follows the direction of water'},placement:role==='environment'&&generated?{x:generationIndex===0?.28:.74,y:.5,width:.74,rotation:0}:job.count>10&&i>=2?{x:.08+((i-2)%6)*.17,y:.16+Math.floor((i-2)/6)*.33,width:.12,rotation:0}:{x:i<2?(i===0?.15:.85):(.25+(i%2)*.45),y:i<2?.5:(i<4?.3:.7),width:i<2?.85:.23,rotation:0}};
 })};
}
function requestDouble(store,{onBody=()=>{},noCitations=false,mutatePlan=p=>p,mutateObservations=o=>o}={}){
 let plan;return async(endpoint,body)=>{
  onBody(endpoint,body);
  if(endpoint==='images')return {data:[{b64_json:(await sharp({create:{width:1600,height:1000,channels:3,background:{r:100+store.state.assets.length,g:150,b:200}}}).png().toBuffer()).toString('base64')}],usage:{cost:.04}};
  const stage=body.response_format.json_schema?.name;
  if(stage==='advance_collage_plan'){
   const data=JSON.parse(body.messages[1].content[0].text);
   assert.equal(Object.keys(data.sourceSlots).length,data.count-data.generatedCount);
   Object.entries(data.sourceSlots).forEach(([key,a],i)=>{assert.equal(key,`F${String(i+1).padStart(2,'0')}`);assert.ok(data.archive.some(item=>item.id===a.id));});
   plan=mutatePlan(direction(Object.values(data.sourceSlots),data,data.generatedCount,data.archive));plan.layerOrder=[...plan.images].sort((a,b)=>Number(!b.sourceId&&b.role==='environment')-Number(!a.sourceId&&a.role==='environment')).map(i=>i.key);return json({...plan,images:Object.fromEntries(plan.images.map(i=>[i.key,i]))});
  }
  if(stage==='transformed_image_grounding'){
   const targets=JSON.parse(body.messages[1].content[0].text).targets;
   return json(mutateObservations({images:targets.map(t=>({id:t.id,description:'A material surface',coordinateSpace:'normalized_1000',regions:[region]}))}));
  }
  if(stage==='collage_critique')return json({assessment:'Dense, visible sources',issues:[],revise:false,layout:{background:plan.background,rationale:plan.rationale,negativeSpace:'Small seams',layers:plan.images.map(i=>({assetId:i.key,name:i.label,...i.placement,opacity:1,reason:i.reason}))}});
  return json({summary:'Water follows terrain',findings:[{claim:'Flow',url:'https://example.org/water'}],uncertain:[],mustNotInfer:[]},noCitations?[]:[{type:'url_citation',url_citation:{url:'https://example.org/water'}}]);
 };
}
// These small synthetic fixtures intentionally test six components; production
// defaults are exercised separately by the ten-image regression below.
const input=extra=>creationInput.parse({prompt:'Water, surfaces and a gathering',requestId:randomUUID(),count:6,...extra});

test('coverage and occlusion checks warn without withholding a rendered image',()=>{
 const warnings=compositionWarnings({coverage:.982,distinctVisible:5},6);
 assert.deepEqual(warnings,['5 of 6 source images remain visibly represented in the final collage.','Canvas coverage is 98.2%; the completed image is shown with the remaining open area.']);
});

test('6–20 means distinct inputs; invalid counts and duplicate sources are rejected',()=>{
 for(const count of [0,5,21])assert.throws(()=>input({count}));
 assert.equal(input({count:20}).count,20);
 const a=Array.from({length:6},(_,i)=>({id:String(i),allowCrop:true,archive:{category:'people'}})),j={...input({}),humanContextIds:a.map(a=>a.id)},p=direction(a,j,0);
 p.images[1].sourceId=p.images[0].sourceId;assert.throws(()=>validateAdvance(p,a,j,0),/repeated source/);
 p.images[1].sourceId='1';assert.throws(()=>validateAdvance(p,a,{...j,includeArchive:false},0),/inclusion is off/);
 p.images[0].transform.type='posterize';assert.throws(()=>validateAdvance(p,a,j,0),/untransformed archive cutouts/);
 const recolourPlan=direction(a.slice(0,5),{...j,recolouring:false},1);recolourPlan.images[5].transform.type='recolour';
 assert.throws(()=>validateAdvance(recolourPlan,a.slice(0,5),{...j,recolouring:false},1),/disabled transformation|Recolouring is switched off/);
});
test('Qwen coordinate systems normalize and invalid segmentation geometry recovers',()=>{
 assert.deepEqual(normalizedBox.parse([100,200,900,800]),[.1,.2,.9,.8]);assert.throws(()=>normalizedBox.parse([900,0,100,800]));
 assert.deepEqual(normalizeObservations({images:[{id:'a',description:'Surface',coordinateSpace:'normalized_1000',regions:[region]}]},[{id:'a',width:276,height:182}])[0].regions[0].point,[.5,.5]);
 const pixel=normalizeObservations({images:[{id:'a',description:'People',coordinateSpace:'pixels',regions:[{...region,box:[0,0,276,182],point:[138,91]}]}]},[{id:'a',width:276,height:182}])[0];
 assert.deepEqual(pixel.regions[0].box,[0,0,1,1]);assert.deepEqual(pixel.regions[0].point,[.5,.5]);
 const mislabeled=normalizeObservations({images:[{id:'a',description:'Fall',coordinateSpace:'pixels',regions:[{...region,box:[450,270,547,547],point:[500,400]}]}]},[{id:'a',width:365,height:547}])[0];
 assert.deepEqual(mislabeled.regions[0].box,[.45,.27,.547,.547]);assert.equal(mislabeled.regions[0].coordinateSpaceResolved,'normalized_1000');
 const large=normalizeObservations({images:[{id:'a',description:'Plant',coordinateSpace:'pixels',regions:[{...region,box:[280,120,750,850],point:[515,485]}]}]},[{id:'a',width:2352,height:1570}])[0];
 assert.deepEqual(large.regions[0].box,[.28,.12,.75,.85]);
 const adjusted=normalizeObservations({images:[{id:'a',description:'Surface',coordinateSpace:'normalized_1000',regions:[{...region,point:[999,999]}]}]},[{id:'a',width:276,height:182}])[0];
 assert.deepEqual(adjusted.regions[0].point,[.5,.5]);assert.equal(adjusted.regions[0].pointAdjusted,true);assert.match(adjusted.geometryWarnings[0],/Adjusted/);
 const skipped=normalizeObservations({images:[{id:'a',description:'Surface',coordinateSpace:'normalized_1000',regions:[{...region,box:[900,900,100,100]}]}]},[{id:'a',width:276,height:182}])[0];
 assert.equal(skipped.regions.length,0);assert.match(skipped.geometryWarnings[0],/Skipped/);
});
for(const mode of ['archive','mixed','generated'])test(`${mode}: advance plan, transformed-image grounding, six cropped distinct roots and bounded layers`,async t=>{
 const store=await fixture(t,mode==='archive'?6:5),calls=[],segments=[];
 const pipeline=new CreationPipeline(store,{prices,vision:{...fakeVision,request:async r=>{if(r.action==='segment'){segments.push(r);assert.ok(store.state.creations[0].plan);assert.equal(r.directed,true);}return fakeVision.request(r);}},request:requestDouble(store,{onBody:(e,b)=>calls.push({e,b})})});
 const job=await pipeline.start(input({includeArchive:mode!=='generated',contextText:'Contributor account: this water connects generations.'}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.equal(job.project.background,DEFAULT_GROUND);assert.equal(job.plan.background,DEFAULT_GROUND);assert.equal(job.finalLayout.background,DEFAULT_GROUND);assert.equal(job.coverage.distinctVisible,6);assert.ok(job.project.layers.every(l=>l.width*l.height<=1600000*.580001));assert.equal(new Set(job.materials.map(m=>m.rootId)).size,6);
 assert.equal(calls.filter(c=>c.e==='images').length,6);
 assert.equal(calls.filter(c=>c.e==='chat/completions').length,4);
 assert.ok(calls.find(c=>c.b.response_format?.json_schema?.name==='advance_collage_plan').b.messages[1].content.some(c=>c.type==='image_url'));
 {
  assert.ok(calls.find(c=>c.e==='images').b.input_references.length);
  const transformed=job.workingImages.filter(w=>w.transform.type!=='none');assert.ok(transformed.length);
  assert.ok(transformed.every(w=>segments.some(r=>r.path.endsWith(`${w.assetId}.png`))));
  assert.ok(transformed.every(w=>job.materials.some(m=>store.state.assets.find(a=>a.id===m.assetId).derived?.parentId===w.assetId)));
 }
 if(mode==='generated')assert.ok(job.project.layers.every(l=>l.kind==='generated'));
 const meta=await sharp(path.join(store.root,'media',job.id+'.png')).metadata();assert.equal(meta.width,2400);assert.equal(meta.height,1500);
 assert.equal((await pipeline.start({...input({}),requestId:job.requestId})).id,job.id);
});
test('non-people archive photographs are reference-only even when crop permission is enabled',async t=>{
 const store=await fixture(t,8);const pipeline=new CreationPipeline(store,{prices,vision:fakeVision,request:requestDouble(store)});
 const job=await pipeline.start(input({count:6}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.equal(job.requestedMaterials,6);assert.ok(job.plan.images.every(i=>i.sourceId===null));
});
test('local person detection assigns direct archive cutouts and never generates people',async t=>{
 const store=await fixture(t,6),humanId=store.state.assets[0].id,calls=[];
 const vision={...fakeVision,request:async r=>r.action==='detect'&&r.path.endsWith(`${humanId}.png`)?{detections:[{label:'person',confidence:.9}],width:120,height:80}:fakeVision.request(r)};
 const pipeline=new CreationPipeline(store,{prices,vision,request:requestDouble(store,{onBody:(e,b)=>calls.push({e,b})})}),job=await pipeline.start(input({count:6}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.equal(job.requestedMaterials,5);
 assert.ok(job.plan.images.some(i=>i.sourceId===humanId&&i.role==='people'));
 assert.ok(job.materials.some(m=>m.rootId===humanId));
 assert.equal(job.plan.images.some(i=>!i.sourceId&&i.role==='people'),false);
 assert.ok(calls.filter(c=>c.e==='images').every(c=>/exclude all people/.test(c.b.prompt)));
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
test('a local segmentation timeout retries once, then saves only that part for a later retry',async t=>{
 const store=await fixture(t,6);let failedPath='',allowRetry=false,fallbackCalls=0;
 const vision={...fakeVision,request:async r=>{
  if(r.action==='segment'&&!allowRetry){failedPath||=r.path;if(r.path===failedPath){if(r.samImageSize===640)fallbackCalls++;throw new Error('Local segmentation timed out.');}}
  return fakeVision.request(r);
 }};
 const pipeline=new CreationPipeline(store,{prices,vision,request:requestDouble(store)}),job=await pipeline.start(input({count:6}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.equal(fallbackCalls,1);assert.equal(job.failedParts.length,1);assert.equal(job.project.layers.length,5);assert.match(job.failedParts[0].error,/timed out/);
 allowRetry=true;const retried=await pipeline.retryPart(job.id,job.failedParts[0].key);
 assert.equal(retried.failedParts[0].status,'resolved');assert.equal(retried.project.layers.length,6);
});
test('a study with no successful local cuts remains resumable without paid calls',async t=>{
 const store=await fixture(t,6);let allowRetry=false;
 const vision={...fakeVision,request:async r=>r.action==='segment'&&!allowRetry?Promise.reject(new Error('Local segmentation timed out.')):fakeVision.request(r)};
 const pipeline=new CreationPipeline(store,{prices,vision,request:requestDouble(store)}),job=await pipeline.start(input({count:6}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.equal(job.project,undefined);assert.equal(job.failedParts.length,6);assert.match(job.stage,/Waiting for local retries/);
 const paidCalls=job.ledger.length;allowRetry=true;const retried=await pipeline.retryPart(job.id,job.failedParts[0].key);
 assert.ok(retried.project);assert.equal(retried.project.layers.length,1);assert.equal(retried.ledger.length,paidCalls);assert.equal(retried.failedParts[0].status,'resolved');
});
test('out-of-region segmentation points are adjusted without aborting the study',async t=>{
 const store=await fixture(t,6);
 const mutateObservations=o=>({...o,images:o.images.map(image=>({...image,regions:image.regions.map(r=>({...r,point:[999,999]}))}))});
 const pipeline=new CreationPipeline(store,{prices,vision:fakeVision,request:requestDouble(store,{mutateObservations})});
 const job=await pipeline.start(input({count:6}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.ok(job.observations.every(o=>o.regions[0].pointAdjusted));assert.ok(job.warnings.some(w=>/Adjusted the segmentation point/.test(w)));
});
test('generation references exclude people and composition images even when reference permission is enabled',()=>{
 const assets=[{id:'land',allowReference:true},{id:'human',allowReference:true},{id:'collage',allowReference:true,archive:{category:'composition'}}];
 assert.deepEqual(selectGenerationReferences({role:'environment',referenceIds:['human','collage','land','land']},assets,[assets[1]],2).map(a=>a.id),['land']);
 assert.throws(()=>selectGenerationReferences({role:'people',referenceIds:['human']},assets,[assets[1]],2),/never generated/);
});
test('archive people can be cut without generation-reference permission',async t=>{
 const store=await fixture(t,6),humanId=store.state.assets[0].id;store.state.assets.forEach(a=>{a.allowReference=false;});
 const vision={...fakeVision,request:async r=>r.action==='detect'&&r.path.endsWith(`${humanId}.png`)?{detections:[{label:'person',confidence:.9}],width:120,height:80}:fakeVision.request(r)};
 const pipeline=new CreationPipeline(store,{vision,prices,request:requestDouble(store)}),job=await pipeline.start(input({count:6}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.ok(job.materials.some(m=>m.rootId===humanId));
});
test('people can be excluded even when the archive contains people',async t=>{
 const store=await fixture(t,6),humanId=store.state.assets[0].id;store.state.assets.forEach(a=>{a.allowReference=false;});const calls=[];
 const vision={...fakeVision,request:async r=>r.action==='detect'&&r.path.endsWith(`${humanId}.png`)?{detections:[{label:'person',confidence:.9}],width:120,height:80}:fakeVision.request(r)};
 const pipeline=new CreationPipeline(store,{prices,vision,request:requestDouble(store,{onBody:(endpoint,body)=>calls.push({endpoint,body})})}),job=await pipeline.start(input({count:6,includePeople:false,useReferences:false}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.equal(job.requiresGeneratedPeople,false);assert.equal(job.plan.images.some(i=>i.role==='people'),false);
 assert.equal(calls.filter(c=>c.endpoint==='images').some(c=>c.body.prompt.startsWith('DOCUMENTARY PHOTOGRAPHIC SOURCE IMAGE')),false);
});
test('unaffordable configurations and premium price uncertainty make zero paid calls',async t=>{
 const store=await fixture(t);let calls=0;
 const pipeline=new CreationPipeline(store,{vision:fakeVision,prices:async()=>{throw new Error('Cannot bound the $1.00 limit');},request:async()=>{calls++;}});
 const job=await pipeline.start(input({count:20,includeArchive:false}));await pipeline.running;
 assert.equal(job.status,'failed');assert.equal(calls,0);assert.equal(job.ledger.length,0);
});
test('unverified research fails before generation; duplicate plans fail before image requests',async t=>{
 const store=await fixture(t);let imageCalls=0;
 for(const options of [{noCitations:true},{mutatePlan:p=>{p.images[1].key=p.images[0].key;return p;}}]){
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
 assert.notEqual(recoloured.hash,a.hash);assert.equal(recoloured.derived.transform.type,'recolour');assert.equal(recoloured.derived.transform.effectiveStrength,.5);
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
test('people-bearing archive images are recognized from metadata',()=>{
 assert.equal(archiveHasPeople({title:'Gathering under a roof',caption:'People sit in a circle'}),true);
 assert.equal(archiveHasPeople({title:'Water, rock and a vertical fall',tags:'water, stone, vegetation'}),false);
 assert.equal(archiveHasPeople({caption:'A waterfall plunges between sheer rock faces'}),false);
});

async function officialFixture(t){
 const store=await fixture(t,28);
 store.state.officialArchive={directory:'test archive'};
 store.state.assets.forEach((a,i)=>{
  const category=i<8?'people':i<16?'general':i<24?'water':i<27?'composition':null;
  if(category)a.archive={active:true,category,sacred:category==='water',paths:[`${category}/${i}.png`]};
  a.allowCrop=category==='people';a.allowReference=['general','water'].includes(category);
 });
 return store;
}
for(const count of [6,20])test(`official archive: ${count} components use random category references and original people pixels`,async t=>{
 const store=await officialFixture(t),calls=[],segments=[];
 const pipeline=new CreationPipeline(store,{prices,vision:{...fakeVision,request:async r=>{if(r.action==='segment')segments.push(r);return fakeVision.request(r);}},request:requestDouble(store,{onBody:(endpoint,body)=>calls.push({endpoint,body})})});
 const job=await pipeline.start(input({count}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);
 assert.equal(job.archiveSelection.people.length,count===6?4:8);
 assert.equal(job.archiveSelection.general.length,count===6?2:7);
 assert.equal(job.archiveSelection.water.length,count===6?2:7);
 assert.equal(job.archiveSelection.composition.length,1);
 assert.equal(new Set(job.materials.map(m=>m.rootId)).size,count);
 assert.deepEqual(job.plan.images.filter(i=>i.sourceId).map(i=>i.sourceId),job.archiveSelection.people);
 assert.ok(job.plan.images.filter(i=>i.sourceId).every(i=>i.role==='people'&&i.transform.type==='none'));
 assert.ok(segments.slice(0,job.archiveSelection.people.length).every(r=>r.regions.every(region=>/person|people/.test(region.label))));
 const generations=store.state.assets.filter(a=>a.generation&&!a.derived);
 const used=new Set(generations.flatMap(a=>a.generation.referenceIds));
 assert.deepEqual([...used].sort(),[...job.archiveSelection.general,...job.archiveSelection.water].sort());
 assert.ok(generations.every(a=>a.generation.referenceIds.length===2&&!a.generation.referenceIds.includes(job.compositionReferenceId)));
 assert.ok(calls.filter(c=>c.endpoint==='images').every(c=>c.body.input_references.length===2&&/exclude all people/.test(c.body.prompt)));
 const planner=calls.find(c=>c.body.response_format?.json_schema?.name==='advance_collage_plan');
 assert.ok(planner.body.messages[1].content.some(c=>c.type==='text'&&c.text.includes('COMPOSITION REFERENCE ONLY')));
 const saved=await createStore(store.root);assert.deepEqual(saved.state.creations[0].archiveSelection,job.archiveSelection);
});
test('official archive rejects missing categories and incompatible options before any paid call',async t=>{
 const store=await officialFixture(t);let calls=0,priceChecks=0;
 const pipeline=new CreationPipeline(store,{vision:fakeVision,prices:async o=>{priceChecks++;return prices(o);},request:async()=>{calls++;}});
 for(const options of [{ids:store.state.assets.filter(a=>a.archive?.category!=='water').map(a=>a.id)},{useReferences:false},{includeArchive:false}]){
  const job=await pipeline.start(input(options));await pipeline.running;
  assert.equal(job.status,'failed');assert.match(job.error,/No paid calls/);
 }
 assert.equal(calls,0);assert.equal(priceChecks,0);
});
test('official archive checks provider reference support before research',async t=>{
 const store=await officialFixture(t);let calls=0;
 const pipeline=new CreationPipeline(store,{vision:fakeVision,prices:async o=>({...await prices(o),images:[{referenceLimit:1}]}),request:async()=>{calls++;}});
 const job=await pipeline.start(input({}));await pipeline.running;
 assert.equal(job.status,'failed');assert.match(job.error,/two safely priced image references/);assert.equal(calls,0);
});
test('planner cannot substitute generated people or change official reference pairs',async t=>{
 const store=await officialFixture(t);let images=0;
 for(const mutatePlan of [p=>{p.images.at(-1).role='people';return p;},p=>{p.images.at(-1).referenceIds=[p.images[0].sourceId];return p;}]){
  const pipeline=new CreationPipeline(store,{vision:fakeVision,prices,request:requestDouble(store,{mutatePlan,onBody:e=>{if(e==='images')images++;}})});
  const job=await pipeline.start(input({}));await pipeline.running;assert.equal(job.status,'failed');
 }
 assert.equal(images,0);
});

for(const enabledTransforms of [[],['reflection-echo']])test(`official pipeline honors the exact enabled treatment list: ${enabledTransforms.join(',')||'all off'}`,async t=>{
 const store=await officialFixture(t);
 const pipeline=new CreationPipeline(store,{vision:fakeVision,prices,request:requestDouble(store)});
 const job=await pipeline.start(input({enabledTransforms}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);
 assert.ok(job.plan.images.every(i=>i.transform.type==='none'||enabledTransforms.includes(i.transform.type)));
 assert.ok(job.workingImages.every(i=>i.transform.type==='none'||enabledTransforms.includes(i.transform.type)));
 assert.ok(job.plan.images.filter(i=>i.transform.type!=='none').length<=1);
 assert.equal(job.plan.images.filter(i=>!i.sourceId&&i.role==='environment').length,2);
});
test('a segmenter returning whole photographs cannot paste them into an automatic collage',async t=>{
 const store=await officialFixture(t);
 const vision={...fakeVision,request:async r=>r.action==='segment'?{cuts:r.regions.map(q=>({...q,file:r.path,coverage:.4,segmenter:'misleading metadata'})),detections:[]}:fakeVision.request(r)};
 const pipeline=new CreationPipeline(store,{vision,prices,request:requestDouble(store)});
 const job=await pipeline.start(input({}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.equal(job.project,undefined);assert.equal(job.failedParts.length,6);
 assert.ok(job.failedParts.every(p=>/almost whole rectangular/.test(p.error)));
});

for(const researchCount of [2,10])test(`research ${researchCount}: passages reach two image calls, composition review and saved provenance`,async t=>{
 const store=await fixture(t),calls=[];
 const pipeline=new CreationPipeline(store,{prices,vision:fakeVision,request:requestDouble(store,{onBody:(endpoint,body)=>calls.push({endpoint,body})})});
 const job=await pipeline.start(input({includeArchive:false,includePeople:false,researchCount}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.equal(job.researchDocuments.length,researchCount);
 for(const {endpoint,body} of calls){
  const direction=endpoint==='images'?body.prompt:body.messages[0].content;
  assert.match(direction,/ARCHIVE IMAGE RULES/);assert.match(direction,/Never generate people from scratch/);
  assert.match(direction,/exactly one image from collages-style-guide/);assert.match(direction,/only enabled treatments/);
 }
 const ids=job.researchDocuments.map(d=>d.id);assert.deepEqual(job.plan.researchComposition.sourceIds,ids);
 const researchParts=job.plan.images.filter(i=>job.researchAssignments[i.key]);assert.equal(researchParts.length,2);
 for(const part of researchParts){
  const asset=store.state.assets.find(a=>!a.derived&&a.generation?.researchIntent===part.researchIntent&&JSON.stringify(a.generation.researchIds)===JSON.stringify(part.researchIds));
  assert.ok(asset);assert.equal(asset.generation.localResearch.length,part.researchIds.length);
  const sent=calls.find(c=>c.endpoint==='images'&&c.body.prompt===asset.generation.prompt);assert.ok(sent);
  for(const id of part.researchIds){const doc=job.researchDocuments.find(d=>d.id===id);assert.ok(sent.body.prompt.includes(doc.passages[0].excerpt.replaceAll('\n','\\n'))||sent.body.prompt.includes(doc.passages[0].excerpt));}
 }
 const review=calls.find(c=>c.body.response_format?.json_schema?.name==='collage_critique');
 const payload=JSON.parse(review.body.messages[1].content[0].text);assert.deepEqual(payload.localResearch.map(d=>d.id),ids);assert.deepEqual(payload.researchComposition,job.plan.researchComposition);
 assert.ok(job.researchCoverage);assert.equal(job.researchCoverage.required,2);
});

test('insufficient research fails before any paid calls',async t=>{
 const store=await fixture(t);let calls=0;
 const pipeline=new CreationPipeline(store,{prices,vision:fakeVision,research:async()=>[],request:async()=>{calls++;throw new Error('Must not call');}});
 const job=await pipeline.start(input());await pipeline.running;
 assert.equal(job.status,'failed');assert.match(job.error,/distinct readable research/);assert.equal(calls,0);assert.equal(job.ledger.length,0);
});

test('planner dropping required research attribution stops before image generation',async t=>{
 const store=await fixture(t);let images=0;
 const pipeline=new CreationPipeline(store,{prices,vision:fakeVision,request:requestDouble(store,{onBody:e=>{if(e==='images')images++;},mutatePlan:plan=>{plan.images.find(i=>i.researchIds?.length).researchIds=[];return plan;}})});
 const job=await pipeline.start(input());await pipeline.running;
 assert.equal(job.status,'failed');assert.equal(images,0);
});

test('research upstream rate limit switches providers and the same study continues to completion',async t=>{
 const {RouterError}=await import('../server/ai.js');
 const store=await fixture(t),seen=[];
 const base=requestDouble(store);
 const withAlternatives=async o=>{const p=await prices(o);p.text.research={...p.text.research,bound:.06,candidates:[{provider:'dekallm',bound:.03,maxPrice:{prompt:.1,completion:.4},uptime:100},{provider:'nebius/fp8',bound:.03,maxPrice:{prompt:.2,completion:.5},uptime:99}]};p.total+=.03;return p;};
 const pipeline=new CreationPipeline(store,{prices:withAlternatives,vision:fakeVision,request:async(endpoint,body)=>{
  if(endpoint==='chat/completions'&&!body.response_format.json_schema){seen.push(body.provider.only[0]);if(seen.length===1)throw new RouterError('DekaLLM temporarily rate-limited upstream',{code:429,status:429,provider:'DekaLLM'});}
  return base(endpoint,body);
 }});
 const job=await pipeline.start(input());await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.deepEqual(seen,['dekallm','nebius/fp8']);assert.equal(job.providerAttempts.length,2);
 assert.equal(job.ledger[0].status,'uncertain');assert.ok(job.ledger.reduce((n,r)=>n+r.reserved,0)<=1);
 assert.ok(job.project.layers.length);assert.ok(job.warnings.some(w=>w.includes('continued with nebius/fp8')));
});

test('ten-image collage plans with all thirteen archive references while bypassing Venice',async t=>{
 const store=await officialFixture(t),calls=[];let checkedCounts;
 const imageAwarePrices=async options=>{
  checkedCounts=options.imageCounts;
  const p=await prices(options);
  p.text.planner={...p.text.planner,bound:.08,candidates:[{provider:'venice/fp8',bound:.04,maxPrice:{prompt:.3,completion:2},uptime:100},{provider:'deepinfra/fp8',bound:.04,maxPrice:{prompt:.3,completion:2},uptime:99}]};
  p.total+=.08;return p;
 };
 const pipeline=new CreationPipeline(store,{prices:imageAwarePrices,vision:fakeVision,request:requestDouble(store,{onBody:(endpoint,body)=>calls.push({endpoint,body})})});
 const job=await pipeline.start(input({count:undefined}));await pipeline.running;
 assert.equal(job.count,10);
 assert.equal(job.status,'complete',job.error);
 assert.deepEqual(checkedCounts,{research:0,planner:13,vision:10});
 const planning=calls.find(c=>c.body.response_format?.json_schema?.name==='advance_collage_plan').body;
 assert.deepEqual(planning.provider.only,['deepinfra/fp8']);assert.equal(planning.messages[1].content.filter(p=>p.type==='image_url').length,13);
 assert.equal(calls.filter(c=>c.endpoint==='images').length,6);assert.equal(job.plan.images.length,10);
 assert.equal(job.ledger.filter(r=>r.label.startsWith('Advance collage plan')).length,1);
 assert.ok(job.ledger.reduce((sum,r)=>sum+r.reserved,0)<=1);
});
