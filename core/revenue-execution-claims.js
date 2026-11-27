"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const CLAIM_DIR = path.join(DATA_DIR, "revenue-execution-claims");

function clean(value, field, max = 512) {
  const result = String(value == null ? "" : value).trim();
  if (!result || result.length > max) {
    throw Object.assign(new Error(field + " is required and must be <= " + max + " characters"), {
      code: "EXECUTION_CLAIM_INVALID_" + field.toUpperCase()
    });
  }
  return result;
}

function claimPath(tenantId, executionId, directory = CLAIM_DIR) {
  const key = JSON.stringify([
    clean(tenantId, "tenantId", 128),
    clean(executionId, "executionId", 512)
  ]);
  const digest = crypto.createHash("sha256").update(key).digest("hex");
  return path.join(directory, digest + ".json");
}

/**
 * Atomic cross-process claim based on exclusive file creation (O_EXCL).
 * A claim is deliberately not auto-expired: a provider request may have
 * succeeded even if the process died before recording its response.
 */
function acquire(tenantId, executionId, metadata = {}, { directory = CLAIM_DIR, now = () => new Date() } = {}) {
  const tenant = clean(tenantId, "tenantId", 128);
  const execution = clean(executionId, "executionId", 512);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = claimPath(tenant, execution, directory);
  const record = {
    tenantId: tenant,
    executionId: execution,
    status: "STARTED",
    createdAt: now().toISOString(),
    metadata: metadata && typeof metadata === "object" ? metadata : {}
  };

  let fd;
  try {
    fd = fs.openSync(file, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(record) + "\n", "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    return { acquired: true, record };
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch (_) {}
      try { fs.unlinkSync(file); } catch (_) {}
    }
    if (error.code !== "EEXIST") throw error;
    let existing = null;
    try { existing = JSON.parse(fs.readFileSync(file, "utf8")); } catch (_) {}
    return { acquired: false, reason: "EXECUTION_CLAIM_EXISTS", record: existing };
  }
}

function complete(tenantId, executionId, status, details = {}, { directory = CLAIM_DIR, now = () => new Date() } = {}) {
  const tenant = clean(tenantId, "tenantId", 128);
  const execution = clean(executionId, "executionId", 512);
  const allowed = new Set(["ENROLLED", "BLOCKED", "UNKNOWN", "FAILED"]);
  if (!allowed.has(status)) {
    throw Object.assign(new Error("invalid execution claim status"), { code: "EXECUTION_CLAIM_INVALID_STATUS" });
  }
  const file = claimPath(tenant, execution, directory);
  let current;
  try { current = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) {
    throw Object.assign(new Error("execution claim not found"), { code: "EXECUTION_CLAIM_NOT_FOUND", cause: error });
  }
  const updated = {
    ...current,
    status,
    updatedAt: now().toISOString(),
    details: details && typeof details === "object" ? details : {}
  };
  const tmp = file + "." + process.pid + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
  let fd;
  try {
    fd = fs.openSync(tmp, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(updated) + "\n", "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, file);
  } catch (error) {
    if (fd !== undefined) try { fs.closeSync(fd); } catch (_) {}
    try { fs.unlinkSync(tmp); } catch (_) {}
    throw error;
  }
  return updated;
}

function read(tenantId, executionId, { directory = CLAIM_DIR } = {}) {
  const file = claimPath(tenantId, executionId, directory);
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

module.exports = { acquire, complete, read, claimPath };
