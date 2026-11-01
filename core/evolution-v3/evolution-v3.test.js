"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const auth = require("./auth");
const critic = require("./critic");
const repair = require("./repair-agent");
const seo = require("./seo");
const billing = require("./billing");
const safeRender = require("./safe-render");

test("password hashing uses salted scrypt and rejects wrong passwords", async () => {
  const encoded = await auth.hashPassword("correct horse battery staple");
  assert.match(encoded, /^scrypt\$/);
  assert.equal(await auth.verifyPassword("correct horse battery staple", encoded), true);
  assert.equal(await auth.verifyPassword("wrong password", encoded), false);
  await assert.rejects(() => auth.hashPassword("short"), { code: "PASSWORD_POLICY" });
});

test("session tokens are signed, expiring and tamper evident", () => {
  const secret = "test-secret-that-is-at-least-thirty-two-characters";
  const token = auth.issueSessionToken({ subject: "user-1", secret, now: 1000, ttlSeconds: 600 });
  assert.equal(auth.verifySessionToken(token, { secret, now: 1200 }).subject, "user-1");
  assert.equal(auth.verifySessionToken(token, { secret: secret + "x", now: 1200 }), null);
  assert.equal(auth.verifySessionToken(token, { secret, now: 1601 }), null);
});

test("Kill Critic blocks unsafe HTML and actions without evidence", () => {
  const unsafe = critic.reviewCandidate({ task: "audit", candidate: "<script>alert(1)</script>" });
  assert.equal(unsafe.verdict, "FAIL");
  assert.ok(unsafe.issues.includes("script_tag"));
  const jsUrl = critic.reviewCandidate({ task: "audit", candidate: "See javascript:alert(1) for details." });
  assert.ok(jsUrl.issues.includes("javascript_url"));
  const unsupported = critic.reviewCandidate({
    task: "repair",
    candidate: "A proposed safe change with sufficient descriptive detail.",
    proposedActions: [{ title: "Change title" }]
  });
  assert.equal(unsupported.verdict, "FAIL");
  assert.ok(unsupported.issues.includes("action_without_evidence"));
});

test("repair agent creates proposals but never applies them automatically", () => {
  const proposal = repair.createRepairProposal({
    finding: "Missing title tag",
    evidence: { id: "ev-1", source: "html-crawl" },
    suggestedPatch: "<title>Example</title>"
  });
  assert.equal(proposal.status, "PROPOSED");
  assert.equal(proposal.autoApply, false);
  assert.equal(proposal.requiresHumanApproval, true);
  const approved = repair.approveProposal(proposal, { id: "operator-1" });
  assert.equal(approved.applied, false);
});

test("SEO audit requires valid public HTTP(S) origin and never invents a score", () => {
  assert.equal(seo.normalizeWebsite("https://example.com/path"), "https://example.com");
  assert.throws(() => seo.normalizeWebsite("file:///etc/passwd"));
  assert.throws(() => seo.normalizeWebsite("http://localhost:8080"));
  assert.throws(() => seo.normalizeWebsite("http://127.0.0.1"));
  assert.throws(() => seo.normalizeWebsite("http://[::1]"));
  const audit = seo.createAuditRecord({ website: "https://example.com" });
  assert.equal(audit.score, null);
  assert.equal(audit.scoreStatus, "NOT_COMPUTED");
});

test("safe rendering escapes HTML injection characters", () => {
  assert.equal(safeRender.escapeHtml("<img src=x onerror='alert(1)'>"), "&lt;img src=x onerror=&#39;alert(1)&#39;&gt;");
});

test("Stripe signature verification requires raw body and a fresh valid signature", () => {
  const secret = "whsec_test_secret";
  const now = 1700000000;
  const rawBody = Buffer.from(JSON.stringify({ id: "evt_1", type: "invoice.paid" }));
  const digest = crypto.createHmac("sha256", secret).update(now + "." + rawBody.toString("utf8")).digest("hex");
  const header = "t=" + now + ",v1=" + digest;
  assert.equal(billing.verifyStripeSignature(rawBody, header, secret, { now }), true);
  assert.equal(billing.verifyStripeSignature(rawBody, header, secret, { now: now + 600 }), false);
  assert.equal(billing.verifyStripeSignature(Buffer.from("{}"), header, secret, { now }), false);
  assert.throws(() => billing.verifyStripeSignature("{}", header, secret, { now }), /raw_request_body_buffer_required/);
});

test("Stripe event handler requires durable idempotency and reconciliation", async () => {
  const secret = "whsec_test_secret";
  const now = 1700000000;
  const event = { id: "evt_2", type: "invoice.paid", data: { object: { id: "in_1" } } };
  const rawBody = Buffer.from(JSON.stringify(event));
  const digest = crypto.createHmac("sha256", secret).update(now + "." + rawBody.toString("utf8")).digest("hex");
  const signature = "t=" + now + ",v1=" + digest;
  let reconciled = 0;
  const eventStore = { claim: async () => ({ claimed: true }), complete: async () => {} };
  const result = await billing.handleStripeWebhook({
    rawBody, signature, secret, now,
    eventStore,
    reconcileSubscription: async () => { reconciled += 1; }
  });
  assert.equal(result.status, 200);
  assert.equal(reconciled, 1);
  await assert.rejects(() => billing.handleStripeWebhook({
    rawBody, signature, secret, now,
    eventStore: null,
    reconcileSubscription: async () => {}
  }), /durable_event_store_required/);
});

test("Checkout is fail-closed until test prices and HTTPS app URL are configured", async () => {
  const previousPrice = process.env.STRIPE_PRICE_STARTER;
  const previousSecret = process.env.STRIPE_SECRET_KEY;
  const previousUrl = process.env.EVOLUTION_PUBLIC_URL;
  delete process.env.STRIPE_PRICE_STARTER;
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.EVOLUTION_PUBLIC_URL;
  await assert.rejects(() => billing.createCheckoutSession({
    plan: "starter", workspaceId: "workspace-1", customerEmail: "buyer@example.com",
    idempotencyKey: "idempotency-key-123456"
  }), /stripe_price_not_configured_for_plan/);
  await assert.rejects(() => billing.createCheckoutSession({
    plan: "enterprise", workspaceId: "workspace-1", customerEmail: "buyer@example.com",
    idempotencyKey: "idempotency-key-123456"
  }), /unsupported_plan/);
  if (previousPrice === undefined) delete process.env.STRIPE_PRICE_STARTER; else process.env.STRIPE_PRICE_STARTER = previousPrice;
  if (previousSecret === undefined) delete process.env.STRIPE_SECRET_KEY; else process.env.STRIPE_SECRET_KEY = previousSecret;
  if (previousUrl === undefined) delete process.env.EVOLUTION_PUBLIC_URL; else process.env.EVOLUTION_PUBLIC_URL = previousUrl;
});
