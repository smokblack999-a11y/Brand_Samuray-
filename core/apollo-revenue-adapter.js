"use strict";

const revenueRuntime = require("./x27-runtime");
const revenueBridge = require("./revenue-integration-bridge");
const { saveLead } = require("./store");

const DEFAULT_TIMEOUT_MS = 15000;

function clean(value, max = 512) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function positiveInt(value, fallback, max) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return Math.min(n, max);
}

async function requestJson(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const raw = await response.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch (_) { body = { raw: raw.slice(0, 2000) }; }
    if (!response.ok) {
      const error = new Error(body?.error || body?.message || `Apollo request failed: ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function apolloConfig() {
  const worstCaseCreditsPerPerson = 9;
  const maxCredits = Math.max(
    worstCaseCreditsPerPerson,
    Number(process.env.APOLLO_MAX_ENRICH_CREDITS_PER_RUN || 45)
  );
  return {
    configured: Boolean(process.env.APOLLO_API_KEY),
    enabled: String(process.env.REVENUE_INTEGRATIONS_ENABLED || "false").toLowerCase() === "true",
    maxEnrichCreditsPerRun: maxCredits,
    maxPeoplePerRun: Math.min(
      10,
      Math.floor(maxCredits / worstCaseCreditsPerPerson)
    )
  };
}

function buildSearchParams(filters = {}, perPage = 10) {
  const params = new URLSearchParams();
  const scalar = ["q_keywords", "include_similar_titles", "page"];
  for (const key of scalar) {
    if (filters[key] != null && String(filters[key]).trim() !== "") params.set(key, String(filters[key]));
  }

  const arrays = [
    "person_titles",
    "person_seniorities",
    "person_locations",
    "organization_locations",
    "q_organization_domains_list",
    "organization_num_employees_ranges",
    "contact_email_status",
    "market_segments"
  ];
  for (const key of arrays) {
    if (!Array.isArray(filters[key])) continue;
    for (const value of filters[key].slice(0, 20)) {
      const cleaned = clean(value, 200);
      if (cleaned) params.append(`${key}[]`, cleaned);
    }
  }

  params.set("per_page", String(perPage));
  return params;
}

function qualifyPerson(person = {}) {
  const title = clean(person.title, 200).toLowerCase();
  const seniority = clean(person.seniority, 64).toLowerCase();
  const employees = Number(
    person.organization_num_employees ??
    person.organization?.num_employees ??
    person.organization?.employee_count ??
    0
  );

  let score = 25;
  if (["founder", "co_founder", "c_suite"].includes(seniority)) score += 40;
  else if (["vp", "head", "director"].includes(seniority)) score += 30;
  else if (["manager", "senior"].includes(seniority)) score += 15;

  if (/(ceo|cto|cmo|cro|coo|chief|founder|owner|vp|vice president|head|director)/i.test(title)) score += 20;
  if (employees >= 11 && employees <= 1000) score += 10;
  if (person.organization?.website_url || person.organization?.primary_domain) score += 5;

  score = Math.max(0, Math.min(100, score));
  return {
    score,
    intent: score >= 70 ? "hot" : score >= 45 ? "warm" : "cold",
    signals: [
      seniority || null,
      /chief|founder|ceo|cto|cmo|cro|coo|vp|head|director/i.test(title) ? "decision_maker_title" : null,
      employees >= 11 && employees <= 1000 ? "target_company_size" : null,
      person.email ? "verified_contact_path" : null
    ].filter(Boolean)
  };
}

function flattenPerson(person = {}) {
  const org = person.organization || {};
  return {
    firstName: person.first_name,
    lastName: person.last_name,
    email: person.email,
    phone: person.phone || person.direct_phone,
    title: person.title,
    company: person.organization_name || org.name,
    website: org.website_url || (org.primary_domain ? `https://${org.primary_domain}` : undefined),
    linkedinUrl: person.linkedin_url,
    apolloPersonId: person.id,
    apolloOrganizationId: person.organization_id || org.id,
    location: person.city && person.country ? `${person.city}, ${person.country}` : person.country,
    seniority: person.seniority
  };
}

async function searchPeople(filters = {}, perPage = 10) {
  if (!process.env.APOLLO_API_KEY) {
    return { skipped: true, reason: "APOLLO_API_KEY_NOT_CONFIGURED", people: [] };
  }
  const params = buildSearchParams(filters, perPage);
  return requestJson(`https://api.apollo.io/api/v1/mixed_people/api_search?${params.toString()}`, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "x-api-key": process.env.APOLLO_API_KEY
    },
    body: JSON.stringify({})
  });
}

async function enrichPeople(people) {
  const details = people
    .filter(p => p?.id)
    .slice(0, 10)
    .map(p => ({ id: String(p.id) }));

  if (!details.length) return { people: [] };

  return requestJson("https://api.apollo.io/api/v1/people/bulk_match?reveal_personal_emails=false&reveal_phone_number=false", {
    method: "POST",
    headers: {
      "accept": "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-cache",
      "x-api-key": process.env.APOLLO_API_KEY
    },
    body: JSON.stringify({ details })
  });
}

