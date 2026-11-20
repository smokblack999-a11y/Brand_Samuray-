"use strict";

const fs = require("node:fs");
const path = require("node:path");

const lockPath = path.join(__dirname, "..", "package-lock.json");
if (!fs.existsSync(lockPath)) {
  console.error("LICENSE AUDIT: package-lock.json is missing");
  process.exit(2);
}

const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
const packages = lock.packages || {};
const findings = [];

// Reviewed upstream license metadata omissions. Keep this list narrow and version-pinned.
const reviewedOverrides = {
  "rx-lite@3.1.2": "Apache-2.0",
};
const blocked = [];

for (const [location, metadata] of Object.entries(packages)) {
  if (!location.startsWith("node_modules/")) continue;
  const name = location.slice("node_modules/".length);
  const license = metadata.license || metadata.licenses || reviewedOverrides[`${name}@${metadata.version}`] || null;
  const record = { name, version: metadata.version || null, license: license || "UNKNOWN" };
  findings.push(record);

  const normalized = String(license || "").toUpperCase();
  if (/(^|[^A-Z])(AGPL|GPL|SSPL)([^A-Z]|$)/.test(normalized)) {
    blocked.push(record);
  }
}

const unknown = findings.filter((item) => item.license === "UNKNOWN");
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  packageCount: findings.length,
  blockedCopyleftCount: blocked.length,
  unknownLicenseCount: unknown.length,
  blocked,
  unknown,
};

process.stdout.write(JSON.stringify(report, null, 2) + "\n");

if (blocked.length) {
  console.error("LICENSE AUDIT: strong-copyleft dependency detected");
  process.exit(1);
}
if (unknown.length) {
  console.error("LICENSE AUDIT: unknown license metadata requires manual review");
  process.exit(2);
}
console.log("LICENSE AUDIT: PASS");
