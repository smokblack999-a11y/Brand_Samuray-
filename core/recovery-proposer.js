"use strict";

const fs = require("node:fs");
const path = require("node:path");
const OpenAI = require("openai");
const { validateUnifiedDiff, MAX_PATCH_BYTES } = require("./interop/patch-candidate");

const MAX_LOG_BYTES = 12000;
const MAX_SOURCE_BYTES = 50000;
const MAX_FILES = 8;

function extractCandidatePaths(text = "") {
  const matches = String(text).match(/[A-Za-z0-9_.@-]+(?:\\/[A-Za-z0-9_.@-]+)*\\.(?:js|cjs|mjs|ts|tsx|json|yml|yaml|sh|kt|java|xml|gradle|properties)/g) || [];
  return [...new Set(matches)].slice(0, MAX_FILES);
}

function collectSourceContext(repoDir, failureLogs) {
  const parts = []; let used = 0;
  for (const file of extractCandidatePaths(failureLogs)) {
    const full = path.resolve(repoDir, file);
    if (!full.startsWith(repoDir + path.sep)) continue;
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile() || stat.size > MAX_SOURCE_BYTES) continue;
      const chunk = "FILE: " + file + "\\n" + fs.readFileSync(full, "utf8").slice(0, MAX_SOURCE_BYTES);
      const bytes = Buffer.byteLength(chunk, "utf8");
      if (used + bytes > MAX_SOURCE_BYTES) break;
      parts.push(chunk); used += bytes;
    } catch {}
  }
  return parts.join("\\n\\n");
}

function extractDiff(text) {
  const value = String(text || "").trim();
  const start = value.indexOf("diff --git ");
  return start < 0 ? "" : value.slice(start).split("```")[0].trim();
}

async function generatePatchCandidate({ repoDir, failureLogs, diagnosis, fingerprint }) {
  if (String(process.env.RECOVERY_AI_PROPOSALS || "").toLowerCase() !== "true") return { accepted:false, reason:"AI_PROPOSALS_DISABLED" };
  const apiKey = String(process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) return { accepted:false, reason:"OPENAI_API_KEY_REQUIRED" };
  const model = String(process.env.RECOVERY_AI_MODEL || "").trim();
  if (!model) return { accepted:false, reason:"RECOVERY_AI_MODEL_REQUIRED" };
  const client = new OpenAI({ apiKey });
  const logs = String(failureLogs || "").slice(-MAX_LOG_BYTES);
  const source = collectSourceContext(repoDir, logs);
  const response = await client.responses.create({
    model,
    input: [
      { role:"system", content:"Generate ONLY a unified git diff beginning with diff --git. Never modify .github/, .env, lockfiles, credentials, CI permissions, workflow triggers, or generated binaries. Make the smallest plausible source change. Do not claim proof; sandbox verifies it. If evidence is insufficient, return NO_PATCH." },
      { role:"user", content:["Failure fingerprint: " + fingerprint, "Diagnosis: " + JSON.stringify(diagnosis || {}), "Failure logs:", logs, "Relevant source context:", source || "(none found)"].join("\\n\\n") }
    ],
    max_output_tokens: 6000
  });
  const output = String(response.output_text || "").trim();
  if (output === "NO_PATCH") return { accepted:false, reason:"AI_FOUND_INSUFFICIENT_EVIDENCE" };
  const diff = extractDiff(output);
  if (!diff) return { accepted:false, reason:"AI_DID_NOT_RETURN_UNIFIED_DIFF" };
  if (Buffer.byteLength(diff, "utf8") > MAX_PATCH_BYTES) return { accepted:false, reason:"AI_PATCH_TOO_LARGE" };
  let validated;
  try { validated = validateUnifiedDiff(diff); } catch (error) { return { accepted:false, reason:"AI_INVALID_DIFF: " + String(error?.message || error) }; }
  return { accepted:true, candidate:{ version:1, diff:validated.diff, files:validated.files, source:"ai-candidate", evidenceOnly:false, reproduction:false, causality:false, autonomousWrite:false, autonomousMerge:false } };
}

module.exports = { generatePatchCandidate, extractCandidatePaths, collectSourceContext };