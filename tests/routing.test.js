import test from 'node:test';
import assert from 'node:assert/strict';
import {Budget} from '../server/budget.js';
import {RouterError,routerRequest,retryableProviderError} from '../server/ai.js';
import {routedTextCall} from '../server/routing.js';

const candidates=[
 {provider:'dekallm',name:'DekaLLM',bound:.04,maxPrice:{prompt:.108,completion:.36},uptime:100},
 {provider:'nebius/fp8',name:'Nebius',bound:.06,maxPrice:{prompt:.5,completion:3},uptime:99},
];
function fixture(request){
 const job={ledger:[],warnings:[],events:[]};let saves=0;
 const persist=async()=>{saves++;};
 return {job,get saves(){return saves;},args:{job,budget:new Budget(job,persist),quote:{candidates,bound:.1},label:'Context search',body:{model:'qwen/test',messages:[],max_tokens:2000},request,persist}};
}

test('a rate-limited provider switches to the next checked provider with both attempts reserved',async()=>{
 const sent=[],f=fixture(async(endpoint,body)=>{
  assert.equal(endpoint,'chat/completions');assert.ok(f.saves>sent.length);sent.push(body);
  assert.equal(body.provider.allow_fallbacks,false);assert.equal(body.provider.require_parameters,true);
  if(body.provider.only[0]==='dekallm')throw new RouterError('Temporarily rate-limited upstream',{status:429,code:429,provider:'DekaLLM'});
  assert.equal(f.job.ledger.length,2);assert.equal(f.job.ledger[0].status,'uncertain');
  return {provider:'Nebius',usage:{cost:.002},choices:[{message:{content:'{}'}}]};
 });
 const result=await routedTextCall(f.args);
 assert.equal(result.provider,'Nebius');assert.deepEqual(sent.map(b=>b.provider.only),[['dekallm'],['nebius/fp8']]);
 assert.deepEqual(sent[1].provider.max_price,{prompt:.5,completion:3,request:0,image:0});
 assert.equal(f.args.budget.committed,.1);assert.equal(f.job.ledger[1].provider,'Nebius');
 assert.deepEqual(f.job.providerAttempts.map(a=>a.status),['failed','complete']);assert.match(f.job.warnings[0],/continued with Nebius/);
});

test('later steps avoid recently failed providers when another eligible provider exists',async()=>{
 const sent=[],f=fixture(async(_,body)=>{sent.push(body.provider.only[0]);return {usage:{cost:.001}};});
 await routedTextCall({...f.args,unavailable:new Set(['dekallm'])});assert.deepEqual(sent,['nebius/fp8']);
});

test('auth, credit, invalid-input and malformed-content errors never trigger provider retries',async()=>{
 for(const error of [new RouterError('Credits exhausted',{status:402,code:402}),new RouterError('Invalid key',{status:401,code:401}),new RouterError('Invalid prompt',{status:400,code:400}),new Error('Incomplete JSON'),new TypeError('Programming bug')]){
  let attempts=0;const f=fixture(async()=>{attempts++;throw error;});
  await assert.rejects(routedTextCall(f.args),e=>e===error);assert.equal(attempts,1);
 }
});

test('temporary upstream and network failures qualify, but failover stops when cancelled',async()=>{
 for(const code of [404,408,429,500,502,503,504])assert.ok(retryableProviderError(new RouterError('Temporary',{status:code,code})));
 assert.ok(retryableProviderError(Object.assign(new Error('timeout'),{name:'TimeoutError'})));
 assert.ok(retryableProviderError(new TypeError('fetch failed',{cause:{code:'ECONNRESET'}})));
 let calls=0;const f=fixture(async()=>{calls++;f.job.cancelRequested=true;throw new RouterError('Rate limited',{code:429});});
 await assert.rejects(routedTextCall(f.args),/stopped/);assert.equal(calls,1);
});

test('all-provider failures retain reservations and stop at the checked attempt count',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;throw new RouterError('Unavailable',{code:503});});
 await assert.rejects(routedTextCall(f.args),/Unavailable/);assert.equal(calls,2);assert.equal(f.args.budget.committed,.1);
 await assert.rejects(f.args.budget.reserve('too large','model',.91),/exceed/);
});

test('provider failover cannot bypass the budget guard',async()=>{
 let calls=0;const f=fixture(async()=>{calls++;throw new RouterError('Rate limited',{code:429});});
 await f.args.budget.reserve('previous work','model',.94);
 await assert.rejects(routedTextCall(f.args),/exceed/);assert.equal(calls,1);assert.equal(f.job.ledger.length,2);
});

test('router preserves upstream status/provider for failover and redacts key-shaped text',async t=>{
 const key=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='test-key';t.after(()=>{if(key===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=key;});
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({error:{code:429,message:'Provider returned error',metadata:{provider_name:'DekaLLM',raw:'rate limited sk-test-secret'}}}),{status:429,headers:{'Content-Type':'application/json'}}));
 await assert.rejects(routerRequest('chat/completions',{}),error=>error instanceof RouterError&&error.code===429&&error.provider==='DekaLLM'&&error.message.includes('[redacted]')&&!error.message.includes('sk-test-secret'));
});
