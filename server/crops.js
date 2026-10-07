import sharp from 'sharp';

// Inspect the pixels, not just the segmenter's claimed coverage. A nearly whole
// photo with an imperceptible alpha border is not a composition-directed cut.
export async function inspectCut(file,source){
 const {data,info}=await sharp(file).resize(256,256,{fit:'inside',withoutEnlargement:true}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 let alpha=0,transparent=0;
 for(let i=3;i<data.length;i+=4){alpha+=data[i]/255;if(data[i]<230)transparent++;}
 const area=info.width*info.height,meta=await sharp(file).metadata();
 const opacity=alpha/area,retained=opacity*meta.width*meta.height/(source.width*source.height);
 if(transparent/area<.02||retained>.92)throw new Error('The proposed cut retains an almost whole rectangular photograph. A more selective, composition-led crop is required.');
 if(opacity<.004)throw new Error('The proposed cut contains too little visible material.');
 return {retainedFraction:retained,transparentFraction:transparent/area};
}
