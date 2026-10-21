import { randomUUID } from 'node:crypto';
import {archiveCounts} from './archive.js';
import {providerImageLimit} from './provider-limits.js';
import {detailCount} from './fragments.js';

// Spending ceiling per creation in USD. Set CREATION_COST_LIMIT in .env to change it.
export const MAX_COST=(limit=>Number.isFinite(limit)&&limit>0?limit:5)(Number(process.env.CREATION_COST_LIMIT));
export const COST_LIMIT_TEXT=`$${MAX_COST.toFixed(2)}`;
export const TOKEN_PRICE_LIMIT = { prompt: .3, completion: 2 }; // Legacy quote defaults, USD / million tokens
export const TEXT_MODELS = { research:'qwen/qwen3-30b-a3b-instruct-2507', vision:'qwen/qwen3-vl-235b-a22b-instruct', planner:'qwen/qwen3-vl-235b-a22b-instruct' };
export const IMAGE_MODELS = {economy:'bytedance-seed/seedream-4.5','gpt-image':'openai/gpt-image-2.5-sunburst'};
const round = n => Math.ceil(n * 1e8) / 1e8;

export class Budget {
  constructor(job,persist){this.job=job;this.persist=persist;job.ledger ||= [];}
  get committed(){return this.job.ledger.reduce((s,l)=>s+l.reserved,0);}
  get reported(){return this.job.ledger.reduce((s,l)=>s+(l.actual??0),0);}
  async reserve(label,model,amount){
    if(!Number.isFinite(amount)||amount<=0)throw new Error('No trustworthy price bound is available. Creation stopped before charging.');
    if(round(this.committed+amount)>MAX_COST)throw new Error(`The next step would exceed the ${COST_LIMIT_TEXT} creation ceiling. No request was sent.`);
    const row={id:randomUUID(),label,model,reserved:round(amount),actual:null,status:'reserved',at:new Date().toISOString()};
    this.job.ledger.push(row);await this.persist();return row;
  }
  async settle(row,result){
    const cost=result?.usage?.cost;
    if(typeof result?.provider==='string')row.provider=result.provider;
    row.actual=typeof cost==='number'&&Number.isFinite(cost)&&cost>=0?cost:null;
    row.status=row.actual===null?'unreported':'complete';
    await this.persist();
    if(row.actual!==null&&row.actual>row.reserved+1e-6)throw new Error('The provider reported a cost above its reserved bound. All further paid work has stopped.');
  }
  async call(label,model,amount,fn){
    const row=await this.reserve(label,model,amount);
    try{const result=await fn();await this.settle(row,result);return result;}
    catch(e){if(row.status==='reserved')row.status='uncertain';await this.persist();throw e;}
  }
}

export function textBound(model,maxTokens,search=false,limits=TOKEN_PRICE_LIMIT){
  if(!Number.isInteger(model?.context_length)||model.context_length<1||model.context_length>262144)throw new Error('Text-model context limit cannot be bounded within this budget.');
  if(!Number.isFinite(limits.prompt)||!Number.isFinite(limits.completion)||limits.prompt<0||limits.completion<0)throw new Error('Invalid token price bounds.');
  return round((model.context_length*limits.prompt+maxTokens*limits.completion)/1e6+(search?.01:0));
}

export function imageQuote(record,model){
  const endpoint=record?.endpoints?.find(e=>e.provider_tag);
  if(!endpoint)throw new Error(`No pinned provider available for ${model}.`);
  const lines=endpoint.pricing||[], outputs=lines.filter(p=>p.billable==='output_image');
  if(!outputs.length||outputs.some(p=>p.unit!=='image'||!Number.isFinite(p.cost_usd)))throw new Error(`${model} uses variable image-token pricing without an enforceable per-image maximum. It cannot run under the strict cost cap. Choose Seedream; no paid calls were made.`);
  const premium=model.startsWith('openai/'), params=endpoint.supported_parameters||{};
  if(!premium&&!params.resolution?.values?.includes('2K'))throw new Error(`${model} no longer offers 2K output.`);
  const selected=outputs.filter(p=>p.variant?.toLowerCase()===(premium?'high':'2k'));
  const base=Math.max(...(selected.length?selected:outputs).map(p=>p.cost_usd));
  const inputs=lines.filter(p=>p.billable!=='output_image');
  // Unknown billable inputs are not silently ignored. Only explicitly free references are usable.
  if(inputs.some(p=>!['input_image','input_reference'].includes(p.billable)))throw new Error('Unbounded image input pricing. No paid calls were made.');
  const freeReferences=inputs.length>0&&inputs.every(p=>p.unit==='image'&&p.cost_usd===0);
  if(base<=0||base>MAX_COST)throw new Error(`${model} exceeds the creation ceiling.`);
  return {model,provider:endpoint.provider_tag,...(premium?{quality:'high'}:{resolution:'2K'}),base,reserved:round(base*1.2),referenceLimit:freeReferences?Math.min(2,params.input_references?.max||0):0};
}

