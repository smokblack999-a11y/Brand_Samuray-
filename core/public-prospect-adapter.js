"use strict";

const dns = require("node:dns").promises;
const net = require("node:net");
const revenueRuntime = require("./x27-runtime");
const { saveLead } = require("./store");

const TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 600000;
const MAX_PAGES = 6;
const PATHS = ["/", "/about", "/team", "/leadership", "/company", "/contact", "/sales", "/revenue", "/pricing"];

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

async function fetchPublic(url) {
  const target = new URL(url);
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) {
    throw Object.assign(new Error("PUBLIC_URL_REJECTED"), { code: "PUBLIC_URL_REJECTED" });
  }
  await assertPublicHost(target.hostname);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(target, { redirect: "manual", signal: controller.signal, headers: { "user-agent": "SamuraiOS-PublicProspect/1.0" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("REDIRECT_WITHOUT_LOCATION");
      const next = new URL(location, target);
      if (next.hostname !== target.hostname) throw Object.assign(new Error("CROSS_ORIGIN_REDIRECT"), { code: "CROSS_ORIGIN_REDIRECT" });
      return fetchPublic(next.toString());
    }
    if (!response.ok) throw Object.assign(new Error(`PUBLIC_FETCH_${response.status}`), { code: `PUBLIC_FETCH_${response.status}` });
    const reader = response.body?.getReader();
    if (!reader) return { url: target.toString(), text: (await response.text()).slice(0, MAX_BODY_BYTES) };
    const chunks = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) break;
      chunks.push(Buffer.from(value));
    }
    return { url: target.toString(), text: Buffer.concat(chunks).toString("utf8").slice(0, MAX_BODY_BYTES) };
  } finally { clearTimeout(timer); }
}

function stripHtml(html) {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ").trim();
}

function emails(text) {
  const found = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return [...new Set(found.map(x => x.toLowerCase()).filter(x =>
    !/(example\.com|noreply|no-reply|privacy|unsubscribe|donotreply)/i.test(x)))].slice(0, 10);
}

function qualify(text) {
  const t = text.toLowerCase();
  let score = 5;
  const signals = [];
  if (/(saas|software|platform|api|cloud|subscription|software as a service)/i.test(t)) { score += 25; signals.push("software"); }
  if (/(b2b|enterprise|businesses|companies|teams)/i.test(t)) { score += 20; signals.push("b2b"); }
  if (/(sales|revenue|pipeline|crm|leads|revops|go-to-market|gtm)/i.test(t)) { score += 30; signals.push("revenue_pain"); }
  if (/(ceo|chief executive|founder|co-founder|cro|chief revenue|head of sales|head of revenue|revenue operations|revops|vp sales|vp revenue|sales director|revenue director)/i.test(t)) { score += 20; signals.push("decision_maker_signal"); }
  return { score: Math.min(100, score), intent: score >= 70 ? "hot" : score >= 45 ? "warm" : "cold", signals };
}

async function crawlCompany(company, tenantId, dealValueKZT, grossMarginRate) {
  const root = clean(company.domain || company.website || "", 512);
  if (!root) return null;
  const base = /^https?:\/\//i.test(root) ? new URL(root) : new URL(`https://${root}`);
  const origin = base.origin;
  const queue = [origin];
  const visited = new Set();
  let combined = "";
  const sources = [];
  while (queue.length && visited.size < MAX_PAGES) {
    const url = queue.shift();
    const u = new URL(url);
    if (u.origin !== origin || visited.has(u.href)) continue;
    visited.add(u.href);
    try {
      const page = await fetchPublic(u.href);
      combined += " " + stripHtml(page.text);
      sources.push(page.url);
      const links = [...page.text.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1]);
      for (const link of links) {
        try {
          const x = new URL(link, origin);
          if (x.origin === origin && PATHS.includes(x.pathname) && !visited.has(x.href)) queue.push(x.href);
        } catch (_) {}
      }
    } catch (_) {}
  }
  if (!combined) return null;
  const q = qualify(combined);
  const contactEmails = emails(combined);
  const email = contactEmails[0] || null;
  const lead = {
    firstName: null, lastName: null, email,
    company: clean(company.name || base.hostname, 200),
    website: origin,
    publicProspect: true
  };
  const leadId = clean(email || lead.company, 256);
  const correlationId = `public_${leadId.replace(/[^a-z0-9_-]/gi, "_")}`;
  let decision;
  try {
    decision = revenueRuntime.decide(tenantId, {
      leadScore: q.score, intent: q.intent, dealValue: dealValueKZT,
      grossMargin: grossMarginRate, triggerRelevance: q.score / 100,
      contactAllowed: Boolean(email), customerOptedOut: false, risk: 0,
      leadId, correlationId
    }).record;
  } catch (error) { decision = { error: error.message }; }
  revenueRuntime.recordObservation(tenantId, {
    observationId: `public_qualify:${correlationId}`, source: "public-web",
    sourceId: leadId, correlationId, leadId, observation: "public_prospect",
    score: q.score, intent: q.intent, signals: q.signals, sourceUrls: sources,
    emailAvailable: Boolean(email), company: lead.company,
    decisionAction: decision?.action || decision?.recommendedAction || "UNKNOWN"
  });
  const saved = saveLead({
    source: "public-web", sourceId: leadId, eventKey: `public:${tenantId}:${leadId}`,
    status: "completed", ...lead, ...q, correlationId, revenueDecision: decision,
    sourceUrls: sources
  });
  return { id: saved.id, lead, qualification: q, decision, sourceUrls: sources };
}

async function discoverAndQualify({ tenantId = "default", companies = [], maxProspects = 5,
  dealValueKZT = Number(process.env.DEFAULT_DEAL_VALUE_KZT || 200000),
  grossMarginRate = Number(process.env.DEFAULT_GROSS_MARGIN || 0.30) } = {}) {
  const list = Array.isArray(companies) ? companies.slice(0, Math.min(maxProspects, 10)) : [];
  const prospects = [];
  for (const company of list) {
    const result = await crawlCompany(company || {}, tenantId, dealValueKZT, grossMarginRate);
    if (result) prospects.push(result);
  }
  return { enabled: true, discovered: list.length, qualified: prospects.length, prospects };
}

function parseCompanies(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(x => x && typeof x === "object") : [];
  } catch (_) { return []; }
}

module.exports = { discoverAndQualify, qualify, parseCompanies, isPrivateIp };
