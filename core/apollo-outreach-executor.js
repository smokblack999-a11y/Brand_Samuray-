"use strict";

const API_BASE = "https://api.apollo.io/api/v1";
const TIMEOUT_MS = 10000;
const { assertAuthorization } = require("./revenue-execution-gate");

function clean(v, max = 512) {
  return String(v == null ? "" : v).trim().slice(0, max);
}

function configured() {
  return Boolean(clean(process.env.APOLLO_API_KEY, 512));
}

function enabled() {
  return String(process.env.APOLLO_AUTONOMOUS_OUTREACH_ENABLED || "false").toLowerCase() === "true" &&
    String(process.env.REVENUE_AUTONOMOUS_EXECUTION_ENABLED || "false").toLowerCase() === "true";
}

async function request(path, body) {
  if (!configured()) {
    throw Object.assign(new Error("APOLLO_API_NOT_CONFIGURED"), { code: "APOLLO_API_NOT_CONFIGURED" });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(API_BASE + path, {
      method: "POST",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        "x-api-key": process.env.APOLLO_API_KEY,
        "accept": "application/json",
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (response.status >= 300 && response.status < 400) {
      throw Object.assign(new Error("APOLLO_REDIRECT_BLOCKED"), { code: "APOLLO_REDIRECT_BLOCKED" });
    }
    const text = (await response.text()).slice(0, 500000);
    let payload = {};
    try { payload = text ? JSON.parse(text) : {}; } catch (_) {}
    if (!response.ok) {
      const code = `APOLLO_HTTP_${response.status}`;
      throw Object.assign(new Error(payload?.message || code), { code, status: response.status, payload });
    }
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

function contactPayload(lead) {
  const body = {
    first_name: clean(lead?.firstName, 120) || undefined,
    last_name: clean(lead?.lastName, 120) || undefined,
    organization_name: clean(lead?.company, 200) || undefined,
    title: clean(lead?.title, 200) || undefined,
    email: clean(lead?.email, 320) || undefined,
    website_url: clean(lead?.website, 1000) || undefined,
    run_dedupe: true
  };
  return Object.fromEntries(Object.entries(body).filter(([, value]) => value !== undefined));
}

async function createOrUpsertContact(lead) {
  if (!lead?.email || !lead?.firstName && !lead?.lastName) {
    throw Object.assign(new Error("APOLLO_CONTACT_IDENTITY_INSUFFICIENT"), {
      code: "APOLLO_CONTACT_IDENTITY_INSUFFICIENT"
    });
  }
  const payload = await request("/contacts", contactPayload(lead));
  const contact = payload?.contact || payload?.contacts?.[0] || payload;
  if (!contact?.id) {
    throw Object.assign(new Error("APOLLO_CONTACT_RESPONSE_INVALID"), { code: "APOLLO_CONTACT_RESPONSE_INVALID" });
  }
  return contact;
}

async function addContactToSequence(contactId, {
  sequenceId = process.env.APOLLO_AUTONOMOUS_SEQUENCE_ID,
  emailAccountId = process.env.APOLLO_AUTONOMOUS_EMAIL_ACCOUNT_ID
} = {}) {
  if (!sequenceId || !emailAccountId) {
    throw Object.assign(new Error("APOLLO_SEQUENCE_CONFIGURATION_MISSING"), {
      code: "APOLLO_SEQUENCE_CONFIGURATION_MISSING"
    });
  }
  return request(
    `/emailer_campaigns/${encodeURIComponent(sequenceId)}/add_contact_ids?emailer_campaign_id=${encodeURIComponent(sequenceId)}`,
    {
      contact_ids: [contactId],
      send_email_from_email_account_id: emailAccountId,
      sequence_no_email: false,
      sequence_unverified_email: false,
      sequence_job_change: false,
      sequence_active_in_other_campaigns: false,
      sequence_finished_in_other_campaigns: false,
      sequence_same_company_in_same_campaign: false,
      contacts_without_ownership_permission: false,
      add_if_in_queue: false,
      contact_verification_skipped: false,
      status: "active"
    }
  );
}

async function executePlan(plan) {
  if (!enabled()) {
    return { executed: false, status: "BLOCKED", reason: "OUTREACH_EXECUTION_KILL_SWITCH_OFF" };
  }
  if (plan?.actionPlan?.status !== "READY_FOR_EXECUTION") {
    return { executed: false, status: "BLOCKED", reason: "ACTION_PLAN_NOT_READY" };
  }
  assertAuthorization(plan.executionAuthorization);

  const contact = await createOrUpsertContact(plan.lead);
  const sequence = await addContactToSequence(contact.id);

  return {
    executed: true,
    status: "ENROLLED",
    contactId: contact.id,
    sequenceId: clean(process.env.APOLLO_AUTONOMOUS_SEQUENCE_ID, 256),
    sequenceResult: sequence
  };
}

module.exports = { configured, enabled, contactPayload, createOrUpsertContact, addContactToSequence, executePlan };
