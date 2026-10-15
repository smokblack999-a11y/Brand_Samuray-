"use strict";

const COMMANDS = new Set(["/start", "/help", "/leads", "/discover", "/draft", "/stage"]);

function parseCommand(text) {
  const raw = String(text || "").trim();
  if (!raw.startsWith("/")) return null;
  const first = raw.split(/\s+/, 1)[0].split("@", 1)[0].toLowerCase();
  return COMMANDS.has(first) ? { command: first, args: raw.slice(raw.indexOf(" ") + 1).trim() } : null;
}

function csvIds(value) {
  return new Set(String(value || "").split(",").map((part) => part.trim()).filter(Boolean));
}

function safe(value, max = 240) {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").slice(0, max);
}

function createTelegramLeadCommandHandler(options = {}) {
  const service = options.service || null;
  const sendMessage = options.sendMessage;
  const enabled = options.enabled === true;
  const adminIds = options.adminIds instanceof Set ? options.adminIds : csvIds(options.adminIds || process.env.TELEGRAM_ADMIN_IDS);

  if (typeof sendMessage !== "function") throw new TypeError("sendMessage function is required");

  async function reply(chatId, message) {
    await sendMessage({ chatId: String(chatId), message: safe(message, 3900) });
  }

  async function handleMessage(message) {
    const parsed = parseCommand(message && message.text);
    if (!parsed) return false;
    const chatId = message && message.chat && message.chat.id;
    const senderId = message && message.from && message.from.id;

    // Sales data and discovery controls are restricted to allowlisted admins in private chats.
    if (!chatId || !senderId || message.chat.type !== "private" || !adminIds.has(String(senderId))) {
      if (chatId && message.chat.type === "private") await reply(chatId, "Доступ запрещён. Команды управления доступны только авторизованному администратору.");
      return true;
    }

    if (parsed.command === "/start" || parsed.command === "/help") {
      await reply(chatId,
        "SAMURAI Lead Outreach\n" +
        "/leads — последние лиды\n" +
        "/discover Founder,Owner | Kazakhstan | 10 — поиск (титулы | локация | лимит)\n" +
        "/draft ID | Тема | Текст письма — сохранить черновик, не отправляет\n" +
        "/stage ID qualified — изменить этап\n\n" +
        "Поиск требует APOLLO_API_KEY. Отправки писем нет; черновики проверяются человеком.");
      return true;
    }

    if (!enabled || !service) {
      await reply(chatId, "Lead Outreach выключен. Установи LEAD_OUTREACH_ENABLED=true после настройки ключей.");
      return true;
    }

    try {
      if (parsed.command === "/leads") {
        const leads = (await service.listLeads()).slice(-8).reverse();
        if (!leads.length) {
          await reply(chatId, "Лидов пока нет. Запусти /discover Founder,Owner | Kazakhstan | 10");
          return true;
        }
        const lines = leads.map((lead) =>
          [
            safe(lead.company || "Компания не указана", 80),
            safe(lead.name || "Имя не указано", 70),
            safe(lead.title || "Должность не указана", 70),
            "score=" + Number(lead.score || 0),
            "stage=" + safe(lead.stage || "new", 30),
            "id=" + safe(lead.id, 80),
            lead.email ? "email=" + safe(lead.email, 120) : ""
          ].filter(Boolean).join(" | ")
        );
        await reply(chatId, "Последние лиды (" + leads.length + "):\n\n" + lines.join("\n\n"));
        return true;
      }

      if (parsed.command === "/discover") {
        const parts = parsed.args.split("|").map((part) => part.trim());
        const titles = (parts[0] || "").split(",").map((part) => part.trim()).filter(Boolean);
        const location = parts[1] || "";
        const limit = Math.max(1, Math.min(Number(parts[2]) || 10, 10));
        if (!titles.length && !location) {
          await reply(chatId, "Фильтр обязателен. Пример: /discover Founder,Owner | Kazakhstan | 10");
          return true;
        }
        const leads = await service.discover({
          personTitles: titles,
          locations: location ? [location] : [],
          limit
        });
        await reply(chatId, "Поиск завершён. Получено/обновлено записей: " + leads.length + ".\nПроверь результат командой /leads. Ничего не отправлялось.");
        return true;
      }

      if (parsed.command === "/draft") {
        const parts = parsed.args.split("|").map((part) => part.trim());
        if (parts.length < 3 || !parts[0] || !parts[2]) {
          await reply(chatId, "Формат: /draft ID | Тема письма | Текст черновика");
          return true;
        }
        const lead = await service.createDraft(parts[0], { subject: parts[1], body: parts.slice(2).join(" | ") });
        if (!lead) {
          await reply(chatId, "Лид не найден. Проверь полный ID через /leads.");
          return true;
        }
        await reply(chatId, "Черновик сохранён для " + safe(lead.company || lead.name || lead.id, 150) + ". Статус: draft_only. Письмо НЕ отправлено.");
        return true;
      }

      if (parsed.command === "/stage") {
        const parts = parsed.args.split(/\s+/).filter(Boolean);
        if (parts.length !== 2) {
          await reply(chatId, "Формат: /stage ID qualified\nЭтапы: new, qualified, draft_ready, contacted, replied, meeting, proposal, won, lost, do_not_contact");
          return true;
        }
        const lead = await service.setStage(parts[0], parts[1]);
        if (!lead) {
          await reply(chatId, "Лид не найден. Проверь полный ID через /leads.");
          return true;
        }
        await reply(chatId, "Этап обновлён: " + safe(lead.company || lead.name || lead.id, 150) + " → " + safe(lead.stage, 40));
        return true;
      }
    } catch (error) {
      const code = safe(error && error.code || "LEAD_OUTREACH_ERROR", 80);
      const messageText = code === "APOLLO_NOT_CONFIGURED"
        ? "Apollo не настроен: добавь APOLLO_API_KEY в .env на сервере."
        : code === "DRAFT_BLOCKED"
          ? "Черновик запрещён для этого лида (lost/do_not_contact)."
          : code === "SEARCH_FILTER_REQUIRED"
            ? "Укажи фильтр поиска."
            : "Ошибка операции: " + code + ". Подробности смотри в серверном логе.";
      await reply(chatId, messageText);
      return true;
    }

    return false;
  }

  return { handleMessage };
}

module.exports = { createTelegramLeadCommandHandler, parseCommand };
