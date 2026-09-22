"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const http = require("node:http");

const {
  loadLedger,
  isProofRegistered,
  registerProofReceipt,
  registerShipReceipt,
  notifyRecoveryProof,
  notifyRecoveryShip
} = require("./nexus-proof-ledger");

function createTmpLedgerPath() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-ledger-test-"));
  return path.join(tmpDir, "ledger.json");
}

function receipt(overrides = {}) {
  return {
    version: 1,
    type: "x10think.recovery.proof",
    proofId: "NXS-PROOF-12345",
    fingerprint: "a".repeat(24),
    headSha: "b".repeat(40),
    repository: "acme/app",
    repairBranch: "recovery/abc",
    verificationRunId: 42,
    verifiedAt: "2026-09-23T00:00:00.000Z",
    gates: {
      sandbox: true,
      regression: true,
      githubCi: true,
      autonomousMerge: false
    },
    ...overrides
  };
}

test("registers receipt and prevents double-spending / duplicates", () => {
  const filePath = createTmpLedgerPath();
  const proof = receipt();

  assert.equal(isProofRegistered(proof.proofId, filePath), false);

  const entry = registerProofReceipt(proof, { filePath });
  assert.equal(entry.proofId, proof.proofId);
  assert.equal(isProofRegistered(proof.proofId, filePath), true);

  assert.throws(
    () => registerProofReceipt(proof, { filePath }),
    /DUPLICATE_PROOF/
  );

  const ledger = loadLedger(filePath);
  assert.equal(ledger.records.length, 1);
  assert.equal(ledger.records[0].previousHash, "GENESIS");
  assert.equal(typeof ledger.records[0].entryHash, "string");
});

test("fails closed when the ledger is tampered with", () => {
  const filePath = createTmpLedgerPath();
  registerProofReceipt(receipt(), { filePath });

  const ledger = JSON.parse(fs.readFileSync(filePath, "utf8"));
  ledger.records[0].repository = "attacker/changed";
  fs.writeFileSync(filePath, JSON.stringify(ledger), "utf8");

  assert.throws(
    () => loadLedger(filePath),
    /LEDGER_TAMPERED/
  );
});

test("does not register receipts without all verification gates", () => {
  const filePath = createTmpLedgerPath();
  assert.throws(
    () =>
      registerProofReceipt(
        receipt({ gates: { sandbox: true, regression: true, githubCi: false, autonomousMerge: false } }),
        { filePath }
      ),
    /INVALID_RECEIPT/
  );
  assert.equal(loadLedger(filePath).records.length, 0);
});

test("notifier posts a structured proof event", async () => {
  const received = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", chunk => (body += chunk));
      req.on("end", () => {
        res.statusCode = 204;
        res.end();
        try {
          resolve(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });
    server.listen(0, "127.0.0.1", async () => {
      try {
        const { port } = server.address();
        await notifyRecoveryProof(receipt(), {
          webhookUrl: `http://127.0.0.1:${port}/notify`
        });
      } finally {
        server.close();
      }
    });
  });

  assert.equal(received.event, "nexus.proof.verified");
  assert.equal(received.proof.proofId, "NXS-PROOF-12345");
  assert.equal(received.proof.headSha, "b".repeat(40));
});


test("chains a post-merge ship receipt to the proof", () => {
  const filePath = createTmpLedgerPath();
  const proof = receipt();
  registerProofReceipt(proof, { filePath });

  const ship = registerShipReceipt({
    shipId: "NXS-SHIP-12345",
    proofId: proof.proofId,
    fingerprint: proof.fingerprint,
    repository: proof.repository,
    repairBranch: proof.repairBranch,
    headSha: proof.headSha,
    mergeCommitSha: "c".repeat(40),
    shippedAt: "2026-09-23T00:01:00.000Z"
  }, { filePath });

  assert.equal(ship.eventType, "recovery.shipped");
  assert.equal(ship.proofId, proof.proofId);
  assert.equal(ship.mergeCommitSha, "c".repeat(40));
  const ledger = loadLedger(filePath);
  assert.equal(ledger.records.length, 2);
  assert.equal(ledger.records[1].previousHash, ledger.records[0].entryHash);

  assert.throws(
    () => registerShipReceipt({
      shipId: "NXS-SHIP-12345",
      proofId: proof.proofId,
      repository: proof.repository,
      headSha: proof.headSha,
      mergeCommitSha: "c".repeat(40)
    }, { filePath }),
    /DUPLICATE_SHIP/
  );
});

test("notifier posts a structured ship event", async () => {
  const received = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", chunk => (body += chunk));
      req.on("end", () => {
        res.statusCode = 204;
        res.end();
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    server.listen(0, "127.0.0.1", async () => {
      try {
        const { port } = server.address();
        await notifyRecoveryShip({
          shipId: "NXS-SHIP-12345",
          proofId: "NXS-PROOF-12345",
          fingerprint: "a".repeat(24),
          repository: "acme/app",
          repairBranch: "recovery/abc",
          headSha: "b".repeat(40),
          mergeCommitSha: "c".repeat(40),
          shippedAt: "2026-09-23T00:01:00.000Z"
        }, { webhookUrl: `http://127.0.0.1:${port}/notify` });
      } finally {
        server.close();
      }
    });
  });
  assert.equal(received.event, "nexus.recovery.shipped");
  assert.equal(received.ship.proofId, "NXS-PROOF-12345");
  assert.equal(received.ship.mergeCommitSha, "c".repeat(40));
});
