"use strict";

const { inflateRawSync } = require("node:zlib");

const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const MAX_LOG_CHARS = 12000;

function redactSecrets(input) {
  return String(input || "")
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_GITHUB_TOKEN]")
    .replace(/\bsk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}\b/g, "[REDACTED_API_KEY]")
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_ACCESS_KEY]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"'<>]+/gi, "$1[REDACTED]")
    .replace(/((?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token)\s*[:=]\s*)[^\s,;]+/gi, "$1[REDACTED]");
}

function extractZipText(zipBuffer) {
  if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length > MAX_ARCHIVE_BYTES) {
    const error = new Error("GitHub log archive is missing or too large");
    error.code = "GITHUB_LOG_ARCHIVE_INVALID";
    throw error;
  }

  let eocd = -1;
  const lowerBound = Math.max(0, zipBuffer.length - 65557);
  for (let i = zipBuffer.length - 22; i >= lowerBound; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) {
    const error = new Error("GitHub log archive has no ZIP directory");
    error.code = "GITHUB_LOG_ARCHIVE_INVALID";
    throw error;
  }

  const entryCount = zipBuffer.readUInt16LE(eocd + 10);
  let offset = zipBuffer.readUInt32LE(eocd + 16);
  const output = [];
  let outputBytes = 0;

  for (let i = 0; i < entryCount && offset + 46 <= zipBuffer.length; i++) {
    if (zipBuffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = zipBuffer.readUInt16LE(offset + 10);
    const compressedSize = zipBuffer.readUInt32LE(offset + 20);
    const uncompressedSize = zipBuffer.readUInt32LE(offset + 24);
    const nameLength = zipBuffer.readUInt16LE(offset + 28);
    const extraLength = zipBuffer.readUInt16LE(offset + 30);
    const commentLength = zipBuffer.readUInt16LE(offset + 32);
    const localOffset = zipBuffer.readUInt32LE(offset + 42);
    const name = zipBuffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;

    if (!/\.txt$/i.test(name) || uncompressedSize === 0) continue;
    if (uncompressedSize > MAX_OUTPUT_BYTES || outputBytes + uncompressedSize > MAX_OUTPUT_BYTES) break;
    if (localOffset + 30 > zipBuffer.length || zipBuffer.readUInt32LE(localOffset) !== 0x04034b50) continue;

    const localNameLength = zipBuffer.readUInt16LE(localOffset + 26);
    const localExtraLength = zipBuffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > zipBuffer.length) continue;
    const compressed = zipBuffer.subarray(dataStart, dataEnd);
    let decoded;
    try {
      if (method === 0) decoded = Buffer.from(compressed);
      else if (method === 8) decoded = inflateRawSync(compressed, { maxOutputLength: MAX_OUTPUT_BYTES });
      else continue;
    } catch (_error) {
      continue;
    }
    if (decoded.length > MAX_OUTPUT_BYTES || outputBytes + decoded.length > MAX_OUTPUT_BYTES) break;
    outputBytes += decoded.length;
    output.push("\n--- " + name.slice(0, 200) + " ---\n" + decoded.toString("utf8"));
  }
  return output.join("\n").slice(-MAX_LOG_CHARS);
}

async function fetchFailureLogs(event, options = {}) {
  const token = String(options.token ?? process.env.GITHUB_TOKEN ?? "").trim();
  if (!token) {
    const error = new Error("GITHUB_TOKEN is not configured");
    error.code = "GITHUB_TOKEN_NOT_CONFIGURED";
    throw error;
  }
  const repository = String(event?.repository || "");
  const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository);
  const runId = String(event?.id || "");
  if (!match || !/^\d{1,20}$/.test(runId)) {
    const error = new Error("Invalid GitHub repository or run ID");
    error.code = "GITHUB_EVENT_INVALID";
    throw error;
  }

  const fetchImpl = options.fetch || globalThis.fetch;
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: "Bearer " + token,
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "SamuraiOS-CI-Agent"
  };
  const api = "https://api.github.com/repos/" + match[1] + "/" + match[2];
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || process.env.GITHUB_API_TIMEOUT_MS || 15000));
  const jobsResponse = await fetchImpl(api + "/actions/runs/" + runId + "/jobs?per_page=100", {
    headers, signal: AbortSignal.timeout(timeoutMs)
  });
  if (!jobsResponse.ok) {
    const error = new Error("GitHub API could not list workflow jobs");
    error.code = jobsResponse.status === 404 ? "GITHUB_RUN_NOT_FOUND" : "GITHUB_API_FAILED";
    throw error;
  }
  const jobsPayload = await jobsResponse.json();
  const failedJobs = (Array.isArray(jobsPayload.jobs) ? jobsPayload.jobs : [])
    .filter(job => ["failure", "timed_out", "cancelled"].includes(job.conclusion))
    .slice(0, 10);
  if (!failedJobs.length) {
    const error = new Error("No failed jobs were found for this workflow run");
    error.code = "GITHUB_FAILED_JOBS_NOT_FOUND";
    throw error;
  }

  const chunks = [];
  for (const job of failedJobs) {
    const logsResponse = await fetchImpl(api + "/actions/jobs/" + encodeURIComponent(String(job.id)) + "/logs", {
      headers, redirect: "follow", signal: AbortSignal.timeout(timeoutMs)
    });
    if (!logsResponse.ok) continue;
    const bytes = Buffer.from(await logsResponse.arrayBuffer());
    if (bytes.length > MAX_ARCHIVE_BYTES) continue;
    const extracted = extractZipText(bytes);
    if (extracted) chunks.push("JOB: " + String(job.name || job.id).slice(0, 200) + "\n" + extracted);
    if (chunks.join("\n").length >= MAX_LOG_CHARS) break;
  }
  const logs = chunks.join("\n").slice(-MAX_LOG_CHARS);
  if (!logs.trim()) {
    const error = new Error("No readable text logs were found in failed jobs");
    error.code = "GITHUB_LOGS_EMPTY";
    throw error;
  }
  return logs;
}

module.exports = { fetchFailureLogs, extractZipText, redactSecrets };
