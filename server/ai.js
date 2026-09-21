import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

export const imageModels = [
  {id:'bytedance-seed/seedream-4.5',name:'Seedream 4.5',label:'Reference-aware material',estimate:'Live price checked',refs:2,resolution:'2K'},
  {id:'openai/gpt-image-2.5-sunburst',name:'GPT Image 2.5 Sunburst',label:'Premium · subject to the $1.00 cap',estimate:'Variable pricing — blocked until a safe maximum is available',refs:2,resolution:null},
];

export async function routerRequest(endpoint, body) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error('Add OPENROUTER_API_KEY to .env and restart the studio to use AI.');
  const response = await fetch(`https://openrouter.ai/api/v1/${endpoint}`, {
    method: 'POST', signal: AbortSignal.timeout(180000),
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json', 'X-Title': 'Situated Studio' },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || result.error) {
    const detail=result.error?.metadata;
    const message = String((result.error?.message || `OpenRouter returned ${response.status}`)+(detail?.provider_name?` (${detail.provider_name})`:'')+(typeof detail?.raw==='string'?`: ${detail.raw}`:'')).replace(/sk-[\w-]+/g, '[redacted]');
    throw new Error(message.slice(0, 500));
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
