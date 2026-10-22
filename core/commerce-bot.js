"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const commerce = require("./commerce");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const SESSION_FILE = path.join(DATA_DIR, "commerce-bot-sessions.json");
const UPDATES_FILE = path.join(DATA_DIR, "commerce-bot-updates.json");
const timeoutMs = Math.max(1000, Number(process.env.TELEGRAM_TIMEOUT_MS || 10000));
const inFlightPaymentNotifications = new Set();

function readSessions() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SESSION_FILE)) fs.writeFileSync(SESSION_FILE, "{}\n", { flag: "wx", mode: 0o600 });
  return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8"));
}
function setSession(userId, value) {
  const all = readSessions();
  if (value) all[String(userId)] = value; else delete all[String(userId)];
  const tmp = SESSION_FILE + "." + crypto.randomUUID() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, SESSION_FILE);
}
function readUpdateIds() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(UPDATES_FILE)) fs.writeFileSync(UPDATES_FILE, "[]\n", { flag: "wx", mode: 0o600 });
  return JSON.parse(fs.readFileSync(UPDATES_FILE, "utf8"));
}
function hasUpdate(updateId) {
  return Number.isSafeInteger(updateId) && readUpdateIds().includes(updateId);
}
function markUpdate(updateId) {
  if (!Number.isSafeInteger(updateId)) return;
  const ids = readUpdateIds();
  if (!ids.includes(updateId)) writeAtomic(UPDATES_FILE, ids.concat(updateId).slice(-10000));
}
function writeAtomic(file, value) {
  const tmp = file + "." + crypto.randomUUID() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function isCourier(userId) {
  return String(process.env.COMMERCE_COURIER_IDS || "").split(",").map((x) => x.trim()).filter(Boolean).includes(String(userId));
}
function isAdmin(userId) {
  return String(process.env.COMMERCE_ADMIN_IDS || "").split(",").map((x) => x.trim()).filter(Boolean).includes(String(userId));
}
async function tg(method, payload) {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || "");
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  const response = await fetch("https://api.telegram.org/bot" + token + "/" + method, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok !== true) throw new Error("Telegram API " + method + " failed");
  return data.result;
}
async function sendText(chatId, text, keyboard) {
  const payload = { chat_id: chatId, text: String(text).slice(0, 4096) };
  if (keyboard) payload.reply_markup = keyboard;
  return tg("sendMessage", payload);
}
async function answerCallback(id, text) {
  try { await tg("answerCallbackQuery", { callback_query_id: id, text: String(text || "").slice(0, 180) }); } catch {}
}
function orderSummary(o) {
  return "Заказ " + o.id + "\n" + o.productName + " × " + o.quantity +
    "\nТовары: " + o.itemsTotalKzt + " " + o.currency +
    "\nДоставка: " + o.deliveryFeeKzt + " " + o.currency +
    "\nИтого: " + o.totalKzt + " " + o.currency +
    "\nОплата: " + o.paymentStatus + "\nСтатус: " + o.status;
}
async function createAndRequestPayment(chatId, input, updateId) {
  const order = commerce.createOrder({ ...input, idempotencyKey: Number.isSafeInteger(updateId) ? "telegram:" + updateId : undefined });
  try {
    const checkout = await commerce.createCheckoutSession(order.id);
    await sendText(chatId, orderSummary(checkout.order) + "\n\nОплатите по ссылке ниже. Заказ будет отмечен оплаченным только после проверенного уведомления Stripe.", {
      inline_keyboard: [[{ text: "ОПЛАТИТЬ В ТЕСТОВОМ РЕЖИМЕ", url: checkout.url }]]
    });
  } catch (error) {
    await sendText(chatId, orderSummary(order) + "\n\nСсылка оплаты не создана: " + (error.code || "PAYMENT_SETUP_REQUIRED") +
      ". Заказ НЕ оплачен. Администратору нужно настроить платёжный провайдер.");
  }
  return order;
}
async function notifyPaidOrder(orderInput) {
  const orderId = String(orderInput?.id || "");
  if (!orderId) return { skipped: true };
  if (inFlightPaymentNotifications.has(orderId)) return { inFlight: true, orderId };
  inFlightPaymentNotifications.add(orderId);
  try {
    let order = commerce.getOrder(orderInput.id);
    if (!order || order.paymentStatus !== "PAID") return { skipped: true };
    const notificationState = () => commerce.getOrder(order.id)?.notifications || {};
    let n = notificationState();
  
    if (!n.customerSentAt) {
      try {
        await sendText(order.customerId, "Оплата подтверждена платёжной системой.\n" + orderSummary(order));
        commerce.markNotification(order.id, "customer");
      } catch {
        console.error(JSON.stringify({ event: "customer_payment_notify_failed", orderId: order.id }));
      }
    }
  
    const admins = String(process.env.COMMERCE_ADMIN_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
    if (order.fulfillment === "pickup") {
      n = notificationState();
      for (const id of admins) {
        if (n.adminSentIds?.includes(id)) continue;
        try {
          await sendText(id, "Оплаченный заказ на самовывоз:\n" + orderSummary(order));
          commerce.markNotification(order.id, "admin", id);
          n = notificationState();
        } catch { console.error(JSON.stringify({ event: "pickup_admin_notify_failed", orderId: order.id })); }
      }
      return { orderId: order.id, notifications: notificationState() };
    }
  
    const couriers = String(process.env.COMMERCE_COURIER_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
    n = notificationState();
    for (const id of couriers) {
      if (n.courierSentIds?.includes(id)) continue;
      try {
        await sendText(id, "Новый оплаченный заказ на доставку:\n" + orderSummary(order) +
          "\nАдрес: " + order.address, { inline_keyboard: [[{ text: "ВЗЯТЬ ЗАКАЗ", callback_data: "courier:assign:" + order.id }]] });
        commerce.markNotification(order.id, "courier", id);
        n = notificationState();
      } catch { console.error(JSON.stringify({ event: "courier_notify_failed", orderId: order.id, code: "TELEGRAM_SEND_FAILED" })); }
    }
  
    n = notificationState();
    const hasCourierRecipient = couriers.some((id) => n.courierSentIds?.includes(id));
    if (!hasCourierRecipient) {
      for (const id of admins) {
        if (n.adminSentIds?.includes(id)) continue;
        try {
          await sendText(id, "ОПЛАЧЕННЫЙ ЗАКАЗ ОЖИДАЕТ КУРЬЕРА:\n" + orderSummary(order) + "\nАдрес: " + order.address);
          commerce.markNotification(order.id, "admin", id);
          n = notificationState();
        } catch { console.error(JSON.stringify({ event: "delivery_admin_notify_failed", orderId: order.id })); }
      }
      if (!n.deliveryEscalatedAt && (admins.length === 0 || admins.every((id) => n.adminSentIds?.includes(id)))) {
        commerce.markNotification(order.id, "deliveryEscalated");
        if (admins.length === 0) console.error(JSON.stringify({ event: "commerce_no_courier_or_admin_configured", orderId: order.id }));
      }
    }
    return { orderId: order.id, notifications: notificationState() };
  } finally {
    inFlightPaymentNotifications.delete(orderId);
  }
}
async function retryPendingPaymentNotifications() {
  // Payment state is durable before any Telegram send. Re-check all paid orders so a
  // process restart or a Telegram outage cannot permanently lose customer/courier alerts.
  const orders = commerce.listPaidOrders();
  for (const order of orders) {
    try { await notifyPaidOrder(order); }
    catch { console.error(JSON.stringify({ event: "commerce_notification_retry_failed", orderId: order.id })); }
  }
  return { scanned: orders.length };
}

async function handleCallback(q, updateId) {
  const userId = String(q.from?.id || "");
  const chatId = q.message?.chat?.id;
  const data = String(q.data || "");
  if (!userId || !chatId || q.message?.chat?.type !== "private") return;
  if (data === "myorders") {
    const orders = commerce.listOrders({ customerId: userId });
    return sendText(chatId, orders.length ? orders.slice(0, 20).map(orderSummary).join("\n\n") : "Заказов пока нет.");
  }
  if (data === "catalog") {
    const products = commerce.getCatalog();
    if (!products.length) return sendText(chatId, "Каталог пока не настроен. Администратор должен заполнить COMMERCE_PRODUCTS_JSON.");
    return sendText(chatId, "Каталог SAMURAI:", { inline_keyboard: products.map((p) => [{ text: p.name + " — " + p.priceKzt + " KZT", callback_data: "product:" + p.id }]) });
  }
  if (data.startsWith("product:")) {
    const id = data.slice("product:".length);
    const p = commerce.getCatalog().find((x) => x.id === id);
    if (!p) return sendText(chatId, "Товар недоступен. Откройте /catalog заново.");
    return sendText(chatId, p.name + "\nЦена за единицу: " + p.priceKzt + " KZT\nВыберите количество:", {
      inline_keyboard: [[1, 2, 3, 5].map((quantity) => ({ text: "×" + quantity, callback_data: "quantity:" + id + ":" + quantity }))]
    });
  }
  if (data.startsWith("quantity:")) {
    const parts = data.split(":");
    const productId = parts[1];
    const quantity = Number(parts[2]);
    const product = commerce.getCatalog().find((p) => p.id === productId);
    if (!product || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) {
      return sendText(chatId, "Товар или количество недоступны. Откройте /catalog заново.");
    }
    return sendText(chatId, product.name + " × " + quantity + "\nСумма товаров: " + product.priceKzt * quantity + " KZT\nВыберите получение:", {
      inline_keyboard: [
        [{ text: "САМОВЫВОЗ", callback_data: "buy:pickup:" + productId + ":" + quantity }],
        [{ text: "ДОСТАВКА", callback_data: "buy:delivery:" + productId + ":" + quantity }]
      ]
    });
  }
  if (data.startsWith("buy:pickup:")) {
    const parts = data.slice("buy:pickup:".length).split(":");
    const productId = parts[0];
    const quantity = parts[1] == null ? 1 : Number(parts[1]);
    await createAndRequestPayment(chatId, { customerId: userId, productId, quantity, fulfillment: "pickup" }, updateId);
    return;
  }
  if (data.startsWith("buy:delivery:")) {
    const parts = data.slice("buy:delivery:".length).split(":");
    const productId = parts[0];
    const quantity = parts[1] == null ? 1 : Number(parts[1]);
    if (!commerce.getCatalog().some((p) => p.id === productId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) {
      return sendText(chatId, "Товар или количество недоступны. Откройте /catalog заново.");
    }
    const zones = commerce.getDeliveryZones();
    const buttons = Object.entries(zones).map(([zone, fee], index) => [{ text: zone + " — доставка " + fee + " KZT", callback_data: "zone:" + productId + ":" + quantity + ":" + index }]);
    if (!buttons.length) return sendText(chatId, "Зоны доставки не настроены.");
    return sendText(chatId, "Выберите зону доставки:", { inline_keyboard: buttons });
  }
  if (data.startsWith("zone:")) {
    const parts = data.split(":");
    const productId = parts[1];
    const hasQuantity = parts.length >= 4;
    const quantity = hasQuantity ? Number(parts[2]) : 1;
    const zoneIndex = Number(hasQuantity ? parts[3] : parts[2]);
    const zone = Object.keys(commerce.getDeliveryZones())[zoneIndex];
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100 ||
        !Number.isSafeInteger(zoneIndex) || !zone ||
        !commerce.getCatalog().some((p) => p.id === productId)) {
      return sendText(chatId, "Товар, количество или зона доставки недоступны.");
    }
    setSession(userId, { state: "delivery_address", productId, quantity, zone });
    return sendText(chatId, "Отправьте полный адрес одной строкой. Зона: " + zone + ". Количество: " + quantity + ". Не отправляйте платёжные данные.");
  }
  if (data.startsWith("courier:assign:")) {
    if (!isCourier(userId) && !isAdmin(userId)) return sendText(chatId, "Нет доступа к заказам курьера.");
    const orderId = data.slice("courier:assign:".length);
    try {
      const order = commerce.assignCourier(orderId, userId);
      await sendText(chatId, "Заказ назначен вам:\n" + orderSummary(order) + "\nАдрес: " + order.address + "\nФото после получения: /photo " + order.id);
    } catch (error) { await sendText(chatId, "Не удалось назначить заказ: " + (error.code || "ERROR")); }
    return;
  }
}
async function handleMessage(message, updateId) {
  const chatId = message.chat?.id;
  const userId = String(message.from?.id || "");
  if (!chatId || !userId || message.from?.is_bot || message.chat?.type !== "private") return;
  const text = String(message.text || "").trim();
  const session = readSessions()[userId];
  if (message.photo?.length && session?.state === "awaiting_order_photo") {
    const orderId = session.orderId;
    const existingOrder = commerce.getOrder(orderId);
    const incomingPhoto = message.photo[message.photo.length - 1];
    if (existingOrder?.proof?.customerSentAt && existingOrder.proof.telegramFileId === incomingPhoto.file_id) {
      setSession(userId, null);
      await sendText(chatId, "Фото по заказу " + orderId + " уже доставлено клиенту; повторную отправку не выполнял.");
      return;
    }
    const photo = message.photo[message.photo.length - 1];
    const caption = String(message.caption || "");
    const gps = caption.match(/GPS:\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/i);
    try {
      const order = commerce.attachProof(orderId, userId, { telegramFileId: photo.file_id, latitude: gps ? Number(gps[1]) : null, longitude: gps ? Number(gps[2]) : null });
      setSession(userId, null);
      await tg("sendPhoto", { chat_id: order.customerId, photo: photo.file_id, caption: "Фото по заказу " + order.id + (gps ? "\nGPS: " + gps[1] + ", " + gps[2] : "") + "\nСтатус: фото получено" });
      commerce.markPhotoDelivered(order.id, userId, photo.file_id);
      await sendText(chatId, "Фото привязано к заказу " + order.id + " и отправлено клиенту. Для завершения: /done " + order.id);
    } catch (error) { await sendText(chatId, "Фото не принято: " + (error.code || "ERROR")); }
    return;
  }
  if (session?.state === "delivery_address" && text && !text.startsWith("/")) {
    try {
      await createAndRequestPayment(chatId, { customerId: userId, productId: session.productId, quantity: session.quantity || 1, fulfillment: "delivery", address: text, deliveryZone: session.zone }, updateId);
      setSession(userId, null);
    } catch (error) { await sendText(chatId, "Не удалось создать заказ: " + (error.code || "ERROR")); }
    return;
  }
  if (text === "/start" || text.startsWith("/start ")) {
    return sendText(chatId, "SAMURAI Заказы\nКаталог, оплата, самовывоз и доставка в одном боте.", {
      inline_keyboard: [[{ text: "ОТКРЫТЬ КАТАЛОГ", callback_data: "catalog" }], [{ text: "МОИ ЗАКАЗЫ", callback_data: "myorders" }]]
    });
  }
  if (text === "/catalog") {
    const products = commerce.getCatalog();
    if (!products.length) return sendText(chatId, "Каталог пока не настроен.");
    return sendText(chatId, "Выберите товар:", { inline_keyboard: products.map((p) => [{ text: p.name + " — " + p.priceKzt + " KZT", callback_data: "product:" + p.id }]) });
  }
  if (text === "/myorders") {
    const orders = commerce.listOrders({ customerId: userId });
    return sendText(chatId, orders.length ? orders.slice(0, 20).map(orderSummary).join("\n\n") : "Заказов пока нет.");
  }
  if (text.startsWith("/pay ")) {
    const orderId = text.slice(5).trim();
    const order = commerce.getOrder(orderId);
    if (!order || order.customerId !== userId) return sendText(chatId, "Заказ не найден.");
    if (order.paymentStatus === "PAID") return sendText(chatId, "Заказ уже оплачен.\n" + orderSummary(order));
    try {
      const checkout = await commerce.createCheckoutSession(order.id);
      return sendText(chatId, orderSummary(checkout.order) + "\n\nОплата доступна по ссылке ниже. Статус изменится только после подтверждения Stripe.", {
        inline_keyboard: [[{ text: "ПОВТОРИТЬ ОПЛАТУ В ТЕСТОВОМ РЕЖИМЕ", url: checkout.url }]]
      });
    } catch (error) {
      return sendText(chatId, "Ссылку оплаты создать не удалось: " + (error.code || "PAYMENT_SETUP_REQUIRED") + ". Заказ остаётся неоплаченным.");
    }
  }
  if (text === "/courier") {
    if (!isCourier(userId) && !isAdmin(userId)) return sendText(chatId, "Эта команда доступна только назначенным курьерам.");
    const orders = commerce.listOrders({ status: "PAID" }).filter((o) => o.fulfillment === "delivery" && !o.courierId);
    return sendText(chatId, orders.length ? "Оплаченные заказы для доставки:" : "Нет новых оплаченных заказов.", orders.length ? {
      inline_keyboard: orders.slice(0, 20).map((o) => [{ text: o.id + " · " + o.totalKzt + " KZT", callback_data: "courier:assign:" + o.id }])
    } : undefined);
  }
  if (text.startsWith("/photo ")) {
    if (!isCourier(userId) && !isAdmin(userId)) return sendText(chatId, "Нет доступа.");
    const orderId = text.slice(7).trim();
    const order = commerce.getOrder(orderId);
    if (!order) return sendText(chatId, "Заказ не найден.");
    if (order.courierId !== userId) return sendText(chatId, "Заказ не назначен вам.");
    setSession(userId, { state: "awaiting_order_photo", orderId });
    return sendText(chatId, "Отправьте фотографию для заказа " + orderId + ". Можно добавить к подписи GPS: широта, долгота.");
  }
  if (text.startsWith("/done ")) {
    if (!isCourier(userId) && !isAdmin(userId)) return sendText(chatId, "Нет доступа.");
    try {
      const order = commerce.markDelivered(text.slice(6).trim(), userId);
      await sendText(order.customerId, "Заказ " + order.id + " отмечен доставленным. Фотоотчёт отправлен ранее.");
      return sendText(chatId, "Заказ " + order.id + " завершён.");
    } catch (error) { return sendText(chatId, "Не удалось завершить: " + (error.code || "ERROR")); }
  }
  if (text === "/help") return sendText(chatId, "/catalog — каталог\n/myorders — мои заказы\n/pay НОМЕР — повторить оплату своего заказа\n/courier — заказы курьера\n/photo НОМЕР — фотоотчёт\n/done НОМЕР — завершить доставку");
  if (text === "/admin") return sendText(chatId, isAdmin(userId) ? "Администратор подтверждён." : "Нет доступа.");
}
async function handleCommerceUpdate(update) {
  if (hasUpdate(update?.update_id)) return { duplicate: true };
  const chatId = update?.callback_query?.message?.chat?.id ?? update?.message?.chat?.id;
  try {
    let result;
    if (update?.callback_query) {
      const q = update.callback_query;
      await answerCallback(q.id, "Принято");
      result = await handleCallback(q, update?.update_id);
    } else if (update?.message) {
      result = await handleMessage(update.message, update?.update_id);
    } else {
      return { ignored: true };
    }
    markUpdate(update?.update_id);
    return result;
  } catch (error) {
    console.error(JSON.stringify({
      event: "commerce_telegram_update_failed",
      updateId: Number.isSafeInteger(update?.update_id) ? update.update_id : null,
      code: String(error?.code || error?.name || "UNEXPECTED_ERROR").slice(0, 80)
    }));
    if (chatId == null) throw error;
    // Fail closed without exposing configuration, provider responses, tokens or internal errors.
    // If Telegram itself is unavailable, allow the webhook to retry the update.
    await sendText(chatId, "Не удалось обработать запрос. Проверьте настройки каталога или повторите позже.");
    markUpdate(update?.update_id);
    return { handledError: true };
  }
}
module.exports = { handleCommerceUpdate, notifyPaidOrder, retryPendingPaymentNotifications, isCourier, isAdmin };
