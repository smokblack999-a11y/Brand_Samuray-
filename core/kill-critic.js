"use strict";

const CLAIM_PATTERNS = [
  { type: "price", re: /(?:\$|€|₽|₸)\s?\d[\d\s,.]*|\d[\d\s,.]*\s?(?:доллар|рубл|тенге|евро)/i },
  { type: "availability", re: /(?:есть в наличии|в наличии|свободно|свободен|можно сегодня|доступно сейчас)/i },
  { type: "discount", re: /(?:скидк|дешевле|минус\s*\d+%|\d+%\s*(?:скид|выгод))/i },
  { type: "deadline", re: /(?:будет готов|готово|сделаем за|через\s*\d+\s*(?:мин|час|дн|недел))/i },
  { type: "action_done", re: /(?:забронировал|записал|оформил|отправил|оплатил|заказ оформлен|я уже)/i },
  { type: "guarantee", re: /(?:гарантирую|гарантированно|100\s*%|точно получите)/i }
];

function extractClaims(text) {
  const value = String(text || "").trim();
  return CLAIM_PATTERNS.filter(x => x.re.test(value)).map(x => x.type);
}

function normalizeFacts(facts) {
  if (!facts || typeof facts !== "object") return {};
  return facts;
}

function checkDraft({ draft, facts = {}, approved = false }) {
  const claims = extractClaims(draft);
  const normalized = normalizeFacts(facts);
  const findings = [];

  for (const claim of claims) {
    if (claim === "price" && !normalized.prices) findings.push({ code: "UNSUPPORTED_PRICE", severity: "block", claim });
    if (claim === "availability" && !normalized.availability) findings.push({ code: "UNSUPPORTED_AVAILABILITY", severity: "block", claim });
    if (claim === "discount" && !normalized.discounts) findings.push({ code: "UNSUPPORTED_DISCOUNT", severity: "block", claim });
    if (claim === "deadline" && !normalized.deadlines) findings.push({ code: "UNSUPPORTED_DEADLINE", severity: "block", claim });
    if (claim === "action_done" && !approved) findings.push({ code: "UNVERIFIED_ACTION", severity: "block", claim });
    if (claim === "guarantee" && !normalized.guarantees) findings.push({ code: "UNSUPPORTED_GUARANTEE", severity: "block", claim });
  }

  const decision = findings.length ? "BLOCKED" : "AUTO_ALLOWED";
  return {
    decision,
    claims,
    findings,
    checkedAt: new Date().toISOString(),
    policyVersion: "x10thinc-kill-critic-v1"
  };
}

module.exports = { extractClaims, checkDraft };
