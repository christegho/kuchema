import test from 'node:test';
import assert from 'node:assert/strict';
import {Budget} from '../server/budget.js';
import {RouterError,REQUEST_DEADLINE_MS,routerRequest,retryableProviderError,parseJsonResponse} from '../server/ai.js';
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

const visualBody=count=>({model:'qwen/qwen3-vl-235b-a22b-instruct',messages:[{role:'user',content:Array.from({length:count},(_,i)=>({type:'image_url',image_url:{url:`https://example.test/${i}.png`}}))}]});

test('unreadable successful HTTP responses fail over without losing images or reclaiming cost',async t=>{
 const key=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='test-key';t.after(()=>{if(key===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=key;});
 const quote={candidates:[{...candidates[0],provider:'parasail/fp8',name:'Parasail'},{...candidates[1],provider:'deepinfra/fp8',name:'DeepInfra'}]};
 for(const [raw,status] of [['',200],['<html>upstream error sk-private-secret</html>',200],['{"choices":',200],['null',200],['[]',200],['"unexpected response"',200],[null,204]]){
  const sent=[];
  t.mock.method(globalThis,'fetch',async(_,options)=>{
   assert.equal(options.headers.Accept,'application/json');sent.push(JSON.parse(options.body));
   return sent.length===1?new Response(raw,{status}):Response.json({provider:'DeepInfra',choices:[{message:{content:'{}'}}],usage:{cost:.001}});
  });
  const f=fixture(routerRequest),body=visualBody(13);
  await routedTextCall({...f.args,quote,body});
  assert.deepEqual(sent.map(b=>b.provider.only[0]),['parasail/fp8','deepinfra/fp8']);
  assert.deepEqual(sent[0].messages,sent[1].messages);assert.equal(f.args.budget.committed,.1);
  assert.equal(f.job.ledger[0].status,'uncertain');assert.equal(f.job.ledger[1].actual,.001);
  const failed=f.job.providerAttempts[0];assert.equal(failed.code,'UNREADABLE_RESPONSE');assert.equal(failed.httpStatus,status);
  assert.match(failed.error,/parasail\/fp8/);assert.ok(!failed.error.includes('sk-private-secret'));assert.ok(!failed.error.includes('<html>'));
 }
});

test('unreadable HTTP auth, credit and input errors remain terminal; gateway failures remain retryable',async t=>{
 const key=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='test-key';t.after(()=>{if(key===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=key;});
 for(const status of [400,401,402,403,422,429,502,503]){
  t.mock.method(globalThis,'fetch',async()=>new Response('<html>Error</html>',{status}));
  await assert.rejects(routerRequest('chat/completions',{}),error=>error instanceof RouterError&&error.status===status&&retryableProviderError(error)===[429,502,503].includes(status));
 }
});

test('unreadable responses from every candidate stop at the reserved attempt count',async t=>{
 const key=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='test-key';t.after(()=>{if(key===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=key;});
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('');});
 const f=fixture(routerRequest);
 await assert.rejects(routedTextCall(f.args),error=>error.code==='UNREADABLE_RESPONSE');
 assert.equal(calls,2);assert.equal(f.args.budget.committed,.1);assert.ok(f.job.ledger.every(r=>r.status==='uncertain'));
});

test('a deadline reached after HTTP 200 is a provider timeout that fails over, not an unreadable response',async t=>{
 const key=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='test-key';t.after(()=>{if(key===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=key;});
 const deadlines=[],timeout=AbortSignal.timeout;t.mock.method(AbortSignal,'timeout',ms=>{deadlines.push(ms);return timeout.call(AbortSignal,ms);});
 const quote={candidates:[{...candidates[0],provider:'parasail/fp8',name:'Parasail'},{...candidates[1],provider:'deepinfra/fp8',name:'DeepInfra'}]},sent=[];
 t.mock.method(globalThis,'fetch',async(_,options)=>{
  sent.push(JSON.parse(options.body).provider.only[0]);
  // OpenRouter has committed 200 and sent keep-alive whitespace when the client deadline fires.
  if(sent.length===1)return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('\n\n'));c.error(new DOMException('The operation was aborted due to timeout','TimeoutError'));}}),{status:200});
  return Response.json({provider:'DeepInfra',choices:[{message:{content:'{}'}}],usage:{cost:.001}});
 });
 const f=fixture(routerRequest),result=await routedTextCall({...f.args,quote,body:visualBody(13)});
 assert.equal(result.provider,'DeepInfra');assert.deepEqual(sent,['parasail/fp8','deepinfra/fp8']);
 assert.deepEqual(deadlines,[REQUEST_DEADLINE_MS,REQUEST_DEADLINE_MS]);assert.equal(REQUEST_DEADLINE_MS,300000);
 const failed=f.job.providerAttempts[0];assert.equal(failed.code,'TIMEOUT');assert.equal(failed.httpStatus,200);
 assert.match(failed.error,/parasail\/fp8 within 300 seconds/);assert.doesNotMatch(failed.error,/unreadable/);
 assert.equal(f.job.ledger[0].status,'uncertain');assert.equal(f.args.budget.committed,.1);
});

