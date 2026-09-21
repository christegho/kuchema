import {z} from 'zod';
import {TRANSFORMS} from './transforms.js';
export const creationInput=z.object({
 prompt:z.string().trim().min(8).max(3000),ids:z.array(z.string().max(100)).max(200).default([]),
 count:z.number().int().min(6).max(20).default(6),includeArchive:z.boolean().default(true),
 useReferences:z.boolean().default(true),transformations:z.boolean().default(true),recolouring:z.boolean().default(true),
 imageModel:z.enum(['economy','gpt-image']).default('economy'),
 aesthetic:z.enum(['prompt','cut-paper','continuous']).default('prompt'),generation:z.enum(['needed','always']).default('needed'),
 contextText:z.string().max(12000).default(''),systemPrompt:z.string().max(16000).optional(),requestId:z.string().uuid()
});
const placement=z.object({x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().min(.1).max(1.8),rotation:z.number().min(-35).max(35)});
export const advanceSchema=z.object({layerOrder:z.array(z.string().max(30)).min(6).max(20).optional(),title:z.string().max(160),logic:z.string().max(500),rationale:z.string().max(1200),palette:z.string().max(300),light:z.string().max(300),horizon:z.string().max(300),background:z.string().regex(/^#[0-9a-fA-F]{6}$/),supported:z.array(z.string().max(500)).max(12),uncertain:z.array(z.string().max(500)).max(10),rules:z.array(z.string().max(500)).max(8),images:z.array(z.object({
 key:z.string().max(30),sourceId:z.string().max(100).nullable(),label:z.string().max(120),prompt:z.string().max(1200),segment:z.string().max(300),reason:z.string().max(500),referenceIds:z.array(z.string().max(100)).max(2),
 role:z.enum(['environment','people','material']),boundary:z.enum(['silhouette','residue','field','whole']),transform:z.object({type:z.enum(TRANSFORMS),strength:z.number().min(.1).max(1),reason:z.string().max(500)}),placement
})).min(6).max(20)});

export function advanceFor(archive,job,generatedCount,referenceArchive=archive){
 const base=advanceSchema.shape.images.element,permitted=job.useReferences?referenceArchive.filter(a=>a.allowReference).map(a=>a.id):[];
 const referenceIds=permitted.length?z.array(z.enum(permitted)).min(1).max(2):z.array(z.string()).max(0);
 const transform=base.shape.transform,none=transform.extend({type:z.literal('none')});
 const permittedTransforms=TRANSFORMS.filter(type=>job.recolouring||type!=='recolour');
 const permittedTransform=transform.extend({type:z.enum(permittedTransforms)});
 // Fixed slots avoid ambiguous unions in constrained multimodal decoding. Retrieval supplies
 // the originals; the visual director still chooses every subject, treatment and placement.
 const slots={};
 for(let i=0;i<job.count;i++){
  const key=`F${String(i+1).padStart(2,'0')}`,a=i<job.count-generatedCount?archive[i]:null,generationIndex=i-(job.count-generatedCount);
  const requiredRole=a?'environment':job.requiresGeneratedEnvironment&&generationIndex===0?'environment':job.requiresGeneratedPeople&&generationIndex===(job.requiresGeneratedEnvironment?1:0)?'people':null;
  const requiredWaterTransform=!a&&job.requiresWaterTransformation&&generationIndex===0;
  const boundary=requiredRole==='people'?z.enum(['silhouette','residue']):!a&&requiredRole==='environment'?z.literal('field'):z.enum(['silhouette','residue','field']);
  const plannedPlacement=!a&&requiredRole==='environment'?placement.extend({width:z.number().min(.9).max(1.4)}):placement;
  slots[key]=base.extend({key:z.literal(key),sourceId:a?z.literal(a.id):z.null(),
   role:requiredRole?z.literal(requiredRole):z.enum(['environment','people','material']),
   prompt:a?z.literal(''):z.string().min(40).max(1200),segment:z.string().min(8).max(300),
   referenceIds:a?z.array(z.string()).max(0):referenceIds,
   transform:job.transformations&&(!a||a.allowTransform)?(requiredWaterTransform?permittedTransform.extend({type:z.literal('water-flow')}):!a&&i===job.count-generatedCount?permittedTransform.extend({type:z.enum(permittedTransforms.filter(t=>t!=='none'))}):permittedTransform):none,
   boundary,placement:plannedPlacement});
 }
 return advanceSchema.extend({layerOrder:z.array(z.enum(Object.keys(slots))).length(job.count),images:z.object(slots)});
}

export function validateAdvance(plan,archive,job,generatedCount,referenceArchive=archive){
 if(plan.images.length!==job.count)throw new Error(`The plan must contain exactly ${job.count} distinct images.`);
 const ids=new Set(),keys=new Set();let generated=0;
 for(const item of plan.images){
  if(keys.has(item.key))throw new Error('Duplicate plan key.');keys.add(item.key);
  const source=item.sourceId&&archive.find(a=>a.id===item.sourceId);
  if(item.sourceId){
   if(!job.includeArchive)throw new Error('The plan includes archive pixels while archive inclusion is off.');
   if(!source||ids.has(source.id))throw new Error('Unknown or repeated source image. Each image must be distinct.');ids.add(source.id);
   if(item.role!=='environment')throw new Error('Archive pixels are reserved for environmental material.');
   if(!source.allowCrop&&item.boundary!=='whole')throw new Error('The plan violates a no-crop permission.');
   if(!source.allowTransform&&item.transform.type!=='none')throw new Error('The plan violates a transformation permission.');
  } else {generated++;if(!item.prompt.trim()||item.boundary==='whole')throw new Error('Generated material needs a prompt and a SAM extraction.');}
  if(item.boundary==='whole')throw new Error('Whole rectangular images are not permitted in automatic collages.');
  if(!job.transformations&&item.transform.type!=='none')throw new Error('Transformations are switched off.');
  if(!job.recolouring&&item.transform.type==='recolour')throw new Error('Recolouring is switched off.');
  for(const id of item.referenceIds)if(!job.useReferences||!referenceArchive.some(a=>a.id===id&&a.allowReference))throw new Error('The plan uses an unpermitted image-generation reference.');
 }
 if(plan.layerOrder&&(new Set(plan.layerOrder).size!==job.count||plan.layerOrder.some(key=>!keys.has(key))))throw new Error('Layer order must contain each image key exactly once.');
 if(generated!==generatedCount)throw new Error('The plan changed the preflighted number of generated images. No image calls were made.');
 if(job.requiresGeneratedPeople&&!plan.images.some(i=>!i.sourceId&&i.role==='people'))throw new Error('The plan omitted the required generated people.');
 if(job.requiresGeneratedEnvironment&&!plan.images.some(i=>!i.sourceId&&i.role==='environment'))throw new Error('The plan omitted the required high-resolution environmental field.');
 if(job.requiresWaterTransformation&&!plan.images.some(i=>!i.sourceId&&i.role==='environment'&&i.transform.type==='water-flow'))throw new Error('The plan omitted the required water-flow transformation.');
 if(job.transformations&&plan.images.some(i=>!i.sourceId||archive.find(a=>a.id===i.sourceId)?.allowTransform)&&!plan.images.some(i=>i.transform.type!=='none'))throw new Error('The plan omitted the requested pre-crop transformation.');
 if(plan.images.filter(i=>['silhouette','residue'].includes(i.boundary)).length<2)throw new Error('The plan needs visible SAM silhouettes, not only rectangular fields.');
 return plan;
}
