"use strict";

const apolloRevenue = require("./apollo-revenue-adapter");

function boolEnv(name, fallback = false) {
  const value = String(process.env[name] ?? fallback).toLowerCase();
  return value === "true" || value === "1";
}

function positiveInt(value, fallback, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}

function clean(value, max = 512) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function config() {
  return {
    enabled: boolEnv("REVENUE_AUTONOMOUS_CYCLE_ENABLED", false),
    outreachEnabled: boolEnv("APOLLO_AUTONOMOUS_OUTREACH_ENABLED", false),
    maxProspects: positiveInt(process.env.REVENUE_AUTONOMOUS_MAX_PROSPECTS, 5, 10),
    minLeadScore: positiveInt(process.env.REVENUE_AUTONOMOUS_MIN_LEAD_SCORE, 70, 100),
    sequenceIdConfigured: Boolean(process.env.APOLLO_AUTONOMOUS_SEQUENCE_ID),
    emailAccountConfigured: Boolean(process.env.APOLLO_AUTONOMOUS_EMAIL_ACCOUNT_ID)
  };
}

function buildActionPlan(prospect, c) {
  const action = prospect?.decision?.action || prospect?.decision?.recommendedAction || "WAIT";
  const score = Number(prospect?.qualification?.score || 0);
  const eligible = ["RESPOND", "FOLLOW_UP", "REACTIVATE"].includes(action) &&
    score >= c.minLeadScore &&
    Boolean(prospect?.lead?.email);

  if (!eligible) {
    return {
      status: "DO_NOT_EXECUTE",
      action,
      score,
      reason: action === "DO_NOT_CONTACT" ? "CONTACT_SUPPRESSED" : "NOT_READY"
    };
  }

  if (!c.outreachEnabled) {
    return {
      status: "READY_FOR_APPROVAL",
      action,
      score,
      reason: "OUTREACH_KILL_SWITCH_OFF"
    };
  }

  if (!c.sequenceIdConfigured || !c.emailAccountConfigured) {
    return {
      status: "BLOCKED_CONFIGURATION",
      action,
      score,
      reason: "APOLLO_SEQUENCE_OR_EMAIL_ACCOUNT_NOT_CONFIGURED"
    };
  }

  return {
    status: "READY_FOR_EXECUTION",
    action,
    score,
    reason: "ALL_GATES_PASSED"
  };
}

async function runCycle({
  tenantId = "default",
  filters = {},
  maxProspects,
  enrich = true,
  dealValueKZT = Number(process.env.DEFAULT_DEAL_VALUE_KZT || 200000),
  grossMarginRate = Number(process.env.DEFAULT_GROSS_MARGIN || 0.30)
} = {}) {
  const c = config();
  if (!c.enabled) {
    return { enabled: false, config: c, reason: "REVENUE_AUTONOMOUS_CYCLE_DISABLED", plans: [] };
  }

  const result = await apolloRevenue.discoverAndQualify({
    tenantId: clean(tenantId, 128) || "default",
    filters,
    maxProspects: maxProspects || c.maxProspects,
    enrich,
    dealValueKZT,
    grossMarginRate
  });

  return {
    enabled: true,
    config: c,
    discovered: result.discovered || 0,
    enriched: result.enriched || 0,
    qualified: result.prospects?.length || 0,
    plans: (result.prospects || []).map((prospect) => ({
      lead: prospect.lead,
      qualification: prospect.qualification,
      decision: prospect.decision,
      actionPlan: buildActionPlan(prospect, c)
    }))
  };
}

module.exports = { config, buildActionPlan, runCycle };
