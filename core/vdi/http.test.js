"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { signPayload } = require("./index");
const { createVdiHandler } = require("./http");

const SECRET = "vdi-test-secret-with-at-least-thirty-two-bytes";
const NOW = Date.parse("2026-11-01T10:00:00.000Z");
const event = {
  event_id: "evt-http-1", source_id: "camera-01", event_type: "ENTRY",
  occurred_at: "2026-11-01T09:59:00.000Z", received_at: "2026-11-01T09:59:01.000Z",
  site_id: "site-test", lane_id: "lane-a", source_payload_hash: "b".repeat(64),
  ocr_confidence: 0.99
};

function request(body = event, secret = SECRET) {
  const rawBody = Buffer.from(JSON.stringify(body));
  return {
    rawBody, headers: { "x-vdi-signature": signPayload(rawBody, secret) },
    get(name) { return this.headers[name.toLowerCase()]; }
  };
}
function response() {
  return {
    statusCode: 200, body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}
function ledger() {
  return { append(decision) { return { receipt: { decision: decision.decision }, duplicate: false }; } };
}
async function invoke(handler, req = request()) {
  const res = response(); await handler(req, res); return res;
}

test("disabled adapter is not reachable", async () => {
  const res = await invoke(createVdiHandler({ enabled: false }));
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "VDI_SHADOW_DISABLED");
});
test("rejects missing or weak configuration", async () => {
  const res = await invoke(createVdiHandler({ enabled: true, secret: "short", ledger: ledger() }));
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "VDI_SHADOW_NOT_CONFIGURED");
});
test("rejects invalid HMAC before processing event", async () => {
  const req = request(); req.headers["x-vdi-signature"] = "0".repeat(64);
  const res = await invoke(createVdiHandler({ enabled: true, secret: SECRET, ledger: ledger() }), req);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "INVALID_SIGNATURE");
});
test("requires exact raw bytes", async () => {
  const req = request(); delete req.rawBody;
  const res = await invoke(createVdiHandler({ enabled: true, secret: SECRET, ledger: ledger() }), req);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "RAW_BODY_REQUIRED");
});
test("valid signed event without session proof remains REVIEW", async () => {
  const res = await invoke(createVdiHandler({ enabled: true, secret: SECRET, ledger: ledger(), now: () => NOW }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.decision.decision, "REVIEW");
  assert.ok(res.body.decision.reason_codes.includes("parking_session_check_missing"));
  assert.equal(res.body.physical_action_performed, false);
});
test("only explicit positive session match can produce shadow ALLOW", async () => {
  const res = await invoke(createVdiHandler({
    enabled: true, secret: SECRET, ledger: ledger(), now: () => NOW,
    sessionMatcher: async () => true
  }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.decision.decision, "ALLOW");
  assert.equal(res.body.mode, "SHADOW_ONLY");
  assert.equal(res.body.physical_action_performed, false);
});
test("session matcher errors fail closed to REVIEW", async () => {
  const res = await invoke(createVdiHandler({
    enabled: true, secret: SECRET, ledger: ledger(), now: () => NOW,
    sessionMatcher: async () => { throw new Error("db unavailable"); }
  }));
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.decision.decision, "REVIEW");
});
test("invalid event is rejected and ledger is not written", async () => {
  let writes = 0; const req = request({ ...event, event_id: "" });
  const res = await invoke(createVdiHandler({
    enabled: true, secret: SECRET, ledger: { append() { writes++; } }, now: () => NOW
  }), req);
  assert.equal(res.statusCode, 422);
  assert.equal(writes, 0);
});
test("ledger failure returns service unavailable without physical action", async () => {
  const res = await invoke(createVdiHandler({
    enabled: true, secret: SECRET, ledger: { append() { throw new Error("disk full"); } }, now: () => NOW
  }));
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.error, "PROOF_LEDGER_UNAVAILABLE");
  assert.equal(res.body.physical_action_performed, false);
});
