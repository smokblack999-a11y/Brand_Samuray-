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
const inFlightDuplicatePaymentNotifications = new Set();
const inFlightTelegramUpdates = new Set();

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
    if (checkout.alreadyPaid || checkout.order.paymentStatus === "PAID") {
      await notifyPaidOrder(checkout.order);
      return order;
    }
    await sendText(chatId, orderSummary(checkout.order) + "\n\nОплатите по ссылке ниже. Заказ будет отмечен оплаченным только после проверенного уведомления Stripe.", {
      inline_keyboard: [[{ text: "ОПЛАТИТЬ В ТЕСТОВОМ РЕЖИМЕ", url: checkout.url }]]
    });
  } catch (error) {
    const statusUncertain = ["PAYMENT_STATUS_UNAVAILABLE", "PAYMENT_STATUS_PENDING"].includes(error.code);
    await sendText(chatId, orderSummary(commerce.getOrder(order.id) || order) + "\n\n" +
      (statusUncertain
        ? "Не удалось безопасно проверить предыдущую платёжную сессию. Новая ссылка НЕ создана, чтобы избежать двойного списания. Повторите /pay " + order.id + " позже или попросите администратора проверить Stripe."
        : "Ссылка оплаты не создана: " + (error.code || "PAYMENT_SETUP_REQUIRED") + ". Оплата не подтверждена. Администратору нужно проверить настройки платёжного провайдера."));
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
async function notifyDuplicatePayment(orderInput) {
  const orderId = String(orderInput?.id || "");
  if (!orderId) return { skipped: true };
  if (inFlightDuplicatePaymentNotifications.has(orderId)) return { inFlight: true, orderId };
  inFlightDuplicatePaymentNotifications.add(orderId);
  try {
    let order = commerce.getOrder(orderId);
    if (!order || !Array.isArray(order.duplicatePaymentIncidents) || !order.duplicatePaymentIncidents.length) return { skipped: true };
    const admins = String(process.env.COMMERCE_ADMIN_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
    for (const incident of order.duplicatePaymentIncidents) {
      if (incident.status !== "REVIEW_REQUIRED") continue;
      for (const adminId of admins) {
        if (Array.isArray(incident.adminNotifiedIds) && incident.adminNotifiedIds.includes(adminId)) continue;
        try {
          await sendText(
            adminId,
            "ВНИМАНИЕ: возможен повторный платёж. Заказ " + order.id +
            "\nСумма второго события: " + incident.amountKzt + " " + incident.currency +
            "\nCheckout Session: " + incident.sessionId +
            "\nСобытие: " + incident.eventId +
            "\nНе отправляйте второй заказ. Сверьте обе операции в кабинете Stripe и выполните ручную сверку/возврат при необходимости. Инцидент не считается закрытым автоматически."
          );
          commerce.markDuplicatePaymentIncidentNotified(order.id, incident.sessionId, adminId);
          order = commerce.getOrder(order.id) || order;
        } catch {
          console.error(JSON.stringify({ event: "duplicate_payment_admin_notify_failed", orderId: order.id, code: "TELEGRAM_SEND_FAILED" }));
        }
      }
    }
    return { orderId: order.id };
  } finally {
    inFlightDuplicatePaymentNotifications.delete(orderId);
  }
}

async function notifyPaymentReceiptAdmins(orderInput, receiptFileId) {
  const order = commerce.getOrder(orderInput?.id);
  if (!order || !Array.isArray(order.paymentReceipts)) return { skipped: true };
  const admins = String(process.env.COMMERCE_ADMIN_IDS || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!admins.length) return { skipped: true, reason: "NO_ADMINS_CONFIGURED" };
  const receipts = receiptFileId
    ? order.paymentReceipts.filter((r) => r.telegramFileId === receiptFileId)
    : order.paymentReceipts;
  for (const receipt of receipts) {
    for (const adminId of admins) {
      if (Array.isArray(receipt.adminSentIds) && receipt.adminSentIds.includes(adminId)) continue;
      try {
        const address = order.fulfillment === "delivery" ? "\nАдрес: " + order.address : "";
        await tg("sendPhoto", {
          chat_id: adminId,
          photo: receipt.telegramFileId,
          caption: "ЧЕК ПОЛУЧЕН — ОПЛАТА НЕ ПОДТВЕРЖДЕНА\n" +
            orderSummary(order) + address +
            "\nID клиента: " + order.customerId +
            "\nОтправлено: " + receipt.submittedAt +
            "\nПроверьте фактическое поступление по банковскому кабинету/API. Фото или чек сам по себе не является подтверждением оплаты."
        });
        commerce.markPaymentReceiptAdminNotified(order.id, receipt.telegramFileId, adminId);
      } catch {
        console.error(JSON.stringify({ event: "payment_receipt_admin_notify_failed", orderId: order.id, code: "TELEGRAM_SEND_FAILED" }));
      }
    }
  }
  return { orderId: order.id, receipts: receipts.length };
}

async function retryPendingPaymentNotifications() {
  // Payment state is durable before any Telegram send. Re-check all paid orders so a
  // process restart or a Telegram outage cannot permanently lose customer/courier alerts.
  const orders = commerce.listPaidOrders();
  for (const order of orders) {
    try { await notifyPaidOrder(order); }
    catch { console.error(JSON.stringify({ event: "commerce_notification_retry_failed", orderId: order.id })); }
  }
  let duplicatePaymentIncidentsScanned = 0;
  for (const order of orders) {
    if (Array.isArray(order.duplicatePaymentIncidents) &&
        order.duplicatePaymentIncidents.some((incident) => incident.status === "REVIEW_REQUIRED")) {
      duplicatePaymentIncidentsScanned += 1;
      try { await notifyDuplicatePayment(order); }
      catch { console.error(JSON.stringify({ event: "duplicate_payment_retry_failed", orderId: order.id })); }
    }
  }
  const receiptOrders = commerce.listPaymentReviewOrders();
  for (const order of receiptOrders) {
    try { await notifyPaymentReceiptAdmins(order); }
    catch { console.error(JSON.stringify({ event: "payment_receipt_retry_failed", orderId: order.id })); }
  }
  return {
    scannedPaidOrders: orders.length,
    scannedReceiptOrders: receiptOrders.length,
    duplicatePaymentIncidentsScanned
  };
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
  if (data.startsWith("bank:confirm:")) {
    if (!isAdmin(userId)) return sendText(chatId, "Нет доступа.");
    const orderId = data.slice("bank:confirm:".length);
    const pending = readSessions()[userId];
    if (!pending || pending.state !== "confirm_bank_payment" || pending.orderId !== orderId) {
      return sendText(chatId, "Подтверждение устарело. Откройте заказ повторно через /review НОМЕР.");
    }
    const order = commerce.getOrder(orderId);
    if (!order || order.status !== "PAYMENT_REVIEW" || order.paymentStatus === "PAID") {
      setSession(userId, null);
      return sendText(chatId, "Заказ больше не находится в очереди ручной сверки.");
    }
    try {
      const paid = commerce.reconcileManualBankPayment(orderId, userId, pending.bankReference);
      setSession(userId, null);
      await notifyPaidOrder(paid);
      await sendText(chatId,
        "Ручная сверка записана в аудит.\nЗаказ: " + paid.id +
        "\nПровайдер: manual_bank_reconciliation" +
        "\nБанковская ссылка: " + paid.paymentReference +
        "\nПодтвердил Telegram ID: " + userId +
        "\nПередача курьеру разрешена только после твоего подтверждения."
      );
    } catch (error) {
      setSession(userId, null);
      await sendText(chatId, "Не удалось подтвердить перевод: " + (error.code || "ERROR") + ". Проверьте заказ и уникальность ссылки на транзакцию.");
    }
    return;
  }
  if (data.startsWith("bank:cancel:")) {
    if (!isAdmin(userId)) return sendText(chatId, "Нет доступа.");
    const orderId = data.slice("bank:cancel:".length);
    const pending = readSessions()[userId];
    if (pending?.state === "confirm_bank_payment" && pending.orderId === orderId) setSession(userId, null);
    return sendText(chatId, "Ручная сверка отменена. Оплата не подтверждена.");
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
  if (message.photo?.length && session?.state === "awaiting_payment_receipt") {
    const orderId = String(session.orderId || "");
    const photo = message.photo[message.photo.length - 1];
    try {
      const order = commerce.submitPaymentReceipt(orderId, userId, {
        telegramFileId: photo.file_id,
        fileUniqueId: photo.file_unique_id
      });
      setSession(userId, null);
      await notifyPaymentReceiptAdmins(order, photo.file_id);
      await sendText(chatId,
        "Чек прикреплён к заказу " + order.id + " и отправлен на проверку.\n" +
        "Текущий статус: PAYMENT_REVIEW. Это НЕ подтверждение поступления денег. " +
        "Передача курьеру будет разрешена только после подтверждения оплаты по доверенному источнику."
      );
    } catch (error) {
      setSession(userId, null);
      const message = error.code === "FORBIDDEN"
        ? "Чек не принят: заказ не найден или принадлежит другому клиенту."
        : error.code === "ORDER_NOT_REVIEWABLE"
          ? "Чек не принят: заказ уже оплачен, отменён или завершён."
          : "Чек не принят. Проверьте заказ и попробуйте снова.";
      await sendText(chatId, message);
    }
    return;
  }
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
      if (checkout.alreadyPaid || checkout.order.paymentStatus === "PAID") {
        await notifyPaidOrder(checkout.order);
        return;
      }
      return sendText(chatId, orderSummary(checkout.order) + "\n\nОплата доступна по ссылке ниже. Статус изменится только после подтверждения Stripe.", {
        inline_keyboard: [[{ text: "ПОВТОРИТЬ ОПЛАТУ В ТЕСТОВОМ РЕЖИМЕ", url: checkout.url }]]
      });
    } catch (error) {
      const statusUncertain = ["PAYMENT_STATUS_UNAVAILABLE", "PAYMENT_STATUS_PENDING"].includes(error.code);
      return sendText(chatId, statusUncertain
        ? "Не удалось проверить предыдущую платёжную сессию. Новая ссылка не создана, чтобы избежать двойного списания. Попробуйте /pay " + orderId + " позже."
        : "Ссылку оплаты создать не удалось: " + (error.code || "PAYMENT_SETUP_REQUIRED") + ". Оплата не подтверждена.");
    }
  }
  if (text.startsWith("/receipt ")) {
    const orderId = text.slice("/receipt ".length).trim();
    const order = commerce.getOrder(orderId);
    if (!order || order.customerId !== userId) return sendText(chatId, "Заказ не найден.");
    if (order.paymentStatus === "PAID") return sendText(chatId, "Заказ уже оплачен. Повторно отправлять чек не нужно.");
    if (["CANCELLED", "DELIVERED"].includes(order.status)) return sendText(chatId, "Этот заказ уже закрыт и не принимает чеки.");
    setSession(userId, { state: "awaiting_payment_receipt", orderId });
    return sendText(chatId,
      "Пришлите фото чека для заказа " + order.id + ".\n" +
      "Чек будет передан администратору на ручную сверку. Скриншот сам по себе не подтверждает поступление денег, а заказ не будет передан курьеру до проверки."
    );
  }
  if (text === "/courier") {
    if (!isCourier(userId) && !isAdmin(userId)) return sendText(chatId, "Эта команда доступна только назначенным курьерам.");
    const orders = commerce.listOrders({ status: "PAID" }).filter((o) => o.fulfillment === "delivery" && !o.courierId);
    return sendText(chatId, orders.length ? "Оплаченные заказы для доставки:" : "Нет новых оплаченных заказов.", orders.length ? {
      inline_keyboard: orders.slice(0, 20).map((o) => [{ text: o.id + " · " + o.totalKzt + " KZT", callback_data: "courier:assign:" + o.id }])
    } : undefined);
  }
  if (text === "/admin") {
    if (!isAdmin(userId)) return sendText(chatId, "Нет доступа.");
    const orders = commerce.listOrders();
    const count = (predicate) => orders.filter(predicate).length;
    return sendText(chatId,
      "SAMURAI · Сводка\n" +
      "Всего заказов: " + orders.length + "\n" +
      "Ожидают оплаты: " + count((o) => o.paymentStatus !== "PAID" && o.status !== "CANCELLED") + "\n" +
      "Чеки на ручной сверке: " + count((o) => o.status === "PAYMENT_REVIEW" && o.paymentStatus !== "PAID") + "\n" +
      "Самовывоз готов: " + count((o) => o.status === "READY_FOR_PICKUP") + "\n" +
      "Доставка без курьера: " + count((o) => o.fulfillment === "delivery" && o.paymentStatus === "PAID" && !o.courierId) + "\n" +
      "В доставке: " + count((o) => ["COURIER_ASSIGNED", "IN_DELIVERY", "PHOTO_RECEIVED"].includes(o.status)) + "\n" +
      "Доставлено: " + count((o) => o.status === "DELIVERED") + "\n" +
      "Платёжные инциденты: " + count((o) => Array.isArray(o.duplicatePaymentIncidents) && o.duplicatePaymentIncidents.some((i) => i.status === "REVIEW_REQUIRED")) + "\n\n" +
      "Команды администратора: /orders, /order НОМЕР"
    );
  }
  if (text.startsWith("/confirmbank ")) {
    if (!isAdmin(userId)) return sendText(chatId, "Нет доступа.");
    const parts = text.slice("/confirmbank ".length).trim().split(/\s+/);
    if (parts.length !== 2) return sendText(chatId, "Формат: /confirmbank НОМЕР_ЗАКАЗА БАНКОВСКАЯ_ССЫЛКА");
    const [orderId, bankReference] = parts;
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{4,127}$/.test(bankReference)) {
      return sendText(chatId, "Неверный формат банковской ссылки. Используйте 5–128 букв/цифр и символы . _ / -.");
    }
    const order = commerce.getOrder(orderId);
    if (!order || order.status !== "PAYMENT_REVIEW" || order.paymentStatus === "PAID" ||
        !Array.isArray(order.paymentReceipts) || order.paymentReceipts.length === 0) {
      return sendText(chatId, "Заказ не находится в очереди ручной сверки или не содержит чека.");
    }
    setSession(userId, { state: "confirm_bank_payment", orderId, bankReference });
    return sendText(chatId,
      "ПОДТВЕРЖДЕНИЕ БАНКОВСКОГО ПЕРЕВОДА\n" + orderSummary(order) +
      "\nСсылка транзакции: " + bankReference +
      "\n\nПродолжайте только если лично проверили фактически зачисленную сумму в банковском кабинете/выписке и сверили получателя, сумму, валюту и время. Чек/скриншот сам по себе не подтверждает оплату.",
      { inline_keyboard: [
        [{ text: "Я ПРОВЕРИЛ ФАКТИЧЕСКОЕ ЗАЧИСЛЕНИЕ", callback_data: "bank:confirm:" + order.id }],
        [{ text: "ОТМЕНИТЬ", callback_data: "bank:cancel:" + order.id }]
      ] }
    );
  }
  if (text === "/paymentreviews") {
    if (!isAdmin(userId)) return sendText(chatId, "Нет доступа.");
    const orders = commerce.listPaymentReviewOrders().slice(0, 20);
    return sendText(chatId, orders.length
      ? "Чеки ожидают ручной сверки:\n\n" + orders.map((o) =>
          orderSummary(o) + "\nЧеков: " + (Array.isArray(o.paymentReceipts) ? o.paymentReceipts.length : 0) + "\nПовторно открыть: /review " + o.id
        ).join("\n\n---\n\n")
      : "Нет чеков, ожидающих сверки."
    );
  }
  if (text.startsWith("/review ")) {
    if (!isAdmin(userId)) return sendText(chatId, "Нет доступа.");
    const orderId = text.slice("/review ".length).trim();
    const order = commerce.getOrder(orderId);
    if (!order || order.status !== "PAYMENT_REVIEW") return sendText(chatId, "Заказ не найден в очереди ручной сверки.");
    const receipts = Array.isArray(order.paymentReceipts) ? order.paymentReceipts.slice(-5) : [];
    if (!receipts.length) return sendText(chatId, "У этого заказа нет сохранённых чеков.");
    await sendText(chatId,
      "Ручная сверка. Не отмечайте оплату по скриншоту одному.\n" + orderSummary(order) +
      (order.fulfillment === "delivery" ? "\nАдрес: " + order.address : "") +
      "\nСверьте фактическое поступление в банке или у провайдера."
    );
    for (const receipt of receipts) {
      await tg("sendPhoto", { chat_id: chatId, photo: receipt.telegramFileId, caption: "Чек для " + order.id + " · НЕ ПОДТВЕРЖДЕНИЕ ОПЛАТЫ · " + receipt.submittedAt });
      commerce.markPaymentReceiptAdminNotified(order.id, receipt.telegramFileId, userId);
    }
    return;
  }
  if (text === "/orders") {
    if (!isAdmin(userId)) return sendText(chatId, "Нет доступа.");
    const orders = commerce.listOrders().slice(0, 20);
    return sendText(chatId, orders.length
      ? "Последние заказы (до 20):\n\n" + orders.map((o) =>
          orderSummary(o) + (o.fulfillment === "delivery" ? "\nАдрес: " + o.address : "")
        ).join("\n\n---\n\n")
      : "Заказов пока нет."
    );
  }
  if (text.startsWith("/order ")) {
    if (!isAdmin(userId)) return sendText(chatId, "Нет доступа.");
    const orderId = text.slice(7).trim();
    const order = commerce.getOrder(orderId);
    if (!order) return sendText(chatId, "Заказ не найден.");
    return sendText(chatId,
      orderSummary(order) + "\nКлиент Telegram ID: " + order.customerId +
      (order.fulfillment === "delivery" ? "\nАдрес: " + order.address + "\nЗона: " + order.deliveryZone : "") +
      "\nКурьер: " + (order.courierId || "не назначен") +
      "\nЧеков на оплату: " + (Array.isArray(order.paymentReceipts) ? order.paymentReceipts.length : 0) +
      (order.status === "PAYMENT_REVIEW" ? "\nСтатус чека: ожидает ручной сверки; оплата не подтверждена" : "") +
      "\nФотоотчёт: " + (order.proof ? "получен" : "нет") +
      (order.proof?.latitude != null ? "\nGPS: " + order.proof.latitude + ", " + order.proof.longitude +
        (order.proof.accuracyMeters == null ? "" : " ± " + order.proof.accuracyMeters + " м") : "") +
      (Array.isArray(order.duplicatePaymentIncidents) && order.duplicatePaymentIncidents.length
        ? "\n\nВНИМАНИЕ: " + order.duplicatePaymentIncidents.filter((i) => i.status === "REVIEW_REQUIRED").length + " платёжных инцидента(ов), требуется сверка в Stripe." : "")
    );
  }
  if (text === "/mydelivery") {
    if (!isCourier(userId) && !isAdmin(userId)) return sendText(chatId, "Эта команда доступна только курьерам.");
    const orders = commerce.listOrders({ courierId: userId })
      .filter((o) => !["DELIVERED", "CANCELLED"].includes(o.status));
    return sendText(chatId, orders.length
      ? "Ваши активные доставки:\n\n" + orders.map((o) =>
          orderSummary(o) + "\nАдрес: " + o.address + "\nФото: " +
          (o.proof?.customerSentAt ? "отправлено клиенту" : o.proof ? "получено, отправка ожидается" : "ожидается")
        ).join("\n\n---\n\n")
      : "Активных доставок нет."
    );
  }
  if (text.startsWith("/startdelivery ")) {
    if (!isCourier(userId) && !isAdmin(userId)) return sendText(chatId, "Нет доступа.");
    const orderId = text.slice("/startdelivery ".length).trim();
    try {
      const current = commerce.getOrder(orderId);
      if (!current) return sendText(chatId, "Заказ не найден.");
      if (current.courierId !== userId) return sendText(chatId, "Заказ не назначен вам.");
      if (current.status === "IN_DELIVERY") return sendText(chatId, "Заказ уже отмечен как находящийся в пути.");
      const order = commerce.markInDelivery(orderId, userId);
      await sendText(order.customerId, "Заказ " + order.id + " передан курьеру и находится в пути.");
      return sendText(chatId, "Статус обновлён. После прибытия отправьте /photo " + order.id);
    } catch (error) {
      return sendText(chatId, "Не удалось начать доставку: " + (error.code || "ERROR"));
    }
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
  if (text === "/help") return sendText(chatId, "/catalog — каталог\n/myorders — мои заказы\n/pay НОМЕР — повторить оплату своего заказа\n/courier — очередь доставок\n/mydelivery — мои активные доставки\n/startdelivery НОМЕР — начать доставку\n/photo НОМЕР — фотоотчёт\n/done НОМЕР — завершить доставку\n\nКлиент: /receipt НОМЕР — отправить чек на ручную сверку\nАдминистратор: /admin, /orders, /order НОМЕР, /paymentreviews, /review НОМЕР, /confirmbank НОМЕР ССЫЛКА");
}
async function handleCommerceUpdate(update) {
  const rawUpdateId = update?.update_id;
  const updateId = Number.isSafeInteger(rawUpdateId) ? rawUpdateId : null;
  const updateKey = updateId == null ? null : String(updateId);
  if (updateId != null && hasUpdate(updateId)) return { duplicate: true };
  if (updateKey && inFlightTelegramUpdates.has(updateKey)) return { duplicate: true, inFlight: true };
  if (updateKey) inFlightTelegramUpdates.add(updateKey);
  const chatId = update?.callback_query?.message?.chat?.id ?? update?.message?.chat?.id;
  try {
    try {
      let result;
      if (update?.callback_query) {
        const q = update.callback_query;
        await answerCallback(q.id, "Принято");
        result = await handleCallback(q, updateId);
      } else if (update?.message) {
        result = await handleMessage(update.message, updateId);
      } else {
        return { ignored: true };
      }
      markUpdate(updateId);
      return result;
    } catch (error) {
      console.error(JSON.stringify({
        event: "commerce_telegram_update_failed",
        updateId,
        code: String(error?.code || error?.name || "UNEXPECTED_ERROR").slice(0, 80)
      }));
      if (chatId == null) throw error;
      // Do not expose configuration, provider responses, tokens or internal errors.
      // If Telegram itself is unavailable, let Telegram retry the update.
      await sendText(chatId, "Не удалось обработать запрос. Проверьте настройки каталога или повторите позже.");
      markUpdate(updateId);
      return { handledError: true };
    }
  } finally {
    if (updateKey) inFlightTelegramUpdates.delete(updateKey);
  }
}
module.exports = { handleCommerceUpdate, notifyPaidOrder, notifyDuplicatePayment, retryPendingPaymentNotifications, isCourier, isAdmin };
