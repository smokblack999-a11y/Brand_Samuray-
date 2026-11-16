"use strict";

const crypto = require("crypto");

const RULES = [
  { kind: "tests", pattern: /\\b(test|tests|testing|unit test|integration test|e2e|spec|тест|тесты|тестирование)\\b/i },
  { kind: "build", pattern: /\\b(build|compile|compilation|apk|ipa|bundle|сборк|компиляц|apk)\\b/i },
  { kind: "execution", pattern: /\\b(deploy|deployed|release|installed|published|launched|migration|production|развернул|установил|опубликовал|запустил)\\b/i },
  { kind: "sources", pattern: /\\b(latest|current|today|recent|price|pricing|rate|exchange|news|source|citation|as of|сегодня|актуальн|последн|цена|курс|источник|ссылк)\\b/i },
  { kind: "domain_review", pattern: /\\b(medical|clinical|diagnos|legal|law|tax|investment|financial advice|лекарств|медицин|диагноз|юрид|налог|инвестиц|финансов)\\b/i }
];

function requiredEvidenceKinds(task, answer) {
  const text = String(task || "") + "\\n" + String(answer || "");
  return RULES.filter(rule => rule.pattern.test(text)).map(rule => rule.kind);
}

function validServerEvidence(item) {
  if (!item || item.origin !== "server" || item.status !== "passed") return false;
  if (!["tests", "build", "execution", "sources", "domain_review"].includes(item.kind)) return false;
  if (typeof item.digest !== "string" || !/^[a-f0-9]{64}$/i.test(item.digest)) return false;
  const timestamp = Date.parse(item.at);
  return Number.isFinite(timestamp);
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
      ? "A model's statement or user-provided text is not execution evidence. Trusted server-side evidence is still required."
      : "All detected evidence categories have matching server-origin proof records."
  };
}

module.exports = { verifyEvidence, requiredEvidenceKinds, validServerEvidence };
