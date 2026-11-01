"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  createEnvelope,
  verifyEnvelope,
  CovenantEventStore,
  MAX_CLOCK_SKEW_SECONDS
} = require("./covenant-interop");

const SECRET = "samurai-covenant-test-secret-32-bytes-minimum";
const NOW = 1_798_000_000_000;

function validEnvelope(overrides = {}) {
  return createEnvelope({
    message_id: "test-message-001",
    intent: "agent.audit.receipt",
    from_ai: "covenant-agent",
    to_ai: "samurai-core",
    message_type: "audit_receipt",
    performative: "inform",
    payload: { result: "pass", source_sha: "abc123" },
    ...overrides
  }, { secret: SECRET, now: NOW });
}

function tempStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-covenant-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, "events.jsonl");
}

test("creates and verifies a signed AICP-shaped envelope", () => {
  const envelope = validEnvelope();
  const result = verifyEnvelope(envelope, { secret: SECRET, now: NOW });
  assert.equal(result.messageId, "test-message-001");
  assert.equal(result.intent, "agent.audit.receipt");
  assert.match(result.bodySha256, /^[a-f0-9]{64}$/);
});

test("rejects a modified payload after signing", () => {
  const envelope = { ...validEnvelope(), payload: { result: "fail" } };
  assert.throws(
    () => verifyEnvelope(envelope, { secret: SECRET, now: NOW }),
    error => error.code === "COVENANT_SIGNATURE_INVALID"
  );
});

test("rejects unknown intents before accepting the message", () => {
  assert.throws(
    () => validEnvelope({ intent: "execute_shell_command" }),
    error => error.code === "COVENANT_INTENT_NOT_ALLOWED"
  );
});

test("rejects stale and future messages outside the replay window", () => {
  const oldTimestamp = Math.floor(NOW / 1000) - MAX_CLOCK_SKEW_SECONDS - 1;
  assert.throws(
    () => validEnvelope({ timestamp: oldTimestamp }),
    error => error.code === "COVENANT_TIMESTAMP_OUT_OF_RANGE"
  );
});

test("rejects weak shared secrets", () => {
  assert.throws(
    () => createEnvelope({ intent: "observe_round", from_ai: "a", to_ai: "b" }, { secret: "weak", now: NOW }),
    error => error.code === "COVENANT_SECRET_TOO_SHORT"
  );
});

test("rejects unsigned fields such as the reference repo's proof_of_work marker", () => {
  const envelope = { ...validEnvelope(), proof_of_work: "pow-1" };
  assert.throws(
    () => verifyEnvelope(envelope, { secret: SECRET, now: NOW }),
    error => error.code === "COVENANT_ENVELOPE_UNSUPPORTED_FIELD"
  );
});

test("persists accepted events and deduplicates exact retries", t => {
  const storePath = tempStore(t);
  const store = new CovenantEventStore(storePath);
  const envelope = validEnvelope();
  const first = store.accept(envelope, { secret: SECRET, now: NOW });
  const duplicate = store.accept(envelope, { secret: SECRET, now: NOW });

  assert.equal(first.accepted, true);
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.accepted, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(store.health().storedEvents, 1);

  const reloaded = new CovenantEventStore(storePath);
  assert.equal(reloaded.health().storedEvents, 1);
  assert.equal(reloaded.list(10).length, 1);
  assert.equal(Object.hasOwn(reloaded.list(1)[0], "payload"), false);
});

test("rejects reuse of a message id for different signed content", t => {
  const store = new CovenantEventStore(tempStore(t));
  store.accept(validEnvelope(), { secret: SECRET, now: NOW });
  const conflicting = validEnvelope({ payload: { result: "different" } });

  assert.throws(
    () => store.accept(conflicting, { secret: SECRET, now: NOW }),
    error => error.code === "COVENANT_MESSAGE_ID_CONFLICT"
  );
});

test("fails closed when the event journal is corrupted", t => {
  const storePath = tempStore(t);
  fs.writeFileSync(storePath, "{broken-json}\n", { mode: 0o600 });

  assert.throws(
    () => new CovenantEventStore(storePath),
    error => error.code === "COVENANT_STORE_CORRUPT"
  );
});

test("caps event listing and never exposes message payloads", t => {
  const store = new CovenantEventStore(tempStore(t));
  for (let index = 0; index < 3; index += 1) {
    store.accept(validEnvelope({
      message_id: "message-" + index,
      payload: { private_note: "must not appear in list API" }
    }), { secret: SECRET, now: NOW });
  }
  const rows = store.list(1000);
  assert.equal(rows.length, 3);
  assert.equal(Object.hasOwn(rows[0], "payload"), false);
  assert.equal(store.list(0).length, 3);
});
