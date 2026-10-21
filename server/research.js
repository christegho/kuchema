import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const cache=new Map();
const hash=value=>createHash('sha256').update(value).digest('hex');
const clean=value=>value.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').replace(/\0/g,'').trim();
const tokens=text=>new Set((text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu)||[]).filter(t=>!['with','from','that','this','have','their','into','collage','image','images','create','photographic'].includes(t)));
const score=(text,terms)=>{const words=tokens(text);return [...terms].reduce((n,t)=>n+Number(words.has(t)),0);};
const boundaryOnly='water-rituals-for-combatting-pests.txt';
const boundarySummary='This testimony explicitly withholds sacred ritual knowledge. Use absence, restraint and ecological care as compositional principles. Do not depict, reconstruct or infer hidden actions, ritual procedures or healing mechanisms. This is an editorial restriction summary, not a quotation from the testimony.';

function chunks(text,location){
  const output=[];
  for(let start=0;start<text.length;){
    let end=Math.min(start+900,text.length);
    if(end<text.length){const stop=text.lastIndexOf(' ',end);if(stop>start+500)end=stop;}
    const excerpt=text.slice(start,end).trim();
    if(excerpt)output.push({location,excerpt});
    start=end;
  }
  return output;
}
async function extract(bytes,format){
  if(format==='txt'){
    const text=clean(bytes.toString('utf8')),passages=[];
    for(const match of text.matchAll(/\S[\s\S]*?(?=\n\s*\n|$)/g)){
      const paragraph=match[0],line=text.slice(0,match.index).split('\n').length,count=paragraph.split('\n').length;
      passages.push(...chunks(paragraph,`lines ${line}–${line+count-1}`));
    }
    return {passages,pages:null};
  }
  // Node text extraction follows Mozilla's PDF.js getinfo example; no PDF images are reused.
  const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,useSystemFonts:true,verbosity:0});
  try{
    const doc=await task.promise,passages=[];
    if(doc.numPages>300)throw new Error('PDF exceeds the 300-page indexing limit.');
    for(let page=1;page<=doc.numPages;page++){
      const content=await (await doc.getPage(page)).getTextContent();
      const text=clean(content.items.map(item=>('str' in item?item.str+(item.hasEOL?'\n':' '):'')).join(''));
      passages.push(...chunks(text,`page ${page}`));
    }
    const metadata=await doc.getMetadata().catch(()=>null),title=metadata?.info?.Title?.trim();
    return {passages,pages:doc.numPages,...(title&&title.length<200&&!/microsoft|untitled/i.test(title)?{title}: {})};
  }finally{await task.destroy();}
}

/** Index originals in place: research is an archive collection, not a photo asset. */
export async function researchLibrary(directory=process.cwd()){
  const root=path.resolve(directory,'training-data'),files=[];
  async function walk(folder){
    let entries;try{entries=await fs.readdir(folder,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return;throw e;}
    for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){
      if(entry.name.startsWith('.'))continue;
      const filename=path.join(folder,entry.name);
      if(entry.isDirectory())await walk(filename);
      else if(entry.isFile()&&/\.(txt|pdf)$/i.test(entry.name))files.push(filename);
    }
  }
  await walk(path.join(root,'scripts'));await walk(path.join(root,'papers'));
  const versions=await Promise.all(files.map(async filename=>{const stat=await fs.stat(filename);return `${filename}:${stat.size}:${stat.mtimeMs}`;}));
  const signature=versions.join('|'),old=cache.get(root);
  if(old?.signature===signature)return old.promise;
  const promise=(async()=>{
    const documents=[];
    for(const filename of files){
      const relativePath=path.relative(directory,filename).split(path.sep).join('/'),format=path.extname(filename).slice(1).toLowerCase();
      const id=hash(relativePath).slice(0,24),bytes=await fs.readFile(filename);
      const document={id,filename:path.basename(filename),relativePath,format,title:path.basename(filename,path.extname(filename)).replace(/[-_]/g,' '),checksum:hash(bytes),url:`/api/research/${id}/file`,status:'ready',pages:null,passages:[]};
      try{
        if(bytes.length>25*1024*1024)throw new Error('File exceeds the 25 MB indexing limit.');
        const result=await extract(bytes,format);Object.assign(document,result);
        if(!document.passages.some(p=>p.excerpt.length>=30))throw new Error('No readable text found. An OCR text version is needed.');
        if(format==='txt')document.title=document.passages[0].excerpt.split('\n')[0].slice(0,160);
        if(document.filename===boundaryOnly){document.passages=[{location:'editorial boundary summary',excerpt:boundarySummary}];document.note='Only the non-disclosure boundary informs generation; the testimony itself is not sent to models.';}
      }catch(e){document.status='unreadable';document.error=e.message;document.passages=[];}
      documents.push(document);
    }
    return documents;
  })();
  cache.set(root,{signature,promise});
  try{return await promise;}catch(e){cache.delete(root);throw e;}
}
export const publicResearch=({passages,...document})=>({...document,excerpt:passages[0]?.excerpt||''});

// 3–6 relevant passages, one per file; at least two lead their own generated image.
export const RESEARCH_RANGE=[3,6],DEFAULT_RESEARCH=4,MIN_LED=2;
export const isPaper=document=>document.relativePath.split('/').includes('papers');
// The non-disclosure testimony may inform restraint in the composition, never an image.
export const leadsImage=document=>document.filename!==boundaryOnly;

