"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const discovery = require("./public-discovery-adapter");

test("Public discovery builds deterministic multi-angle queries", () => {
  const queries = discovery.buildQueries({
    niche: "B2B SaaS",
    geography: "Kazakhstan",
    pain: "revenue CRM"
  });
  assert.equal(queries.length, 3);
  assert.match(queries[0], /B2B SaaS/);
  assert.match(queries[0], /Kazakhstan/);
  assert.match(queries[2], /CRM pipeline leads platform/);
});

test("SSRF guard rejects private and local addresses", () => {
  assert.equal(discovery.isPrivateIp("127.0.0.1"), true);
  assert.equal(discovery.isPrivateIp("10.0.0.1"), true);
  assert.equal(discovery.isPrivateIp("192.168.1.10"), true);
  assert.equal(discovery.isPrivateIp("172.16.0.1"), true);
  assert.equal(discovery.isPrivateIp("8.8.8.8"), false);
  assert.equal(discovery.isPrivateIp("::1"), true);
});

test("Discovery fails closed when no provider credentials are configured", async () => {
  const oldProvider = process.env.PUBLIC_DISCOVERY_PROVIDER;
  const oldEndpoint = process.env.PUBLIC_DISCOVERY_ENDPOINT;
  const oldKey = process.env.PUBLIC_DISCOVERY_API_KEY;
  process.env.PUBLIC_DISCOVERY_PROVIDER = "none";
  delete process.env.PUBLIC_DISCOVERY_ENDPOINT;
  delete process.env.PUBLIC_DISCOVERY_API_KEY;

  const result = await discovery.discoverCompanies({ query: "B2B SaaS revenue", maxResults: 5 });
  assert.equal(result.enabled, false);
  assert.equal(result.reason, "PUBLIC_DISCOVERY_NOT_CONFIGURED");

  if (oldProvider == null) delete process.env.PUBLIC_DISCOVERY_PROVIDER;
  else process.env.PUBLIC_DISCOVERY_PROVIDER = oldProvider;
  if (oldEndpoint == null) delete process.env.PUBLIC_DISCOVERY_ENDPOINT;
  else process.env.PUBLIC_DISCOVERY_ENDPOINT = oldEndpoint;
  if (oldKey == null) delete process.env.PUBLIC_DISCOVERY_API_KEY;
  else process.env.PUBLIC_DISCOVERY_API_KEY = oldKey;
});

test("Provider result cap stays bounded", () => {
  const old = process.env.PUBLIC_DISCOVERY_MAX_RESULTS;
  process.env.PUBLIC_DISCOVERY_MAX_RESULTS = "999";
  assert.equal(discovery.providerConfig().maxResults, 20);
  if (old == null) delete process.env.PUBLIC_DISCOVERY_MAX_RESULTS;
  else process.env.PUBLIC_DISCOVERY_MAX_RESULTS = old;
});
