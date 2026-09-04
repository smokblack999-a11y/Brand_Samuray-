"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { TelegramClient } = require("telegram");
const { StringSession } = require("telegram/sessions");
const input = require("input");

const apiId = Number(process.env.TELEGRAM_API_ID);
const apiHash = process.env.TELEGRAM_API_HASH;

if (!apiId || !apiHash || apiHash.includes("_API_HASH")) {
  throw new Error("TELEGRAM_API_ID/API_HASH в .env настроены неправильно");
}

(async () => {
  const client = new TelegramClient(
    new StringSession(""),
    apiId,
    apiHash,
    { connectionRetries: 5 }
  );

  await client.start({
    phoneNumber: async () =>
      await input.text("Номер Telegram: "),

    phoneCode: async () =>
      await input.text("Код Telegram: "),

    password: async () =>
      await input.text("Пароль 2FA: "),

    onError: (err) =>
      console.error("Telegram error:", err.message),
  });

  const session = client.session.save();

  const envPath = path.join(__dirname, ".env");
  let env = fs.existsSync(envPath)
    ? fs.readFileSync(envPath, "utf8")
    : "";

  env = env
    .replace(/^TELEGRAM_SESSION=.*$/m, "")
    .replace(/\n{3,}/g, "\n")
    .trimEnd();

  env += `\nTELEGRAM_SESSION=${session}\n`;

  fs.writeFileSync(envPath, env, { mode: 0o600 });

  console.log("");
  console.log("================================");
  console.log(" TELEGRAM SESSION SAVED");
  console.log("================================");
  console.log("Session сохранена в .env");
  console.log("SESSION_LENGTH:", session.length);
  console.log("================================");

  await client.disconnect();
})();
