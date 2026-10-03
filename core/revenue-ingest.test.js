const test=require("node:test");
const assert=require("node:assert/strict");
const {signature,verifySignature,normalizeExternalEvent}=require("./revenue-ingest");
test("signed revenue event verifies deterministically",()=>{const body={tenantId:"t1",eventId:"pay_1",status:"WON",amountKZT:100000};const sig=signature("secret",body);assert.equal(verifySignature("secret",body,sig),true);assert.equal(verifySignature("wrong",body,sig),false);});
test("outcome normalization rejects unsupported states",()=>{assert.throws(()=>normalizeExternalEvent({eventId:"x",status:"PAID",amountKZT:1}),/Unsupported outcome/);});
test("outcome normalization preserves payment evidence",()=>{const x=normalizeExternalEvent({eventId:"pay_2",status:"WON",amountKZT:125000,customerId:"c1",externalReference:"invoice_2"});assert.equal(x.amountKZT,125000);assert.equal(x.externalReference,"invoice_2");});
