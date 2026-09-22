"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const LEDGER_FILE =
  process.env.NEXUS_LEDGER_PATH || path.join(__dirname, "proof-ledger.json");
const LOCK_TTL_MS = 30_000;

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function hashEntry(entry) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(entry))
    .digest("hex");
}

function readLedger(filePath = LEDGER_FILE) {
  ensureDir(filePath);
  if (!fs.existsSync(filePath)) return { version: 1, records: [] };

  const raw = fs.readFileSync(filePath, "utf8");
  let ledger;
  try {
    ledger = JSON.parse(raw || '{"version":1,"records":[]}');
  } catch {
    throw new Error("LEDGER_CORRUPTED: invalid JSON");
  }

  if (
    !ledger ||
    ledger.version !== 1 ||
    !Array.isArray(ledger.records)
  ) {
    throw new Error("LEDGER_CORRUPTED: invalid ledger structure");
  }

  let previousHash = "GENESIS";
  for (const record of ledger.records) {
    const { entryHash, ...entry } = record;
    if (!entryHash || entry.previousHash !== previousHash) {
      throw new Error("LEDGER_TAMPERED: hash chain mismatch");
    }
    if (hashEntry(entry) !== entryHash) {
      throw new Error("LEDGER_TAMPERED: entry hash mismatch");
    }
    previousHash = entryHash;
  }

  return ledger;
}

function writeLedger(filePath, ledger) {
  ensureDir(filePath);
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2) + "\n", {
    encoding: "utf8",
    mode: 0o600
  });
  fs.renameSync(tmp, filePath);
}

function withLedgerLock(filePath, fn) {
  ensureDir(filePath);
  const lockPath = `${filePath}.lock`;
  const started = Date.now();

  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try {
        return fn();
      } finally {
        fs.closeSync(fd);
        fs.rmSync(lockPath, { force: true });
      }
    } catch (error) {
      if (error.code !== "EEXIST") throw error;

      try {
        const stat = fs.statSync(lockPath);
        if (Date.now() - stat.mtimeMs > LOCK_TTL_MS) {
          fs.rmSync(lockPath, { force: true });
          continue;
        }
      } catch {}

      if (Date.now() - started > LOCK_TTL_MS) {
        throw new Error("LEDGER_LOCK_TIMEOUT");
      }
    }
  }
}

function loadLedger(filePath = LEDGER_FILE) {
  return readLedger(filePath);
}

function isProofRegistered(proofId, filePath = LEDGER_FILE) {
  if (!proofId) return false;
  const ledger = readLedger(filePath);
  return ledger.records.some(record => record.proofId === proofId);
}

function validateReceipt(receipt) {
  if (!receipt || typeof receipt !== "object") {
    throw new Error("INVALID_RECEIPT: receipt is required");
  }
  if (!receipt.proofId) {
    throw new Error("INVALID_RECEIPT: proofId is required for ledger registration");
  }
  if (!receipt.fingerprint || !receipt.repository || !receipt.headSha) {
    throw new Error(
      "INVALID_RECEIPT: fingerprint, repository and headSha are required"
    );
  }
  if (
    !receipt.gates ||
    receipt.gates.sandbox !== true ||
    receipt.gates.regression !== true ||
    receipt.gates.githubCi !== true ||
    receipt.gates.autonomousMerge !== false
  ) {
    throw new Error("INVALID_RECEIPT: proof gates are not satisfied");
  }
}

function registerProofReceipt(receipt, { filePath = LEDGER_FILE } = {}) {
  validateReceipt(receipt);

  return withLedgerLock(filePath, () => {
    const ledger = readLedger(filePath);

    if (ledger.records.some(record => record.proofId === receipt.proofId)) {
      throw new Error(
        `DUPLICATE_PROOF: proofId ${receipt.proofId} has already been processed`
      );
    }

    const previousHash =
      ledger.records.length > 0
        ? ledger.records[ledger.records.length - 1].entryHash
        : "GENESIS";

    const entry = {
      proofId: String(receipt.proofId),
      fingerprint: String(receipt.fingerprint),
      headSha: String(receipt.headSha),
      repository: String(receipt.repository),
      repairBranch: receipt.repairBranch || null,
      verificationRunId: receipt.verificationRunId || null,
      verifiedAt: receipt.verifiedAt || new Date().toISOString(),
      recordedAt: new Date().toISOString(),
      previousHash
    };

    const entryHash = hashEntry(entry);
    const stored = { ...entry, entryHash };

    ledger.records.push(stored);
    writeLedger(filePath, ledger);
    return stored;
  });
}

async function notifyRecoveryProof(
  receipt,
  { webhookUrl = process.env.RECOVERY_WEBHOOK_URL, fetchImpl = fetch } = {}
) {
  if (!webhookUrl) {
    return { notified: false, reason: "NO_WEBHOOK_URL" };
  }

  const payload = {
    event: "nexus.proof.verified",
    text: `NEXUS Proof-to-Ship Verified | Repo: ${receipt.repository} | Proof: ${receipt.proofId} | Branch: ${receipt.repairBranch || "-"} | SHA: ${receipt.headSha}`,
    proof: {
      proofId: receipt.proofId,
      fingerprint: receipt.fingerprint,
      repository: receipt.repository,
      repairBranch: receipt.repairBranch || null,
      headSha: receipt.headSha,
      verificationRunId: receipt.verificationRunId || null,
      verifiedAt: receipt.verifiedAt
    }
  };

  try {
    const response = await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    return { notified: response.ok, statusCode: response.status };
  } catch (error) {
    return { notified: false, error: error.message };
  }
}

module.exports = {
  LEDGER_FILE,
  loadLedger,
  isProofRegistered,
  registerProofReceipt,
  notifyRecoveryProof,
  hashEntry
};
