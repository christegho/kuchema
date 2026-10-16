import {z} from 'zod';
import {validateResearchPlan,isPaper,RESEARCH_RANGE} from './research.js';
import {TRANSFORMS,DEFAULT_TRANSFORMS,permittedTransforms,treatmentBudget} from './transforms.js';
export const creationInput=z.object({
 prompt:z.string().trim().min(8).max(3000),ids:z.array(z.string().max(100)).max(200).default([]),
 researchCount:z.number().int().min(RESEARCH_RANGE[0]).max(RESEARCH_RANGE[1]).default(RESEARCH_RANGE[0]),researchIds:z.array(z.string().max(100)).max(100).default([]),
 count:z.number().int().min(6).max(20).default(10),includeArchive:z.boolean().default(true),includePeople:z.boolean().default(true),
 useReferences:z.boolean().default(true),transformations:z.boolean().default(true),recolouring:z.boolean().default(true),
 enabledTransforms:z.array(z.enum(TRANSFORMS.filter(t=>t!=='none'))).max(TRANSFORMS.length-1).default(DEFAULT_TRANSFORMS),
 imageModel:z.enum(['economy','gpt-image']).default('economy'),
 aesthetic:z.enum(['prompt','cut-paper','continuous']).default('prompt'),generation:z.enum(['needed','always']).default('needed'),
 contextText:z.string().max(12000).default(''),systemPrompt:z.string().max(16000).optional(),requestId:z.string().uuid()
});
const placement=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().min(.1).max(1.8),rotation:z.number().min(-35).max(35)});
// papers maps each selected research paper to its concrete consequence for the layout.
const researchComposition=z.object({sourceIds:z.array(z.string().max(100)).min(2).max(10),direction:z.string().min(30).max(1200),papers:z.record(z.string().max(100),z.string().max(400)).optional()});
export const advanceSchema=z.object({researchComposition:researchComposition.optional(),layerOrder:z.array(z.string().max(30)).min(6).max(20).optional(),title:z.string().max(160),logic:z.string().max(500),rationale:z.string().max(1200),palette:z.string().max(300),light:z.string().max(300),horizon:z.string().max(300),background:z.string().regex(/^#[0-9a-fA-F]{6}$/),supported:z.array(z.string().max(500)).max(12),uncertain:z.array(z.string().max(500)).max(10),rules:z.array(z.string().max(500)).max(8),images:z.array(z.object({
 researchIds:z.array(z.string().max(100)).max(10).optional(),researchIntent:z.string().max(600).optional(),
 key:z.string().max(30),sourceId:z.string().max(100).nullable(),label:z.string().max(120),prompt:z.string().max(1200),segment:z.string().max(300),reason:z.string().max(500),referenceIds:z.array(z.string().max(100)).max(2),
 role:z.enum(['environment','people','material']),boundary:z.enum(['silhouette','residue','field','whole']),transform:z.object({type:z.enum(TRANSFORMS),strength:z.number().min(.1).max(1),reason:z.string().max(500)}),placement
})).min(6).max(20)});

export function advanceFor(archive,job,generatedCount,referenceArchive=archive){
 const base=advanceSchema.shape.images.element,permitted=job.useReferences?referenceArchive.filter(a=>a.allowReference&&!job.humanContextIds?.includes(a.id)&&!['people','composition'].includes(a.archive?.category)).map(a=>a.id):[];
 const transform=base.shape.transform,none=transform.extend({type:z.literal('none')});
 const enabled=permittedTransforms(job);
 // Every generated fragment carries one clearly visible enabled treatment.
 const visibleTransform=transform.extend({type:z.enum(enabled.length?enabled:['none']),strength:z.number().min(.5).max(1)});
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
  const plannedPlacement=placement.extend({width:z.number().min(.1).max(.9)});
  slots[key]=base.extend({key:z.literal(key),sourceId:a?z.literal(a.id):z.null(),
   role:requiredRole?z.literal(requiredRole):generatedRole,
   prompt:a?z.literal(''):z.string().min(40).max(1200),segment:z.string().min(8).max(300),
   referenceIds:a?z.array(z.string()).max(0):referenceIds,
   transform:!a&&enabled.length?visibleTransform:none,
   boundary,placement:plannedPlacement,
   ...(job.researchDocuments?{researchIds:job.researchAssignments?.[key]?z.tuple(job.researchAssignments[key].map(id=>z.literal(id))):z.array(z.enum(job.researchDocuments.map(d=>d.id))).max(a?0:2),researchIntent:z.string().min(job.researchAssignments?.[key]?30:0).max(600)}:{})});
 }
 const papers=job.researchDocuments?.filter(isPaper)||[];
 return advanceSchema.extend({...(job.researchDocuments?{researchComposition:researchComposition.extend({sourceIds:z.tuple(job.researchDocuments.map(d=>z.literal(d.id))),...(papers.length?{papers:z.object(Object.fromEntries(papers.map(d=>[d.id,z.string().min(30).max(400)])))}:{})})}:{}),layerOrder:z.array(z.enum(Object.keys(slots))).length(job.count),images:z.object(slots)});
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
  for(const id of item.referenceIds)if(!job.useReferences||job.humanContextIds?.includes(id)||!referenceArchive.some(a=>a.id===id&&a.allowReference&&!['people','composition'].includes(a.archive?.category)))throw new Error('The plan uses an unpermitted image-generation reference.');
 }
 if(plan.layerOrder&&(new Set(plan.layerOrder).size!==job.count||plan.layerOrder.some(key=>!keys.has(key))))throw new Error('Layer order must contain each image key exactly once.');
 if(generated!==generatedCount)throw new Error('The plan changed the preflighted number of generated images. No image calls were made.');
 if(!job.includePeople&&plan.images.some(i=>!i.sourceId&&i.role==='people'))throw new Error('The plan includes people while people inclusion is switched off.');
 if(job.requiresGeneratedEnvironment&&!plan.images.some(i=>!i.sourceId&&i.role==='environment'))throw new Error('The plan omitted the required high-resolution environmental field.');
 const treated=plan.images.filter(i=>i.transform.type!=='none'),budget=treatmentBudget(generatedCount);
 if(treated.length>budget.maxImages||new Set(treated.map(i=>i.transform.type)).size>budget.maxTypes)throw new Error('The plan exceeds the restrained transformation budget.');
 if(plan.images.filter(i=>['silhouette','residue'].includes(i.boundary)).length<2)throw new Error('The plan needs visible SAM silhouettes, not only rectangular fields.');
 return plan;
}
