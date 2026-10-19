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
  dispatchChatId = process.env.COMMERCE_DISPATCH_CHAT_ID || ""
} = {}) {
  if (typeof sendMessage !== "function") throw fail("INVALID_TELEGRAM_SENDER", "sendMessage callback is required");

  async function send(chatId, message) {
    const recipient = cleanInline(chatId, 100);
    if (!recipient) throw fail("TELEGRAM_RECIPIENT_MISSING", "Telegram recipient is not configured");
    const text = String(message || "").trim().slice(0, 4096);
    if (!text) throw fail("TELEGRAM_MESSAGE_EMPTY", "Telegram message is empty");
    await sendMessage({ chat_id: recipient, text });
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
        await send(dispatchChatId,
          `Требуется курьер: ${heading}\nСумма: ${total}\nТовары:\n${lines}\nНазначьте курьера через защищённый API. Адрес и телефон будут переданы только назначенному курьеру.`);
        return;
      case "CourierAssigned":
        if (order.fulfilment !== "delivery" || !cleanInline(order.courierId, 100)) {
          throw fail("COMMERCE_COURIER_NOT_CONFIGURED", "A delivery order with an assigned courier is required");
        }
        await send(order.courierId,
          `Вам назначена доставка ${cleanInline(order.id, 40)}.\nТовары:\n${lines}\nСумма заказа: ${total}\nАдрес: ${cleanInline(order.address, 900)}\nТелефон: ${cleanInline(order.phone || "не указан", 40)}\nКомментарий: ${cleanInline(order.note || "нет", 300)}\nПодтверждение завершения — через доверенный процесс доставки.`);
        await send(customerId, `${heading}: назначен курьер. Сумма: ${total}.`);
        return;
      case "DeliveryStarted":
        await send(customerId, `Курьер выехал по заказу ${cleanInline(order.id, 40)}.`);
        return;
      case "PickupReady":
        await send(customerId, `Заказ ${cleanInline(order.id, 40)} готов к самовывозу. Пункт выдачи: ${cleanInline(order.pickupPoint, 300)}.`);
        return;
      case "OrderDelivered":
      case "OrderPickedUp": {
        const status = event.type === "OrderDelivered" ? "доставка завершена" : "самовывоз подтверждён";
        const proof = cleanInline(order.deliveryProof?.photoUrl, 2048);
        const note = cleanInline(order.deliveryProof?.note, 300);
        await send(customerId,
          `Заказ ${cleanInline(order.id, 40)}: ${status}.${proof ? "\nПодтверждение: " + proof : ""}${note ? "\nКомментарий: " + note : ""}`);
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
