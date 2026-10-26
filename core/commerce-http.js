"use strict";

function responseError(res, req, status, code, message) {
  return res.status(status).json({
    ok: false,
    error: { code, message, requestId: req.requestId || null }
  });
}

function customerIdFromVerifiedTelegram(req) {
  const rawId = req?.telegramWebApp?.user?.id;
  const id = typeof rawId === "number" && Number.isSafeInteger(rawId)
    ? String(rawId)
    : typeof rawId === "string" ? rawId : "";
  if (!/^[1-9][0-9]{0,19}$/.test(id)) return null;
  return `tg:${id}`;
}

function mapCommerceError(error) {
  const code = String(error?.code || "COMMERCE_INTERNAL_ERROR");
  const clientErrors = new Set([
    "INVALID_SKU", "INVALID_QUANTITY", "INVALID_CUSTOMER_ID", "INVALID_PRODUCT",
    "INVALID_PRODUCT_NAME", "INVALID_PRICE", "INVALID_CURRENCY", "INVALID_PRODUCT_TYPE",
    "INVALID_STOCK", "DIGITAL_DELIVERY_REQUIRED", "TOTAL_OVERFLOW", "STRIPE_ORDER_INVALID", "STRIPE_AMOUNT_INVALID"
  ]);
  const conflicts = new Set(["INSUFFICIENT_STOCK", "ORDER_CANCELLED", "ORDER_ALREADY_FULFILLED", "STRIPE_CHECKOUT_ACTIVE"]);
  const notFound = new Set(["PRODUCT_NOT_FOUND", "ORDER_NOT_FOUND"]);
  const unavailable = new Set([
    "COMMERCE_NOT_READY", "REAL_PAYMENTS_NOT_IMPLEMENTED", "STATE_READ_FAILED",
    "STATE_WRITE_FAILED", "INVALID_STATE_SHAPE", "CATALOG_REQUIRED", "CATALOG_READ_FAILED",
    "INVALID_CATALOG", "DUPLICATE_CATALOG_SKU", "DUPLICATE_STATE_SKU",
    "DUPLICATE_STATE_ORDER", "ORPHANED_STATE_ORDER", "STRIPE_UPSTREAM_UNAVAILABLE", "STRIPE_TEST_NOT_CONFIGURED", "STRIPE_SESSION_INVALID"
  ]);
  if (clientErrors.has(code)) return { status: 400, code, message: "Invalid commerce request" };
  if (conflicts.has(code)) return { status: 409, code, message: "Order state or stock conflict" };
  if (notFound.has(code)) return { status: 404, code, message: "Product or order not found" };
  if (unavailable.has(code)) return { status: 503, code, message: "Commerce is not ready" };
  return { status: 500, code: "COMMERCE_INTERNAL_ERROR", message: "Commerce request failed" };
}

