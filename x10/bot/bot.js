"use strict";

const TOKEN = String(process.env.X10_TELEGRAM_BOT_TOKEN || "").trim();
const HUB = String(process.env.X10_HUB_URL || "").replace(/\/$/, "");
const API_KEY = String(process.env.CORE_API_KEY || "").trim();
const ALLOWED = new Set(
  String(process.env.X10_TELEGRAM_CHAT_IDS || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean)
);

if (!TOKEN || !HUB || !API_KEY || !ALLOWED.size) {
  throw new Error("X10 Telegram bot requires X10_TELEGRAM_BOT_TOKEN, X10_HUB_URL, CORE_API_KEY and X10_TELEGRAM_CHAT_IDS");
}

const TG = `https://api.telegram.org/bot${TOKEN}`;

async function tg(method, body) {
  const response = await fetch(`${TG}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.description || `Telegram API ${response.status}`);
  return data.result;
}

async function hub(pathname, options = {}) {
  const response = await fetch(`${HUB}${pathname}`, {
    ...options,
    headers: {
      "X-API-Key": API_KEY,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `Hub API ${response.status}`);
  return data;
}

function allowed(chatId) {
  return ALLOWED.has(String(chatId));
}

function usage() {
  return [
    "/status — agent status",
    "/restart <agent-id> — queue app restart",
    "/audit — latest audit events"
  ].join("\n");
}

async function handle(update) {
  const message = update?.message;
  if (!message?.text || !message.chat?.id) return;

  const chatId = String(message.chat.id);
  if (!allowed(chatId)) {
    await tg("sendMessage", { chat_id: message.chat.id, text: "Unauthorized chat." });
    return;
  }

  const [command, arg] = message.text.trim().split(/\s+/, 2);
  try {
    if (command === "/status") {
      const data = await hub("/api/x10/admin/agents");
      const lines = data.agents.map(a =>
        `${a.id}: ${a.status} | ${a.lastStatus || "unknown"} | ${a.lastSeen || "never"}`
      );
      await tg("sendMessage", {
        chat_id: message.chat.id,
        text: lines.length ? lines.join("\n") : "No agents registered."
      });
      return;
    }

    if (command === "/restart") {
      if (!arg) return tg("sendMessage", { chat_id: message.chat.id, text: usage() });
      const data = await hub(`/api/x10/admin/agents/${encodeURIComponent(arg)}/restart`, {
        method: "POST",
        body: JSON.stringify({ reason: "telegram_manual_restart" })
      });
      await tg("sendMessage", {
        chat_id: message.chat.id,
        text: `Queued ${data.command.id} for ${arg}.`
      });
      return;
    }

    if (command === "/audit") {
      const data = await hub("/api/x10/admin/audit?limit=10");
      const lines = data.audit.map(e => `${e.ts} ${e.event} ${e.agentId || ""}`.trim());
      await tg("sendMessage", {
        chat_id: message.chat.id,
        text: lines.length ? lines.join("\n") : "Audit is empty."
      });
      return;
    }

    await tg("sendMessage", { chat_id: message.chat.id, text: usage() });
  } catch (error) {
    await tg("sendMessage", { chat_id: message.chat.id, text: `X10 error: ${error.message}` });
  }
}

async function main() {
  let offset = 0;
  console.log("X10 Telegram control bot started");

  while (true) {
    try {
      const updates = await tg("getUpdates", { timeout: 25, offset, allowed_updates: ["message"] });
      for (const update of updates) {
        offset = Math.max(offset, Number(update.update_id) + 1);
        await handle(update);
      }
    } catch (error) {
      console.error(JSON.stringify({ event: "telegram_poll_error", error: error.message }));
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
