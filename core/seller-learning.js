"use strict";

// Tenant-scoped practice memory. This is retrieval-based learning, not model fine-tuning.
// Only seller-approved facts/examples are returned to the generation layer.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const DEFAULT_DB_PATH = process.env.SELLER_LEARNING_DB_PATH ||
  path.join(process.env.DATA_DIR || path.join(__dirname, "data"), "seller-learning.sqlite");

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

function safeJson(value) {
  return JSON.stringify(value == null ? {} : value);
}

function createSellerLearningStore({ dbPath = DEFAULT_DB_PATH, clock = () => new Date().toISOString() } = {}) {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true, mode: 0o700 });
  }
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS seller_knowledge (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('product_fact','policy','style','faq')),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      source TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      approved_at TEXT,
      approved_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_seller_knowledge_tenant_status
      ON seller_knowledge(tenant_id, status, kind, updated_at);
    CREATE TABLE IF NOT EXISTS seller_practice_examples (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      customer_context TEXT NOT NULL,
      ai_draft TEXT NOT NULL,
      seller_final TEXT NOT NULL,
      outcome TEXT NOT NULL CHECK(outcome IN ('approved','edited','rejected','converted','not_converted')),
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
      created_at TEXT NOT NULL,
      approved_at TEXT,
      approved_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_seller_examples_tenant_status
      ON seller_practice_examples(tenant_id, status, created_at);
    CREATE TABLE IF NOT EXISTS seller_learning_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      record_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '{}'
    );
  `);

  const now = () => clock();
  function audit(tenantId, actorId, action, recordId, details = {}) {
    db.prepare(`INSERT INTO seller_learning_audit
      (tenant_id, actor_id, action, record_id, created_at, details)
      VALUES (?, ?, ?, ?, ?, ?)`).run(tenantId, actorId, action, recordId, now(), safeJson(details));
  }
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try { const result = fn(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  function mapKnowledge(row) {
    if (!row) return null;
    return { id: row.id, tenantId: row.tenant_id, kind: row.kind, title: row.title,
      body: row.body, source: row.source, status: row.status, version: row.version,
      createdAt: row.created_at, updatedAt: row.updated_at, approvedAt: row.approved_at,
      approvedBy: row.approved_by };
  }
  function mapExample(row) {
    if (!row) return null;
    return { id: row.id, tenantId: row.tenant_id, customerContext: row.customer_context,
      aiDraft: row.ai_draft, sellerFinal: row.seller_final, outcome: row.outcome,
      reason: row.reason, status: row.status, createdAt: row.created_at,
      approvedAt: row.approved_at, approvedBy: row.approved_by };
  }

  function addKnowledge(input) {
    const tenantId = required(input.tenantId, "tenantId");
    const actorId = required(input.actorId, "actorId");
    const kind = required(input.kind, "kind", 32);
    if (!["product_fact","policy","style","faq"].includes(kind)) throw new Error("Unsupported knowledge kind");
    const id = required(input.id || require("node:crypto").randomUUID(), "id");
    const title = required(input.title, "title", 160);
    const body = required(input.body, "body", 8000);
    const source = required(input.source || "seller_input", "source", 80);
    const createdAt = now();
    transaction(() => {
      db.prepare(`INSERT INTO seller_knowledge
        (id,tenant_id,kind,title,body,source,status,version,created_at,updated_at)
        VALUES (?,?,?,?,?,?,'pending',1,?,?)`).run(id,tenantId,kind,title,body,source,createdAt,createdAt);
      audit(tenantId, actorId, "knowledge.created_pending", id, { kind, source });
    });
    return mapKnowledge(db.prepare("SELECT * FROM seller_knowledge WHERE tenant_id=? AND id=?").get(tenantId,id));
  }

  function updateKnowledge(input) {
    const tenantId = required(input.tenantId, "tenantId");
    const actorId = required(input.actorId, "actorId");
    const id = required(input.id, "id");
    const existing = db.prepare("SELECT * FROM seller_knowledge WHERE tenant_id=? AND id=?").get(tenantId,id);
    if (!existing) return null;
    const title = input.title == null ? existing.title : required(input.title,"title",160);
    const body = input.body == null ? existing.body : required(input.body,"body",8000);
    const source = input.source == null ? existing.source : required(input.source,"source",80);
    transaction(() => {
      db.prepare(`UPDATE seller_knowledge SET title=?,body=?,source=?,status='pending',
        version=version+1,updated_at=?,approved_at=NULL,approved_by=NULL
        WHERE tenant_id=? AND id=?`).run(title,body,source,now(),tenantId,id);
      audit(tenantId,actorId,"knowledge.updated_pending",id,{version:existing.version+1});
    });
    return mapKnowledge(db.prepare("SELECT * FROM seller_knowledge WHERE tenant_id=? AND id=?").get(tenantId,id));
  }

  function reviewKnowledge({ tenantId, actorId, id, decision }) {
    tenantId = required(tenantId,"tenantId"); actorId = required(actorId,"actorId"); id = required(id,"id");
    if (!["approved","rejected"].includes(decision)) throw new Error("Invalid review decision");
    const row = db.prepare("SELECT * FROM seller_knowledge WHERE tenant_id=? AND id=?").get(tenantId,id);
    if (!row) return null;
    const approvedAt = decision === "approved" ? now() : null;
    transaction(() => {
      db.prepare("UPDATE seller_knowledge SET status=?,approved_at=?,approved_by=?,updated_at=? WHERE tenant_id=? AND id=?")
        .run(decision,approvedAt,decision==="approved"?actorId:null,now(),tenantId,id);
      audit(tenantId,actorId,"knowledge."+decision,id,{});
    });
    return mapKnowledge(db.prepare("SELECT * FROM seller_knowledge WHERE tenant_id=? AND id=?").get(tenantId,id));
  }

  function addPracticeExample(input) {
    const tenantId = required(input.tenantId,"tenantId");
    const actorId = required(input.actorId,"actorId");
    const id = required(input.id || require("node:crypto").randomUUID(),"id");
    const customerContext = required(input.customerContext,"customerContext",4000);
    const aiDraft = required(input.aiDraft,"aiDraft",4096);
    const sellerFinal = required(input.sellerFinal,"sellerFinal",4096);
    const outcome = required(input.outcome || "edited","outcome",32);
    if (!["approved","edited","rejected","converted","not_converted"].includes(outcome)) throw new Error("Invalid outcome");
    const reason = String(input.reason || "").trim().slice(0,1000);
    const createdAt = now();
    transaction(() => {
      db.prepare(`INSERT INTO seller_practice_examples
        (id,tenant_id,customer_context,ai_draft,seller_final,outcome,reason,status,created_at)
        VALUES (?,?,?,?,?,?,?,'pending',?)`)
        .run(id,tenantId,customerContext,aiDraft,sellerFinal,outcome,reason,createdAt);
      audit(tenantId,actorId,"practice.created_pending",id,{outcome});
    });
    return mapExample(db.prepare("SELECT * FROM seller_practice_examples WHERE tenant_id=? AND id=?").get(tenantId,id));
  }

  function reviewExample({ tenantId, actorId, id, decision }) {
    tenantId = required(tenantId,"tenantId"); actorId = required(actorId,"actorId"); id = required(id,"id");
    if (!["approved","rejected"].includes(decision)) throw new Error("Invalid review decision");
    const row = db.prepare("SELECT * FROM seller_practice_examples WHERE tenant_id=? AND id=?").get(tenantId,id);
    if (!row) return null;
    transaction(() => {
      db.prepare("UPDATE seller_practice_examples SET status=?,approved_at=?,approved_by=? WHERE tenant_id=? AND id=?")
        .run(decision,decision==="approved"?now():null,decision==="approved"?actorId:null,tenantId,id);
      audit(tenantId,actorId,"practice."+decision,id,{});
    });
    return mapExample(db.prepare("SELECT * FROM seller_practice_examples WHERE tenant_id=? AND id=?").get(tenantId,id));
  }

  function tokens(text) {
    return [...new Set(String(text || "").toLowerCase().match(/[a-zа-яё0-9]{2,}/giu) || [])];
  }
  function retrieve({ tenantId, query, limit = 8 }) {
    tenantId = required(tenantId,"tenantId");
    const q = tokens(required(query,"query",4000));
    const take = Math.max(1,Math.min(Number(limit)||8,20));
    const knowledge = db.prepare("SELECT * FROM seller_knowledge WHERE tenant_id=? AND status='approved' ORDER BY updated_at DESC LIMIT 300").all(tenantId);
    const examples = db.prepare("SELECT * FROM seller_practice_examples WHERE tenant_id=? AND status='approved' ORDER BY created_at DESC LIMIT 300").all(tenantId);
    const rank = (text) => {
      const words = tokens(text);
      if (!q.length) return 0;
      const set = new Set(words);
      return q.reduce((score,word)=>score+(set.has(word)?1:0),0) / q.length;
    };
    const items = [
      ...knowledge.map(row=>({type:"knowledge",record:mapKnowledge(row),score:rank(row.title+" "+row.body)})),
      ...examples.map(row=>({type:"practice",record:mapExample(row),score:rank(row.customer_context+" "+row.seller_final)}))
    ].filter(x=>x.score>0).sort((a,b)=>b.score-a.score || String(b.record.updatedAt||b.record.createdAt).localeCompare(String(a.record.updatedAt||a.record.createdAt)));
    return items.slice(0,take);
  }

  function listAudit({ tenantId, limit = 100 }) {
    tenantId = required(tenantId,"tenantId");
    return db.prepare("SELECT * FROM seller_learning_audit WHERE tenant_id=? ORDER BY id DESC LIMIT ?")
      .all(tenantId,Math.max(1,Math.min(Number(limit)||100,500)))
      .map(row=>({id:row.id,tenantId:row.tenant_id,actorId:row.actor_id,action:row.action,recordId:row.record_id,createdAt:row.created_at,details:JSON.parse(row.details)}));
  }

  function close() { db.close(); }
  return { addKnowledge, updateKnowledge, reviewKnowledge, addPracticeExample, reviewExample, retrieve, listAudit, close };
}

const defaultStore = createSellerLearningStore();
module.exports = { createSellerLearningStore, ...defaultStore };