function registerCommerceRoutes(app, options = {}) {
  if (!app || typeof app.get !== "function" || typeof app.post !== "function") {
    throw new TypeError("Express-compatible app is required");
  }
  const { storeProvider, requireWebAppAuth, env = process.env, stripeClient } = options;
  const rateLimit = typeof options.rateLimit === "function"
    ? options.rateLimit
    : (_req, _res, next) => next();
  if (typeof requireWebAppAuth !== "function") throw new TypeError("requireWebAppAuth middleware is required");
  if (typeof storeProvider !== "function" && !storeProvider) throw new TypeError("storeProvider is required");

  const featureGate = (req, res, next) => {
    if (String(env.NODE_ENV || "").trim().toLowerCase() === "production" || String(env.COMMERCE_MODE || "").trim().toLowerCase() !== "test") {
      return responseError(res, req, 404, "COMMERCE_TEST_ONLY", "Test-only commerce is unavailable in production");
    }
    if (String(env.COMMERCE_ENABLED || "").trim().toLowerCase() !== "true") {
      return responseError(res, req, 404, "COMMERCE_DISABLED", "Commerce is not enabled");
    }
    return next();
  };

  const testPaymentGate = (req, res, next) => {
    if (String(env.NODE_ENV || "").trim().toLowerCase() === "production" ||
        String(env.COMMERCE_MODE || "").trim().toLowerCase() !== "test" ||
        String(env.COMMERCE_TEST_PAYMENTS_ENABLED || "").trim().toLowerCase() !== "true") {
      return responseError(res, req, 404, "TEST_PAYMENTS_DISABLED", "Test payments are disabled");
    }
    return next();
  };

  async function getStore(req, res) {
    try {
      const store = typeof storeProvider === "function" ? await storeProvider() : await storeProvider;
      if (!store) {
        responseError(res, req, 503, "COMMERCE_NOT_READY", "Commerce is not ready");
        return null;
      }
      return store;
    } catch (_error) {
      responseError(res, req, 503, "COMMERCE_NOT_READY", "Commerce is not ready");
      return null;
    }
  }

  function requireVerifiedCustomer(req, res) {
    const customerId = customerIdFromVerifiedTelegram(req);
    if (!customerId) {
      responseError(res, req, 401, "INVALID_WEBAPP_IDENTITY", "Verified Telegram identity is required");
      return null;
    }
    return customerId;
  }

  function handleError(req, res, error) {
    const mapped = mapCommerceError(error);
    return responseError(res, req, mapped.status, mapped.code, mapped.message);
  }

  app.get("/v1/commerce/catalog", featureGate, requireWebAppAuth, rateLimit, async (req, res) => {
    const customerId = requireVerifiedCustomer(req, res);
    if (!customerId) return;
    const store = await getStore(req, res);
    if (!store) return;
    try {
      return res.json({ ok: true, mode: "test", products: store.listProducts(), requestId: req.requestId || null });
    } catch (error) { return handleError(req, res, error); }
  });

  app.post("/v1/commerce/orders", featureGate, requireWebAppAuth, rateLimit, async (req, res) => {
    const customerId = requireVerifiedCustomer(req, res);
    if (!customerId) return;
    const store = await getStore(req, res);
    if (!store) return;
    try {
      const order = await store.createOrder({
        sku: req.body?.sku,
        quantity: req.body?.quantity === undefined ? 1 : req.body.quantity,
        customerId
      });
      return res.status(201).json({ ok: true, mode: "test", order, requestId: req.requestId || null });
    } catch (error) { return handleError(req, res, error); }
  });

  app.post("/v1/commerce/orders/:id/checkout", featureGate, requireWebAppAuth, rateLimit, async (req, res) => {
    const customerId = requireVerifiedCustomer(req, res);
    if (!customerId) return;
    if (String(env.STRIPE_TEST_MODE || "").trim().toLowerCase() !== "true" ||
        String(env.NODE_ENV || "").trim().toLowerCase() === "production") {
      return responseError(res, req, 404, "STRIPE_TEST_DISABLED", "Stripe test checkout is disabled");
    }
    if (!stripeClient || typeof stripeClient.isConfigured !== "function" || !stripeClient.isConfigured()) {
      return responseError(res, req, 503, "STRIPE_TEST_NOT_CONFIGURED", "Stripe test checkout is not configured");
    }
    const store = await getStore(req, res);
    if (!store) return;
    const order = store.getOrder(req.params?.id, customerId);
    if (!order) return responseError(res, req, 404, "ORDER_NOT_FOUND", "Product or order not found");
    if (order.status !== "pending_payment") return responseError(res, req, 409, "ORDER_NOT_PENDING", "Order is not awaiting payment");
    if (order.stripeCheckout) {
      return res.json({ ok: true, mode: "stripe_test", session: { id: order.stripeCheckout.sessionId, url: order.stripeCheckout.url, livemode: false, expiresAt: order.stripeCheckout.expiresAt || null }, requestId: req.requestId || null });
    }
    try {
      const session = await stripeClient.createCheckoutSession(order);
      const savedOrder = await store.recordStripeCheckout(order.id, customerId, session);
      return res.status(201).json({ ok: true, mode: "stripe_test", session: { id: session.id, url: session.url, livemode: false, expiresAt: savedOrder.stripeCheckout?.expiresAt || null }, requestId: req.requestId || null });
    } catch (error) {
      if (error.code === "STRIPE_SESSION_ALREADY_ATTACHED") return responseError(res, req, 409, error.code, "A Checkout Session is already attached to this order");
      if (["STRIPE_TEST_NOT_CONFIGURED", "STRIPE_UPSTREAM_UNAVAILABLE"].includes(error.code)) return responseError(res, req, 503, error.code, "Stripe test checkout is temporarily unavailable");
      if (error.code === "ORDER_NOT_FOUND") return responseError(res, req, 404, "ORDER_NOT_FOUND", "Product or order not found");
      if (["ORDER_CANCELLED", "ORDER_ALREADY_FULFILLED"].includes(error.code)) return responseError(res, req, 409, error.code, "Order state conflict");
      return responseError(res, req, 502, error.code || "STRIPE_CHECKOUT_FAILED", "Stripe test checkout could not be created");
    }
  });

  app.get("/v1/commerce/orders/:id", featureGate, requireWebAppAuth, rateLimit, async (req, res) => {
    const customerId = requireVerifiedCustomer(req, res);
    if (!customerId) return;
    const store = await getStore(req, res);
    if (!store) return;
    try {
      const order = store.getOrder(req.params?.id, customerId);
      if (!order) return responseError(res, req, 404, "ORDER_NOT_FOUND", "Product or order not found");
      return res.json({ ok: true, mode: "test", order, requestId: req.requestId || null });
    } catch (error) { return handleError(req, res, error); }
  });

  app.post("/v1/commerce/orders/:id/cancel", featureGate, requireWebAppAuth, rateLimit, async (req, res) => {
    const customerId = requireVerifiedCustomer(req, res);
    if (!customerId) return;
    const store = await getStore(req, res);
    if (!store) return;
    try {
      const order = await store.cancelOrder(req.params?.id, customerId);
      return res.json({ ok: true, mode: "test", order, requestId: req.requestId || null });
    } catch (error) { return handleError(req, res, error); }
  });

  // This endpoint simulates a payment and demo fulfillment. It MUST NOT be exposed in production.
  app.post("/v1/commerce/orders/:id/simulate-payment", featureGate, testPaymentGate, requireWebAppAuth, rateLimit, async (req, res) => {
    const customerId = requireVerifiedCustomer(req, res);
    if (!customerId) return;
    const store = await getStore(req, res);
    if (!store) return;
    try {
      const order = await store.simulatePayment(req.params?.id, customerId);
      return res.json({
        ok: true,
        testOnly: true,
        warning: "SIMULATED PAYMENT ONLY — no money was charged and no physical shipment was created.",
        order,
        requestId: req.requestId || null
      });
    } catch (error) { return handleError(req, res, error); }
  });

  return { customerIdFromVerifiedTelegram, mapCommerceError };
}

module.exports = { registerCommerceRoutes, customerIdFromVerifiedTelegram, mapCommerceError };