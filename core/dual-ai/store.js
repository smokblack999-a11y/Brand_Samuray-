"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "dual-sessions.json");

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(FILE)) fs.writeFileSync(FILE, "{}\n");
}
function read() {
  ensure();
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}
function write(value) {
  ensure();
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, FILE);
}
function create(session) {
  const all = read();
  all[session.id] = session;
  write(all);
  return session;
}
function get(id) {
  return read()[id] || null;
}
function update(id, patch) {
  const all = read();
  if (!all[id]) return null;
  all[id] = { ...all[id], ...patch, updatedAt: new Date().toISOString() };
  write(all);
  return all[id];
}
function list() {
  return Object.values(read()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
module.exports = { create, get, update, list };
