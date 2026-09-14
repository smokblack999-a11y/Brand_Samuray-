"use strict";

const net = require("node:net");

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal"
]);

function isPrivateIp(hostname) {
  const ipVersion = net.isIP(hostname);
  if (ipVersion === 4) {
    const [a, b] = hostname.split(".").map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a === 0;
  }
  if (ipVersion === 6) {
    const value = hostname.toLowerCase();
    return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:");
  }
  return false;
}

function validateFetchUrl(rawUrl, options = {}) {
  const allowedProtocols = options.allowedProtocols || ["https:"];
  let url;
  try {
    url = new URL(String(rawUrl));
  } catch {
    return { ok: false, code: "INVALID_URL" };
  }

  if (!allowedProtocols.includes(url.protocol)) return { ok: false, code: "PROTOCOL_NOT_ALLOWED" };
  if (url.username || url.password) return { ok: false, code: "CREDENTIALS_IN_URL" };

  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(hostname) || isPrivateIp(hostname)) return { ok: false, code: "PRIVATE_HOST_BLOCKED" };

  return { ok: true, url: url.toString(), hostname };
}

module.exports = { validateFetchUrl, isPrivateIp };
