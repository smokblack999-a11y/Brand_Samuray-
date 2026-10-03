"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { sealRecord, verifyEvidenceChain } = require("./revenue-black-box");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "revenue-ledger.json");

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]\n");
}

function read() {
  ensure();
  const raw = fs.readFileSync(FILE, "utf8");
  if (!raw.trim()) return [];
  const rows = JSON.parse(raw);
  if (!Array.isArray(rows)) throw new Error("revenue ledger is corrupted");
  return rows;
}

function write(rows) {
  ensure();
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, FILE);
}

function lastTenantHash(rows, tenantId) {
  for (let i = rows.length - 1; i >= 0; i--) if (rows[i].tenantId === tenantId) return rows[i].recordHash || null;
  return null;
}

function hashId(prefix, value) {
  return prefix + "-" + crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 24);
}

function appendOutcome(outcome) {
  if (!outcome || !outcome.tenantId) throw new Error("tenantId is required");
  if (!outcome.eventId) throw new Error("eventId is required");
  const rows = read();
  const duplicate = rows.find(x => x.type === "OUTCOME" && x.tenantId === outcome.tenantId && x.eventId === outcome.eventId);
  if (duplicate) return { inserted: false, record: duplicate };
  const record = sealRecord(Object.assign({ id: hashId("out", outcome.tenantId + ":" + outcome.eventId), type: "OUTCOME", createdAt: new Date().toISOString() }, outcome), lastTenantHash(rows, outcome.tenantId));
  rows.push(record);
  write(rows);
  return { inserted: true, record };
}

function appendDecision(decision) {
  if (!decision || !decision.tenantId) throw new Error("tenantId is required");
  if (!decision.decisionId) throw new Error("decisionId is required");
  const rows = read();
  const duplicate = rows.find(x => x.type === "DECISION" && x.tenantId === decision.tenantId && x.decisionId === decision.decisionId);
  if (duplicate) return { inserted: false, record: duplicate };
  const record = sealRecord(Object.assign({ type: "DECISION", createdAt: new Date().toISOString() }, decision), lastTenantHash(rows, decision.tenantId));
  rows.push(record);
  write(rows);
  return { inserted: true, record };
}

function appendLearning(learning) {
  if (!learning || !learning.tenantId) throw new Error("tenantId is required");
  const rows = read();
  const duplicate = learning.decisionId
    ? rows.find(x => x.type === "LEARNING" && x.tenantId === learning.tenantId && x.decisionId === learning.decisionId && (learning.sourceEventId ? x.sourceEventId === learning.sourceEventId : !x.sourceEventId))
    : null;
  if (duplicate) return { inserted: false, record: duplicate };
  const record = sealRecord(Object.assign({ type: "LEARNING", createdAt: new Date().toISOString() }, learning), lastTenantHash(rows, learning.tenantId));
  rows.push(record);
  write(rows);
  return { inserted: true, record };
}

function appendCost(cost) {
  if (!cost || !cost.tenantId) throw new Error("tenantId is required");
  if (!cost.costId) throw new Error("costId is required");
  const rows = read();
  const duplicate = rows.find(x => x.type === "COST" && x.tenantId === cost.tenantId && x.costId === cost.costId);
  if (duplicate) return { inserted: false, record: duplicate };
  const amountKZT = Math.max(0, Number(cost.amountKZT || 0));
  const record = sealRecord(Object.assign({ type: "COST", createdAt: new Date().toISOString() }, cost, { amountKZT }), lastTenantHash(rows, cost.tenantId));
  rows.push(record); write(rows); return { inserted: true, record };
}

function list(tenantId, type) {
  return read().filter(x => (!tenantId || x.tenantId === tenantId) && (!type || x.type === type)).reverse();
}

function summary(tenantId) {
  const rows = list(tenantId);
  const outcomes = rows.filter(x => x.type === "OUTCOME");
  const learning = rows.filter(x => x.type === "LEARNING");
  const revenueKZT = outcomes.reduce((s, x) => s + Number(x.attributableRevenueKZT || 0), 0);
  const grossProfitKZT = outcomes.reduce((s, x) => s + Number(x.attributableGrossProfitKZT || 0), 0);
  const costs = rows.filter(x => x.type === "COST");
  const costKZT = costs.reduce((s, x) => s + Number(x.amountKZT || 0), 0);
  const won = outcomes.filter(x => x.status === "WON").length;
  return {
    tenantId: tenantId || null,
    outcomes: outcomes.length,
    won,
    attributableRevenueKZT: Math.round(revenueKZT),
    attributableGrossProfitKZT: Math.round(grossProfitKZT),
    actualCostKZT: Math.round(costKZT),
    economicMultiple: costKZT > 0 ? Number((grossProfitKZT / costKZT).toFixed(2)) : null,
    learningRecords: learning.length,
    costRecords: costs.length
  };
}

function integrity(tenantId) { const rows = read().filter(x => !tenantId || x.tenantId === tenantId); return verifyEvidenceChain(rows); }

module.exports = { appendOutcome, appendDecision, appendLearning, appendCost, list, summary, integrity };
