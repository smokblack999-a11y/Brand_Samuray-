"use strict";

// Deterministic business-state rules. This module does not send messages,
// charge cards, verify provider signatures, or persist data.
// The API adapter must authenticate the actor and verify payment evidence
// with the provider (or a documented manual reconciliation) before calling
// confirmPayment(). Never pass browser/Telegram claims directly as proof.

const STAGES = Object.freeze({
  NEW: "new_lead",
  QUALIFIED: "qualified",
  OFFER_SENT: "offer_sent",
  ACCEPTED: "accepted",
  PAYMENT_PENDING: "payment_pending",
  PAID: "paid",
  DELIVERED: "delivered",
  LOST: "lost"
});

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function isoNow(value) {
  const date = value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(date.getTime())) fail("INVALID_TIMESTAMP", "A valid timestamp is required");
  return date.toISOString();
}

function requiredText(value, field) {
  const text = String(value || "").trim();
  if (!text) fail("INVALID_INPUT", field + " is required");
  return text;
}

function money(amountMinor, currency) {
  const amount = Number(amountMinor);
  const code = String(currency || "").trim().toUpperCase();
  if (!Number.isSafeInteger(amount) || amount <= 0) fail("INVALID_AMOUNT", "amountMinor must be a positive integer in minor currency units");
  if (!/^[A-Z]{3}$/.test(code)) fail("INVALID_CURRENCY", "currency must be a three-letter ISO currency code");
  return { amountMinor: amount, currency: code };
}

function appendEvent(deal, type, actor, at, data = {}) {
  return {
    ...deal,
    updatedAt: at,
    events: [...deal.events, { type, at, actor: requiredText(actor, "actor"), data }]
  };
}

function createDeal(input = {}, options = {}) {
  const at = isoNow(options.at);
  const id = requiredText(input.id, "id");
  const leadId = requiredText(input.leadId, "leadId");
  const source = requiredText(input.source, "source");
  return {
    id,
    leadId,
    source,
    stage: STAGES.NEW,
    createdAt: at,
    updatedAt: at,
    qualification: null,
    offer: null,
    acceptance: null,
    payment: null,
    delivery: null,
    loss: null,
    events: [{ type: "lead_created", at, actor: requiredText(options.actor || "system", "actor"), data: { leadId, source } }]
  };
}

function qualifyDeal(deal, input = {}, options = {}) {
  if (deal.stage !== STAGES.NEW) fail("INVALID_TRANSITION", "Only a new lead can be qualified");
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  if (!evidence.length) fail("EVIDENCE_REQUIRED", "Qualification requires at least one demand evidence item");
  const normalized = evidence.map((item) => ({
    kind: requiredText(item.kind, "evidence.kind"),
    source: requiredText(item.source, "evidence.source"),
    reference: requiredText(item.reference, "evidence.reference"),
    observedAt: isoNow(item.observedAt),
    note: String(item.note || "").trim()
  }));
  const at = isoNow(options.at);
  const next = { ...deal, stage: STAGES.QUALIFIED, qualification: { evidence: normalized, confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)) } };
  return appendEvent(next, "lead_qualified", options.actor || "operator", at, { evidenceCount: normalized.length });
}

function attachOffer(deal, input = {}, options = {}) {
  if (deal.stage !== STAGES.QUALIFIED) fail("INVALID_TRANSITION", "An offer can only be attached to a qualified lead");
  const price = money(input.priceMinor, input.currency);
  const offer = {
    id: requiredText(input.id, "offer.id"),
    name: requiredText(input.name, "offer.name"),
    scope: requiredText(input.scope, "offer.scope"),
    deliveryDays: Number(input.deliveryDays),
    ...price
  };
  if (!Number.isSafeInteger(offer.deliveryDays) || offer.deliveryDays < 1) fail("INVALID_DELIVERY_DAYS", "deliveryDays must be a positive integer");
  const at = isoNow(options.at);
  return appendEvent({ ...deal, stage: STAGES.OFFER_SENT, offer }, "offer_sent", options.actor || "operator", at, { offerId: offer.id, priceMinor: offer.priceMinor, currency: offer.currency });
}

function acceptOffer(deal, input = {}, options = {}) {
  if (deal.stage !== STAGES.OFFER_SENT) fail("INVALID_TRANSITION", "Only a sent offer can be accepted");
  const at = isoNow(options.at);
  const acceptedBy = requiredText(input.acceptedBy, "acceptedBy");
  return appendEvent({ ...deal, stage: STAGES.ACCEPTED, acceptance: { acceptedBy, reference: requiredText(input.reference, "acceptance.reference"), acceptedAt: at } }, "offer_accepted", options.actor || acceptedBy, at);
}

