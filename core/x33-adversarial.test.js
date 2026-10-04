"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { X33EconomicConsistency, Err, STATUS, MODE } = require("./x33-economic-consistency");

const DATABASE_URL = process.env.DATABASE_URL || "";
const integration = Boolean(DATABASE_URL);

test("X33 adversarial PostgreSQL suite", { skip: !integration }, async () => {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: DATABASE_URL, max: 12 });
  const tenant = "x33_adversarial_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  const schema = fs.readFileSync(path.join(__dirname, "x33-schema.sql"), "utf8");

  await pool.query(schema);
  await pool.query(
    "INSERT INTO tenant_control_state (tenant_id, autonomy_mode) VALUES ($1,'ACTIVE')",
    [tenant]
  );
  await pool.query(
    "INSERT INTO tenant_budgets (tenant_id,budget_limit_micro_kzt,window_reset_at) VALUES ($1,$2,NOW()+3600*INTERVAL '1 second')",
    [tenant, "10000000"]
  );

  const engine = new X33EconomicConsistency(pool, { maxReservationTtlMs: 1000 });

  try {
    const reservations = await Promise.all(
      Array.from({ length: 8 }, () =>
        engine.reserve({}, {
          tenantId: tenant,
          eventId: "same-event",
          estimateMicro: "1000000",
          ttlMs: 500
        })
      )
    );

    assert.equal(reservations.filter(x => !x.idempotentReplay).length, 1);
    assert.equal(reservations.filter(x => x.idempotentReplay).length, 7);

    await assert.rejects(
      () => engine.reserve({}, {
        tenantId: tenant,
        eventId: "same-event",
        estimateMicro: "2000000",
        ttlMs: 500
      }),
      error => error && error.code === Err.IDEMPOTENCY_CONFLICT
    );

    const reservationId = reservations[0].reservationId;
    const settlements = await Promise.all(
      Array.from({ length: 8 }, () => engine.settle({}, reservationId, "700000"))
    );

    assert.equal(settlements.filter(x => !x.idempotentReplay).length, 1);
    assert.equal(settlements.filter(x => x.idempotentReplay).length, 7);

    const budget = await pool.query(
      "SELECT spent_micro_kzt,committed_micro_kzt,unbudgeted_actual_micro_kzt FROM tenant_budgets WHERE tenant_id=$1",
      [tenant]
    );
    assert.deepEqual(budget.rows[0], {
      spent_micro_kzt: "700000",
      committed_micro_kzt: "0",
      unbudgeted_actual_micro_kzt: "0"
    });

    const exp = await engine.reserve({}, {
      tenantId: tenant,
      eventId: "expiry-race",
      estimateMicro: "1000000",
      ttlMs: 100
    });
    await new Promise(resolve => setTimeout(resolve, 140));

    await Promise.allSettled([
      engine.expireSweep({}, { limit: 100 }),
      engine.settle({}, exp.reservationId, "900000")
    ]);

    const audit = await engine.auditTenantIntegrity({}, tenant);
    assert.equal(audit.ok, true);

    const final = await pool.query(
      "SELECT status::text AS status FROM tenant_reservations WHERE reservation_id=$1",
      [exp.reservationId]
    );
    assert.ok(
      [STATUS.EXPIRED, STATUS.SETTLED_AFTER_EXPIRY].includes(final.rows[0].status)
    );

    if (final.rows[0].status === STATUS.SETTLED_AFTER_EXPIRY) {
      const control = await pool.query(
        "SELECT autonomy_mode::text AS autonomy_mode FROM tenant_control_state WHERE tenant_id=$1",
        [tenant]
      );
      assert.equal(control.rows[0].autonomy_mode, MODE.TRIPPED);
    }

    const before = await pool.query(
      "SELECT spent_micro_kzt,committed_micro_kzt,unbudgeted_actual_micro_kzt,version FROM tenant_budgets WHERE tenant_id=$1",
      [tenant]
    );

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "UPDATE tenant_budgets SET spent_micro_kzt=spent_micro_kzt+999999 WHERE tenant_id=$1",
        [tenant]
      );
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    const after = await pool.query(
      "SELECT spent_micro_kzt,committed_micro_kzt,unbudgeted_actual_micro_kzt,version FROM tenant_budgets WHERE tenant_id=$1",
      [tenant]
    );
    assert.deepEqual(after.rows[0], before.rows[0]);
  } finally {
    await pool.query("DELETE FROM economic_ledger WHERE tenant_id=$1", [tenant]);
    await pool.query("DELETE FROM tenant_reservations WHERE tenant_id=$1", [tenant]);
    await pool.query("DELETE FROM tenant_budgets WHERE tenant_id=$1", [tenant]);
    await pool.query("DELETE FROM tenant_control_state WHERE tenant_id=$1", [tenant]);
    await pool.end();
  }
});
