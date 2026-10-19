"use strict";

function safeText(value, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function formatKzt(amount) {
  return new Intl.NumberFormat("ru-KZ", { maximumFractionDigits: 0 }).format(amount) + " ₸";
}

function createTelegramCommerceDelivery({ token, courierChatId = "", fetchImpl = globalThis.fetch }) {
  const botToken = String(token || "").trim();
  if (!botToken) throw new Error("Telegram commerce bot token is required");
  if (typeof fetchImpl !== "function") throw new Error("fetch implementation is required");

  async function sendMessage(chatId, text) {
    if (chatId === undefined || chatId === null || String(chatId).trim() === "") {
      throw new Error("Telegram destination is not configured");
    }
    const response = await fetchImpl("https://api.telegram.org/bot" + botToken + "/sendMessage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: String(chatId), text, disable_web_page_preview: true })
    });
    let payload;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok || payload?.ok !== true) {
      // Never include the request URL or token in surfaced errors.
      throw new Error("Telegram sendMessage failed (HTTP " + response.status + ")");
    }
    return payload.result;
  }

  async function deliver({ event, order, idempotencyKey }) {
    if (!event || !order || !idempotencyKey || event.eventId !== idempotencyKey || event.orderId !== order.id) {
      throw new Error("Invalid commerce outbox delivery payload");
    }
    const customerId = safeText(order.customerId, 100);
    const orderId = safeText(order.id, 80);
    const lines = [
      "Заказ " + orderId,
      "Статус: " + safeText(order.status, 40),
      "Сумма: " + formatKzt(order.totalKzt)
    ];
    if (event.type === "CourierDeliveryRequested") {
      if (order.fulfilment !== "delivery" || order.payment?.status !== "paid") {
        throw new Error("Courier delivery requires a paid delivery order");
      }
      if (!courierChatId) throw new Error("Courier chat is not configured");
      const courierText = [
        "Новый оплаченный заказ для доставки",
        "Заказ: " + orderId,
        "Сумма: " + formatKzt(order.totalKzt),
        "Адрес: " + safeText(order.address, 1000),
        order.phone ? "Телефон: " + safeText(order.phone, 40) : "",
        order.note ? "Комментарий: " + safeText(order.note, 500) : ""
      ].filter(Boolean).join("\n");
      await sendMessage(courierChatId, courierText);
      return;
    }
    let customerText = "";
    switch (event.type) {
      case "OrderPlaced":
        customerText = ["Заказ принят.", ...lines, "Ожидается подтверждение оплаты."].join("\n");
        break;
      case "PaymentConfirmed":
        customerText = ["Оплата подтверждена.", ...lines].join("\n");
        break;
      case "CourierAssigned":
        customerText = ["Курьер назначен.", ...lines].join("\n");
        break;
      case "DeliveryStarted":
        customerText = ["Заказ передан курьеру.", ...lines].join("\n");
        break;
      case "PickupReady":
        customerText = ["Заказ готов к самовывозу.", ...lines, "Пункт: " + safeText(order.pickupPoint, 250)].join("\n");
        break;
      case "OrderDelivered":
        customerText = ["Доставка завершена.", ...lines, order.deliveryProof?.photoUrl ? "Фото подтверждения: " + safeText(order.deliveryProof.photoUrl, 2048) : ""].filter(Boolean).join("\n");
        break;
      case "OrderPickedUp":
        customerText = ["Самовывоз подтверждён.", ...lines, order.deliveryProof?.photoUrl ? "Фото подтверждения: " + safeText(order.deliveryProof.photoUrl, 2048) : ""].filter(Boolean).join("\n");
        break;
      case "OrderCancelled":
        customerText = ["Заказ отменён.", ...lines].join("\n");
        break;
      default:
        throw new Error("Unsupported commerce event type");
    }

    await sendMessage(customerId, customerText);


  }

  return { deliver };
}

module.exports = { createTelegramCommerceDelivery };
