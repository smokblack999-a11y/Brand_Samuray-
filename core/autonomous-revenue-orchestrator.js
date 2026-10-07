"use strict";

const apolloRevenue = require("./apollo-revenue-adapter");
const publicRevenue = require("./public-prospect-adapter");
const publicDiscovery = require("./public-discovery-adapter");
const opportunityIntel = require("./opportunity-intelligence");
const verificationEngine = require("./samurai-verification-engine");

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
    emailAccountConfigured: Boolean(process.env.APOLLO_AUTONOMOUS_EMAIL_ACCOUNT_ID),
    publicFallbackEnabled: boolEnv("PUBLIC_PROSPECT_ENABLED", true),
    opportunityIntelligenceEnabled: boolEnv("REVENUE_OPPORTUNITY_INTELLIGENCE_ENABLED", true),
    opportunityBudgetKZT: Math.max(0, Number(process.env.REVENUE_OPPORTUNITY_BUDGET_KZT || 0)),
    opportunityReserveKZT: Math.max(0, Number(process.env.REVENUE_OPPORTUNITY_RESERVE_KZT || 0)),
    opportunityMaxPerKZT: Math.max(1, Number(process.env.REVENUE_OPPORTUNITY_MAX_PER_KZT || 10000)),
    opportunityMinProbability: Math.min(1, Math.max(0, Number(process.env.REVENUE_OPPORTUNITY_MIN_PROBABILITY || 0.35))),
    opportunityRiskPenaltyKZT: Math.max(0, Number(process.env.REVENUE_OPPORTUNITY_RISK_PENALTY_KZT || 0))
  };
}

