"use strict";

const crypto = require("node:crypto");

function canonical(record) {
  return JSON.stringify({
    tenantId: String(record.tenantId),
    decisionId: String(record.decisionId),
    claimHash: String(record.claimHash),
    policyVersion: String(record.policyVersion),
    decision: Boolean(record.decision),
    reason: String(record.reason),
    vetoLevel: String(record.vetoLevel),
    riskSizeMicro: String(record.riskSizeMicro),
    previousHash: record.previousHash || null,
    createdAt: new Date(record.createdAt).toISOString()
  });
}

function hashRecord(record) {
  return crypto.createHash("sha256")
    .update(String(record.previousHash || "") + "|" + canonical(record))
    .digest("hex");
}

async function ensureSchema(pool) {
  const fs = require("node:fs");
  const path = require("node:path");
  const schema = fs.readFileSync(path.join(__dirname, "x42-schema.sql"), "utf8");
  await pool.query(schema);
}

async function append(pool, record) {
  if (!record || !record.tenantId || !record.decisionId || !record.claimHash) {
    throw new Error("X42_INVALID_AUDIT_RECORD");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [String(record.tenantId)]
    );

    const duplicate = await client.query(
      "SELECT decision_id,record_hash FROM x42_veto_audit WHERE tenant_id=$1 AND decision_id=$2",
      [record.tenantId, record.decisionId]
    );
    if (duplicate.rowCount) {
      return { inserted: false, recordHash: duplicate.rows[0].record_hash };
    }

    const clock = await client.query("SELECT NOW() AS db_now");
    const createdAt = clock.rows[0].db_now;
    const previous = await client.query(
      "SELECT record_hash FROM x42_veto_audit WHERE tenant_id=$1 ORDER BY audit_id DESC LIMIT 1",
      [record.tenantId]
    );
    const sealed = {
      ...record,
      createdAt,
      previousHash: previous.rows[0]?.record_hash || null
    };
    sealed.recordHash = hashRecord(sealed);

    await client.query(
      "INSERT INTO x42_veto_audit (tenant_id,decision_id,claim_hash,policy_version,decision,reason,veto_level,risk_size_micro,previous_hash,record_hash,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)",
      [
        sealed.tenantId, sealed.decisionId, sealed.claimHash, String(sealed.policyVersion),
        sealed.decision, sealed.reason, sealed.vetoLevel, String(sealed.riskSizeMicro),
        sealed.previousHash, sealed.recordHash, sealed.createdAt
      ]
    );

    await client.query("COMMIT");
    return { inserted: true, recordHash: sealed.recordHash };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function integrity(pool, tenantId) {
  const rows = await pool.query(
    "SELECT tenant_id,decision_id,claim_hash,policy_version,decision,reason,veto_level,risk_size_micro,previous_hash,record_hash,created_at FROM x42_veto_audit WHERE tenant_id=$1 ORDER BY audit_id ASC",
    [tenantId]
  );

  let previous = null;
  for (const row of rows.rows) {
    const record = {
      tenantId: row.tenant_id,
      decisionId: row.decision_id,
      claimHash: row.claim_hash,
      policyVersion: row.policy_version,
      decision: row.decision,
      reason: row.reason,
      vetoLevel: row.veto_level,
      riskSizeMicro: row.risk_size_micro,
      previousHash: row.previous_hash,
      createdAt: row.created_at
    };
    if ((row.previous_hash || null) !== (previous || null)) {
      return { ok: false, reason: "PREVIOUS_HASH_MISMATCH" };
    }
    if (hashRecord(record) !== row.record_hash) {
      return { ok: false, reason: "RECORD_HASH_MISMATCH" };
    }
    previous = row.record_hash;
  }

  return { ok: true, records: rows.rowCount, lastHash: previous };
}

module.exports = { canonical, hashRecord, ensureSchema, append, integrity };
