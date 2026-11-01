"use strict";

// PostgreSQL adapter. The caller must inject a configured pg Pool; this module never
// creates connections, applies migrations, or chooses credentials implicitly.
function createPostgresStore(pool) {
  if (!pool || typeof pool.connect !== "function" || typeof pool.query !== "function") {
    throw new Error("postgres_pool_required");
  }

  async function transaction(work) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await work(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  return {
    transaction,
    async ping() {
      const result = await pool.query("SELECT 1 AS ok");
      return result.rows[0]?.ok === 1;
    },
    async createWorkspace({ userId, workspaceId, name }) {
      if (!userId || !workspaceId || !String(name || "").trim()) throw new Error("workspace_fields_required");
      return transaction(async client => {
        await client.query(
          "INSERT INTO ev3_workspaces (id, name, owner_user_id) VALUES ($1, $2, $3)",
          [workspaceId, String(name).trim(), userId]
        );
        await client.query(
          "INSERT INTO ev3_memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')",
          [workspaceId, userId]
        );
        return { id: workspaceId, name: String(name).trim(), ownerUserId: userId };
      });
    },
    async getMembership({ workspaceId, userId }) {
      const result = await pool.query(
        "SELECT workspace_id, user_id, role FROM ev3_memberships WHERE workspace_id = $1 AND user_id = $2",
        [workspaceId, userId]
      );
      return result.rows[0] || null;
    },
    async listSites({ workspaceId, userId }) {
      const result = await pool.query(
        "SELECT s.id, s.origin, s.verification_status, s.created_at FROM ev3_sites s " +
        "JOIN ev3_memberships m ON m.workspace_id = s.workspace_id " +
        "WHERE s.workspace_id = $1 AND m.user_id = $2 ORDER BY s.created_at DESC",
        [workspaceId, userId]
      );
      return result.rows;
    },
    async createSite({ id, workspaceId, userId, origin }) {
      const result = await pool.query(
        "INSERT INTO ev3_sites (id, workspace_id, origin) " +
        "SELECT $1, m.workspace_id, $4 FROM ev3_memberships m " +
        "WHERE m.workspace_id = $2 AND m.user_id = $3 AND m.role IN ('owner','admin','member') " +
        "RETURNING id, workspace_id, origin, verification_status, created_at",
        [id, workspaceId, userId, origin]
      );
      if (!result.rows[0]) throw Object.assign(new Error("workspace_access_denied"), { code: "WORKSPACE_ACCESS_DENIED" });
      return result.rows[0];
    },
    async createSession({ id, userId, workspaceId, tokenHash, expiresAt }) {
      const result = await pool.query(
        "INSERT INTO ev3_sessions (id, user_id, workspace_id, token_hash, expires_at) " +
        "SELECT $1, $2, m.workspace_id, $4, $5 FROM ev3_memberships m " +
        "JOIN ev3_users u ON u.id = m.user_id AND u.status = 'active' " +
        "WHERE m.workspace_id = $3 AND m.user_id = $2 RETURNING id, user_id, workspace_id, expires_at",
        [id, userId, workspaceId, tokenHash, expiresAt]
      );
      if (!result.rows[0]) throw Object.assign(new Error("workspace_access_denied"), { code: "WORKSPACE_ACCESS_DENIED" });
      return result.rows[0];
    },
    async getActiveSession(tokenHash) {
      const result = await pool.query(
        "SELECT s.id, s.user_id, s.workspace_id, s.expires_at FROM ev3_sessions s " +
        "JOIN ev3_users u ON u.id = s.user_id AND u.status = 'active' " +
        "WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now()",
        [tokenHash]
      );
      return result.rows[0] || null;
    },
    async revokeSession(id, userId) {
      const result = await pool.query(
        "UPDATE ev3_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id",
        [id, userId]
      );
      return result.rowCount === 1;
    },
    async claim(eventId, eventType = "unknown") {
      const result = await pool.query(
        "INSERT INTO ev3_stripe_events (event_id, event_type, status, attempts, lease_until) " +
        "VALUES ($1, $2, 'processing', 1, now() + interval '2 minutes') " +
        "ON CONFLICT (event_id) DO UPDATE SET status = 'processing', attempts = ev3_stripe_events.attempts + 1, " +
        "lease_until = now() + interval '2 minutes', last_error = NULL " +
        "WHERE ev3_stripe_events.status = 'failed' OR " +
        "(ev3_stripe_events.status = 'processing' AND ev3_stripe_events.lease_until < now()) " +
        "RETURNING event_id",
        [eventId, eventType]
      );
      return { claimed: result.rowCount === 1 };
    },
    async complete(eventId) {
      await pool.query(
        "UPDATE ev3_stripe_events SET status = 'completed', completed_at = now(), lease_until = NULL, last_error = NULL WHERE event_id = $1",
        [eventId]
      );
    },
    async fail(eventId, message) {
      await pool.query(
        "UPDATE ev3_stripe_events SET status = 'failed', lease_until = NULL, last_error = $2 WHERE event_id = $1",
        [eventId, String(message || "unknown").slice(0, 500)]
      );
    }
  };
}

module.exports = { createPostgresStore };
