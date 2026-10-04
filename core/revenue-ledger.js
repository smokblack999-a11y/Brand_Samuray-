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
  const tmp = FILE + "." + process.pid + ".tmp";
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


function sleepMs(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function withLedgerLock(fn) {
  ensure();
  const lockFile = FILE + ".lock";
  const deadline = Date.now() + Number(process.env.REVENUE_LEDGER_LOCK_TIMEOUT_MS || 10000);
  const staleMs = Number(process.env.REVENUE_LEDGER_LOCK_STALE_MS || 30000);
  while (true) {
    try {
      const fd = fs.openSync(lockFile, "wx");
      try {
        fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, createdAt: Date.now() }), "utf8");
        return fn();
      } finally {
        try { fs.closeSync(fd); } catch {}
        try { fs.unlinkSync(lockFile); } catch {}
      }
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const stat = fs.statSync(lockFile);
        if (Date.now() - stat.mtimeMs > staleMs) {
          fs.unlinkSync(lockFile);
          continue;
        }
      } catch (statError) {
        if (statError.code === "ENOENT") continue;
        throw statError;
      }
      if (Date.now() >= deadline) {
        throw Object.assign(new Error("revenue ledger lock timeout"), { code: "LEDGER_LOCK_TIMEOUT" });
      }
      sleepMs(5);
    }
  }
}

function mutateLedger(mutator) {
  return withLedgerLock(() => {
    const rows = read();
    const result = mutator(rows);
    if (result && result.write !== false) write(rows);
    return result;
  });
}

function appendOutcome(outcome) {
  if (!outcome || !outcome.tenantId) throw new Error("tenantId is required");
  if (!outcome.eventId) throw new Error("eventId is required");
  return mutateLedger(rows => {
    const duplicate = rows.find(x => x.type === "OUTCOME" && x.tenantId === outcome.tenantId && x.eventId === outcome.eventId);
    if (duplicate) return { inserted: false, record: duplicate, write: false };
    const record = sealRecord(Object.assign({}, outcome, { id: hashId("out", outcome.tenantId + ":" + outcome.eventId), type: "OUTCOME", createdAt: new Date().toISOString() }), lastTenantHash(rows, outcome.tenantId));
    rows.push(record);
    return { inserted: true, record };
  });
}

function appendDecision(decision) {
  if (!decision || !decision.tenantId) throw new Error("tenantId is required");
  if (!decision.decisionId) throw new Error("decisionId is required");
  return mutateLedger(rows => {
    const duplicate = rows.find(x => x.type === "DECISION" && x.tenantId === decision.tenantId && x.decisionId === decision.decisionId);
    if (duplicate) return { inserted: false, record: duplicate, write: false };
    const record = sealRecord(Object.assign({}, decision, { type: "DECISION", createdAt: new Date().toISOString() }), lastTenantHash(rows, decision.tenantId));
    rows.push(record);
    return { inserted: true, record };
  });
}

function appendLearning(learning) {
  if (!learning || !learning.tenantId) throw new Error("tenantId is required");
  return mutateLedger(rows => {
    const duplicate = learning.decisionId ? rows.find(x => x.type === "LEARNING" && x.tenantId === learning.tenantId && x.decisionId === learning.decisionId && (learning.sourceEventId ? x.sourceEventId === learning.sourceEventId : !x.sourceEventId)) : null;
    if (duplicate) return { inserted: false, record: duplicate, write: false };
    const record = sealRecord(Object.assign({}, learning, { type: "LEARNING", createdAt: new Date().toISOString() }), lastTenantHash(rows, learning.tenantId));
    rows.push(record);
    return { inserted: true, record };
  });
}

function appendExecution(execution) {
  if (!execution || !execution.tenantId) throw new Error("tenantId is required");
  if (!execution.executionId) throw new Error("executionId is required");
  return mutateLedger(rows => {
    const duplicate = rows.find(x => x.type === "EXECUTION" && x.tenantId === execution.tenantId && x.executionId === execution.executionId);
    if (duplicate) return { inserted: false, record: duplicate, write: false };
    const record = sealRecord(Object.assign({}, execution, { type: "EXECUTION", createdAt: new Date().toISOString() }), lastTenantHash(rows, execution.tenantId));
    rows.push(record);
    return { inserted: true, record };
  });
}

function appendCost(cost) {
  if (!cost || !cost.tenantId) throw new Error("tenantId is required");
  if (!cost.costId) throw new Error("costId is required");
  return mutateLedger(rows => {
    const duplicate = rows.find(x => x.type === "COST" && x.tenantId === cost.tenantId && x.costId === cost.costId);
    if (duplicate) return { inserted: false, record: duplicate, write: false };
    const amountKZT = Math.max(0, Number(cost.amountKZT || 0));
    const record = sealRecord(Object.assign({}, cost, { type: "COST", createdAt: new Date().toISOString(), amountKZT }), lastTenantHash(rows, cost.tenantId));
    rows.push(record);
    return { inserted: true, record };
  });
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

module.exports = { appendOutcome, appendDecision, appendExecution, appendLearning, appendCost, list, summary, integrity };
