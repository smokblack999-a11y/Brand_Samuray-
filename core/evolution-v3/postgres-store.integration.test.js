"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const databaseUrl = String(process.env.EVOLUTION_TEST_DATABASE_URL || "").trim();

test("PostgreSQL adapter persists tenant data, enforces membership, revokes sessions, and claims Stripe events", {
  skip: !databaseUrl && "EVOLUTION_TEST_DATABASE_URL is not configured"
}, async t => {
  const { Pool } = require("pg");
  const { createPostgresStore } = require("./postgres-store");
  const pool = new Pool({ connectionString: databaseUrl, max: 4, connectionTimeoutMillis: 5000 });
  const store = createPostgresStore(pool);

  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const outsiderId = crypto.randomUUID();
  const outsiderWorkspaceId = crypto.randomUUID();
  const outsiderSessionId = crypto.randomUUID();
  const siteId = crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const evidenceId = crypto.randomUUID();
  const tokenHash = crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex");
  const outsiderTokenHash = crypto.createHash("sha256").update(crypto.randomBytes(32)).digest("hex");
  const eventId = "integration_" + crypto.randomUUID();
  const email = "integration-" + userId + "@example.invalid";
  const outsiderEmail = "integration-" + outsiderId + "@example.invalid";

  t.after(async () => {
    try {
      await pool.query("DELETE FROM ev3_stripe_events WHERE event_id = $1", [eventId]);
      await pool.query("DELETE FROM ev3_audit_log WHERE workspace_id = ANY($1::uuid[])", [[workspaceId, outsiderWorkspaceId]]);
      await pool.query("DELETE FROM ev3_workspaces WHERE id = ANY($1::uuid[])", [[workspaceId, outsiderWorkspaceId]]);
      await pool.query("DELETE FROM ev3_users WHERE id = ANY($1::uuid[])", [[userId, outsiderId]]);
    } finally {
      await pool.end();
    }
  });

  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
  await pool.query(schema);
  assert.equal(await store.ping(), true);

  const expiresAt = new Date(Date.now() + 60_000);
  const created = await store.createAccount({
    userId, workspaceId, sessionId, email, passwordHash: "integration-test-hash",
    workspaceName: "Integration workspace", tokenHash, expiresAt
  });
  assert.equal(created.user.id, userId);
  assert.equal((await store.getActiveSession(tokenHash)).id, sessionId);
  assert.equal((await store.getMembership({ workspaceId, userId })).role, "owner");

  await store.createAccount({
    userId: outsiderId, workspaceId: outsiderWorkspaceId, sessionId: outsiderSessionId,
    email: outsiderEmail, passwordHash: "integration-test-hash",
    workspaceName: "Outsider workspace", tokenHash: outsiderTokenHash, expiresAt
  });

  const site = await store.createSite({
    id: siteId, workspaceId, userId, origin: "https://example.com",
    verificationToken: "samurai-" + crypto.randomUUID()
  });
  assert.equal(site.verification_status, "pending");
  assert.equal(await store.getSite({ id: siteId, workspaceId: outsiderWorkspaceId, userId: outsiderId }), null);

  const verified = await store.markSiteVerified({ id: siteId, workspaceId, userId });
  assert.equal(verified.verification_status, "verified");
  assert.equal((await store.listSites({ workspaceId, userId })).length, 1);

  const audit = await store.createAuditWithEvidence({
    id: auditId, siteId, workspaceId, userId,
    evidence: [{
      id: evidenceId, kind: "http_status", source: "integration-test",
      payload: { status: 200 }, observedAt: new Date()
    }],
    findings: [{ id: "http_status" }]
  });
  assert.equal(audit.status, "completed");
  assert.equal(audit.evidenceCount, 1);

  assert.equal((await store.claim(eventId, "customer.subscription.updated")).claimed, true);
  assert.equal((await store.claim(eventId, "customer.subscription.updated")).claimed, false);
  await store.complete(eventId);
  assert.equal((await store.claim(eventId, "customer.subscription.updated")).claimed, false);

  assert.equal(await store.revokeSession(sessionId, userId), true);
  assert.equal(await store.getActiveSession(tokenHash), null);
});
