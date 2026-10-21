import test from 'node:test';
import assert from 'node:assert/strict';
import {Budget,imageQuote,textBound,pricingPlan,TEXT_MODELS,MAX_COST} from '../server/budget.js';
const quote=(cost=.04)=>({endpoints:[{provider_tag:'seed',supported_parameters:{resolution:{values:['2K']},input_references:{max:12}},pricing:[{billable:'output_image',unit:'image',cost_usd:cost},{billable:'input_image',unit:'image',cost_usd:0}]}]});
test('reservations persist before a paid call and failed calls cannot reclaim the ceiling',async()=>{
 const job={ledger:[]};let saved=0,calls=0;const budget=new Budget(job,async()=>{saved++;});
 await assert.rejects(budget.call('image','model',MAX_COST*.6,async()=>{assert.equal(saved,1);calls++;throw new Error('Network lost after submission');}),/Network lost/);
 assert.equal(job.ledger[0].status,'uncertain');
 await assert.rejects(budget.call('retry','model',MAX_COST*.5,async()=>{calls++;}),/exceed/);
 assert.equal(calls,1);assert.equal(budget.committed,MAX_COST*.6);
});
test('reported savings are not recycled into more calls',async()=>{
 const budget=new Budget({ledger:[]},async()=>{});
 await budget.call('one','model',MAX_COST*.8,async()=>({usage:{cost:.01}}));
 await assert.rejects(budget.reserve('two','model',MAX_COST*.21),/exceed/);
 assert.equal(budget.reported,.01);
});
test('an unreported charge remains reserved and a price mismatch halts execution',async()=>{
 const budget=new Budget({ledger:[]},async()=>{});
 await budget.call('unknown','model',.1,async()=>({}));
 assert.equal(budget.job.ledger[0].status,'unreported');assert.equal(budget.committed,.1);
 await assert.rejects(budget.call('changed','model',.1,async()=>({usage:{cost:.12}})),/above its reserved/);
});
test('image pricing rejects variable prices and excludes costly reference conditioning',()=>{
 assert.equal(imageQuote(quote(),'bytedance-seed/seedream-4.5').referenceLimit,2);
 const river=quote();river.endpoints[0].pricing.push({billable:'input_reference',unit:'image',cost_usd:.2});
 assert.equal(imageQuote(river,'sourceful/riverflow-v2-fast').referenceLimit,0);
 assert.equal(imageQuote(quote(.07),'seed').base,.07);
 const pixel=quote();pixel.endpoints[0].pricing[0].unit='megapixel';assert.throws(()=>imageQuote(pixel,'flux'),/variable/);
 const variants=quote(.02);variants.endpoints[0].pricing.push({billable:'output_image',unit:'image',variant:'2k',cost_usd:.04});
 assert.equal(imageQuote(variants,'sourceful/riverflow-v2-fast').reserved,.048);
});
test('text reservations include full context and search; six generated images plus research, planning, grounding and critique fit the ceiling',async()=>{
 assert.ok(Math.abs(textBound({context_length:131072},2500,true)-.0543216)<2e-8);
 assert.throws(()=>textBound({context_length:1000000},2500),/cannot be bounded/);
 const fetcher=(price=.04)=>async url=>({ok:true,json:async()=>url.endsWith('/models')?{data:Object.values(TEXT_MODELS).map(id=>({id,context_length:id.startsWith('mistral')?131072:262144}))}:url.includes('/images/')?quote(price):{data:{endpoints:[{tag:'test',context_length:131072,pricing:{prompt:.0000001,completion:.0000003},supported_parameters:['response_format','structured_outputs']}]}}});
 assert.ok((await pricingPlan({generatedCount:6,count:6},fetcher())).total<=MAX_COST);
 // Twenty images whose reservations alone exceed the ceiling stop before any charge.
 await assert.rejects(pricingPlan({generatedCount:20,count:20},fetcher(MAX_COST/20)),/limit is \$/);
});

test('premium token pricing fails closed before any charge',()=>{
 const q=quote();q.endpoints[0].pricing[0].unit='token';
 assert.throws(()=>imageQuote(q,'openai/gpt-image-2.5-sunburst'),/strict cost cap/);
});

