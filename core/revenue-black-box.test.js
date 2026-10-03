const test=require('node:test');
const assert=require('node:assert/strict');
const {canonical,hashPacket,sealRecord,verifyEvidenceChain}=require('./revenue-black-box');
test('canonical hashing ignores object key order',()=>{assert.equal(hashPacket({a:1,b:2}),hashPacket({b:2,a:1}));});
test('hash chain detects tampering',()=>{const a=sealRecord({id:'a',tenantId:'t'},null);const b=sealRecord({id:'b',tenantId:'t'},a.recordHash);assert.equal(verifyEvidenceChain([a,b]).ok,true);b.id='tampered';assert.equal(verifyEvidenceChain([a,b]).ok,false);});
test('canonical arrays remain ordered',()=>{assert.notEqual(canonical([1,2]),canonical([2,1]));});
