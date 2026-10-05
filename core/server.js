"use strict";
require("dotenv").config();
const crypto = require("crypto");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { scoreLead } = require("./lead-engine");
const { generateReplyWithUsage, checkOpenAI } = require("./openai");
const { estimateKZT, ratesFromEnv } = require("./cost-model");
const { sendBusinessMessage } = require("./business-bot");
const telegramCamera = require("./telegram-camera");
const { saveLead, claimEvent, updateLead, listLeads, stats } = require("./store");
const { createRateLimiter } = require("./rate-limit");
const dualAI = require("./dual-ai/engine");
const revenueRuntime = require("./x27-runtime");
const revenueIngest = require("./revenue-ingest");
const { analyzeLeadLoss } = require("./x28-revenue-rca");
const { policy: revenueRolloutPolicy } = require("./revenue-rollout-policy");
const autonomousRevenueLoop = require("./autonomous-revenue-loop");
const revenueBridge = require("./revenue-integration-bridge");
const stripeWebhook = require("./stripe-webhook");
const apolloRevenue = require("./apollo-revenue-adapter");
const autonomousRevenueOrchestrator = require("./autonomous-revenue-orchestrator");

const app = express();
const PORT = Number(process.env.PORT || 8787);
const API_KEY = String(process.env.CORE_API_KEY || "").trim();
const WEBHOOK_SECRET = String(process.env.TELEGRAM_WEBHOOK_SECRET || "").trim();
const STRICT_TENANT_AUTH = String(process.env.STRICT_TENANT_AUTH || "false").toLowerCase() === "true";
const REVENUE_SHADOW_MODE = String(process.env.REVENUE_SHADOW_MODE || "false").toLowerCase() === "true";
const MAX_MESSAGE_CHARS = Math.max(100, Math.min(Number(process.env.MAX_MESSAGE_CHARS || 4000), 10000));
const CORS_ORIGIN = String(process.env.CORS_ORIGIN || "").trim();
const REQUEST_TIMEOUT_MS = Math.max(5000, Number(process.env.REQUEST_TIMEOUT_MS || 30000));
const LEAD_RATE_LIMIT_WINDOW_MS = Math.max(1000, Number(process.env.LEAD_RATE_LIMIT_WINDOW_MS || 60000));
const LEAD_RATE_LIMIT_MAX = Math.max(1, Number(process.env.LEAD_RATE_LIMIT_MAX || 20));

if (process.env.NODE_ENV === "production") {
  const missing = [];
  if (!API_KEY) missing.push("CORE_API_KEY");
  if (!WEBHOOK_SECRET) missing.push("TELEGRAM_WEBHOOK_SECRET");
  if (missing.length) throw new Error(`Production startup blocked: missing ${missing.join(", ")}`);
}

app.disable("x-powered-by");
app.set("trust proxy", process.env.TRUST_PROXY === "true" ? 1 : false);
app.use(cors(CORS_ORIGIN ? { origin: CORS_ORIGIN } : { origin: false }));
app.use(express.json({
  limit: "16mb",
  verify: (req, _res, buf) => {
    if (req.path === "/api/integrations/stripe/webhook") req.rawBody = Buffer.from(buf);
  }
}));

function errorBody(code, message, requestId) {
  return { ok: false, error: { code, message, requestId } };
}

