import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createStore} from '../server/store.js';
import {routerRequest} from '../server/ai.js';
import {CreationPipeline} from '../server/pipeline.js';
if(process.env.RUN_LIVE_AI!=='1')throw new Error('Set RUN_LIVE_AI=1 to run this paid integration test (maximum: CREATION_COST_LIMIT, default $5.00).');
const dir=path.resolve(process.env.LIVE_TEST_DIR||'test-results/dense-studio');
const store=await createStore(dir);await store.importDirectory(path.resolve('images_test'),true);
const cache=path.join(dir,'responses');await fs.mkdir(cache,{recursive:true});
for(const a of store.state.assets.filter(a=>a.kind==='source'&&!a.derived))a.allowReference=true;
await store.persist();
let newCharges=0;
const pipeline=new CreationPipeline(store,{request:async(endpoint,body)=>{
 const file=path.join(cache,createHash('sha256').update(JSON.stringify({endpoint,body})).digest('hex')+'.json');
 try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const result=await routerRequest(endpoint,body);newCharges+=result.usage?.cost||0;
 await fs.writeFile(file,JSON.stringify(result));return result;
}});
let timer;
try{
 const job=await pipeline.start({prompt:'Compose an edge-to-edge photographic collage of water, gathering and environmental regeneration. Let large water and rock surfaces become a continuous but visibly assembled ground; place human gestures and plant forms in a deliberate relation to its flow. Use six distinct images. Broad SAM-bounded context fields should overlap to fill every edge, with silhouettes above. Transform the new material before cutting it, with a reason tied to its generated origin. Do not infer where the sample photos were taken, invent ritual symbols, or imitate a finished artwork.',contextText:'The project concerns Chikukwa and Chimanimani, but these five test photos have no verified location. Treat them as a test archive only. Use their physical material relationships, not assumed cultural identities.',ids:[],count:6,includeArchive:true,useReferences:true,transformations:true,imageModel:'economy',aesthetic:'cut-paper',generation:'needed',requestId:randomUUID()});
 console.log('Creation',job.id);let last='';timer=setInterval(()=>{if(last!==job.stage){last=job.stage;console.log(job.stage, 'reported USD',job.ledger.reduce((s,r)=>s+(r.actual||0),0));}},2000);
 await pipeline.running;
 console.log('New charges this test run',newCharges);
 console.log('Result',job.status,job.error||'', 'reported USD',job.ledger.reduce((s,r)=>s+(r.actual||0),0),'reserved USD',job.ledger.reduce((s,r)=>s+r.reserved,0));
 await fs.writeFile('test-results/live-pipeline-usage.json',JSON.stringify(job,null,2));
 if(job.status!=='complete')process.exitCode=1;
}finally{clearInterval(timer);pipeline.vision.close();}
