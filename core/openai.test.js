"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { sellerMemoryForPrompt } = require("./openai");

test("seller prompt formatter accepts only bounded approved context fields", () => {
  const result = sellerMemoryForPrompt([
    {
      type: "knowledge",
      record: {
        tenantId: "must-not-be-sent",
        kind: "policy",
        title: "Delivery",
        body: "Delivery only in configured zones",
        status: "approved",
        approvedBy: "private-owner-id"
      }
    },
    {
      type: "practice",
      record: {
        customerContext: "Customer asks about discount",
        sellerFinal: "The listed price is fixed",
        reason: "Discounts are disabled",
        outcome: "edited",
        status: "approved",
        tenantId: "must-not-be-sent"
      }
    }
  ]);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0], {
    type: "approved_business_reference",
    kind: "policy",
    title: "Delivery",
    content: "Delivery only in configured zones"
  });
  assert.equal(result[1].type, "approved_seller_practice");
  assert.equal(result[1].preferred_reply, "The listed price is fixed");
  assert.equal(JSON.stringify(result).includes("must-not-be-sent"), false);
  assert.equal(JSON.stringify(result).includes("private-owner-id"), false);
  const withPending = sellerMemoryForPrompt([
    { type: "knowledge", record: { status: "pending", title: "Unapproved", body: "Never include" } },
    { type: "unknown", record: { status: "approved", title: "Unknown type", body: "Never include" } },
    ...[
      { type: "knowledge", record: { status: "approved", title: "Approved", body: "Use this" } }
    ]
  ]);
  assert.equal(withPending.length, 1);
  assert.equal(withPending[0].title, "Approved");
});

test("seller prompt formatter bounds every retrieved text field", () => {
  const long = "x".repeat(5000);
  const result = sellerMemoryForPrompt([
    { type: "knowledge", record: { kind: "policy", title: long, body: long } },
    { type: "practice", record: { customerContext: long, sellerFinal: long, reason: long } }
  ]);
  assert.equal(result[0].title.length, 160);
  assert.equal(result[0].content.length, 1200);
  assert.equal(result[1].customer_context.length, 400);
  assert.equal(result[1].preferred_reply.length, 900);
  assert.equal(result[1].reason.length, 300);
  assert.equal(sellerMemoryForPrompt(null).length, 0);
});
