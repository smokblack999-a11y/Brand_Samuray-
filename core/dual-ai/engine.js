"use strict";

const crypto = require("crypto");
const store = require("./store");
const {
  createProvider,
  providerStatus
} = require("./providers");
const {
  CRITIC_SCHEMA,
  draftPrompt,
  critiquePrompt,
  revisionPrompt,
  verdictPrompt,
  debatePrompt,
  independentPrompt,
  parseStructured
} = require("./prompts");

const MAX_TASK_CHARS = 12000;
const MAX_CYCLES = Math.max(1, Math.min(Number(process.env.DUAL_AI_MAX_CYCLES || 2), 5));
const MIN_CONFIDENCE = Math.max(0.5, Math.min(Number(process.env.DUAL_AI_MIN_CONFIDENCE || 0.78), 0.99));
const MAX_TURNS = Math.max(2, Math.min(Number(process.env.DUAL_AI_MAX_TURNS || 8), 20));
const running = new Set();

function id() {
  return crypto.randomUUID();
}

function cleanTask(task) {
  const value = String(task || "").trim();
  if (!value) {
    const error = new Error("task обязателен");
    error.code = "INVALID_TASK";
    throw error;
  }
  if (value.length > MAX_TASK_CHARS) {
    const error = new Error(`task слишком длинный (максимум ${MAX_TASK_CHARS} символов)`);
    error.code = "TASK_TOO_LONG";
    throw error;
  }
  return value;
}

function agentConfig(agent, input = {}) {
  const suffix = agent === "A" ? "A" : "B";
  const provider = String(
    input[`provider${suffix}`] ||
    process.env[`DUAL_MODEL_${suffix}_PROVIDER`] ||
    "openai"
  ).toLowerCase();

  const model = String(
    input[`model${suffix}`] ||
    process.env[`DUAL_MODEL_${suffix}_MODEL`] ||
    (suffix === "A" ? process.env.OPENAI_MODEL : "gpt-5.6-terra")
  ).trim();

  return { provider, model };
}

function createAgentPair(input) {
  return {
    A: agentConfig("A", input),
    B: agentConfig("B", input)
  };
}

function makePublic(session) {
  if (!session) return null;
  const safe = JSON.parse(JSON.stringify(session));
  delete safe.__internal;
  return safe;
}

function parseGate(candidate, critique) {
  const issues = Array.isArray(critique?.issues) ? critique.issues : [];
  const critical = issues.filter((x) => String(x?.severity).toLowerCase() === "critical");
  const high = issues.filter((x) => String(x?.severity).toLowerCase() === "high");
  const confidence = Number(critique?.confidence);

  const reasons = [];
  if (!candidate || candidate.length < 20) reasons.push("candidate_too_short");
  if (!Number.isFinite(confidence) || confidence < MIN_CONFIDENCE) reasons.push("confidence_below_threshold");
  if (critical.length) reasons.push("critical_issues_present");
  if (critique?.decision === "FAIL") reasons.push("critic_fail");
  if (critique?.decision === "REVISE") reasons.push("critic_requests_revision");

  return {
    pass: reasons.length === 0,
    reasons,
    confidence: Number.isFinite(confidence) ? confidence : 0,
    criticalIssues: critical.length,
    highIssues: high.length
  };
}

function statusForPhase(phase) {
  return {
    DRAFT: "WORKING",
    CRITIQUE: "WORKING",
    REVISION: "WORKING",
    VERDICT: "WORKING",
    DEBATE: "WORKING",
    INDEPENDENT_A: "WORKING",
    INDEPENDENT_B: "WORKING",
    COMPLETE: "COMPLETE",
    BLOCKED: "BLOCKED",
    STOPPED: "STOPPED",
    ERROR: "ERROR"
  }[phase] || "WORKING";
}

function createSession(input = {}) {
  const task = cleanTask(input.task);
  const mode = ["critic", "debate", "independent"].includes(input.mode) ? input.mode : "critic";
  const agents = createAgentPair(input);
  const maxCycles = Math.max(1, Math.min(Number(input.maxCycles || MAX_CYCLES), MAX_CYCLES));

  return store.createSession({
    id: id(),
    task,
    mode,
    maxCycles,
    agentA: agents.A,
    agentB: agents.B,
    phase: mode === "critic" ? "DRAFT" : mode === "debate" ? "DEBATE_A" : "INDEPENDENT_A",
    status: "READY"
  });
}

