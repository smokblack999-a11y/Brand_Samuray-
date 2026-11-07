const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-storage-permissions-"));
process.env.DATA_DIR = dataDir;

const leads = require("../store");
const sessions = require("../dual-ai/store");

test("lead and AI session stores use private directory and file permissions", () => {
  leads.saveLead({ source: "test", message: "private lead record" });
  sessions.create({ id: "test-session", createdAt: new Date().toISOString(), transcript: [] });

  const leadFile = path.join(dataDir, "leads.json");
  const sessionFile = path.join(dataDir, "dual-sessions.json");
  assert.equal(fs.statSync(dataDir).mode & 0o777, 0o700);
  assert.equal(fs.statSync(leadFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(sessionFile).mode & 0o777, 0o600);

  fs.chmodSync(leadFile, 0o644);
  fs.chmodSync(sessionFile, 0o644);
  leads.listLeads();
  sessions.list();
  assert.equal(fs.statSync(leadFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(sessionFile).mode & 0o777, 0o600);
});
