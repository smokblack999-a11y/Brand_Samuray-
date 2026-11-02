"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const crypto = require("node:crypto");
const { createEvolutionRouter, tokenHash } = require("./http");

function memoryStore() {
  const users = new Map(), sessions = new Map(), memberships = new Map(), sites = new Map();
  return {
    async createAccount(input) {
      if ([...users.values()].some(user => user.email === input.email)) throw Object.assign(new Error("duplicate"), { code: "EMAIL_ALREADY_EXISTS" });
      const user = { id: input.userId, email: input.email, password_hash: input.passwordHash, status: "active" };
      users.set(user.id, user);
      memberships.set(input.workspaceId + ":" + user.id, { workspace_id: input.workspaceId, user_id: user.id, role: "owner" });
      sessions.set(input.tokenHash, { id: input.sessionId, user_id: user.id, workspace_id: input.workspaceId, expires_at: input.expiresAt, revoked_at: null });
      return { user: { id: user.id, email: user.email }, workspace: { id: input.workspaceId, name: input.workspaceName } };
    },
    async findUserByEmail(email) { return [...users.values()].find(user => user.email === email) || null; },
    async listMemberships(userId) { return [...memberships.values()].filter(item => item.user_id === userId); },
    async getMembership({ workspaceId, userId }) { return memberships.get(workspaceId + ":" + userId) || null; },
    async getActiveSession(hash) { const session = sessions.get(hash); return session && !session.revoked_at ? session : null; },
    async createSession(input) {
      if (!memberships.has(input.workspaceId + ":" + input.userId)) throw new Error("membership_required");
      sessions.set(input.tokenHash, { id: input.id, user_id: input.userId, workspace_id: input.workspaceId, expires_at: input.expiresAt, revoked_at: null });
    },
    async revokeSession(id, userId) {
      const entry = [...sessions.entries()].find(([, s]) => s.id === id && s.user_id === userId);
      if (!entry) return false;
      entry[1].revoked_at = new Date();
      return true;
    },
    async listSites() { return [...sites.values()]; },
    async createSite(input) {
      const site = { id: input.id, workspace_id: input.workspaceId, origin: input.origin, verification_status: "pending", verification_token: input.verificationToken };
      sites.set(site.id, site); return site;
    },
    async getSite({ id, workspaceId, userId }) {
      const site = sites.get(id);
      return site && site.workspace_id === workspaceId && memberships.has(workspaceId + ":" + userId) ? site : null;
    },
    async markSiteVerified({ id }) { const site = sites.get(id); site.verification_status = "verified"; return site; },
    async createAuditWithEvidence(input) { return { id: input.id, evidenceCount: input.evidence.length, status: "completed" }; }
  };
}

test("EVOLUTION HTTP registration creates a workspace and revocable Bearer session", async t => {
  const store = memoryStore();
  const app = express();
  app.use(express.json());
  app.use("/api/evolution", createEvolutionRouter({ store, sessionSecret: "test-secret-at-least-thirty-two-characters-long" }));
  const server = app.listen(0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api/evolution";

  const registration = await fetch(base + "/auth/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "owner@example.com", password: "correct horse battery staple", workspaceName: "Test workspace" })
  });
  assert.equal(registration.status, 201);
  const created = await registration.json();
  assert.equal(created.user.email, "owner@example.com");
  assert.ok(created.token);
  assert.equal(created.user.password_hash, undefined);

  const headers = { authorization: "Bearer " + created.token };
  const me = await fetch(base + "/me", { headers });
  assert.equal(me.status, 200);
  assert.equal((await me.json()).role, "owner");

  const logout = await fetch(base + "/auth/logout", { method: "POST", headers });
  assert.equal(logout.status, 200);
  const afterLogout = await fetch(base + "/me", { headers });
  assert.equal(afterLogout.status, 401);
});

test("EVOLUTION HTTP rejects short passwords and unauthenticated site access", async t => {
  const app = express();
  app.use(express.json());
  app.use("/api/evolution", createEvolutionRouter({ store: memoryStore(), sessionSecret: "test-secret-at-least-thirty-two-characters-long" }));
  const server = app.listen(0);
  t.after(() => new Promise(resolve => server.close(resolve)));
  await new Promise(resolve => server.once("listening", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/api/evolution";
  const bad = await fetch(base + "/auth/register", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "x@example.com", password: "short", workspaceName: "X" })
  });
  assert.equal(bad.status, 400);
  const sites = await fetch(base + "/sites");
  assert.equal(sites.status, 401);
});

test("token hash is stable and not the raw bearer token", () => {
  const token = crypto.randomBytes(32).toString("hex");
  assert.notEqual(tokenHash(token), token);
  assert.equal(tokenHash(token), tokenHash(token));
});