function providerFor(session, agent) {
  return createProvider(agent === "A" ? session.agentA : session.agentB);
}

async function runCriticTurn(session, phase) {
  const provider = phase === "DRAFT" || phase === "REVISION"
    ? providerFor(session, "A")
    : providerFor(session, "B");

  let result;
  let agent;
  let content;
  let meta = {};

  if (phase === "DRAFT") {
    agent = "A";
    const prompt = draftPrompt(session.task);
    result = await provider.generate(prompt);
    content = result.text;
    const turn = store.appendTurn(session.id, {
      agent,
      role: "generator",
      phase,
      content,
      provider: result.provider,
      model: result.model,
      responseId: result.responseId,
      usage: result.usage
    });
    store.updateSession(session.id, {
      currentCandidate: content,
      phase: "CRITIQUE",
      status: "WORKING"
    });
    return turn;
  }

  if (phase === "CRITIQUE") {
    agent = "B";
    const prompt = critiquePrompt(session.task, session.currentCandidate);
    result = await provider.generate({ ...prompt, jsonSchema: CRITIC_SCHEMA });
    const critique = parseStructured(result.text);
    const gate = parseGate(session.currentCandidate, critique);

    content = JSON.stringify({ ...critique, gate }, null, 2);
    const turn = store.appendTurn(session.id, {
      agent,
      role: "critic",
      phase,
      content,
      structured: critique,
      gate,
      provider: result.provider,
      model: result.model,
      responseId: result.responseId,
      usage: result.usage
    });

    store.updateSession(session.id, {
      lastCritique: critique,
      lastGate: gate,
      phase: gate.pass ? "VERDICT" : "REVISION",
      status: statusForPhase(gate.pass ? "VERDICT" : "REVISION")
    });
    return turn;
  }

  if (phase === "REVISION") {
    agent = "A";
    const prompt = revisionPrompt(session.task, session.currentCandidate, session.lastCritique);
    result = await provider.generate(prompt);
    content = result.text;
    const nextCycle = Number(session.cycle || 0) + 1;

    const turn = store.appendTurn(session.id, {
      agent,
      role: "revision",
      phase,
      content,
      cycle: nextCycle,
      provider: result.provider,
      model: result.model,
      responseId: result.responseId,
      usage: result.usage
    });

    store.updateSession(session.id, {
      currentCandidate: content,
      cycle: nextCycle,
      phase: "VERDICT",
      status: "WORKING"
    });
    return turn;
  }

  if (phase === "VERDICT") {
    agent = "B";
    const prompt = verdictPrompt(session.task, session.currentCandidate);
    result = await provider.generate({ ...prompt, jsonSchema: CRITIC_SCHEMA });
    const verdict = parseStructured(result.text);
    const gate = parseGate(session.currentCandidate, verdict);
    const canRetry = Number(session.cycle || 0) < Number(session.maxCycles || MAX_CYCLES);

    content = JSON.stringify({ ...verdict, gate }, null, 2);
    const turn = store.appendTurn(session.id, {
      agent,
      role: "final_critic",
      phase,
      content,
      structured: verdict,
      gate,
      provider: result.provider,
      model: result.model,
      responseId: result.responseId,
      usage: result.usage
    });

    if (gate.pass) {
      store.updateSession(session.id, {
        lastCritique: verdict,
        lastGate: gate,
        finalAnswer: session.currentCandidate,
        phase: "COMPLETE",
        status: "COMPLETE"
      });
    } else if (canRetry) {
      store.updateSession(session.id, {
        lastCritique: verdict,
        lastGate: gate,
        phase: "REVISION",
        status: "WORKING"
      });
    } else {
      store.updateSession(session.id, {
        lastCritique: verdict,
        lastGate: gate,
        phase: "BLOCKED",
        status: "BLOCKED"
      });
    }
    return turn;
  }

  throw new Error(`unsupported critic phase: ${phase}`);
}

async function runDebateTurn(session) {
  const turnCount = session.turns.length;
  const agent = turnCount % 2 === 0 ? "A" : "B";
  const provider = providerFor(session, agent);
  const prompt = debatePrompt(session.task, session.turns, agent);
  const result = await provider.generate(prompt);

  const turn = store.appendTurn(session.id, {
    agent,
    role: "debater",
    phase: `DEBATE_${agent}`,
    content: result.text,
    provider: result.provider,
    model: result.model,
    responseId: result.responseId,
    usage: result.usage
  });

  const completed = turnCount + 1 >= MAX_TURNS;
  store.updateSession(session.id, {
    phase: completed ? "COMPLETE" : `DEBATE_${agent === "A" ? "B" : "A"}`,
    status: completed ? "COMPLETE" : "WORKING",
    finalAnswer: completed ? result.text : ""
  });

  return turn;
}

