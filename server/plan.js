import {z} from 'zod';
import {validateResearchPlan,RESEARCH_RANGE,DEFAULT_RESEARCH} from './research.js';
import {referenceEligible} from './archive.js';
import {TRANSFORMS,DEFAULT_TRANSFORMS,permittedTransforms,treatmentBudget} from './transforms.js';
import {TIERS} from './fragments.js';
export const creationInput=z.object({
 prompt:z.string().trim().min(8).max(3000),ids:z.array(z.string().max(100)).max(200).default([]),
 researchCount:z.number().int().min(RESEARCH_RANGE[0]).max(RESEARCH_RANGE[1]).default(DEFAULT_RESEARCH),researchIds:z.array(z.string().max(100)).max(100).default([]),
 count:z.number().int().min(6).max(20).default(10),includeArchive:z.boolean().default(true),includePeople:z.boolean().default(true),
 useReferences:z.boolean().default(true),transformations:z.boolean().default(true),recolouring:z.boolean().default(true),
 enabledTransforms:z.array(z.enum(TRANSFORMS.filter(t=>t!=='none'))).max(TRANSFORMS.length-1).default(DEFAULT_TRANSFORMS),
 imageModel:z.enum(['economy','gpt-image']).default('economy'),
 aesthetic:z.enum(['prompt','cut-paper','continuous']).default('prompt'),generation:z.enum(['needed','always']).default('needed'),
 tornEdges:z.boolean().default(true),contextText:z.string().max(12000).default(''),systemPrompt:z.string().max(16000).optional(),requestId:z.string().uuid()
});
// Placement ranges shared by the planner's schema, saved plans and plan repair.
// Widths are fractions of the canvas width; on the 16:3 panorama a person is only ~0.05 wide.
// Final sizes are enforced by height after cutting (server/scale.js).
export const PLACEMENT={x:[0,1],y:[0,1],rotation:[-35,35],width:[.02,.6],detailWidth:[.02,.6]},VISIBLE_STRENGTH=[.5,1];
const range=([min,max])=>z.number().min(min).max(max);
// Saved plans accept every width the planner may give, including small detail cuts.
const placement=z.object({x:range(PLACEMENT.x),y:range(PLACEMENT.y),width:z.number().min(PLACEMENT.detailWidth[0]).max(1.8),rotation:range(PLACEMENT.rotation)});
// relationships maps every selected passage to the visual relationship or layout consequence it creates
// (studies before 19 Oct recorded `papers` instead). Free-form records are for reading saved plans only:
// providers receive fixed keys, because some grammar engines reject `propertyNames`.
const researchComposition=z.object({sourceIds:z.array(z.string().max(100)).min(2).max(10),direction:z.string().min(30).max(1200)});
const savedComposition=researchComposition.extend({relationships:z.record(z.string().max(100),z.string().max(400)).optional(),papers:z.record(z.string().max(100),z.string().max(400)).optional()});
const edge=z.enum(['clean','torn']);
// A detail is an extra cut from a generated image at another scale; it shares that image's treatment.
const detail=z.object({key:z.string().max(30),sourceKey:z.string().max(30),label:z.string().max(120),segment:z.string().max(300),boundary:z.enum(['silhouette','residue','field']),tier:z.enum(TIERS),edge,placement,reason:z.string().max(500)});
export const advanceSchema=z.object({researchComposition:savedComposition.optional(),layerOrder:z.array(z.string().max(30)).min(6).max(30).optional(),details:z.array(detail).max(6).optional(),title:z.string().max(160),logic:z.string().max(500),rationale:z.string().max(1200),palette:z.string().max(300),light:z.string().max(300),horizon:z.string().max(300),background:z.string().regex(/^#[0-9a-fA-F]{6}$/),supported:z.array(z.string().max(500)).max(12),uncertain:z.array(z.string().max(500)).max(10),rules:z.array(z.string().max(500)).max(8),images:z.array(z.object({
 researchIds:z.array(z.string().max(100)).max(10).optional(),researchIntent:z.string().max(600).optional(),
 key:z.string().max(30),sourceId:z.string().max(100).nullable(),label:z.string().max(120),prompt:z.string().max(1200),segment:z.string().max(300),reason:z.string().max(500),referenceIds:z.array(z.string().max(100)).max(2),
 role:z.enum(['environment','people','material']),boundary:z.enum(['silhouette','residue','field','whole']),transform:z.object({type:z.enum(TRANSFORMS),strength:z.number().min(.1).max(1),reason:z.string().max(500)}),placement,
 tier:z.enum(TIERS).optional(),edge:edge.optional()
})).min(6).max(20)});

