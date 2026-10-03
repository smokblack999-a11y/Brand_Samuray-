"use strict";
const test=require("node:test");const assert=require("node:assert/strict");
const o=require("./autonomous-revenue-loop");
test("revenue loop follows controlled lifecycle",()=>{let x=o.createLoop({tenantId:"t1",leadId:"l1"});x=o.transition(x,"AUDITED",{audit:"ok"});x=o.transition(x,"DECISIONED",{action:"RESPOND"});x=o.transition(x,"EXECUTED",{actionId:"d1"});x=o.transition(x,"OUTCOME_PENDING");x=o.transition(x,"LEARNED",{outcomeStatus:"LOST"});assert.equal(x.state,"LEARNED");});
test("won outcome moves loop to attribution",()=>{let x=o.createLoop({tenantId:"t1",leadId:"l2"});x=o.transition(x,"AUDITED");x=o.transition(x,"DECISIONED");x=o.transition(x,"EXECUTED");x=o.transition(x,"OUTCOME_PENDING");x=o.closeFromOutcome(x,{status:"WON"});assert.equal(x.state,"ATTRIBUTED");});
test("invalid transition fails closed",()=>{const x=o.createLoop({tenantId:"t1",leadId:"l3"});assert.throws(()=>o.transition(x,"EXECUTED"),/invalid_loop_transition/);});
