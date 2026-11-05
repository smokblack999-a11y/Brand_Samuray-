"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const money = require("../money-orchestrator");

function readyForPayment() {
  let deal = money.createDeal({ id: "deal-1", leadId: "lead-1", source: "telegram" }, { at: "2026-11-05T10:00:00Z" });
  deal = money.qualifyDeal(deal, {
    confidence: 0.8,
    evidence: [{ kind: "buyer_request", source: "telegram_chat", reference: "message-77", observedAt: "2026-11-05T10:01:00Z", note: "Asked for price and delivery date" }]
  }, { at: "2026-11-05T10:02:00Z" });
  deal = money.attachOffer(deal, { id: "offer-1", name: "Pilot", scope: "Defined pilot scope", deliveryDays: 5, priceMinor: 50000, currency: "KZT" }, { at: "2026-11-05T10:03:00Z" });
  deal = money.acceptOffer(deal, { acceptedBy: "buyer-1", reference: "chat-confirmation-1" }, { at: "2026-11-05T10:04:00Z" });
  return money.markPaymentPending(deal, { invoiceReference: "invoice-1" }, { at: "2026-11-05T10:05:00Z" });
}

test("requires evidence before qualifying a lead", () => {
  const deal = money.createDeal({ id: "d", leadId: "l", source: "telegram" });
  assert.throws(() => money.qualifyDeal(deal, { evidence: [] }), { code: "EVIDENCE_REQUIRED" });
});

test("enforces the commercial pipeline in order", () => {
  const deal = readyForPayment();
  assert.equal(deal.stage, money.STAGES.PAYMENT_PENDING);
  assert.throws(() => money.markDelivered(deal, { evidenceReference: "proof", acceptedBy: "buyer" }), { code: "INVALID_TRANSITION" });
});

test("does not count an invoice or unverified payment as revenue", () => {
  const deal = readyForPayment();
  assert.throws(() => money.confirmPayment(deal, { verified: false, verificationMethod: "provider_webhook" }), { code: "PAYMENT_NOT_VERIFIED" });
  assert.equal(money.summarize([deal]).confirmedRevenueMinor, 0);
});

test("provider payment requires verified signature and full matching amount", () => {
  const deal = readyForPayment();
  assert.throws(() => money.confirmPayment(deal, {
    verified: true, verificationMethod: "provider_webhook", externalReference: "evt-1",
    verifiedBy: "stripe-adapter", amountMinor: 50000, currency: "KZT"
  }), { code: "PAYMENT_SIGNATURE_REQUIRED" });
  assert.throws(() => money.confirmPayment(deal, {
    verified: true, signatureVerified: true, verificationMethod: "provider_webhook",
    externalReference: "evt-2", verifiedBy: "stripe-adapter", amountMinor: 1000, currency: "KZT"
  }), { code: "PAYMENT_AMOUNT_MISMATCH" });
});

test("only confirmed payments count as revenue; delivery remains separate", () => {
  let deal = readyForPayment();
  deal = money.confirmPayment(deal, {
    verified: true, signatureVerified: true, verificationMethod: "provider_webhook",
    externalReference: "provider-event-123", verifiedBy: "verified-provider-adapter",
    amountMinor: 50000, currency: "KZT", verifiedAt: "2026-11-05T10:06:00Z"
  }, { at: "2026-11-05T10:06:00Z" });
  const paid = money.summarize([deal]);
  assert.equal(paid.confirmedRevenueMinor, 50000);
  assert.equal(paid.revenueCurrency, "KZT");
  assert.equal(paid.counts.paid, 1);
  deal = money.markDelivered(deal, { evidenceReference: "delivery-proof-1", acceptedBy: "buyer-1" }, { at: "2026-11-06T10:00:00Z" });
  const delivered = money.summarize([deal]);
  assert.equal(delivered.confirmedRevenueMinor, 50000);
  assert.equal(delivered.counts.delivered, 1);
});

test("manual reconciliation requires an audit reference", () => {
  const deal = readyForPayment();
  assert.throws(() => money.confirmPayment(deal, {
    verified: true, verificationMethod: "manual_reconciliation", externalReference: "bank-row-1",
    verifiedBy: "operator", amountMinor: 50000, currency: "KZT"
  }), { code: "RECONCILIATION_REFERENCE_REQUIRED" });
});

test("rejects currency mismatch and mixed currency totals are not converted", () => {
  const deal = readyForPayment();
  assert.throws(() => money.confirmPayment(deal, {
    verified: true, signatureVerified: true, verificationMethod: "provider_webhook",
    externalReference: "evt-3", verifiedBy: "provider", amountMinor: 50000, currency: "USD"
  }), { code: "PAYMENT_AMOUNT_MISMATCH" });
});

test("loss reason is mandatory and terminal deals cannot be lost", () => {
  let deal = readyForPayment();
  assert.throws(() => money.markLost(deal, {}), { code: "INVALID_INPUT" });
  deal = money.confirmPayment(deal, {
    verified: true, signatureVerified: true, verificationMethod: "provider_webhook",
    externalReference: "evt-4", verifiedBy: "provider", amountMinor: 50000, currency: "KZT"
  });
  assert.throws(() => money.markLost(deal, { reason: "changed mind" }), { code: "INVALID_TRANSITION" });
});
