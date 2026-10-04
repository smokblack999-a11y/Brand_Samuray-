"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {analyzeLeadLoss,minutesBetween}=require("./x28-revenue-rca");
test("RCA computes response delay as a hypothesis",()=>{const r=analyzeLeadLoss([{type:"customer.message",ts:"2026-10-03T10:00:00Z",payload:{text:"Сколько стоит?"}},{type:"manager.response",ts:"2026-10-03T10:45:00Z",payload:{text:"Цена 800000"}}],{responseSlaMinutes:15,dealValue:800000,baselineConversionProbability:.25,grossMargin:.25});assert.equal(r.primaryHypothesis,"RESPONSE_DELAY");assert.equal(r.causalityStatus,"HYPOTHESIS_ONLY");assert.equal(r.latencyMinutes,45);assert.equal(r.expectedGrossProfitAtRiskKZT,50000);});
test("RCA exposes alternatives and telemetry quality",()=>{const r=analyzeLeadLoss([{type:"customer.message",ts:"2026-10-03T10:00:00Z",payload:{text:"дорого",intent:"price"}}],{dealValue:100000,grossMargin:.3,baselineConversionProbability:.2});assert.equal(r.primaryHypothesis,"UNHANDLED_OBJECTION");assert.equal(r.telemetryQuality.customerMessages,1);});
test("unknown is explicit when evidence is insufficient",()=>{const r=analyzeLeadLoss([],{});assert.equal(r.primaryHypothesis,"UNKNOWN");assert.equal(r.causalityStatus,"HYPOTHESIS_ONLY");});
test("invalid time interval returns null",()=>{assert.equal(minutesBetween("bad","2026-10-03T10:00:00Z"),null);});
