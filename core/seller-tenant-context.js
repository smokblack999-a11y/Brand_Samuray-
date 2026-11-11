"use strict";

const crypto = require("node:crypto");

function requiredId(value, label) {
  const id = String(value || "").trim();
  if (!id || id.length > 160 || /[\r\n]/.test(id)) {
    const error = new Error("Invalid " + label);
    error.code = "SELLER_TENANT_CONFIG_INVALID";
    throw error;
  }
  return id;
}

function parseSellerTenantMap(raw = process.env.SELLER_TENANT_MAP_JSON || "{}") {
  let parsed;
  try { parsed = JSON.parse(raw || "{}"); }
  catch {
    const error = new Error("SELLER_TENANT_MAP_JSON must be valid JSON");
    error.code = "SELLER_TENANT_CONFIG_INVALID";
    throw error;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const error = new Error("SELLER_TENANT_MAP_JSON must be an object");
    error.code = "SELLER_TENANT_CONFIG_INVALID";
    throw error;
  }
  const result = Object.create(null);
  for (const [connectionId, item] of Object.entries(parsed)) {
    const connection = requiredId(connectionId, "business connection ID");
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      const error = new Error("Each seller tenant entry must be an object");
      error.code = "SELLER_TENANT_CONFIG_INVALID";
      throw error;
    }
    const tenantId = requiredId(item.tenantId, "tenant ID");
    const ownerId = requiredId(item.ownerId, "owner ID");
    const ownerToken = String(item.ownerToken || "");
    if (ownerToken.length < 32 || ownerToken.length > 512) {
      const error = new Error("Each seller owner token must contain at least 32 characters");
      error.code = "SELLER_TENANT_CONFIG_INVALID";
      throw error;
    }
    result[connection] = Object.freeze({ tenantId, ownerId, ownerToken });
  }
  return Object.freeze(result);
}

function resolveSellerTenant(businessConnectionId, raw) {
  const connectionId = String(businessConnectionId || "").trim();
  if (!connectionId) return null;
  const map = parseSellerTenantMap(raw);
  const entry = map[connectionId];
  if (!entry) return null;
  return Object.freeze({ tenantId: entry.tenantId, ownerId: entry.ownerId, businessConnectionId: connectionId });
}

function safeEqual(expected, actual) {
  const a = Buffer.from(String(expected || ""));
  const b = Buffer.from(String(actual || ""));
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function authenticateSellerOwner(businessConnectionId, ownerToken, raw) {
  const tenant = resolveSellerTenant(businessConnectionId, raw);
  if (!tenant) return null;
  const map = parseSellerTenantMap(raw);
  const entry = map[tenant.businessConnectionId];
  if (!safeEqual(entry.ownerToken, ownerToken)) return null;
  return Object.freeze({ tenantId: tenant.tenantId, ownerId: tenant.ownerId, businessConnectionId: tenant.businessConnectionId });
}

module.exports = { parseSellerTenantMap, resolveSellerTenant, authenticateSellerOwner };
