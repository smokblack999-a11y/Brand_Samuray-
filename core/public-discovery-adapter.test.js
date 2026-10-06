"use strict";

const assert = require("node:assert/strict");
const discovery = require("./public-discovery-adapter");

const queries = discovery.buildQueries({
  niche: "B2B SaaS",
  geography: "US",
  pain: "revenue operations"
});
assert.equal(queries.length, 3);
assert.ok(queries.every(q => q.includes("B2B SaaS")));

process.env.PUBLIC_DISCOVERY_PROVIDER = "none";
process.env.PUBLIC_DISCOVERY_ENDPOINT = "";
process.env.PUBLIC_DISCOVERY_API_KEY = "";
const result = await discovery.discover({ niche: "B2B SaaS", maxResults: 3 });
assert.equal(result.enabled, false);
assert.equal(result.reason, "PUBLIC_DISCOVERY_NOT_CONFIGURED");
assert.deepEqual(result.companies, []);

console.log("public-discovery-adapter.test.js: PASS");
