"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  normalizeEvidence,
  normalizeSourceUrl,
  compareSupplierOffers
} = require("./index");
const { createLocalStore } = require("./store");

function sample(overrides = {}) {
  return {
    title: "Supplier offer",
    sourceUrl: "https://supplier.example/catalog#pricing",
    selectedText: "Industrial fasteners, price 12.50 USD",
    capturedAt: "2026-11-24T10:00:00.000Z",
    offer: { supplier: "Example Supply", product: "Fasteners", price: 12.5, currency: "usd", moq: 10, leadTimeDays: 7 },
    ...overrides
  };
}

test("normalizes a supplier evidence record and marks source unverified", () => {
  const record = normalizeEvidence(sample());
  assert.equal(record.sourceUrl, "https://supplier.example/catalog");
  assert.equal(record.offer.currency, "USD");
  assert.equal(record.sourceTrust, "unverified");
  assert.equal(record.status, "captured");
  assert.match(record.evidenceHash, /^[a-f0-9]{64}$/);
});

test("rejects javascript, data and credential-bearing URLs", () => {
  assert.throws(() => normalizeSourceUrl("javascript:alert(1)"), { code: "UNSAFE_SOURCE_URL" });
  assert.throws(() => normalizeSourceUrl("data:text/plain,hello"), { code: "UNSAFE_SOURCE_URL" });
  assert.throws(() => normalizeSourceUrl("https://user:pass@supplier.example/"), { code: "UNSAFE_SOURCE_URL" });
});

test("rejects invalid price, currency, MOQ and invalid timestamps", () => {
  assert.throws(() => normalizeEvidence(sample({ offer: { price: -1, currency: "USD" } })), { code: "INVALID_PRICE" });
  assert.throws(() => normalizeEvidence(sample({ offer: { price: 1, currency: "US" } })), { code: "INVALID_CURRENCY" });
  assert.throws(() => normalizeEvidence(sample({ offer: { moq: 0 } })), { code: "INVALID_MOQ" });
  assert.throws(() => normalizeEvidence(sample({ capturedAt: "not-a-date" })), { code: "INVALID_CAPTURE_TIME" });
});

test("keeps page text inert and bounded", () => {
  const record = normalizeEvidence(sample({ selectedText: "<script>fetch('/steal')</script>" }));
  assert.equal(record.selectedText, "<script>fetch('/steal')</script>");
  assert.ok(record.selectedText.length <= 12000);
});

test("local store persists records, deduplicates and enforces retention", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-webintel-"));
  const filePath = path.join(dir, "evidence.json");
  const store = createLocalStore({ filePath, maxRecords: 2 });
  const first = store.add(sample());
  const duplicate = store.add(sample());
  assert.equal(first.duplicate, false);
  assert.equal(duplicate.duplicate, true);
  assert.equal(store.count(), 1);
  store.add(sample({ sourceUrl: "https://supplier.example/item-2", selectedText: "Second offer" }));
  store.add(sample({ sourceUrl: "https://supplier.example/item-3", selectedText: "Third offer" }));
  assert.equal(store.count(), 2);
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
  assert.equal(createLocalStore({ filePath }).count(), 2);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("refuses to overwrite a corrupt local store", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "samurai-webintel-corrupt-"));
  const filePath = path.join(dir, "evidence.json");
  fs.writeFileSync(filePath, "{broken", "utf8");
  const store = createLocalStore({ filePath });
  assert.throws(() => store.add(sample()), { code: "STORE_CORRUPT" });
  assert.equal(fs.readFileSync(filePath, "utf8"), "{broken");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("supplier comparison sorts prices without claiming verification", () => {
  const high = normalizeEvidence(sample({ sourceUrl: "https://supplier.example/high", offer: { supplier: "B", price: 20, currency: "USD" } }));
  const low = normalizeEvidence(sample({ sourceUrl: "https://supplier.example/low", offer: { supplier: "A", price: 10, currency: "USD" } }));
  const rows = compareSupplierOffers([high, low]);
  assert.deepEqual(rows.map(row => row.price), [10, 20]);
  assert.ok(rows.every(row => row.sourceTrust === "unverified"));
});