function safeEqual(expected, actual) {
  const a = Buffer.from(String(expected || ""));
  const b = Buffer.from(String(actual || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function tenantBinding(req) {
  const raw = String(process.env.TENANT_API_KEYS_JSON || "").trim();
  if (!raw) return null;
  try {
    const bindings = JSON.parse(raw);
    if (!bindings || typeof bindings !== "object" || Array.isArray(bindings)) return null;
    const supplied = String(req.get("X-API-Key") || "");
    for (const [tenantId, key] of Object.entries(bindings)) {
      if (safeEqual(key, supplied)) return String(tenantId).slice(0, 128);
    }
    return null;
  } catch (_error) { return null; }
}
function requireApiKey(req, res, next) {
  if (!API_KEY && !process.env.TENANT_API_KEYS_JSON) return res.status(503).json(errorBody("AUTH_NOT_CONFIGURED", "API authentication is not configured", req.requestId));
  const supplied = req.get("X-API-Key");
  const validGlobal = API_KEY && safeEqual(API_KEY, supplied);
  const boundTenant = tenantBinding(req);
  if (!validGlobal && !boundTenant) return res.status(401).json(errorBody("UNAUTHORIZED", "Unauthorized", req.requestId));
  if (STRICT_TENANT_AUTH && !boundTenant) return res.status(403).json(errorBody("TENANT_BINDING_REQUIRED", "Tenant-bound API key required", req.requestId));
  req.tenantId = boundTenant || null;
  return next();
}
function telegramUser() { return require("./telegram"); }
function requireWebhookSecret(req, res, next) {
  if (!WEBHOOK_SECRET) return res.status(503).json(errorBody("WEBHOOK_AUTH_NOT_CONFIGURED", "Webhook authentication is not configured", req.requestId));
  if (safeEqual(WEBHOOK_SECRET, req.get("X-Telegram-Bot-Api-Secret-Token"))) return next();
  return res.status(401).json(errorBody("UNAUTHORIZED_WEBHOOK", "Unauthorized webhook", req.requestId));
}
function requestId(req, res, next) {
  const id = crypto.randomUUID();
  req.requestId = id;
  res.setHeader("X-Request-Id", id);
  next();
}
function revenueTenantId(req) {
  if (req.tenantId) return req.tenantId;
  return String(req.get("X-Tenant-Id") || process.env.TENANT_ID || "default").trim().slice(0, 128) || "default";
}

app.use(requestId);
app.use((req, res, next) => {
  const timer = setTimeout(() => {
    if (!res.headersSent) res.status(503).json(errorBody("REQUEST_TIMEOUT", "Request timed out", req.requestId));
  }, REQUEST_TIMEOUT_MS);
  res.on("finish", () => clearTimeout(timer));
  next();
});

const leadRateLimit = createRateLimiter({ windowMs: LEAD_RATE_LIMIT_WINDOW_MS, max: LEAD_RATE_LIMIT_MAX });
const stripeWebhookRateLimit = createRateLimiter({
  windowMs: Math.max(1000, Number(process.env.STRIPE_WEBHOOK_RATE_LIMIT_WINDOW_MS || 60000)),
  max: Math.max(10, Number(process.env.STRIPE_WEBHOOK_RATE_LIMIT_MAX || 300))
});
const dualRateLimit = createRateLimiter({ windowMs: Math.max(1000, Number(process.env.DUAL_AI_RATE_LIMIT_WINDOW_MS || 60000)), max: Math.max(1, Number(process.env.DUAL_AI_RATE_LIMIT_MAX || 10)) });
app.use("/dual-ai", express.static(path.join(__dirname, "dual-ai", "public"), { index: "index.html" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "SamuraiOS Core", version: "2.8.0", revenueEngine: "x27" }));
app.get("/ready", (req, res) => {
  try {
    const current = stats();
    const ready = Boolean(API_KEY && WEBHOOK_SECRET && current && Number.isFinite(current.total));
    return res.status(ready ? 200 : 503).json({ ok: ready, service: "SamuraiOS Core", ready, requestId: req.requestId });
  } catch (_error) {
    return res.status(503).json(errorBody("NOT_READY", "Service is not ready", req.requestId));
  }
});
app.get("/health/openai", requireApiKey, async (req, res) => {
  if (!process.env.OPENAI_API_KEY) return res.status(503).json({ ...errorBody("OPENAI_NOT_CONFIGURED", "OpenAI is not configured", req.requestId), configured: false });
  try {
    await checkOpenAI();
    return res.json({ ok: true, service: "openai", configured: true, requestId: req.requestId });
  } catch (error) {
    console.error(JSON.stringify({ event: "openai_health_failed", requestId: req.requestId, error: error.message }));
    return res.status(503).json(errorBody("OPENAI_UNAVAILABLE", "OpenAI service is unavailable", req.requestId));
  }
});
app.get("/api/leads", requireApiKey, (req, res) => res.json({ ok: true, leads: listLeads(req.query.limit), requestId: req.requestId }));
app.get("/api/stats", requireApiKey, (req, res) => res.json({ ok: true, stats: stats(), requestId: req.requestId }));

app.get("/api/revenue/genome", requireApiKey, (req, res) => {
  try {
    const genome = require("./revenue-genome").buildGenome(revenueRuntime.list(revenueTenantId(req), "LEARNING"));
    return res.json({ ok: true, genome, requestId: req.requestId });
  } catch (error) { return res.status(500).json(errorBody(error.code || "REVENUE_GENOME_FAILED", "Revenue genome failed", req.requestId)); }
});

app.get("/api/revenue/control-plane", requireApiKey, (req, res) => {
  try {
    const tenantId = revenueTenantId(req);
    const records = revenueRuntime.list(tenantId);
    const summary = revenueRuntime.summary(tenantId);
    const integrity = revenueRuntime.integrity(tenantId);
    const genome = require("./revenue-genome").buildGenome(records.filter(x => x.type === "LEARNING"));
    const controlPlane = require("./revenue-control-plane").buildControlPlane({ summary, records, integrity, genome });
    return res.json({ ok: true, controlPlane, requestId: req.requestId });
  } catch (error) { return res.status(500).json(errorBody(error.code || "REVENUE_CONTROL_PLANE_FAILED", "Revenue control plane failed", req.requestId)); }
});

app.get("/api/revenue/executions", requireApiKey, (req, res) => {
  try { return res.json({ ok: true, executions: revenueRuntime.list(revenueTenantId(req), "EXECUTION"), requestId: req.requestId }); }
  catch (error) { return res.status(500).json(errorBody(error.code || "REVENUE_EXECUTIONS_FAILED", "Revenue executions failed", req.requestId)); }
});
app.post("/api/integrations/revenue/cycle", requireApiKey, leadRateLimit, async (req, res) => {
  try {
    const result = await autonomousRevenueOrchestrator.runCycle({
      tenantId: revenueTenantId(req),
      filters: req.body?.filters || {},
      maxProspects: req.body?.maxProspects,
      enrich: req.body?.enrich !== false,
      dealValueKZT: req.body?.dealValueKZT,
      grossMarginRate: req.body?.grossMarginRate
    });
    return res.status(200).json({ ok: true, ...result, requestId: req.requestId });
  } catch (error) {
    const code = error.code || "AUTONOMOUS_REVENUE_CYCLE_FAILED";
    console.error(JSON.stringify({ event: "autonomous_revenue_cycle_failed", requestId: req.requestId, code, error: error.message }));
    return res.status(502).json(errorBody(code, "Autonomous revenue cycle failed", req.requestId));
  }
});

app.post("/api/integrations/apollo/discover", requireApiKey, leadRateLimit, async (req, res) => {
  try {
    const tenantId = revenueTenantId(req);
    const result = await apolloRevenue.discoverAndQualify({
      tenantId,
      filters: req.body?.filters || {},
      maxProspects: req.body?.maxProspects,
      enrich: req.body?.enrich !== false,
      dealValueKZT: req.body?.dealValueKZT,
      grossMarginRate: req.body?.grossMarginRate
    });
    return res.status(200).json({ ok: true, ...result, requestId: req.requestId });
  } catch (error) {
    const code = error.code || "APOLLO_DISCOVERY_FAILED";
    console.error(JSON.stringify({ event: "apollo_discovery_failed", requestId: req.requestId, code, error: error.message }));
    return res.status(502).json(errorBody(code, "Apollo discovery failed", req.requestId));
  }
});

app.post("/api/integrations/stripe/webhook", stripeWebhookRateLimit, async (req, res) => {
  try {
    const secret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
    if (!secret) return res.status(503).json(errorBody("STRIPE_WEBHOOK_NOT_CONFIGURED", "Stripe webhook secret is not configured", req.requestId));

    const valid = stripeWebhook.verifySignature(
      req.rawBody,
      req.get("Stripe-Signature"),
      secret,
      Math.max(0, Number(process.env.STRIPE_WEBHOOK_TOLERANCE_SEC || 300))
    );
    if (!valid) return res.status(401).json(errorBody("INVALID_STRIPE_SIGNATURE", "Invalid Stripe webhook signature", req.requestId));

    const normalized = stripeWebhook.normalizeStripeEvent(req.body || {}, {
      defaultTenantId: process.env.STRIPE_WEBHOOK_DEFAULT_TENANT_ID || process.env.TENANT_ID || "default",
      grossMarginRate: Number(process.env.DEFAULT_GROSS_MARGIN || 0)
    });
    if (normalized.ignored) {
      return res.status(200).json({ ok: true, ignored: true, reason: normalized.reason, eventId: normalized.eventId, eventType: normalized.eventType, requestId: req.requestId });
    }

    const result = revenueRuntime.recordOutcome(normalized.tenantId, normalized);

    let hubspotDeal = null;
    if (normalized.status === "WON") {
      try {
        hubspotDeal = await revenueBridge.syncHubSpotDeal({
          dealName: `SamuraiOS / ${normalized.externalReference || normalized.eventId}`,
          amountKZT: normalized.revenueKZT,
          closedAt: normalized.occurredAt,
          tenantId: normalized.tenantId,
          correlationId: normalized.correlationId || normalized.eventId,
          decisionId: normalized.actionId
        });
      } catch (crmError) {
        console.error(JSON.stringify({
          event: "stripe_hubspot_deal_sync_failed",
          requestId: req.requestId,
          stripeEventId: normalized.eventId,
          error: crmError.message
        }));
      }
    }

    try {
      await revenueBridge.recordRevenueEvent({
        type: `revenue_stripe_${normalized.status.toLowerCase()}`,
        tenantId: normalized.tenantId,
        correlationId: normalized.correlationId || normalized.eventId,
        payload: {
          stripe_event_id: normalized.eventId,
          stripe_event_type: normalized.eventType,
          status: normalized.status,
          revenue_kzt: normalized.revenueKZT,
          currency: normalized.currency,
          decision_id: normalized.actionId || null
        }
      });
    } catch (analyticsError) {
      console.error(JSON.stringify({
        event: "stripe_posthog_dispatch_failed",
        requestId: req.requestId,
        stripeEventId: normalized.eventId,
        error: analyticsError.message
      }));
    }

    return res.status(result.inserted ? 201 : 200).json({
      ok: true,
      inserted: result.inserted,
      eventId: normalized.eventId,
      eventType: normalized.eventType,
      outcome: result.outcome,
      learning: result.learning || null,
      hubspotDeal,
      requestId: req.requestId
    });
  } catch (error) {
    const code = error.code || "STRIPE_WEBHOOK_FAILED";
    const status = code === "STRIPE_FX_RATE_REQUIRED" ? 400 : (code === "STRIPE_WEBHOOK_NOT_CONFIGURED" ? 503 : 400);
    console.error(JSON.stringify({ event: "stripe_webhook_error", requestId: req.requestId, code, error: error.message }));
    return res.status(status).json(errorBody(code, status === 400 ? error.message : "Stripe webhook failed", req.requestId));
  }
});

app.get("/api/integrations/status", requireApiKey, (req, res) => {
  return res.json({ ok: true, integrations: revenueBridge.providerConfig(), requestId: req.requestId });
});

app.post("/api/integrations/lead/sync", requireApiKey, leadRateLimit, async (req, res) => {
  try {
    const tenantId = revenueTenantId(req);
    const result = await revenueBridge.syncLead({
      lead: req.body?.lead || req.body || {},
      tenantId,
      correlationId: req.body?.correlationId || req.requestId
    });
    return res.status(200).json({ ok: true, ...result, requestId: req.requestId });
  } catch (error) {
    return res.status(502).json(errorBody(error.code || "REVENUE_LEAD_SYNC_FAILED", "Revenue lead sync failed", req.requestId));
  }
});

app.post("/api/integrations/checkout", requireApiKey, leadRateLimit, async (req, res) => {
  try {
    const tenantId = revenueTenantId(req);
    const session = await revenueBridge.createStripeCheckout({
      amountMinor: req.body?.amountMinor,
      currency: req.body?.currency,
      productName: req.body?.productName,
      customerEmail: req.body?.customerEmail,
      correlationId: req.body?.correlationId || req.requestId,
      decisionId: req.body?.decisionId,
      tenantId
    });
    return res.status(201).json({ ok: true, session, requestId: req.requestId });
  } catch (error) {
    const status = /required|must be/i.test(String(error.message || "")) ? 400 : 502;
    return res.status(status).json(errorBody(error.code || "STRIPE_CHECKOUT_FAILED", status === 400 ? error.message : "Stripe checkout failed", req.requestId));
  }
});

app.post("/api/integrations/event", requireApiKey, leadRateLimit, async (req, res) => {
  try {
    const tenantId = revenueTenantId(req);
    const result = await revenueBridge.recordRevenueEvent({
      type: req.body?.type,
      tenantId,
      correlationId: req.body?.correlationId || req.requestId,
      payload: req.body?.payload || {}
    });
    return res.status(200).json({ ok: true, ...result, requestId: req.requestId });
  } catch (error) {
    return res.status(502).json(errorBody(error.code || "POSTHOG_EVENT_FAILED", "Revenue event dispatch failed", req.requestId));
  }
});

app.get("/api/revenue/summary", requireApiKey, (req, res) => {
  try { return res.json({ ok: true, summary: revenueRuntime.summary(revenueTenantId(req)), requestId: req.requestId }); }
  catch (error) { return res.status(500).json(errorBody(error.code || "REVENUE_SUMMARY_FAILED", "Revenue summary failed", req.requestId)); }
});
app.post("/api/revenue/experiment/assign", requireApiKey, leadRateLimit, (req, res) => {
  try { const { assignVariant } = require("./experiment-engine"); return res.json({ ok: true, assignment: assignVariant(req.body?.experiment || req.body || {}, req.body?.entityId), requestId: req.requestId }); }
  catch (error) { return res.status(400).json(errorBody(error.code || "EXPERIMENT_ASSIGN_FAILED", error.message || "Experiment assignment failed", req.requestId)); }
});

app.post("/api/revenue/experiment/analyze", requireApiKey, leadRateLimit, (req, res) => {
  try { const { analyzeExperiment } = require("./experiment-engine"); return res.json({ ok: true, analysis: analyzeExperiment(req.body?.records || []), requestId: req.requestId }); }
  catch (error) { return res.status(400).json(errorBody(error.code || "EXPERIMENT_ANALYZE_FAILED", error.message || "Experiment analysis failed", req.requestId)); }
});

app.post("/api/revenue/rca", requireApiKey, leadRateLimit, (req, res) => {
  try {
    const body = req.body || {};
    const result = analyzeLeadLoss(body.events || [], body);
    return res.json({ ok: true, rca: result, requestId: req.requestId });
  } catch (error) {
    return res.status(400).json(errorBody(error.code || "REVENUE_RCA_FAILED", "Revenue RCA failed", req.requestId));
  }
});

app.get("/api/revenue/integrity", requireApiKey, (req, res) => {
  try { return res.json({ ok: true, integrity: revenueRuntime.integrity(revenueTenantId(req)), requestId: req.requestId }); }
  catch (error) { return res.status(500).json(errorBody(error.code || "REVENUE_INTEGRITY_FAILED", "Revenue integrity check failed", req.requestId)); }
});

app.post("/api/revenue/cost", requireApiKey, leadRateLimit, (req, res) => {
  try {
    const tenantId = revenueTenantId(req);
    const body = req.body || {};
    const record = require("./revenue-ledger").appendCost(Object.assign({}, body, { tenantId })).record;
    return res.status(201).json({ ok: true, cost: record, requestId: req.requestId });
  } catch (error) {
    const status = /required/.test(String(error.message || "")) ? 400 : 500;
    return res.status(status).json(errorBody(error.code || "REVENUE_COST_FAILED", status === 400 ? error.message : "Revenue cost failed", req.requestId));
  }
});

app.get("/api/revenue/ledger", requireApiKey, (req, res) => {
  try { const type = req.query.type ? String(req.query.type).toUpperCase() : undefined; return res.json({ ok: true, records: revenueRuntime.list(revenueTenantId(req), type), requestId: req.requestId }); }
  catch (error) { return res.status(500).json(errorBody(error.code || "REVENUE_LEDGER_FAILED", "Revenue ledger read failed", req.requestId)); }
});
app.post("/api/revenue/loop/evaluate", requireApiKey, leadRateLimit, (req, res) => {
  try {
    const result = autonomousRevenueLoop.evaluateLead(Object.assign({}, req.body || {}, {
      tenantId: revenueTenantId(req)
    }));
    return res.status(201).json({ ok: true, ...result, requestId: req.requestId });
  } catch (error) {
    const status = /required|must be|is required|INVALID/i.test(String(error.message || "")) ? 400 : 500;
    return res.status(status).json(errorBody(error.code || "REVENUE_LOOP_EVALUATE_FAILED", status === 400 ? error.message : "Revenue loop evaluation failed", req.requestId));
  }
});

app.post("/api/revenue/loop/execution", requireApiKey, leadRateLimit, (req, res) => {
  try {
    const result = await autonomousRevenueLoop.recordExecution(Object.assign({}, req.body || {}, {
      tenantId: revenueTenantId(req)
    }));
    return res.status(result.inserted ? 201 : 200).json({ ok: true, ...result, requestId: req.requestId });
  } catch (error) {
    const status = /required|must be|is required/i.test(String(error.message || "")) ? 400 : 500;
    return res.status(status).json(errorBody(error.code || "REVENUE_LOOP_EXECUTION_FAILED", status === 400 ? error.message : "Revenue loop execution failed", req.requestId));
  }
});

app.post("/api/revenue/loop/outcome", requireApiKey, leadRateLimit, (req, res) => {
  try {
    const result = await autonomousRevenueLoop.recordOutcome(Object.assign({}, req.body || {}, {
      tenantId: revenueTenantId(req)
    }));
    return res.status(result.inserted ? 201 : 200).json({ ok: true, ...result, requestId: req.requestId });
  } catch (error) {
    const status = /required|must be|invalid|unsupported/i.test(String(error.message || "")) ? 400 : 500;
    return res.status(status).json(errorBody(error.code || "REVENUE_LOOP_OUTCOME_FAILED", status === 400 ? error.message : "Revenue loop outcome failed", req.requestId));
  }
});

app.get("/api/revenue/loop/snapshot", requireApiKey, (req, res) => {
  try {
    return res.json({ ok: true, ...autonomousRevenueLoop.snapshot(revenueTenantId(req)), requestId: req.requestId });
  } catch (error) {
    return res.status(500).json(errorBody(error.code || "REVENUE_LOOP_SNAPSHOT_FAILED", "Revenue loop snapshot failed", req.requestId));
  }
});

app.post("/api/revenue/decision", requireApiKey, leadRateLimit, (req, res) => {
  try { const result = revenueRuntime.decide(revenueTenantId(req), req.body || {}); return res.status(201).json({ ok: true, ...result, requestId: req.requestId }); }
  catch (error) { const status = /required/.test(String(error.message || "")) ? 400 : 500; return res.status(status).json(errorBody(error.code || "REVENUE_DECISION_FAILED", status === 400 ? error.message : "Revenue decision failed", req.requestId)); }
});
app.post("/api/revenue/webhook/:provider", leadRateLimit, (req, res) => {
  try {
    const provider = String(req.params.provider || "external").trim().slice(0, 64);
    const tenantId = String(req.body?.tenantId || "").trim();
    if (!tenantId) return res.status(400).json(errorBody("TENANT_REQUIRED", "tenantId is required", req.requestId));
    let secret = "";
    const secretMapRaw = String(process.env.REVENUE_WEBHOOK_SECRETS_JSON || "").trim();
    if (secretMapRaw) {
      try {
        const map = JSON.parse(secretMapRaw);
        secret = String(map[tenantId] || "");
      } catch (_error) {
        return res.status(503).json(errorBody("REVENUE_WEBHOOK_CONFIG_INVALID", "Revenue webhook configuration is invalid", req.requestId));
      }
    } else {
      secret = String(process.env["REVENUE_WEBHOOK_SECRET_" + provider.toUpperCase()] || process.env.REVENUE_WEBHOOK_SECRET || "").trim();
    }
    if (!secret) return res.status(503).json(errorBody("REVENUE_WEBHOOK_NOT_CONFIGURED", "Revenue webhook secret is not configured", req.requestId));
    if (!revenueIngest.verifySignature(secret, req.body || {}, req.get("X-Samurai-Signature"))) return res.status(401).json(errorBody("INVALID_REVENUE_SIGNATURE", "Invalid revenue webhook signature", req.requestId));
    const event = revenueIngest.normalizeExternalEvent(Object.assign({}, req.body || {}, { provider }));
    const result = revenueRuntime.recordOutcome(tenantId, event);
    return res.status(result.inserted ? 201 : 200).json({ ok: true, ...result, requestId: req.requestId });
  } catch (error) {
    const status = /required|Unsupported outcome|amountKZT/.test(String(error.message || "")) ? 400 : 500;
    return res.status(status).json(errorBody(error.code || "REVENUE_WEBHOOK_FAILED", status === 400 ? error.message : "Revenue webhook failed", req.requestId));
  }
});

app.post("/api/revenue/outcome", requireApiKey, leadRateLimit, (req, res) => {
  try { const result = revenueRuntime.recordOutcome(revenueTenantId(req), req.body || {}); return res.status(result.inserted ? 201 : 200).json({ ok: true, ...result, requestId: req.requestId }); }
  catch (error) { const status = /required|Unsupported outcome/.test(String(error.message || "")) ? 400 : 500; return res.status(status).json(errorBody(error.code || "REVENUE_OUTCOME_FAILED", status === 400 ? error.message : "Revenue outcome failed", req.requestId)); }
});
app.get("/api/dual-ai/config", requireApiKey, (req, res) => res.json({ ok: true, config: dualAI.config(), requestId: req.requestId }));

app.get("/api/dual-ai/sessions", requireApiKey, (req, res) => res.json({ ok: true, sessions: dualAI.list(), requestId: req.requestId }));

app.get("/api/dual-ai/session/:id", requireApiKey, (req, res) => {
  const session = dualAI.get(req.params.id);
  if (!session) return res.status(404).json(errorBody("SESSION_NOT_FOUND", "Session not found", req.requestId));
  return res.json({ ok: true, session, requestId: req.requestId });
});

app.post("/api/dual-ai/session", requireApiKey, dualRateLimit, (req, res) => {
  try {
    const session = dualAI.create(req.body || {});
    return res.status(201).json({ ok: true, session, requestId: req.requestId });
  } catch (error) {
    const status = ["TASK_REQUIRED", "TASK_TOO_LONG"].includes(error.code) ? 400 : 500;
    return res.status(status).json(errorBody(error.code || "DUAL_AI_CREATE_FAILED", status === 500 ? "Internal server error" : error.message, req.requestId));
  }
});

app.post("/api/dual-ai/turn", requireApiKey, dualRateLimit, async (req, res) => {
  try {
    const session = await dualAI.next(String(req.body?.id || ""));
    return res.json({ ok: true, session, requestId: req.requestId });
  } catch (error) {
    const status = error.code === "SESSION_NOT_FOUND" ? 404 : error.code === "SESSION_NOT_RUNNING" ? 409 : 500;
    console.error(JSON.stringify({ event: "dual_ai_turn_failed", requestId: req.requestId, code: error.code || "INTERNAL_ERROR" }));
    return res.status(status).json(errorBody(error.code || "DUAL_AI_TURN_FAILED", status === 500 ? "Dual AI turn failed" : error.message, req.requestId));
  }
});

app.post("/api/dual-ai/stop", requireApiKey, (req, res) => {
  try {
    const session = dualAI.stop(String(req.body?.id || ""));
    return res.json({ ok: true, session, requestId: req.requestId });
  } catch (error) {
    const status = error.code === "SESSION_NOT_FOUND" ? 404 : error.code === "SESSION_NOT_RUNNING" ? 409 : 500;
    return res.status(status).json(errorBody(error.code || "DUAL_AI_STOP_FAILED", status === 500 ? "Dual AI stop failed" : error.message, req.requestId));
  }
});

app.get("/api/dual-ai/export/:id", requireApiKey, (req, res) => {
  try {
    const json = dualAI.exportData(req.params.id);
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="dual-ai-${req.params.id}.json"`);
    return res.send(json);
  } catch (error) {
    return res.status(404).json(errorBody("SESSION_NOT_FOUND", "Session not found", req.requestId));
  }
});


async function analyze(message, business) {
  const text = String(message || "").trim();
  if (!text) {
    const error = new Error("message обязателен");
    error.code = "INVALID_MESSAGE";
    throw error;
  }
  if (text.length > MAX_MESSAGE_CHARS) {
    const error = new Error(`message слишком длинный (максимум ${MAX_MESSAGE_CHARS} символов)`);
    error.code = "MESSAGE_TOO_LONG";
    throw error;
  }
  const lead = scoreLead(text);
  let reply = null;
  let aiTelemetry = null;
  if (process.env.OPENAI_API_KEY) {
    const generated = await generateReplyWithUsage({ business: business || process.env.BUSINESS_NAME, customerMessage: text, lead });
    reply = generated.text;
    const pricing = estimateKZT({ usage: generated.usage, rates: ratesFromEnv() });
    aiTelemetry = Object.assign({ provider: generated.provider, model: generated.model }, pricing);
  }
  return { lead, reply, aiTelemetry };
}

app.post("/api/lead/analyze", requireApiKey, leadRateLimit, async (req, res) => {
  try {
    const { message, business } = req.body || {};
    const result = await analyze(message, business);
    const saved = saveLead({ source: "api", message: String(message).trim(), ...result.lead, reply: result.reply });
    res.json({ ok: true, ...result, saved, requestId: req.requestId });
  } catch (error) {
    console.error(JSON.stringify({ event: "lead_analyze_failed", requestId: req.requestId, code: error.code || "INTERNAL_ERROR", error: error.message }));
    const upstream = /authentication|rate limit|temporarily unavailable|timed out/i.test(error.message);
    const status = error.code === "INVALID_MESSAGE" || error.code === "MESSAGE_TOO_LONG" ? 400 : upstream ? 503 : 500;
    const code = error.code || (upstream ? "UPSTREAM_UNAVAILABLE" : "INTERNAL_ERROR");
    const message = status === 500 ? "Internal server error" : status === 503 ? "Upstream service unavailable" : error.message;
    res.status(status).json(errorBody(code, message, req.requestId));
  }
});

app.get("/api/telegram/me", requireApiKey, async (req, res) => {
  try {
    const result = await telegramCamera.getMe();
    return res.json({ ok: true, telegram: result, requestId: req.requestId });
  } catch (error) {
    return res.status(503).json(errorBody(error.code || "TELEGRAM_UNAVAILABLE", "Telegram unavailable", req.requestId));
  }
});

app.get("/api/telegram/dialogs", requireApiKey, async (req, res) => {
  try {
    const result = await telegramUser().getDialogs(req.query.limit);
    return res.json({ ok: true, dialogs: result, requestId: req.requestId });
  } catch (error) {
    return res.status(503).json(errorBody(error.code || "TELEGRAM_USER_UNAVAILABLE", "Telegram user session unavailable", req.requestId));
  }
});

app.get("/api/telegram/messages", requireApiKey, async (req, res) => {
  try {
    const chatId = String(req.query.chatId || "").trim();
    if (!chatId) return res.status(400).json(errorBody("INVALID_CHAT_ID", "chatId is required", req.requestId));
    const result = await telegramUser().getMessages(chatId, req.query.limit);
    return res.json({ ok: true, messages: result, requestId: req.requestId });
  } catch (error) {
    return res.status(503).json(errorBody(error.code || "TELEGRAM_USER_UNAVAILABLE", "Telegram user session unavailable", req.requestId));
  }
});

app.post("/api/telegram/send", requireApiKey, async (req, res) => {
  try {
    const chatId = String(req.body?.chatId || "").trim();
    const message = String(req.body?.message || "").trim();
    if (!chatId || !message) return res.status(400).json(errorBody("INVALID_TELEGRAM_MESSAGE", "chatId and message are required", req.requestId));
    const result = await telegramCamera.sendMessage({ chatId, message });
    return res.json({ ok: true, result, requestId: req.requestId });
  } catch (error) {
    return res.status(502).json(errorBody(error.code || "TELEGRAM_SEND_FAILED", "Telegram send failed", req.requestId));
  }
});

app.post("/api/telegram/send-photo", requireApiKey, async (req, res) => {
  try {
    const { chatId, fileName, caption, base64, latitude, longitude } = req.body || {};
    if (!String(chatId || "").trim() || !String(base64 || "").trim()) {
      return res.status(400).json(errorBody("INVALID_TELEGRAM_PHOTO", "chatId and base64 photo are required", req.requestId));
    }
    const result = await telegramCamera.sendPhoto({
      chatId: String(chatId).trim(),
      fileName,
      caption,
      base64: String(base64),
      latitude,
      longitude,
    });
    return res.json({ ok: true, result, locationSent: latitude != null && longitude != null, requestId: req.requestId });
  } catch (error) {
    const status = error.code === "TELEGRAM_NOT_CONFIGURED" ? 503 : 502;
    return res.status(status).json(errorBody(error.code || "TELEGRAM_PHOTO_FAILED", status === 503 ? "Telegram is not configured" : "Telegram photo send failed", req.requestId));
  }
});

app.post("/api/telegram/webhook", requireWebhookSecret, async (req, res) => {
  res.sendStatus(200);
  try {
    const update = req.body || {};
    if (update.business_connection) {
      console.log(JSON.stringify({ event: "business_connection", id: update.business_connection.id, requestId: req.requestId }));
      return;
    }
    const message = update.business_message;
    if (!message?.text || !message.business_connection_id || !message.chat?.id || !Number.isInteger(message.message_id)) return;
    const eventKey = `telegram:${message.business_connection_id}:${message.chat.id}:${message.message_id}`;
    const claim = claimEvent(eventKey, { source: "telegram_business", businessConnectionId: message.business_connection_id, chatId: message.chat.id, messageId: message.message_id, customer: message.from?.id || null, message: message.text });
    if (!claim.claimed) {
      console.log(JSON.stringify({ event: "duplicate_telegram_event", eventKey, requestId: req.requestId }));
      return;
    }
    try {
             const result = await analyze(message.text, process.env.BUSINESS_NAME);
       const revenueDecision = revenueRuntime.decide("telegram:" + message.business_connection_id, {
         leadScore: result.lead.score,
         intent: result.lead.intent,
         dealValue: Number(process.env.DEFAULT_DEAL_VALUE_KZT || 200000),
         grossMargin: Number(process.env.DEFAULT_GROSS_MARGIN || 0.30),
         occurredAt: message.date ? new Date(Number(message.date) * 1000).toISOString() : new Date().toISOString(),
         responseSlaBreached: false,
         triggerRelevance: result.lead.intent === "hot" ? 0.8 : result.lead.intent === "warm" ? 0.5 : 0.2,
         contactAllowed: true,
         customerOptedOut: false
       });
       const saved = updateLead(claim.item.id, { ...result.lead, reply: result.reply, revenueDecision: revenueDecision.record, status: "completed" });
       if (result.aiTelemetry) revenueRuntime.recordExecutionCost("telegram:" + message.business_connection_id, revenueDecision.record.decisionId, eventKey + ":ai", result.aiTelemetry);
       console.log(JSON.stringify({ event: "lead", id: saved.id, chatId: message.chat.id, score: result.lead.score, intent: result.lead.intent, action: revenueDecision.record.action, requestId: req.requestId }));
       const autoReply = String(process.env.AUTO_REPLY).toLowerCase() === "true";
       const revenueGate = String(process.env.REVENUE_AUTO_GATE || "false").toLowerCase() === "true";
       const action = revenueDecision.record.action || revenueDecision.record.recommendedAction;
       const allowedByRevenue = ["RESPOND", "FOLLOW_UP", "REACTIVATE"].includes(action);
       const executionId = eventKey + ":execution";
       let killCritic = { verdict: revenueGate ? "FAIL" : "BYPASS", confidence: revenueGate ? 0 : 1, issues: [], required_changes: [], evidence_gaps: [] };
       if (result.reply && autoReply && revenueGate && allowedByRevenue && !REVENUE_SHADOW_MODE) {
         try {
           killCritic = await require("./dual-ai/critic").review({
             task: "Reply to a Telegram customer using only verified business facts. Do not invent prices, availability, discounts, delivery times or completed actions.",
             answer: result.reply,
             provider: process.env.DUAL_AI_B_PROVIDER || process.env.DUAL_AI_A_PROVIDER || "openai",
             model: process.env.DUAL_AI_B_MODEL || process.env.DUAL_AI_A_MODEL || process.env.OPENAI_MODEL || "gpt-5"
           });
         } catch (criticError) {
           killCritic = { verdict: "FAIL", confidence: 1, issues: ["critic_unavailable"], required_changes: [], evidence_gaps: [criticError.message] };
         }
       }
       const rollout = revenueRolloutPolicy({ reply: result.reply, autoReply, shadowMode: REVENUE_SHADOW_MODE, revenueGate, allowedByRevenue, criticVerdict: killCritic.verdict });
       const sendAllowed = rollout.send;
       revenueRuntime.recordExecution("telegram:" + message.business_connection_id, {
         executionId, decisionId: revenueDecision.record.decisionId, action, status: rollout.status,
         channel: "telegram_business", chatId: message.chat.id, criticVerdict: killCritic.verdict,
         revenueGate, shadowMode: REVENUE_SHADOW_MODE
       });
       updateLead(claim.item.id, { killCritic, execution: { executionId, status: sendAllowed ? "SENT" : (REVENUE_SHADOW_MODE ? "SHADOWED" : "BLOCKED"), shadowMode: REVENUE_SHADOW_MODE } });
       if (sendAllowed) {
         await sendBusinessMessage({ businessConnectionId: message.business_connection_id, chatId: message.chat.id, text: result.reply });
       }
       } catch (error) {
      updateLead(claim.item.id, { status: "failed", error: error.message });
      throw error;
    }
  } catch (error) {
    console.error(JSON.stringify({ event: "business_webhook_error", requestId: req.requestId, error: error.message }));
  }
});

app.use((req, res) => res.status(404).json(errorBody("NOT_FOUND", "Endpoint not found", req.requestId)));

const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`SamuraiOS Core 2.8.0 listening on :${PORT}`);
  try {
    const discovery = apolloRevenue.startAutonomousDiscovery({
      tenantId: String(process.env.TENANT_ID || "default").trim().slice(0, 128) || "default"
    });
    if (discovery.started) console.log(JSON.stringify({ event: "apollo_autodiscovery_started", ...discovery }));
  } catch (error) {
    console.error(JSON.stringify({ event: "apollo_autodiscovery_start_failed", error: error.message }));
  }
});
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = REQUEST_TIMEOUT_MS + 5000;

function shutdown(signal) {
  console.log(JSON.stringify({ event: "shutdown", signal }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10000).unref();
}
process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

module.exports = { app, server, analyze };
