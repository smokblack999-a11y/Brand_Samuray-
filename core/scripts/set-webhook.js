"use strict";
require("dotenv").config();

const token = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
const url = String(process.env.TELEGRAM_WEBHOOK_URL || "").trim();
const secret = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();

if (!token) throw new Error("TELEGRAM_BOT_TOKEN is required");
if (!url || !/^https:\/\//i.test(url)) throw new Error("TELEGRAM_WEBHOOK_URL must be a public HTTPS URL");
if (!secret || secret.length < 16) throw new Error("TELEGRAM_WEBHOOK_SECRET must be at least 16 characters");

async function main() {
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secret,
      allowed_updates: ["business_connection", "business_message", "edited_business_message", "deleted_business_messages"]
    })
  });

  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(`Telegram setWebhook failed: ${JSON.stringify(data)}`);
  console.log(JSON.stringify({ ok: true, webhook: data.result, url }, null, 2));
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
