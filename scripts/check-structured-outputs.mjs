// Checks that every provider the price check would choose accepts each response schema.
// Each request asks for at most 16 output tokens, so the whole check costs well under one cent.
// Run: node scripts/check-structured-outputs.mjs   (needs OPENROUTER_API_KEY in .env)
import 'dotenv/config';
import {pricingPlan,TEXT_MODELS} from '../server/budget.js';
import {routerRequest} from '../server/ai.js';
import {providerSchema} from '../server/structured.js';
import {creationInput,advanceFor} from '../server/plan.js';
import {observationSchema,critiqueSchema} from '../server/direction.js';
import {detailAssignments} from '../server/fragments.js';
import {researchAssignments} from '../server/research.js';
import {archiveCounts} from '../server/archive.js';

const count=Number(process.argv[2]||10),people=archiveCounts(count).people,generated=count-people;
const job=creationInput.parse({prompt:'Water and collective memory',requestId:'af4bbf1a-a20a-4622-8b71-290d6b4b3997',count});
const documents=Array.from({length:4},(_,i)=>({id:`r${i}`,filename:`source-${i}.txt`,relativePath:`training-data/scripts/source-${i}.txt`}));
Object.assign(job,{humanContextIds:[],researchDocuments:documents,researchAssignments:researchAssignments(documents,count,generated),detailAssignments:detailAssignments(count,generated),
 referenceAssignments:Object.fromEntries(Array.from({length:generated},(_,i)=>[`F${String(people+i+1).padStart(2,'0')}`,['g1','w1']]))});
const archive=Array.from({length:people},(_,i)=>({id:`p${i}`}));
const schemas={planner:[['Advance collage plan',advanceFor(archive,job,generated,[...archive,{id:'g1',allowReference:true},{id:'w1',allowReference:true}])],['Collage critique',critiqueSchema]],vision:[['Transformed image grounding',observationSchema]]};

const plan=await pricingPlan({count,generatedCount:generated});
let failures=0;
for(const [role,entries] of Object.entries(schemas))for(const [label,schema] of entries)for(const candidate of plan.text[role].candidates){
 const {schema:json,removed}=providerSchema(schema);
 const body={model:TEXT_MODELS[role],max_tokens:16,temperature:0,messages:[{role:'user',content:'Start the JSON answer.'}],
  response_format:{type:'json_schema',json_schema:{name:label.toLowerCase().replace(/[^a-z]/g,'_'),strict:true,schema:json}},
  provider:{only:[candidate.provider],allow_fallbacks:false,require_parameters:true}};
 try{const result=await routerRequest('chat/completions',body);console.log(`ok    ${role.padEnd(7)} ${label.padEnd(28)} ${candidate.provider.padEnd(16)} finish=${result.choices?.[0]?.finish_reason} cost=${result.usage?.cost??'?'}${removed.length?` removed=${removed}`:''}`);}
 catch(error){failures++;console.log(`FAIL  ${role.padEnd(7)} ${label.padEnd(28)} ${candidate.provider.padEnd(16)} ${error.code??''} ${error.message}`);}
}
process.exitCode=failures?1:0;
