"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(__dirname, "..", "backups"));
const archives = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter(x => x.endsWith(".tar.gz")).sort() : [];
if (!archives.length) throw new Error("No backup archives found");
const archive = path.join(backupDir, archives[archives.length - 1]);
execFileSync("tar", ["-tzf", archive], { stdio: "ignore" });
console.log(JSON.stringify({ ok: true, archive, verifiedAt: new Date().toISOString() }));