export function selectResearch(documents,{prompt,contextText='',researchCount=DEFAULT_RESEARCH,researchIds=[]}){
  const [min,max]=RESEARCH_RANGE;
  if(!Number.isInteger(researchCount)||researchCount<min||researchCount>max)throw new Error(`Choose between ${min} and ${max} research passages.`);
  if(new Set(researchIds).size!==researchIds.length)throw new Error('Research selections must be distinct files.');
  if(researchIds.some(id=>!documents.some(d=>d.id===id&&d.status==='ready')))throw new Error('A selected research file is missing or unreadable.');
  const terms=tokens(`${prompt} ${contextText}`),pool=documents.filter(d=>d.status==='ready'&&(!researchIds.length||researchIds.includes(d.id)));
  // Identical copies cannot inflate the distinct-file requirement.
  const unique=[...new Map(pool.map(d=>[d.checksum,d])).values()];
  if(unique.length<researchCount)throw new Error(`Need ${researchCount} distinct readable research files; ${unique.length} are available in this selection. No paid calls were made.`);
  const ranked=unique.map(d=>{
    const passage=d.passages.map((p,index)=>({...p,index,score:score(p.excerpt,terms)})).sort((a,b)=>b.score-a.score||a.index-b.index)[0];
    return {d,passage,score:score(d.title,terms)*3+passage.score};
  }).sort((a,b)=>b.score-a.score||a.d.relativePath.localeCompare(b.d.relativePath));
  const chosen=ranked.slice(0,researchCount);
  // If the most relevant files cannot lead two images, swap in the next files that can.
  for(const next of ranked.slice(researchCount).filter(r=>leadsImage(r.d))){
    if(chosen.filter(r=>leadsImage(r.d)).length>=MIN_LED)break;
    chosen.splice(chosen.findLastIndex(r=>!leadsImage(r.d)),1,next);
  }
  if(chosen.filter(r=>leadsImage(r.d)).length<MIN_LED)throw new Error(`At least ${MIN_LED} research passages must be able to lead a generated image. No paid calls were made.`);
  return chosen.map(({d,passage})=>({
    id:d.id,title:d.title,filename:d.filename,relativePath:d.relativePath,checksum:d.checksum,format:d.format,url:d.url,note:d.note,
    passages:[{location:passage.location,excerpt:passage.excerpt}],
  }));
}

/** Each leadable passage leads one generated slot, from the first generated slot onwards. */
export function researchAssignments(documents,count,generatedCount){
  const leads=documents.filter(leadsImage);
  if(leads.length<MIN_LED||generatedCount<MIN_LED)throw new Error(`Research requires at least ${MIN_LED} passages that can lead an image and ${MIN_LED} generated collage parts.`);
  return Object.fromEntries(leads.slice(0,generatedCount).map((d,i)=>[`F${String(count-generatedCount+i+1).padStart(2,'0')}`,[d.id]]));
}
export function validateResearchPlan(plan,job){
  if(!job.researchDocuments)return; // Legacy saved studies remain resumable.
  const ids=job.researchDocuments.map(d=>d.id),composition=plan.researchComposition;
  if(!composition||new Set(composition.sourceIds).size!==ids.length||ids.some(id=>!composition.sourceIds.includes(id))||composition.sourceIds.some(id=>!ids.includes(id))||composition.direction.trim().length<30)throw new Error('Composition must explain how every selected research file guides the arrangement.');
  if(ids.some(id=>(composition.relationships?.[id]||'').trim().length<30))throw new Error('Every selected research passage must state the visual relationship it creates.');
  for(const item of plan.images){
    const assigned=job.researchAssignments[item.key],used=item.researchIds||[];
    if(new Set(used).size!==used.length||used.some(id=>!ids.includes(id))||(item.sourceId&&used.length))throw new Error('Invalid research attribution for a collage part.');
    if(assigned&&(item.sourceId||JSON.stringify(used)!==JSON.stringify(assigned)||item.researchIntent?.trim().length<30))throw new Error('Every research-led generated part must explain and retain its assigned passage.');
  }
  if(Object.keys(job.researchAssignments).some(key=>!plan.images.some(i=>i.key===key)))throw new Error('A required research-led part is missing.');
}
export function auditResearchParts(job){
  if(!job.researchAssignments)return;
  // A led image counts as present if any of its fragments (primary or detail) is visible.
  const byFragment=job.coverage?.keyedBy==='fragment',keys=Object.keys(job.researchAssignments),visible=keys.filter(key=>(job.materials||[]).filter(m=>(m.sourceKey||m.key)===key).some(m=>{
    const id=byFragment?m.key:m.rootId;
    return job.project?.layers.some(l=>l.assetId===m.assetId&&l.visible)&&job.coverage?.visible?.[id]>=Math.min(.004,.4*(job.coverage?.footprints?.[id]??1))&&!job.coverage?.obscuredIds?.includes(id);
  }));
  job.researchCoverage={required:keys.length,plannedKeys:keys,visibleKeys:visible,satisfied:visible.length>=keys.length};
  job.warnings=job.warnings.filter(w=>!w.startsWith('Research-led parts:'));
  if(visible.length<keys.length)job.warnings.push(`Research-led parts: ${visible.length} of ${keys.length} are visibly present. This is a partial research composition; retry missing cuts or adjust obscured fragments.`);
}
