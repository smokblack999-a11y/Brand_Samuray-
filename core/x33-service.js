"use strict";

const { createPool, close } = require("./revenue-postgres");
const { X33EconomicConsistency } = require("./x33-economic-consistency");

let pool = null;
let engine = null;

function enabled() {
  return String(process.env.X33_ENABLED || "false").toLowerCase() === "true";
}
function getEngine() {
  if (!enabled()) return null;
  if (engine) return engine;
  const url = process.env.X33_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) throw Object.assign(new Error("X33_XDATABASE_REQUIRED"), { code: "X33_DATABASE_REQUIRED" });
  pool = createPool(url);
  engine = new X33EconomicConsistency(pool, { maxReservationTtlMs: Number(process.env.X33_MAX_RESERVATION_TTL_MS || 900000) });
  return engine;
}
function microKzt(kzt) {
  const n = Number(kzt);
  if (!Number.isFinite(n) || n < 0) throw Object.assign(new Error("costKZT must be finite and non-negative"), { code: "X33_INVALID_COST" });
  return BigInt(Math.round(n * 1000000));
}
async function authorize(input={}) {
  const e=getEngine();
  if(!e)return {enabled:false,authorized:true,idempotentReplay:false};
  const estimateMicro=input.estimateMicro!=null?input.estimateMicro:microKzt(input.estimateKZT||0);
  if(BigInt(estimateMicro)<=0n)return {enabled:true,authorized:true,skipped:true,reason:"ZERO_COST"};
  const reservation=await e.reserve(null,{tenantId:input.tenantId,eventId:input.eventId,estimateMicro:String(estimateMicro),ttlMs:Number(input.ttlMs||900000)});
  return {enabled:true,authorized:true,reservation};
}
async function settle(input={}) {
  const e=getEngine();
  if(!e||!input.reservationId)return {enabled:Boolean(e),settled:false,skipped:true};
  const result=await e.settle(null,input.reservationId,String(input.actualMicro!=null?input.actualMicro:microKzt(input.actualKZT||0)));
  return {enabled:true,settled:true,result};
}
async function closeService(){if(pool)await close(pool);pool=null;engine=null;}
module.exports={enabled,getEngine,authorize,settle,closeService,microKzt};
