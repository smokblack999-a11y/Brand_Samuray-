"use strict";

const { URL } = require("node:url");
const net = require("node:net");

function normalizeWebsite(input) {
  let url;
  try { url = new URL(String(input || "")); } catch { throw new Error("valid_website_url_required"); }
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("http_or_https_required");
  if (url.username || url.password) throw new Error("url_credentials_not_allowed");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (net.isIP(hostname)) throw new Error("ip_literal_targets_not_allowed");
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname.endsWith(".test")
  ) throw new Error("local_hosts_not_allowed");
  return url.origin;
}
function createAuditRecord({ website, evidence = [], provider = "manual" }) {
  const normalized = normalizeWebsite(website);
  const cleanEvidence = evidence.map(item => {
    if (!item || typeof item.id !== "string" || !item.id || typeof item.kind !== "string") throw new Error("evidence_items_require_id_and_kind");
    return { id: item.id, kind: item.kind, source: String(item.source || provider), observedAt: item.observedAt || null };
  });
  return {
    id: require("node:crypto").randomUUID(),
    website: normalized,
    status: "EVIDENCE_PENDING",
    score: null,
    scoreStatus: "NOT_COMPUTED",
    evidence: cleanEvidence,
    createdAt: new Date().toISOString(),
    note: "No crawl, ranking, traffic, or Search Console data is inferred by this record."
  };
}
module.exports = { normalizeWebsite, createAuditRecord };
