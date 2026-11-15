"use strict";

const BLOCKED_ACTION_PATTERNS = [
  /\b(bet|wager|stake|place bet|gamble|deposit|withdraw|cash.?out|payment|purchase|pay now|delete|remove account|close account|send money|transfer funds)\b/i,
  /ставк|поставить|удвоить|депозит|вывод средств|оплат|перевод денег|удалить аккаунт/i
];

function validateTask(task) {
  if (!task || typeof task !== "object") throw new Error("TASK_REQUIRED");
  if (typeof task.url !== "string" || !/^https:\/\//i.test(task.url)) throw new Error("HTTPS_URL_REQUIRED");
  const parsed = new URL(task.url);
  if (parsed.username || parsed.password) throw new Error("URL_CREDENTIALS_FORBIDDEN");
  if (!Array.isArray(task.steps) || task.steps.length < 1 || task.steps.length > 30) throw new Error("INVALID_STEPS");
  const allowedHosts = new Set([parsed.hostname.toLowerCase()]);
  if (task.allowedHosts !== undefined) {
    if (!Array.isArray(task.allowedHosts) || task.allowedHosts.length > 10) throw new Error("INVALID_ALLOWED_HOSTS");
    for (const rawHost of task.allowedHosts) {
      const host = String(rawHost).toLowerCase();
      if (!/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/.test(host) || host.includes("..")) throw new Error("INVALID_ALLOWED_HOST");
      allowedHosts.add(host);
    }
  }
  for (const step of task.steps) {
    if (!step || !["navigate","click","fill","read"].includes(step.action)) throw new Error("UNSUPPORTED_ACTION");
    if (step.action === "navigate") {
      if (typeof step.value !== "string") throw new Error("NAVIGATION_URL_REQUIRED");
      let next;
      try { next = new URL(step.value, parsed); } catch { throw new Error("INVALID_NAVIGATION_URL"); }
      if (next.protocol !== "https:" || next.username || next.password || !allowedHosts.has(next.hostname.toLowerCase())) {
        throw new Error("NAVIGATION_OUTSIDE_ALLOWED_HOSTS");
      }
    } else if (typeof step.target !== "string" || !step.target.trim()) {
      throw new Error("TARGET_REQUIRED");
    }
    if (step.action === "click" && BLOCKED_ACTION_PATTERNS.some(pattern => pattern.test(String(step.target)))) {
      throw new Error("HIGH_IMPACT_ACTION_REQUIRES_OWNER");
    }
    if (step.action === "fill" && /password|passcode|otp|sms|verification|card|cvv|secret|token/i.test(String(step.target))) {
      throw new Error("SENSITIVE_FIELD_OWNER_ONLY");
    }
  }
  return { url: parsed.toString(), steps: task.steps, allowedHosts: [...allowedHosts], intent: String(task.intent || "").slice(0,1000) };
}

module.exports = { validateTask };
