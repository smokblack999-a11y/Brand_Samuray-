"use strict";

const BLOCKED_ACTION_PATTERNS = [
  /\\b(bet|wager|stake|place bet|ставк|поставить|удвоить|all.?in)\\b/i,
  /\\b(deposit|withdraw|cash.?out|payment|purchase|pay now)\\b/i,
  /\\b(delete|remove account|close account|send money|transfer)\\b/i
];

function validateTask(task) {
  if (!task || typeof task !== "object") throw new Error("TASK_REQUIRED");
  if (typeof task.url !== "string" || !/^https:\\/\\//i.test(task.url)) throw new Error("HTTPS_URL_REQUIRED");
  const parsed = new URL(task.url);
  if (parsed.username || parsed.password) throw new Error("URL_CREDENTIALS_FORBIDDEN");
  if (!Array.isArray(task.steps) || task.steps.length < 1 || task.steps.length > 30) throw new Error("INVALID_STEPS");
  for (const step of task.steps) {
    if (!step || !["navigate","click","fill","read"].includes(step.action)) throw new Error("UNSUPPORTED_ACTION");
    const target = String(step.target || "");
    if (step.action === "click" && BLOCKED_ACTION_PATTERNS.some(pattern => pattern.test(target))) {
      throw new Error("HIGH_IMPACT_ACTION_REQUIRES_OWNER");
    }
    if (step.action === "fill" && /password|passcode|otp|sms|verification|card|cvv/i.test(target)) {
      throw new Error("SENSITIVE_FIELD_OWNER_ONLY");
    }
  }
  return { url: parsed.toString(), steps: task.steps };
}

module.exports = { validateTask };
