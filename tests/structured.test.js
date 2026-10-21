import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {GRAMMAR_KEYWORDS,providerSchema} from '../server/structured.js';
import {creationInput,advanceFor} from '../server/plan.js';
import {observationSchema,critiqueSchema} from '../server/direction.js';
import {detailAssignments} from '../server/fragments.js';
import {researchAssignments} from '../server/research.js';
import {archiveCounts} from '../server/archive.js';

// Every keyword (not property name) used anywhere in a JSON Schema.
function keywords(node,found=new Set()){
 if(!node||typeof node!=='object')return found;
 for(const [key,value] of Object.entries(node)){
  found.add(key);
  if(key==='properties')Object.values(value).forEach(v=>keywords(v,found));
  else if(Array.isArray(value))value.forEach(v=>keywords(v,found));
  else if(typeof value==='object')keywords(value,found);
 }
 return found;
}
const documents=n=>Array.from({length:n},(_,i)=>({id:`r${i}`,filename:`source-${i}.txt`,relativePath:`training-data/scripts/source-${i}.txt`}));
function planner({count=10,research=4,tornEdges=true,enabledTransforms,useReferences=true,details=true}){
 const job=creationInput.parse({prompt:'Water and collective memory',requestId:'af4bbf1a-a20a-4622-8b71-290d6b4b3997',count,tornEdges,useReferences,...(enabledTransforms?{enabledTransforms}:{})});
 const people=archiveCounts(count).people,generated=count-people,archive=Array.from({length:people},(_,i)=>({id:`p${i}`}));
 const references=[{id:'g1',allowReference:true},{id:'w1',allowReference:true}];
 Object.assign(job,{humanContextIds:[],referenceAssignments:Object.fromEntries(Array.from({length:generated},(_,i)=>[`F${String(people+i+1).padStart(2,'0')}`,['g1','w1']]))});
 if(research){job.researchDocuments=documents(research);job.researchAssignments=researchAssignments(job.researchDocuments,count,generated);}
 if(details)job.detailAssignments=detailAssignments(count,generated);
 return advanceFor(archive,job,generated,[...archive,...references]);
}
const configurations=[
 ...[6,10,13,20].map(count=>({count})),{count:10,research:3},{count:10,research:6},{count:10,research:0},
 {count:10,tornEdges:false},{count:10,enabledTransforms:[]},{count:10,useReferences:false},{count:10,details:false},
];

test('every schema sent to providers uses only keywords their grammar engines have accepted',()=>{
 const schemas=[...configurations.map(c=>[`planner ${JSON.stringify(c)}`,planner(c)]),['grounding',observationSchema],['critique',critiqueSchema]];
 for(const [name,schema] of schemas){
  const {schema:json,removed}=providerSchema(schema);
  // Nothing should need removing: a removal means a schema drifted from the proven subset.
  assert.deepEqual(removed,[],`${name} needed ${removed.join(', ')} removed`);
  const unsupported=[...keywords(z.toJSONSchema(schema))].filter(k=>!GRAMMAR_KEYWORDS.has(k));
  assert.deepEqual(unsupported,[],`${name} uses ${unsupported.join(', ')}`);
  assert.equal(JSON.stringify(json).includes('propertyNames'),false,name);
 }
});

test('the guard strips unproven keywords; zod still enforces them on the answer',()=>{
 const schema=z.object({notes:z.record(z.string().max(4),z.string().max(10)),title:z.string().max(20)});
 const {schema:json,removed}=providerSchema(schema);
 assert.deepEqual(removed,['propertyNames']);assert.equal(JSON.stringify(json).includes('propertyNames'),false);
 assert.equal(json.properties.notes.additionalProperties.maxLength,10);assert.equal(json.properties.title.maxLength,20);
 assert.equal(schema.safeParse({notes:{toolong:'x'},title:'t'}).success,false);
});