async function runIndependentTurn(session) {
  const phase = session.phase;
  const agent = phase === "INDEPENDENT_A" ? "A" : "B";
  const provider = providerFor(session, agent);
  const prompt = independentPrompt(session.task, agent);
  const result = await provider.generate(prompt);

  const turn = store.appendTurn(session.id, {
    agent,
    role: "independent",
    phase,
    content: result.text,
    provider: result.provider,
    model: result.model,
    responseId: result.responseId,
    usage: result.usage
  });

  if (agent === "A") {
    store.updateSession(session.id, { phase: "INDEPENDENT_B", status: "WORKING", currentCandidate: result.text });
  } else {
    store.updateSession(session.id, { phase: "COMPLETE", status: "COMPLETE", finalAnswer: result.text });
  }
  return turn;
}

async function runTurn(idValue) {
  if (!idValue) throw new Error("session id обязателен");
  if (running.has(idValue)) {
    const error = new Error("session is already running");
    error.code = "SESSION_BUSY";
    throw error;
  }

  const initial = store.getSession(idValue);
  if (!initial) {
    const error = new Error("session not found");
    error.code = "SESSION_NOT_FOUND";
    throw error;
  }

  if (["COMPLETE", "BLOCKED", "STOPPED"].includes(initial.status)) {
    const error = new Error(`session is ${initial.status.toLowerCase()}`);
    error.code = "SESSION_NOT_RUNNABLE";
    throw error;
  }

  running.add(idValue);
  store.updateSession(idValue, { status: "WORKING" });

  try {
    const session = store.getSession(idValue);
    if (session.mode === "critic") await runCriticTurn(session, session.phase);
    else if (session.mode === "debate") await runDebateTurn(session);
    else await runIndependentTurn(session);
    return makePublic(store.getSession(idValue));
  } catch (error) {
    store.updateSession(idValue, {
      status: "ERROR",
      phase: "ERROR",
      error: error.message
    });
    throw error;
  } finally {
    running.delete(idValue);
  }
}

function stopSession(idValue) {
  const session = store.getSession(idValue);
  if (!session) {
    const error = new Error("session not found");
    error.code = "SESSION_NOT_FOUND";
    throw error;
  }
  if (["COMPLETE", "BLOCKED"].includes(session.status)) return makePublic(session);
  return makePublic(store.updateSession(idValue, { status: "STOPPED", phase: "STOPPED" }));
}

function configStatus(input = {}) {
  const agents = createAgentPair(input);
  return {
    maxCycles: MAX_CYCLES,
    minConfidence: MIN_CONFIDENCE,
    maxTurns: MAX_TURNS,
    agents: {
      A: providerStatus(agents.A),
      B: providerStatus(agents.B)
    },
    supportedProviders: ["openai", "anthropic", "ollama"]
  };
}

function sessionExport(idValue, format = "json") {
  const session = store.getSession(idValue);
  if (!session) {
    const error = new Error("session not found");
    error.code = "SESSION_NOT_FOUND";
    throw error;
  }

  if (format === "txt") {
    const lines = [
      "SAMURAI AI DUAL",
      `Session: ${session.id}`,
      `Mode: ${session.mode}`,
      `Status: ${session.status}`,
      `Task: ${session.task}`,
      ""
    ];
    for (const t of session.turns) {
      lines.push(`===== TURN ${t.turn} | MODEL ${t.agent} | ${t.role} =====`);
      lines.push(t.content);
      lines.push("");
    }
    if (session.finalAnswer) {
      lines.push("===== FINAL ANSWER =====");
      lines.push(session.finalAnswer);
    }
    return { contentType: "text/plain; charset=utf-8", content: lines.join("\n"), filename: `dual-ai-${session.id}.txt` };
  }

  return {
    contentType: "application/json; charset=utf-8",
    content: JSON.stringify(session, null, 2),
    filename: `dual-ai-${session.id}.json`
  };
}

module.exports = {
  createSession,
  getSession: (idValue) => makePublic(store.getSession(idValue)),
  runTurn,
  stopSession,
  configStatus,
  sessionExport,
  parseGate
};
