"use strict";

const crypto = require("crypto");
const { complete, configured } = require("./providers");
const { review } = require("./critic");
const { SYSTEM_A, revisionPrompt } = require("./prompts");
const { verifyEvidence } = require("./evidence-verifier");
const store = require("./store");

const MAX_ROUNDS = Math.max(1, Math.min(Number(process.env.DUAL_AI_MAX_ROUNDS || 3), 5));
const MAX_HISTORY = 12;
const PROVIDERS = ["openai", "anthropic", "ollama"];
const locks = new Set();

function now() { return new Date().toISOString(); }

function config() {
  const defaults = {
    a: {
      provider: process.env.DUAL_AI_A_PROVIDER || "openai",
      model: process.env.DUAL_AI_A_MODEL || process.env.OPENAI_MODEL || "gpt-5"
    },
    b: {
      provider: process.env.DUAL_AI_B_PROVIDER || process.env.DUAL_AI_A_PROVIDER || "openai",
      model: process.env.DUAL_AI_B_MODEL || process.env.DUAL_AI_A_MODEL || process.env.OPENAI_MODEL || "gpt-5"
    }
  };
  const sameModel = defaults.a.provider === defaults.b.provider && defaults.a.model === defaults.b.model;
  return {
    maxRounds: MAX_ROUNDS,
    qualityGate: { minimumScore: 0.85, requireZeroIssues: true, requireZeroEvidenceGaps: true },
    providers: PROVIDERS.map(provider => ({ provider, configured: configured(provider) })),
    defaults,
    modelDiversity: { sameDefaultModel: sameModel, recommendation: sameModel
      ? "Для более независимой критики назначь Model B другой модели или провайдеру."
      : "Роли Model A и Model B используют разные настройки по умолчанию." }
  };
}

function safeSession(session) {
  if (!session) return null;
  return {
    id: session.id,
    task: session.task,
    status: session.status,
    phase: session.phase,
    round: session.round,
    maxRounds: session.maxRounds,
    a: session.a,
    b: session.b,
    turns: session.turns,
    quality: session.quality || null,
    verification: session.verification || null,
    candidate: session.candidate || null,
    final: session.final || null,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt
  };
}

function normalizeModel(role, defaults) {
  const value = role || {};
  const provider = String(value.provider || defaults.provider).toLowerCase();
  const model = String(value.model || defaults.model).trim();
  if (!PROVIDERS.includes(provider)) {
    throw Object.assign(new Error("unsupported_provider"), { code: "UNSUPPORTED_PROVIDER" });
  }
  if (!model || model.length > 120 || /[\r\n]/.test(model)) {
    throw Object.assign(new Error("invalid_model"), { code: "INVALID_MODEL" });
  }
  return { provider, model, last: null };
}

function create({ task, a, b } = {}) {
  const clean = String(task || "").trim();
  if (!clean) throw Object.assign(new Error("task_required"), { code: "TASK_REQUIRED" });
  if (clean.length > 12000) throw Object.assign(new Error("task_too_long"), { code: "TASK_TOO_LONG" });

  const defaults = config().defaults;
  const session = {
    id: crypto.randomUUID(),
    task: clean,
    status: "RUNNING",
    phase: "A_INITIAL",
    round: 1,
    maxRounds: MAX_ROUNDS,
    a: normalizeModel(a, defaults.a),
    b: normalizeModel(b, defaults.b),
    turns: [],
    quality: null,
    verification: null,
    candidate: null,
    final: null,
    createdAt: now(),
    updatedAt: now()
  };
  return safeSession(store.create(session));
}

function requireRunning(session) {
  if (!session) throw Object.assign(new Error("session_not_found"), { code: "SESSION_NOT_FOUND" });
  if (session.status !== "RUNNING") throw Object.assign(new Error("session_not_running"), { code: "SESSION_NOT_RUNNING" });
}

function addTurn(session, turn) {
  session.turns.push({ ...turn, at: now() });
  if (session.turns.length > MAX_HISTORY) session.turns = session.turns.slice(-MAX_HISTORY);
}

async function next(id) {
  if (locks.has(id)) throw Object.assign(new Error("session_busy"), { code: "SESSION_BUSY" });
  locks.add(id);
  try {
    const session = store.get(id);
    requireRunning(session);

    if (session.phase === "A_INITIAL" || session.phase === "A_REVISION") {
      const input = session.phase === "A_INITIAL"
        ? [
          "РЕЖИМ: ГЛУБОКИЙ АНАЛИЗ",
          "Сначала выдели цель, требования и критерии успеха. Затем реши задачу.",
          "ИСХОДНАЯ ЗАДАЧА:\n" + session.task
        ].join("\n\n")
        : revisionPrompt(session.task, session.a.last.content, session.b.last);

      const content = await complete({
        provider: session.a.provider,
        model: session.a.model,
        instructions: SYSTEM_A,
        input
      });

      if (!String(content || "").trim()) {
        throw Object.assign(new Error("empty_model_response"), { code: "EMPTY_MODEL_RESPONSE" });
      }
      session.a.last = { content, round: session.round };
      addTurn(session, { agent: "A", kind: session.phase, round: session.round, content });
      session.phase = "B_REVIEW";
    } else if (session.phase === "B_REVIEW") {
      const verdict = await review({
        task: session.task,
        answer: session.a.last.content,
        provider: session.b.provider,
        model: session.b.model
      });

      session.b.last = verdict;
      session.quality = verdict;
      addTurn(session, { agent: "B", kind: "CRITIC", round: session.round, ...verdict });

      if (verdict.verdict === "PASS") {
        session.status = "COMPLETE";
        session.phase = "DONE";
        session.final = session.a.last.content;
      } else if (session.round >= session.maxRounds) {
        session.status = "BLOCKED";
        session.phase = "MAX_ROUNDS";
        session.final = null;
      } else {
        session.round += 1;
        session.phase = "A_REVISION";
      }
    } else {
      session.status = "BLOCKED";
      session.phase = "INVALID_STATE";
    }

    return safeSession(store.update(id, session));
  } finally {
    locks.delete(id);
  }
}

function stop(id) {
  const session = store.get(id);
  requireRunning(session);
  session.status = "STOPPED";
  session.phase = "STOPPED";
  return safeSession(store.update(id, session));
}

function get(id) { return safeSession(store.get(id)); }
function list() { return store.list().map(safeSession); }

function exportData(id) {
  const session = store.get(id);
  if (!session) throw Object.assign(new Error("session_not_found"), { code: "SESSION_NOT_FOUND" });
  return JSON.stringify(safeSession(session), null, 2);
}

module.exports = { config, create, next, stop, get, list, exportData };
