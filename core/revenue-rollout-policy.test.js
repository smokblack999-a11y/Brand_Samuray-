const test=require('node:test');
const assert=require('node:assert/strict');
const {policy}=require('./revenue-rollout-policy');
test('shadow mode never sends',()=>assert.deepEqual(policy({reply:'x',autoReply:true,shadowMode:true,revenueGate:true,allowedByRevenue:true,criticVerdict:'PASS'}),{send:false,status:'SHADOWED',reason:'SHADOW_MODE'}));
test('revenue gate blocks failed critic',()=>assert.equal(policy({reply:'x',autoReply:true,shadowMode:false,revenueGate:true,allowedByRevenue:true,criticVerdict:'FAIL'}).send,false));
test('both gates permit send',()=>assert.deepEqual(policy({reply:'x',autoReply:true,shadowMode:false,revenueGate:true,allowedByRevenue:true,criticVerdict:'PASS'}),{send:true,status:'SENT',reason:'GATES_PASSED'}));
