import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {Budget,MAX_COST,COST_LIMIT_TEXT,TEXT_MODELS,pricingPlan} from './budget.js';
import {routerRequest,checkApiKey,referenceData,parseJsonResponse,retryableProviderError} from './ai.js';
import {inspectCut} from './crops.js';
import {selectOfficialArchive,archiveCounts,shuffled,referenceEligible} from './archive.js';
import {retrieveArchive,archiveHasPeople,assemble,renderCollage,materialSheet} from './compose.js';
import {VisionWorker} from './vision.js';
import {routedTextCall} from './routing.js';
import {providerSchema} from './structured.js';
import {projectSchema,validateLayerPermissions} from './schema.js';
import {creationInput,advanceSchema,advanceFor,validateAdvance,repairPlan} from './plan.js';
import {projectContext,syncProjectContext} from './context.js';
import {researchLibrary,selectResearch,researchAssignments,auditResearchParts} from './research.js';
import {treatedCut,treatedImage,TRANSFORM_OPTIONS,permittedTransforms,treatmentBudget,restrainTreatments} from './transforms.js';
import {tornEdge,edgeSeed} from './edges.js';
import {TIER_TARGETS,detailAssignments,fragmentTargets,scaleHierarchyWarning} from './fragments.js';
import {CANVAS,LEGACY_CANVAS,canvasOf,outputScale} from '../shared/canvas.js';
import {SIZE_LIMITS,sizeReport} from './scale.js';
import {fillComposition} from './coverage.js';
import {canvasGround,DEFAULT_GROUND} from '../shared/ground.js';

export const rootCount=materials=>new Set(materials.map(m=>m.rootId)).size;
// Studies from version 11 compose on the 5760 × 1080 panorama; earlier ones keep their canvas.
const jobCanvas=job=>job.project?canvasOf(job.project):job.version>=11?CANVAS:LEGACY_CANVAS;
// Fragments held below their size range (by proportions or source resolution) are reported, not enlarged into softness.
const sizeWarnings=(project,materials)=>{const {below}=sizeReport(project,materials,canvasOf(project));return below.length?[`${below.length} fragment${below.length===1?' is':'s are'} shown below ${below.length===1?'its':'their'} size range because ${below.length===1?'its proportions or source resolution do':'their proportions or source resolution do'} not allow enlarging further without softness.`]:[];};
const peopleLabel=item=>/group|people|gathering|crowd|family|youth/i.test(item.segment)?'complete group of people':'complete person';
// A review that drops a fragment keeps the draft placement for it, in its draft position.
export function restoreOmitted(draft,revised){
 const chosen=new Set(revised.map(l=>l.assetId)),layers=[...revised],missing=draft.filter(l=>!chosen.has(l.assetId));
 for(const layer of missing){const before=draft.slice(0,draft.indexOf(layer)).reverse().find(l=>layers.some(v=>v.assetId===l.assetId));layers.splice(before?layers.findIndex(v=>v.assetId===before.assetId)+1:0,0,layer);}
 return {layers,missing:missing.map(l=>l.assetId)};
}
export function compositionWarnings(coverage,count){
 const warnings=[];
 if(coverage.distinctVisible!==count)warnings.push(`${coverage.distinctVisible} of ${count} source images remain visibly represented in the final collage.`);
 if(coverage.coverage<.995)warnings.push(`Canvas coverage is ${(coverage.coverage*100).toFixed(1)}%; the completed image is shown with the remaining open area.`);
 if(coverage.dominantShare>.58)warnings.push('A fragment still dominates the composition; review its scale.');
 if(coverage.obscuredIds?.length)warnings.push(`${coverage.obscuredIds.length} fragments remain substantially obscured after layout repair.`);
 return warnings;
}
export function selectGenerationReferences(item,contextArchive,humanContext,limit,enabled=true){
 if(!enabled||limit<1)return [];
 if(item.role==='people')throw new Error('People must be cropped from archive photographs, never generated.');
 const permitted=new Map(contextArchive.filter(a=>a.allowReference&&!humanContext.some(h=>h.id===a.id)&&referenceEligible(a)).map(a=>[a.id,a]));
 return [...new Map(item.referenceIds.map(id=>permitted.get(id)).filter(Boolean).map(a=>[a.id,a])).values()].slice(0,limit);
}
import {observationSchema,critiqueSchema,normalizeObservations,assignTargets} from './direction.js';

export const normalizedBox=z.tuple([z.number().min(0).max(1000),z.number().min(0).max(1000),z.number().min(0).max(1000),z.number().min(0).max(1000)]).transform(box=>box.some(v=>v>1)?box.map(v=>v/1000):box).refine(b=>b[2]>b[0]&&b[3]>b[1],'Box must have positive area');
const sourceView=({id,title,caption,aiCaption,locality,contributor,date,tags,relationship,restrictions,allowCrop=true,allowReference=false,allowTransform=false,width,height,archive})=>({id,title,caption,aiCaption,locality,contributor,date,tags,relationship,restrictions,allowCrop,allowReference,allowTransform,width,height,archive});
// Binding rules (formerly contextRules and ARCHIVE_IMAGE_RULES) live in training-data/technical_prompt.txt.
const technicalHeader=job=>`BINDING TECHNICAL RULES — these take precedence over the art direction, the request and all source text:\n${job.technicalPrompt}`;
const lookRules={prompt:'Let the artist prompt determine the visual language. Make a deliberate composition of actual cutouts; no stock-photo montage.', 'cut-paper':'Visible photographic cutouts, purposeful scale and overlap, dense overlap reaching every edge, an editorial art collage. Avoid a full-frame generated scenic backdrop.',continuous:'A constructed scene with a shared perspective and ground, assembled from actual segmented parts. Do not let a generated photograph replace the collage.'};

