"use strict";

// Exact fiat amount helpers. Crypto assets (BTC/USDT) intentionally do not use
// ISO-fiat fraction rules; they need separate network-specific settlement adapters.
const CURRENCY_RE = /^[A-Z]{3}$/;
const fractionDigitsCache = new Map();

function currencyCode(value) {
  const code = String(value || "").trim().toUpperCase();
  if (!CURRENCY_RE.test(code)) {
    const error = new TypeError("Currency must be a three-letter ISO code");
    error.code = "INVALID_CURRENCY";
    throw error;
  }
  return code;
}

function fractionDigits(currency) {
  const code = currencyCode(currency);
  if (fractionDigitsCache.has(code)) return fractionDigitsCache.get(code);
  let digits;
  try {
    digits = new Intl.NumberFormat("en", { style: "currency", currency: code })
      .resolvedOptions().maximumFractionDigits;
  } catch {
    const error = new RangeError("Currency is not supported by this runtime");
    error.code = "UNSUPPORTED_CURRENCY";
    throw error;
  }
  if (!Number.isSafeInteger(digits) || digits < 0 || digits > 6) {
    const error = new RangeError("Currency fraction scale is unsupported");
    error.code = "UNSUPPORTED_CURRENCY_SCALE";
    throw error;
  }
  fractionDigitsCache.set(code, digits);
  return digits;
}

function toMinorUnits(amount, currency) {
  const digits = fractionDigits(currency);
  const raw = typeof amount === "number"
    ? (Number.isSafeInteger(amount) ? String(amount) : "")
    : String(amount ?? "").trim();
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(raw);
  if (!match) {
    const error = new TypeError("Amount must be a non-negative decimal string or safe integer number");
    error.code = "INVALID_AMOUNT";
    throw error;
  }
  const fraction = match[2] || "";
  if (fraction.length > digits) {
    const error = new RangeError("Amount has more decimal places than the currency permits");
    error.code = "INVALID_AMOUNT_PRECISION";
    throw error;
  }
  const factor = 10n ** BigInt(digits);
  const whole = BigInt(match[1]);
  const paddedFraction = BigInt((fraction + "0".repeat(digits)).slice(0, digits) || "0");
  const result = whole * factor + paddedFraction;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) {
    const error = new RangeError("Amount exceeds the supported integer range");
    error.code = "AMOUNT_OVERFLOW";
    throw error;
  }
  return Number(result);
}

function fromMinorUnits(value, currency) {
  const digits = fractionDigits(currency);
  if (!Number.isSafeInteger(value) || value < 0) {
    const error = new TypeError("Minor-unit amount must be a non-negative safe integer");
    error.code = "INVALID_MINOR_AMOUNT";
    throw error;
  }
  const factor = 10 ** digits;
  const major = Math.floor(value / factor);
  if (digits === 0) return String(major);
  const fraction = String(value % factor).padStart(digits, "0");
  return String(major) + "." + fraction;
}

function amountMinorForOrder(order) {
  if (order?.money && order.money.currency === String(order.currency || "").toUpperCase() &&
      Number.isSafeInteger(order.money.totalMinor) && order.money.totalMinor > 0) {
    return order.money.totalMinor;
  }
  // Backward-compatible read for older KZT-only orders written before the money snapshot.
  if (String(order?.currency || "").toUpperCase() === "KZT" &&
      Number.isSafeInteger(order?.totalKzt) && order.totalKzt > 0) {
    return toMinorUnits(order.totalKzt, "KZT");
  }
  const error = new Error("Order does not contain a valid canonical money amount");
  error.code = "ORDER_MONEY_INVALID";
  throw error;
}

function createMoneySnapshot({ currency, unitAmount, quantity, deliveryFee = 0 }) {
  const code = currencyCode(currency);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 100) {
    const error = new RangeError("Quantity must be an integer from 1 to 100");
    error.code = "INVALID_QUANTITY";
    throw error;
  }
  const unitAmountMinor = toMinorUnits(unitAmount, code);
  const deliveryFeeMinor = toMinorUnits(deliveryFee, code);
  if (unitAmountMinor <= 0) throw new RangeError("Unit amount must be positive");
  const itemsAmountMinor = unitAmountMinor * quantity;
  const totalMinor = itemsAmountMinor + deliveryFeeMinor;
  if (!Number.isSafeInteger(itemsAmountMinor) || !Number.isSafeInteger(totalMinor)) {
    const error = new RangeError("Order money total exceeds the supported integer range");
    error.code = "AMOUNT_OVERFLOW";
    throw error;
  }
  return Object.freeze({
    currency: code,
    fractionDigits: fractionDigits(code),
    unitAmountMinor,
    itemsAmountMinor,
    deliveryFeeMinor,
    totalMinor
  });
}

module.exports = { currencyCode, fractionDigits, toMinorUnits, fromMinorUnits, amountMinorForOrder, createMoneySnapshot };
