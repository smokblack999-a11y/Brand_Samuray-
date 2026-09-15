"use strict";

const OpenAI = require("openai");
const { X10Think } = require("./x10think");

const TIMEOUT_MS = Math.max(5000, Number(process.env.DUAL_AI_TIMEOUT_MS || 60000));
const MAX_ROUNDS = Math.max(1, Math.min(Number(process.env.DUAL_AI_MAX_ROUNDS || 3), 5));

function client() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: TIMEOUT_MS,
    maxRetries: 2
  });
}

function model(role) {
  return process.env[`DUAL_AI_MODEL_${role.toUpperCase()}`] || process.env.OPENAI_MODEL || "gpt-5.6-luna";
}

async function ask(role, instructions, input) {
  const response = await client().responses.create({
    model: model(role),
    instructions,
    input
  });
  const text = String(response.output_text || "").trim();
  if (!text) throw new Error(`${role} returned an empty response`);
  return text;
}

function extractJson(text) {
  const fenced = text.match(/```json\s*([\s\S]*?)\s*```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Judge returned invalid JSON");
  return JSON.parse(candidate.slice(start, end + 1));
}

async function runDualAI(task, options = {}) {
  const maxRounds = Math.max(1, Math.min(Number(options.maxRounds || MAX_ROUNDS), 5));
  const memory = new X10Think({
    task,
    status: "running",
    round: 0,
    messages: [],
    issues: [],
    confidence: 0
  });

  for (let round = 1; round <= maxRounds; round += 1) {
    memory.apply([{ type: "set", path: "round", value: round }]);

    const previous = memory.state.messages.slice(-6);
    const solution = await ask(
      "solver",
      [
        "Ты Solver в SamuraiOS/X10THINK.",
        "Решай задачу самостоятельно и конкретно.",
        "Не выдумывай факты, API, результаты тестов или выполненные действия.",
        "Если данных недостаточно, явно укажи допущение."
      ].join("\n"),
      JSON.stringify({ task, previous }, null, 2)
    );

    memory.apply([{ type: "push", path: "messages", value: { role: "solver", round, text: solution } }]);

    const critique = await ask(
      "critic",
      [
        "Ты adversarial Kill Critic.",
        "Твоя задача — атаковать решение, а не соглашаться с ним.",
        "Ищи логические ошибки, неподтверждённые утверждения, пропущенные риски, security issues и неверные API assumptions.",
        "Предлагай конкретные исправления."
      ].join("\n"),
      JSON.stringify({ task, solution, history: memory.state.messages.slice(-8) }, null, 2)
    );

    memory.apply([{ type: "push", path: "messages", value: { role: "critic", round, text: critique } }]);

    const verdictRaw = await ask(
      "judge",
      [
        "Ты финальный Kill Critic Judge.",
        "Оцени решение после adversarial critique.",
        "Верни ТОЛЬКО JSON без markdown в формате:",
        '{"pass":true,"confidence":0.0,"issues":[],"unsupported_claims":[],"contradictions":[],"missing_evidence":[],"final_answer":"..."}',
        "pass=true только если ответ достаточно надёжен для выдачи пользователю.",
        "confidence — число от 0 до 1."
      ].join("\n"),
      JSON.stringify({ task, solution, critique, round }, null, 2)
    );

    let verdict;
    try {
      verdict = extractJson(verdictRaw);
    } catch (error) {
      verdict = {
        pass: false,
        confidence: 0,
        issues: ["Judge output was not valid JSON"],
        unsupported_claims: [],
        contradictions: [],
        missing_evidence: [],
        final_answer: ""
      };
    }

    const confidence = Math.max(0, Math.min(Number(verdict.confidence) || 0, 1));
    memory.apply([
      { type: "set", path: "confidence", value: confidence },
      { type: "set", path: "issues", value: Array.isArray(verdict.issues) ? verdict.issues : [] },
      { type: "set", path: "status", value: verdict.pass === true ? "verified" : "retry" },
      { type: "push", path: "messages", value: { role: "judge", round, verdict } }
    ]);
    memory.checkpoint(`round-${round}`);

    if (verdict.pass === true) {
      memory.apply([
        { type: "set", path: "finalAnswer", value: String(verdict.final_answer || solution) },
        { type: "set", path: "status", value: "verified" }
      ]);
      return memory.state;
    }
  }

  memory.apply([{ type: "set", path: "status", value: "max_rounds_reached" }]);
  return memory.state;
}

module.exports = { runDualAI };