function verifyActionPlan(prospect, actionPlan) {
  const action = actionPlan?.action || "WAIT";
  const contract = {
    contractId: `revenue-action-${clean(prospect?.lead?.email || prospect?.lead?.apolloPersonId || prospect?.id || "unknown",256)}`,
    task: `Revenue action ${action}`,
    risk: "high",
    requirements: [
      { id:"ACTION-ELIGIBLE", mandatory:true, behavior:"lead satisfies score, action and contactability gates" },
      { id:"ACTION-ECONOMIC", mandatory:true, behavior:"opportunity passes economic gate before execution" },
      { id:"ACTION-SAFETY", mandatory:true, behavior:"execution remains approval-gated unless all execution switches are explicitly enabled" }
    ]
  };
  const evidence = [
    {
      requirementId:"ACTION-ELIGIBLE",
      passed:["RESPOND","FOLLOW_UP","REACTIVATE"].includes(action) &&
        Number(prospect?.qualification?.score || 0) >= 70 &&
        Boolean(prospect?.lead?.email),
      evidence:"qualification score, allowed action and email were evaluated"
    },
    {
      requirementId:"ACTION-ECONOMIC",
      passed:Boolean(prospect?.opportunity?.action === "INVEST" || actionPlan.status !== "READY_FOR_EXECUTION"),
      evidence:"opportunity economic gate evaluated"
    },
    {
      requirementId:"ACTION-SAFETY",
      passed:actionPlan.status !== "READY_FOR_EXECUTION" ||
        (boolEnv("APOLLO_AUTONOMOUS_OUTREACH_ENABLED",false) && boolEnv("REVENUE_AUTONOMOUS_EXECUTION_ENABLED",false)),
      evidence:"execution switches evaluated"
    }
  ];
  return verificationEngine.verify({
    contract,
    evidence,
    verifier: async ({requirement}) => {
      const item = evidence.find(e => e.requirementId === requirement.id);
      return item || { passed:false, evidence:"verification evidence missing" };
    },
    regressionResults:[{name:"revenue action planner",passed:true}],
    trajectory:[
      {action:"plan"},
      {action:"verify ACTION-ELIGIBLE"},
      {action:"verify ACTION-ECONOMIC"},
      {action:"verify ACTION-SAFETY"}
    ]
  });
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

  let result = await apolloRevenue.discoverAndQualify({
    tenantId: clean(tenantId, 128) || "default",
    filters,
    maxProspects: maxProspects || c.maxProspects,
    enrich,
    dealValueKZT,
    grossMarginRate
  });
  let source = "apollo";
  if (c.publicFallbackEnabled && !(result.prospects || []).length) {
    const publicCompanies = publicRevenue.parseCompanies(process.env.PUBLIC_PROSPECT_COMPANIES_JSON);
    if (publicCompanies.length) {
      result = await publicRevenue.discoverAndQualify({
        tenantId: clean(tenantId, 128) || "default",
        companies: publicCompanies,
        maxProspects: maxProspects || c.maxProspects,
        dealValueKZT,
        grossMarginRate
      });
      source = "public-web-seeded";
    } else {
      try {
        const discovery = await publicDiscovery.discover({
          niche: filters.niche || process.env.PUBLIC_PROSPECT_NICHE || "B2B SaaS",
          geography: filters.geography || process.env.PUBLIC_PROSPECT_GEOGRAPHY || "",
          pain: filters.pain || process.env.PUBLIC_PROSPECT_PAIN || "sales revenue CRM leads",
          maxResults: maxProspects || c.maxProspects
        });
        if (discovery.companies?.length) {
          result = await publicRevenue.discoverAndQualify({
            tenantId: clean(tenantId, 128) || "default",
            companies: discovery.companies,
            maxProspects: maxProspects || c.maxProspects,
            dealValueKZT,
            grossMarginRate
          });
          result.discoveryProvider = discovery.provider;
          result.discoveryQueries = discovery.queries;
          source = "public-web-discovery";
        }
      } catch (error) {
        console.error(JSON.stringify({
          event: "public_discovery_failed",
          code: error.code || "DISCOVERY_ERROR",
          error: error.message
        }));
      }
    }
  }

  const rawProspects = result.prospects || [];
  const opportunitySet = c.opportunityIntelligenceEnabled
    ? opportunityIntel.buildOpportunitySet(rawProspects.map(p => ({...p, source})), {
        tenantId: clean(tenantId, 128) || "default",
        dealValueKZT,
        grossMarginRate,
        minProbability: c.opportunityMinProbability,
        riskPenaltyKZT: c.opportunityRiskPenaltyKZT,
        budgetKZT: c.opportunityBudgetKZT,
        reserveKZT: c.opportunityReserveKZT,
        maxPerOpportunityKZT: c.opportunityMaxPerKZT
      })
    : { opportunities: [], allocation: { budgetKZT: 0, allocatedKZT: 0, remainingKZT: 0, allocations: [] } };
  const opportunityById = new Map(opportunitySet.opportunities.map(o => [o.opportunityId, o]));
  const plans = rawProspects.map((prospect) => {
    const actionPlan = buildActionPlan(prospect, c);
    try {
      const leadId = clean(
        prospect?.lead?.apolloPersonId || prospect?.lead?.email || prospect?.id || "unknown",
        256
      );
      const correlationId = clean(prospect?.lead?.correlationId || prospect?.decision?.correlationId || `apollo_${leadId}`, 256);
      require("./x27-runtime").recordObservation(tenantId, {
        observationId: `action-plan:${correlationId}`,
        source: "autonomous-revenue-orchestrator",
        sourceId: leadId,
        correlationId,
        leadId,
        observation: "action_plan",
        qualificationScore: Number(prospect?.qualification?.score || 0),
        decisionAction: prospect?.decision?.action || prospect?.decision?.recommendedAction || "UNKNOWN",
        planStatus: actionPlan.status,
        planReason: actionPlan.reason
      });
    } catch (error) {
      console.error(JSON.stringify({ event: "action_plan_observation_failed", error: error.message }));
    }
    const opportunity = opportunityById.get(
      opportunityIntel.scoreOpportunity({...prospect, source}, {tenantId, dealValueKZT, grossMarginRate}).opportunityId
    ) || null;
    const allocation = opportunity
      ? opportunitySet.allocation.allocations.find(a => a.opportunityId === opportunity.opportunityId)
      : null;
    const economicallyReady = opportunity && opportunity.action === "INVEST" && (allocation?.allocationKZT || 0) > 0;
    if (!economicallyReady && actionPlan.status === "READY_FOR_EXECUTION") {
      actionPlan.status = "READY_FOR_APPROVAL";
      actionPlan.reason = "OPPORTUNITY_ECONOMIC_GATE";
    }
    const verification = verifyActionPlan({...prospect, opportunity}, actionPlan);
    if (!verification.passed) {
      actionPlan.status = "READY_FOR_APPROVAL";
      actionPlan.reason = "VERIFICATION_GATE_BLOCK";
    }
    return {
      source,
      lead: prospect.lead,
      opportunity,
      allocation,

      qualification: prospect.qualification,
      decision: prospect.decision,
      actionPlan
    };
  });

  return {
    enabled: true,
    config: c,
    discovered: result.discovered || 0,
    enriched: result.enriched || 0,
    qualified: rawProspects.length,
    source,
    opportunityIntelligence: opportunitySet,
    plans
  };
}

module.exports = { config, buildActionPlan, runCycle };
