"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");
const { createLeadOutreach, scoreLead } = require("../index");

test("lead scoring is deterministic and explains points", () => {
  const result = scoreLead({
    company: "Example Ltd",
    website: "https://example.com",
    title: "Founder",
    email: "owner@example.com",
    location: "US"
  });
  assert.equal(result.score, 70);
  assert.equal(result.scoreReasons.length, 5);
});

test("discovery deduplicates and requires filters", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "samurai-leads-"));
  const apollo = { async search() { return [
    { source: "apollo", sourceId: "p1", company: "Example", name: "A B", title: "Founder", email: "a@example.com" },
    { source: "apollo", sourceId: "p1", company: "Example", name: "A B", title: "Founder", email: "a@example.com" }
  ]; } };
  const service = createLeadOutreach({ dataDir: dir, apollo });
  await assert.rejects(() => service.discover({}), { code: "SEARCH_FILTER_REQUIRED" });
  const leads = await service.discover({ personTitles: ["Founder"], limit: 10 });
  assert.equal(leads.length, 2);
  assert.equal((await service.listLeads()).length, 1);
  await fs.rm(dir, { recursive: true, force: true });
});

test("draft creation never sends and do-not-contact blocks drafts", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "samurai-leads-"));
  const apollo = { async search() { return [{ source: "apollo", sourceId: "p2", company: "Example", email: "b@example.com" }]; } };
  const service = createLeadOutreach({ dataDir: dir, apollo });
  const [lead] = await service.discover({ domains: ["example.com"] });
  await assert.rejects(() => service.createDraft(lead.id, {}), { code: "DRAFT_BODY_REQUIRED" });
  const updated = await service.createDraft(lead.id, { subject: "Question", body: "Reviewed sample text" });
  assert.equal(updated.draft.status, "draft_only");
  assert.equal(updated.stage, "draft_ready");
  await service.setStage(lead.id, "do_not_contact");
  await assert.rejects(() => service.createDraft(lead.id, { body: "Test" }), { code: "DRAFT_BLOCKED" });
  await fs.rm(dir, { recursive: true, force: true });
});

test("Apollo adapter fails closed when API key is missing", async () => {
  const { ApolloAdapter } = require("../apollo");
  const adapter = new ApolloAdapter({ apiKey: "" });
  await assert.rejects(() => adapter.search({ personTitles: ["Founder"] }), { code: "APOLLO_NOT_CONFIGURED" });
});
