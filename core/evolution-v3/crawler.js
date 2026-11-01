"use strict";

const dns = require("node:dns").promises;
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");

const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 3;
const DEFAULT_MAX_BYTES = 1024 * 1024;

function ipv4IsPublic(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a,b] = p;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 192 && b === 0 && p[2] === 2) return false;
  if (a === 198 && (b === 18 || b === 19 || b === 51)) return false;
  if (a === 203 && b === 0 && p[2] === 113) return false;
  return true;
}

function ipv6IsPublic(ip) {
  const value = ip.toLowerCase().split("%")[0];
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice(7);
    if (net.isIP(mapped) === 4) return ipv4IsPublic(mapped);
    return false;
  }
  if (!value.startsWith("2") && !value.startsWith("3")) return false;
  if (value.startsWith("2001:db8:") || value.startsWith("2001:0000:") ||
      value.startsWith("2001:2:") || value.startsWith("2002:")) return false;
  return true;
}

function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return ipv4IsPublic(address);
  if (family === 6) return ipv6IsPublic(address);
  return false;
}

function validateTarget(input) {
  let url;
  try { url = new URL(String(input || "")); }
  catch { throw Object.assign(new Error("valid_url_required"), { code: "INVALID_URL" }); }
  if (!["http:", "https:"].includes(url.protocol)) throw Object.assign(new Error("http_or_https_required"), { code: "INVALID_PROTOCOL" });
  if (url.username || url.password) throw Object.assign(new Error("url_credentials_not_allowed"), { code: "URL_CREDENTIALS" });
  if (url.port && !["80", "443"].includes(url.port)) throw Object.assign(new Error("nonstandard_port_not_allowed"), { code: "PORT_BLOCKED" });
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host.endsWith(".test") || host.endsWith(".invalid")) {
    throw Object.assign(new Error("local_or_reserved_hostname_blocked"), { code: "HOST_BLOCKED" });
  }
  if (net.isIP(host)) throw Object.assign(new Error("ip_literal_targets_not_allowed"), { code: "IP_LITERAL_BLOCKED" });
  url.hash = "";
  return url;
}

async function resolvePublic(hostname, lookup = dns.lookup) {
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (!Array.isArray(records) || records.length === 0) throw Object.assign(new Error("hostname_has_no_addresses"), { code: "DNS_EMPTY" });
  if (records.some(record => !record || !isPublicAddress(record.address))) {
    throw Object.assign(new Error("hostname_resolves_to_non_public_address"), { code: "DNS_PRIVATE_ADDRESS" });
  }
  return records;
}

function requestPinned(url, addresses, { timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? https : http;
    const selected = addresses[0];
    const request = transport.request(url, {
      method: "GET",
      headers: { "User-Agent": "SAMURAI-EVOLUTION-Audit/1.0", "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1" },
      lookup: (_hostname, _options, callback) => callback(null, selected.address, net.isIP(selected.address)),
      servername: url.hostname
    }, response => {
      const chunks = [];
      let size = 0;
      response.on("data", chunk => {
        size += chunk.length;
        if (size > maxBytes) {
          request.destroy(Object.assign(new Error("response_too_large"), { code: "RESPONSE_TOO_LARGE" }));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ statusCode: response.statusCode || 0, headers: response.headers, body: Buffer.concat(chunks) }));
      response.on("error", reject);
    });
    request.setTimeout(timeoutMs, () => request.destroy(Object.assign(new Error("request_timeout"), { code: "REQUEST_TIMEOUT" })));
    request.on("error", reject);
    request.end();
  });
}

async function fetchPublicPage(input, options = {}) {
  const lookup = options.lookup || dns.lookup;
  const request = options.request || requestPinned;
  const maxBytes = Math.max(1024, Math.min(Number(options.maxBytes || DEFAULT_MAX_BYTES), 5 * 1024 * 1024));
  const timeoutMs = Math.max(1000, Math.min(Number(options.timeoutMs || 10000), 30000));
  let url = validateTarget(input);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const addresses = await resolvePublic(url.hostname, lookup);
    const response = await request(url, addresses, { timeoutMs, maxBytes });
    if (REDIRECT_CODES.has(response.statusCode)) {
      if (redirects === MAX_REDIRECTS) throw Object.assign(new Error("redirect_limit_exceeded"), { code: "REDIRECT_LIMIT" });
      const location = response.headers && response.headers.location;
      if (!location) throw Object.assign(new Error("redirect_location_missing"), { code: "REDIRECT_INVALID" });
      url = validateTarget(new URL(location, url).toString());
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw Object.assign(new Error("upstream_http_error"), { code: "UPSTREAM_HTTP_ERROR", statusCode: response.statusCode });
    }
    const contentType = String(response.headers && response.headers["content-type"] || "").toLowerCase();
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw Object.assign(new Error("html_content_required"), { code: "CONTENT_TYPE_BLOCKED" });
    }
    return { url: url.origin + url.pathname + url.search, statusCode: response.statusCode, contentType, bytes: response.body.length, body: response.body.toString("utf8") };
  }
  throw Object.assign(new Error("redirect_limit_exceeded"), { code: "REDIRECT_LIMIT" });
}

module.exports = { isPublicAddress, validateTarget, resolvePublic, fetchPublicPage };
