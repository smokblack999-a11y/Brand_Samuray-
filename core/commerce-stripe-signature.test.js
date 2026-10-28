"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { verifyStripeSignature, processStripeEvent } = require("./commerce-stripe");

function signedHeader(rawBody, secret, timestamp = Math.floor(Date.now() / 1000)) {
  const digest = crypto.createHmac("sha256", secret)
    .update(String(timestamp) + ".")
    .update(rawBody)
    .digest("hex");
  return "t=" + timestamp + ",v1=" + digest;
}

test("Stripe webhook signature accepts the exact raw body", () => {
  const secret = "whsec_test_fixture_only";
  const raw = Buffer.from(JSON.stringify({
    id: "evt_signature_fixture",
    type: "checkout.session.completed",
    livemode: false,
    data: { object: { id: "cs_test_fixture" } }
  }));
  const header = signedHeader(raw, secret);
  assert.equal(verifyStripeSignature(raw, header, secret), true);
});

test("Stripe webhook signature rejects a changed body", () => {
  const secret = "whsec_test_fixture_only";
  const raw = Buffer.from('{"id":"evt_original"}');
  const header = signedHeader(raw, secret);
  assert.equal(verifyStripeSignature(Buffer.from('{"id":"evt_changed"}'), header, secret), false);
});

test("Stripe webhook signature rejects stale timestamps and missing inputs", () => {
  const secret = "whsec_test_fixture_only";
  const raw = Buffer.from('{"id":"evt_stale"}');
  const stale = signedHeader(raw, secret, Math.floor(Date.now() / 1000) - 301);
  assert.equal(verifyStripeSignature(raw, stale, secret), false);
  assert.equal(verifyStripeSignature(raw, "", secret), false);
  assert.equal(verifyStripeSignature("not-a-buffer", signedHeader(raw, secret), secret), false);
});

test("Stripe payment processor rejects live-mode events even if structurally valid", () => {
  assert.throws(
    () => processStripeEvent({
      id: "evt_live_fixture",
      type: "checkout.session.completed",
      livemode: true,
      data: { object: {} }
    }),
    { code: "LIVE_PAYMENT_MODE_DISABLED" }
  );
});
