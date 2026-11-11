"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");

function required(value, name, max = 200) {
  const result = String(value ?? "").trim();
  if (!result) {
    const error = new Error(name + " is required");
    error.code = "INVALID_" + name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    throw error;
  }
  if (result.length > max) {
    const error = new Error(name + " is too long");
    error.code = "FIELD_TOO_LONG";
    throw error;
  }
  return result;
}
function safeLimit(value, fallback, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(Math.trunc(n), max)) : fallback;
}
function safeJson(value) {
  return JSON.stringify(value == null ? {} : value);
}
function tokens(text) {
  return [...new Set(String(text || "").toLowerCase().match(/[a-zа-яё0-9]{2,}/giu) || [])];
}

function createSellerLearningStore(options = {}) {
  const dbPath = options.dbPath || process.env.SELLER_LEARNING_DB_PATH ||
    path.join(process.env.DATA_DIR || path.join(__dirname, "data"), "seller-learning.sqlite");
  const clock = options.clock || (() => new Date().toISOString());
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true, mode: 0o700 });
    try { fs.chmodSync(path.dirname(path.resolve(dbPath)), 0o700); } catch {}
  }
  const db = new DatabaseSync(dbPath);
  if (dbPath !== ":memory:") {
    try { fs.chmodSync(path.resolve(dbPath), 0o600); }
    catch (error) { db.close(); throw error; }
  }
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
  db.exec(
    "CREATE TABLE IF NOT EXISTS seller_knowledge (" +
    "id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('product_fact','policy','style','faq'))," +
    "title TEXT NOT NULL, body TEXT NOT NULL, source TEXT NOT NULL," +
    "status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')), version INTEGER NOT NULL DEFAULT 1," +
    "created_at TEXT NOT NULL, updated_at TEXT NOT NULL, approved_at TEXT, approved_by TEXT);" +
    "CREATE INDEX IF NOT EXISTS idx_seller_knowledge_tenant_status ON seller_knowledge(tenant_id,status,kind,updated_at);" +
    "CREATE TABLE IF NOT EXISTS seller_practice_examples (" +
    "id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, customer_context TEXT NOT NULL, ai_draft TEXT NOT NULL," +
    "seller_final TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('approved','edited','rejected','converted','not_converted'))," +
    "reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected'))," +
    "created_at TEXT NOT NULL, approved_at TEXT, approved_by TEXT);" +
    "CREATE INDEX IF NOT EXISTS idx_seller_examples_tenant_status ON seller_practice_examples(tenant_id,status,created_at);" +
    "CREATE TABLE IF NOT EXISTS seller_learning_audit (" +
    "id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL," +
    "record_id TEXT NOT NULL, created_at TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}');" +
    "CREATE INDEX IF NOT EXISTS idx_seller_audit_tenant_id ON seller_learning_audit(tenant_id,id DESC);" +
    "CREATE TRIGGER IF NOT EXISTS seller_audit_no_update BEFORE UPDATE ON seller_learning_audit " +
    "BEGIN SELECT RAISE(ABORT,'seller audit is append-only'); END;" +
    "CREATE TRIGGER IF NOT EXISTS seller_audit_no_delete BEFORE DELETE ON seller_learning_audit " +
    "BEGIN SELECT RAISE(ABORT,'seller audit is append-only'); END;"
  );

  const now = () => clock();
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      db.exec("COMMIT");
      return result;
    } catch (error) {
      try { db.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }
  function audit(tenantId, actorId, action, recordId, details = {}) {
    db.prepare("INSERT INTO seller_learning_audit(tenant_id,actor_id,action,record_id,created_at,details) VALUES(?,?,?,?,?,?)")
      .run(tenantId, actorId, action, recordId, now(), safeJson(details));
  }
  function mapKnowledge(row) {
    return row ? {
      id: row.id, tenantId: row.tenant_id, kind: row.kind, title: row.title, body: row.body,
      source: row.source, status: row.status, version: row.version, createdAt: row.created_at,
      updatedAt: row.updated_at, approvedAt: row.approved_at, approvedBy: row.approved_by
    } : null;
  }
  function mapExample(row) {
    return row ? {
      id: row.id, tenantId: row.tenant_id, customerContext: row.customer_context,
      aiDraft: row.ai_draft, sellerFinal: row.seller_final, outcome: row.outcome, reason: row.reason,
      status: row.status, createdAt: row.created_at, approvedAt: row.approved_at, approvedBy: row.approved_by
    } : null;
  }

  function addKnowledge(input = {}) {
    const tenantId = required(input.tenantId, "tenantId");
    const actorId = required(input.actorId, "actorId");
    const kind = required(input.kind, "kind", 32);
    if (!["product_fact", "policy", "style", "faq"].includes(kind)) throw new Error("Unsupported knowledge kind");
    const id = required(input.id || crypto.randomUUID(), "id");
    const title = required(input.title, "title", 160);
    const body = required(input.body, "body", 8000);
    const source = required(input.source || "seller_input", "source", 80);
    const at = now();
    transaction(() => {
      db.prepare("INSERT INTO seller_knowledge(id,tenant_id,kind,title,body,source,status,version,created_at,updated_at) VALUES(?,?,?,?,?,?,'pending',1,?,?)")
        .run(id, tenantId, kind, title, body, source, at, at);
      audit(tenantId, actorId, "knowledge.created_pending", id, { kind, source });
    });
    return mapKnowledge(db.prepare("SELECT * FROM seller_knowledge WHERE tenant_id=? AND id=?").get(tenantId, id));
  }

  function updateKnowledge(input = {}) {
    const tenantId = required(input.tenantId, "tenantId");
    const actorId = required(input.actorId, "actorId");
    const id = required(input.id, "id");
    const existing = db.prepare("SELECT * FROM seller_knowledge WHERE tenant_id=? AND id=?").get(tenantId, id);
    if (!existing) return null;
    const title = input.title == null ? existing.title : required(input.title, "title", 160);
    const body = input.body == null ? existing.body : required(input.body, "body", 8000);
    const source = input.source == null ? existing.source : required(input.source, "source", 80);
    transaction(() => {
      db.prepare("UPDATE seller_knowledge SET title=?,body=?,source=?,status='pending',version=version+1,updated_at=?,approved_at=NULL,approved_by=NULL WHERE tenant_id=? AND id=?")
        .run(title, body, source, now(), tenantId, id);
      audit(tenantId, actorId, "knowledge.updated_pending", id, { version: existing.version + 1 });
    });
    return mapKnowledge(db.prepare("SELECT * FROM seller_knowledge WHERE tenant_id=? AND id=?").get(tenantId, id));
  }

  function reviewKnowledge(input = {}) {
    const tenantId = required(input.tenantId, "tenantId");
    const actorId = required(input.actorId, "actorId");
    const id = required(input.id, "id");
    const decision = required(input.decision, "decision", 16);
    if (!["approved", "rejected"].includes(decision)) throw new Error("Invalid review decision");
    const existing = db.prepare("SELECT * FROM seller_knowledge WHERE tenant_id=? AND id=?").get(tenantId, id);
    if (!existing) return null;
    transaction(() => {
      const at = now();
      db.prepare("UPDATE seller_knowledge SET status=?,approved_at=?,approved_by=?,updated_at=? WHERE tenant_id=? AND id=?")
        .run(decision, decision === "approved" ? at : null, decision === "approved" ? actorId : null, at, tenantId, id);
      audit(tenantId, actorId, "knowledge." + decision, id, {});
    });
    return mapKnowledge(db.prepare("SELECT * FROM seller_knowledge WHERE tenant_id=? AND id=?").get(tenantId, id));
  }

  function addPracticeExample(input = {}) {
    const tenantId = required(input.tenantId, "tenantId");
    const actorId = required(input.actorId, "actorId");
    const id = required(input.id || crypto.randomUUID(), "id");
    const customerContext = required(input.customerContext, "customerContext", 4000);
    const aiDraft = required(input.aiDraft, "aiDraft", 4096);
    const sellerFinal = required(input.sellerFinal, "sellerFinal", 4096);
    const outcome = required(input.outcome || "edited", "outcome", 32);
    if (!["approved", "edited", "rejected", "converted", "not_converted"].includes(outcome)) throw new Error("Invalid outcome");
    const reason = String(input.reason || "").trim().slice(0, 1000);
    const at = now();
    transaction(() => {
      db.prepare("INSERT INTO seller_practice_examples(id,tenant_id,customer_context,ai_draft,seller_final,outcome,reason,status,created_at) VALUES(?,?,?,?,?,?,?,'pending',?)")
        .run(id, tenantId, customerContext, aiDraft, sellerFinal, outcome, reason, at);
      audit(tenantId, actorId, "practice.created_pending", id, { outcome });
    });
    return mapExample(db.prepare("SELECT * FROM seller_practice_examples WHERE tenant_id=? AND id=?").get(tenantId, id));
  }

  function reviewExample(input = {}) {
    const tenantId = required(input.tenantId, "tenantId");
    const actorId = required(input.actorId, "actorId");
    const id = required(input.id, "id");
    const decision = required(input.decision, "decision", 16);
    if (!["approved", "rejected"].includes(decision)) throw new Error("Invalid review decision");
    const existing = db.prepare("SELECT * FROM seller_practice_examples WHERE tenant_id=? AND id=?").get(tenantId, id);
    if (!existing) return null;
    transaction(() => {
      const at = now();
      db.prepare("UPDATE seller_practice_examples SET status=?,approved_at=?,approved_by=? WHERE tenant_id=? AND id=?")
        .run(decision, decision === "approved" ? at : null, decision === "approved" ? actorId : null, tenantId, id);
      audit(tenantId, actorId, "practice." + decision, id, {});
    });
    return mapExample(db.prepare("SELECT * FROM seller_practice_examples WHERE tenant_id=? AND id=?").get(tenantId, id));
  }

  function listKnowledge(input = {}) {
    const tenantId = required(input.tenantId, "tenantId");
    const status = input.status == null ? null : String(input.status);
    if (status && !["pending", "approved", "rejected"].includes(status)) throw new Error("Invalid knowledge status");
    const limit = safeLimit(input.limit, 100, 500);
    const rows = status
      ? db.prepare("SELECT * FROM seller_knowledge WHERE tenant_id=? AND status=? ORDER BY updated_at DESC LIMIT ?").all(tenantId, status, limit)
      : db.prepare("SELECT * FROM seller_knowledge WHERE tenant_id=? ORDER BY updated_at DESC LIMIT ?").all(tenantId, limit);
    return rows.map(mapKnowledge);
  }
  function listPracticeExamples(input = {}) {
    const tenantId = required(input.tenantId, "tenantId");
    const status = input.status == null ? null : String(input.status);
    if (status && !["pending", "approved", "rejected"].includes(status)) throw new Error("Invalid practice status");
    const limit = safeLimit(input.limit, 100, 500);
    const rows = status
      ? db.prepare("SELECT * FROM seller_practice_examples WHERE tenant_id=? AND status=? ORDER BY created_at DESC LIMIT ?").all(tenantId, status, limit)
      : db.prepare("SELECT * FROM seller_practice_examples WHERE tenant_id=? ORDER BY created_at DESC LIMIT ?").all(tenantId, limit);
    return rows.map(mapExample);
  }

  function retrieve(input = {}) {
    const tenantId = required(input.tenantId, "tenantId");
    const query = required(input.query, "query", 4000);
    const queryTokens = tokens(query);
    const limit = safeLimit(input.limit, 8, 20);
    if (!queryTokens.length) return [];
    const knowledge = db.prepare("SELECT * FROM seller_knowledge WHERE tenant_id=? AND status='approved' ORDER BY updated_at DESC LIMIT 300").all(tenantId);
    const examples = db.prepare("SELECT * FROM seller_practice_examples WHERE tenant_id=? AND status='approved' ORDER BY created_at DESC LIMIT 300").all(tenantId);
    const rank = text => {
      const words = new Set(tokens(text));
      return queryTokens.reduce((score, word) => score + (words.has(word) ? 1 : 0), 0) / queryTokens.length;
    };
    return [
      ...knowledge.map(row => ({ type: "knowledge", record: mapKnowledge(row), score: rank(row.title + " " + row.body) })),
      ...examples.map(row => ({ type: "practice", record: mapExample(row), score: rank(row.customer_context + " " + row.seller_final) }))
    ].filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score ||
        String(b.record.updatedAt || b.record.createdAt).localeCompare(String(a.record.updatedAt || a.record.createdAt)))
      .slice(0, limit);
  }

  function listAudit(input = {}) {
    const tenantId = required(input.tenantId, "tenantId");
    const limit = safeLimit(input.limit, 100, 500);
    return db.prepare("SELECT * FROM seller_learning_audit WHERE tenant_id=? ORDER BY id DESC LIMIT ?")
      .all(tenantId, limit)
      .map(row => ({
        id: row.id, tenantId: row.tenant_id, actorId: row.actor_id, action: row.action,
        recordId: row.record_id, createdAt: row.created_at, details: JSON.parse(row.details)
      }));
  }
  function close() { db.close(); }

  return { addKnowledge, updateKnowledge, reviewKnowledge, addPracticeExample, reviewExample,
    listKnowledge, listPracticeExamples, retrieve, listAudit, close };
}

module.exports = { createSellerLearningStore };
