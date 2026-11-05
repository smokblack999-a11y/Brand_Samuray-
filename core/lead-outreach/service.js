"use strict";

const ALLOWED_STAGES = new Set(["new", "qualified", "draft_ready", "contacted", "replied", "meeting", "proposal", "won", "lost", "do_not_contact"]);

function scoreLead(candidate) {
  let score = 0;
  const reasons = [];
  if (candidate.company) { score += 15; reasons.push("company identified (+15)"); }
  if (candidate.website) { score += 10; reasons.push("website/domain available (+10)"); }
  if (candidate.title && /founder|owner|chief|ceo|president|director|head|vp|vice president/i.test(candidate.title)) {
    score += 25; reasons.push("title suggests decision-making responsibility (+25)");
  }
  if (candidate.email) { score += 15; reasons.push("email field present; deliverability not verified (+15)"); }
  if (candidate.location) { score += 5; reasons.push("location identified (+5)"); }
  if (candidate.rawStatus && /verified|valid/i.test(candidate.rawStatus)) {
    score += 10; reasons.push("provider labels email as verified/valid (+10; not independently verified)");
  }
  return { score: Math.min(100, score), scoreReasons: reasons };
}

function cleanText(value, max = 2000) {
  return String(value || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim().slice(0, max);
}

class LeadOutreachService {
  constructor({ store, apollo }) {
    if (!store || !apollo) throw new Error("LeadOutreachService requires store and apollo adapters");
    this.store = store;
    this.apollo = apollo;
  }

  async listLeads() { return this.store.list(); }

  async discover(filters = {}) {
    const normalized = {
      personTitles: Array.isArray(filters.personTitles) ? filters.personTitles.map((x) => cleanText(x, 100)).filter(Boolean).slice(0, 10) : [],
      locations: Array.isArray(filters.locations) ? filters.locations.map((x) => cleanText(x, 100)).filter(Boolean).slice(0, 10) : [],
      domains: Array.isArray(filters.domains) ? filters.domains.map((x) => cleanText(x, 253)).filter(Boolean).slice(0, 25) : [],
      industryTagIds: Array.isArray(filters.industryTagIds) ? filters.industryTagIds.map((x) => cleanText(x, 100)).filter(Boolean).slice(0, 20) : [],
      limit: Math.max(1, Math.min(Number(filters.limit) || 10, 25))
    };
    if (!normalized.personTitles.length && !normalized.locations.length && !normalized.domains.length && !normalized.industryTagIds.length) {
      const error = new Error("At least one search filter is required");
      error.code = "SEARCH_FILTER_REQUIRED";
      error.statusCode = 400;
      throw error;
    }
    const candidates = await this.apollo.search(normalized);
    const saved = [];
    for (const candidate of candidates) {
      const scored = scoreLead(candidate);
      saved.push(await this.store.upsert({
        ...candidate,
        ...scored
      }));
    }
    return saved;
  }

  async createDraft(id, input = {}) {
    const leads = await this.store.list();
    const lead = leads.find((item) => item.id === id);
    if (!lead) return null;
    if (lead.stage === "do_not_contact" || lead.stage === "lost") {
      const error = new Error("Draft blocked for this lead stage");
      error.code = "DRAFT_BLOCKED";
      error.statusCode = 409;
      throw error;
    }
    const subject = cleanText(input.subject || `Question for ${lead.company || "your team"}`, 180);
    const body = cleanText(input.body, 5000);
    if (!body) {
      const error = new Error("Provide a reviewed draft body; this module does not auto-generate or send emails");
      error.code = "DRAFT_BODY_REQUIRED";
      error.statusCode = 400;
      throw error;
    }
    return this.store.update(id, (item) => {
      item.draft = { subject, body, status: "draft_only", createdAt: new Date().toISOString() };
      if (item.stage === "new") item.stage = "draft_ready";
    });
  }

  async setStage(id, stage) {
    const normalized = cleanText(stage, 40).toLowerCase();
    if (!ALLOWED_STAGES.has(normalized)) {
      const error = new Error("Unsupported stage");
      error.code = "INVALID_STAGE";
      error.statusCode = 400;
      throw error;
    }
    return this.store.update(id, (item) => { item.stage = normalized; });
  }
}

module.exports = { LeadOutreachService, scoreLead, ALLOWED_STAGES };