export function advanceFor(archive,job,generatedCount,referenceArchive=archive){
 const base=advanceSchema.shape.images.element,permitted=job.useReferences?referenceArchive.filter(a=>a.allowReference&&!job.humanContextIds?.includes(a.id)&&referenceEligible(a)).map(a=>a.id):[];
 const transform=base.shape.transform,none=transform.extend({type:z.literal('none')});
 const enabled=permittedTransforms(job);
 // Every generated fragment carries one clearly visible enabled treatment.
 const visibleTransform=transform.extend({type:z.enum(enabled.length?enabled:['none']),strength:range(VISIBLE_STRENGTH)});
 // Fixed slots avoid ambiguous unions in constrained multimodal decoding. Retrieval supplies
 // the originals; the visual director still chooses every subject, treatment and placement.
 const slots={};
 for(let i=0;i<job.count;i++){
  const key=`F${String(i+1).padStart(2,'0')}`,a=i<job.count-generatedCount?archive[i]:null,generationIndex=i-(job.count-generatedCount);
  const requiredRole=a?'people':generationIndex<2?'environment':null;
  const generatedRole=z.enum(['environment','material']);
  const referencePool=permitted,assigned=job.referenceAssignments?.[key];
  const referenceIds=assigned?z.tuple(assigned.map(id=>z.literal(id))):referencePool.length?z.array(z.enum(referencePool)).min(1).max(2):z.array(z.string()).max(0);
  const boundary=requiredRole==='people'?z.enum(['silhouette','residue']):!a&&requiredRole==='environment'?z.literal('field'):z.enum(['silhouette','residue','field']);
  const plannedPlacement=placement.extend({width:range(PLACEMENT.width)});
  slots[key]=base.extend({key:z.literal(key),sourceId:a?z.literal(a.id):z.null(),tier:z.enum(TIERS),edge:a||!job.tornEdges?z.literal('clean'):edge,
   role:requiredRole?z.literal(requiredRole):generatedRole,
   prompt:a?z.literal(''):z.string().min(40).max(1200),segment:z.string().min(8).max(300),
   referenceIds:a?z.array(z.string()).max(0):referenceIds,
   transform:!a&&enabled.length?visibleTransform:none,
   boundary,placement:plannedPlacement,
   ...(job.researchDocuments?{researchIds:job.researchAssignments?.[key]?z.tuple(job.researchAssignments[key].map(id=>z.literal(id))):z.array(z.enum(job.researchDocuments.map(d=>d.id))).max(a?0:2),researchIntent:z.string().min(job.researchAssignments?.[key]?30:0).max(600)}:{})});
 }
 // Fixed detail slots, each tied to one generated image, keep extra cuts within the plan's reach.
 const plannedPlacement=placement.extend({width:range(PLACEMENT.detailWidth)});
 const details=Object.fromEntries(Object.entries(job.detailAssignments||{}).map(([key,sourceKey])=>[key,detail.extend({key:z.literal(key),sourceKey:z.literal(sourceKey),segment:z.string().min(8).max(300),edge:job.tornEdges?edge:z.literal('clean'),placement:plannedPlacement})]));
 return advanceSchema.extend({...(Object.keys(details).length?{details:z.object(details)}:{}),researchComposition:job.researchDocuments?researchComposition.extend({sourceIds:z.tuple(job.researchDocuments.map(d=>z.literal(d.id))),relationships:z.object(Object.fromEntries(job.researchDocuments.map(d=>[d.id,z.string().min(30).max(400)])))}):researchComposition.optional(),layerOrder:z.array(z.enum([...Object.keys(slots),...Object.keys(details)])).length(job.count+Object.keys(details).length),images:z.object(slots)});
}

// A paid plan is repaired rather than discarded where that is safe: numbers just outside a
// placement or treatment range are clamped, a detail cut that is still invalid is skipped
// (details are optional extras), and the layer order is completed. Every change is reported.
export function repairPlan(raw,schema){
 const notes=[],skipped=[];
 const clamp=(object,key,[min,max],where)=>{const value=object?.[key];if(typeof value==='number'&&Number.isFinite(value)&&(value<min||value>max)){object[key]=Math.min(max,Math.max(min,value));notes.push(`${where}.${key} ${value} → ${object[key]}`);}};
 const place=(item,where,width)=>{for(const key of ['x','y','rotation'])clamp(item?.placement,key,PLACEMENT[key],`${where}.placement`);clamp(item?.placement,'width',width,`${where}.placement`);};
 for(const [key,item] of Object.entries(raw.images||{})){place(item,key,PLACEMENT.width);if(item?.transform?.type&&item.transform.type!=='none')clamp(item.transform,'strength',VISIBLE_STRENGTH,`${key}.transform`);}
 const slots=schema.shape.details?.shape||{};
 for(const [key,item] of Object.entries(raw.details||{})){
  place(item,key,PLACEMENT.detailWidth);
  const check=slots[key]?.safeParse(item);
  if(!check?.success){delete raw.details[key];skipped.push({key,reason:check?check.error.issues.slice(0,2).map(i=>`${i.path.join('.')} ${i.message}`).join('; '):'not a planned detail slot'});}
 }
 if(raw.details&&!Object.keys(raw.details).length)delete raw.details;
 const keys=[...Object.keys(raw.images||{}),...Object.keys(raw.details||{})],order=[...new Set((Array.isArray(raw.layerOrder)?raw.layerOrder:[]).filter(key=>keys.includes(key)))];
 if(order.length!==(raw.layerOrder||[]).length||order.length!==keys.length)notes.push('layerOrder completed with every remaining fragment');
 raw.layerOrder=[...order,...keys.filter(key=>!order.includes(key))];
 return {raw,notes,skipped};
}

