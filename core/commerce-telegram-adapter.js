"use strict";
const { telegram } = require("./business-bot");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function cleanInline(value, max = 400) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function moneyKzt(value) {
  return Number(value || 0).toLocaleString("ru-RU") + " ₸";
}

function itemSummary(order) {
  const lines = (Array.isArray(order.items) ? order.items : []).slice(0, 8)
    .map(item => `• ${cleanInline(item.name, 100)} × ${Number(item.quantity) || 0}`);
  const remaining = Math.max(0, (order.items || []).length - lines.length);
  if (remaining) lines.push(`… ещё позиций: ${remaining}`);
  return lines.join("\n");
}

function createTelegramCommerceDelivery({
  sendMessage = payload => telegram("sendMessage", payload),
  sendPhoto = payload => telegram("sendPhoto", payload),
  dispatchChatId = process.env.COMMERCE_DISPATCH_CHAT_ID || "",
  courierChatIds = String(process.env.COMMERCE_COURIER_CHAT_IDS || "").split(",").map(x => x.trim()).filter(x => /^[1-9]\d{0,19}$/.test(x)).slice(0, 10)
} = {}) {
  if (typeof sendMessage !== "function" || typeof sendPhoto !== "function") throw fail("INVALID_TELEGRAM_SENDER", "sendMessage and sendPhoto callbacks are required");

  async function send(chatId, message, replyMarkup = null) {
    const recipient = cleanInline(chatId, 100);
    if (!recipient) throw fail("TELEGRAM_RECIPIENT_MISSING", "Telegram recipient is not configured");
    const text = String(message || "").trim().slice(0, 4096);
    if (!text) throw fail("TELEGRAM_MESSAGE_EMPTY", "Telegram message is empty");
    const payload = { chat_id: recipient, text };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    await sendMessage(payload);
  }

  async function sendProofPhoto(chatId, fileId, caption) {
    const recipient = cleanInline(chatId, 100);
    if (!recipient) throw fail("TELEGRAM_RECIPIENT_MISSING", "Telegram recipient is not configured");
    if (!fileId || String(fileId).length > 512) throw fail("INVALID_DELIVERY_PROOF", "Telegram photo file ID is invalid");
    await sendPhoto({ chat_id: recipient, photo: fileId, caption: String(caption || "").slice(0, 1024) });
  }

  async function deliver({ event, order }) {
    if (!event || !order || event.orderId !== order.id) {
      throw fail("INVALID_COMMERCE_EVENT", "A matching event and order are required");
    }
    const customerId = cleanInline(order.customerId, 100);
    const lines = itemSummary(order);
    const total = moneyKzt(order.totalKzt);
    const heading = `Заказ ${cleanInline(order.id, 40)}`;

    switch (event.type) {
      case "OrderPlaced":
        await send(customerId,
          `${heading} создан.\nТовары:\n${lines}\nСумма: ${total}\nСтатус: ожидает оплаты. Не переводите деньги до получения проверяемых платёжных инструкций.`);
        return;
      case "PaymentConfirmed":
        await send(customerId,
          `Оплата по заказу ${cleanInline(order.id, 40)} подтверждена.\nСумма: ${total}\nСледующий этап: ${order.fulfilment === "pickup" ? "подготовка самовывоза" : "назначение курьера"}.`);
        return;
      case "CourierDeliveryRequested":
        if (order.fulfilment !== "delivery") {
          throw fail("INVALID_DELIVERY_REQUEST", "Courier delivery request requires a delivery order");
        }
        if (!cleanInline(dispatchChatId, 100)) {
          throw fail("COMMERCE_DISPATCH_NOT_CONFIGURED", "COMMERCE_DISPATCH_CHAT_ID is required for paid delivery orders");
        }
        const courierKeyboard = courierChatIds.length ? { inline_keyboard: courierChatIds.map(id => [{ text: `Назначить курьера …${id.slice(-4)}`, callback_data: `a:${order.id}:${id}` }]) } : null;
        await send(dispatchChatId,
          `Требуется курьер: ${heading}\nСумма: ${total}\nТовары:\n${lines}\nВыберите курьера. Адрес и телефон будут переданы только назначенному курьеру.`, courierKeyboard);
        return;
      case "CourierAssigned":
        if (order.fulfilment !== "delivery" || !cleanInline(order.courierId, 100)) {
          throw fail("COMMERCE_COURIER_NOT_CONFIGURED", "A delivery order with an assigned courier is required");
        }
        await send(order.courierId,
          `Вам назначена доставка ${cleanInline(order.id, 40)}.\nТовары:\n${lines}\nСумма заказа: ${total}\nАдрес: ${cleanInline(order.address, 900)}\nТелефон: ${cleanInline(order.phone || "не указан", 40)}\nКомментарий: ${cleanInline(order.note || "нет", 300)}\nНажмите «Начать доставку», затем отправьте фото подтверждения.`,
          { inline_keyboard: [[{ text: "Начать доставку", callback_data: `s:${order.id}` }]] });
        await send(customerId, `${heading}: назначен курьер. Сумма: ${total}.`);
        return;
      case "DeliveryStarted":
        await send(customerId, `Курьер выехал по заказу ${cleanInline(order.id, 40)}.`);
        return;
      case "PickupReady":
        await send(customerId, `Заказ ${cleanInline(order.id, 40)} готов к самовывозу. Пункт выдачи: ${cleanInline(order.pickupPoint, 300)}.`,
          { inline_keyboard: [[{ text: "Я забрал заказ", callback_data: `p:${order.id}` }]] });
        return;
      case "OrderDelivered":
      case "OrderPickedUp": {
        const status = event.type === "OrderDelivered" ? "доставка завершена" : "самовывоз подтверждён";
        const proof = cleanInline(order.deliveryProof?.photoUrl, 2048);
        const fileId = cleanInline(order.deliveryProof?.photoFileId, 512);
        const note = cleanInline(order.deliveryProof?.note, 300);
        const caption = `Заказ ${cleanInline(order.id, 40)}: ${status}.${note ? "\\nКомментарий: " + note : ""}`;
        if (event.type === "OrderDelivered" && fileId) await sendProofPhoto(customerId, fileId, caption);
        else await send(customerId, `${caption}${proof ? "\\nПодтверждение: " + proof : ""}`);
        return;
      }
      case "OrderCancelled":
        await send(customerId, `Заказ ${cleanInline(order.id, 40)} отменён.`);
        return;
      default:
        throw fail("UNSUPPORTED_COMMERCE_EVENT", "Unsupported commerce event type");
    }
  }

  return { deliver };
}

module.exports = { createTelegramCommerceDelivery, cleanInline };
