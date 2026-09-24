"use strict";

const crypto = require("node:crypto");

const REQUIRED_PRODUCTION_ENV = Object.freeze([
  "CORE_API_KEY",
  "TELEGRAM_WEBHOOK_SECRET",
  "X10THINK_RECOVERY_API_KEY",
  "GITHUB_TOKEN"
]);

function requiredEnv(env = process.env) {
  return REQUIRED_PRODUCTION_ENV.filter(key => !String(env[key] || "").trim());
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((o,k) => { o[k] = stableJson(value[k]); return o; }, {});
  }
  return value;
}

function receiptHash(receipt) {
  return sha256(JSON.stringify(stableJson(receipt)));
}

function verifyReceipt(receipt = {}) {
  if (!receipt || typeof receipt !== "object") return { passed:false, reason:"RECEIPT_REQUIRED" };
  const supplied = String(receipt.receiptHash || "");
  if (!/^[a-f0-9]{64}$/.test(supplied)) return { passed:false, reason:"RECEIPT_HASH_INVALID" };
  const copy = {...receipt};
  delete copy.receiptHash;
  return { passed: supplied === receiptHash(copy), reason: supplied === receiptHash(copy) ? "OK" : "RECEIPT_HASH_MISMATCH" };
}

function assertNoUnverifiedOverride(env = process.env) {
  if (String(env.X10THINK_ALLOW_UNVERIFIED_CI || "").toLowerCase() === "true") {
    throw new Error("UNVERIFIED_CI_OVERRIDE_FORBIDDEN");
  }
  return true;
}

function validateRecoveryIdentity({jobId, repository, headSha, diffHash} = {}) {
  const ok = /^recovery-[a-f0-9]{24}$/.test(String(jobId || "")) &&
    /^[^/]+\/[^/]+$/.test(String(repository || "")) &&
    /^[a-f0-9]{40}$/.test(String(headSha || "")) &&
    /^[a-f0-9]{64}$/.test(String(diffHash || ""));
  return {passed:ok,reason:ok ? "OK" : "RECOVERY_IDENTITY_INVALID"};
}

module.exports = {
  REQUIRED_PRODUCTION_ENV,
  requiredEnv,
  sha256,
  stableJson,
  receiptHash,
  verifyReceipt,
  assertNoUnverifiedOverride,
  validateRecoveryIdentity
};
