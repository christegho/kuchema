import {z} from 'zod';
const text=(n=600)=>z.string().max(n);
const coordinate=z.number().min(0).max(10000);
export const boxSchema=z.tuple([coordinate,coordinate,coordinate,coordinate]);
export const pointSchema=z.tuple([coordinate,coordinate]);
export const observationSchema=z.object({images:z.array(z.object({
 id:text(100),description:text(800),coordinateSpace:z.enum(['normalized_1000','pixels']),
 regions:z.array(z.object({key:text(40),label:text(120),box:boxSchema,point:pointSchema,reason:text()})).max(3)
})).max(20)});
export const layoutSchema=z.object({background:z.string().regex(/^#[0-9a-fA-F]{6}$/),rationale:text(1600),layers:z.array(z.object({assetId:text(100),name:text(160),x:z.number().min(0).max(1),y:z.number().min(0).max(1),width:z.number().min(.02).max(1.8),rotation:z.number().min(-45).max(45),opacity:z.number().min(.5).max(1),reason:text()})).min(1).max(40),negativeSpace:text(800)});
export const critiqueSchema=z.object({assessment:text(1500),issues:z.array(text(500)).max(8),revise:z.boolean(),layout:layoutSchema});
export function normalizeObservations(value,assets){
 const data=observationSchema.parse(value),ids=new Set();
 for(const item of data.images){
  if(!assets.some(a=>a.id===item.id)||ids.has(item.id))throw new Error('The visual reading returned an unknown or duplicate image ID.');ids.add(item.id);
  const keys=new Set(),asset=assets.find(a=>a.id===item.id);
  for(const region of item.regions){
   if(keys.has(region.key))throw new Error('The visual reading returned duplicate region keys.');keys.add(region.key);
   const rawBox=region.box,rawPoint=region.point,raw=[...rawBox,...rawPoint];
   // Resolve a common provider error using the dimensions of the image supplied.
   // Small originals are often reported in true pixels; large images and values
   // outside a stated pixel axis are the provider's usual 0–1000 grid.
   const exceedsPixels=rawBox.some((v,i)=>v>(i%2===0?asset.width:asset.height))
    ||rawPoint.some((v,i)=>v>(i%2===0?asset.width:asset.height));
   const highResolutionGrid=item.coordinateSpace==='pixels'&&Math.min(asset.width,asset.height)>1000&&Math.max(...raw)<=1000;
   const resolved=item.coordinateSpace==='pixels'&&!exceedsPixels&&!highResolutionGrid?'pixels':'normalized_1000';
   const normalize=(values)=>resolved==='pixels'
    ? values.map((v,i)=>v/(i%2===0?asset.width:asset.height))
    : values.map(v=>v>1?v/1000:v);
   const b=normalize(rawBox),p=normalize(rawPoint);
   if(b.some(v=>v<0||v>1)||p.some(v=>v<0||v>1))throw new Error('The visual reading returned coordinates outside its declared coordinate space.');
   region.coordinateSpaceResolved=resolved;
   if(b[2]<=b[0]||b[3]<=b[1]||p[0]<b[0]||p[0]>b[2]||p[1]<b[1]||p[1]>b[3])throw new Error('A requested segmentation point lies outside its region.');
   region.box=b;region.point=p;
  }
 }
 return data.images;
}
