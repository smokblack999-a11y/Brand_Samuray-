"use strict";

const { normalizeWorkflowRun } = require("./nexus-workflow-intake");

function handleWorkflowRun(payload, store) {
  const job = normalizeWorkflowRun(payload);
  if (!job) return { accepted: false, reason: "ignored" };
  const existing = store.get(job.jobId);
  if (existing) return { accepted: false, reason: "duplicate", job: existing };
  return { accepted: true, job: store.enqueue(job) };
}

function registerNexusWebhook(app, { store, secret } = {}) {
  if (!app || !store) throw new Error("app and store are required");
  app.post("/api/nexus/github/workflow-run", (req, res) => {
    try {
      if (secret && req.get("x-nexus-webhook-secret") !== secret) return res.status(401).json({ ok: false });
      const result = handleWorkflowRun(req.body, store);
      return res.status(result.accepted ? 202 : 200).json({ ok: true, ...result });
    } catch (error) {
      return res.status(400).json({ ok: false, error: "Invalid webhook payload" });
    }
  });
}

module.exports = { handleWorkflowRun, registerNexusWebhook };
