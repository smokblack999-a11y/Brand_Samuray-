"use strict";

const dns = require("node:dns").promises;
const net = require("node:net");

const TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 500000;
const MAX_RESULTS = 20;

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
  const provider = clean(process.env.PUBLIC_DISCOVERY_PROVIDER || "none", 64).toLowerCase();
  return {
    provider,
    endpoint: clean(process.env.PUBLIC_DISCOVERY_ENDPOINT || "", 1000),
    apiKey: clean(process.env.PUBLIC_DISCOVERY_API_KEY || "", 512),
    maxResults: Math.min(Number(process.env.PUBLIC_DISCOVERY_MAX_RESULTS || 10) || 10, MAX_RESULTS)
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
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "SamuraiOS-PublicDiscovery/1.0", ...headers }
    });
    if (!response.ok) throw Object.assign(new Error(`DISCOVERY_HTTP_${response.status}`), { code: `DISCOVERY_HTTP_${response.status}` });
    const body = (await response.text()).slice(0, MAX_BODY_BYTES);
    return JSON.parse(body);
  } finally { clearTimeout(timer); }
}

function normalizeResults(payload, provider, maxResults) {
  const rows = Array.isArray(payload) ? payload :
    Array.isArray(payload?.results) ? payload.results :
    Array.isArray(payload?.web?.results) ? payload.web.results :
    Array.isArray(payload?.organic) ? payload.organic : [];
  return rows.slice(0, maxResults).map((row) => {
    const url = clean(row.url || row.link || row.href || "", 1000);
    let domain = "";
    try { domain = new URL(url).hostname; } catch (_) {}
    return {
      name: clean(row.name || row.title || row.company || domain, 200),
      domain,
      website: url,
      description: clean(row.description || row.snippet || row.text || "", 1000),
      discoveryProvider: provider
    };
  }).filter(x => x.domain);
}

async function discoverCompanies({ query, maxResults } = {}) {
  const c = providerConfig();
  if (!query) return { enabled: false, reason: "DISCOVERY_QUERY_REQUIRED", companies: [] };
  if (!c.endpoint || !c.apiKey || c.provider === "none") {
    return { enabled: false, reason: "PUBLIC_DISCOVERY_NOT_CONFIGURED", provider: c.provider, companies: [] };
  }

  let url;
  if (c.provider === "brave") {
    url = new URL(c.endpoint || "https://api.search.brave.com/res/v1/web/search");
    url.searchParams.set("q", query);
    url.searchParams.set("count", String(Math.min(maxResults || c.maxResults, MAX_RESULTS)));
    const payload = await requestJson(url.toString(), { "X-Subscription-Token": c.apiKey });
    return { enabled: true, provider: c.provider, companies: normalizeResults(payload, c.provider, maxResults || c.maxResults) };
  }

  if (c.provider === "serper") {
    url = new URL(c.endpoint || "https://google.serper.dev/search");
    const payload = await requestJson(url.toString(), { "X-API-KEY": c.apiKey, "content-type": "application/json" }, { method: "POST", body: JSON.stringify({ q: query, num: Math.min(maxResults || c.maxResults, MAX_RESULTS) }) });
    return { enabled: true, provider: c.provider, companies: normalizeResults(payload, c.provider, maxResults || c.maxResults) };
  }

  if (c.provider === "generic-json") {
    url = new URL(c.endpoint);
    url.searchParams.set("q", query);
    const payload = await requestJson(url.toString(), { authorization: `Bearer ${c.apiKey}` });
    return { enabled: true, provider: c.provider, companies: normalizeResults(payload, c.provider, maxResults || c.maxResults) };
  }

  return { enabled: false, reason: "PUBLIC_DISCOVERY_PROVIDER_UNSUPPORTED", provider: c.provider, companies: [] };
}

function buildQueries({ niche = "B2B SaaS", geography = "", pain = "sales revenue CRM leads" } = {}) {
  const geo = geography ? ` ${clean(geography, 100)}` : "";
  const n = clean(niche, 160);
  const p = clean(pain, 200);
  return [
    `"${n}"${geo} ${p} software company`,
    `"${n}"${geo} B2B SaaS revenue sales`,
    `"${n}"${geo} CRM pipeline leads platform`
  ];
}

async function discover({ niche, geography, pain, maxResults = 10 } = {}) {
  const queries = buildQueries({ niche, geography, pain });
  const all = [];
  const seen = new Set();
  for (const query of queries) {
    const result = await discoverCompanies({ query, maxResults });
    if (!result.enabled && result.reason === "PUBLIC_DISCOVERY_NOT_CONFIGURED") return { ...result, queries, companies: [] };
    for (const company of result.companies || []) {
      if (!seen.has(company.domain)) {
        seen.add(company.domain);
        all.push(company);
      }
    }
    if (all.length >= maxResults) break;
  }
  return { enabled: true, provider: providerConfig().provider, queries, companies: all.slice(0, maxResults) };
}

module.exports = { providerConfig, discoverCompanies, discover, buildQueries, isPrivateIp };
