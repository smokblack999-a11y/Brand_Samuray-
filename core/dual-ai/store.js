"use strict";

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "..", "data");
const FILE = path.join(DATA_DIR, "dual-sessions.json");

function syncDirectory() {
  const dirFd = fs.openSync(DATA_DIR, "r");
  try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
}

function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.chmodSync(DATA_DIR, 0o700);
  if (!fs.existsSync(FILE)) {
    const fd = fs.openSync(FILE, "wx", 0o600);
    try {
      fs.writeFileSync(fd, "{}\n", "utf8");
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    syncDirectory();
    return;
  }
  fs.chmodSync(FILE, 0o600);
}
function read() {
  ensure();
  return JSON.parse(fs.readFileSync(FILE, "utf8"));
}
function write(value) {
  ensure();
  const tmp = FILE + ".tmp";
  const fd = fs.openSync(tmp, "w", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + "\n", "utf8");
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(tmp, FILE);
  syncDirectory();
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
