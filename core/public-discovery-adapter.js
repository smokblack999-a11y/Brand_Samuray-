"use strict";

const dns = require("node:dns").promises;
const net = require("node:net");

const TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 500000;
const MAX_RESULTS = 20;
const DEFAULT_PROVIDERS = ["exa", "brave-llm", "brave", "tavily"];

function clean(v, max = 512) { return String(v == null ? "" : v).trim().slice(0, max); }

function isPrivateIp(ip) {
  if (net.isIP(ip) === 4) {
    const p = ip.split(".").map(Number);
    return p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) ||
      (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) || p[0] === 0;
  }
  if (net.isIP(ip) === 6) {
    const x = ip.toLowerCase();
    return x === "::1" || x === "::" || x.startsWith("fc") || x.startsWith("fd") ||
      x.startsWith("fe8") || x.startsWith("fe9") || x.startsWith("fea") || x.startsWith("feb");
  }
  return true;
}

async function assertPublicHost(hostname) {
  const records = await dns.lookup(hostname, { all: true });
  if (!records.length || records.some(r => isPrivateIp(r.address))) {
    throw Object.assign(new Error("PUBLIC_HOST_BLOCKED"), { code: "PUBLIC_HOST_BLOCKED" });
  }
}

function providerConfig() {
  const requested = clean(process.env.PUBLIC_DISCOVERY_PROVIDERS || "", 500)
    .split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  const exaKey = clean(process.env.EXA_API_KEY || "", 512);
  const braveKey = clean(process.env.BRAVE_SEARCH_API_KEY || process.env.PUBLIC_DISCOVERY_API_KEY || "", 512);
  const tavilyKey = clean(process.env.TAVILY_API_KEY || "", 512);
  const configured = {
    exa: Boolean(exaKey),
    brave: Boolean(braveKey),
    "brave-llm": Boolean(braveKey),
    tavily: Boolean(tavilyKey)
  };
  const providers = (requested.length ? requested : DEFAULT_PROVIDERS).filter(p => configured[p]);
  const maxResults = Math.min(Math.max(Number(process.env.PUBLIC_DISCOVERY_MAX_RESULTS || 10) || 10, 1), MAX_RESULTS);
  return {
    providers: [...new Set(providers)],
    exaKey, braveKey, tavilyKey, maxResults,
    exaType: clean(process.env.EXA_SEARCH_TYPE || "auto", 32).toLowerCase(),
    freshnessHours: Math.max(0, Number(process.env.PUBLIC_DISCOVERY_FRESHNESS_HOURS || 168) || 168)
  };
}

async function requestJson(url, headers = {}, options = {}) {
  const target = new URL(url);
  if (!["https:", "http:"].includes(target.protocol) || target.username || target.password) {
    throw Object.assign(new Error("DISCOVERY_URL_REJECTED"), { code: "DISCOVERY_URL_REJECTED" });
  }
  await assertPublicHost(target.hostname);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      method: options.method || "GET",
      body: options.body,
      redirect: "manual",
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "SamuraiOS-PublicDiscovery/2.0", ...headers }
    });
    if (response.status >= 300 && response.status < 400) {
      throw Object.assign(new Error("DISCOVERY_REDIRECT_BLOCKED"), { code: "DISCOVERY_REDIRECT_BLOCKED" });
    }
    if (!response.ok) throw Object.assign(new Error(`DISCOVERY_HTTP_${response.status}`), { code: `DISCOVERY_HTTP_${response.status}` });
    const body = (await response.text()).slice(0, MAX_BODY_BYTES);
    return JSON.parse(body);
  } finally { clearTimeout(timer); }
}

