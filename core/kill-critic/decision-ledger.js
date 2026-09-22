"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_LEDGER = path.join(__dirname, "data", "policy-decisions.ndjson");

function sanitize(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return value
      .replace(/(sk-[A-Za-z0-9_-]{10,})/g, "[REDACTED]")
      .replace(/(ghp_[A-Za-z0-9]{10,})/g, "[REDACTED]")
      .replace(/(password|secret|token|api[_-]?key)\s*[:=]\s*[^\s,}]+/gi, "$1=[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(sanitize);
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitize(v)]));
  }
  return value;
}

function appendDecision(decision, ledgerPath = DEFAULT_LEDGER) {
  const safe = sanitize(decision);
  const line = JSON.stringify(safe) + "\n";
  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  fs.appendFileSync(ledgerPath, line, { encoding: "utf8", flag: "a" });
  return safe;
}

function readDecisions(ledgerPath = DEFAULT_LEDGER) {
  if (!fs.existsSync(ledgerPath)) return [];
  return fs.readFileSync(ledgerPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

module.exports = {
  DEFAULT_LEDGER,
  appendDecision,
  readDecisions,
};
