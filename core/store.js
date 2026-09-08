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
function listLeads(limit = 100) {
  return read().slice(-Math.max(1, Math.min(Number(limit) || 100, 1000))).reverse();
}
function stats() {
  const rows = read();
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
      : 0
  };
}
module.exports = { saveLead, claimEvent, updateLead, listLeads, stats, hasEvent };
