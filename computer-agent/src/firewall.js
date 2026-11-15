"use strict";

const dns = require("node:dns").promises;
const net = require("node:net");

const SECRET_PATTERNS = [
  /\b(?:sk|rk)-[A-Za-z0-9_-]{16,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|secret)\s*[:=]\s*["']?[^"'\s,;]{6,}/gi,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi
];

const INJECTION_PATTERNS = [
  /ignore (all |any )?(previous|prior|above) instructions/i,
  /disregard (all |any )?(previous|prior|above) instructions/i,
  /you are now (the )?(system|developer|admin)/i,
  /reveal (the )?(system prompt|hidden instructions|secrets|api keys)/i,
  /send (all |the )?(credentials|tokens|passwords|customer data)/i,
  /override (the )?(system|developer|safety) (prompt|instructions|rules)/i,
  /игнорируй (все )?(предыдущие|вышеуказанные) инструкции/i,
  /покажи (системный промпт|скрытые инструкции|пароли|ключи)/i,
  /отправь (все )?(пароли|токены|ключи|данные клиентов)/i
];

const HIGH_IMPACT_PATTERNS = [
  /\b(bet|wager|stake|place bet|gamble|deposit|withdraw|cash.?out|payment|purchase|pay now)\b/i,
  /\b(delete|remove account|close account|send money|transfer funds|wire transfer)\b/i,
  /ставк|поставить|удвоить|депозит|вывод средств|оплат|перевод денег|удалить аккаунт/i
];

function inspectAction({ action, target = "", element = {}, taskIntent = "" }) {
  const evidence = [action, target, taskIntent, element.text, element.label, element.title, element.href, element.name, element.type]
    .filter(Boolean).join(" ").slice(0, 6000);
  if (action === "click" && HIGH_IMPACT_PATTERNS.some((pattern) => pattern.test(evidence))) {
    return { allowed: false, code: "HIGH_IMPACT_ACTION_REQUIRES_OWNER", reason: "Action appears to involve money, gambling, account deletion, or transfer." };
  }
  if (action === "fill" && /password|passcode|otp|sms|verification|card|cvv|secret|token/i.test([target, element.name, element.label, element.type].join(" "))) {
    return { allowed: false, code: "SENSITIVE_FIELD_OWNER_ONLY", reason: "Sensitive fields must be completed by the account owner." };
  }
  return { allowed: true, code: "ALLOW" };
}

function inspectResult(value) {
  const text = String(value ?? "").slice(0, 12000);
  const injection = INJECTION_PATTERNS.find((pattern) => pattern.test(text));
  if (injection) {
    return { allowed: false, code: "PROMPT_INJECTION_SUSPECTED", reason: "Untrusted page content contains instructions targeting the agent." };
  }
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) redacted = redacted.replace(pattern, "[REDACTED]");
  return { allowed: true, code: "ALLOW", value: redacted, redactions: redacted === text ? 0 : 1 };
}

function isPublicAddress(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const [a,b,c] = address.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
        (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) ||
        (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
        (a === 203 && b === 0 && c === 113) || (a === 192 && b === 0 && c === 0) ||
        (a === 192 && b === 88 && c === 99)) return false;
    return true;
  }
  if (version === 6) {
    const ip = address.toLowerCase();
    if (ip.startsWith("::ffff:")) return isPublicAddress(ip.slice(7));
    return /^2[0-9a-f]{0,3}:/.test(ip) && !/^2001:db8:/i.test(ip);
  }
  return false;
}

async function isAllowedHost(url, allowedHosts) {
  let parsed;
  try { parsed = new URL(url); } catch { return false; }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) return false;
  if (!(allowedHosts || []).map((host) => String(host).toLowerCase()).includes(parsed.hostname.toLowerCase())) return false;
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname)) return isPublicAddress(hostname);
  try {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    return records.length > 0 && records.every((record) => isPublicAddress(record.address));
  } catch {
    return false;
  }
}

module.exports = { inspectAction, inspectResult, isAllowedHost, isPublicAddress };
