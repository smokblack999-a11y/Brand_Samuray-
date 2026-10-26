"use strict";

// Thin Telegram Mini App adapter. The Commerce domain + SQLite remain the only
// order/payment source of truth. Never accept customerId or prices from the client.
function createMiniAppCommerceHandlers({ commerce, enabled = () =>
  process.env.COMMERCE_MINIAPP_ENABLED === "true" &&
  process.env.COMMERCE_MODE === "test"
} = {}) {
  if (!commerce) throw new TypeError("Commerce domain is required");

  function error(res, req, status, code, message) {
    return res.status(status).json({
      ok: false,
      error: { code, message, requestId: req.requestId }
    });
  }

  function featureEnabled(req, res, next) {
    if (!enabled()) return error(res, req, 404, "COMMERCE_MINIAPP_DISABLED", "Mini App Commerce is disabled");
    return next();
  }

  function ownerId(req) {
    const id = req.telegramWebApp?.user?.id;
    return id == null ? "" : String(id);
  }

  function publicOrder(order) {
    // Never expose payment receipts, internal audit data, courier tokens, or raw
    // provider metadata to a customer-facing Mini App.
    return {
      id: order.id,
      productId: order.productId,
      productName: order.productName,
      quantity: order.quantity,
      fulfillment: order.fulfillment,
      address: order.address,
      deliveryZone: order.deliveryZone,
      currency: order.currency,
      totalKzt: order.totalKzt,
      paymentStatus: order.paymentStatus,
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      checkoutInProgress: Boolean(order.checkoutAttemptKey && !order.checkoutSessionId)
    };
  }

  function catalog(req, res) {
    try {
      return res.json({
        ok: true,
        currency: "KZT",
        products: commerce.getCatalog().map((product) => ({
          id: product.id,
          name: product.name,
          priceKzt: product.priceKzt,
          currency: "KZT",
          inventoryTracked: false
        })),
        deliveryZones: commerce.getDeliveryZones()
      });
    } catch (err) {
      return error(res, req, 503, err.code || "COMMERCE_NOT_READY", "Commerce catalog is unavailable");
    }
  }

  function createOrder(req, res) {
    const customerId = ownerId(req);
    if (!customerId) return error(res, req, 401, "INVALID_WEBAPP_IDENTITY", "Verified Telegram identity is required");

    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const rawKey = String(req.get("Idempotency-Key") || "").trim();
    if (rawKey && !/^[A-Za-z0-9._:-]{8,128}$/.test(rawKey)) {
      return error(res, req, 400, "INVALID_IDEMPOTENCY_KEY", "Idempotency-Key must be 8–128 safe characters");
    }
    const idempotencyKey = rawKey ? "miniapp:" + customerId + ":" + rawKey : undefined;

    try {
      const order = commerce.createOrder({
        customerId,
        productId: body.productId,
        quantity: body.quantity,
        fulfillment: body.fulfillment,
        address: body.address,
        deliveryZone: body.deliveryZone,
        idempotencyKey
      });
      return res.status(201).json({ ok: true, order: publicOrder(order), requestId: req.requestId });
    } catch (err) {
      const clientErrors = new Set([
        "CUSTOMER_REQUIRED", "INVALID_QUANTITY", "INVALID_FULFILLMENT",
        "PRODUCT_NOT_FOUND", "ADDRESS_REQUIRED", "DELIVERY_ZONE_NOT_FOUND",
        "IDEMPOTENCY_CONFLICT", "UNSUPPORTED_COMMERCE_CURRENCY"
      ]);
      const status = clientErrors.has(err.code) ? 400 : 503;
      return error(res, req, status, err.code || "ORDER_CREATE_FAILED",
        status === 400 ? err.message : "Could not create order");
    }
  }

  function getOrder(req, res) {
    const customerId = ownerId(req);
    if (!customerId) return error(res, req, 401, "INVALID_WEBAPP_IDENTITY", "Verified Telegram identity is required");
    const order = commerce.getOrder(req.params.id);
    if (!order || order.customerId !== customerId) {
      // Use the same response for missing and foreign orders to avoid ID probing.
      return error(res, req, 404, "ORDER_NOT_FOUND", "Order not found");
    }
    return res.json({ ok: true, order: publicOrder(order), requestId: req.requestId });
  }

  async function checkout(req, res) {
    const customerId = ownerId(req);
    if (!customerId) return error(res, req, 401, "INVALID_WEBAPP_IDENTITY", "Verified Telegram identity is required");
    const order = commerce.getOrder(req.params.id);
    if (!order || order.customerId !== customerId) {
      return error(res, req, 404, "ORDER_NOT_FOUND", "Order not found");
    }
    try {
      const result = await commerce.createCheckoutSession(order.id);
      if (result.alreadyPaid) {
        return res.status(409).json({ ok: false, error: { code: "ORDER_ALREADY_PAID", message: "Order is already paid", requestId: req.requestId } });
      }
      if (!result.url || !/^cs_test_[A-Za-z0-9]+$/.test(String(result.sessionId || ""))) {
        return error(res, req, 409, "STRIPE_SESSION_INVALID", "No new test Checkout URL is available");
      }
      return res.json({
        ok: true,
        mode: "stripe_test",
        session: { id: result.sessionId, url: result.url, livemode: false },
        order: publicOrder(result.order),
        requestId: req.requestId
      });
    } catch (err) {
      const status = new Set(["ORDER_NOT_FOUND"]).has(err.code) ? 404 :
        new Set(["ORDER_CLOSED", "ALREADY_PAID", "PAYMENT_STATUS_PENDING", "PAYMENT_STATUS_UNAVAILABLE",
          "PAYMENT_SESSION_MISMATCH", "PAYMENT_MISMATCH", "PAYMENT_AMOUNT_LIMIT",
          "CHECKOUT_URLS_REQUIRED", "TEST_STRIPE_KEY_REQUIRED", "UNSUPPORTED_PAYMENT_CURRENCY"]).has(err.code) ? 409 : 503;
      return error(res, req, status, err.code || "STRIPE_CHECKOUT_FAILED",
        status === 503 ? "Test Checkout is unavailable" : err.message);
    }
  }

  return { featureEnabled, catalog, createOrder, getOrder, checkout };
}

function registerCommerceMiniAppRoutes(app, { commerce, requireWebAppAuth } = {}) {
  const handlers = createMiniAppCommerceHandlers({ commerce });
  // Keep auth ahead of all Mini App Commerce endpoints; feature gating is still
  // enforced for every request and defaults to off.
  app.get("/v1/commerce/catalog", requireWebAppAuth, handlers.featureEnabled, handlers.catalog);
  app.post("/v1/commerce/orders", requireWebAppAuth, handlers.featureEnabled, handlers.createOrder);
  app.get("/v1/commerce/orders/:id", requireWebAppAuth, handlers.featureEnabled, handlers.getOrder);
  app.post("/v1/commerce/orders/:id/checkout", requireWebAppAuth, handlers.featureEnabled, handlers.checkout);
  return handlers;
}

module.exports = { createMiniAppCommerceHandlers, registerCommerceMiniAppRoutes };
