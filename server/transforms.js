import sharp from 'sharp';
import path from 'node:path';

export const TRANSFORM_OPTIONS=[
 {id:'water-flow',label:'Water refraction',description:'Gentle currents bend environmental detail like moving water.',maxStrength:.55,defaultEnabled:true},
 {id:'reflection-echo',label:'Reflection echoes',description:'A faint reflected trace suggests water, memory and returning forms.',maxStrength:.4,defaultEnabled:false},
 {id:'sediment-wash',label:'Sediment wash',description:'Thin earth and leaf pigment settles in soft contour bands.',maxStrength:.45,defaultEnabled:true},
 {id:'capillary-stain',label:'Capillary staining',description:'Subtle pigment pools along material edges, recalling water absorbed by paper.',maxStrength:.4,defaultEnabled:true},
 {id:'contour-etch',label:'Contour impressions',description:'Fine tonal contours trace terrain and growth within the photograph.',maxStrength:.35,defaultEnabled:false},
 {id:'print-grain',label:'Paper grain',description:'A quiet printed texture connects photographic fragments.',maxStrength:.5,defaultEnabled:true},
 {id:'reproduction',label:'Copy softness',description:'Restrained softness suggests a photograph passed between generations.',maxStrength:.45,defaultEnabled:false},
 {id:'misregistration',label:'Offset inks',description:'Small ink offsets leave a visible trace of assembling and printing.',maxStrength:.35,defaultEnabled:false},
 {id:'posterize',label:'Tonal steps',description:'Gently simplify tones while keeping photographic texture.',maxStrength:.4,defaultEnabled:false},
 {id:'selective-erasure',label:'Eroded impressions',description:'Uneven fading follows the source texture like weathered printed matter.',maxStrength:.4,defaultEnabled:false},
 {id:'recolour',label:'Earth and water palette',description:'A light wash drawn from observed water, leaves, stone and soil.',maxStrength:.5,defaultEnabled:true},
];
export const TRANSFORMS=['none',...TRANSFORM_OPTIONS.map(t=>t.id)];
export const DEFAULT_TRANSFORMS=TRANSFORM_OPTIONS.filter(t=>t.defaultEnabled).map(t=>t.id);
export function permittedTransforms(job){
 return job.transformations?(job.enabledTransforms??DEFAULT_TRANSFORMS).filter(type=>TRANSFORMS.includes(type)&&type!=='none'&&(job.recolouring||type!=='recolour')):[];
}
export const treatmentBudget=generatedCount=>({maxImages:Math.min(3,Math.ceil(generatedCount/2)),maxTypes:2});
// Keep the director's strongest accents; extra choices stay untreated. The applied
// plan and these adjustments are both saved, so restraint is visible in provenance.
export function restrainTreatments(plan,job){
 const allowed=permittedTransforms(job),budget=treatmentBudget(plan.images.filter(i=>!i.sourceId).length),types=new Set(),adjustments=[];
 let used=0;
 for(const item of [...plan.images].sort((a,b)=>b.transform.strength-a.transform.strength)){
  const treatment=item.transform;if(treatment.type==='none')continue;
  if(item.sourceId||!allowed.includes(treatment.type))throw new Error('The plan uses a disabled transformation or transforms an archive person.');
  if(used>=budget.maxImages||(!types.has(treatment.type)&&types.size>=budget.maxTypes)){
   adjustments.push({key:item.key,requested:{...treatment},reason:'Keep the collage restrained: at most three treated fragments and two treatment types.'});
   item.transform={type:'none',strength:.1,reason:'Retain this photographic material untreated to balance the selected accents.'};continue;
  }
  const cap=TRANSFORM_OPTIONS.find(t=>t.id===treatment.type).maxStrength;
  if(treatment.strength>cap){adjustments.push({key:item.key,requested:{...treatment},reason:'Preserve photographic detail with a restrained treatment strength.'});treatment.strength=cap;}
  used++;types.add(treatment.type);
 }
 return adjustments;
}
const FALLBACK_PALETTE=['#183f3b','#68764a','#9c6b40','#d6c8a5'];
const rgb=hex=>[1,3,5].map(i=>Number.parseInt(hex.slice(i,i+2),16));
function paletteFrom(value=''){
  const colors=[...String(value).matchAll(/#[0-9a-fA-F]{6}\b/g)].map(match=>match[0]);
  return (colors.length>=2?colors:FALLBACK_PALETTE).slice(0,6).map(rgb);
}
function colourAt(colors,t){
  const position=Math.max(0,Math.min(1,t))*(colors.length-1),left=Math.floor(position),right=Math.min(colors.length-1,left+1),mix=position-left;
  return colors[left].map((channel,index)=>channel*(1-mix)+colors[right][index]*mix);
}
function bilinear(source,width,height,x,y,channel){
  const sx=Math.max(0,Math.min(width-1,x)),sy=Math.max(0,Math.min(height-1,y)),x0=Math.floor(sx),y0=Math.floor(sy),x1=Math.min(width-1,x0+1),y1=Math.min(height-1,y0+1),fx=sx-x0,fy=sy-y0;
  const at=(px,py)=>source[(py*width+px)*4+channel];
  return at(x0,y0)*(1-fx)*(1-fy)+at(x1,y0)*fx*(1-fy)+at(x0,y1)*(1-fx)*fy+at(x1,y1)*fx*fy;
}
export async function transformImage(store,asset,transform) {
  if(transform.type==='none')return asset;
  if(asset.kind==='source'&&(!asset.allowTransform||asset.archive?.category==='people'))throw new Error(`Transformation is not permitted for ${asset.title}.`);
  if(!TRANSFORMS.includes(transform.type))throw new Error('Unknown image transformation.');
  const requestedStrength=Math.max(.1,Math.min(1,transform.strength));
  const strength=Math.min(TRANSFORM_OPTIONS.find(t=>t.id===transform.type).maxStrength,requestedStrength);
  let image=sharp(path.join(store.root,'media',`${asset.id}.png`));
  if(transform.type==='reproduction'){
    // A restrained copy-generation softness. Lanczos resampling and a high JPEG
    // quality retain texture instead of producing obvious block pixels.
    const scale=.94-strength*.22,w=Math.max(96,Math.round(asset.width*scale)),h=Math.max(96,Math.round(asset.height*scale));
    const compressed=await image.resize(w,h,{fit:'fill',kernel:'lanczos3'}).jpeg({quality:Math.round(91-strength*17),chromaSubsampling:'4:4:4'}).toBuffer();
    image=sharp(compressed).resize(asset.width,asset.height,{fit:'fill',kernel:'lanczos3'});
  } else {
    const {data,info}=await image.ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const original=Buffer.from(data),shift=Math.max(1,Math.round(info.width*.008*strength)),colors=paletteFrom(transform.palette);
    for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++){
      const i=(y*info.width+x)*4;
      const luminance=(original[i]*.2126+original[i+1]*.7152+original[i+2]*.0722)/255;
      if(transform.type==='reflection-echo'){
        const band=Math.max(0,1-Math.abs(y/info.height-.68)/.3),amount=band*strength*.32;
        const sx=x+Math.sin(y/info.height*29)*info.width*.006;
        const sy=info.height*.98-y*.55;
        for(let c=0;c<3;c++)data[i+c]=Math.round(original[i+c]*(1-amount)+bilinear(original,info.width,info.height,sx,sy,c)*amount);
      } else if(transform.type==='sediment-wash'){
        const strata=.5+.5*Math.sin(y/info.height*24+luminance*5+Math.sin(x/info.width*7));
        const pigment=colourAt(colors,.2+luminance*.6),amount=strength*.28*strata;
        for(let c=0;c<3;c++)data[i+c]=Math.round(original[i+c]*(1-amount)+pigment[c]*amount);
      } else if(transform.type==='capillary-stain'){
        const j=(y*info.width+Math.max(0,x-2))*4,k=(Math.max(0,y-2)*info.width+x)*4;
        const edge=Math.min(1,(Math.abs(original[i]-original[j])+Math.abs(original[i+1]-original[k+1]))/100);
        const tide=.5+.5*Math.sin(x/info.width*11+Math.sin(y/info.height*9)*2);
        const amount=strength*(.05+edge*.25)*tide,pigment=colourAt(colors,luminance*.65);
        for(let c=0;c<3;c++)data[i+c]=Math.round(original[i+c]*(1-amount)+pigment[c]*amount);
      } else if(transform.type==='contour-etch'){
        const contour=Math.pow(.5+.5*Math.cos(luminance*Math.PI*22),18),amount=contour*strength*.3;
        const pigment=colourAt(colors,Math.max(0,luminance-.22));
        for(let c=0;c<3;c++)data[i+c]=Math.round(original[i+c]*(1-amount)+pigment[c]*amount);
      } else if(transform.type==='misregistration'){
        data[i]=original[(y*info.width+Math.max(0,x-shift))*4];
        data[i+2]=original[(y*info.width+Math.min(info.width-1,x+shift))*4+2];
      } else if(transform.type==='posterize'){
        const levels=Math.round(13-strength*5),step=255/(levels-1),amount=strength*.48;
        for(let c=0;c<3;c++){
          const reduced=Math.min(255,Math.round(original[i+c]/step)*step);
          data[i+c]=Math.round(original[i+c]*(1-amount)+reduced*amount);
        }
      } else if(transform.type==='recolour'){
        const luminance=(original[i]*.2126+original[i+1]*.7152+original[i+2]*.0722)/255;
        const mapped=colourAt(colors,luminance),amount=.18+strength*.38;
        for(let c=0;c<3;c++)data[i+c]=Math.round(original[i+c]*(1-amount)+mapped[c]*amount);
      } else if(transform.type==='water-flow'){
        // Smooth refraction-like displacement follows two crossing flow bands.
        // Bilinear sampling retains continuous detail and avoids block pixels.
        const dx=Math.sin(y/info.height*Math.PI*5+x/info.width*Math.PI*1.4)*info.width*.012*strength;
        const dy=Math.sin(x/info.width*Math.PI*4-y/info.height*Math.PI*.7)*info.height*.007*strength;
        for(let c=0;c<3;c++)data[i+c]=Math.round(bilinear(original,info.width,info.height,x+dx,y+dy,c));
      } else if(transform.type==='print-grain'){
        // Deterministic simulated paper/reproduction texture, not a physical process.
        const grain=(((x*73+y*151+(x*y)%197)%101)/100-.5)*34*strength;
        const weave=((x%4===0?1:0)+(y%5===0?1:0))*7*strength;
        for(let c=0;c<3;c++)data[i+c]=Math.max(0,Math.min(255,original[i+c]*.94+12+grain-weave));
      } else if(transform.type==='selective-erasure'){
        const wave=.5+.5*Math.sin(x/info.width*13+y/info.height*7+luminance*9);
        const amount=Math.pow(wave,6)*strength*.4,pigment=colourAt(colors,.78);
        for(let c=0;c<3;c++)data[i+c]=Math.round(original[i+c]*(1-amount)+pigment[c]*amount);
      }
    }
    image=sharp(data,{raw:info});
  }
  return store.addImage(await image.png().toBuffer(),`${asset.title}-transformed.png`,{
    kind:asset.kind,title:asset.title,caption:asset.caption,locality:asset.locality,contributor:asset.contributor,
    restrictions:asset.restrictions,allowCrop:asset.allowCrop,allowReference:false,allowTransform:asset.allowTransform,
    rootId:asset.rootId||asset.id,derived:{parentId:asset.id,operation:'transform',transform:{...transform,effectiveStrength:strength,simulated:true}},
    ...(asset.generation?{generation:asset.generation}:{})
  });
}
