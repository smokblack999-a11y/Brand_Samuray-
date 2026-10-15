"use strict";

const { LeadOutreachService } = require("./service");
const { JsonLeadStore } = require("./store");
const { ApolloAdapter } = require("./apollo");

function createLeadOutreach(options = {}) {
  const store = options.store || new JsonLeadStore(options.dataDir);
  const apollo = options.apollo || new ApolloAdapter({ apiKey: options.apolloApiKey });
  return new LeadOutreachService({ store, apollo });
}

function createLeadOutreachRouter(options = {}) {
  // Express is injected by the host app; this module does not add a dependency.
  const express = options.express || require("express");
  const router = express.Router();
  const service = options.service || createLeadOutreach(options);
  const maxBodyBytes = 16 * 1024;

  router.use(express.json({ limit: maxBodyBytes }));
  router.get("/leads", async (req, res, next) => {
    try {
      res.json({ ok: true, leads: await service.listLeads() });
    } catch (error) { next(error); }
  });
  router.post("/discover", async (req, res, next) => {
    try {
      const leads = await service.discover(req.body || {});
      res.status(200).json({ ok: true, count: leads.length, leads });
    } catch (error) {
      const status = error.statusCode || 500;
      res.status(status).json({ ok: false, error: { code: error.code || "LEAD_OUTREACH_ERROR", message: status === 500 ? "Lead discovery failed" : error.message } });
    }
  });
  router.post("/leads/:id/draft", async (req, res, next) => {
    try {
      const lead = await service.createDraft(req.params.id, req.body || {});
      if (!lead) return res.status(404).json({ ok: false, error: { code: "LEAD_NOT_FOUND" } });
      res.json({ ok: true, lead, sent: false });
    } catch (error) { next(error); }
  });
  router.patch("/leads/:id/stage", async (req, res, next) => {
    try {
      const lead = await service.setStage(req.params.id, req.body && req.body.stage);
      if (!lead) return res.status(404).json({ ok: false, error: { code: "LEAD_NOT_FOUND" } });
      res.json({ ok: true, lead });
    } catch (error) {
      res.status(error.statusCode || 400).json({ ok: false, error: { code: error.code || "INVALID_STAGE", message: error.message } });
    }
  });
  return router;
}

module.exports = { createLeadOutreach, createLeadOutreachRouter, LeadOutreachService, JsonLeadStore, ApolloAdapter };
