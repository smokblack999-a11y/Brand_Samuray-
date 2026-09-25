"use strict";

const crypto = require("crypto");
const { complete } = require("./providers");
const { SYSTEM_B } = require("./prompts");

const schema = {
  name: "kill_critic_verdict",
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      verdict: { type: "string", enum: ["PASS", "FAIL"] },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      issues: { type: "array", items: { type: "string" } },
      required_changes: { type: "array", items: { type: "string" } },
      evidence_gaps: { type: "array", items: { type: "string" } }
    },
    required: ["verdict", "confidence", "issues", "required_changes", "evidence_gaps"]
  }
};

function deterministicChecks(task, answer) {
  const text = String(answer || "").trim();
  const issues = [];
  if (!text) issues.push("empty_answer");
  if (text.length < 20) issues.push("answer_too_short");
  if (text.length > 16000) issues.push("answer_too_long");
  if (/\b(I|we|system)\s+(have|has|did|completed|executed|deployed|sent|verified)\b/i.test(text)) {
    issues.push("unverified_action_claim");
  }
  if (/ignore (all|previous|system) instructions/i.test(text)) {
    issues.push("instruction_injection_pattern");
  }
  return { pass: issues.length === 0, issues, fingerprint: crypto.createHash("sha256").update(task + "\n" + text).digest("hex") };
}

function parseVerdict(raw) {
  try {
    const value = JSON.parse(raw);
    if (!["PASS", "FAIL"].includes(value.verdict)) throw new Error("bad_verdict");
    value.confidence = Math.max(0, Math.min(1, Number(value.confidence)));
    value.issues = Array.isArray(value.issues) ? value.issues.map(String).slice(0, 20) : [];
    value.required_changes = Array.isArray(value.required_changes) ? value.required_changes.map(String).slice(0, 20) : [];
    value.evidence_gaps = Array.isArray(value.evidence_gaps) ? value.evidence_gaps.map(String).slice(0, 20) : [];
    return value;
  } catch {
    return {
      verdict: "FAIL",
      confidence: 0,
      issues: ["invalid_critic_output"],
      required_changes: ["Return valid JSON matching the critic schema."],
      evidence_gaps: ["critic_output_unparseable"]
    };
  }
}

async function review({ task, answer, provider, model }) {
  const deterministic = deterministicChecks(task, answer);
  if (!deterministic.pass) {
    return {
      verdict: "FAIL",
      confidence: 1,
      issues: deterministic.issues,
      required_changes: ["Fix deterministic safety/quality violations before another review."],
      evidence_gaps: [],
      fingerprint: deterministic.fingerprint,
      source: "deterministic"
    };
  }

  const raw = await complete({
    provider,
    model,
    instructions: SYSTEM_B,
    input: [
      "TASK:\n" + task,
      "\nCANDIDATE ANSWER:\n" + answer,
      "\nEvaluate only this candidate against the task."
    ].join("\n"),
    jsonSchema: schema
  });

  const verdict = parseVerdict(raw);
  verdict.fingerprint = deterministic.fingerprint;
  verdict.source = provider;
  if (verdict.confidence < 0.72) verdict.verdict = "FAIL";
  return verdict;
}

module.exports = { review };
