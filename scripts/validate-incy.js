"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const profilePath = path.join(root, "config", "incy", "profile.json");
const subscriptionPath = path.join(root, "config", "incy", "subscription.txt");

const profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
const subscription = fs.readFileSync(subscriptionPath, "utf8");

const required = ["Name", "GlobalProxy", "DomainStrategy"];
for (const key of required) {
  if (!(key in profile)) throw new Error("INCY profile missing: " + key);
}

if (typeof profile.Name !== "string" || !profile.Name.trim()) throw new Error("INCY Name must be non-empty");
if (!["true", "false"].includes(String(profile.GlobalProxy))) throw new Error("INCY GlobalProxy must be true/false");
if (!["AsIs", "IPIfNonMatch", "IPOnDemand"].includes(String(profile.DomainStrategy))) {
  throw new Error("INCY DomainStrategy is invalid");
}

for (const line of subscription.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  if (!/^[a-z][a-z0-9+.-]*:\\/\\//i.test(trimmed)) {
    throw new Error("Invalid subscription URI: " + trimmed.slice(0, 80));
  }
}

const trackedSecretPattern = /(sk-(proj|svcacct)-[A-Za-z0-9_-]{20,}|PRIVATE KEY|BEGIN [A-Z ]+ PRIVATE KEY)/i;
const all = JSON.stringify(profile) + "\n" + subscription;
if (trackedSecretPattern.test(all)) throw new Error("Potential secret detected in INCY config");

console.log("INCY config validation: PASS");
