"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "leads.json");

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]\n");
}
function read() {
  ensure();
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}
function write(rows) {
  ensure();
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + "\n");
  fs.renameSync(tmp, FILE);
}
function hasEvent(eventKey) {
  if (!eventKey) return false;
  return read().some(x => x.eventKey === eventKey);
}
function saveLead(lead) {
  const rows = read();
  if (lead?.eventKey) {
    const existing = rows.find(x => x.eventKey === lead.eventKey);
    if (existing) return existing;
  }
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    status: lead?.status || "completed",
    ...lead
  };
  rows.push(item);
  write(rows);
  return item;
}
function claimEvent(eventKey, lead = {}) {
  if (!eventKey) throw new Error("eventKey обязателен");
  const rows = read();
  const existing = rows.find(x => x.eventKey === eventKey);
  if (existing && existing.status !== "failed") return { claimed: false, item: existing };
  if (existing) {
    existing.status = "processing";
    existing.updatedAt = new Date().toISOString();
    write(rows);
    return { claimed: true, item: existing };
  }
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: "processing",
    eventKey,
    ...lead
  };
  rows.push(item);
  write(rows);
  return { claimed: true, item };
}
function updateLead(id, patch) {
  const rows = read();
  const index = rows.findIndex(x => x.id === id);
  if (index === -1) throw new Error("lead not found");
  rows[index] = { ...rows[index], ...patch, updatedAt: new Date().toISOString() };
  write(rows);
  return rows[index];
}
function recordOutcome(id, outcome = {}) {
  const allowed = new Set(["won", "lost", "follow_up"]);
  if (!allowed.has(outcome.status)) {
    const error = new Error("outcome.status must be won, lost or follow_up");
    error.code = "INVALID_OUTCOME";
    throw error;
  }
  const patch = { outcome: outcome.status, outcomeAt: new Date().toISOString() };
  if (outcome.reason) patch.lossReason = String(outcome.reason).slice(0, 200);
  if (outcome.revenue !== undefined) {
    const revenue = Number(outcome.revenue);
    if (!Number.isFinite(revenue) || revenue < 0 || revenue > 100000000) {
      const error = new Error("outcome.revenue must be a finite non-negative number");
      error.code = "INVALID_REVENUE";
      throw error;
    }
    patch.revenue = revenue;
  }
  return updateLead(id, patch);
}
function listLeads(limit = 100) {
  return read().slice(-Math.max(1, Math.min(Number(limit) || 100, 1000))).reverse();
}
function stats() {
  const rows = read();
  const won = rows.filter(x => x.outcome === "won");
  const lost = rows.filter(x => x.outcome === "lost");
  const attributedRevenue = won.reduce((sum, x) => sum + Number(x.revenue || 0), 0);
  return {
    total: rows.length,
    processing: rows.filter(x => x.status === "processing").length,
    failed: rows.filter(x => x.status === "failed").length,
    completed: rows.filter(x => x.status === "completed").length,
    hot: rows.filter(x => x.intent === "hot").length,
    warm: rows.filter(x => x.intent === "warm").length,
    cold: rows.filter(x => x.intent === "cold").length,
    avgScore: rows.length
      ? Math.round(rows.reduce((a, x) => a + Number(x.score || 0), 0) / rows.length)
      : 0,
    won: won.length,
    lost: lost.length,
    followUp: rows.filter(x => x.outcome === "follow_up").length,
    conversionRate: rows.length ? Math.round((won.length / rows.length) * 1000) / 10 : 0,
    attributedRevenue: Math.round(attributedRevenue * 100) / 100
  };
}
module.exports = { saveLead, claimEvent, updateLead, recordOutcome, listLeads, stats, hasEvent };
