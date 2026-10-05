"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const {asMicro,allocateSettlement,canonical,fingerprint,ledgerHash,STATUS,OP,TRANSITIONS} = require("./x33-economic-consistency");

test("micro-KZT uses integer BIGINT semantics",()=>{
  assert.equal(asMicro("1500000"),1500000n);
  assert.throws(()=>asMicro(1.5),/integer/);
  assert.throws(()=>asMicro("1.2"),/integer/);
  assert.throws(()=>asMicro("9223372036854775808"),/BIGINT/);
});

test("normal settlement releases reservation and spends actual",()=>{
  const r=allocateSettlement({limit:10000000,spent:2000000,committed:3000000,reserved:3000000,actual:2500000,wasExpired:false});
  assert.equal(r.authorizedSpend,2500000n);
  assert.equal(r.unbudgetedDelta,0n);
  assert.equal(r.newSpent,4500000n);
  assert.equal(r.newCommitted,0n);
  assert.equal(r.status,STATUS.SETTLED);
});

test("overflow preserves exact provider cost instead of writing actual zero",()=>{
  const r=allocateSettlement({limit:10000000,spent:8500000,committed:1000000,reserved:1000000,actual:3000000,wasExpired:false});
  assert.equal(r.authorizedSpend,1500000n);
  assert.equal(r.unbudgetedDelta,1500000n);
  assert.equal(r.newSpent,10000000n);
  assert.equal(r.newCommitted,0n);
  assert.equal(r.status,STATUS.OVERFLOW_REJECTED);
  assert.equal(r.operation,OP.SETTLE_OVERAGE);
});

test("late settlement after expiry becomes explicit unbudgeted actual",()=>{
  const r=allocateSettlement({limit:10000000,spent:2000000,committed:0,reserved:1000000,actual:500000,wasExpired:true});
  assert.equal(r.authorizedSpend,0n);
  assert.equal(r.unbudgetedDelta,500000n);
  assert.equal(r.status,STATUS.SETTLED_AFTER_EXPIRY);
  assert.equal(r.operation,OP.SETTLE_AFTER_EXPIRY);
});

test("hash/fingerprint are deterministic",()=>{
  assert.equal(canonical({b:2,a:1}),canonical({a:1,b:2}));
  assert.equal(fingerprint({tenantId:"t",eventId:"e",estimateMicro:"10",ttlMs:1000}),fingerprint({ttlMs:1000,estimateMicro:"10",eventId:"e",tenantId:"t"}));
  const packet={tenantId:"t",reservationId:"r",eventId:"e",operation:"RESERVE",operationKey:"k",deltaSpentMicro:"0",deltaCommittedMicro:"10",deltaUnbudgetedMicro:"0",previousSpentMicro:"0",newSpentMicro:"0",previousCommittedMicro:"0",newCommittedMicro:"10",previousUnbudgetedMicro:"0",newUnbudgetedMicro:"0",createdAt:"2026-10-04T00:00:00.000Z"};
  assert.equal(ledgerHash(packet,null),ledgerHash({...packet},null));
});

test("ARMED is not a spending state",()=>{
  assert.deepEqual([...TRANSITIONS.ARMED],["ACTIVE"]);
  assert.equal(TRANSITIONS.ARMED.has("TRIPPED"),false);
});

test("settlement refuses signed BIGINT overflow",()=>{
  assert.throws(
    ()=>allocateSettlement({
      limit:"9223372036854775807",
      spent:"9223372036854775807",
      committed:"0",
      reserved:"1",
      actual:"1",
      wasExpired:false
    }),
    /BIGINT overflow/
  );
});

test("autonomy transitions are a strict one-way recovery path",()=>{
  assert.equal(TRANSITIONS.ACTIVE.has("MANUAL_REVIEW"),false);
  assert.equal(TRANSITIONS.TRIPPED.has("ACTIVE"),false);
  assert.equal(TRANSITIONS.MANUAL_REVIEW.has("ARMED"),true);
  assert.equal(TRANSITIONS.ARMED.has("ACTIVE"),true);
});

test("overflow is bounded: authorized spend never exceeds remaining budget",()=>{
  const r=allocateSettlement({
    limit:"1000000",
    spent:"999999",
    committed:"1",
    reserved:"1",
    actual:"999999999999",
    wasExpired:false
  });
  assert.equal(r.authorizedSpend,0n);
  assert.equal(r.unbudgetedDelta,999999999999n);
  assert.equal(r.newSpent,999999n);
  assert.equal(r.newCommitted,0n);
});


test("idempotency fingerprint changes when economic reservation terms change",()=>{
  const base={tenantId:"t1",eventId:"e1",estimateMicro:"1000000",ttlMs:60000};
  assert.notEqual(fingerprint(base),fingerprint({...base,estimateMicro:"1000001"}));
  assert.notEqual(fingerprint(base),fingerprint({...base,ttlMs:60001}));
});

test("settlement overage within remaining budget remains authorized",()=>{
  const r=allocateSettlement({
    limit:"10000000",
    spent:"2000000",
    committed:"3000000",
    reserved:"1000000",
    actual:"4000000",
    wasExpired:false
  });
  assert.equal(r.authorizedSpend,4000000n);
  assert.equal(r.unbudgetedDelta,0n);
  assert.equal(r.newSpent,6000000n);
  assert.equal(r.newCommitted,2000000n);
  assert.equal(r.status,STATUS.SETTLED_WITH_OVERAGE);
});

test("expired reservation never silently consumes budget",()=>{
  const r=allocateSettlement({
    limit:"10000000",
    spent:"9000000",
    committed:"0",
    reserved:"1000000",
    actual:"500000",
    wasExpired:true
  });
  assert.equal(r.authorizedSpend,0n);
  assert.equal(r.unbudgetedDelta,500000n);
  assert.equal(r.newSpent,9000000n);
  assert.equal(r.newCommitted,0n);
});
