"use strict";
require("dotenv").config();

const required = ["CORE_API_KEY", "TELEGRAM_WEBHOOK_SECRET", "TELEGRAM_WEBHOOK_URL"];
const missing = required.filter(name => !String(process.env[name] || "").trim());
const webhook = String(process.env.TELEGRAM_WEBHOOK_URL || "").trim();

if (missing.length) throw new Error(`Missing required configuration: ${missing.join(", ")}`);
if (!/^https:\/\//i.test(webhook)) throw new Error("TELEGRAM_WEBHOOK_URL must use HTTPS");
if (String(process.env.TELEGRAM_WEBHOOK_SECRET).length < 16) throw new Error("TELEGRAM_WEBHOOK_SECRET must be at least 16 characters");
if (String(process.env.CORE_API_KEY).length < 16) throw new Error("CORE_API_KEY must be at least 16 characters");

console.log(JSON.stringify({ ok: true, checked: required }, null, 2));
