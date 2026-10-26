"use strict";

(() => {
  const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
  const initData = tg && typeof tg.initData === "string" ? tg.initData : "";
  let activeOrderId = "";
  let products = [];
  const busy = new Set();

  const $ = (id) => document.getElementById(id);
  const catalogRoot = $("catalog");
  const catalogState = $("catalog-state");
  const orderInput = $("order-id");
  const orderState = $("order-state");
  const orderActions = $("order-actions");
  const toast = $("toast");

  const errorMessages = {
    INVALID_WEBAPP_AUTH: "Сессия Telegram не подтверждена или устарела. Закройте и снова откройте магазин из Telegram.",
    INVALID_WEBAPP_IDENTITY: "Не удалось подтвердить пользователя Telegram. Перезапустите Mini App.",
    PRODUCT_NOT_FOUND: "Товар больше недоступен.",
    INSUFFICIENT_STOCK: "Недостаточно товара на складе.",
    INVALID_SKU: "Не удалось определить товар.",
    INVALID_QUANTITY: "Проверьте количество товара.",
    ORDER_NOT_FOUND: "Заказ не найден в вашей учётной записи.",
    ORDER_NOT_PENDING: "Этот заказ уже нельзя оплатить.",
    ORDER_CANCELLED: "Заказ отменён.",
    ORDER_ALREADY_FULFILLED: "Заказ уже обработан.",
    STRIPE_TEST_DISABLED: "Тестовая оплата отключена.",
    STRIPE_TEST_NOT_CONFIGURED: "Тестовый Checkout пока не настроен на сервере.",
    STRIPE_UPSTREAM_UNAVAILABLE: "Платёжный тестовый сервис сейчас недоступен.",
    STRIPE_SESSION_INVALID: "Платёжный сервис вернул некорректную тестовую сессию.",
    STRIPE_CHECKOUT_RECONCILIATION_REQUIRED: "Предыдущий запрос оплаты мог создать сессию. Заказ нельзя отменять до сверки платёжного состояния.",
    STRIPE_CHECKOUT_ACTIVE: "У заказа уже есть активная платёжная сессия. Продолжите оплату или дождитесь её истечения.",
    COMMERCE_NOT_READY: "Модуль магазина не готов. Проверьте серверные журналы.",
    COMMERCE_MINIAPP_DISABLED: "Магазин пока выключен на сервере."
  };

  function showToast(message) {
    toast.textContent = message;
    toast.hidden = false;
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => { toast.hidden = true; }, 4400);
  }

  function setCatalogState(message, kind = "") {
    catalogState.textContent = message;
    if (kind) catalogState.dataset.kind = kind;
    else delete catalogState.dataset.kind;
  }

  function setOrderState(message, kind = "") {
    orderState.textContent = message;
    if (kind) orderState.dataset.kind = kind;
    else delete orderState.dataset.kind;
  }

  function setBusy(key, on) {
    if (on) busy.add(key); else busy.delete(key);
    document.querySelectorAll("[data-busy-key]").forEach((button) => {
      button.disabled = button.dataset.baseDisabled === "true" || busy.has(button.dataset.busyKey);
    });
  }

  async function api(path, options = {}) {
    if (!initData) throw Object.assign(new Error("Telegram WebApp initData missing"), { code: "INVALID_WEBAPP_AUTH" });
    const headers = { "X-Telegram-Init-Data": initData, "Accept": "application/json" };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    let response;
    try {
      response = await fetch(path, {
        method: options.method || "GET",
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        cache: "no-store",
        credentials: "same-origin"
      });
    } catch {
      throw Object.assign(new Error("Network unavailable"), { code: "NETWORK_UNAVAILABLE" });
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const code = payload && payload.error && typeof payload.error.code === "string" ? payload.error.code : "REQUEST_FAILED";
      throw Object.assign(new Error(errorMessages[code] || "Запрос не выполнен. Повторите позже."), { code, status: response.status });
    }
    return payload;
  }

  function formatPrice(product) {
    const amount = product.currency === "KZT" ? (product.priceKzt ?? product.priceMinor) : product.priceMinor / 100;
    try {
      return new Intl.NumberFormat("ru-RU", { style: "currency", currency: product.currency, maximumFractionDigits: product.currency === "KZT" ? 0 : 2 }).format(amount);
    } catch {
      return String(product.price || (amount + " " + product.currency));
    }
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function renderProducts() {
    catalogRoot.replaceChildren();
    for (const product of products) {
      const card = element("article", "product-card");
      const top = element("div", "product-topline");
      top.append(element("span", "type-label", product.type === "digital" ? "ЦИФРОВОЙ ТОВАР" : "ФИЗИЧЕСКИЙ ТОВАР"));
      top.append(element("span", "stock-label", product.inventoryTracked === false ? "Остатки не отслеживаются" : product.stock > 0 ? "Доступно" : "Нет в наличии"));
      const name = element("h3", "", product.name);
      const description = element("p", "description", product.description || "Демонстрационная позиция каталога.");
      const price = element("div", "price");
      price.append(document.createTextNode(formatPrice(product)));
      if (product.type === "digital") price.append(element("small", "", " / доступ"));
      const quantityRow = element("div", "quantity-row");
      quantityRow.append(element("span", "stock-hint", "Количество"));
      const qty = element("div", "quantity-control");
      const minus = element("button", "", "−");
      minus.type = "button"; minus.setAttribute("aria-label", "Уменьшить количество"); minus.disabled = product.inventoryTracked !== false && product.stock < 1;
      const output = element("output", "", "1");
      const plus = element("button", "", "+");
      plus.type = "button"; plus.setAttribute("aria-label", "Увеличить количество"); plus.disabled = product.inventoryTracked !== false && product.stock < 1;
      let quantity = 1;
      minus.addEventListener("click", () => { quantity = Math.max(1, quantity - 1); output.textContent = String(quantity); });
      plus.addEventListener("click", () => { quantity = Math.min(20, product.inventoryTracked === false ? 20 : product.stock, quantity + 1); output.textContent = String(quantity); });
      qty.append(minus, output, plus);
      quantityRow.append(qty);
      const buy = element("button", "primary-button buy-button");
      buy.type = "button"; buy.dataset.busyKey = "buy:" + product.sku;
      buy.dataset.baseDisabled = String(!initData || (product.inventoryTracked !== false && product.stock < 1));
      buy.disabled = buy.dataset.baseDisabled === "true" || busy.has(buy.dataset.busyKey);
      buy.append(document.createTextNode(product.inventoryTracked !== false && product.stock < 1 ? "Нет в наличии" : "Оформить тестовый заказ"));
      if (product.inventoryTracked === false || product.stock > 0) buy.append(element("span", "", "↗"));
      buy.addEventListener("click", () => createOrder(product, quantity));
      card.append(top, name, description, price, quantityRow, buy);
      catalogRoot.append(card);
    }
  }

  async function loadCatalog() {
    if (!initData) {
      setCatalogState("Откройте этот магазин из Telegram, чтобы подтвердить аккаунт и загрузить каталог.", "error");
      catalogRoot.replaceChildren();
      const info = element("div", "order-panel", "Каталог доступен только после подтверждения Telegram WebApp. Передавать секретные ключи в браузер не требуется.");
      catalogRoot.append(info);
      return;
    }
    $("refresh-catalog").disabled = true;
    setCatalogState("Загружаем каталог…");
    try {
      const payload = await api("/v1/commerce/catalog");
      products = Array.isArray(payload.products) ? payload.products.map((p) => ({ ...p, sku: p.id, priceMinor: p.priceKzt, stock: p.inventoryTracked === false ? 20 : 0, type: "physical", description: p.inventoryTracked === false ? "Цена из серверного каталога. Учёт складских остатков пока не подключён." : "Демонстрационная позиция каталога." })) : [];
      renderProducts();
      setCatalogState(products.length ? "Цены берутся из серверного каталога. Остатки не отслеживаются." : "В каталоге пока нет доступных товаров.", "success");
    } catch (error) {
      setCatalogState(error.message || "Не удалось загрузить каталог.", "error");
      catalogRoot.replaceChildren();
      showToast(error.message || "Ошибка каталога");
    } finally {
      $("refresh-catalog").disabled = false;
    }
  }

  function revealOrder(id) {
    activeOrderId = id;
    orderInput.value = id;
    orderActions.hidden = false;
  }

  function statusLabel(order) {
    const status = {
      AWAITING_PAYMENT: "Ожидает оплаты",
      PAYMENT_REVIEW: "Платёж ожидает проверки",
      PAID: "Тестовая оплата подтверждена",
      READY_FOR_PICKUP: "Оплата подтверждена; ожидает выдачи",
      COURIER_ASSIGNED: "Назначен курьер",
      IN_DELIVERY: "В доставке",
      PHOTO_RECEIVED: "Получено подтверждение доставки",
      DELIVERED: "Доставлен",
      CANCELLED: "Отменён",
      REFUNDED: "Возврат оформлен"
    }[order.status] || "Статус: " + String(order.status);
    const total = order.totalKzt ?? order.totalMinor;
    const price = order.currency === "KZT" ? total : total / 100;
    let formatted;
    try { formatted = new Intl.NumberFormat("ru-RU", { style: "currency", currency: order.currency, maximumFractionDigits: order.currency === "KZT" ? 0 : 2 }).format(price); }
    catch { formatted = String(price) + " " + order.currency; }
    return "Заказ " + order.id + " · " + status + " · " + formatted;
  }

  async function lookupOrder() {
    const id = orderInput.value.trim();
    if (!/^SAM-[A-F0-9]{12}$/i.test(id)) {
      setOrderState("Введите номер заказа формата SAM-…", "error");
      orderActions.hidden = true;
      return;
    }
    setBusy("lookup", true);
    setOrderState("Проверяем заказ…");
    try {
      const payload = await api("/v1/commerce/orders/" + encodeURIComponent(id));
      if (!payload.order) throw Object.assign(new Error("Заказ не найден."), { code: "ORDER_NOT_FOUND" });
      revealOrder(payload.order.id);
      setOrderState(statusLabel(payload.order), "success");
      const pending = ["AWAITING_PAYMENT", "PAYMENT_REVIEW"].includes(payload.order.status);
      const uncertain = Boolean(payload.order.checkoutInProgress);
      $("continue-checkout").hidden = !pending;
      $("cancel-order").hidden = true;
      $("continue-checkout").textContent = payload.order.stripeCheckout ? "Открыть оплату" : uncertain ? "Повторить проверку оплаты" : "Продолжить оплату";
      if (uncertain) setOrderState(statusLabel(payload.order) + ". Запрос оплаты ещё сверяется; не отменяйте этот заказ.", "error");
      $("cancel-order").hidden = true;
    } catch (error) {
      setOrderState(error.message || "Не удалось проверить заказ.", "error");
      orderActions.hidden = true;
    } finally {
      setBusy("lookup", false);
    }
  }

  async function continueCheckout() {
    const id = (activeOrderId || orderInput.value).trim();
    if (!/^ord_[a-f0-9]{24}$/.test(id)) {
      setOrderState("Сначала введите или создайте номер заказа.", "error");
      return;
    }
    setBusy("checkout", true);
    $("continue-checkout").disabled = true;
    setOrderState("Подготавливаем тестовую платёжную сессию…");
    try {
      const payload = await api("/v1/commerce/orders/" + encodeURIComponent(id) + "/checkout", { method: "POST", body: {} });
      const url = payload && payload.session && payload.session.url;
      if (payload.mode !== "stripe_test" || !payload.session || payload.session.livemode !== false ||
          !/^cs_test_[A-Za-z0-9]+$/.test(payload.session.id || "") ||
          !url || new URL(url).origin !== "https://checkout.stripe.com") {
        throw Object.assign(new Error("Сервер не вернул корректную тестовую ссылку оплаты."), { code: "STRIPE_SESSION_INVALID" });
      }
      setOrderState("Заказ " + id + ": тестовая оплата подготовлена. После возврата проверьте статус здесь.", "success");
      if (tg && typeof tg.openLink === "function") tg.openLink(url);
      else window.location.assign(url);
    } catch (error) {
      setOrderState(error.message || "Не удалось создать тестовую оплату.", "error");
      showToast(error.message || "Ошибка тестовой оплаты");
      await loadOrderStateAfterCheckoutFailure(id, error);
    } finally {
      setBusy("checkout", false);
      $("continue-checkout").disabled = false;
    }
  }

  async function loadOrderStateAfterCheckoutFailure(id, checkoutError) {
    try {
      const payload = await api("/v1/commerce/orders/" + encodeURIComponent(id));
      if (payload.order) {
        revealOrder(payload.order.id);
        const pending = payload.order.status === "pending_payment";
        const uncertain = Boolean(payload.order.checkoutInProgress);
        const needsReconciliation = checkoutError?.code === "STRIPE_CHECKOUT_RECONCILIATION_REQUIRED";
        const guidance = needsReconciliation
          ? "Требуется ручная сверка состояния в платёжном провайдере. Не отменяйте заказ."
          : uncertain
            ? "Результат запроса оплаты не подтверждён. Не отменяйте заказ; нажмите «Повторить проверку оплаты»."
            : "Можно повторно открыть Checkout или отменить заказ, если платёжная сессия не создана.";
        setOrderState(statusLabel(payload.order) + ". " + guidance, "error");
        $("continue-checkout").hidden = !pending || needsReconciliation;
        $("cancel-order").hidden = true;
        if (uncertain) $("continue-checkout").textContent = "Повторить проверку оплаты";
      }
    } catch { /* Keep the original checkout error visible. */ }
  }

  async function createOrder(product, quantity) {
    const key = "buy:" + product.sku;
    if (busy.has(key)) return;
    setBusy(key, true);
    setOrderState("Создаём тестовый заказ…");
    try {
      const payload = await api("/v1/commerce/orders", { method: "POST", body: { productId: product.id || product.sku, quantity, fulfillment: "pickup" } });
      const order = payload.order;
      if (!order || !/^ord_[a-f0-9]{24}$/.test(order.id)) throw new Error("Сервер не вернул корректный номер заказа.");
      revealOrder(order.id);
      setOrderState(statusLabel(order) + ". Открываем тестовую оплату…", "success");
      await continueCheckout();
      await loadCatalog();
    } catch (error) {
      setOrderState(error.message || "Не удалось создать заказ.", "error");
      showToast(error.message || "Ошибка заказа");
      await loadCatalog();
    } finally {
      setBusy(key, false);
    }
  }

  async function cancelOrder() {
    const id = (activeOrderId || orderInput.value).trim();
    if (!/^ord_[a-f0-9]{24}$/.test(id)) return;
    setBusy("cancel", true);
    $("cancel-order").disabled = true;
    try {
      const payload = await api("/v1/commerce/orders/" + encodeURIComponent(id) + "/cancel", { method: "POST", body: {} });
      setOrderState(statusLabel(payload.order), "success");
      orderActions.hidden = true;
      showToast("Тестовый заказ отменён.");
      await loadCatalog();
    } catch (error) {
      setOrderState(error.message || "Не удалось отменить заказ.", "error");
      showToast(error.message || "Ошибка отмены");
    } finally {
      setBusy("cancel", false);
      $("cancel-order").disabled = false;
    }
  }

  $("refresh-catalog").addEventListener("click", loadCatalog);
  $("check-order").addEventListener("click", lookupOrder);
  $("continue-checkout").addEventListener("click", continueCheckout);
  // Order cancellation is intentionally unavailable until the domain exposes a safe cancellation transition.
  orderInput.addEventListener("keydown", event => { if (event.key === "Enter") lookupOrder(); });
  if (tg) {
    tg.ready();
    if (typeof tg.expand === "function") tg.expand();
    if (typeof tg.setHeaderColor === "function") tg.setHeaderColor("#080807");
    if (typeof tg.setBackgroundColor === "function") tg.setBackgroundColor("#080807");
  }
  loadCatalog();
})();
