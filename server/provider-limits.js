// Endpoint-specific limit observed in Venice's validation response. Scope it to
// the affected model; other providers/model versions can have different limits.
export function providerImageLimit(model,provider){
  return model==='qwen/qwen3-vl-235b-a22b-instruct'&&provider?.split('/')[0]==='venice'?10:Infinity;
}

export function requestImageCount(body){
  return (body.messages||[]).reduce((sum,message)=>sum+(Array.isArray(message.content)?message.content.filter(part=>part.type==='image_url').length:0),0);
}

export function reportedImageLimit(message){
  const match=String(message).match(/at most\s+(\d+)\s+image(?:\(s\)|s)?\s+may be provided in one request/i);
  const limit=match?Number(match[1]):null;
  return Number.isSafeInteger(limit)&&limit>=0?limit:null;
}
