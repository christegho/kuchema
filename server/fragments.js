// Scale hierarchy for a collage: each image gives one primary cut, and generated images
// also give fixed detail cuts, so 6–20 images yield 12–21 fragments without extra
// paid image calls. Tier counts are targets: a missed target is reported, never fatal.
export const TIERS=['dominant','medium','small'];
export const TIER_TARGETS={dominant:[3,5],medium:[4,7],small:[5,9]};
const MAX_FRAGMENTS=21,MAX_DETAILS=6;

export const detailCount=count=>Math.max(1,Math.min(MAX_DETAILS,MAX_FRAGMENTS-count));
const slotKey=index=>`F${String(index).padStart(2,'0')}`;
// Fixed slots keep every detail tied to one generated image (at most two per image).
export function detailAssignments(count,generatedCount){
 const sources=Array.from({length:generatedCount},(_,i)=>slotKey(count-generatedCount+i+1));
 return sources.length?Object.fromEntries(Array.from({length:detailCount(count)},(_,i)=>[`D${String(i+1).padStart(2,'0')}`,sources[i%sources.length]])):{};
}
/** Every fragment of a plan: primary cuts first, then detail cuts. Studies before details have primaries only. */
export function fragmentTargets(plan){
 return [...(plan?.images||[]).map(item=>({key:item.key,sourceKey:item.key,item,primary:true})),...(plan?.details||[]).map(item=>({key:item.key,sourceKey:item.sourceKey,item,primary:false}))];
}
export function tierCounts(plan,keys){
 const counts={dominant:0,medium:0,small:0};
 for(const {key,item} of fragmentTargets(plan))if((!keys||keys.has(key))&&counts[item.tier]!==undefined)counts[item.tier]++;
 return counts;
}
export function scaleHierarchyWarning(plan,keys){
 if(!plan?.details)return null;
 const counts=tierCounts(plan,keys),missed=TIERS.filter(t=>counts[t]<TIER_TARGETS[t][0]||counts[t]>TIER_TARGETS[t][1]);
 return missed.length?`Scale hierarchy: ${TIERS.map(t=>`${counts[t]} ${t}`).join(', ')} fragments; the target is ${TIERS.map(t=>`${TIER_TARGETS[t].join('–')} ${t}`).join(', ')}.`:null;
}
