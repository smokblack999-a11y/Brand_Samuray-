"use strict";

function positive(v){const n=Number(v);return Number.isFinite(n)&&n>0?n:0;}
function estimateKZT(input={}){
  const usage=input.usage||{};
  const rates=input.rates||{};
  const inputTokens=positive(usage.input_tokens||usage.prompt_tokens||0);
  const outputTokens=positive(usage.output_tokens||usage.completion_tokens||0);
  const cachedTokens=positive(usage.input_tokens_details?.cached_tokens||usage.prompt_tokens_details?.cached_tokens||0);
  const inRate=positive(rates.inputKZTPer1M);
  const outRate=positive(rates.outputKZTPer1M);
  const cachedRate=positive(rates.cachedInputKZTPer1M);
  const uncachedInput=Math.max(0,inputTokens-cachedTokens);
  const inputCost=inRate>0?uncachedInput/1000000*inRate:null;
  const outputCost=outRate>0?outputTokens/1000000*outRate:null;
  const cachedCost=cachedTokens>0&&cachedRate>0?cachedTokens/1000000*cachedRate:(cachedTokens>0&&inRate>0?cachedTokens/1000000*inRate:null);
  if(inputCost===null||outputCost===null||(cachedTokens>0&&cachedCost===null)) return {priced:false,confidence:"UNPRICED",amountKZT:null,inputTokens,outputTokens,cachedTokens};
  return {priced:true,confidence:"CONFIGURED_ESTIMATE",amountKZT:Number((inputCost+outputCost+(cachedCost||0)).toFixed(6)),inputTokens,outputTokens,cachedTokens};
}
function ratesFromEnv(env=process.env){return {inputKZTPer1M:env.OPENAI_INPUT_KZT_PER_1M,outputKZTPer1M:env.OPENAI_OUTPUT_KZT_PER_1M,cachedInputKZTPer1M:env.OPENAI_CACHED_INPUT_KZT_PER_1M};}
module.exports={estimateKZT,ratesFromEnv};
