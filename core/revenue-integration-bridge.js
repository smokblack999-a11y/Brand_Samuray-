"use strict";

/**
 * Thin provider bridge for the autonomous revenue loop.
 * Business decisions stay in X26/X27/X33; this module only translates
 * approved internal actions to external providers.
 */

const DEFAULT_TIMEOUT_MS = 10000;

function clean(value, max = 512) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function envBool(name, fallback = false) {
  const raw = String(process.env[name] ?? fallback).toLowerCase();
  return raw === "true" || raw === "1";
}

function providerConfig() {
  return {
    stripe: Boolean(process.env.STRIPE_SECRET_KEY),
    hubspot: Boolean(process.env.HUBSPOT_ACCESS_TOKEN),
    posthog: Boolean(process.env.POSTHOG_API_KEY),
    apolloInbound: Boolean(process.env.APOLLO_INGEST_SECRET),
    enabled: envBool("REVENUE_INTEGRATIONS_ENABLED", false)
  };
}

async function requestJson(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const raw = await response.text();
    let body = null;
    try { body = raw ? JSON.parse(raw) : null; } catch (_) { body = { raw: raw.slice(0, 2000) }; }
    if (!response.ok) {
      const error = new Error(`Provider request failed: ${response.status}`);
      error.status = response.status;
      error.body = body;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function capturePostHog({ event, distinctId, properties = {} }) {
  if (!process.env.POSTHOG_API_KEY) return { skipped: true, reason: "POSTHOG_NOT_CONFIGURED" };
  const host = String(process.env.POSTHOG_HOST || "https://us.i.posthog.com").replace(/\/$/, "");
  return requestJson(`${host}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.POSTHOG_API_KEY,
      event: clean(event, 128),
      distinct_id: clean(distinctId, 256) || "anonymous",
      properties: {
        ...properties,
        $lib: "samurai-revenue-bridge",
        environment: process.env.NODE_ENV || "development"
      }
    })
  });
}

async function syncHubSpotContact(lead = {}) {
  if (!process.env.HUBSPOT_ACCESS_TOKEN) return { skipped: true, reason: "HUBSPOT_NOT_CONFIGURED" };
  const properties = {};
  for (const [key, value] of Object.entries({
    email: lead.email,
    firstname: lead.firstName,
    lastname: lead.lastName,
    company: lead.company,
    website: lead.website,
    phone: lead.phone
  })) {
    if (value != null && String(value).trim()) properties[key] = clean(value, 512);
  }
  if (!properties.email && !properties.company) {
    throw Object.assign(new Error("email or company is required"), { code: "HUBSPOT_LEAD_IDENTITY_REQUIRED" });
  }
  return requestJson("https://api.hubapi.com/crm/v3/objects/contacts", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ properties })
  });
}

async function createStripeCheckout({ amountMinor, currency, productName, correlationId, tenantId }) {
  if (!process.env.STRIPE_SECRET_KEY) return { skipped: true, reason: "STRIPE_NOT_CONFIGURED" };
  const amount = Number(amountMinor);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw Object.assign(new Error("amountMinor must be a positive integer"), { code: "STRIPE_AMOUNT_REQUIRED" });
  }
  const successUrl = clean(process.env.STRIPE_SUCCESS_URL, 2000);
  const cancelUrl = clean(process.env.STRIPE_CANCEL_URL, 2000);
  if (!successUrl || !cancelUrl) {
    throw Object.assign(new Error("STRIPE_SUCCESS_URL and STRIPE_CANCEL_URL are required"), { code: "STRIPE_REDIRECTS_REQUIRED" });
  }

  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("line_items[0][quantity]", "1");
  form.set("line_items[0][price_data][currency]", clean(currency || process.env.STRIPE_CURRENCY || "usd", 3).toLowerCase());
  form.set("line_items[0][price_data][unit_amount]", String(amount));
  form.set("line_items[0][price_data][product_data][name]", clean(productName || "SamuraiOS", 250));
  form.set("success_url", successUrl);
  form.set("cancel_url", cancelUrl);
  if (tenantId) form.set("metadata[tenant_id]", clean(tenantId, 128));
  if (correlationId) form.set("metadata[correlation_id]", clean(correlationId, 256));

  return requestJson("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: form.toString()
  });
}

async function syncLead({ lead = {}, tenantId = "default", correlationId = "" } = {}) {
  if (!providerConfig().enabled) return { enabled: false, providers: providerConfig() };
  const result = {
    enabled: true,
    hubspot: null,
    posthog: null
  };
  result.hubspot = await syncHubSpotContact(lead);
  result.posthog = await capturePostHog({
    event: "revenue_lead_synced",
    distinctId: lead.email || lead.company || correlationId || "anonymous",
    properties: {
      tenant_id: clean(tenantId, 128),
      correlation_id: clean(correlationId, 256),
      source: "autonomous-revenue-loop"
    }
  });
  return result;
}

async function recordRevenueEvent({ type, tenantId, correlationId, payload = {} } = {}) {
  if (!providerConfig().enabled) return { enabled: false, providers: providerConfig() };
  return capturePostHog({
    event: clean(type, 128),
    distinctId: clean(tenantId, 128) || "default",
    properties: {
      tenant_id: clean(tenantId, 128),
      correlation_id: clean(correlationId, 256),
      ...payload
    }
  });
}

module.exports = {
  providerConfig,
  syncLead,
  recordRevenueEvent,
  createStripeCheckout,
  capturePostHog
};
