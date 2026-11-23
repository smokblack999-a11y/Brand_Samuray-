"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Stripe = require("stripe");
const { createStripeTestProvider, API_VERSION } = require("../payments/stripe-test-provider");

test("official Stripe SDK constructs the adapter and verifies a generated test webhook", async () => {
  const secret = "whsec_unit_test_secret";
  const provider = createStripeTestProvider({
    StripeClient: Stripe,
    apiKey: "sk_test_unit_test_key",
    webhookSecret: secret
  });
  const signer = new Stripe("sk_test_unit_test_key", { apiVersion: API_VERSION });
  const eventPayload = JSON.stringify({
    id: "evt_test_sdk_integration",
    object: "event",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_sdk_integration", payment_status: "paid" } }
  });
  const signature = signer.webhooks.generateTestHeaderString({ payload: eventPayload, secret });
  const event = await provider.verifyWebhook(Buffer.from(eventPayload), { "stripe-signature": signature });
  const parsed = await provider.parseWebhook(event);
  assert.equal(parsed.eventId, "evt_test_sdk_integration");
  assert.equal(parsed.type, "checkout.session.completed");
  assert.equal(parsed.object.id, "cs_test_sdk_integration");
});