function normalizeDomain(value) {
  try {
    const u = new URL(/^https?:\\/\\//i.test(value) ? value : `https://${value}`);
    if (!["http:", "https:"].includes(u.protocol) || u.username || u.password) return "";
    return u.hostname.toLowerCase().replace(/^www\\./, "");
  } catch (_) { return ""; }
}

function extractUrl(row) {
  return clean(row.url || row.link || row.href || row.website || "", 1000);
}

function scoreEvidence(company) {
  const text = [
    company.name, company.description, ...(company.highlights || []),
    company.summary, company.entityDescription
  ].filter(Boolean).join(" ").toLowerCase();
  let score = 0;
  const signals = [];
  const add = (n, code, re) => {
    if (re.test(text)) { score += n; signals.push(code); }
  };
  add(22, "saas_software", /\\b(saas|software|platform|api|cloud|subscription)\\b/i);
  add(18, "b2b_enterprise", /\\b(b2b|enterprise|business|companies|teams|mid-market)\\b/i);
  add(24, "revenue_motion", /\\b(sales|revenue|pipeline|crm|leads|revops|go-to-market|gtm)\\b/i);
  add(14, "growth_signal", /\\b(growth|scaling|expanding|expansion|hiring|funding|raised|series [a-c]|new market)\\b/i);
  add(12, "buyer_signal", /\\b(ceo|founder|cro|chief revenue|head of sales|vp sales|revenue operations)\\b/i);
  const workforce = Number(company.workforce || 0);
  if (workforce >= 20 && workforce <= 1000) { score += 6; signals.push("target_company_size"); }
  if (company.publishedDate) {
    const ageDays = Math.max(0, (Date.now() - Date.parse(company.publishedDate)) / 86400000);
    if (Number.isFinite(ageDays)) {
      if (ageDays <= 7) { score += 8; signals.push("fresh_signal_7d"); }
      else if (ageDays <= 30) { score += 5; signals.push("fresh_signal_30d"); }
    }
  }
  return { evidenceScore: Math.min(100, score), signals: [...new Set(signals)] };
}

function normalizeResults(payload, provider, maxResults) {
  const rows = Array.isArray(payload) ? payload :
    Array.isArray(payload?.results) ? payload.results :
    Array.isArray(payload?.web?.results) ? payload.web.results :
    Array.isArray(payload?.organic) ? payload.organic : [];

  return rows.slice(0, maxResults).map((row) => {
    const url = extractUrl(row);
    const domain = normalizeDomain(url);
    if (!domain) return null;

    const entity = Array.isArray(row.entities)
      ? row.entities.find(x => x && x.type === "company")?.properties || {}
      : {};
    const highlights = Array.isArray(row.highlights) ? row.highlights.filter(Boolean).slice(0, 5) : [];
    const description = clean(
      row.description || row.snippet || row.content || row.text || entity.description || "", 1400
    );
    const result = {
      name: clean(row.name || row.title || entity.name || row.company || domain, 200),
      domain,
      website: `https://${domain}`,
      description,
      highlights,
      summary: clean(row.summary || "", 1200),
      entityDescription: clean(entity.description || "", 800),
      workforce: Number(entity.workforce?.total || entity.workforce || 0) || null,
      headquarters: entity.headquarters || null,
      funding: entity.financials?.fundingLatestRound || null,
      publishedDate: clean(row.publishedDate || row.published_date || "", 64) || null,
      discoveryProvider: provider,
      sourceId: clean(row.id || "", 256)
    };
    const ev = scoreEvidence(result);
    result.evidenceScore = ev.evidenceScore;
    result.signals = ev.signals;
    return result;
  }).filter(Boolean);
}

async function queryProvider(provider, query, c, maxResults) {
  const limit = Math.min(maxResults || c.maxResults, MAX_RESULTS);

  if (provider === "exa") {
    const payload = await requestJson("https://api.exa.ai/search", {
      "x-api-key": c.exaKey, "content-type": "application/json"
    }, {
      method: "POST",
      body: JSON.stringify({
        query,
        type: ["instant", "fast", "auto", "deep-lite", "deep", "deep-reasoning"].includes(c.exaType) ? c.exaType : "auto",
        numResults: limit,
        moderation: true,
        contents: { highlights: true, summary: true }
      })
    });
    return normalizeResults(payload, provider, limit);
  }

  if (provider === "brave-llm") {
    const url = new URL("https://api.search.brave.com/res/v1/llm/context");
    url.searchParams.set("q", query);
    const payload = await requestJson(url.toString(), { "X-Subscription-Token": c.braveKey });
    return normalizeResults(payload, provider, limit);
  }

  if (provider === "brave") {
    const url = new URL("https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(limit));
    url.searchParams.set("country", clean(process.env.PUBLIC_DISCOVERY_COUNTRY || "US", 2).toUpperCase());
    url.searchParams.set("search_lang", clean(process.env.PUBLIC_DISCOVERY_LANGUAGE || "en", 8).toLowerCase());
    const payload = await requestJson(url.toString(), { "X-Subscription-Token": c.braveKey });
    return normalizeResults(payload, provider, limit);
  }

  if (provider === "tavily") {
    const payload = await requestJson("https://api.tavily.com/search", {
      "authorization": `Bearer ${c.tavilyKey}`,
      "content-type": "application/json"
    }, {
      method: "POST",
      body: JSON.stringify({
        query,
        search_depth: "advanced",
        max_results: limit,
        chunks_per_source: 3,
        include_raw_content: false
      })
    });
    return normalizeResults(payload, provider, limit);
  }

  return [];
}

async function discoverCompanies({ query, maxResults } = {}) {
  const c = providerConfig();
  if (!query) return { enabled: false, reason: "DISCOVERY_QUERY_REQUIRED", companies: [], providers: [] };
  if (!c.providers.length) {
    return {
      enabled: false, reason: "PUBLIC_DISCOVERY_NOT_CONFIGURED",
      providers: [], companies: []
    };
  }

  const settled = await Promise.allSettled(
    c.providers.map(provider => queryProvider(provider, query, c, maxResults || c.maxResults))
  );

  const byProvider = {};
  const merged = [];
  const seen = new Set();
  settled.forEach((item, i) => {
    const provider = c.providers[i];
    if (item.status === "fulfilled") {
      byProvider[provider] = { ok: true, count: item.value.length };
      for (const company of item.value) {
        const key = company.domain;
        const existing = merged.find(x => x.domain === key);
        if (!existing) {
          merged.push({ ...company, providers: [provider], providerCount: 1 });
          seen.add(key);
        } else {
          existing.providers = [...new Set([...(existing.providers || []), provider])];
          existing.providerCount = existing.providers.length;
          existing.evidenceScore = Math.min(100, existing.evidenceScore + 8);
          existing.signals = [...new Set([...(existing.signals || []), "cross_provider_confirmation"])];
          if (!existing.description && company.description) existing.description = company.description;
          if (!existing.highlights?.length && company.highlights?.length) existing.highlights = company.highlights;
        }
      }
    } else {
      byProvider[provider] = { ok: false, error: item.reason?.message || "PROVIDER_FAILED" };
    }
  });

  merged.sort((a, b) =>
    (b.providerCount * 12 + b.evidenceScore) - (a.providerCount * 12 + a.evidenceScore)
  );

  return {
    enabled: true,
    providers: c.providers,
    byProvider,
    companies: merged.slice(0, Math.min(maxResults || c.maxResults, MAX_RESULTS))
  };
}

function buildQueries({ niche = "B2B SaaS", geography = "", pain = "sales revenue CRM leads" } = {}) {
  const geo = geography ? ` ${clean(geography, 100)}` : "";
  const n = clean(niche, 160);
  const p = clean(pain, 200);
  return [
    `"${n}"${geo} ${p} software company`,
    `"${n}"${geo} B2B SaaS revenue sales growth`,
    `"${n}"${geo} CRM pipeline leads platform hiring funding`,
    `"${n}"${geo} "revenue operations" OR "head of sales" OR founder`
  ];
}

async function discover({ niche, geography, pain, maxResults = 10 } = {}) {
  const queries = buildQueries({ niche, geography, pain });
  const max = Math.min(Math.max(Number(maxResults) || 10, 1), MAX_RESULTS);
  const all = [];
  const byDomain = new Map();
  const providerRuns = [];

  for (const query of queries) {
    const result = await discoverCompanies({ query, maxResults: max });
    providerRuns.push({
      query,
      enabled: result.enabled,
      providers: result.providers || [],
      byProvider: result.byProvider || {},
      count: result.companies?.length || 0
    });
    if (!result.enabled && result.reason === "PUBLIC_DISCOVERY_NOT_CONFIGURED") {
      return { ...result, queries, providerRuns, companies: [] };
    }
    for (const company of result.companies || []) {
      const existing = byDomain.get(company.domain);
      if (!existing) {
        byDomain.set(company.domain, { ...company, queries: [query] });
        all.push(byDomain.get(company.domain));
      } else {
        existing.queries.push(query);
        existing.evidenceScore = Math.min(100, existing.evidenceScore + 6);
        existing.signals = [...new Set([...(existing.signals || []), "query_confirmation"])];
        existing.providerCount = Math.max(existing.providerCount || 1, company.providerCount || 1);
        existing.providers = [...new Set([...(existing.providers || []), ...(company.providers || [])])];
      }
    }
    all.sort((a, b) =>
      ((b.providerCount || 1) * 12 + b.evidenceScore + b.queries.length * 4) -
      ((a.providerCount || 1) * 12 + a.evidenceScore + a.queries.length * 4)
    );
    if (all.length >= max) break;
  }

  return {
    enabled: true,
    providers: providerConfig().providers,
    queries,
    providerRuns,
    companies: all.slice(0, max)
  };
}

module.exports = {
  providerConfig,
  discoverCompanies,
  discover,
  buildQueries,
  normalizeResults,
  scoreEvidence,
  isPrivateIp
};
