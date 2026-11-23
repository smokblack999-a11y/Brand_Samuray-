"use strict";

const crypto = require("node:crypto");
const { paymentError } = require("./provider-contract");

function createPaymentRouter({
  express,
  runtime,
  ledger,
  webhookProcessor,
  requireApiKey,
  resolveDeliveryOrder,
  resolveSaasPlan,
  successUrl,
  cancelUrl,
  checkoutRateLimit
} = {}) {
  if (!express || typeof express.Router !== "function") throw paymentError("PAYMENT_HTTP_EXPRESS_REQUIRED", "Express is required");
  if (!runtime || !runtime.registry || typeof runtime.health !== "function") throw paymentError("PAYMENT_HTTP_RUNTIME_REQUIRED", "Payment runtime is required");
  if (!ledger || typeof ledger.createPayment !== "function" || typeof ledger.findPaymentBySession !== "function") {
    throw paymentError("PAYMENT_HTTP_LEDGER_REQUIRED", "Payment ledger is required");
  }
  if (typeof requireApiKey !== "function") throw paymentError("PAYMENT_HTTP_AUTH_REQUIRED", "An existing Core API authentication middleware is required");
  if (typeof resolveDeliveryOrder !== "function") throw paymentError("PAYMENT_ORDER_RESOLVER_REQUIRED", "A server-side Delivery order resolver is required");
  if (!webhookProcessor || typeof webhookProcessor.process !== "function") throw paymentError("PAYMENT_WEBHOOK_PROCESSOR_REQUIRED", "A verified webhook processor is required");

  const router = express.Router();

  router.get("/status", requireApiKey, (req, res) => {
    return res.json({ ok: true, payments: runtime.health(), requestId: req.requestId });
  });

  const checkoutMiddleware = [requireApiKey];
  if (typeof checkoutRateLimit === "function") checkoutMiddleware.push(checkoutRateLimit);

  router.post("/delivery/checkout", ...checkoutMiddleware, async (req, res) => {
    try {
      const orderId = typeof req.body?.orderId === "string" ? req.body.orderId.trim() : "";
      if (!orderId || orderId.length > 200) {
        return res.status(400).json({ ok: false, error: { code: "PAYMENT_ORDER_ID_REQUIRED", message: "A valid orderId is required", requestId: req.requestId } });
      }
      const status = runtime.health();
      if (!status.enabled || status.mode !== "test" || status.provider !== "stripe_test") {
        return res.status(503).json({ ok: false, error: { code: "PAYMENTS_DISABLED", message: "Test payments are not enabled", requestId: req.requestId } });
      }

      // The resolver must load the authoritative order and enforce caller ownership.
      const order = await resolveDeliveryOrder(orderId, req);
      if (!order || order.payable !== true || String(order.orderId || order.id || "") !== orderId ||
          typeof order.customerId !== "string" || typeof order.productName !== "string" ||
          !Number.isSafeInteger(order.amountMinor) || order.amountMinor < 1 ||
          typeof order.currency !== "string") {
        throw paymentError("PAYMENT_ORDER_NOT_PAYABLE", "The server did not resolve a payable order");
      }

      const provider = runtime.registry.getProvider();
      const revision = String(order.version || order.updatedAt || "1");
      const digest = crypto.createHash("sha256").update(orderId + ":" + revision).digest("hex");
      const session = await provider.createOneTimeCheckout({
        orderId,
        customerId: order.customerId,
        productName: order.productName,
        amountMinor: order.amountMinor,
        currency: order.currency,
        successUrl,
        cancelUrl,
        idempotencyKey: "delivery:" + digest
      });

      let payment = ledger.findPaymentBySession(session.sessionId);
      if (payment) {
        if (payment.orderId !== orderId || payment.customerId !== order.customerId ||
            payment.amountMinor !== order.amountMinor || payment.currency !== order.currency.toLowerCase()) {
          throw paymentError("PAYMENT_LEDGER_SESSION_MISMATCH", "Existing provider session does not match the current order");
        }
      } else {
        payment = ledger.createPayment({
          paymentId: "pay_" + digest.slice(0, 32),
          orderId,
          customerId: order.customerId,
          provider: "stripe_test",
          providerSessionId: session.sessionId,
          amountMinor: order.amountMinor,
          currency: order.currency
        });
      }

      return res.status(201).json({
        ok: true,
        payment: { paymentId: payment.paymentId, status: payment.status, checkoutUrl: session.checkoutUrl },
        requestId: req.requestId
      });
    } catch (error) {
      const code = error.code || "PAYMENT_CHECKOUT_FAILED";
      const status = code === "PAYMENT_ORDER_NOT_PAYABLE" ? 409 :
        code === "PAYMENTS_DISABLED" ? 503 : 500;
      console.error(JSON.stringify({ event: "payment_checkout_failed", requestId: req.requestId, code }));
      return res.status(status).json({ ok: false, error: { code, message: status === 500 ? "Checkout could not be created" : error.message, requestId: req.requestId } });
    }
  });

  if (typeof resolveSaasPlan === "function") {
    router.post("/saas/checkout", ...checkoutMiddleware, async (req, res) => {
      try {
        const planId = typeof req.body?.planId === "string" ? req.body.planId.trim() : "";
        if (!planId || planId.length > 120) {
          return res.status(400).json({ ok: false, error: { code: "PAYMENT_PLAN_ID_REQUIRED", message: "A valid planId is required", requestId: req.requestId } });
        }
        const status = runtime.health();
        if (!status.enabled || status.mode !== "test" || status.provider !== "stripe_test") {
          return res.status(503).json({ ok: false, error: { code: "PAYMENTS_DISABLED", message: "Test payments are not enabled", requestId: req.requestId } });
        }
        // The resolver must map the requested plan to a server-owned Stripe Price ID and enforce customer ownership.
        const plan = await resolveSaasPlan(planId, req);
        if (!plan || plan.planId !== planId || typeof plan.customerId !== "string" ||
            typeof plan.priceId !== "string" || !/^price_[A-Za-z0-9]+$/.test(plan.priceId)) {
          throw paymentError("PAYMENT_PLAN_NOT_AVAILABLE", "The server did not resolve an available subscription plan");
        }
        const provider = runtime.registry.getProvider();
        const revision = String(plan.version || plan.updatedAt || "1");
        const digest = crypto.createHash("sha256").update(plan.customerId + ":" + planId + ":" + revision).digest("hex");
        const session = await provider.createSubscriptionCheckout({
          customerId: plan.customerId,
          planId,
          priceId: plan.priceId,
          successUrl,
          cancelUrl,
          idempotencyKey: "saas:" + digest
        });
        return res.status(201).json({
          ok: true,
          subscriptionCheckout: { sessionId: session.sessionId, checkoutUrl: session.checkoutUrl, mode: session.mode },
          requestId: req.requestId
        });
      } catch (error) {
        const code = error.code || "PAYMENT_SUBSCRIPTION_CHECKOUT_FAILED";
        const status = code === "PAYMENT_PLAN_NOT_AVAILABLE" ? 409 : 500;
        console.error(JSON.stringify({ event: "payment_subscription_checkout_failed", requestId: req.requestId, code }));
        return res.status(status).json({ ok: false, error: { code, message: status === 500 ? "Subscription checkout could not be created" : error.message, requestId: req.requestId } });
      }
    });
  }

  router.post("/stripe/webhook", async (req, res) => {
    try {
      if (!Buffer.isBuffer(req.rawBody)) {
        return res.status(400).json({ ok: false, error: { code: "STRIPE_WEBHOOK_RAW_BODY_REQUIRED", message: "Raw webhook body is unavailable", requestId: req.requestId } });
      }
      const result = await webhookProcessor.process(req.rawBody, req.headers);
      return res.json({ ok: true, ...result, requestId: req.requestId });
    } catch (error) {
      const code = error.code || "PAYMENT_WEBHOOK_FAILED";
      const status = code.includes("SIGNATURE") || code === "STRIPE_WEBHOOK_RAW_BODY_REQUIRED" ? 400 : 500;
      console.error(JSON.stringify({ event: "payment_webhook_failed", requestId: req.requestId, code }));
      return res.status(status).json({ ok: false, error: { code, message: status === 400 ? "Webhook verification failed" : "Webhook processing failed", requestId: req.requestId } });
    }
  });

  return router;
}

module.exports = { createPaymentRouter };
