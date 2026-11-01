"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vdi = require("./index");
const NOW = Date.parse("2026-11-01T10:00:00.000Z");
function event(overrides = {}) {
  return {
    event_id: "evt-001", source_id: "camera-gate-a", event_type: "ENTRY",
    occurred_at: "2026-11-01T09:59:00.000Z", received_at: "2026-11-01T09:59:01.000Z",
    site_id: "site-demo", lane_id: "lane-01", source_payload_hash: "a".repeat(64),
    ocr_confidence: 0.99, ...overrides
  };
}
test("accepts a well-formed recent event", () => {
  const result = vdi.validateEvent(event(), { nowMs: NOW });
  assert.equal(result.valid, true);
  assert.deepEqual(result.errors, []);
});
test("rejects missing identity, malformed hash and unsupported event type", () => {
  const result = vdi.validateEvent(event({ event_id: "", event_type: "PAYMENT", source_payload_hash: "bad" }), { nowMs: NOW });
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("event_id_required"));
  assert.ok(result.errors.includes("event_type_unsupported"));
  assert.ok(result.errors.includes("source_payload_hash_invalid"));
});
test("routes low-confidence OCR to REVIEW, never automatic DENY", () => {
  const result = vdi.evaluateEvent(event({ ocr_confidence: 0.2 }), { nowMs: NOW, sourceAuthenticated: true, matchedSession: true });
  assert.equal(result.decision, "REVIEW");
  assert.equal(result.requires_human_review, true);
  assert.equal(result.physical_action_performed, false);
  assert.ok(result.reason_codes.includes("ocr_confidence_below_threshold"));
});
test("allows only validated authenticated event with configured checks passing", () => {
  const result = vdi.evaluateEvent(event(), { nowMs: NOW, sourceAuthenticated: true, matchedSession: true });
  assert.equal(result.decision, "ALLOW");
  assert.equal(result.mode, "SHADOW_ONLY");
  assert.equal(result.physical_action_performed, false);
});
test("unauthenticated, duplicate, conflicting and impossible events go to REVIEW", () => {
  const cases = [
    [{ sourceAuthenticated: false }, "source_not_authenticated"],
    [{ sourceAuthenticated: true, duplicate: true }, "duplicate_event_id"],
    [{ sourceAuthenticated: true, conflictingReads: true }, "conflicting_vehicle_reads"],
    [{ sourceAuthenticated: true, impossibleSequence: true }, "impossible_event_sequence"]
  ];
  for (const [options, reason] of cases) {
    const result = vdi.evaluateEvent(event(), { nowMs: NOW, ...options });
    assert.equal(result.decision, "REVIEW");
    assert.ok(result.reason_codes.includes(reason));
  }
});
test("future and stale events are not automatically allowed", () => {
  const future = vdi.validateEvent(event({ occurred_at: "2026-11-01T11:00:00.000Z" }), { nowMs: NOW });
  const stale = vdi.validateEvent(event({ occurred_at: "2026-10-01T00:00:00.000Z" }), { nowMs: NOW });
  assert.ok(future.errors.includes("event_from_future"));
  assert.ok(stale.errors.includes("event_too_old"));
});
test("HMAC source signature verifies exact raw bytes and rejects tampering", () => {
  const body = Buffer.from(JSON.stringify(event()));
  const secret = "test-secret-that-is-long-enough-for-hmac";
  const signature = vdi.signPayload(body, secret);
  assert.equal(vdi.verifyPayloadSignature(body, signature, secret), true);
  assert.equal(vdi.verifyPayloadSignature(Buffer.from(body.toString() + " "), signature, secret), false);
  assert.equal(vdi.verifyPayloadSignature(body, signature, "wrong-secret-that-is-long-enough"), false);
});
test("proof ledger is append-only by event id, hash chained and tamper evident", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-vdi-"));
  const file = path.join(dir, "proof.jsonl");
  try {
    const ledger = new vdi.ProofLedger(file);
    const firstDecision = vdi.evaluateEvent(event(), { nowMs: NOW, sourceAuthenticated: true, matchedSession: true });
    assert.equal(ledger.append(firstDecision).appended, true);
    assert.equal(ledger.append(firstDecision).duplicate, true);
    const secondDecision = vdi.evaluateEvent(event({ event_id: "evt-002", occurred_at: "2026-11-01T09:58:00.000Z" }), { nowMs: NOW, sourceAuthenticated: true, matchedSession: true });
    assert.equal(ledger.append(secondDecision).appended, true);
    assert.equal(ledger.verify().valid, true);
    assert.equal(ledger.verify().records, 2);
    fs.appendFileSync(file, "{\"event_id\":\"tampered\"}\n");
    assert.equal(ledger.verify().valid, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
test("proof receipt refuses malformed previous hash", () => {
  const decision = vdi.evaluateEvent(event(), { nowMs: NOW, sourceAuthenticated: true, matchedSession: true });
  assert.throws(() => vdi.createProofReceipt(decision, "bad"), /previous_receipt_hash_invalid/);
});
