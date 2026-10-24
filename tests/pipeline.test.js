import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import sharp from 'sharp';
import {CreationPipeline,bounded,compositionWarnings,normalizedBox,selectGenerationReferences} from '../server/pipeline.js';
import {sizeReport,sizeRange} from '../server/scale.js';
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
  // Each region's mask follows its box, so several cuts from one image are distinct.
  const {width,height}=await sharp(r.path).metadata(),file=path.join(r.outputDir,`cut-${q.key}.png`),[l,t,rt,b]=q.box;
  const mask=Buffer.from(`<svg width="${width}" height="${height}"><ellipse cx="${(l+rt)/2*width}" cy="${(t+b)/2*height}" rx="${(rt-l)/2*width*.92}" ry="${(b-t)/2*height*.92}" fill="white"/></svg>`);
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
 return {...(job.localResearch?{researchComposition:{sourceIds:job.localResearch.map(d=>d.id),direction:'Layer the water pathways across the soil contours, using recurrence and offset scales from the supplied research.',relationships:Object.fromEntries(job.localResearch.map(d=>[d.id,'Broad environmental fields sit low while smaller cuts recur upward, as the passage describes water moving between levels.']))}}:{}),title:'Material relations',logic:'Water interrupts ground',rationale:'Broad overlapping fields support smaller cuts',palette:'Earth',light:'Diffuse',horizon:'Refused',background:'#eeeeee',supported:['Archive surfaces'],uncertain:['Unknown locality'],rules:['Every source remains visible'],images:Array.from({length:job.count},(_,i)=>{
  const generated=i>=job.count-generatedCount,generationIndex=i-(job.count-generatedCount),role=!generated?(job.humanContextIds?.includes(archive[i].id)?'people':'environment'):generationIndex<2?'environment':'material';
  return {tier:role==='environment'&&generated?'dominant':role==='people'?'medium':'small',edge:'clean',...(job.localResearch?{researchIds:job.researchAssignments?.[`F${String(i+1).padStart(2,'0')}`]||[],researchIntent:job.researchAssignments?.[`F${String(i+1).padStart(2,'0')}`]?'The documented relationships between water and land become an interlocking mineral surface.':''}:{}),key:`F${String(i+1).padStart(2,'0')}`,sourceId:generated?null:archive[i].id,label:`Material ${i}`,prompt:generated?`A photograph of a distinct broad stone surface numbered ${i} with a crisp material edge`:'',segment:role==='people'?'The complete archive group of people':'The stone and water surface',reason:'A material relation',referenceIds:generated&&job.useReferences?(job.referenceAssignments?.[`F${String(i+1).padStart(2,'0')}`]||referenceArchive.filter(a=>a.allowReference&&!job.humanContextIds?.includes(a.id)).slice(0,1).map(a=>a.id)):[],role,boundary:role==='people'?'silhouette':role==='environment'&&generated?'field':i<2?'field':'silhouette',transform:{type:generated&&generationIndex<treatmentBudget(generatedCount).maxImages?(permittedTransforms(job)[0]||'none'):'none',strength:.5,reason:'Generated material follows the direction of water'},placement:role==='environment'&&generated?{x:generationIndex===0?.28:.74,y:.5,width:.74,rotation:0}:job.count>10&&i>=2?{x:.08+((i-2)%6)*.17,y:.16+Math.floor((i-2)/6)*.33,width:.12,rotation:0}:{x:i<2?(i===0?.15:.85):(.25+(i%2)*.45),y:i<2?.5:(i<4?.3:.7),width:i<2?.85:.23,rotation:0}};
 }),details:Object.entries(job.detailAssignments||{}).map(([key,sourceKey],i)=>({key,sourceKey,label:`Detail ${key}`,segment:'A closer texture of the stone surface',boundary:'silhouette',tier:'small',edge:'clean',placement:{x:.1+(i%6)*.16,y:.85,width:.12,rotation:0},reason:'A smaller echo of the material'}))};
}
function requestDouble(store,{onBody=()=>{},noCitations=false,mutatePlan=p=>p,mutateObservations=o=>o}={}){
 let plan,images=0;return async(endpoint,body)=>{
  onBody(endpoint,body);
  // Distinct gradients: treatments must have tonal variation to act on.
  if(endpoint==='images'){const r=100+(images++%150),svg=`<svg width="1600" height="1000"><defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="rgb(${r},150,200)"/><stop offset="1" stop-color="rgb(30,70,${r})"/></linearGradient></defs><rect width="1600" height="1000" fill="url(#g)"/></svg>`;return {data:[{b64_json:(await sharp(Buffer.from(svg)).png().toBuffer()).toString('base64')}],usage:{cost:.04}};}
  const stage=body.response_format.json_schema?.name;
  if(stage==='advance_collage_plan'){
   const data=JSON.parse(body.messages[1].content[0].text);
   assert.equal(Object.keys(data.sourceSlots).length,data.count-data.generatedCount);
   Object.entries(data.sourceSlots).forEach(([key,a],i)=>{assert.equal(key,`F${String(i+1).padStart(2,'0')}`);assert.ok(data.archive.some(item=>item.id===a.id));});
   plan=mutatePlan(direction(Object.values(data.sourceSlots),data,data.generatedCount,data.archive));plan.layerOrder=[...[...plan.images].sort((a,b)=>Number(!b.sourceId&&b.role==='environment')-Number(!a.sourceId&&a.role==='environment')).map(i=>i.key),...plan.details.map(d=>d.key)];return json({...plan,images:Object.fromEntries(plan.images.map(i=>[i.key,i])),details:Object.fromEntries(plan.details.map(d=>[d.key,d]))});
  }
  if(stage==='transformed_image_grounding'){
   const targets=JSON.parse(body.messages[1].content[0].text).targets;
   // One region per fragment target; cuts from the same image take different boxes.
   const boxes=[[100,100,900,900],[150,450,650,950],[500,80,950,520]],ids=[...new Set(targets.map(t=>t.id))];
   return json(mutateObservations({images:ids.map(id=>({id,description:'A material surface',coordinateSpace:'normalized_1000',regions:targets.filter(t=>t.id===id).map((t,j)=>({...region,key:t.key,box:boxes[j],point:[(boxes[j][0]+boxes[j][2])/2,(boxes[j][1]+boxes[j][3])/2]}))}))}));
  }
  if(stage==='collage_critique')return json({assessment:'Dense, visible sources',issues:[],revise:false,layout:{background:plan.background,rationale:plan.rationale,negativeSpace:'Small seams',layers:[...plan.images,...plan.details].map(i=>({assetId:i.key,name:i.label,...i.placement,opacity:1,reason:i.reason}))}});
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
 assert.equal(job.status,'complete',job.error);assert.equal(job.project.background,DEFAULT_GROUND);assert.equal(job.plan.background,DEFAULT_GROUND);assert.equal(job.finalLayout.background,DEFAULT_GROUND);assert.equal(job.coverage.distinctVisible,6);assert.ok(job.project.layers.every(l=>l.width*l.height<=5760*1080*.580001));
 // The panorama: 5760 × 1080 on black, every fragment inside its size range unless its source is too small.
 assert.deepEqual(job.project.canvas,{width:5760,height:1080});assert.deepEqual(job.outputSize,[5760,1080]);
 const materials=job.materials.map(m=>({...m,asset:store.state.assets.find(a=>a.id===m.assetId)})),report=sizeReport(job.project,materials,job.project.canvas);assert.deepEqual(report.above,[]);
 for(const l of job.project.layers){const m=materials.find(m=>m.asset.id===l.assetId),{height:[min,max]}=sizeRange(m),upscaled=l.height>=m.asset.height*2-1e-6;assert.ok(l.height/1080<=max+1e-6&&(l.height/1080>=min-1e-6||upscaled),`${l.name} ${l.height}`);}
 // Landscapes are requested panoramic, other generated material at 3:2.
 for(const {b} of calls.filter(c=>c.e==='images'))assert.equal(b.aspect_ratio,/panoramic/.test(b.prompt)?'21:9':'3:2');assert.equal(new Set(job.materials.map(m=>m.rootId)).size,6);
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
 const meta=await sharp(path.join(store.root,'media',job.id+'.png')).metadata();assert.deepEqual([meta.width,meta.height,meta.format],[5760,1080,'png']);
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
 assert.equal(job.status,'complete',job.error);assert.ok(job.outputUrl);assert.equal(job.project.layers.length,10);assert.match(job.warnings.join(' '),/absent from this partial study/);
 // A failed image loses its primary cut and its detail cut; each is saved for its own retry.
 assert.deepEqual(job.failedParts.map(p=>[p.key,p.sourceKey]),[['F01','F01'],['D01','F01']]);
 assert.ok(job.failedParts.every(p=>p.assetId===path.basename(failedPath,'.png')));
 const part=job.failedParts[0];let retried=await pipeline.retryPart(job.id,part.key);
 assert.equal(retried.failedParts[0].status,'resolved');assert.equal(retried.project.layers.length,11);assert.ok(retried.outputUrl);
 retried=await pipeline.retryPart(job.id,'D01');assert.equal(retried.failedParts[1].status,'resolved');assert.equal(retried.project.layers.length,12);
 assert.equal(retried.materials.find(m=>m.key==='D01').sourceKey,'F01');
 // The retried cut receives the planned treatment with the plan's palette.
 const planned=job.plan.images.find(i=>i.key===part.key).transform,fragment=()=>store.state.assets.find(a=>a.id===retried.materials.find(m=>m.key===part.key).assetId);
 assert.notEqual(planned.type,'none');assert.equal(fragment().derived.transform.type,planned.type);assert.equal(fragment().derived.transform.palette,job.plan.palette);
 // Studies saved before segment → treat → crop already hold treated working images; they are never treated twice.
 delete job.workingImages.find(w=>w.key===part.key).treatAfterCut;await pipeline.retryPart(job.id,part.key);
 assert.equal(fragment().derived.transform,undefined);
});