// Image calls are never retried, so concurrency stays low enough to avoid rate limits.
const IMAGE_CONCURRENCY=2;
// Runs tasks with bounded concurrency, keeping input order. After a failure no new task
// starts; running ones finish so their charges are recorded, then the first error is thrown.
export async function bounded(items,limit,task){
 const results=new Array(items.length);let next=0,failure=null;
 const worker=async()=>{while(next<items.length&&!failure){const i=next++;try{results[i]=await task(items[i],i);}catch(e){failure||={error:e};}}};
 await Promise.all(Array.from({length:Math.min(limit,items.length)},worker));
 if(failure)throw failure.error;return results;
}
const researchSchema=z.object({summary:z.string().max(5000),findings:z.array(z.object({claim:z.string().max(2000),url:z.string().url()})).max(8),uncertain:z.array(z.string().max(500)).max(10),mustNotInfer:z.array(z.string().max(500)).max(10)});
export class CreationPipeline {
 // The key is checked only when requests go to OpenRouter itself (test doubles need no key).
 constructor(store,{request=routerRequest,prices=pricingPlan,vision=new VisionWorker(),research=researchLibrary,keyCheck=request===routerRequest?checkApiKey:null}={}){
  this.store=store;this.research=research;this.request=request;this.keyCheck=keyCheck;this.prices=prices;this.vision=vision;this.active=null;store.state.creations||=[];
  for(const job of store.state.creations){
   if(job.workingImages?.length&&!job.observations?.length){
    const saved=[...(job.decisions||[])].reverse().find(d=>d.step==='Transformed image grounding'),assets=job.workingImages.map(w=>store.state.assets.find(a=>a.id===w.assetId)).filter(Boolean);
    try{if(saved&&assets.length)job.observations=normalizeObservations(parseJsonResponse({choices:[{message:{content:saved.response}}]}),assets);}catch{}
   }
   const locallyRecoverable=job.workingImages?.length&&job.observations?.length&&(job.status==='failed'||['queued','running','cancelling'].includes(job.status));
   if(locallyRecoverable){
    const completed=new Set((job.materials||[]).map(m=>m.key));
    job.failedParts=fragmentTargets(job.plan||{images:job.workingImages.map(w=>({key:w.key}))}).filter(t=>!completed.has(t.key)).map(t=>{const w=job.workingImages.find(w=>w.key===t.sourceKey);return w&&{key:t.key,sourceKey:t.sourceKey,label:t.item.label||t.key,assetId:w.assetId,rootId:w.rootId,role:job.plan?.images?.find(i=>i.key===t.sourceKey)?.role||'material',status:'failed',error:'Local cutting was interrupted. Retry this part to continue from the saved material.'};}).filter(Boolean);
    job.status='complete';job.stage='Waiting for local retries';delete job.error;
    job.warnings||=[];job.warnings.push('Local cutting was interrupted. Saved source material can be retried without repeating paid calls.');
   }else if(['queued','running','cancelling'].includes(job.status)){job.status='interrupted';job.error='The server restarted. Paid calls were not retried; reservations remain recorded.';}
  }
 }
 async status(){return {ready:await this.vision.available(),activeId:this.active,maxCost:MAX_COST};}
 async start(input){
  input=creationInput.parse(input);
  const defaults=await syncProjectContext(this.store);
  input.systemPrompt=input.systemPrompt??this.store.state.systemPrompt??defaults.systemPrompt;
  const existing=this.store.state.creations.find(j=>j.requestId===input.requestId);if(existing)return existing;
  if(this.active)throw Object.assign(new Error('Another collage is being made.'),{status:409});
  if(!process.env.OPENROUTER_API_KEY)throw Object.assign(new Error('Add OPENROUTER_API_KEY to .env before creating an image.'),{status:400});
  if(!await this.vision.available())throw Object.assign(new Error('Install the local cutting models with npm run setup:vision.'),{status:503});
  if(!retrieveArchive(this.store.state.assets,input.prompt,input.ids).length)throw Object.assign(new Error('Add at least one source photograph first.'),{status:400});
  if(this.active)throw Object.assign(new Error('Another collage is being made.'),{status:409});

  const job={...input,technicalPrompt:defaults.technicalPrompt,technicalPromptRevision:defaults.technicalPromptRevision,id:randomUUID(),version:11,status:'queued',stage:'Preparing',progress:0,createdAt:new Date().toISOString(),maxCost:MAX_COST,ledger:[],events:[],assetIds:[],warnings:[]};
  this.active=job.id;this.store.state.creations.push(job);
  try{await this.store.persist();}catch(e){this.active=null;job.status='failed';throw e;}
  this.running=this.run(job).catch(async e=>{job.status=job.cancelRequested?'cancelled':'failed';job.error=e instanceof z.ZodError?'A model returned an invalid response: '+e.issues.slice(0,2).map(i=>i.path.join('.')+' '+i.message).join('; '):e.message;job.finishedAt=new Date().toISOString();await this.store.persist();}).finally(()=>{this.active=null;});
  return job;
 }
 async step(job,stage,progress){if(job.cancelRequested)throw new Error('Creation stopped. Completed calls remain in the cost record.');job.status='running';job.stage=stage;job.progress=progress;job.events.push({stage,at:new Date().toISOString()});await this.store.persist();}
 async chat(job,budget,pricing,role,label,system,content,search=false,schema=null,accept=null){
  if(job.cancelRequested)throw new Error('Creation stopped.');
  const grammar=schema&&providerSchema(schema),format=schema?{type:'json_schema',json_schema:{name:label.toLowerCase().replace(/[^a-z]/g,'_'),strict:true,schema:grammar.schema}}:{type:'json_object'};
  const body={model:TEXT_MODELS[role],messages:[{role:'system',content:`${technicalHeader(job)}\n\nEDITABLE PROJECT ART DIRECTION:\n${job.systemPrompt}\n\nCURRENT TASK:\n${system}`},{role:'user',content}],max_tokens:pricing.text[role].maxTokens||5000,temperature:.35,response_format:format,...(search?{plugins:[{id:'web',engine:'exa',mode:'auto',max_results:5,search_prompt:'External context only, never evidence of archive identity or locality. Extract relevant physical, spatial or social principles. Return exact source URLs in the requested JSON.'}]}:{})};
  const result=await routedTextCall({job,budget,quote:pricing.text[role],label,body,accept,request:this.request,persist:()=>this.store.persist(),unavailable:new Set((job.providerAttempts||[]).filter(a=>a.status==='failed').map(a=>a.provider))});
  job.decisions||=[];job.decisions.push({step:label,model:body.model,provider:result.provider,response:result.choices?.[0]?.message?.content,...(grammar?.removed.length?{grammarKeywordsRemoved:grammar.removed}:{}),at:new Date().toISOString()});await this.store.persist();return result;
 }
 async observe(job,budget,pricing,assets,label,recipes=[]){
  const content=[{type:'text',text:JSON.stringify({request:job.prompt,visualDirection:lookRules[job.aesthetic],targets:recipes,instruction:'Inspect every supplied image and return one entry per image, even if its regions array is empty. Return exactly one region for each requested extraction target, using the target key as the region key; targets from the same image must be different parts of it, each at its planned tier and scale. These are the untreated source images: each planned treatment is applied after segmentation, so locate the subject in exactly these pixels. Choose a positive point on the actual material, not empty space between a group. Use the planned placement, boundary and composition to choose the part that will interlock with neighbouring fragments. For generated images, locate ONLY the requested extraction subject, never the entire scenic photograph. Environmental fields must retain a meaningful partial subject with irregular edges; avoid selecting more than 85% of the source. Each region needs a short unique key, label, tightly enclosing box [left,top,right,bottom] and one positive point [x,y] INSIDE the actual subject (not just the box center). HUMAN SAFETY: if the target contains people, the label must explicitly say person, people or group; enclose every selected person from the top of the visible head through the bottom of the visible body, including connected limbs. Never select an isolated head, face, torso, hand or foot. If the whole visible figure is not available, return no region. Choose ONE coordinate system per image: normalized_1000 means both axes use 0–1000; pixels means x uses the supplied image width and y uses its height. Declare coordinateSpace and never mix the two systems. Explain why the part relates to this collage. Description under 35 words. Images that lack the requested subject get an empty regions array. Do not infer source context. Use exact image IDs.'})}];
  for(const a of assets)content.push({type:'text',text:JSON.stringify(sourceView(a))},{type:'image_url',image_url:{url:await referenceData(this.store,a)}});
  const result=await this.chat(job,budget,pricing,'vision',label,'You are a visual editor directing SAM segmentation. Return images with id, description, coordinateSpace, and regions containing key, label, box, point, reason. coordinateSpace must truthfully declare whether every coordinate for that image uses original-image pixels or normalized 0–1000 units.',content,false,observationSchema,answer=>assignTargets(normalizeObservations(parseJsonResponse(answer),assets),recipes));
  return result.accepted;
 }
 // Segment → treat → crop: SAM cuts the untreated image, then the treatment is
 // applied to the whole image and cropped with the same box and alpha.
 async cut(job,asset,regions,reason,keepWhole=false,treatment=null){
  const materials=[];
  if(!asset.allowCrop||keepWhole)throw new Error('Every collage fragment requires a composition-led crop; whole photographs cannot be pasted.');
  if(!asset.allowCrop||!regions.length){if(asset.kind==='generated'&&!regions.length)job.warnings.push(`The visual editor could not locate the requested subject in “${asset.title}”; it was excluded.`);return materials;}
  const temp=path.join(this.store.root,'work',job.id,asset.id);await fs.mkdir(temp,{recursive:true});
  const request={action:'segment',path:path.join(this.store.root,'media',`${asset.id}.png`),outputDir:temp,regions,maxCuts:regions.length,directed:true};
  let result;
  try{result=await this.vision.request(request);}
  catch(e){
   if(!/timed out|worker stopped/i.test(e.message))throw e;
   job.warnings.push(`Local cutting for “${asset.title}” timed out; it was retried locally at a smaller working size.`);
   result=await this.vision.request({...request,samImageSize:640,timeoutMs:180000});
  }
  job.detections||=[];job.detections.push({assetId:asset.id,requestedRegions:regions,detections:result.detections});
  const prepared=treatment&&treatment.type!=='none'&&result.cuts.length?await treatedImage(this.store,asset,treatment):null;
  for(const cut of result.cuts){
   const region=regions.find(r=>r.key===cut.key),cropAudit=await inspectCut(cut.file,asset),treated=await treatedCut(this.store,asset,cut,treatment,prepared);
   // Torn paper goes on last, after treatment and crop; people always keep clean edges.
   const torn=region?.edge==='torn'&&asset.kind==='generated'?await tornEdge(treated.bytes,{seed:edgeSeed(`${asset.id}:${cut.key}`)}):null;
   const fragment=await this.store.addImage(torn?.bytes||treated.bytes,`${cut.label}.png`,{kind:asset.kind,title:cut.label,caption:asset.caption,aiCaption:asset.aiCaption,locality:asset.locality,contributor:asset.contributor,date:asset.date,relationship:asset.relationship,restrictions:asset.restrictions,allowCrop:true,allowReference:asset.allowReference,rootId:asset.rootId||asset.id,derived:{parentId:asset.id,parent:sourceView(asset),boundary:regions.find(r=>r.key===cut.key)?.boundary,box:cut.box,point:cut.point,cropBox:cut.cropBox,detector:cut.detector,segmenter:cut.segmenter,coverage:cut.coverage,cropAudit,targetKey:cut.key,instanceBoxes:cut.instanceBoxes,...(treated.transform?{transform:treated.transform}:{}),edge:torn?.edge||{style:'clean'}},...(asset.generation?{generation:asset.generation}:{})});
   if(materials.some(m=>m.asset.id===fragment.id))continue; // identical cuts are one fragment
   job.assetIds.push(fragment.id);materials.push({asset:fragment,key:cut.key,label:cut.label,reason:region?.purpose||reason,extraction:region?.reason});
  }
  if(!result.cuts.length)job.warnings.push(`No usable SAM mask for “${asset.title}”. It was not replaced with an arbitrary rectangular crop.`);
  await fs.rm(temp,{recursive:true,force:true});return materials;
 }
 async retryPart(jobId,key){
  if(this.active)throw Object.assign(new Error('Another collage operation is already running.'),{status:409});
  const job=this.store.state.creations.find(j=>j.id===jobId),part=job?.failedParts?.find(p=>p.key===key);
  if(!job||!part)throw Object.assign(new Error('Failed part not found.'),{status:404});
  const target=fragmentTargets(job.plan).find(t=>t.key===key),item=target?.item,source=job.plan?.images?.find(i=>i.key===(part.sourceKey||target?.sourceKey));
  const working=source&&job.workingImages?.find(w=>w.key===source.key),asset=working&&this.store.state.assets.find(a=>a.id===working.assetId);
  if(!asset||!item)throw Object.assign(new Error('The source material for this part is unavailable.'),{status:409});
  this.active=job.id;part.status='retrying';await this.store.persist();
  try{
   const regions=job.observations?.find(o=>o.id===asset.id)?.regions||[],human=source.role==='people';
   const previous=regions.find(r=>r.targetKey===key)||(target.primary&&!regions.some(r=>r.targetKey)?regions[0]:null);
   const region=human
    ?{key,label:peopleLabel(source),box:[0,0,1,1],point:[.5,.5],reason:`Retry the complete figure for ${item.label}`,boundary:item.boundary,human:true}
    :{...(previous||{label:item.segment,box:[0,0,1,1],point:[.5,.5],reason:item.reason}),key,boundary:item.boundary,human:false,edge:item.edge||'clean',purpose:item.reason};
   // Studies saved before segment → treat → crop already hold treated working images.
   const cuts=await this.cut(job,asset,[region],item.reason,false,working.treatAfterCut?{...working.transform,palette:job.plan.palette,subject:source.segment}:null);
   if(!cuts.length)throw Object.assign(new Error(`SAM still could not extract “${item.label}”. The partial study remains available.`),{status:422});
   const fragment={...cuts[0],key,sourceKey:source.key,rootId:working.rootId,tier:item.tier,edge:item.edge},material=fragment,stored={...fragment,assetId:cuts[0].asset.id};delete stored.asset;
   job.materials=[...(job.materials||[]).filter(m=>m.key!==key),stored];
   const oneLayout={background:job.project?.background||job.plan.background,rationale:item.reason,negativeSpace:'',layers:[{assetId:key,name:item.label,...item.placement,opacity:1,reason:item.reason}]};
   const layer=assemble(job.plan,[material],job.prompt,oneLayout,jobCanvas(job)).layers[0],order=job.plan.layerOrder||job.plan.images.map(i=>i.key);
   const rootKey=l=>job.materials.find(m=>m.assetId===l.assetId)?.key;
   const layers=[...(job.project?.layers||[]).filter(l=>rootKey(l)!==key),layer].sort((a,b)=>order.indexOf(rootKey(a))-order.indexOf(rootKey(b)));
   job.project=job.project?{...job.project,layers}:{...assemble(job.plan,[material],job.prompt,oneLayout,jobCanvas(job)),layers};
   const materials=job.materials.map(m=>({...m,asset:this.store.state.assets.find(a=>a.id===m.assetId)})).filter(m=>m.asset);
   job.coverage=await fillComposition(this.store,job.project,materials);
   job.previewUrl=await renderCollage(this.store,job.project,job.id);job.outputUrl=job.previewUrl;
   part.status='resolved';part.resolvedAt=new Date().toISOString();delete part.error;job.status='complete';job.stage='Complete';delete job.error;
   job.warnings=job.warnings.filter(w=>!w.includes(`“${item.label}”`)&&!/^Canvas coverage|^\d+ of \d+ source images|^Scale hierarchy|^\d+ fragments? (is|are) shown below/.test(w));
   job.warnings.push(...compositionWarnings(job.coverage,rootCount(materials)),...[scaleHierarchyWarning(job.plan,new Set(job.materials.map(m=>m.key)))].filter(Boolean),...sizeWarnings(job.project,materials));auditResearchParts(job);
   this.store.state.project=job.project;await this.store.persist();return job;
  }catch(e){part.status='failed';part.error=e.message;await this.store.persist();throw e;}
  finally{this.active=null;}
 }
 async ignorePart(jobId,key){
  const job=this.store.state.creations.find(j=>j.id===jobId),part=job?.failedParts?.find(p=>p.key===key);
  if(!job||!part)throw Object.assign(new Error('Failed part not found.'),{status:404});
  part.status='ignored';part.resolvedAt=new Date().toISOString();await this.store.persist();return job;
 }
 async run(job){
  const store=this.store,budget=new Budget(job,()=>store.persist());
  await this.step(job,'Checking images and budget',2);
  let archive,contextArchive,generatedCount,humanContext;
  if(store.state.officialArchive||store.state.assets.some(a=>a.archive?.active)){
   const selection=selectOfficialArchive(store.state.assets,job);
   ({archive,contextArchive,generatedCount}=selection);humanContext=selection.selected.people;
   job.archiveSelection=Object.fromEntries(Object.entries(selection.selected).map(([category,assets])=>[category,assets.map(a=>a.id)]));
   job.referenceAssignments=selection.referenceAssignments;
   job.compositionReferenceId=selection.selected.composition[0].id;
  }else{
   contextArchive=retrieveArchive(store.state.assets,job.prompt,job.ids).map(r=>r.asset);
   const detectedPeople=new Set(),unverified=new Set();
   for(const asset of contextArchive){
    if(archiveHasPeople(asset)){detectedPeople.add(asset.id);continue;}
    try{const result=await this.vision.request({action:'detect',path:path.join(store.root,'media',`${asset.id}.png`)});if(result.detections.some(d=>d.label==='person'&&d.confidence>=.2))detectedPeople.add(asset.id);}
    catch{unverified.add(asset.id);}
   }
   humanContext=contextArchive.filter(a=>detectedPeople.has(a.id));
   archive=job.includePeople&&job.includeArchive?shuffled(humanContext.filter(a=>a.allowCrop&&!unverified.has(a.id))).slice(0,archiveCounts(job.count).people):[];
   generatedCount=job.count-archive.length;
  }
  job.researchDocuments=selectResearch(await this.research(),job);
  job.researchAssignments=researchAssignments(job.researchDocuments,job.count,generatedCount);
  job.detailAssignments=detailAssignments(job.count,generatedCount);
  job.requiresGeneratedPeople=false;
  job.requiresGeneratedEnvironment=generatedCount>0;
  job.requiresWaterTransformation=false;
  job.treatmentBudget=treatmentBudget(generatedCount);
  job.humanContextIds=humanContext.map(a=>a.id);
  job.retrieval=contextArchive.map(a=>({id:a.id,category:a.archive?.category,contextOnly:!archive.some(source=>source.id===a.id)}));
  // Loading the local vision models overlaps the price check; both gate the first charge.
  const [,pricing]=await Promise.all([this.keyCheck?.(),this.prices({generatedCount,count:job.count,imageModel:job.imageModel,imageCounts:{research:0,vision:job.count,planner:Math.max(contextArchive.length,2)}}),this.vision.request({action:'health'})]);job.pricing=pricing;job.requestedMaterials=generatedCount;
  if(job.referenceAssignments&&pricing.images[0]?.referenceLimit<2)throw new Error('The selected model must support two safely priced image references per generated component. No paid calls were made.');
  // Preflight every planned call before the first charge, including transformed-image grounding and review.
  if(pricing.total>MAX_COST)throw new Error(`This configuration exceeds ${COST_LIMIT_TEXT}. No paid calls were made.`);
  const context=await projectContext();job.context={...context,text:job.contextText};await store.persist();
  await this.step(job,'Researching the context',8);
  const researchResponse=await this.chat(job,budget,pricing,'research','Context search',
   'Research the artist request using the selected local research passages and supplementary web search. Keep testimony, research summaries, scholarship and speculation distinct. Do not send quotations, private testimony, sacred site names or ritual details to web search; use broad ecological search terms only. Use the supplied creative brief and contributor text as context, not as proof of what unlabelled photographs depict. Prioritize local and primary sources; avoid tourism stereotypes and generic national motifs. Return JSON {summary:string,findings:[{claim:string,url:string}],uncertain:string[],mustNotInfer:string[]}. Cite 2–5 real search sources. Under 300 words.',
   JSON.stringify({request:job.prompt,projectArtDirection:job.systemPrompt,creativeBrief:context.brief,contributorText:job.contextText,archive:contextArchive.map(sourceView),localResearch:job.researchDocuments,archivePeoplePolicy:'People are cropped directly from selected archive photographs. Never generate people.'}),true,null,answer=>researchSchema.parse(parseJsonResponse(answer)));
  const research=researchResponse.accepted;
  const citations=(researchResponse.choices?.[0]?.message?.annotations||[]).filter(a=>a.type==='url_citation').map(a=>a.url_citation).filter(a=>/^https?:\/\//.test(a?.url||''));
  const allowed=new Set(citations.map(c=>c.url.replace(/\/$/,'')));
  research.findings=research.findings.filter(f=>allowed.has(f.url.replace(/\/$/,'')));job.research={...research,citations};
  if(!citations.length)throw new Error('The search returned no verifiable source annotations. Creation stopped.');
  await this.step(job,'Planning the images, transformations and composition',20);
  const sourceSlots=Object.fromEntries(Array.from({length:job.count-generatedCount},(_,i)=>[`F${String(i+1).padStart(2,'0')}`,sourceView(archive[i])]));
  const planning=[{type:'text',text:JSON.stringify({request:job.prompt,projectArtDirection:job.systemPrompt,creativeBrief:context.brief,contributorText:job.contextText,localResearch:job.researchDocuments,researchAssignments:job.researchAssignments,research:job.research,count:job.count,generatedCount,includeArchive:job.includeArchive,includePeople:job.includePeople,useReferences:job.useReferences,transformations:job.transformations,recolouring:job.recolouring,enabledTransforms:permittedTransforms(job),treatments:TRANSFORM_OPTIONS.filter(t=>permittedTransforms(job).includes(t.id)),treatmentBudget:job.treatmentBudget,requiresGeneratedPeople:job.requiresGeneratedPeople,requiresGeneratedEnvironment:job.requiresGeneratedEnvironment,requiresWaterTransformation:job.requiresWaterTransformation,compositionLimits:{canvas:CANVAS,maxLayerCanvasFraction:.58,minVisibleRetention:.25,ground:DEFAULT_GROUND},detailAssignments:job.detailAssignments,scaleHierarchy:{tierTargets:TIER_TARGETS,sizeLimits:SIZE_LIMITS},tornEdges:job.tornEdges,sourceSlots,referenceAssignments:job.referenceAssignments,compositionReferenceId:job.compositionReferenceId,archiveSelection:job.archiveSelection,archive:contextArchive.map(sourceView),humanContextIds:job.humanContextIds})}];
  for(const a of contextArchive){
   const sourceIndex=archive.findIndex(source=>source.id===a.id),slot=sourceIndex>=0&&sourceIndex<job.count-generatedCount?`F${String(sourceIndex+1).padStart(2,'0')}`:a.id===job.compositionReferenceId?'COMPOSITION REFERENCE ONLY: study scale, overlap and layout; do not copy its subjects or pixels':'GENERATION REFERENCE ONLY';
   planning.push({type:'text',text:`The next image is ${slot}: ${a.title}. Exact source ID: ${a.id}. Do not assign its subject to another slot.`},{type:'image_url',image_url:{url:await referenceData(store,a)}});
  }
  // Turns a planner answer into a validated plan, or throws so the next provider plans instead.
  const finalizePlan=answer=>{
   const repaired=repairPlan(answer,advanceFor(archive,job,generatedCount,contextArchive));
   const kept=Object.fromEntries(Object.entries(job.detailAssignments||{}).filter(([key])=>repaired.raw.details?.[key]));
   const rawPlan=advanceFor(archive,{...job,detailAssignments:kept},generatedCount,contextArchive).parse(repaired.raw);
   const baseKeys=Object.values(rawPlan.images).filter(item=>!item.sourceId&&item.role==='environment').map(item=>item.key);
   rawPlan.layerOrder=[...baseKeys,...rawPlan.layerOrder.filter(key=>!baseKeys.includes(key))];
   const candidatePlan=advanceSchema.parse({...rawPlan,background:canvasGround(rawPlan.background),images:Object.values(rawPlan.images),...(rawPlan.details?{details:Object.values(rawPlan.details)}:{})});
   const adjustments=restrainTreatments(candidatePlan,job);
   return {plan:validateAdvance(candidatePlan,archive,job,generatedCount,contextArchive),repairs:repaired.notes,skipped:repaired.skipped,adjustments};
  };
  const planned=await this.chat(job,budget,pricing,'planner','Advance collage plan',
   `Plan an artwork BEFORE generation or cutting. Use every selected localResearch document to inform researchComposition: cite all supplied document IDs in sourceIds and explain their spatial consequences (scale, overlap, rhythm, thresholds or relationships), not just a list of themes. In researchComposition.relationships give every selected passage ID the concrete visual relationship or layout consequence it creates (a river crossing historical and speculative landscapes, figures at different scales suggesting different times, plants emerging from unexpected ground, water connecting otherwise separate fragments, where scale shifts, what overlaps or interlocks, the rhythm or direction of movement), and make the placements visibly follow it: this is visual storytelling, not an arrangement of attractive images. Each generated slot in researchAssignments is led by exactly one passage. Keep that ID in researchIds, name the passage and how it becomes the image in researchIntent, and make the generation prompt a speculative image of it. These are speculative environmental interpretations, never reconstructions of sacred actions. Other generated slots may cite permitted local research IDs. Archive people slots must have empty researchIds and stay unchanged. Inspect ALL archive images as visual context, even when final archive inclusion is off. ${lookRules[job.aesthetic]}
	Return an images OBJECT with exactly ${job.count} fixed slots F01, F02 etc, matching the JSON schema. Archive slots must use the exact IDs in sourceSlots; their prompt is an empty string and referenceIds is empty. The last ${generatedCount} slots are new generated images with sourceId:null, a concrete generation prompt and permitted referenceIds. Do not swap sourceId and referenceIds. Every slot becomes one distinct image. Source slots identify material, NOT drawing order. Return layerOrder as every image and detail key in your chosen back-to-front drawing order: several interlocking environmental crops first and foreground people silhouettes last. For every archive slot, choose a subject visibly present in THAT SLOT'S paired image and keep its label faithful to the supplied title and pixels. Never move a subject, title or crop intention to a different slot. The segment string names the actual physical subject to cut (for example 'the wet rock shelf below the waterfall'), NEVER the word field, silhouette, whole or residue. Each item specifies the subject to segment, a visible treatment applied after segmentation and before cropping, and placement (center x,y 0–1, width as a fraction of the 5760 × 1080 canvas width, rotation degrees). These placements must form a coherent visual argument grounded in the archive, supplied text and research. A repeated crop never counts as another image.
	CANVAS AND SCALE: the collage is a 5760 × 1080 panorama spanning three 1920 × 1080 screens, so read size as height. Give every image slot and every detail slot a tier so the collage has 3–5 dominant, 4–7 medium and 5–9 small fragments: dominant fragments stand 75–120% of the canvas height (at most 45% of its width), medium 40–75% (at most 25% of the width), small 15–40% (at most 12% of the width). Archive people stand 45–80% of the canvas height and stay entirely inside the frame. Choose widths that approximate these heights; the studio enforces the ranges after cutting, using each cut's real proportions. Contrast very large elements with much smaller details, and spread material across all three screens. Each slot in detailAssignments is an extra cut from that generated image: name a different physical part of it than its primary segment (a closer detail, an edge, a texture, a secondary form) at another scale, so the same material recurs at different sizes. Details share their image's treatment and never come from people photographs. Use purposeful overlaps and partial concealment rather than side-by-side placement. When tornEdges is true, choose edge 'torn' for broad fields and solid material so they read as torn magazine paper, and 'clean' for thin, branching or fragmented subjects; people are always 'clean'.
	The background is pure black (${DEFAULT_GROUND}); set background to ${DEFAULT_GROUND}. The black ground is only a safeguard beneath cuts, not a substitute for image coverage. Fill the canvas completely: broad interlocking environmental fields below and irregular silhouettes above, all overlapping beyond their visible edges. No white or cream gaps, floating-object arrangement, uniform grid, square picture tile, rectangular photograph or whole-photo layer. A field is an expanded but irregular SAM-bounded environmental crop with transparent corners; silhouette preserves SAM alpha; residue expands the boundary slightly. Use no whole boundaries. Keep every fragment at a scale supported by its source resolution; never enlarge a small crop merely to fill space. Distribute the ground across at least two environmental crops; no single background image may span the collage. Keep each layer under 58% of the canvas area and at least 25% of each fragment visible. Avoid a large photograph hiding a stack of smaller cuts; offset and interlock fragments across the composition.
	Archive people slots must crop a complete visible person or group directly from the paired photograph, preserving appearance and connected bodies. Never generate people. All generated slots are environment or material and must explicitly exclude people. People cutouts use silhouette or residue boundaries and no image transformations. Use the single compositionReferenceId image only to inform arrangement, scale, overlap and rhythm, without copying the artwork. General Chikukwa and water references (including sacred water sites) inform new environmental material; they are not direct collage fragments. Honour each fixed referenceAssignments pair exactly. Sacred-water folder membership does not justify inventing beliefs, rituals, identities or symbols. A generated slot required as environment must be a high-resolution material fragment with a selective crop. Several fragments jointly cover the ground; none becomes a full-canvas backdrop.
	Generate individual substantial SPECULATIVE photographic subjects, NEVER finished collages, scenic backgrounds, collages of objects, blank paper or flat fields. Each generation prompt names what is imagined (an impossible scale, hybrid matter, a threshold between water, earth and sky, a displaced spring, a submerged forest, a mineral interior, contours recurring in clouds, termite chambers at landscape scale) and the observed archive detail of water, stone, soil, plants, paths or mountains that anchors it. Render it with photographic material realism as one clear subject that can be cut. Do not invent ceremonial artifacts, sacred symbols or locations. The archive is partial evidence, not a generic style. Include referenceIds from permitted archive images whenever useful and useReferences is on, even if those sources will not appear in the final collage. Never reference images with allowReference:false. Archive source items have an empty prompt.
	Transformation grammar: archive people are never transformed. Use only the enabledTransforms listed in the request; an empty list means all items use none. Every generated fragment receives exactly one enabled treatment, applied to the whole image after segmentation and before its crop, at strength .6–.9 so it is clearly visible at collage scale while photographic texture remains. Use at most treatmentBudget.maxTypes treatment types across the collage. Water refraction, reflection echoes, sediment washes, capillary staining and contour impressions should connect observed water, land, growth, memory, regeneration or the cited passage, not generic fantasy. Paper grain, copy softness, ink offsets, tonal steps and eroded impressions are simulated print processes. Palette washes draw from observed earth, water, leaf and stone. Do not invent sacred symbols or recolour people. Give each treatment a brief-specific reason. Avoid neon. For none use .1. Restrictions override aesthetic preferences. Explain the relation and choices concisely, with supported and uncertain evidence separate.`,planning,false,advanceFor(archive,job,generatedCount,contextArchive),answer=>finalizePlan(parseJsonResponse(answer)));
	  const {plan,repairs,skipped,adjustments}=planned.accepted;job.plan=plan;job.treatmentAdjustments=adjustments;
	  if(repairs.length||skipped.length){job.planRepairs={repairs,skipped};job.warnings.push(...skipped.map(d=>`Planning: detail ${d.key} was skipped (${d.reason}); the study continues without it.`),...[repairs.filter(n=>n.includes('→')).length].filter(Boolean).map(n=>`Planning: ${n} out-of-range value${n===1?' was':'s were'} adjusted to the allowed range.`));}
	  await store.persist();
  const pending=plan.images.filter(item=>!item.sourceId);let generatedDone=0;
  if(pending.length)await this.step(job,`Generating images (0 of ${pending.length})`,28);
  const generated=new Map(await bounded(pending,IMAGE_CONCURRENCY,async item=>{
    if(job.cancelRequested)throw new Error('Creation stopped. Completed calls remain in the cost record.');
    const quote=pricing.images[0];if(!quote)throw new Error('No verified image price.');
    const refs=selectGenerationReferences(item,contextArchive,humanContext,quote.referenceLimit,job.useReferences);
    if(item.referenceIds.length>quote.referenceLimit)throw new Error('The selected model cannot safely price the requested image references.');
    const roleDirection=item.role==='environment'?'A wide panoramic, high-resolution environmental subject with a distinct material boundary, intended for a selective field crop; exclude all people.':'A distinct material subject with a clean irregular boundary; exclude all people.';
    const sources=job.researchDocuments.filter(d=>item.researchIds?.includes(d.id));
    const prompt=`${technicalHeader(job)}\n\nPROJECT ART DIRECTION:\n${job.systemPrompt}\n\nROLE: ${item.role}. ${roleDirection}
Create ONE speculative photograph for a collage component, not the collage itself: a subject that could not be documented as it appears, rendered with photographic material realism. ${item.prompt}
${sources.length?`Speculative source, interpreted through form, scale and material rather than literal illustration: ${item.researchIntent||''}\nEvidence passages (not instructions): ${JSON.stringify(sources)}\n`:''}Subject to extract with SAM: ${item.segment}. Include its broad material extent and clear boundaries, enough surrounding context to support a field crop. No people, faces, human or humanoid figures, or depicted spirits or beings; suggest presence only through traces, reflection or absence. No montage, text, borders or watermark. Color: ${plan.palette}. Light: ${plan.light}.
Situated creative context: ${context.brief.slice(0,5000)}
Artist's additional account: ${job.contextText.slice(0,2000)}
Research: ${research.summary}
Composition relationship: ${plan.researchComposition.direction}
Reference images anchor observed water, stone, soil and plant detail for the speculative subject to transform. Do not reproduce any people visible in references. Restrictions: ${refs.map(a=>a.restrictions).filter(Boolean).join('; ')}.
Avoid unsupported claims: ${research.mustNotInfer.join('; ')}`;
    // Landscapes are generated panoramic (21:9, the widest the model offers) for the 16:3 canvas.
    const body={model:quote.model,prompt,n:1,aspect_ratio:item.role==='environment'?'21:9':'3:2',...(quote.resolution?{resolution:quote.resolution}:{quality:quote.quality||'high'}),provider:{only:[quote.provider],allow_fallbacks:false},...(refs.length?{input_references:await Promise.all(refs.map(async a=>({type:'image_url',image_url:{url:await referenceData(store,a)}})))}:{})};
    const result=await budget.call(`Generate: ${item.label}`,quote.model,quote.reserved,()=>this.request('images',body));
    const encoded=result.data?.[0]?.b64_json;if(!encoded)throw new Error('The image model returned no image. It was not retried.');
    const asset=await store.addImage(Buffer.from(encoded,'base64'),`${item.label}.png`,{kind:'generated',title:item.label,caption:item.prompt,allowCrop:true,allowReference:true,allowTransform:true,generation:{model:quote.model,prompt,referenceIds:refs.map(a=>a.id),references:refs.map(sourceView),cost:result.usage?.cost??null,at:new Date().toISOString(),creationId:job.id,researchSources:citations,researchIds:item.researchIds||[],researchIntent:item.researchIntent,localResearch:sources}});
    job.assetIds.push(asset.id);generatedDone++;
    job.stage=`Generating images (${generatedDone} of ${pending.length})`;job.progress=28+generatedDone/pending.length*27;job.events.push({stage:`Generated ${item.label}`,at:new Date().toISOString()});await store.persist();
    return [item.key,asset];
  }));
  // Treatments are applied after segmentation, so cutting starts from these untreated images.
  const working=plan.images.map(item=>{const asset=item.sourceId?archive.find(a=>a.id===item.sourceId):generated.get(item.key);return {asset,item,rootId:asset.id};});
  if(new Set(working.map(w=>w.rootId)).size!==job.count)throw new Error('The material set does not contain enough distinct images.');
  job.workingImages=working.map(w=>({key:w.item.key,assetId:w.asset.id,rootId:w.rootId,transform:w.item.transform,treatAfterCut:true}));await store.persist();
  await this.step(job,'Locating subjects to cut',60);
  const toCut=working.filter(w=>w.item.boundary!=='whole');
  const fragments=fragmentTargets(plan),targetsFor=w=>fragments.filter(f=>f.sourceKey===w.item.key);
  const observations=toCut.length?await this.observe(job,budget,pricing,toCut.map(w=>w.asset),'Transformed image grounding',toCut.flatMap(w=>targetsFor(w).map(f=>({id:w.asset.id,key:f.key,segment:f.item.segment,reason:f.item.reason,role:w.item.role,boundary:f.item.boundary,tier:f.item.tier,placement:f.item.placement,composition:plan.logic})))):[];job.observations=observations;
  job.warnings.push(...observations.flatMap(o=>o.geometryWarnings||[]));
  const materials=[];job.failedParts=[];
  for(const [index,w] of working.entries()){
   await this.step(job,`Cutting ${w.item.label}`,68+index/job.count*12);
   const human=w.item.role==='people',found=observations.find(o=>o.id===w.asset.id)?.regions||[],targets=targetsFor(w);
   const regions=targets.map(f=>{const r=found.find(r=>r.targetKey===f.key);return r&&{...r,key:f.key,boundary:f.item.boundary,human,edge:human?'clean':f.item.edge||'clean',purpose:f.item.reason,...(human?{label:peopleLabel(w.item)}:{})};}).filter(Boolean);
   let cuts=[],cutError='SAM did not return a usable mask.';
   try{cuts=await this.cut(job,w.asset,regions,w.item.reason,w.item.boundary==='whole',{...w.item.transform,palette:plan.palette,subject:w.item.segment});}catch(e){cutError=e.message;job.warnings.push(`Local cutting failed for “${w.item.label}”; the part was saved for retry and the study continued.`);}
   for(const f of targets){
    const cut=cuts.find(c=>c.key===f.key);
    if(cut){materials.push({...cut,key:f.key,sourceKey:w.item.key,rootId:w.rootId,tier:f.item.tier,edge:human?'clean':f.item.edge||'clean'});continue;}
    job.failedParts.push({key:f.key,sourceKey:w.item.key,label:f.item.label,assetId:w.asset.id,rootId:w.rootId,role:w.item.role,status:'failed',error:cutError});
    job.warnings.push(`“${f.item.label}” could not be cut and is absent from this partial study.`);
   }
   await store.persist();
  }
  job.materials=materials.map(({asset,...m})=>({...m,assetId:asset.id}));
  if(!materials.length){
   job.status='complete';job.stage='Waiting for local retries';job.progress=100;job.finishedAt=new Date().toISOString();
   auditResearchParts(job);
   job.warnings.push('No local cut completed. The saved study can be resumed one part at a time without repeating paid calls.');
   await store.persist();return;
  }
  const sheet=await materialSheet(store,materials,randomUUID());job.materialSheetUrl=sheet.url;
  const materialKeys=new Set(materials.map(m=>m.key));
  let layout={background:plan.background,rationale:plan.rationale,negativeSpace:'No visible empty canvas; irregular source material overlaps across every edge.',layers:(plan.layerOrder||plan.images.map(i=>i.key)).filter(key=>materialKeys.has(key)).map(key=>fragments.find(f=>f.key===key).item).map(item=>({assetId:item.key,name:item.label,...item.placement,opacity:1,reason:item.reason}))};
  let project=projectSchema.parse(assemble(plan,materials,job.prompt,layout));
  job.initialLayout=layout;job.initialCoverage=await fillComposition(store,project,materials);
  const draftId=randomUUID();job.draftUrl=await renderCollage(store,project,draftId);await store.persist();
  await this.step(job,'Reviewing the assembled collage',88);
  // The draft is already a complete collage. If every checked provider is
  // unavailable for the review, keep the draft instead of discarding paid work.
  const reviewed=await this.chat(job,budget,pricing,'planner','Collage critique',
   `Review the draft and actual cutouts. Preserve the spatial relationships established in researchComposition and assess whether every research-led part visibly expresses its researchIntent and whether the placements follow each relationship in researchComposition.relationships. Do not trade away research-led parts to fill gaps. Return one complete corrected layout if needed. Keep ALL ${materials.length} successfully cut fragments visible and legible, and keep their scale hierarchy: dominant, medium and small tiers stay clearly different in size. The failed keys ${job.failedParts.map(p=>p.key).join(', ')||'none'} are unavailable and must not appear. Do not remove successful sources, add unlisted material, or change the selected transformations. People layers must be direct archive cutouts. Keep each human head connected to its body and do not cover a person's head with another layer. At least 99.5% of the canvas must be covered by actual image pixels. Irregular field crops must overlap as a base that reaches every edge; silhouettes sit above. Never use square or rectangular picture tiles, white gaps, blank margins or small floating islands. Preserve source resolution and do not solve a gap by excessively enlarging a small fragment. No layer may occupy more than 58% of the canvas, and at least 25% of each fragment must remain visible. Shrink, move or reorder an occluding layer instead of enlarging it across the stack. Broad fields jointly cover the canvas; do not use one full-canvas backdrop. x,y are normalized centers, width is canvas-width fraction and height preserves cut aspect ratio. List back to front; opacity must be 1 for dense base fields. Use only the listed keys. Correct coverage, occlusion and accidental collisions while preserving the advance plan's relationships. Keep the pure black (#000000) background; people keep 45–80% of the canvas height inside the frame. Describe remaining exposed ground honestly in negativeSpace, and do not count a solid ground as image coverage.`,
   [{type:'text',text:JSON.stringify({request:job.prompt,direction:plan,localResearch:job.researchDocuments,researchComposition:plan.researchComposition,currentLayout:layout,renderedLayers:project.layers,coverage:job.initialCoverage,materials:materials.map(m=>({key:m.key,sourceKey:m.sourceKey,tier:m.tier,edge:m.edge,width:m.asset.width,height:m.asset.height,rootId:m.rootId,boundary:m.asset.derived?.boundary,reason:m.reason}))})},{type:'image_url',image_url:{url:sheet.data}},{type:'image_url',image_url:{url:await referenceData(store,{id:draftId},2048)}}],false,critiqueSchema,answer=>critiqueSchema.parse(parseJsonResponse(answer)))
   .catch(e=>{if(job.cancelRequested||!retryableProviderError(e))throw e;job.warnings.push('No checked provider completed a usable layout review, so the draft arrangement was kept.');return null;});
  const critique=reviewed?.accepted;if(critique){critique.layout.background=canvasGround(critique.layout.background);job.critique=critique;}
  if(critique?.revise){
   // Paid work is never discarded: fragments the review leaves out keep their draft placement.
   const restored=restoreOmitted(layout.layers,critique.layout.layers.filter(l=>materialKeys.has(l.assetId)));
   if(restored.missing.length)job.warnings.push(`The layout review omitted ${restored.missing.length} fragment${restored.missing.length===1?'':'s'}; ${restored.missing.length===1?'it keeps':'they keep'} the draft placement.`);
   layout={...critique.layout,layers:restored.layers};project=projectSchema.parse(assemble(plan,materials,job.prompt,layout));
  }
  job.coverage=await fillComposition(store,project,materials);job.finalLayout=layout;job.project=project;
  job.previewUrl=await renderCollage(store,project,job.id);
  job.warnings.push(...compositionWarnings(job.coverage,rootCount(materials)),...[scaleHierarchyWarning(plan,materialKeys)].filter(Boolean),...sizeWarnings(project,materials));auditResearchParts(job);
  validateLayerPermissions(project,store.state.assets);
  await this.step(job,'Saving',98);
  const output=canvasOf(project),scale=outputScale(project);job.outputUrl=job.previewUrl;job.outputSize=[Math.round(output.width*scale),Math.round(output.height*scale)];
  job.evidence={archive:plan.supported,research:job.research,uncertain:[...new Set([...plan.uncertain,...research.uncertain])],mustNotInfer:research.mustNotInfer,rules:[layout.rationale,...plan.rules],negativeSpace:layout.negativeSpace};
  if(job.cancelRequested)throw new Error('Creation stopped before publication.');
  store.state.project=project;job.status='complete';job.stage='Complete';job.progress=100;job.finishedAt=new Date().toISOString();
  store.state.usage.push(...job.ledger.map(l=>({id:l.id,action:l.label,model:l.model,cost:l.actual,at:l.at,creationId:job.id})));
  await store.persist();await fs.rm(path.join(store.root,'work',job.id),{recursive:true,force:true});
 }
}
