"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createTelegramLeadCommandHandler, parseCommand } = require("../telegram-commands");

test("parses bot commands with optional bot username", () => {
  assert.deepEqual(parseCommand("/discover@samurai_bot Founder"), { command: "/discover", args: "Founder" });
  assert.equal(parseCommand("hello"), null);
  assert.equal(parseCommand("/unknown"), null);
});

test("refuses non-admin and group access without touching service", async () => {
  let called = false;
  const sent = [];
  const handler = createTelegramLeadCommandHandler({
    enabled: true,
    adminIds: new Set(["123"]),
    service: { async listLeads() { called = true; return []; } },
    sendMessage: async (payload) => sent.push(payload)
  });
  await handler.handleMessage({ text: "/leads", from: { id: 456 }, chat: { id: 456, type: "private" } });
  await handler.handleMessage({ text: "/leads", from: { id: 123 }, chat: { id: -100, type: "supergroup" } });
  assert.equal(called, false);
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /Доступ запрещён/);
});

test("admin can list leads and discover with bounded filters", async () => {
  const sent = [];
  let filters;
  const handler = createTelegramLeadCommandHandler({
    enabled: true,
    adminIds: new Set(["123"]),
    service: {
      async listLeads() { return [{ id: "abc", company: "Example", stage: "new", score: 20 }]; },
      async discover(input) { filters = input; return [{ id: "abc" }]; }
    },
    sendMessage: async (payload) => sent.push(payload)
  });
  const message = (text) => ({ text, from: { id: 123 }, chat: { id: 123, type: "private" } });
  await handler.handleMessage(message("/leads"));
  assert.match(sent[0].message, /Example/);
  await handler.handleMessage(message("/discover Founder,Owner | Kazakhstan | 99"));
  assert.deepEqual(filters, { personTitles: ["Founder", "Owner"], locations: ["Kazakhstan"], limit: 10 });
  assert.match(sent[1].message, /Ничего не отправлялось/);
});

test("draft command saves only a draft and never sends outreach", async () => {
  const sent = [];
  let input;
  const handler = createTelegramLeadCommandHandler({
    enabled: true,
    adminIds: new Set(["123"]),
    service: {
      async createDraft(id, draft) { input = { id, draft }; return { id, company: "Example", stage: "draft_ready" }; }
    },
    sendMessage: async (payload) => sent.push(payload)
  });
  await handler.handleMessage({
    text: "/draft lead-1 | Intro | Hello, would you consider a demo?",
    from: { id: 123 }, chat: { id: 123, type: "private" }
  });
  assert.equal(input.id, "lead-1");
  assert.equal(input.draft.body, "Hello, would you consider a demo?");
  assert.match(sent[0].message, /НЕ отправлено/);
});
