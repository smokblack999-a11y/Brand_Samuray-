"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "dual-sessions.json");

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "[]\n");
}

function readAll() {
  ensure();
  try {
    const value = JSON.parse(fs.readFileSync(FILE, "utf8"));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function writeAll(rows) {
  ensure();
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(rows, null, 2) + "\n");
  fs.renameSync(tmp, FILE);
}

function now() {
  return new Date().toISOString();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createSession(session) {
  const rows = readAll();
  const item = {
    createdAt: now(),
    updatedAt: now(),
    turns: [],
    cycle: 0,
    phase: "DRAFT",
    status: "READY",
    currentCandidate: "",
    lastCritique: null,
    finalAnswer: "",
    ...session
  };
  rows.push(item);
  writeAll(rows);
  return clone(item);
}

function getSession(id) {
  if (!id) return null;
  return readAll().find((x) => x.id === id) || null;
}

function updateSession(id, patch) {
  const rows = readAll();
  const index = rows.findIndex((x) => x.id === id);
  if (index === -1) throw new Error("session not found");
  rows[index] = { ...rows[index], ...patch, updatedAt: now() };
  writeAll(rows);
  return clone(rows[index]);
}

function appendTurn(id, turn) {
  const rows = readAll();
  const index = rows.findIndex((x) => x.id === id);
  if (index === -1) throw new Error("session not found");

  const current = rows[index];
  const nextTurn = {
    turn: current.turns.length + 1,
    createdAt: now(),
    ...turn
  };

  current.turns = [...current.turns, nextTurn].slice(-500);
  current.updatedAt = now();
  writeAll(rows);
  return clone(nextTurn);
}

function listSessions(limit = 50) {
  return readAll()
    .slice(-Math.max(1, Math.min(Number(limit) || 50, 200)))
    .reverse()
    .map(({ turns, currentCandidate, lastCritique, finalAnswer, ...meta }) => meta);
}

module.exports = {
  createSession,
  getSession,
  updateSession,
  appendTurn,
  listSessions
};
