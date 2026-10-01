"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),x10=require("./index"),fs=require("fs"),path=require("path");
function base(id){return{incident_id:id,event_id:"evt_test_"+id,repository:"Brand_Samuray-",commit_sha:"0123456789abcdef0123456789abcdef01234567",failure_fingerprint:"test:failure:"+id,risk:"MEDIUM",proposal:{changedFiles:["src/fix.js"],diff:"--- a/src/fix.js\n+++ b/src/fix.js\n@@\n-const x = 1;\n+const x = 2;"},sandbox:{executor:async({run_id})=>({run_id,status:"PASSED",exit_code:0,timed_out:false})},critics:{kill_critic:{pass:true},security_critic:{pass:true}}};}
test("X10 full recovery reaches human approval",async()=>{const result=await x10.orchestrator.recover(base("full"));assert.equal(result.ok,true);assert.equal(result.incident.state,"HUMAN_APPROVAL_REQUIRED");assert.ok(result.incident.proof.proof_hash);});
test("policy blocks dangerous diff",()=>{const p=x10.policy.evaluate({repository:"Brand_Samuray-",commitSha:"abc",risk:"HIGH",attempt:1,changedFiles:["src/fix.js"],diff:"+rm -rf /"});assert.equal(p.decision,"BLOCK");});
test("kill switch stops new autonomy",async()=>{x10.kill.kill("test");await assert.rejects(()=>x10.orchestrator.recover(base("kill")),/AUTONOMY_KILLED/);x10.kill.resume();});
test("FSM rejects illegal jump",()=>{assert.throws(()=>x10.fsm.assertTransition("DETECTED","RESOLVED"),/INVALID_FSM_TRANSITION/);});
test("state ledger is hash-linked",()=>{const rows=x10.store.ledger("full");assert.ok(rows.length>=5);assert.equal(rows[1].previous_hash,rows[0].entry_hash);});
