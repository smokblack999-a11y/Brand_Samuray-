"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { authenticateSellerOwner, parseSellerTenantMap, resolveSellerTenant } = require("./seller-tenant-context");

const config = JSON.stringify({
  "business-connection-a": {
    tenantId: "tenant-a",
    ownerId: "telegram-owner-100",
    ownerToken: "test-owner-token-with-more-than-32-characters"
  },
  "business-connection-b": {
    tenantId: "tenant-b",
    ownerId: "telegram-owner-200",
    ownerToken: "test-owner-token-for-second-tenant-200"
  }
});

test("Business Connection resolves only to server-side tenant mapping", () => {
  assert.deepEqual(resolveSellerTenant("business-connection-a", config), {
    tenantId: "tenant-a",
    ownerId: "telegram-owner-100",
    businessConnectionId: "business-connection-a"
  });
  assert.equal(resolveSellerTenant("unknown-connection", config), null);
});

test("owner token is required and cannot authorize another tenant", () => {
  assert.equal(authenticateSellerOwner("business-connection-a", "", config), null);
  assert.equal(authenticateSellerOwner("business-connection-a", "wrong-owner-token-with-enough-length", config), null);
  const owner = authenticateSellerOwner("business-connection-a", "test-owner-token-with-more-than-32-characters", config);
  assert.equal(owner.tenantId, "tenant-a");
  assert.equal(owner.ownerId, "telegram-owner-100");
  assert.equal(authenticateSellerOwner("business-connection-b", "test-owner-token-with-more-than-32-characters", config), null);
});

test("invalid or reused owner tokens fail closed", () => {
  assert.throws(() => parseSellerTenantMap("{"), { code: "SELLER_TENANT_CONFIG_INVALID" });
  assert.throws(() => parseSellerTenantMap(JSON.stringify({
    "connection": { tenantId: "tenant-a", ownerId: "owner-a", ownerToken: "short" }
  })), { code: "SELLER_TENANT_CONFIG_INVALID" });
  assert.throws(() => parseSellerTenantMap(JSON.stringify({
    "connection-a": { tenantId: "tenant-a", ownerId: "owner-a", ownerToken: "same-owner-token-01234567890123456789" },
    "connection-b": { tenantId: "tenant-b", ownerId: "owner-b", ownerToken: "same-owner-token-01234567890123456789" }
  })), { code: "SELLER_TENANT_CONFIG_INVALID" });
});