test('fetch header and body timeouts are retryable timeouts; a dropped body is still unreadable',async t=>{
 const key=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='test-key';t.after(()=>{if(key===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=key;});
 const body={provider:{only:['parasail/fp8']}};
 t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('fetch failed',{cause:{code:'UND_ERR_HEADERS_TIMEOUT'}});});
 await assert.rejects(routerRequest('chat/completions',body),error=>error instanceof RouterError&&error.code==='TIMEOUT'&&error.status===undefined&&error.provider==='parasail/fp8'&&retryableProviderError(error));
 for(const [code,expected] of [['UND_ERR_BODY_TIMEOUT','TIMEOUT'],['UND_ERR_SOCKET','UNREADABLE_RESPONSE']]){
  t.mock.method(globalThis,'fetch',async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"choices":'));c.error(new TypeError('terminated',{cause:{code}}));}}),{status:200}));
  await assert.rejects(routerRequest('chat/completions',body),error=>error.code===expected&&error.status===200&&retryableProviderError(error));
 }
 t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('fetch failed',{cause:{code:'ECONNRESET'}});});
 await assert.rejects(routerRequest('chat/completions',body),error=>!(error instanceof RouterError)&&retryableProviderError(error));
});

test('invalid JSON inside a readable model answer is distinct from a broken API response',async t=>{
 const key=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='test-key';t.after(()=>{if(key===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=key;});
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({choices:[{message:{content:'{"incomplete":'}}],usage:{cost:.001}});});
 const f=fixture(routerRequest),result=await routedTextCall(f.args);
 assert.throws(()=>parseJsonResponse(result),/incomplete plan/);assert.equal(calls,1);assert.equal(f.job.ledger[0].status,'complete');
});

test('oversized visual requests skip Venice without charging or dropping references',async()=>{
 const sent=[],f=fixture(async(_,body)=>{sent.push(body);return {usage:{cost:.001}};});
 const quote={candidates:[{...candidates[0],provider:'venice/fp8'},candidates[1]]};
 await routedTextCall({...f.args,quote,body:visualBody(13)});
 assert.equal(sent.length,1);assert.deepEqual(sent[0].provider.only,['nebius/fp8']);assert.equal(sent[0].messages[0].content.length,13);
 assert.equal(f.job.ledger.length,1);assert.equal(f.args.budget.committed,.06);
 const blocked=fixture(async()=>{throw new Error('Must not send');});
 await assert.rejects(routedTextCall({...blocked.args,quote:{candidates:[quote.candidates[0]]},body:visualBody(11)}),/No checked provider/);
 assert.equal(blocked.job.ledger.length,0);
 const boundary=fixture(async(_,body)=>{assert.deepEqual(body.provider.only,['venice/fp8']);return {usage:{cost:.001}};});
 await routedTextCall({...boundary.args,quote,body:visualBody(10)});
});

test('an unexpected provider image-count rejection switches providers with unchanged images and bounded cost',async()=>{
 const bodies=[],f=fixture(async(_,body)=>{
  bodies.push(body);
  if(bodies.length===1)throw new RouterError('Provider returned error: At most 10 image(s) may be provided in one request.',{status:400,code:400});
  return {usage:{cost:.001}};
 });
 await routedTextCall({...f.args,body:visualBody(13)});
 assert.equal(bodies.length,2);assert.deepEqual(bodies[0].messages,bodies[1].messages);
 assert.equal(f.job.ledger[0].status,'uncertain');assert.equal(f.args.budget.committed,.1);
 assert.equal(retryableProviderError(new RouterError('At most 10 image(s) may be provided in one request.',{code:400}),10),false);
 assert.equal(retryableProviderError(new RouterError('Invalid request parameters',{code:400}),13),false);
});

test('image-count limits survive truncation of long upstream validation errors',async t=>{
 const key=process.env.OPENROUTER_API_KEY;process.env.OPENROUTER_API_KEY='test-key';t.after(()=>{if(key===undefined)delete process.env.OPENROUTER_API_KEY;else process.env.OPENROUTER_API_KEY=key;});
 const raw=JSON.stringify({details:'x'.repeat(600),issues:[{code:'custom',message:'At most 10 image(s) may be provided in one request.',path:['messages',1,'content','content']}]});
 t.mock.method(globalThis,'fetch',async()=>new Response(JSON.stringify({error:{code:400,message:'Provider returned error',metadata:{provider_name:'Venice',raw}}}),{status:400}));
 await assert.rejects(routerRequest('chat/completions',{}),error=>error.message.length<=500&&error.maxInputImages===10&&retryableProviderError(error,13));
});

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
 assert.ok(retryableProviderError(new RouterError('Did not finish',{status:200,code:'TIMEOUT'})));
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
