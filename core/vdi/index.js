"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = "samurai.vdi.event.v1";
const POLICY_VERSION = "samurai.vdi.policy.v1";
const EVENT_TYPES = new Set(["ENTRY", "EXIT", "CHECKPOINT", "OBSERVATION"]);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function stableJson(value) {
  if (Array.isArray(value)) return "[" + value.map(stableJson).join(",") + "]";
  if (value && typeof value === "object") return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + stableJson(value[k])).join(",") + "}";
  return JSON.stringify(value);
}
function timingSafeEqualHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function signPayload(rawBody, secret) {
  if (!Buffer.isBuffer(rawBody)) throw new TypeError("raw_body_buffer_required");
  if (typeof secret !== "string" || secret.length < 32) throw new Error("source_secret_too_short");
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}
function verifyPayloadSignature(rawBody, signature, secret) {
  if (!Buffer.isBuffer(rawBody) || typeof signature !== "string" || typeof secret !== "string" || secret.length < 32) return false;
  return timingSafeEqualHex(signPayload(rawBody, secret), signature);
}
function validateEvent(input, options = {}) {
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { valid: false, errors: ["event_object_required"] };
  const required = ["event_id", "source_id", "event_type", "occurred_at", "received_at", "site_id", "lane_id", "source_payload_hash"];
  for (const key of required) if (typeof input[key] !== "string" || !input[key].trim()) errors.push(key + "_required");
  if (typeof input.event_type === "string" && !EVENT_TYPES.has(input.event_type)) errors.push("event_type_unsupported");
  for (const key of ["event_id", "source_id", "site_id", "lane_id"]) if (typeof input[key] === "string" && input[key].length > 128) errors.push(key + "_too_long");
  for (const key of ["occurred_at", "received_at"]) if (typeof input[key] === "string" && !Number.isFinite(Date.parse(input[key]))) errors.push(key + "_invalid");
  if (typeof input.source_payload_hash === "string" && !/^[a-f0-9]{64}$/i.test(input.source_payload_hash)) errors.push("source_payload_hash_invalid");
  if (input.ocr_confidence !== undefined && (!Number.isFinite(input.ocr_confidence) || input.ocr_confidence < 0 || input.ocr_confidence > 1)) errors.push("ocr_confidence_out_of_range");
  if (input.plate_token !== undefined && (typeof input.plate_token !== "string" || input.plate_token.length > 128)) errors.push("plate_token_invalid");
  const nowMs = options.nowMs ?? Date.now();
  const maxAgeMs = options.maxEventAgeMs ?? 24 * 60 * 60 * 1000;
  if (typeof input.occurred_at === "string" && Number.isFinite(Date.parse(input.occurred_at))) {
    const eventMs = Date.parse(input.occurred_at);
    if (eventMs > nowMs + 60000) errors.push("event_from_future");
    if (nowMs - eventMs > maxAgeMs) errors.push("event_too_old");
  }
  if (typeof input.received_at === "string" && Number.isFinite(Date.parse(input.received_at)) && Date.parse(input.received_at) > nowMs + 60000) errors.push("received_at_from_future");
  return { valid: errors.length === 0, errors, schema_version: SCHEMA_VERSION };
}
function evaluateEvent(event, options = {}) {
  const validation = validateEvent(event, options);
  const reasonCodes = [...validation.errors];
  let decision = "REVIEW";
  if (!validation.valid) decision = "REVIEW";
  else if (options.duplicate === true) { decision = "REVIEW"; reasonCodes.push("duplicate_event_id"); }
  else if (options.sourceAuthenticated !== true) { decision = "REVIEW"; reasonCodes.push("source_not_authenticated"); }
  else if (event.ocr_confidence !== undefined && event.ocr_confidence < (options.minOcrConfidence ?? 0.85)) { decision = "REVIEW"; reasonCodes.push("ocr_confidence_below_threshold"); }
  else if (options.conflictingReads === true) { decision = "REVIEW"; reasonCodes.push("conflicting_vehicle_reads"); }
  else if (options.impossibleSequence === true) { decision = "REVIEW"; reasonCodes.push("impossible_event_sequence"); }
  else if (options.matchedSession === false) { decision = "REVIEW"; reasonCodes.push("parking_session_not_matched"); }
  else { decision = "ALLOW"; reasonCodes.push("all_configured_shadow_checks_passed"); }
  return {
    schema_version: SCHEMA_VERSION, policy_version: POLICY_VERSION,
    event_id: typeof event?.event_id === "string" ? event.event_id : null,
    source_id: typeof event?.source_id === "string" ? event.source_id : null,
    site_id: typeof event?.site_id === "string" ? event.site_id : null,
    decision, reason_codes: [...new Set(reasonCodes)],
    evaluated_at: new Date(options.nowMs ?? Date.now()).toISOString(),
    evidence_hash: sha256(stableJson(event)),
    requires_human_review: decision !== "ALLOW",
    mode: "SHADOW_ONLY", physical_action_performed: false
  };
}
function createProofReceipt(decision, previousReceiptHash = null) {
  if (!decision || !["ALLOW", "REVIEW", "DENY"].includes(decision.decision)) throw new Error("valid_decision_required");
  if (previousReceiptHash !== null && !/^[a-f0-9]{64}$/i.test(previousReceiptHash)) throw new Error("previous_receipt_hash_invalid");
  const receipt = {
    receipt_version: "samurai.vdi.proof.v1", event_id: decision.event_id,
    source_id: decision.source_id, site_id: decision.site_id,
    decision: decision.decision, reason_codes: decision.reason_codes,
    policy_version: decision.policy_version, evaluated_at: decision.evaluated_at,
    evidence_hash: decision.evidence_hash, previous_receipt_hash: previousReceiptHash,
    mode: "SHADOW_ONLY", physical_action_performed: false
  };
  return { ...receipt, receipt_hash: sha256(stableJson(receipt)) };
}
class ProofLedger {
  constructor(filePath) {
    if (typeof filePath !== "string" || !filePath.trim()) throw new Error("ledger_path_required");
    this.filePath = path.resolve(filePath);
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) fs.writeFileSync(this.filePath, "", { flag: "wx" });
  }
  records() {
    return fs.readFileSync(this.filePath, "utf8").split("\n").filter(Boolean).map((line, index) => {
      try { return JSON.parse(line); } catch { throw new Error("proof_ledger_corrupt_line_" + (index + 1)); }
    });
  }
  append(decision) {
    const records = this.records();
    const existing = records.find(record => record.event_id === decision.event_id && record.source_id === decision.source_id && record.site_id === decision.site_id);
    if (existing) return { appended: false, duplicate: true, receipt: existing };
    const previous = records.length ? records[records.length - 1].receipt_hash : null;
    const receipt = createProofReceipt(decision, previous);
    fs.appendFileSync(this.filePath, JSON.stringify(receipt) + "\n", { encoding: "utf8", flag: "a" });
    return { appended: true, duplicate: false, receipt };
  }
  verify() {
    const records = this.records();
    let previous = null;
    for (let index = 0; index < records.length; index++) {
      const record = records[index];
      if (record.previous_receipt_hash !== previous) return { valid: false, index, reason: "previous_hash_mismatch", records: records.length };
      const { receipt_hash, ...payload } = record;
      if (!timingSafeEqualHex(receipt_hash, sha256(stableJson(payload)))) return { valid: false, index, reason: "receipt_hash_mismatch", records: records.length };
      previous = receipt_hash;
    }
    return { valid: true, records: records.length, head_hash: previous };
  }
}
module.exports = { SCHEMA_VERSION, POLICY_VERSION, stableJson, sha256, signPayload, verifyPayloadSignature, validateEvent, evaluateEvent, createProofReceipt, ProofLedger };
