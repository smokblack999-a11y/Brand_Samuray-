"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const money = require("../money");

test("converts integer KZT major amounts to canonical minor units without floating point", () => {
  assert.equal(money.fractionDigits("KZT"), 2);
  assert.equal(money.toMinorUnits("5700", "KZT"), 570000);
  assert.equal(money.fromMinorUnits(570000, "KZT"), "5700.00");
});

test("supports currency-specific zero-, two- and three-decimal fiat scales", () => {
  assert.equal(money.fractionDigits("JPY"), 0);
  assert.equal(money.toMinorUnits("1200", "JPY"), 1200);
  assert.equal(money.fromMinorUnits(1200, "JPY"), "1200");
  assert.equal(money.fractionDigits("USD"), 2);
  assert.equal(money.toMinorUnits("12.34", "USD"), 1234);
  assert.equal(money.fromMinorUnits(1234, "USD"), "12.34");
  assert.equal(money.fractionDigits("KWD"), 3);
  assert.equal(money.toMinorUnits("1.234", "KWD"), 1234);
  assert.equal(money.fromMinorUnits(1234, "KWD"), "1.234");
});

test("rejects implicit rounding, invalid decimal formats, and unsupported asset codes", () => {
  assert.throws(() => money.toMinorUnits("1.001", "KZT"), { code: "INVALID_AMOUNT_PRECISION" });
  assert.throws(() => money.toMinorUnits("1e3", "KZT"), { code: "INVALID_AMOUNT" });
  assert.throws(() => money.toMinorUnits("-1", "KZT"), { code: "INVALID_AMOUNT" });
  assert.throws(() => money.toMinorUnits("1.00", "USDT"), { code: "UNSUPPORTED_CURRENCY" });
  assert.throws(() => money.toMinorUnits("1.00", "BTC"), { code: "UNSUPPORTED_CURRENCY" });
  assert.throws(() => money.toMinorUnits("9007199254740992", "KZT"), { code: "AMOUNT_OVERFLOW" });
});

test("creates immutable canonical snapshots from unit, quantity and delivery fee", () => {
  const snapshot = money.createMoneySnapshot({
    currency: "KZT", unitAmount: "5000", quantity: 2, deliveryFee: "700"
  });
  assert.deepEqual(snapshot, {
    currency: "KZT",
    fractionDigits: 2,
    unitAmountMinor: 500000,
    itemsAmountMinor: 1000000,
    deliveryFeeMinor: 70000,
    totalMinor: 1070000
  });
  assert.equal(Object.isFrozen(snapshot), true);
  assert.throws(() => money.createMoneySnapshot({
    currency: "KZT", unitAmount: "5000", quantity: 101, deliveryFee: "0"
  }), { code: "INVALID_QUANTITY" });
});
