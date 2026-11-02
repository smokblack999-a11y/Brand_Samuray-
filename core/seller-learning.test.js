"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createSellerLearningStore } = require("./seller-learning");

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-seller-learning-"));
  const store = createSellerLearningStore({ dbPath: path.join(dir, "learning.sqlite") });
  return { dir, store, cleanup() { store.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test("knowledge is pending until seller approval and retrieval is tenant-scoped", () => {
  const f = fixture();
  try {
    const item = f.store.addKnowledge({
      tenantId: "seller-a", actorId: "owner-a", kind: "policy",
      title: "Delivery zone", body: "Deliver to Almaty within two business days",
      source: "owner"
    });
    assert.equal(item.status, "pending");
    assert.equal(f.store.retrieve({ tenantId: "seller-a", query: "Almaty delivery" }).length, 0);
    f.store.reviewKnowledge({ tenantId: "seller-a", actorId: "owner-a", id: item.id, decision: "approved" });
    assert.equal(f.store.retrieve({ tenantId: "seller-a", query: "Almaty delivery" }).length, 1);
    assert.equal(f.store.retrieve({ tenantId: "seller-b", query: "Almaty delivery" }).length, 0);
  } finally { f.cleanup(); }
});

test("seller correction becomes usable only after explicit approval", () => {
  const f = fixture();
  try {
    const example = f.store.addPracticeExample({
      tenantId: "seller-a", actorId: "owner-a",
      customerContext: "Customer asks for a discount on a phone",
      aiDraft: "I can give you 20 percent off",
      sellerFinal: "The listed price is fixed; I can offer free pickup",
      outcome: "edited", reason: "Discount is not allowed"
    });
    assert.equal(f.store.retrieve({ tenantId: "seller-a", query: "discount phone" }).length, 0);
    f.store.reviewExample({ tenantId: "seller-a", actorId: "owner-a", id: example.id, decision: "approved" });
    const result = f.store.retrieve({ tenantId: "seller-a", query: "discount phone" });
    assert.equal(result.length, 1);
    assert.equal(result[0].record.sellerFinal, "The listed price is fixed; I can offer free pickup");
  } finally { f.cleanup(); }
});

test("editing approved knowledge resets it to pending and increments version", () => {
  const f = fixture();
  try {
    const item = f.store.addKnowledge({
      tenantId: "seller-a", actorId: "owner-a", kind: "product_fact",
      title: "Stock", body: "One unit", source: "inventory"
    });
    f.store.reviewKnowledge({ tenantId: "seller-a", actorId: "owner-a", id: item.id, decision: "approved" });
    const updated = f.store.updateKnowledge({
      tenantId: "seller-a", actorId: "owner-a", id: item.id, body: "Two units"
    });
    assert.equal(updated.version, 2);
    assert.equal(updated.status, "pending");
    assert.equal(f.store.retrieve({ tenantId: "seller-a", query: "stock units" }).length, 0);
    assert.equal(f.store.listAudit({ tenantId: "seller-a" }).length, 3);
  } finally { f.cleanup(); }
});

test("tenant ID is mandatory and cannot retrieve another seller's records", () => {
  const f = fixture();
  try {
    assert.throws(() => f.store.retrieve({ query: "anything" }), { code: "INVALID_TENANTID" });
  } finally { f.cleanup(); }
});
