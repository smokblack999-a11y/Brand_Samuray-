"use strict";
const { telegram } = require("./business-bot");

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function clean(value, max = 1000) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function statusLabel(status) {
  const labels = {
    pending_payment: "ожидает оплаты",
    paid: "оплачен",
    preparing: "готовится",
    assigned: "назначен курьер",
    out_for_delivery: "у курьера",
    ready_for_pickup: "готов к самовывозу",
    delivered: "доставлен",
    picked_up: "получен",
    cancelled: "отменён"
  };
  return labels[status] || status;
}

function createCommerceTelegramBot({
  commerce,
  callTelegram = (method, payload) => telegram(method, payload),
  paymentMode = process.env.COMMERCE_PAYMENT_MODE || "disabled",
  isProduction = process.env.NODE_ENV === "production",
  dispatchChatId = process.env.COMMERCE_DISPATCH_CHAT_ID || "",
  courierChatIds = String(process.env.COMMERCE_COURIER_CHAT_IDS || "").split(",").map(x => x.trim()).filter(x => /^[1-9]\d{0,19}$/.test(x)).slice(0, 10)
} = {}) {
  if (!commerce || typeof commerce.listProducts !== "function" ||
      typeof commerce.createOrder !== "function" || typeof commerce.getOrder !== "function" ||
      typeof commerce.listCustomerOrders !== "function" || typeof commerce.getConversation !== "function" ||
      typeof commerce.setConversation !== "function" || typeof commerce.clearConversation !== "function" ||
      typeof commerce.confirmPayment !== "function" || typeof commerce.cancelOrder !== "function" ||
      typeof commerce.assignCourier !== "function" || typeof commerce.startDelivery !== "function" ||
      typeof commerce.confirmFulfilment !== "function") {
    throw fail("INVALID_COMMERCE_SERVICE", "Commerce service is missing required customer-flow methods");
  }
  if (typeof callTelegram !== "function") throw fail("INVALID_TELEGRAM_CLIENT", "callTelegram must be a function");

  async function send(chatId, text, replyMarkup = null) {
    const id = clean(chatId, 100);
    if (!id) throw fail("TELEGRAM_RECIPIENT_MISSING", "Telegram chat ID is required");
    const payload = { chat_id: id, text: String(text || "").trim().slice(0, 4096) };
    if (replyMarkup) payload.reply_markup = replyMarkup;
    await callTelegram("sendMessage", payload);
  }

  async function answerCallback(query, text = "") {
    if (!query?.id) return;
    try {
      const payload = { callback_query_id: query.id };
      if (text) payload.text = clean(text, 180);
      await callTelegram("answerCallbackQuery", payload);
    } catch {
      // A callback acknowledgement failure should not undo an already-validated order transition.
    }
  }

  function mainKeyboard() {
    return { inline_keyboard: [
      [{ text: "Каталог товаров", callback_data: "c:0" }, { text: "Мои заказы", callback_data: "o" }],
      [{ text: "Отменить текущий шаг", callback_data: "x" }]
    ] };
  }

  function menuKeyboard() {
    return { inline_keyboard: [[
      { text: "Каталог", callback_data: "c:0" },
      { text: "Мои заказы", callback_data: "o" }
    ]] };
  }

  function productById(id) {
    return commerce.listProducts().find(product => product.id === id) || null;
  }

  async function showCatalog(chatId, requestedOffset = 0) {
    const products = commerce.listProducts();
    if (!products.length) {
      await send(chatId, "Каталог пока пуст. Попробуйте позже.", mainKeyboard());
      return;
    }
    const offset = Math.max(0, Math.floor(Number(requestedOffset) / 10) * 10);
    const page = products.slice(offset, offset + 10);
    const rows = page.map(product => [{
      text: (clean(product.name, 32) + " — " + Number(product.priceKzt).toLocaleString("ru-RU") + " ₸ (" + product.stock + ")").slice(0, 64),
      callback_data: "b:" + product.id
    }]);
    const navigation = [];
    if (offset > 0) navigation.push({ text: "← Назад", callback_data: "c:" + Math.max(0, offset - 10) });
    if (offset + 10 < products.length) navigation.push({ text: "Далее →", callback_data: "c:" + (offset + 10) });
    if (navigation.length) rows.push(navigation);
    rows.push([{ text: "Мои заказы", callback_data: "o" }]);
    const pageLabel = "Каталог (" + (offset + 1) + "–" + (offset + page.length) + " из " + products.length + ")";
    await send(chatId, pageLabel + "\nВыберите товар. Цена и остаток проверяются сервером при создании заказа.", { inline_keyboard: rows });
  }

  async function showProduct(chatId, product) {
    const media = Array.isArray(product.media) ? product.media[0] : null;
    const text = clean(product.name, 160) + "\nЦена: " + Number(product.priceKzt).toLocaleString("ru-RU") + " ₸" +
      "\nВ наличии: " + product.stock +
      (product.description ? "\n\n" + clean(product.description, 850) : "");
    const keyboard = product.stock > 0 ? { inline_keyboard: [
      [{ text: "1 шт.", callback_data: "q:" + product.id + ":1" },
       { text: "2 шт.", callback_data: "q:" + product.id + ":2" },
       { text: "3 шт.", callback_data: "q:" + product.id + ":3" }],
      [{ text: "Назад в каталог", callback_data: "c:0" }]
    ] } : { inline_keyboard: [[{ text: "Назад в каталог", callback_data: "c:0" }]] };
    if (media && media.url && (media.type === "photo" || media.type === "video")) {
      const method = media.type === "video" ? "sendVideo" : "sendPhoto";
      const key = media.type === "video" ? "video" : "photo";
      await callTelegram(method, {
        chat_id: clean(chatId, 100),
        [key]: media.url,
        caption: text.slice(0, 1024),
        reply_markup: keyboard
      });
    } else {
      await send(chatId, text, keyboard);
    }
  }

  async function showOrders(chatId) {
    const orders = commerce.listCustomerOrders({ customerId: chatId, limit: 10 });
    if (!orders.length) {
      await send(chatId, "У вас пока нет заказов.", menuKeyboard());
      return;
    }
    const lines = orders.map(order =>
      clean(order.id, 40) + " — " + statusLabel(order.status) + " — " +
      Number(order.totalKzt).toLocaleString("ru-RU") + " ₸"
    );
    const rows = [];
    for (const order of orders) {
      if (order.status === "pending_payment" && order.paymentStatus === "pending") {
        rows.push([{ text: "Отменить " + clean(order.id, 24), callback_data: "z:" + order.id }]);
      }
    }
    rows.push([{ text: "Каталог", callback_data: "c:0" }]);
    await send(chatId, "Ваши последние заказы:\n" + lines.join("\n"), { inline_keyboard: rows });
  }

  async function createOrderFromSession(chatId, session, phone) {
    const order = commerce.createOrder({
      customerId: String(chatId),
      items: [{ productId: session.productId, quantity: session.quantity }],
      fulfilment: session.fulfilment,
      address: session.fulfilment === "delivery" ? session.address : "",
      pickupPoint: session.fulfilment === "pickup" ? session.pickupPoint : "",
      phone: phone || ""
    });
    commerce.clearConversation({ chatId });
    const paymentReady = String(paymentMode).toLowerCase() === "test" && !isProduction;
    const keyboard = paymentReady ? { inline_keyboard: [
      [{ text: "Тестовая оплата — без реальных денег", callback_data: "t:" + order.id }],
      [{ text: "Мои заказы", callback_data: "o" }, { text: "Каталог", callback_data: "c:0" }]
    ] } : menuKeyboard();
    const note = paymentReady
      ? "\nЭто тестовый режим: нажатие кнопки ничего не спишет."
      : "\nСпособ оплаты ещё не подключён. Не переводите деньги; заказ пока ожидает оплаты.";
    await send(chatId, "Заказ " + order.id + " создан.\nСумма: " + Number(order.totalKzt).toLocaleString("ru-RU") +
      " ₸\nСтатус: ожидает оплаты." + note, keyboard);
  }

  async function handleMessage(message) {
    const chat = message?.chat;
    const from = message?.from;
    if (!chat?.id || !from?.id || chat.type !== "private" || String(chat.id) !== String(from.id)) return false;
    const chatId = String(chat.id);
    const text = clean(message.text || "", 2000);
    const command = text.match(/^\/(start|menu|catalog|orders|cancel)(?:@[\w_]+)?(?:\s|$)/i)?.[1]?.toLowerCase();

    if (command === "start" || command === "menu") {
      commerce.clearConversation({ chatId });
      await send(chatId, "SAMURAI COMMERCE\nВыберите действие.", mainKeyboard());
      return true;
    }
    if (command === "catalog") { await showCatalog(chatId, 0); return true; }
    if (command === "orders") { await showOrders(chatId); return true; }
    if (command === "cancel") {
      commerce.clearConversation({ chatId });
      await send(chatId, "Текущий шаг оформления отменён. Уже созданные заказы не изменены.", mainKeyboard());
      return true;
    }

    const session = commerce.getConversation(chatId);
    if (session?.stage === "awaiting_delivery_photo") {
      if (!Array.isArray(message.photo) || !message.photo.length) {
        await send(chatId, "Для подтверждения доставки отправьте фото как изображение в этот чат.");
        return true;
      }
      const order = commerce.getOrder(session.orderId);
      if (!order || order.courierId !== chatId || order.status !== "out_for_delivery") {
        commerce.clearConversation({ chatId });
        await send(chatId, "Активная доставка не найдена. Обратитесь к диспетчеру.", mainKeyboard());
        return true;
      }
      const photo = message.photo[message.photo.length - 1];
      commerce.confirmFulfilment({
        orderId: order.id,
        actorId: chatId,
        photoFileId: photo.file_id,
        note: clean(message.caption || "", 500)
      });
      commerce.clearConversation({ chatId });
      await send(chatId, "Фото сохранено как подтверждение. Клиент получит его после обработки очереди уведомлений.", mainKeyboard());
      return true;
    }

    if (session?.stage === "awaiting_address") {
      if (text.length < 5 || text.length > 1000) {
        await send(chatId, "Введите адрес доставки длиной от 5 до 1000 символов, либо /cancel.");
        return true;
      }
      commerce.setConversation({ chatId, session: { ...session, address: text, stage: "awaiting_phone" } });
      await send(chatId, "Введите телефон для доставки в формате +7… либо отправьте «-», чтобы пропустить.");
      return true;
    }
    if (session?.stage === "awaiting_pickup_point") {
      if (text.length < 2 || text.length > 300) {
        await send(chatId, "Введите пункт или район самовывоза (2–300 символов), либо /cancel.");
        return true;
      }
      commerce.setConversation({ chatId, session: { ...session, pickupPoint: text, stage: "awaiting_phone" } });
      await send(chatId, "Введите телефон для связи либо отправьте «-», чтобы пропустить.");
      return true;
    }
    if (session?.stage === "awaiting_phone") {
      const ownsContact = message.contact &&
        String(message.contact.user_id || "") === chatId &&
        String(message.contact.phone_number || "").trim().length > 0;
      if (message.contact && !ownsContact) {
        await send(chatId, "Отправленный контакт не принадлежит вашему аккаунту. Введите свой номер или «-», чтобы пропустить.");
        return true;
      }
      if (!ownsContact && text !== "-" && !text) {
        await send(chatId, "Введите телефон для связи либо отправьте «-», чтобы пропустить.");
        return true;
      }
      const contactPhone = ownsContact ? clean(message.contact.phone_number, 40) : "";
      const phone = ownsContact ? contactPhone : (text === "-" ? "" : text);
      if (phone && !/^[+()0-9\s-]{5,40}$/.test(phone)) {
        await send(chatId, "Телефон содержит недопустимые символы. Введите номер или «-».");
        return true;
      }
      await createOrderFromSession(chatId, session, phone);
      return true;
    }

    await send(chatId, "Для покупок используйте каталог. Команды: /catalog, /orders, /cancel.", mainKeyboard());
    return true;
  }

  async function handleCallback(query) {
    const chat = query?.message?.chat;
    if (!chat?.id) {
      await answerCallback(query, "Кнопка устарела.");
      return true;
    }
    const chatId = String(chat.id);
    const senderId = String(query.from?.id || "");
    await answerCallback(query);
    if (chat.type !== "private" || !senderId || senderId !== chatId) {
      return true;
    }

    const data = String(query.data || "");
    try {
      if (data === "x") {
        commerce.clearConversation({ chatId });
        await send(chatId, "Текущий шаг оформления отменён.", mainKeyboard());
        return true;
      }
      if (data === "o") { await showOrders(chatId); return true; }
      const catalogMatch = data.match(/^c:(\d{1,6})$/);
      if (catalogMatch) { await showCatalog(chatId, Number(catalogMatch[1])); return true; }
      const productMatch = data.match(/^b:([A-Za-z0-9-]{1,64})$/);
      if (productMatch) {
        const product = productById(productMatch[1]);
        if (!product) { await send(chatId, "Товар недоступен.", menuKeyboard()); return true; }
        await showProduct(chatId, product);
        return true;
      }
      const quantityMatch = data.match(/^q:([A-Za-z0-9-]{1,64}):([1-3])$/);
      if (quantityMatch) {
        const product = productById(quantityMatch[1]);
        const quantity = Number(quantityMatch[2]);
        if (!product || product.stock < quantity) {
          await send(chatId, "Недостаточно товара в наличии. Обновите каталог.", menuKeyboard());
          return true;
        }
        commerce.setConversation({ chatId, session: { stage: "choose_fulfilment", productId: product.id, quantity } });
        await send(chatId, "Выберите получение заказа.", { inline_keyboard: [[
          { text: "Доставка", callback_data: "f:d" },
          { text: "Самовывоз", callback_data: "f:p" }
        ], [{ text: "Отмена", callback_data: "x" }]] });
        return true;
      }
      if (data === "f:d" || data === "f:p") {
        const session = commerce.getConversation(chatId);
        if (!session || session.stage !== "choose_fulfilment") {
          await send(chatId, "Сеанс оформления истёк. Откройте каталог заново.", mainKeyboard());
          return true;
        }
        if (data === "f:d") {
          commerce.setConversation({ chatId, session: { ...session, stage: "awaiting_address", fulfilment: "delivery" } });
          await send(chatId, "Введите адрес доставки. Не отправляйте платёжные данные.", { inline_keyboard: [[{ text: "Отмена", callback_data: "x" }]] });
        } else {
          commerce.setConversation({ chatId, session: { ...session, stage: "awaiting_pickup_point", fulfilment: "pickup" } });
          await send(chatId, "Введите пункт или район самовывоза.", { inline_keyboard: [[{ text: "Отмена", callback_data: "x" }]] });
        }
        return true;
      }
      const testPayMatch = data.match(/^t:([A-Za-z0-9-]{1,64})$/);
      if (testPayMatch) {
        if (String(paymentMode).toLowerCase() !== "test" || isProduction) {
          await send(chatId, "Тестовая оплата отключена. Не переводите деньги.");
          return true;
        }
        const order = commerce.getOrder(testPayMatch[1]);
        if (!order || order.customerId !== chatId) {
          await send(chatId, "Заказ не найден.", menuKeyboard());
          return true;
        }
        const eventId = "telegram-test:" + String(query.id || "");
        if (!query.id) { await send(chatId, "Не удалось проверить тестовое событие; попробуйте ещё раз."); return true; }
        const paid = commerce.confirmPayment({
          orderId: order.id,
          eventId,
          amountKzt: order.totalKzt,
          method: "manual_review",
          trusted: true
        });
        await send(chatId, "Тестовая оплата отмечена сервером. Реальные деньги не списаны.\nСтатус: " + statusLabel(paid.status) +
          ". Дальнейшие уведомления зависят от включённой серверной очереди.", menuKeyboard());
        return true;
      }
      const cancelOrderMatch = data.match(/^z:([A-Za-z0-9-]{1,64})$/);
      if (cancelOrderMatch) {
        const cancelled = commerce.cancelOrder({ orderId: cancelOrderMatch[1], actorId: chatId });
        await send(chatId, "Заказ " + cancelled.id + " отменён. Резерв товара освобождён.", menuKeyboard());
        return true;
      }
      const assignMatch = data.match(/^a:([A-Za-z0-9-]{1,64}):([1-9]\d{0,19})$/);
      if (assignMatch) {
        if (chatId !== String(dispatchChatId) || !courierChatIds.includes(assignMatch[2])) {
          await send(chatId, "Недостаточно прав для назначения курьера.");
          return true;
        }
        const assigned = commerce.assignCourier({ orderId: assignMatch[1], courierId: assignMatch[2] });
        await send(chatId, "Курьер назначен для заказа " + assigned.id + ". Адрес и телефон будут отправлены ему через очередь.", menuKeyboard());
        return true;
      }
      const startMatch = data.match(/^s:([A-Za-z0-9-]{1,64})$/);
      if (startMatch) {
        const started = commerce.startDelivery({ orderId: startMatch[1], courierId: chatId });
        commerce.setConversation({ chatId, session: { stage: "awaiting_delivery_photo", orderId: started.id } });
        await send(chatId, "Доставка начата. После вручения отправьте фото подтверждения в этот чат.", { inline_keyboard: [[{ text: "Открыть меню", callback_data: "m" }]] });
        return true;
      }
      if (data === "m") {
        await send(chatId, "SAMURAI COMMERCE\nВыберите действие.", mainKeyboard());
        return true;
      }
      const pickupMatch = data.match(/^p:([A-Za-z0-9-]{1,64})$/);
      if (pickupMatch) {
        const picked = commerce.confirmFulfilment({ orderId: pickupMatch[1], actorId: chatId, note: "Самовывоз подтверждён клиентом" });
        await send(chatId, "Самовывоз подтверждён для заказа " + picked.id + ".", menuKeyboard());
        return true;
      }
      await send(chatId, "Эта кнопка устарела. Откройте меню.", mainKeyboard());
      return true;
    } catch (error) {
      const safeMessages = {
        INSUFFICIENT_STOCK: "Недостаточно товара в наличии.",
        PRODUCT_NOT_AVAILABLE: "Товар больше недоступен.",
        INVALID_ORDER_STATE: "Это действие недоступно на текущем этапе заказа.",
        ORDER_ALREADY_PAID: "Этот заказ уже оплачен.",
        REFUND_REQUIRED: "Оплаченный заказ нельзя отменить до настройки возврата.",
        FORBIDDEN: "Вы не можете изменять этот заказ.",
        PAYMENT_AMOUNT_MISMATCH: "Сумма не совпадает с заказом.",
        INVALID_DELIVERY_PROOF: "Для доставки требуется фото подтверждения."
      };
      await send(chatId, safeMessages[error.code] || "Не удалось выполнить действие. Проверьте статус заказа и попробуйте снова.", mainKeyboard());
      return true;
    }
  }

  async function handleUpdate(update) {
    if (update?.callback_query) return handleCallback(update.callback_query);
    if (update?.message?.chat?.type === "private") return handleMessage(update.message);
    return false;
  }

  return { handleUpdate };
}

module.exports = { createCommerceTelegramBot };
