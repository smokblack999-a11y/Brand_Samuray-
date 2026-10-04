"use strict";
const crypto=require("node:crypto");
const {canonical}=require("./revenue-black-box");
function safeEqual(a,b){const x=Buffer.from(String(a||""));const y=Buffer.from(String(b||""));return x.length===y.length&&crypto.timingSafeEqual(x,y);}
function signature(secret,body){return crypto.createHmac("sha256",String(secret)).update(canonical(body)).digest("hex");}
function verifySignature(secret,body,provided){if(!secret||!provided)return false;const raw=String(provided).replace(/^sha256=/i,"");return safeEqual(signature(secret,body),raw);}
function normalizeExternalEvent(input={}){
 const provider=String(input.provider||"external").trim().slice(0,64);
 const eventId=String(input.eventId||input.id||"").trim().slice(0,256); if(!eventId) throw new Error("eventId is required");
 const status=String(input.status||input.outcome||"").trim().toUpperCase();
 const allowed=new Set(["WON","LOST","UNKNOWN","REFUNDED","CANCELLED"]); if(!allowed.has(status)) throw new Error("Unsupported outcome");
 const amount=Number(input.amountKZT!=null?input.amountKZT:input.amount||input.revenueKZT||0); if(!Number.isFinite(amount)||amount<0) throw new Error("amountKZT must be a non-negative number");
 return {
   eventId,
   provider,
   status,
   revenueKZT:amount,
   amountKZT:amount,
   currency:String(input.currency||"KZT").slice(0,8),
   actionId:input.actionId?String(input.actionId).slice(0,256):undefined,
   customerId:input.customerId?String(input.customerId).slice(0,256):undefined,
   externalReference:input.externalReference?String(input.externalReference).slice(0,256):undefined,
   occurredAt:input.occurredAt||new Date().toISOString(),
   grossMarginRate:input.grossMarginRate,
   baselineConversionProbability:input.baselineConversionProbability,
   controlConversionProbability:input.controlConversionProbability,
   treatmentConversionProbability:input.treatmentConversionProbability,
   attributionPolicy:input.attributionPolicy||"ASSISTED"
 };
}
module.exports={signature,verifySignature,normalizeExternalEvent};