export function validateAdvance(plan,archive,job,generatedCount,referenceArchive=archive){
 validateResearchPlan(plan,job);
 if(plan.images.length!==job.count)throw new Error(`The plan must contain exactly ${job.count} distinct images.`);
 const ids=new Set(),keys=new Set();let generated=0;
 for(const item of plan.images){
  if(keys.has(item.key))throw new Error('Duplicate plan key.');keys.add(item.key);
  const source=item.sourceId&&archive.find(a=>a.id===item.sourceId);
  if(item.sourceId){
   if(!job.includeArchive)throw new Error('The plan includes archive pixels while archive inclusion is off.');
   if(!source||ids.has(source.id))throw new Error('Unknown or repeated source image. Each image must be distinct.');ids.add(source.id);
   if(item.role!=='people'||(source.archive?source.archive.category!=='people':!job.humanContextIds?.includes(source.id)))throw new Error('Only archive people may supply direct collage pixels.');
   if(item.role==='people'&&(!job.includePeople||item.transform.type!=='none'||!['silhouette','residue'].includes(item.boundary)))throw new Error('People require untransformed archive cutouts and people inclusion enabled.');
   if(!source.allowCrop&&item.boundary!=='whole')throw new Error('The plan violates a no-crop permission.');
   if(!source.allowTransform&&item.transform.type!=='none')throw new Error('The plan violates a transformation permission.');
  } else {if(item.role==='people')throw new Error('People must be cropped from archive photographs, never generated.');generated++;if(!item.prompt.trim()||item.boundary==='whole')throw new Error('Generated material needs a prompt and a SAM extraction.');}
  if(item.boundary==='whole')throw new Error('Whole rectangular images are not permitted in automatic collages.');
  if(!job.transformations&&item.transform.type!=='none')throw new Error('Transformations are switched off.');
  if(item.transform.type!=='none'&&!permittedTransforms(job).includes(item.transform.type))throw new Error('The plan uses a disabled transformation.');
  if(!job.recolouring&&item.transform.type==='recolour')throw new Error('Recolouring is switched off.');
  if(job.referenceAssignments?.[item.key]&&JSON.stringify(item.referenceIds)!==JSON.stringify(job.referenceAssignments[item.key]))throw new Error('The plan changed the required Chikukwa and water reference pair.');
  for(const id of item.referenceIds)if(!job.useReferences||job.humanContextIds?.includes(id)||!referenceArchive.some(a=>a.id===id&&a.allowReference&&referenceEligible(a)))throw new Error('The plan uses an unpermitted image-generation reference.');
 }
 for(const item of plan.details||[]){
  const source=plan.images.find(i=>i.key===item.sourceKey);
  if(keys.has(item.key)||!source||source.sourceId)throw new Error('Each detail cut must come from one generated image.');keys.add(item.key);
 }
 if(plan.layerOrder&&(new Set(plan.layerOrder).size!==keys.size||plan.layerOrder.some(key=>!keys.has(key))))throw new Error('Layer order must contain each fragment key exactly once.');
 if(generated!==generatedCount)throw new Error('The plan changed the preflighted number of generated images. No image calls were made.');
 if(!job.includePeople&&plan.images.some(i=>!i.sourceId&&i.role==='people'))throw new Error('The plan includes people while people inclusion is switched off.');
 if(job.requiresGeneratedEnvironment&&!plan.images.some(i=>!i.sourceId&&i.role==='environment'))throw new Error('The plan omitted the required high-resolution environmental field.');
 const treated=plan.images.filter(i=>i.transform.type!=='none'),budget=treatmentBudget(generatedCount);
 if(treated.length>budget.maxImages||new Set(treated.map(i=>i.transform.type)).size>budget.maxTypes)throw new Error('The plan exceeds the treatment budget.');
 if(plan.images.filter(i=>['silhouette','residue'].includes(i.boundary)).length<2)throw new Error('The plan needs visible SAM silhouettes, not only rectangular fields.');
 return plan;
}
