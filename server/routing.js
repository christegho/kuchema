import {randomInt} from 'node:crypto';
import {TOKEN_PRICE_LIMIT,compareProviderHealth} from './budget.js';
import {retryableProviderError} from './ai.js';
import {providerImageLimit,requestImageCount} from './provider-limits.js';

export async function routedTextCall({job,budget,quote,label,body,request,persist,unavailable=new Set()}){
  const imageCount=requestImageCount(body);
  if(!quote.candidates?.length){
    // Retain compatibility with saved quotes/test adapters from before provider pools.
    if(imageCount>providerImageLimit(body.model,quote.provider))throw new Error(`The quoted provider cannot accept ${imageCount} input images. No request was sent.`);
    const provider={max_price:TOKEN_PRICE_LIMIT,allow_fallbacks:false,require_parameters:true,...(quote.provider?{only:[quote.provider]}:{})};
    return budget.call(label,body.model,quote.bound,()=>request('chat/completions',{...body,provider}));
  }
  const candidates=quote.candidates.filter(candidate=>imageCount<=providerImageLimit(body.model,candidate.provider));
  if(!candidates.length)throw new Error(`No checked provider supports this step's ${imageCount} input images. No request was sent.`);
  // Balance equal-health endpoints rather than pinning every new study to catalogue order.
  for(let i=candidates.length-1;i>0;i--){const j=randomInt(i+1);[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
  candidates.sort((a,b)=>Number(unavailable.has(a.provider))-Number(unavailable.has(b.provider))||compareProviderHealth(a,b));
  let lastError;
  for(const [index,candidate] of candidates.entries()){
    if(job.cancelRequested)throw new Error('Creation stopped.');
    const provider={only:[candidate.provider],allow_fallbacks:false,require_parameters:true,max_price:{...candidate.maxPrice,request:0,image:0}};
    const attempt={step:label,model:body.model,provider:candidate.provider,status:'running',at:new Date().toISOString()};
    job.providerAttempts||=[];job.providerAttempts.push(attempt);
    try{
      const result=await budget.call(`${label} · ${candidate.name||candidate.provider}`,body.model,candidate.bound,()=>request('chat/completions',{...body,provider}));
      attempt.status='complete';attempt.actualProvider=result.provider||candidate.provider;
      if(index>0){job.warnings||=[];job.warnings.push(`${label} continued with ${attempt.actualProvider} after another provider failed.`);}
      await persist();return result;
    }catch(error){
      attempt.status='failed';attempt.error=error.message;attempt.code=error.code||error.status;attempt.httpStatus=error.status;
      lastError=error;await persist();
      if(!retryableProviderError(error,imageCount))throw error;
      unavailable.add(candidate.provider);
      if(index<candidates.length-1){
        job.events||=[];job.events.push({stage:`${label}: switching provider after an upstream failure or image limit`,at:new Date().toISOString()});
        job.stage=`${label}: trying another provider`;await persist();
      }
    }
  }
  throw lastError;
}
