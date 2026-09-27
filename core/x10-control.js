"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const STATE_FILE = path.join(DATA_DIR, "x10-control.json");
const ADMIN_KEY = String(process.env.CORE_API_KEY || "").trim();
const HEARTBEAT_TTL_MS = Math.max(30_000, Number(process.env.X10_HEARTBEAT_TTL_MS || 120_000));
const MAX_LOG_CHARS = Math.max(256, Math.min(Number(process.env.X10_MAX_LOG_CHARS || 8000), 50_000));

function now() { return new Date().toISOString(); }
function ensure() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) {
    atomicWrite({ version: 1, agents: {}, commands: [], audit: [] });
  }
}
function atomicWrite(state) {
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(tmp, STATE_FILE);
}
function readState() {
  ensure();
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}
function writeState(state) { atomicWrite(state); }

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}
function issueToken() {
  return crypto.randomBytes(32).toString("base64url");
}
function safeEqual(a, b) {
  const aa = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
function audit(state, event, details = {}) {
  const previous = state.audit[state.audit.length - 1];
  const entry = {
    id: crypto.randomUUID(),
    ts: now(),
    event,
    ...details,
    previousHash: previous?.hash || null
  };
  entry.hash = crypto.createHash("sha256")
    .update(JSON.stringify(entry))
    .digest("hex");
  state.audit.push(entry);
  if (state.audit.length > 5000) state.audit = state.audit.slice(-5000);
  return entry;
}
function normalizeAgentId(value) {
  const id = String(value || "").trim();
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(id)) {
    const error = new Error("invalid agent id");
    error.code = "INVALID_AGENT_ID";
    throw error;
  }
  return id;
}
function agentAuth(req, state) {
  const id = normalizeAgentId(req.params.id);
  const token = String(req.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const agent = state.agents[id];
  return agent && token && safeEqual(agent.tokenHash, tokenHash(token)) ? { id, agent } : null;
}
function requireAdmin(req, res, next) {
  if (!ADMIN_KEY) return res.status(503).json({ ok: false, error: "ADMIN_AUTH_NOT_CONFIGURED" });
  if (!safeEqual(ADMIN_KEY, req.get("X-API-Key"))) return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  next();
}
function publicAgent(agent) {
  return {
    id: agent.id,
    name: agent.name,
    platform: agent.platform,
    targetPackage: agent.targetPackage,
    createdAt: agent.createdAt,
    lastSeen: agent.lastSeen,
    status: Date.now() - Date.parse(agent.lastSeen || 0) <= HEARTBEAT_TTL_MS ? "online" : "offline",
    lastStatus: agent.lastStatus || null,
    lastCommand: agent.lastCommand || null
  };
}

function createX10Router() {
  const router = express.Router();

  router.post("/admin/agents", requireAdmin, (req, res) => {
    try {
      const id = normalizeAgentId(req.body?.id);
      const state = readState();
      if (state.agents[id]) return res.status(409).json({ ok: false, error: "AGENT_EXISTS" });

      const token = issueToken();
      const agent = {
        id,
        name: String(req.body?.name || id).slice(0, 120),
        platform: String(req.body?.platform || "android-termux").slice(0, 60),
        targetPackage: String(req.body?.targetPackage || process.env.X10_TARGET_PACKAGE || "").slice(0, 200),
        tokenHash: tokenHash(token),
        createdAt: now(),
        lastSeen: null,
        lastStatus: null,
        lastCommand: null
      };
      state.agents[id] = agent;
      audit(state, "agent_registered", { agentId: id, platform: agent.platform });
      writeState(state);
      return res.status(201).json({
        ok: true,
        agent: publicAgent(agent),
        token,
        warning: "Store this token securely. It is not retrievable later."
      });
    } catch (error) {
      return res.status(400).json({ ok: false, error: error.code || "BAD_REQUEST" });
    }
  });

  router.get("/admin/agents", requireAdmin, (_req, res) => {
    const state = readState();
    res.json({ ok: true, agents: Object.values(state.agents).map(publicAgent) });
  });

  router.get("/admin/agents/:id", requireAdmin, (req, res) => {
    const state = readState();
    const id = normalizeAgentId(req.params.id);
    const agent = state.agents[id];
    if (!agent) return res.status(404).json({ ok: false, error: "AGENT_NOT_FOUND" });
    res.json({ ok: true, agent: publicAgent(agent) });
  });

  router.post("/admin/agents/:id/restart", requireAdmin, (req, res) => {
    const state = readState();
    const id = normalizeAgentId(req.params.id);
    const agent = state.agents[id];
    if (!agent) return res.status(404).json({ ok: false, error: "AGENT_NOT_FOUND" });

    const command = {
      id: crypto.randomUUID(),
      agentId: id,
      action: "restart_app",
      status: "queued",
      createdAt: now(),
      payload: { reason: String(req.body?.reason || "manual_admin_restart").slice(0, 300) }
    };
    state.commands.push(command);
    if (state.commands.length > 5000) state.commands = state.commands.slice(-5000);
    audit(state, "command_queued", { agentId: id, commandId: command.id, action: command.action });
    writeState(state);
    res.status(202).json({ ok: true, command: { id: command.id, action: command.action, status: command.status } });
  });

  router.get("/admin/audit", requireAdmin, (req, res) => {
    const state = readState();
    const limit = Math.max(1, Math.min(Number(req.query.limit) || 100, 500));
    res.json({ ok: true, audit: state.audit.slice(-limit).reverse() });
  });

  router.post("/agent/:id/heartbeat", (req, res) => {
    const state = readState();
    const auth = agentAuth(req, state);
    if (!auth) return res.status(401).json({ ok: false, error: "UNAUTHORIZED_AGENT" });

    const status = String(req.body?.status || "unknown").slice(0, 40);
    const version = String(req.body?.version || "unknown").slice(0, 80);
    auth.agent.lastSeen = now();
    auth.agent.lastStatus = status;
    auth.agent.version = version;
    audit(state, "heartbeat", { agentId: auth.id, status, version });
    writeState(state);
    res.json({ ok: true, serverTime: now(), heartbeatTtlMs: HEARTBEAT_TTL_MS });
  });

  router.get("/agent/:id/commands", (req, res) => {
    const state = readState();
    const auth = agentAuth(req, state);
    if (!auth) return res.status(401).json({ ok: false, error: "UNAUTHORIZED_AGENT" });

    const command = state.commands.find(
      item => item.agentId === auth.id && item.status === "queued"
    );
    if (!command) return res.json({ ok: true, command: null });

    command.status = "delivered";
    command.deliveredAt = now();
    auth.agent.lastCommand = command.id;
    audit(state, "command_delivered", { agentId: auth.id, commandId: command.id });
    writeState(state);
    res.json({
      ok: true,
      command: {
        id: command.id,
        action: command.action,
        payload: command.payload
      }
    });
  });

  router.post("/agent/:id/commands/:commandId/result", (req, res) => {
    const state = readState();
    const auth = agentAuth(req, state);
    if (!auth) return res.status(401).json({ ok: false, error: "UNAUTHORIZED_AGENT" });

    const command = state.commands.find(
      item => item.id === req.params.commandId && item.agentId === auth.id
    );
    if (!command) return res.status(404).json({ ok: false, error: "COMMAND_NOT_FOUND" });

    const status = String(req.body?.status || "");
    if (!["completed", "failed"].includes(status)) {
      return res.status(400).json({ ok: false, error: "INVALID_COMMAND_STATUS" });
    }
    command.status = status;
    command.result = String(req.body?.message || "").slice(0, 1000);
    command.finishedAt = now();
    audit(state, "command_result", {
      agentId: auth.id,
      commandId: command.id,
      status,
      message: command.result
    });
    writeState(state);
    res.json({ ok: true });
  });

  router.post("/agent/:id/log", (req, res) => {
    const state = readState();
    const auth = agentAuth(req, state);
    if (!auth) return res.status(401).json({ ok: false, error: "UNAUTHORIZED_AGENT" });

    const message = String(req.body?.message || "").slice(0, MAX_LOG_CHARS);
    audit(state, "agent_log", { agentId: auth.id, message });
    writeState(state);
    res.status(202).json({ ok: true });
  });

  return router;
}

module.exports = {
  createX10Router,
  readState,
  HEARTBEAT_TTL_MS
};