// Quoted per-token prices include a margin, enforced again in every request.
// Reserve every possible provider attempt: even a failed/uncertain attempt stays charged
// against the local ceiling, so failover cannot consume the budget of later steps.
const tokenPrice=value=>value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
function textCandidate(endpoint,maxTokens,search){
  const pricing=endpoint.pricing||{},prompt=tokenPrice(pricing.prompt),completion=tokenPrice(pricing.completion);
  if(prompt===null||completion===null)return null;
  // Reject unbounded ancillary charges. Cache rates are covered by the input ceiling.
  const known=new Set(['prompt','completion','input_cache_read','input_cache_write','discount']);
  if(Object.entries(pricing).some(([key,value])=>!known.has(key)&&(tokenPrice(value)===null||Number(value)!==0)))return null;
  const cacheRates=['input_cache_read','input_cache_write'].filter(key=>pricing[key]!==undefined).map(key=>tokenPrice(pricing[key]));
  if(cacheRates.some(rate=>rate===null))return null;
  const maxPrice={prompt:round(Math.max(prompt,...cacheRates)*1e6*1.2),completion:round(completion*1e6*1.2)};
  const bound=Math.max(1e-8,textBound(endpoint,maxTokens,search,maxPrice));
  return {provider:endpoint.tag,name:endpoint.provider_name||endpoint.tag,maxPrice,bound,contextLength:endpoint.context_length,
    uptime:Number.isFinite(endpoint.uptime_last_30m)?endpoint.uptime_last_30m:null,
    throughput:Number.isFinite(endpoint.throughput_last_30m)?endpoint.throughput_last_30m:null,
    latency:Number.isFinite(endpoint.latency_last_30m)?endpoint.latency_last_30m:null};
}
export function compareProviderHealth(a,b){
  return (b.uptime??-1)-(a.uptime??-1)||(b.throughput??-1)-(a.throughput??-1)||(a.latency??Infinity)-(b.latency??Infinity)||0;
}

export async function pricingPlan(options,fetcher=fetch){
  const {generatedCount=0,count=10,imageModel='economy'}=options;
  const counts=archiveCounts(count),imageCounts=options.imageCounts||{research:0,vision:count,planner:counts.general+counts.water+counts.composition+counts.people};
  const get=async url=>{const r=await fetcher(url,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('Cannot verify current model prices. No paid work was started.');return r.json();};
  const catalog=await get('https://openrouter.ai/api/v1/models');
  const text={},endpoints=new Map(),candidates={};
  for(const [role,id] of Object.entries(TEXT_MODELS)){
    if(!catalog.data.some(m=>m.id===id))throw new Error(`Required model ${id} is unavailable.`);
    // Plans grow with every slot: about 500–700 output tokens each plus shared fields
    // (a 12-image plan used ~6,200; a 10-image plan overran 5,000). Keep ~1.7× headroom
    // within the 16,384 tokens every planner endpoint accepts.
    // Detail cuts add a smaller slot each and one more region to locate.
    const details=detailCount(count),maxTokens=role==='research'?2000:role==='vision'?Math.min(8000,2500+250*(count+details)):Math.min(16000,2000+900*count+300*details);
    if(!endpoints.has(id))endpoints.set(id,await get(`https://openrouter.ai/api/v1/models/${id}/endpoints`));
    const eligible=(endpoints.get(id)?.data?.endpoints||[]).filter(e=>e.tag&&(e.status===undefined||e.status===0)&&Number.isInteger(e.context_length)&&e.context_length>0&&e.context_length<=262144&&e.supported_parameters?.includes('response_format')&&(role==='research'||e.supported_parameters?.includes('structured_outputs'))&&(!e.max_completion_tokens||e.max_completion_tokens>=maxTokens));
    const imageCount=imageCounts[role]??0;
    if(!Number.isSafeInteger(imageCount)||imageCount<0)throw new Error('Invalid input image count for provider selection.');
    candidates[role]=[...new Map(eligible.filter(e=>imageCount<=providerImageLimit(id,e.tag)).map(e=>textCandidate(e,maxTokens,role==='research')).filter(Boolean).map(e=>[e.provider,e])).values()];
    if(!candidates[role].length)throw new Error(`No bounded structured-output provider available for ${id} with ${imageCount} input images. No paid calls were made.`);
    // First establish a feasible full workflow; spend spare capacity on alternatives below.
    candidates[role].sort((a,b)=>a.bound-b.bound||compareProviderHealth(a,b));
    text[role]={id,maxTokens,imageCount,candidates:[candidates[role][0]],bound:candidates[role][0].bound};
  }
  const images=[];
  if(generatedCount||imageModel==='gpt-image'){
    const id=IMAGE_MODELS[imageModel];if(!id)throw new Error('Unknown image model.');
    images.push(imageQuote(await get(`https://openrouter.ai/api/v1/images/models/${id}/endpoints`),id));
  }
  const weights={research:1,vision:1,planner:2};
  let total=round(Object.entries(text).reduce((sum,[role,q])=>sum+q.bound*weights[role],0)+generatedCount*(images[0]?.reserved||0));
  if(total>MAX_COST)throw new Error(`${count} distinct images require ${generatedCount} new images and a $${total.toFixed(3)} reservation. The limit is ${COST_LIMIT_TEXT}. Include more archive images or reduce the count. No paid calls were made.`);
  // Give each stage an alternative before adding a third. Prefer health/performance,
  // not lowest price, when choosing the extra providers that fit the remaining budget.
  for(let roundIndex=0;roundIndex<2;roundIndex++)for(const role of Object.keys(text)){
    const q=text[role],remaining=candidates[role].filter(c=>!q.candidates.some(chosen=>chosen.provider===c.provider)).sort(compareProviderHealth);
    const next=remaining.find(c=>round(total+c.bound*weights[role])<=MAX_COST);
    if(next){q.candidates.push(next);q.bound=round(q.bound+next.bound);total=round(total+next.bound*weights[role]);}
  }
  for(const q of Object.values(text))q.candidates.sort(compareProviderHealth);
  return {text,images,total,count,generatedCount,routing:'health-first-bounded-failover',checkedAt:new Date().toISOString()};
}
