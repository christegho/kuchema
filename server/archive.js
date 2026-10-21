import {randomInt} from 'node:crypto';

export function archiveCategory(relativePath) {
  const parts=relativePath.replaceAll('\\','/').toLowerCase().split('/');
  if(parts[0]==='people')return 'people';
  if(parts[0]==='collages-style-guide')return 'composition';
  if(parts[0]==='chikukwa water sites')return 'water';
  // The curated open-access folder is kept apart until its licences are recorded.
  if(/^open[-_ ]?access/.test(parts[0]))return 'open-access';
  return 'general';
}

// Only general and water photographs may condition image generation (assets outside the official archive keep their own permission).
export const referenceEligible=asset=>!asset.archive||['general','water'].includes(asset.archive.category);

export function shuffled(items,random=randomInt) {
  const result=[...items];
  for(let i=result.length-1;i>0;i--){const j=random(i+1);[result[i],result[j]]=[result[j],result[i]];}
  return result;
}

// Counts refer to distinct photographs, not the number of figures within a photo.
// 3–6 Chikukwa/water generation references; people leave at least three generated images.
export function archiveCounts(count) {
  const references=count>12?3:2;
  return {general:references,water:references,composition:1,people:Math.min(8,Math.max(4,Math.round(count*.4)),count-3)};
}

export function selectOfficialArchive(assets,job,random=randomInt) {
  if(!job.useReferences)throw new Error('The official archive workflow needs generation references enabled. No paid calls were made.');
  if(job.includePeople&&!job.includeArchive)throw new Error('People are cropped from archive photographs. Enable archive inclusion or turn off people. No paid calls were made.');
  const pool=assets.filter(a=>a.kind==='source'&&!a.derived&&a.archive?.active&&(!job.ids.length||job.ids.includes(a.id)));
  const counts=archiveCounts(job.count),selected={};
  for(const category of ['general','water','composition','people']){
    const candidates=shuffled(pool.filter(a=>a.archive.category===category&&(category==='people'?a.allowCrop:category==='composition'||a.allowReference)),random);
    const minimum=category==='composition'?1:category==='people'&&!job.includePeople?0:2;
    if(candidates.length<minimum)throw new Error(`The selected official archive needs at least ${minimum} ${category} photographs with the required permission; found ${candidates.length}. Clear the selection or enable the relevant permissions. No paid calls were made.`);
    const desired=category==='people'&&!job.includePeople?0:counts[category];
    // Missing scale-dependent references must not silently lower the requested count.
    if(category!=='people'&&candidates.length<desired)throw new Error(`This composition needs ${desired} ${category} references; only ${candidates.length} are available. No paid calls were made.`);
    selected[category]=candidates.slice(0,desired);
  }
  // With few people sources, use the available 2–3 and generate more environment.
  const archive=selected.people,generatedCount=job.count-archive.length;
  const referenceAssignments=Object.fromEntries(Array.from({length:generatedCount},(_,i)=>[
    `F${String(archive.length+i+1).padStart(2,'0')}`,
    [selected.general[i%selected.general.length].id,selected.water[i%selected.water.length].id],
  ]));
  return {archive,generatedCount,selected,referenceAssignments,contextArchive:Object.values(selected).flat()};
}
