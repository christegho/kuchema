import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import {reportedImageLimit} from './provider-limits.js';

export const imageModels = [
  {id:'bytedance-seed/seedream-4.5',name:'Seedream 4.5',label:'Reference-aware material',estimate:'Live price checked',refs:2,resolution:'2K'},
  {id:'openai/gpt-image-2.5-sunburst',name:'GPT Image 2.5 Sunburst',label:'Premium · subject to the $1.00 cap',estimate:'Variable pricing — blocked until a safe maximum is available',refs:2,resolution:null},
];

export class RouterError extends Error {
  constructor(message,{status,code,provider,maxInputImages=reportedImageLimit(message)}={}){super(message);this.name='RouterError';this.status=status;this.code=code;this.provider=provider;this.maxInputImages=maxInputImages;}
}
export function retryableProviderError(error,imageCount=0){
  if(error instanceof RouterError)return (error.code==='UNREADABLE_RESPONSE'&&error.status>=200&&error.status<300)||[404,408,429,500,502,503,504].includes(error.code)||[408,429,500,502,503,504].includes(error.status)||([400,422].includes(error.code)&&Number.isSafeInteger(error.maxInputImages)&&error.maxInputImages>=0&&imageCount>error.maxInputImages);
  return ['TimeoutError','AbortError'].includes(error?.name)||['ECONNRESET','ECONNREFUSED','ENOTFOUND','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(error?.cause?.code);
}

export async function routerRequest(endpoint, body) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('Add OPENROUTER_API_KEY to .env and restart the studio to use AI.');
  const response = await fetch(`https://openrouter.ai/api/v1/${endpoint}`, {
    method: 'POST', signal: AbortSignal.timeout(180000),
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json', 'X-Title': 'Situated Studio' },
    body: JSON.stringify(body),
  });
  const provider=body.provider?.only?.[0];
  // A successful HTTP status does not guarantee a readable API response. Keep
  // this separate from JSON written by the model inside message.content.
  // Never include the raw response body (possibly HTML or private content).
  const unreadable=()=>new RouterError(`OpenRouter returned an unreadable response${provider?` from ${provider}`:''} (HTTP ${response.status}).`,{status:response.status,code:response.ok?'UNREADABLE_RESPONSE':response.status,provider});
  let result;
  try{result=await response.json();}
  catch{throw unreadable();}
  if(!result||typeof result!=='object'||Array.isArray(result))throw unreadable();
  if (!response.ok || result.error) {
    const detail=result.error?.metadata;
    const message = String((result.error?.message || `OpenRouter returned ${response.status}`)+(detail?.provider_name?` (${detail.provider_name})`:'')+(typeof detail?.raw==='string'?`: ${detail.raw}`:'')).replace(/sk-[\w-]+/g, '[redacted]');
    throw new RouterError(message.slice(0, 500),{status:response.status,code:Number(result.error?.code)||response.status,provider:detail?.provider_name,maxInputImages:reportedImageLimit(message)});
  }
  return result;
}

export async function referenceData(store, asset) {
  const b = await sharp(await fs.readFile(path.join(store.root, 'media', `${asset.id}.png`)))
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 92 }).toBuffer();
  return `data:image/jpeg;base64,${b.toString('base64')}`;
}

export function parseJsonResponse(result) {
  const content = result.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('The planning model did not return a text response. Try again.');
  try { return JSON.parse(content.replace(/^\s*```(?:json)?\s*/, '').replace(/\s*```\s*$/, '')); }
  catch { throw new Error('The planning model returned an incomplete plan. Try fewer images or a shorter brief.'); }
}
