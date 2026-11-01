"use strict";

const crypto = require("node:crypto");
const dns = require("node:dns").promises;
const express = require("express");
const { auth, seo, crawler } = require("./index");

function tokenHash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
function createEvolutionRouter({ store, sessionSecret, sessionTtlSeconds = 3600, now = () => Math.floor(Date.now() / 1000) }) {
  if (!store || typeof store.createAccount !== "function" || typeof store.getActiveSession !== "function") throw new Error("evolution_store_contract_invalid");
  if (typeof sessionSecret !== "string" || sessionSecret.length < 32) throw new Error("evolution_session_secret_must_be_at_least_32_chars");
  const router = express.Router();
  const issueToken = id => auth.issueSessionToken({ subject: id, secret: sessionSecret, ttlSeconds: sessionTtlSeconds, now: now() });

  async function requireSession(req, res, next) {
    const match = /^Bearer\s+(.+)$/i.exec(String(req.get("Authorization") || ""));
    if (!match) return res.status(401).json({ ok: false, error: "AUTH_REQUIRED", requestId: req.requestId });
    const claims = auth.verifySessionToken(match[1], { secret: sessionSecret, now: now() });
    if (!claims) return res.status(401).json({ ok: false, error: "INVALID_SESSION", requestId: req.requestId });
    try {
      const session = await store.getActiveSession(tokenHash(match[1]));
      if (!session || session.id !== claims.subject) return res.status(401).json({ ok: false, error: "SESSION_REVOKED", requestId: req.requestId });
      req.evolution = { session };
      return next();
    } catch (error) { return next(error); }
  }

  router.post("/auth/register", async (req, res, next) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase();
      const password = req.body?.password;
      const workspaceName = String(req.body?.workspaceName || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) return res.status(400).json({ ok: false, error: "VALID_EMAIL_REQUIRED", requestId: req.requestId });
      if (typeof password !== "string" || password.length < 12 || password.length > 256) return res.status(400).json({ ok: false, error: "PASSWORD_POLICY", requestId: req.requestId });
      if (!workspaceName || workspaceName.length > 100) return res.status(400).json({ ok: false, error: "WORKSPACE_NAME_REQUIRED", requestId: req.requestId });
      const passwordHash = await auth.hashPassword(password);
      const userId = crypto.randomUUID(), workspaceId = crypto.randomUUID(), sessionId = crypto.randomUUID();
      const token = issueToken(sessionId);
      const result = await store.createAccount({
        userId, workspaceId, sessionId, email, passwordHash, workspaceName,
        tokenHash: tokenHash(token), expiresAt: new Date((now() + sessionTtlSeconds) * 1000)
      });
      return res.status(201).json({ ok: true, token, tokenType: "Bearer", expiresIn: sessionTtlSeconds, user: result.user, workspace: result.workspace, requestId: req.requestId });
    } catch (error) {
      if (error.code === "EMAIL_ALREADY_EXISTS" || error.code === "23505") return res.status(409).json({ ok: false, error: "EMAIL_ALREADY_EXISTS", requestId: req.requestId });
      return next(error);
    }
  });

  router.post("/auth/login", async (req, res, next) => {
    try {
      const email = String(req.body?.email || "").trim().toLowerCase(), password = req.body?.password;
      if (!email || typeof password !== "string") return res.status(400).json({ ok: false, error: "CREDENTIALS_REQUIRED", requestId: req.requestId });
      const user = await store.findUserByEmail(email);
      if (!user || user.status !== "active" || !(await auth.verifyPassword(password, user.password_hash))) return res.status(401).json({ ok: false, error: "INVALID_CREDENTIALS", requestId: req.requestId });
      const memberships = await store.listMemberships(user.id);
      const requested = String(req.body?.workspaceId || "");
      const membership = requested ? memberships.find(x => x.workspace_id === requested) : memberships.length === 1 ? memberships[0] : null;
      if (!membership) return res.status(400).json({ ok: false, error: "VALID_WORKSPACE_ID_REQUIRED", requestId: req.requestId });
      const sessionId = crypto.randomUUID(), token = issueToken(sessionId);
      await store.createSession({ id: sessionId, userId: user.id, workspaceId: membership.workspace_id, tokenHash: tokenHash(token), expiresAt: new Date((now() + sessionTtlSeconds) * 1000) });
      return res.json({ ok: true, token, tokenType: "Bearer", expiresIn: sessionTtlSeconds, user: { id: user.id, email: user.email }, workspace: { id: membership.workspace_id, role: membership.role }, requestId: req.requestId });
    } catch (error) { return next(error); }
  });

  router.get("/me", requireSession, async (req, res, next) => {
    try {
      const s = req.evolution.session;
      const membership = await store.getMembership({ workspaceId: s.workspace_id, userId: s.user_id });
      if (!membership) return res.status(403).json({ ok: false, error: "WORKSPACE_ACCESS_DENIED", requestId: req.requestId });
      return res.json({ ok: true, userId: s.user_id, workspaceId: membership.workspace_id, role: membership.role, requestId: req.requestId });
    } catch (error) { return next(error); }
  });

  router.post("/auth/logout", requireSession, async (req, res, next) => {
    try {
      const s = req.evolution.session;
      await store.revokeSession(s.id, s.user_id);
      return res.json({ ok: true, revoked: true, requestId: req.requestId });
    } catch (error) { return next(error); }
  });

  router.get("/sites", requireSession, async (req, res, next) => {
    try {
      const s = req.evolution.session;
      const sites = await store.listSites({ workspaceId: s.workspace_id, userId: s.user_id });
      return res.json({ ok: true, sites, requestId: req.requestId });
    } catch (error) { return next(error); }
  });

  router.post("/sites", requireSession, async (req, res, next) => {
    try {
      const origin = seo.normalizeWebsite(req.body?.url);
      const verificationToken = crypto.randomBytes(24).toString("hex"), s = req.evolution.session;
      const site = await store.createSite({ id: crypto.randomUUID(), workspaceId: s.workspace_id, userId: s.user_id, origin, verificationToken });
      return res.status(201).json({
        ok: true, site,
        verification: {
          status: "pending", dnsRecordType: "TXT",
          dnsRecordName: "_samurai-verification." + new URL(origin).hostname,
          dnsRecordValue: "samurai-verification=" + verificationToken
        },
        requestId: req.requestId
      });
    } catch (error) {
      if (/valid_website_url_required|http_or_https_required|url_credentials_not_allowed|ip_literal_targets_not_allowed|local_hosts_not_allowed/.test(error.message)) return res.status(400).json({ ok: false, error: error.message.toUpperCase(), requestId: req.requestId });
      return next(error);
    }
  });

  router.post("/sites/:id/verify", requireSession, async (req, res, next) => {
    try {
      const s = req.evolution.session;
      const site = await store.getSite({ id: req.params.id, workspaceId: s.workspace_id, userId: s.user_id });
      if (!site) return res.status(404).json({ ok: false, error: "SITE_NOT_FOUND", requestId: req.requestId });
      if (site.verification_status === "verified") return res.json({ ok: true, verified: true, requestId: req.requestId });
      let records = [];
      try { records = (await dns.resolveTxt("_samurai-verification." + new URL(site.origin).hostname)).flat(); } catch {}
      if (!records.includes("samurai-verification=" + site.verification_token)) return res.status(409).json({ ok: false, error: "DNS_VERIFICATION_PENDING", requestId: req.requestId });
      const verified = await store.markSiteVerified({ id: site.id, workspaceId: s.workspace_id, userId: s.user_id });
      return res.json({ ok: true, verified, requestId: req.requestId });
    } catch (error) { return next(error); }
  });

  router.post("/sites/:id/audits", requireSession, async (req, res, next) => {
    try {
      const s = req.evolution.session;
      const site = await store.getSite({ id: req.params.id, workspaceId: s.workspace_id, userId: s.user_id });
      if (!site) return res.status(404).json({ ok: false, error: "SITE_NOT_FOUND", requestId: req.requestId });
      if (site.verification_status !== "verified") return res.status(409).json({ ok: false, error: "SITE_OWNERSHIP_NOT_VERIFIED", requestId: req.requestId });
      const page = await crawler.fetchPublicPage(site.origin);
      const title = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(page.body);
      const description = /<meta\b(?=[^>]*\bname\s*=\s*["']description["'])(?=[^>]*\bcontent\s*=\s*["']([^"']*)["'])[^>]*>/i.exec(page.body);
      const h1Count = (page.body.match(/<h1\b/gi) || []).length;
      const titlePresent = Boolean(title && title[1].replace(/<[^>]*>/g, "").trim());
      const descriptionPresent = Boolean(description && String(description[1] || "").trim());
      const findings = [];
      if (!titlePresent) findings.push({ code: "TITLE_MISSING", severity: "high" });
      if (!descriptionPresent) findings.push({ code: "META_DESCRIPTION_MISSING", severity: "medium" });
      if (!h1Count) findings.push({ code: "H1_MISSING", severity: "medium" });
      if (h1Count > 1) findings.push({ code: "MULTIPLE_H1", severity: "low", count: h1Count });
      const observedAt = new Date().toISOString();
      const evidence = [
        { id: crypto.randomUUID(), kind: "HTTP_RESPONSE", source: "public-page-crawler", payload: { statusCode: page.statusCode, contentType: page.contentType, bytes: page.bytes, url: page.url }, observedAt },
        { id: crypto.randomUUID(), kind: "TITLE", source: "public-page-crawler", payload: { present: titlePresent }, observedAt },
        { id: crypto.randomUUID(), kind: "META_DESCRIPTION", source: "public-page-crawler", payload: { present: descriptionPresent }, observedAt },
        { id: crypto.randomUUID(), kind: "H1_COUNT", source: "public-page-crawler", payload: { count: h1Count }, observedAt }
      ];
      const audit = await store.createAuditWithEvidence({ id: crypto.randomUUID(), siteId: site.id, workspaceId: s.workspace_id, userId: s.user_id, evidence, findings });
      return res.status(201).json({ ok: true, audit: { ...audit, findings, score: null, scoreStatus: "NOT_COMPUTED" }, note: "Single-page technical checks only. No rankings, traffic, Search Console metrics, or overall SEO score are inferred.", requestId: req.requestId });
    } catch (error) {
      const status = error.code === "REQUEST_TIMEOUT" ? 504 : ["DNS_PRIVATE_ADDRESS", "IP_LITERAL_BLOCKED", "HOST_BLOCKED"].includes(error.code) ? 400 : error.code === "UPSTREAM_HTTP_ERROR" ? 502 : 500;
      if (status === 500) return next(error);
      return res.status(status).json({ ok: false, error: error.code || "CRAWL_FAILED", requestId: req.requestId });
    }
  });

  router.use((error, req, res, _next) => {
    console.error(JSON.stringify({ event: "evolution_route_error", requestId: req.requestId, code: error.code || "INTERNAL_ERROR" }));
    return res.status(500).json({ ok: false, error: "EVOLUTION_INTERNAL_ERROR", requestId: req.requestId });
  });
  return router;
}

module.exports = { createEvolutionRouter, tokenHash };