const endpoint=(tag,prompt=.0000001,completion=.0000004,extra={})=>({tag,provider_name:tag,context_length:131072,pricing:{prompt,completion},supported_parameters:['response_format','structured_outputs'],uptime_last_30m:99,...extra});
const catalogueFetcher=(endpoints,imagePrice)=>async url=>({ok:true,json:async()=>url.endsWith('/models')?{data:Object.values(TEXT_MODELS).map(id=>({id}))}:url.includes('/images/')?quote(imagePrice):{data:{endpoints}}});

test('image-aware preflight excludes Venice from oversized steps while retaining it at ten images',async()=>{
 const fetcher=catalogueFetcher([endpoint('venice/fp8'),endpoint('deepinfra/fp8')]);
 const p=await pricingPlan({count:10,generatedCount:6,imageCounts:{research:0,planner:13,vision:10}},fetcher);
 assert.deepEqual(p.text.planner.candidates.map(c=>c.provider),['deepinfra/fp8']);
 assert.ok(p.text.vision.candidates.some(c=>c.provider==='venice/fp8'));assert.ok(p.total<=1);
 const large=await pricingPlan({count:20,generatedCount:12},fetcher);
 assert.equal(large.text.planner.imageCount,15);
 for(const role of ['planner','vision'])assert.equal(large.text[role].candidates.some(c=>c.provider==='venice/fp8'),false);
 // Ten images now send 9 archive images to planning, within Venice's limit; thirteen send 12.
 assert.equal((await pricingPlan({count:10,generatedCount:6},catalogueFetcher([endpoint('venice/fp8')]))).text.planner.imageCount,9);
 await assert.rejects(pricingPlan({count:13,generatedCount:8},catalogueFetcher([endpoint('venice/fp8')])),/with 1[23] input images.*No paid calls/);
});

test('provider pools admit healthier, more expensive alternatives beyond the old token-price ceiling',async()=>{
 const p=await pricingPlan({generatedCount:2,count:6},catalogueFetcher([endpoint('cheap'),endpoint('fast',.0000005,.000003,{uptime_last_30m:100,throughput_last_30m:150})]));
 for(const q of Object.values(p.text)){
  assert.equal(q.candidates.length,2);assert.equal(q.candidates[0].provider,'fast');
  assert.ok(q.candidates[0].maxPrice.prompt>.3);assert.ok(q.candidates[0].maxPrice.completion>2);
  assert.ok(Math.abs(q.bound-q.candidates.reduce((n,c)=>n+c.bound,0))<1e-7);
 }
 assert.ok(p.total<=1);
 const worst=p.text.research.bound+p.text.vision.bound+2*p.text.planner.bound+2*p.images[0].reserved;
 assert.ok(Math.abs(worst-p.total)<1e-7);
});

test('provider expansion preserves the entire workflow budget and caps each step at three attempts',async()=>{
 // 'expensive' alone would exceed the ceiling; it is healthiest, so it is tried first and rejected.
 const endpoints=[endpoint('a'),endpoint('b'),endpoint('c'),endpoint('d'),endpoint('expensive',MAX_COST/1e5,MAX_COST/1e5*3,{uptime_last_30m:100})];
 const small=await pricingPlan({generatedCount:2,count:6},catalogueFetcher(endpoints));
 for(const q of Object.values(small.text)){assert.equal(q.candidates.length,3);assert.ok(q.candidates.every(c=>c.provider!=='expensive'));}
 // Images priced to nearly fill the ceiling leave room for only some alternatives.
 const large=await pricingPlan({generatedCount:18,count:20},catalogueFetcher(endpoints,MAX_COST*.97/18/1.2));
 assert.ok(large.total<=MAX_COST);assert.ok(Object.values(large.text).some(q=>q.candidates.length<3));
});

test('unhealthy, unpriced, unsupported and ancillary-billed providers cannot enter a fallback pool',async()=>{
 const endpoints=[endpoint('good'),endpoint('offline',undefined,undefined,{status:1}),endpoint('no-json',undefined,undefined,{supported_parameters:[]}),endpoint('unknown-price',undefined,undefined,{pricing:{prompt:null,completion:.0000004}}),endpoint('flat-fee',undefined,undefined,{pricing:{prompt:.0000001,completion:.0000004,request:1}}),endpoint('oversized',undefined,undefined,{context_length:1000000})];
 const p=await pricingPlan({generatedCount:2,count:6},catalogueFetcher(endpoints));
 for(const q of Object.values(p.text))assert.deepEqual(q.candidates.map(c=>c.provider),['good']);
});
