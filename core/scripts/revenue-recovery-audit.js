"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { auditRevenueLeakage, parseCsvLeads } = require("../revenue-recovery/audit");

function usage() {
  return [
    "Usage: node scripts/revenue-recovery-audit.js <leads.csv> --currency=USD [--sla-minutes=5] [--assumptions=assumptions.json]",
    "",
    "CSV headers: lead_id,created_at,first_response_at,outcome",
    "Outcomes: open, won, lost. Timestamps must include an explicit timezone.",
    "Use pseudonymous IDs. Do not include names, emails, phone numbers or message text."
  ].join("\n");
}

function optionValue(args, name) {
  const prefix = "--" + name + "=";
  const item = args.find((arg) => arg.startsWith(prefix));
  return item ? item.slice(prefix.length) : null;
}

function main(argv) {
  const args = argv.slice();
  const inputPath = args.find((arg) => !arg.startsWith("--"));
  const currency = optionValue(args, "currency");
  const slaRaw = optionValue(args, "sla-minutes");
  const assumptionsPath = optionValue(args, "assumptions");
  const recognized = new Set(["--currency=", "--sla-minutes=", "--assumptions="]);
  const unknown = args.filter((arg) => arg.startsWith("--") && !Array.from(recognized).some((prefix) => arg.startsWith(prefix)));
  if (!inputPath || !currency || unknown.length) {
    process.stderr.write(usage() + "\n");
    return 2;
  }

  try {
    const csvPath = path.resolve(inputPath);
    const csv = fs.readFileSync(csvPath, "utf8");
    const leads = parseCsvLeads(csv);
    const input = {
      currency,
      slaMinutes: slaRaw === null ? 5 : Number(slaRaw),
      leads
    };
    if (assumptionsPath) {
      input.assumptions = JSON.parse(fs.readFileSync(path.resolve(assumptionsPath), "utf8"));
    }
    const report = auditRevenueLeakage(input);
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    return 0;
  } catch (error) {
    process.stderr.write(String(error.code || "AUDIT_FAILED") + ": " + String(error.message || "Audit failed") + "\n");
    return 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { main, usage };