async function discoverAndQualify({
  tenantId = "default",
  filters = {},
  maxProspects = 5,
  enrich = true,
  dealValueKZT = Number(process.env.DEFAULT_DEAL_VALUE_KZT || 200000),
  grossMarginRate = Number(process.env.DEFAULT_GROSS_MARGIN || 0.30)
} = {}) {
  const config = apolloConfig();
  if (!config.enabled) return { enabled: false, config, prospects: [] };
  if (!config.configured) return { enabled: true, config, prospects: [], reason: "APOLLO_API_KEY_NOT_CONFIGURED" };

  const cap = Math.min(
    positiveInt(maxProspects, Math.min(5, config.maxPeoplePerRun), config.maxPeoplePerRun),
    config.maxPeoplePerRun
  );
  const searched = await searchPeople(filters, cap);
  const rawPeople = Array.isArray(searched?.people) ? searched.people.slice(0, cap) : [];

  let enrichedPeople = rawPeople;
  let enrichment = null;
  if (enrich && rawPeople.length) {
    enrichment = await enrichPeople(rawPeople);
    if (Array.isArray(enrichment?.people)) enrichedPeople = enrichment.people;
  }

  const prospects = [];
  for (const person of enrichedPeople.slice(0, cap)) {
    const lead = flattenPerson(person);
    const qualification = qualifyPerson(person);
    const leadId = clean(
      lead.apolloPersonId || lead.email || `${lead.company || "unknown"}:${lead.title || "unknown"}`,
      256
    );
    const correlationId = `apollo_${leadId}`;

    let decision = null;
    try {
      decision = revenueRuntime.decide(tenantId, {
        leadScore: qualification.score,
        intent: qualification.intent,
        dealValue: dealValueKZT,
        grossMargin: grossMarginRate,
        triggerRelevance: qualification.score / 100,
        contactAllowed: true,
        customerOptedOut: false,
        risk: 0,
        leadId,
        correlationId
      }).record;
    } catch (error) {
      decision = { error: error.message };
    }

    let hubspot = null;
    if (lead.email) {
      try {
        hubspot = await revenueBridge.syncLead({
          lead,
          tenantId,
          correlationId
        });
      } catch (error) {
        hubspot = { error: error.message };
      }
    }

    try {
      revenueRuntime.recordObservation(tenantId, {
        observationId: `qualify:${correlationId}`,
        source: "apollo-qualification",
        sourceId: leadId,
        correlationId,
        leadId,
        observation: "qualification_observation",
        score: qualification.score,
        intent: qualification.intent,
        signals: qualification.signals,
        title: clean(lead.title, 200),
        seniority: clean(lead.seniority, 64),
        company: clean(lead.company, 200),
        decisionAction: decision?.action || decision?.recommendedAction || "UNKNOWN",
        decisionId: decision?.decisionId || null,
        emailAvailable: Boolean(lead.email),
        enrichmentRequested: Boolean(enrich),
        enrichmentCreditsReported: enrichment?.mcp_credits || null
      });
    } catch (error) {
      console.error(JSON.stringify({
        event: "revenue_observation_write_failed",
        leadId,
        error: error.message
      }));
    }

    const saved = saveLead({
      source: "apollo",
      sourceId: lead.apolloPersonId || null,
      eventKey: `apollo:${tenantId}:${lead.apolloPersonId || lead.email || correlationId}`,
      status: "completed",
      ...lead,
      ...qualification,
      correlationId,
      revenueDecision: decision,
      hubspot
    });

    prospects.push({
      id: saved.id,
      lead,
      qualification,
      decision,
      hubspot
    });
  }

  return {
    enabled: true,
    config,
    requested: cap,
    discovered: rawPeople.length,
    enriched: enrichedPeople.length,
    prospects,
    apollo: {
      searched: true,
      enrichmentRequested: Boolean(enrich && rawPeople.length),
      enrichmentCreditsReported: enrichment?.mcp_credits || null
    }
  };
}

function parseFilters(raw) {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    return {};
  }
}

let autonomousTimer = null;
let autonomousBusy = false;

function startAutonomousDiscovery({ tenantId = "default" } = {}) {
  if (String(process.env.APOLLO_AUTODISCOVERY_ENABLED || "false").toLowerCase() !== "true") {
    return { enabled: false, started: false, reason: "APOLLO_AUTODISCOVERY_DISABLED" };
  }

  if (autonomousTimer) return { enabled: true, started: true, reused: true };

  const intervalMs = Math.max(
    15 * 60 * 1000,
    Number(process.env.APOLLO_DISCOVERY_INTERVAL_MS || 6 * 60 * 60 * 1000)
  );
  const filters = parseFilters(process.env.APOLLO_DISCOVERY_FILTERS_JSON);
  const maxProspects = Number(process.env.APOLLO_DISCOVERY_MAX_PROSPECTS || 5);

  const run = async () => {
    if (autonomousBusy) return;
    autonomousBusy = true;
    try {
      const result = await discoverAndQualify({
        tenantId,
        filters,
        maxProspects,
        enrich: true,
        dealValueKZT: Number(process.env.DEFAULT_DEAL_VALUE_KZT || 200000),
        grossMarginRate: Number(process.env.DEFAULT_GROSS_MARGIN || 0.30)
      });
      console.log(JSON.stringify({
        event: "apollo_autonomous_discovery",
        discovered: result.discovered || 0,
        enriched: result.enriched || 0,
        prospects: result.prospects?.length || 0
      }));
    } catch (error) {
      console.error(JSON.stringify({
        event: "apollo_autonomous_discovery_failed",
        code: error.code || null,
        error: error.message
      }));
    } finally {
      autonomousBusy = false;
    }
  };

  autonomousTimer = setInterval(run, intervalMs);
  autonomousTimer.unref();
  return { enabled: true, started: true, intervalMs };
}

function stopAutonomousDiscovery() {
  if (autonomousTimer) clearInterval(autonomousTimer);
  autonomousTimer = null;
  return { stopped: true };
}

module.exports = {
  apolloConfig,
  searchPeople,
  enrichPeople,
  discoverAndQualify,
  qualifyPerson,
  flattenPerson,
  startAutonomousDiscovery,
  stopAutonomousDiscovery
};
