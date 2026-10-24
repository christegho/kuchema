import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

// Binding technical rules live in the repository, not in the editable studio state:
// they take precedence over the art direction, the request and all source text.
const TECHNICAL_PROMPT_FILE=new URL('../training-data/technical_prompt.txt',import.meta.url);
export const TECHNICAL_PROMPT_LIMIT=10000;
export async function technicalPrompt(){
  const text=(await fs.readFile(TECHNICAL_PROMPT_FILE,'utf8').catch(e=>{if(e.code==='ENOENT')return '';throw e;})).trim();
  if(!text)throw new Error('training-data/technical_prompt.txt is missing. No paid calls were made.');
  if(text.length>TECHNICAL_PROMPT_LIMIT)throw new Error(`training-data/technical_prompt.txt must fit ${TECHNICAL_PROMPT_LIMIT} characters.`);
  return text;
}

export const DEFAULT_SYSTEM_PROMPT=`Create a visually rich, speculative photographic collage rooted in the landscapes, communities, ecological knowledge and cultural imaginaries of Chikukwa, Chimanimani, Zimbabwe. Imagine alternative environmental futures through relationships between water, land, people, plants, animals, ancestral memory and ecological regeneration. The visual language should resemble physical collages assembled from photographic prints, magazine cuttings and archival material, rather than digital illustrations, paintings or seamless AI-generated scenes. Translate local research narratives into specific visual subjects, environments, relationships and transformations without illustrating myths literally. Distinguish documented cultural knowledge from artistic speculation.`;

export const DEFAULT_IMAGE_PROMPT=`Create a visually rich, speculative photographic collage rooted in Chikukwa and Chimanimani, Zimbabwe, where water connects land, plants, people, ancestral memory and possible ecological futures. Use 3-6 relevant local research passages to guide at least two newly generated fragments and the composition. Create a visually dense collage resembling physical photographic prints and magazine cuttings, with purposeful scale shifts, irregular overlaps and a pure black ground without white or pale gaps.`;

// Only the creative sections of the supplied MOU belong in model context.
export function creativeExcerpt(text) {
  const start=text.search(/^1\. Project Overview/m), end=text.search(/^5\./m);
  if(start<0)return '';
  return text.slice(start,end>start?end:undefined).replace(/^.*https?:\/\/\S+.*$/gm,'').trim().slice(0,12000);
}
export async function projectContext(directory=process.cwd()) {
  const read=async name=>{try{return await fs.readFile(path.join(directory,name),'utf8');}catch(e){if(e.code==='ENOENT')return '';throw e;}};
  const supplied=await read('training-data/system_prompt.txt');
  const imagePrompt=(await read('training-data/image_prompt.txt')).trim()||DEFAULT_IMAGE_PROMPT;
  if(imagePrompt.length>3000)throw new Error('training-data/image_prompt.txt must fit the 3000-character image prompt limit.');
  // The colleague's original stays untouched; machine-local paths are not useful to models.
  const direction=supplied.replace(/^.*\/Users\/chipo\/.*$/gm,'archive/collages-style-guide/').replace(/^\(~\/Documents\/.*$/gm,'').trim();
  const systemPrompt=direction?`Kuchema: The Gathering — project art direction\n\n${direction}`:DEFAULT_SYSTEM_PROMPT;
  const technical=await technicalPrompt();
  return {brief:creativeExcerpt(await read('brief.md')),technicalPrompt:technical,technicalPromptRevision:createHash('sha256').update(technical).digest('hex'),technicalPromptSource:'training-data/technical_prompt.txt',systemPrompt,systemPromptSource:direction?'training-data/system_prompt.txt':'server/context.js',systemPromptRevision:createHash('sha256').update(systemPrompt).digest('hex'),defaultPrompt:imagePrompt,defaultPromptSource:'training-data/image_prompt.txt'};
}

// Adopt the new research direction once; preserve the previous editable prompt for recovery.
export async function syncProjectContext(store,directory=process.cwd()) {
  const context=await projectContext(directory);
  if(!store.state.researchContextVersion){
    if(store.state.systemPrompt&&store.state.systemPrompt!==context.systemPrompt){
      store.state.systemPromptHistory||=[];store.state.systemPromptHistory.push({prompt:store.state.systemPrompt,at:new Date().toISOString(),reason:'Before local research integration'});
    }
    store.state.systemPrompt=context.systemPrompt;store.state.researchContextVersion=1;
    store.state.defaultSystemPrompt=context.systemPrompt;store.state.systemPromptRevision=context.systemPromptRevision;await store.persist();
  }else if(store.state.systemPromptRevision!==context.systemPromptRevision){
    if(store.state.systemPrompt===store.state.defaultSystemPrompt){
      // Keep the replaced default so a revised art direction can be compared or restored.
      if(store.state.systemPrompt){store.state.systemPromptHistory||=[];store.state.systemPromptHistory.push({prompt:store.state.systemPrompt,at:new Date().toISOString(),reason:'Replaced by a revised project art direction'});}
      store.state.systemPrompt=context.systemPrompt;
    }
    store.state.defaultSystemPrompt=context.systemPrompt;store.state.systemPromptRevision=context.systemPromptRevision;await store.persist();
  }
  return context;
}