test('image generation runs at most two calls at a time, keeps plan order and stops launching after a failure',async t=>{
 let active=0,peak=0;
 const results=await bounded([1,2,3,4,5],2,async n=>{active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,(6-n)*3));active--;return n*10;});
 assert.deepEqual(results,[10,20,30,40,50]);assert.equal(peak,2);
 const launched=[];let finished=0;
 await assert.rejects(bounded([1,2,3,4,5],2,async n=>{launched.push(n);if(n===2)throw new Error('image failed');await new Promise(r=>setTimeout(r,10));finished++;}),/image failed/);
 assert.deepEqual(launched,[1,2]);assert.equal(finished,1);
 const store=await officialFixture(t),base=requestDouble(store),prompts=[];let inFlight=0,most=0;
 const request=async(endpoint,body)=>{if(endpoint!=='images')return base(endpoint,body);prompts.push(body.prompt);inFlight++;most=Math.max(most,inFlight);await new Promise(r=>setTimeout(r,20));try{return await base(endpoint,body);}finally{inFlight--;}};
 const pipeline=new CreationPipeline(store,{prices,vision:fakeVision,request}),job=await pipeline.start(input({count:10}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.equal(most,2);assert.equal(prompts.length,6);
 assert.deepEqual(job.workingImages.map(w=>w.key),job.plan.images.map(i=>i.key));
 for(const item of job.plan.images.filter(i=>!i.sourceId)){
  const asset=store.state.assets.find(a=>a.id===job.workingImages.find(w=>w.key===item.key).assetId);
  assert.ok(asset.generation.prompt.includes(item.prompt));assert.match(asset.generation.prompt,/speculative photograph/);
  assert.equal(/Speculative source/.test(asset.generation.prompt),Boolean(job.researchAssignments[item.key]),item.key);
 }
});
test('a local segmentation timeout retries once, then saves only that part for a later retry',async t=>{
 const store=await fixture(t,6);let failedPath='',allowRetry=false,fallbackCalls=0;
 const vision={...fakeVision,request:async r=>{
  if(r.action==='segment'&&!allowRetry){failedPath||=r.path;if(r.path===failedPath){if(r.samImageSize===640)fallbackCalls++;throw new Error('Local segmentation timed out.');}}
  return fakeVision.request(r);
 }};
 const pipeline=new CreationPipeline(store,{prices,vision,request:requestDouble(store)}),job=await pipeline.start(input({count:6}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.equal(fallbackCalls,1);assert.equal(job.failedParts.length,2);assert.equal(job.project.layers.length,10);assert.match(job.failedParts[0].error,/timed out/);
 allowRetry=true;for(const part of job.failedParts)await pipeline.retryPart(job.id,part.key);
 assert.ok(job.failedParts.every(p=>p.status==='resolved'));assert.equal(job.project.layers.length,12);
});
test('a study with no successful local cuts remains resumable without paid calls',async t=>{
 const store=await fixture(t,6);let allowRetry=false;
 const vision={...fakeVision,request:async r=>r.action==='segment'&&!allowRetry?Promise.reject(new Error('Local segmentation timed out.')):fakeVision.request(r)};
 const pipeline=new CreationPipeline(store,{prices,vision,request:requestDouble(store)}),job=await pipeline.start(input({count:6}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.equal(job.project,undefined);assert.equal(job.failedParts.length,12);assert.match(job.stage,/Waiting for local retries/);
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
 assert.equal(job.archiveSelection.people.length,count===6?3:8);
 assert.equal(job.archiveSelection.general.length,count===6?2:3);
 assert.equal(job.archiveSelection.water.length,count===6?2:3);
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
 const store=await officialFixture(t),rawCuts=new Map();
 // Keep each untreated SAM cut before the pipeline removes its work folder.
 const vision={...fakeVision,request:async r=>{const result=await fakeVision.request(r);if(r.action==='segment')for(const cut of result.cuts)rawCuts.set(`${r.path}:${cut.key}`,await fs.readFile(cut.file));return result;}};
 const pipeline=new CreationPipeline(store,{vision,prices,request:requestDouble(store)});
 const job=await pipeline.start(input({enabledTransforms,tornEdges:false}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);
 assert.ok(job.plan.images.every(i=>i.transform.type==='none'||enabledTransforms.includes(i.transform.type)));
 assert.ok(job.workingImages.every(i=>i.treatAfterCut&&(i.transform.type==='none'||enabledTransforms.includes(i.transform.type))));
 // Every generated part carries one visible treatment when any is enabled; people never do.
 assert.ok(job.plan.images.every(i=>i.sourceId?i.transform.type==='none':i.transform.type===(enabledTransforms[0]||'none')));
 assert.equal(job.plan.images.filter(i=>!i.sourceId&&i.role==='environment').length,2);
 // Segment → treat → crop: SAM sees untreated images; each fragment, detail cuts included, keeps the SAM alpha exactly.
 assert.equal(job.materials.length,12);assert.ok(job.materials.some(m=>m.key.startsWith('D')));
 for(const m of job.materials){
  const working=job.workingImages.find(w=>w.key===m.sourceKey),source=store.state.assets.find(a=>a.id===working.assetId),fragment=store.state.assets.find(a=>a.id===m.assetId);
  assert.equal(source.derived,undefined);const raw=rawCuts.get(`${path.join(store.root,'media',`${source.id}.png`)}:${m.key}`);assert.ok(raw);
  const [before,after]=await Promise.all([raw,path.join(store.root,'media',`${fragment.id}.png`)].map(f=>sharp(f).ensureAlpha().raw().toBuffer()));
  let alphaSame=true,rgbChanged=0;for(let i=0;i<before.length;i+=4){if(before[i+3]!==after[i+3])alphaSame=false;if(before[i+3]&&Math.abs(before[i]-after[i])+Math.abs(before[i+1]-after[i+1])+Math.abs(before[i+2]-after[i+2])>6)rgbChanged++;}
  assert.ok(alphaSame,m.key);
  const treated=working.transform.type!=='none';assert.equal(fragment.derived.transform?.type,treated?working.transform.type:undefined);
  assert.equal(rgbChanged>0,treated,m.key);
 }
});
test('a segmenter returning whole photographs cannot paste them into an automatic collage',async t=>{
 const store=await officialFixture(t);
 const vision={...fakeVision,request:async r=>r.action==='segment'?{cuts:r.regions.map(q=>({...q,file:r.path,coverage:.4,segmenter:'misleading metadata'})),detections:[]}:fakeVision.request(r)};
 const pipeline=new CreationPipeline(store,{vision,prices,request:requestDouble(store)});
 const job=await pipeline.start(input({}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.equal(job.project,undefined);assert.equal(job.failedParts.length,12);
 assert.ok(job.failedParts.every(p=>/almost whole rectangular/.test(p.error)));
});

for(const researchCount of [3,6])test(`research ${researchCount}: each passage leads an image call, every passage sets a relationship, and provenance is saved`,async t=>{
 const store=await fixture(t),calls=[];
 const pipeline=new CreationPipeline(store,{prices,vision:fakeVision,request:requestDouble(store,{onBody:(endpoint,body)=>calls.push({endpoint,body})})});
 const job=await pipeline.start(input({includeArchive:false,includePeople:false,researchCount}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.equal(job.researchDocuments.length,researchCount);
 for(const {endpoint,body} of calls){
  const direction=endpoint==='images'?body.prompt:body.messages[0].content;
  assert.match(direction,/^BINDING TECHNICAL RULES/);assert.match(direction,/ARCHIVE IMAGE RULES/);assert.match(direction,/Never generate people from scratch/);
  assert.match(direction,/exactly one image from collages-style-guide/);assert.match(direction,/only enabled treatments/);
 }
 const ids=job.researchDocuments.map(d=>d.id);assert.deepEqual(job.plan.researchComposition.sourceIds,ids);
 const researchParts=job.plan.images.filter(i=>job.researchAssignments[i.key]),leads=job.researchDocuments.filter(d=>d.filename!=='water-rituals-for-combatting-pests.txt');
 assert.ok(job.researchDocuments.every(d=>d.passages.length===1));assert.ok(researchParts.length>=2);assert.equal(researchParts.length,Math.min(leads.length,job.requestedMaterials));
 assert.ok(researchParts.every(i=>i.researchIds.length===1&&leads.some(d=>d.id===i.researchIds[0])));assert.deepEqual(Object.keys(job.plan.researchComposition.relationships).sort(),[...ids].sort());
 for(const part of researchParts){
  const asset=store.state.assets.find(a=>!a.derived&&a.generation?.researchIntent===part.researchIntent&&JSON.stringify(a.generation.researchIds)===JSON.stringify(part.researchIds));
  assert.ok(asset);assert.equal(asset.generation.localResearch.length,part.researchIds.length);
  const sent=calls.find(c=>c.endpoint==='images'&&c.body.prompt===asset.generation.prompt);assert.ok(sent);
  for(const id of part.researchIds){const doc=job.researchDocuments.find(d=>d.id===id);assert.ok(sent.body.prompt.includes(doc.passages[0].excerpt.replaceAll('\n','\\n'))||sent.body.prompt.includes(doc.passages[0].excerpt));}
 }
 const review=calls.find(c=>c.body.response_format?.json_schema?.name==='collage_critique');
 const payload=JSON.parse(review.body.messages[1].content[0].text);assert.deepEqual(payload.localResearch.map(d=>d.id),ids);assert.deepEqual(payload.researchComposition,job.plan.researchComposition);
 assert.ok(job.researchCoverage);assert.equal(job.researchCoverage.required,researchParts.length);
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

test('a thirteen-image collage plans with all twelve archive references while bypassing Venice',async t=>{
 const store=await officialFixture(t),calls=[];let checkedCounts;
 const imageAwarePrices=async options=>{
  checkedCounts=options.imageCounts;
  const p=await prices(options);
  p.text.planner={...p.text.planner,bound:.08,candidates:[{provider:'venice/fp8',bound:.04,maxPrice:{prompt:.3,completion:2},uptime:100},{provider:'deepinfra/fp8',bound:.04,maxPrice:{prompt:.3,completion:2},uptime:99}]};
  p.total+=.08;return p;
 };
 const pipeline=new CreationPipeline(store,{prices:imageAwarePrices,vision:fakeVision,request:requestDouble(store,{onBody:(endpoint,body)=>calls.push({endpoint,body})})});
 // 3 general + 3 water references, 1 style-guide collage and 5 people photos exceed Venice's 10-image limit.
 const job=await pipeline.start(input({count:13}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);
 assert.deepEqual(checkedCounts,{research:0,planner:12,vision:13});
 const planning=calls.find(c=>c.body.response_format?.json_schema?.name==='advance_collage_plan').body;
 assert.deepEqual(planning.provider.only,['deepinfra/fp8']);assert.equal(planning.messages[1].content.filter(p=>p.type==='image_url').length,12);
 assert.equal(calls.filter(c=>c.endpoint==='images').length,8);assert.equal(job.plan.images.length,13);
 assert.equal(job.ledger.filter(r=>r.label.startsWith('Advance collage plan')).length,1);
 assert.ok(job.ledger.reduce((sum,r)=>sum+r.reserved,0)<=1);
});

test('unreadable Parasail response switches to DeepInfra and completes the ten-image collage',async t=>{
 const {routerRequest}=await import('../server/ai.js');
 const store=await officialFixture(t),base=requestDouble(store),planning=[];let researchCalls=0,imageCalls=0;
 const fallbackPrices=async options=>{
  const p=await prices(options);
  p.text.planner={...p.text.planner,bound:.08,candidates:[{provider:'parasail/fp8',bound:.04,maxPrice:{prompt:.3,completion:2},uptime:100},{provider:'deepinfra/fp8',bound:.04,maxPrice:{prompt:.3,completion:2},uptime:99}]};
  p.total+=.08;return p;
 };
 t.mock.method(globalThis,'fetch',async(url,options)=>{
  const endpoint=url.endsWith('/images')?'images':'chat/completions',body=JSON.parse(options.body);
  if(endpoint==='images')imageCalls++;
  else if(!body.response_format.json_schema)researchCalls++;
  if(body.response_format?.json_schema?.name==='advance_collage_plan'){
   planning.push(body);
   if(planning.length===1)return new Response('{"choices":',{status:200});
  }
  return Response.json(await base(endpoint,body));
 });
 const pipeline=new CreationPipeline(store,{prices:fallbackPrices,vision:fakeVision,request:routerRequest});
 const job=await pipeline.start(input({count:undefined}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.equal(job.count,10);
 assert.deepEqual(planning.map(b=>b.provider.only[0]),['parasail/fp8','deepinfra/fp8']);
 assert.deepEqual(planning[0].messages,planning[1].messages);
 assert.equal(planning[1].messages[1].content.filter(p=>p.type==='image_url').length,9);
 assert.equal(researchCalls,1);assert.equal(imageCalls,6);assert.equal(job.project.layers.length,16);
 assert.equal(job.providerAttempts.find(a=>a.provider==='parasail/fp8').code,'UNREADABLE_RESPONSE');
 assert.equal(job.ledger.find(r=>r.label.startsWith('Advance collage plan')).status,'uncertain');
 assert.ok(job.ledger.reduce((sum,r)=>sum+r.reserved,0)<=1);
});

test('a provider outage during the layout review keeps the rendered draft; other review errors still stop',async t=>{
 const {RouterError}=await import('../server/ai.js');
 for(const [error,status] of [[new RouterError('OpenRouter did not finish the request within 300 seconds.',{status:200,code:'TIMEOUT'}),'complete'],[new RouterError('Credits exhausted',{status:402,code:402}),'failed']]){
  const store=await fixture(t),base=requestDouble(store);
  const request=async(endpoint,body)=>{if(body.response_format?.json_schema?.name==='collage_critique')throw error;return base(endpoint,body);};
  const pipeline=new CreationPipeline(store,{prices,vision:fakeVision,request});
  const job=await pipeline.start(input());await pipeline.running;
  assert.equal(job.status,status,job.error);
  assert.equal(job.ledger.find(r=>r.label.startsWith('Collage critique')).status,'uncertain');
  if(status==='failed'){assert.match(job.error,/Credits exhausted/);continue;}
  assert.equal(job.critique,undefined);assert.deepEqual(job.finalLayout,job.initialLayout);assert.ok(job.previewUrl);assert.equal(job.project.layers.length,12);
  assert.ok(job.warnings.some(w=>/layout review, so the draft arrangement was kept/.test(w)));
 }
});

test('torn paper edges go on generated fragments only, after treatment, and are recorded',async t=>{
 const store=await officialFixture(t),rawCuts=new Map();
 const vision={...fakeVision,request:async r=>{const result=await fakeVision.request(r);if(r.action==='segment')for(const cut of result.cuts)rawCuts.set(cut.key,await sharp(cut.file).metadata());return result;}};
 // The director asks for torn edges everywhere, people included; people stay clean.
 const mutatePlan=plan=>{for(const item of [...plan.images.filter(i=>!i.sourceId),...plan.details])item.edge='torn';return plan;};
 const pipeline=new CreationPipeline(store,{vision,prices,request:requestDouble(store,{mutatePlan})});
 const job=await pipeline.start(input({}));await pipeline.running;
 assert.equal(job.status,'complete',job.error);
 for(const m of job.materials){
  const fragment=store.state.assets.find(a=>a.id===m.assetId),raw=rawCuts.get(m.key),people=job.plan.images.find(i=>i.key===m.sourceKey).role==='people';
  assert.equal(m.edge,people?'clean':'torn',m.key);assert.equal(fragment.derived.edge.style,people?'clean':'torn',m.key);
  const pad=fragment.derived.edge.pad||0;assert.equal(fragment.width,raw.width+2*pad);assert.equal(fragment.height,raw.height+2*pad);
 }
 const off=new CreationPipeline(store,{vision,prices,request:requestDouble(store,{mutatePlan})});
 const plain=await off.start(input({tornEdges:false}));await off.running;
 assert.equal(plain.status,'failed');assert.match(plain.error,/edge/);
});

test('a layout review that drops fragments keeps their draft placement instead of failing',async t=>{
 const store=await fixture(t),base=requestDouble(store);
 const request=async(endpoint,body)=>{
  const result=await base(endpoint,body);
  if(body.response_format?.json_schema?.name!=='collage_critique')return result;
  const review=JSON.parse(result.choices[0].message.content);review.revise=true;review.layout.layers=review.layout.layers.filter(l=>!['F02','D03'].includes(l.assetId));
  return json(review);
 };
 const pipeline=new CreationPipeline(store,{prices,vision:fakeVision,request}),job=await pipeline.start(input());await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.equal(job.project.layers.length,job.materials.length);
 assert.ok(job.warnings.some(w=>/review omitted 2 fragments; they keep the draft placement/.test(w)));
 assert.deepEqual(job.finalLayout.layers.map(l=>l.assetId).sort(),job.initialLayout.layers.map(l=>l.assetId).sort());
 // A tier mix far from 3–5 dominant, 4–7 medium and 5–9 small is reported, not fatal.
 assert.ok(job.warnings.some(w=>/^Scale hierarchy: /.test(w)));
});

test('broken detail cuts in a paid plan are skipped and the collage is still made',async t=>{
 const store=await fixture(t);
 // D01 is too small (kept at the smallest width), D02 names no subject, D03 claims the wrong source image.
 const mutatePlan=plan=>{const d=Object.fromEntries(plan.details.map(x=>[x.key,x]));d.D01.placement.width=.005;d.D02.segment='';d.D03.sourceKey='F01';return plan;};
 const pipeline=new CreationPipeline(store,{prices,vision:fakeVision,request:requestDouble(store,{mutatePlan})});
 const job=await pipeline.start(input());await pipeline.running;
 assert.equal(job.status,'complete',job.error);
 assert.deepEqual(job.plan.details.map(d=>d.key),['D01','D04','D05','D06']);assert.equal(job.plan.details[0].placement.width,.02);
 assert.deepEqual(job.planRepairs.skipped.map(s=>s.key),['D02','D03']);
 assert.equal(job.materials.some(m=>['D02','D03'].includes(m.key)),false);assert.equal(job.project.layers.length,10);
 assert.ok(job.warnings.some(w=>/^Planning: detail D02 was skipped/.test(w)));assert.ok(job.warnings.some(w=>/^Planning: \d+ out-of-range values? (was|were) adjusted/.test(w)));assert.ok(job.planRepairs.repairs.some(r=>/D01\.placement\.width 0\.005 → 0\.02/.test(r)));
});

test('an unusable layout review keeps the draft collage',async t=>{
 const store=await fixture(t),base=requestDouble(store);
 const request=async(endpoint,body)=>body.response_format?.json_schema?.name==='collage_critique'?json({assessment:'Incomplete',revise:true}):base(endpoint,body);
 const pipeline=new CreationPipeline(store,{prices,vision:fakeVision,request}),job=await pipeline.start(input());await pipeline.running;
 assert.equal(job.status,'complete',job.error);assert.equal(job.critique,undefined);assert.deepEqual(job.finalLayout,job.initialLayout);
 assert.ok(job.warnings.some(w=>/usable layout review, so the draft arrangement was kept/.test(w)));
 // The unusable review is never recorded as a decision; the planning decision still is.
 assert.equal(job.decisions.some(d=>d.step==='Collage critique'),false);assert.ok(job.decisions.some(d=>d.step==='Advance collage plan'));
});

test('a rejected OpenRouter key stops the study before any paid call',async t=>{
 const store=await fixture(t);let calls=0;
 const pipeline=new CreationPipeline(store,{prices,vision:fakeVision,request:async()=>{calls++;},keyCheck:async()=>{throw new Error('OpenRouter rejected the API key (“User not found.”). No paid calls were made.');}});
 const job=await pipeline.start(input());await pipeline.running;
 assert.equal(job.status,'failed');assert.match(job.error,/rejected the API key/);assert.equal(calls,0);assert.equal(job.ledger.length,0);
});
