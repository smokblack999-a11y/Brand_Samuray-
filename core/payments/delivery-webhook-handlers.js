"use strict";

const { paymentError } = require("./provider-contract");

function createDeliveryWebhookHandlers({ ledger, onPaid, onFailed = async () => {} } = {}) {
  if (!ledger || typeof ledger.findPaymentBySession !== "function" || typeof ledger.setPaymentStatus !== "function") {
    throw paymentError("PAYMENT_LEDGER_INVALID", "Delivery webhook handlers require a payment ledger");
  }
  if (typeof onPaid !== "function") throw paymentError("PAYMENT_HANDLER_REQUIRED", "An idempotent onPaid handler is required");

  function resolvePayment(session) {
    if (!session || typeof session.id !== "string" || !session.id.startsWith("cs_")) {
      throw paymentError("STRIPE_SESSION_INVALID", "Checkout Session ID is missing or invalid");
    }
    const payment = ledger.findPaymentBySession(session.id);
    if (!payment) throw paymentError("PAYMENT_LEDGER_PAYMENT_NOT_FOUND", "Checkout Session is not linked to a known SAMURAI payment");
    if (payment.provider !== "stripe_test" || session.mode !== "payment") {
      throw paymentError("PAYMENT_PROVIDER_MISMATCH", "Checkout Session provider or mode does not match the payment record");
    }
    const metadata = session.metadata || {};
    if (metadata.samurai_flow !== "delivery" ||
        metadata.samurai_order_id !== payment.orderId ||
        metadata.samurai_customer_id !== payment.customerId ||
        session.client_reference_id !== payment.orderId) {
      throw paymentError("PAYMENT_ORDER_MISMATCH", "Checkout Session metadata does not match the SAMURAI order");
    }
    if (session.amount_total !== payment.amountMinor ||
        String(session.currency || "").toLowerCase() !== payment.currency) {
      throw paymentError("PAYMENT_AMOUNT_MISMATCH", "Checkout Session amount or currency does not match the server-side payment record");
    }
    return payment;
  }

  async function markPaid(session) {
    const payment = resolvePayment(session);
    if (session.payment_status !== "paid") {
      throw paymentError("PAYMENT_NOT_PAID", "Stripe has not confirmed that the Checkout Session is paid");
    }
    const updated = ledger.setPaymentStatus(payment.paymentId, "paid",
      typeof session.payment_intent === "string" ? session.payment_intent : undefined);
    await onPaid(updated, session);
  }

  return Object.freeze({
    "checkout.session.completed": async session => {
      const payment = resolvePayment(session);
      if (session.payment_status === "paid") return markPaid(session);
      if (session.payment_status === "unpaid") {
        ledger.setPaymentStatus(payment.paymentId, "processing");
        return;
      }
      throw paymentError("PAYMENT_STATUS_UNSUPPORTED", "Checkout Session payment status is not supported");
    },
    "checkout.session.async_payment_succeeded": markPaid,
    "checkout.session.async_payment_failed": async session => {
      const payment = resolvePayment(session);
      const updated = ledger.setPaymentStatus(payment.paymentId, "failed");
      await onFailed(updated, session);
    },
    "checkout.session.expired": async session => {
      const payment = resolvePayment(session);
      const updated = ledger.setPaymentStatus(payment.paymentId, "cancelled");
      await onFailed(updated, session);
    }
  });
}

module.exports = { createDeliveryWebhookHandlers };
