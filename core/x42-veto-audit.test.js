"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const enabled = Boolean(process.env.DATABASE_URL);

test("X42 PostgreSQL audit is append-only and idempotent", { skip: !enabled }, async () => {
  const { Pool } = require("pg");
  const audit = require("./x42-veto-audit");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  const tenant = "x42_" + Date.now();

  try {
    await audit.ensureSchema(pool);

    const record = {
      tenantId: tenant,
      decisionId: "decision-1",
      claimHash: "claimhash",
      policyVersion: "7",
      decision: false,
      reason: "RISK_SCORE_EXCEEDED",
      vetoLevel: "RED",
      riskSizeMicro: "0",
      createdAt: new Date("2026-10-05T00:00:00Z")
    };

    const first = await audit.append(pool, record);
    const second = await audit.append(pool, record);
    assert.equal(first.inserted, true);
    assert.equal(second.inserted, false);

    const checked = await audit.integrity(pool, tenant);
    assert.equal(checked.ok, true);
    assert.equal(checked.records, 1);

    await assert.rejects(
      pool.query("UPDATE x42_veto_audit SET reason='TAMPERED' WHERE tenant_id=$1", [tenant]),
      /append-only/
    );
  } finally {
    await pool.end();
  }
});
