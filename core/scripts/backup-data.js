"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const dataDir = path.resolve(process.env.DATA_DIR || path.join(__dirname, "..", "data"));
const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(dataDir, "..", "backups"));
fs.mkdirSync(backupDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const archive = path.join(backupDir, `samurai-data-${stamp}.tar.gz`);
execFileSync("tar", ["-czf", archive, "-C", dataDir, "."], { stdio: "inherit" });
const retentionDays = Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS || 14));
const cutoff = Date.now() - retentionDays * 86400000;
for (const name of fs.readdirSync(backupDir).filter(x => x.endsWith(".tar.gz"))) {
  const file = path.join(backupDir, name);
  if (file !== archive && fs.statSync(file).mtimeMs < cutoff) fs.unlinkSync(file);
}
const stat = fs.statSync(archive);
if (stat.size < 32) throw new Error("Backup archive is unexpectedly small");
console.log(JSON.stringify({ ok: true, archive, bytes: stat.size, createdAt: new Date().toISOString() }));
