"use strict";

const crypto = require("crypto");
const { normalizeWorkflowRun } = require("./nexus-workflow-intake");

function verifyGitHubSignature(rawBody, signature, secret) {
  if (!secret || !signature || !rawBody) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

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
      const raw = req.rawBody || JSON.stringify(req.body || {});
      if (!verifyGitHubSignature(raw, req.get("x-hub-signature-256"), secret)) {
        return res.status(401).json({ ok: false, error: "Invalid GitHub signature" });
      }
      const result = handleWorkflowRun(req.body, store);
      return res.status(result.accepted ? 202 : 200).json({ ok: true, ...result });
    } catch (error) {
      return res.status(400).json({ ok: false, error: "Invalid webhook payload" });
    }
  });
}

module.exports = { verifyGitHubSignature, handleWorkflowRun, registerNexusWebhook };