function markPaymentPending(deal, input = {}, options = {}) {
  if (deal.stage !== STAGES.ACCEPTED) fail("INVALID_TRANSITION", "Payment can only be requested after offer acceptance");
  const at = isoNow(options.at);
  const payment = {
    status: "pending",
    invoiceReference: requiredText(input.invoiceReference, "invoiceReference"),
    requestedAt: at
  };
  return appendEvent({ ...deal, stage: STAGES.PAYMENT_PENDING, payment }, "payment_requested", options.actor || "operator", at, { invoiceReference: payment.invoiceReference });
}

function confirmPayment(deal, proof = {}, options = {}) {
  if (deal.stage !== STAGES.PAYMENT_PENDING) fail("INVALID_TRANSITION", "Only a pending payment can be confirmed");
  const method = requiredText(proof.verificationMethod, "verificationMethod");
  if (!["provider_webhook", "manual_reconciliation"].includes(method)) fail("INVALID_VERIFICATION_METHOD", "Unsupported payment verification method");
  if (proof.verified !== true) fail("PAYMENT_NOT_VERIFIED", "Payment proof has not been verified");
  const reference = requiredText(proof.externalReference, "externalReference");
  const verifiedBy = requiredText(proof.verifiedBy, "verifiedBy");
  const verifiedAt = isoNow(proof.verifiedAt || options.at);
  if (method === "provider_webhook" && proof.signatureVerified !== true) fail("PAYMENT_SIGNATURE_REQUIRED", "Provider webhook signature must be verified");
  if (method === "manual_reconciliation" && !String(proof.reconciliationReference || "").trim()) fail("RECONCILIATION_REFERENCE_REQUIRED", "Manual reconciliation requires an auditable reference");
  const received = money(proof.amountMinor, proof.currency);
  if (received.currency !== deal.offer.currency || received.amountMinor < deal.offer.priceMinor) {
    fail("PAYMENT_AMOUNT_MISMATCH", "Verified payment must cover the full offer amount in the offer currency");
  }
  const payment = { status: "confirmed", ...received, verificationMethod: method, externalReference: reference, verifiedBy, verifiedAt, reconciliationReference: proof.reconciliationReference || null };
  return appendEvent({ ...deal, stage: STAGES.PAID, payment }, "payment_confirmed", options.actor || verifiedBy, isoNow(options.at || verifiedAt), { amountMinor: received.amountMinor, currency: received.currency, externalReference: reference });
}

function markDelivered(deal, input = {}, options = {}) {
  if (deal.stage !== STAGES.PAID) fail("INVALID_TRANSITION", "Delivery can only be recorded after confirmed payment");
  const at = isoNow(options.at);
  const delivery = { deliveredAt: at, evidenceReference: requiredText(input.evidenceReference, "evidenceReference"), acceptedBy: requiredText(input.acceptedBy, "acceptedBy") };
  return appendEvent({ ...deal, stage: STAGES.DELIVERED, delivery }, "delivery_completed", options.actor || "operator", at, delivery);
}

function markLost(deal, input = {}, options = {}) {
  if ([STAGES.PAID, STAGES.DELIVERED, STAGES.LOST].includes(deal.stage)) fail("INVALID_TRANSITION", "Paid, delivered, or already-lost deals cannot be marked lost");
  const at = isoNow(options.at);
  const loss = { reason: requiredText(input.reason, "reason"), recordedAt: at };
  return appendEvent({ ...deal, stage: STAGES.LOST, loss }, "deal_lost", options.actor || "operator", at, loss);
}

function summarize(deals = []) {
  const rows = Array.isArray(deals) ? deals : [];
  const counts = Object.fromEntries(Object.values(STAGES).map(stage => [stage, 0]));
  let confirmedRevenueMinor = 0;
  const currencies = new Set();
  for (const deal of rows) {
    if (counts[deal.stage] !== undefined) counts[deal.stage] += 1;
    if ([STAGES.PAID, STAGES.DELIVERED].includes(deal.stage) && deal.payment?.status === "confirmed") {
      confirmedRevenueMinor += Number(deal.payment.amountMinor) || 0;
      if (deal.payment.currency) currencies.add(deal.payment.currency);
    }
  }
  return {
    dealCount: rows.length,
    counts,
    confirmedRevenueMinor,
    revenueCurrency: currencies.size === 1 ? [...currencies][0] : currencies.size === 0 ? null : "MIXED",
    revenueIsMixedCurrency: currencies.size > 1,
    note: "Only deals with confirmed payment evidence are included; mixed currencies are not converted."
  };
}

module.exports = {
  STAGES,
  createDeal,
  qualifyDeal,
  attachOffer,
  acceptOffer,
  markPaymentPending,
  confirmPayment,
  markDelivered,
  markLost,
  summarize
};
