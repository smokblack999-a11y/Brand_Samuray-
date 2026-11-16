"use strict";

const crypto = require("crypto");

const RULES = [
  { kind: "tests", pattern: /(test|tests|testing|unit test|integration test|e2e|spec|тест|тесты|тестирование)/i },
  { kind: "build", pattern: /(build|compile|compilation|apk|ipa|bundle|сборк|собер|компиляц)/i },
  { kind: "execution", pattern: /(deploy|deployed|release|installed|published|launched|migration|production|развернул|установил|опубликовал|запустил)/i },
  { kind: "sources", pattern: /(latest|current|today|recent|price|pricing|rate|exchange|news|source|citation|as of|сегодня|актуальн|последн|цена|курс|источник|ссылк)/i },
  { kind: "domain_review", pattern: /(medical|clinical|diagnos|legal|law|tax|investment|financial advice|лекарств|медицин|диагноз|юрид|налог|инвестиц|финансов)/i }
];

const SIGNING_KEY = String(process.env.EVIDENCE_SIGNING_KEY || "");
const ALLOWED_KINDS = new Set(["tests", "build", "execution", "sources", "domain_review"]);

function requiredEvidenceKinds(task, answer) {
  const text = String(task || "") + "\n" + String(answer || "");
  return RULES.filter(rule => rule.pattern.test(text)).map(rule => rule.kind);
}

function canonical(item) {
  return JSON.stringify({
    kind: item.kind,
    status: item.status,
    origin: item.origin,
    digest: item.digest,
    at: item.at
  });
}

function signatureFor(item) {
  if (SIGNING_KEY.length < 32) throw new Error("EVIDENCE_SIGNING_KEY must contain at least 32 characters");
  return crypto.createHmac("sha256", SIGNING_KEY).update(canonical(item)).digest("hex");
}

function createEvidenceRecord({ kind, digest, at = new Date().toISOString(), status = "passed" } = {}) {
  if (!ALLOWED_KINDS.has(kind) || status !== "passed" || !/^[a-f0-9]{64}$/i.test(String(digest || "")) || !Number.isFinite(Date.parse(at))) {
    throw new Error("invalid_evidence_record");
  }
  const record = { kind, status, origin: "server", digest: String(digest).toLowerCase(), at };
  return { ...record, signature: signatureFor(record) };
}

function validServerEvidence(item) {
  if (!item || item.origin !== "server" || item.status !== "passed" || !ALLOWED_KINDS.has(item.kind)) return false;
  if (typeof item.digest !== "string" || !/^[a-f0-9]{64}$/i.test(item.digest) || !Number.isFinite(Date.parse(item.at))) return false;
  if (typeof item.signature !== "string" || !/^[a-f0-9]{64}$/i.test(item.signature) || SIGNING_KEY.length < 32) return false;
  const expected = Buffer.from(signatureFor(item), "hex");
  const actual = Buffer.from(item.signature, "hex");
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

function verifyEvidence({ task, answer, evidence = [] } = {}) {
  const required = [...new Set(requiredEvidenceKinds(task, answer))];
  if (!required.length) {
    return { status: "NOT_REQUIRED", verified: true, required: [], accepted: [], missing: [], note: "No external execution or time-sensitive evidence requirement was detected." };
  }
  const accepted = (Array.isArray(evidence) ? evidence : [])
    .filter(validServerEvidence)
    .map(item => ({ kind: item.kind, digest: item.digest, at: item.at }));
  const acceptedKinds = new Set(accepted.map(item => item.kind));
  const missing = required.filter(kind => !acceptedKinds.has(kind));
  return {
    status: missing.length ? "REQUIRED" : "VERIFIED",
    verified: missing.length === 0,
    required,
    accepted,
    missing,
    note: missing.length
      ? "A model's statement or user-provided text is not evidence. A valid server HMAC proof is still required."
      : "All detected evidence categories have matching HMAC-authenticated server proof records."
  };
}

module.exports = { verifyEvidence, requiredEvidenceKinds, validServerEvidence, createEvidenceRecord };
