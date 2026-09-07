"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const FILE = path.join(DATA_DIR, "leads.json");

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]\n");
}
function read() { ensure(); return JSON.parse(fs.readFileSync(FILE, "utf8")); }
function write(rows) { ensure(); fs.writeFileSync(FILE, JSON.stringify(rows, null, 2) + "\n"); }
function saveLead(lead) {
  const rows = read();
  const item = { id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`, createdAt: new Date().toISOString(), ...lead };
  rows.push(item); write(rows); return item;
}
function listLeads(limit = 100) { return read().slice(-Math.max(1, Math.min(Number(limit) || 100, 1000))).reverse(); }
function stats() {
  const rows = read();
  return { total: rows.length, hot: rows.filter(x => x.intent === "hot").length, warm: rows.filter(x => x.intent === "warm").length, cold: rows.filter(x => x.intent === "cold").length, avgScore: rows.length ? Math.round(rows.reduce((a,x) => a + Number(x.score || 0), 0) / rows.length) : 0 };
}
module.exports = { saveLead, listLeads, stats };
