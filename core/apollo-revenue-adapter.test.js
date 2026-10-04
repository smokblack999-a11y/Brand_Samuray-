"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const { apolloConfig, qualifyPerson, flattenPerson } = require("./apollo-revenue-adapter");

test("Apollo configuration is disabled unless integration flag is enabled", () => {
  const oldEnabled = process.env.REVENUE_INTEGRATIONS_ENABLED;
  const oldKey = process.env.APOLLO_API_KEY;
  process.env.REVENUE_INTEGRATIONS_ENABLED = "false";
  process.env.APOLLO_API_KEY = "test";
  const c = apolloConfig();
  assert.equal(c.configured, true);
  assert.equal(c.enabled, false);
  if (oldEnabled == null) delete process.env.REVENUE_INTEGRATIONS_ENABLED;
  else process.env.REVENUE_INTEGRATIONS_ENABLED = oldEnabled;
  if (oldKey == null) delete process.env.APOLLO_API_KEY;
  else process.env.APOLLO_API_KEY = oldKey;
});

test("Qualification favors decision makers while staying bounded", () => {
  const result = qualifyPerson({
    title: "Chief Technology Officer",
    seniority: "c_suite",
    organization: { name: "Example", primary_domain: "example.com", num_employees: 120 }
  });
  assert.equal(result.score, 100);
  assert.equal(result.intent, "hot");
});

test("Apollo person is flattened into internal lead identity without fabricating fields", () => {
  const result = flattenPerson({
    id: "person-1",
    first_name: "A",
    last_name: "B",
    title: "Founder",
    organization: { id: "org-1", name: "Example", primary_domain: "example.com" },
    organization_id: "org-1",
    linkedin_url: "https://www.linkedin.com/in/example"
  });
  assert.equal(result.firstName, "A");
  assert.equal(result.company, "Example");
  assert.equal(result.website, "https://example.com");
  assert.equal(result.email, undefined);
  assert.equal(result.apolloPersonId, "person-1");
});
