import test from 'node:test';
import assert from 'node:assert/strict';
import {Budget,imageQuote,textBound,pricingPlan,TEXT_MODELS} from '../server/budget.js';
const quote=(cost=.04)=>({endpoints:[{provider_tag:'seed',supported_parameters:{resolution:{values:['2K']},input_references:{max:12}},pricing:[{billable:'output_image',unit:'image',cost_usd:cost},{billable:'input_image',unit:'image',cost_usd:0}]}]});
test('reservations persist before a paid call and failed calls cannot reclaim the ceiling',async()=>{
 const job={ledger:[]};let saved=0,calls=0;const budget=new Budget(job,async()=>{saved++;});
 await assert.rejects(budget.call('image','model',.6,async()=>{assert.equal(saved,1);calls++;throw new Error('Network lost after submission');}),/Network lost/);
 assert.equal(job.ledger[0].status,'uncertain');
 await assert.rejects(budget.call('retry','model',.5,async()=>{calls++;}),/exceed/);
 assert.equal(calls,1);assert.equal(budget.committed,.6);
});
test('reported savings are not recycled into more calls',async()=>{
 const budget=new Budget({ledger:[]},async()=>{});
 await budget.call('one','model',.8,async()=>({usage:{cost:.01}}));
 await assert.rejects(budget.reserve('two','model',.21),/exceed/);
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
 const fetcher=async url=>({ok:true,json:async()=>url.endsWith('/models')?{data:Object.values(TEXT_MODELS).map(id=>({id,context_length:id.startsWith('mistral')?131072:262144}))}:url.includes('/images/')?quote():{data:{endpoints:[{tag:'test',context_length:131072,pricing:{prompt:.0000001,completion:.0000003},supported_parameters:['response_format','structured_outputs']}]}}});
 assert.ok((await pricingPlan({generatedCount:6,count:6},fetcher)).total<=1);
 await assert.rejects(pricingPlan({generatedCount:20,count:20},fetcher),/limit is/);
});

test('premium token pricing fails closed before any charge',()=>{
 const q=quote();q.endpoints[0].pricing[0].unit='token';
 assert.throws(()=>imageQuote(q,'openai/gpt-image-2.5-sunburst'),/strict \$1.00 cap/);
});
