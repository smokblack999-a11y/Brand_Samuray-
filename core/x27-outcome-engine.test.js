const test=require('node:test');
const assert=require('node:assert/strict');
const {normalizeOutcome,evaluateAttribution}=require('./x27-outcome-engine');
test('won outcome calculates gross profit',()=>{const x=normalizeOutcome({status:'WON',revenueKZT:800000,grossMarginRate:.25});assert.equal(x.realizedGrossProfitKZT,200000);});
test('assisted attribution credits incremental share',()=>{const x=evaluateAttribution({status:'WON',revenueKZT:800000,grossMarginRate:.25},.25,'ASSISTED');assert.equal(x.attributableGrossProfitKZT,150000);});
test('refund is a reversal',()=>{const x=evaluateAttribution({status:'REFUNDED',revenueKZT:800000,grossMarginRate:.25},.25,'ASSISTED');assert.equal(x.attributableRevenueKZT,-800000);assert.equal(x.attributableGrossProfitKZT,-200000);});
