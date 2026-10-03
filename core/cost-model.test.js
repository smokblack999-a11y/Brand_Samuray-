const test=require('node:test');
const assert=require('node:assert/strict');
const {estimateKZT,ratesFromEnv}=require('./cost-model');
test('cost model prices configured token telemetry',()=>{const x=estimateKZT({usage:{input_tokens:1000000,output_tokens:500000,input_tokens_details:{cached_tokens:100000}},rates:{inputKZTPer1M:1000,outputKZTPer1M:2000,cachedInputKZTPer1M:200}});assert.equal(x.priced,true);assert.equal(x.amountKZT,1000);});
test('missing rates stay unpriced',()=>{const x=estimateKZT({usage:{input_tokens:100,output_tokens:50},rates:{}});assert.equal(x.priced,false);assert.equal(x.confidence,'UNPRICED');assert.equal(x.amountKZT,null);});
test('environment mapping is explicit',()=>{assert.equal(ratesFromEnv({OPENAI_INPUT_KZT_PER_1M:'1'}).inputKZTPer1M,'1');});
