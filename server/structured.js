import {z} from 'zod';

// Providers compile response schemas into decoding grammars, and each engine implements a
// different subset of JSON Schema (Parasail rejects `propertyNames`, for example). Only
// keywords that every checked provider has accepted in completed studies are sent. Removing
// a constraint only loosens the grammar: every answer is still validated with zod.
export const GRAMMAR_KEYWORDS=new Set(['$schema','type','properties','required','additionalProperties','items','prefixItems','minItems','maxItems','enum','const','minLength','maxLength','minimum','maximum','pattern']);
const SCHEMA_LISTS=new Set(['prefixItems']),SCHEMA_MAPS=new Set(['properties']),SCHEMA_VALUES=new Set(['items','additionalProperties']);

export function providerSchema(schema){
 const json=z.toJSONSchema(schema),removed=new Set();
 const visit=node=>{
  if(!node||typeof node!=='object')return;
  for(const key of Object.keys(node)){
   if(!GRAMMAR_KEYWORDS.has(key)){removed.add(key);delete node[key];continue;}
   if(SCHEMA_MAPS.has(key))Object.values(node[key]).forEach(visit);
   else if(SCHEMA_LISTS.has(key))node[key].forEach(visit);
   else if(SCHEMA_VALUES.has(key))visit(node[key]);
  }
 };
 visit(json);
 return {schema:json,removed:[...removed]};
}
