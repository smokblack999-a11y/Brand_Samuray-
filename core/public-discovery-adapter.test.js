"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const discovery = require("./public-discovery-adapter");

test("buildQueries creates multiple discovery angles", () => {
  const queries = discovery.buildQueries({
    niche: "B2B SaaS",
    geography: "Kazakhstan",
    pain: "revenue CRM"
  });
  assert.equal(queries.length, 4);
  assert.ok(queries.every(q => q.includes("B2B SaaS")));
  assert.match(queries[2], /hiring funding/);
});

test("SSRF guard rejects private and local addresses", () => {
  assert.equal(discovery.isPrivateIp("127.0.0.1"), true);
  assert.equal(discovery.isPrivateIp("10.0.0.1"), true);
  assert.equal(discovery.isPrivateIp("192.168.1.10"), true);
  assert.equal(discovery.isPrivateIp("172.16.0.1"), true);
  assert.equal(discovery.isPrivateIp("8.8.8.8"), false);
  assert.equal(discovery.isPrivateIp("::1"), true);
});

test("Exa-style company entities become scored evidence", () => {
  const result = discovery.normalizeResults({
    results: [{
      id: "exa-1",
      title: "Acme Revenue Platform",
      url: "https://www.acme.example/product",
      summary: "B2B SaaS platform for sales teams and revenue operations.",
      highlights: ["Scaling sales team and expanding into enterprise."],
      entities: [{
        type: "company",
        properties: {
          name: "Acme",
          description: "B2B SaaS software",
          workforce: { total: 120 },
          headquarters: { country: "US" },
          financials: { fundingLatestRound: { name: "Series A", amount: 1000000 } }
        }
      }]
    }]
  }, "exa", 5);
  assert.equal(result.length, 1);
  assert.equal(result[0].domain, "acme.example");
  assert.ok(result[0].evidenceScore >= 60);
  assert.ok(result[0].signals.includes("target_company_size"));
  assert.equal(result[0].funding.name, "Series A");
});

test("Brave LLM Context shape is mapped from grounding.generic", () => {
  const payload = {
    grounding: {
      generic: [{
        url: "https://company.example/about",
        title: "Company",
        snippets: ["B2B SaaS revenue platform for enterprise teams"]
      }]
    },
    sources: {
      "https://company.example/about": {
        title: "Company",
        hostname: "company.example",
        description: "Revenue platform"
      }
    }
  };
  const rows = discovery.normalizeResults({
    results: payload.grounding.generic.map(row => ({
      url: row.url,
      title: row.title,
      description: payload.sources[row.url].description,
      highlights: row.snippets
    }))
  }, "brave-llm", 5);
  assert.equal(rows[0].domain, "company.example");
  assert.ok(rows[0].evidenceScore > 0);
});

test("Discovery fails closed when no provider credentials exist", async () => {
  const saved = {
    providers: process.env.PUBLIC_DISCOVERY_PROVIDERS,
    exa: process.env.EXA_API_KEY,
    brave: process.env.BRAVE_SEARCH_API_KEY,
    legacy: process.env.PUBLIC_DISCOVERY_API_KEY,
    tavily: process.env.TAVILY_API_KEY
  };
  delete process.env.PUBLIC_DISCOVERY_PROVIDERS;
  delete process.env.EXA_API_KEY;
  delete process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.PUBLIC_DISCOVERY_API_KEY;
  delete process.env.TAVILY_API_KEY;
  const result = await discovery.discover({ niche: "B2B SaaS", maxResults: 3 });
  assert.equal(result.enabled, false);
  assert.equal(result.reason, "PUBLIC_DISCOVERY_NOT_CONFIGURED");
  assert.deepEqual(result.companies, []);
  for (const [key, value] of Object.entries(saved)) {
    const envKey = {providers:"PUBLIC_DISCOVERY_PROVIDERS",exa:"EXA_API_KEY",brave:"BRAVE_SEARCH_API_KEY",legacy:"PUBLIC_DISCOVERY_API_KEY",tavily:"TAVILY_API_KEY"}[key];
    if (value == null) delete process.env[envKey];
    else process.env[envKey] = value;
  }
});
