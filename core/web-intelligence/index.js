"use strict";

const crypto = require("node:crypto");

const MAX_TEXT_CHARS = 12000;
const MAX_TITLE_CHARS = 300;
const ALLOWED_PROTOCOLS = new Set(["http:", "https:"]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function cleanText(value, maxLength, field) {
  if (typeof value !== "string") fail("INVALID_" + field.toUpperCase(), field + " must be a string");
  const normalized = value.split(String.fromCharCode(0)).join("").trim();
  if (!normalized) fail("EMPTY_" + field.toUpperCase(), field + " must not be empty");
  return normalized.slice(0, maxLength);
}

function normalizeSourceUrl(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    fail("INVALID_SOURCE_URL", "sourceUrl must be an absolute HTTP(S) URL");
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol) || url.username || url.password) {
    fail("UNSAFE_SOURCE_URL", "Only credential-free HTTP(S) source URLs are accepted");
  }
  url.hash = "";
  return url.toString();
}

function normalizeOffer(offer) {
  if (offer == null) return null;
  if (typeof offer !== "object" || Array.isArray(offer)) {
    fail("INVALID_OFFER", "offer must be an object");
  }

  const result = {};
  if (offer.supplier != null) result.supplier = cleanText(String(offer.supplier), 200, "supplier");
  if (offer.product != null) result.product = cleanText(String(offer.product), 200, "product");

  if (offer.price != null) {
    const price = Number(offer.price);
    if (!Number.isFinite(price) || price < 0) fail("INVALID_PRICE", "offer.price must be a non-negative finite number");
    result.price = price;
  }
  if (offer.currency != null) {
    const currency = String(offer.currency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) fail("INVALID_CURRENCY", "offer.currency must be a 3-letter currency code");
    result.currency = currency;
  }
  if (offer.moq != null) {
    const moq = Number(offer.moq);
    if (!Number.isSafeInteger(moq) || moq < 1) fail("INVALID_MOQ", "offer.moq must be a positive integer");
    result.moq = moq;
  }
  if (offer.leadTimeDays != null) {
    const days = Number(offer.leadTimeDays);
    if (!Number.isSafeInteger(days) || days < 0 || days > 3650) {
      fail("INVALID_LEAD_TIME", "offer.leadTimeDays must be an integer from 0 to 3650");
    }
    result.leadTimeDays = days;
  }
  return result;
}

function normalizeEvidence(input, options = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("INVALID_EVIDENCE", "Evidence must be an object");
  }
  const sourceUrl = normalizeSourceUrl(input.sourceUrl || input.url);
  const title = cleanText(input.title, options.maxTitleChars || MAX_TITLE_CHARS, "title");
  const selectedText = cleanText(input.selectedText || input.text, options.maxTextChars || MAX_TEXT_CHARS, "selectedText");
  const capturedAt = input.capturedAt == null ? new Date().toISOString() : String(input.capturedAt);
  if (!Number.isFinite(Date.parse(capturedAt))) fail("INVALID_CAPTURE_TIME", "capturedAt must be a valid date");

  const offer = normalizeOffer(input.offer);
  const evidenceHash = crypto.createHash("sha256")
    .update(sourceUrl + String.fromCharCode(10) + selectedText, "utf8")
    .digest("hex");

  return {
    id: input.id && /^[a-zA-Z0-9_-]{8,80}$/.test(String(input.id)) ? String(input.id) : crypto.randomUUID(),
    title,
    sourceUrl,
    selectedText,
    capturedAt: new Date(capturedAt).toISOString(),
    status: "captured",
    sourceTrust: "unverified",
    evidenceHash,
    offer
  };
}

function compareSupplierOffers(records) {
  if (!Array.isArray(records)) fail("INVALID_RECORDS", "records must be an array");
  return records
    .filter(record => record && record.offer && Number.isFinite(record.offer.price) && record.offer.currency)
    .map(record => ({
      evidenceId: record.id,
      supplier: record.offer.supplier || "Unknown supplier",
      product: record.offer.product || "Unspecified product",
      price: record.offer.price,
      currency: record.offer.currency,
      moq: record.offer.moq ?? null,
      leadTimeDays: record.offer.leadTimeDays ?? null,
      sourceUrl: record.sourceUrl,
      sourceTrust: "unverified"
    }))
    .sort((a, b) => a.currency.localeCompare(b.currency) || a.price - b.price);
}

module.exports = {
  MAX_TEXT_CHARS,
  normalizeSourceUrl,
  normalizeOffer,
  normalizeEvidence,
  compareSupplierOffers
};
