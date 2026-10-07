"use strict";

const crypto = require("node:crypto");

const SCHEMA = "x10think-evidence-chain/v1";

function stable(value) {
  return JSON.stringify(value, Object.keys(value || {}).sort());
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  }
  return value;
}

function hash(value) {
  return sha256(JSON.stringify(canonical(value)));
}

function createChain({subject, intent, initialEvidence = {}} = {}) {
  const genesis = {
    index: 0,
    type: "genesis",
    subject: String(subject || "unknown"),
    intent: String(intent || "unknown"),
    evidence: initialEvidence,
    previousHash: null
  };
  return {
    schema: SCHEMA,
    chainId: "ec_" + crypto.randomUUID(),
    headHash: hash(genesis),
    records: [{...genesis, hash: hash(genesis)}]
  };
}

function append(chain, input = {}) {
  if (!chain || chain.schema !== SCHEMA || !Array.isArray(chain.records)) {
    throw new Error("evidence_chain_invalid");
  }
  const previous = chain.records[chain.records.length - 1];
  const record = {
    index: previous.index + 1,
    type: String(input.type || "observation"),
    intent: String(input.intent || "unknown"),
    action: String(input.action || "unknown"),
    decision: String(input.decision || "UNDECIDED"),
    evidence: input.evidence ?? null,
    previousHash: previous.hash
  };
  const recordHash = hash(record);
  const next = {...record, hash: recordHash};
  return {
    chain: {...chain, headHash: recordHash, records: [...chain.records, next]},
    record: next
  };
}

function verify(chain) {
  if (!chain || chain.schema !== SCHEMA || !Array.isArray(chain.records) || !chain.records.length) return false;
  let previousHash = null;
  for (let i = 0; i < chain.records.length; i += 1) {
    const record = chain.records[i];
    if (record.index !== i || record.previousHash !== previousHash) return false;
    const expected = hash({
      index: record.index,
      type: record.type,
      ...(record.type === "genesis" ? {
        subject: record.subject,
        intent: record.intent,
        evidence: record.evidence
      } : {
        intent: record.intent,
        action: record.action,
        decision: record.decision,
        evidence: record.evidence
      }),
      previousHash: record.previousHash
    });
    if (record.hash !== expected) return false;
    previousHash = record.hash;
  }
  return chain.headHash === previousHash;
}

module.exports = { SCHEMA, createChain, append, verify, hash };
