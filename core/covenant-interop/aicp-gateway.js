"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_MESSAGE_BYTES = 32 * 1024;
const MAX_CLOCK_SKEW_SECONDS = 300;
const INTENTS = Object.freeze({
  request_model_download: { messageType: "model_request", performative: "request", required: ["model_id", "requested_version"] },
  submit_gradient_update: { messageType: "contribution_update", performative: "inform", required: ["model_version", "gradient_hash", "contribution_score", "privacy_preserved"] },
  register_federated_learning_contribution: { messageType: "contribution_update", performative: "inform", required: ["contribution_score", "data_volume_hash", "model_accuracy_improvement", "privacy_preserved"] },
  broadcast_knowledge_hash: { messageType: "knowledge_broadcast", performative: "inform", required: ["knowledge_hash", "storage_backend"] },
  query_blockchain_state: { messageType: "state_query", performative: "query_if", required: ["network", "query"] }
});

function isRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalize(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  if (isRecord(value)) {
    return "{" + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ":" + canonicalize(value[key])
    ).join(",") + "}";
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new TypeError("Unsupported value in signed message");
  return encoded;
}

function signaturePayload(message) {
  const unsigned = { ...message, payload: { ...message.payload } };
  delete unsigned.payload.signature;
  return Buffer.from(canonicalize(unsigned), "utf8");
}

function configuredAllowedSenders(value = process.env.COVENANT_AICP_ALLOWED_SENDERS || "") {
  return String(value).split(",").map(item => item.trim()).filter(Boolean);
}

function configuredPublicKeys(value = process.env.COVENANT_AICP_PUBLIC_KEYS_JSON || "{}") {
  try {
    const parsed = JSON.parse(String(value));
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([sender, pem]) =>
      sender.trim() && typeof pem === "string" && pem.includes("BEGIN PUBLIC KEY")
    ));
  } catch {
    return {};
  }
}

function reviewKey(sender, messageId) {
  return crypto.createHash("sha256").update(sender + "\0" + messageId).digest("hex");
}

function reserveMessage(replayStoreDir, sender, messageId, record) {
  if (!replayStoreDir) return { ok: false, code: "REPLAY_STORE_NOT_CONFIGURED" };
  const key = reviewKey(sender, messageId);
  let fd;
  try {
    fs.mkdirSync(replayStoreDir, { recursive: true, mode: 0o700 });
    const file = path.join(replayStoreDir, key + ".json");
    fd = fs.openSync(file, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify(record) + "\n", "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    const dirFd = fs.openSync(replayStoreDir, "r");
    try {
      fs.fsyncSync(dirFd);
    } finally {
      fs.closeSync(dirFd);
    }
    return { ok: true };
  } catch (error) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
    if (error.code === "EEXIST") return { ok: false, code: "REPLAY_DETECTED" };
    return { ok: false, code: "REPLAY_STORE_UNAVAILABLE" };
  }
}

function listReviewItems(replayStoreDir, limit = 50) {
  if (!replayStoreDir || !fs.existsSync(replayStoreDir)) return [];
  const n = Math.min(Math.max(Number(limit) || 50, 1), 200);
  return fs.readdirSync(replayStoreDir)
    .filter(name => /^[a-f0-9]{64}\.json$/.test(name))
    .map(name => {
      try {
        const record = JSON.parse(fs.readFileSync(path.join(replayStoreDir, name), "utf8"));
        let decision = null;
        const decisionPath = path.join(replayStoreDir, name.replace(/\.json$/, ".decision.json"));
        if (fs.existsSync(decisionPath)) decision = JSON.parse(fs.readFileSync(decisionPath, "utf8"));
        return {
          sender: record.sender,
          messageId: record.messageId,
          digest: record.digest,
          intent: record.intent || null,
          receivedAt: record.receivedAt,
          reviewStatus: decision
            ? (decision.decision === "approve" ? "APPROVED_FOR_MANUAL_HANDOFF" : "REJECTED")
            : "PENDING_HUMAN_REVIEW",
          decision: decision ? {
            decision: decision.decision,
            reason: decision.reason,
            reviewedAt: decision.reviewedAt
          } : null,
          killCritic: record.killCritic || null
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)))
    .slice(0, n);
}

function decideReviewItem(replayStoreDir, sender, messageId, decision, reason = "") {
  if (!replayStoreDir) return { ok: false, code: "REVIEW_STORE_NOT_CONFIGURED" };
  if (!["approve", "reject"].includes(decision)) return { ok: false, code: "INVALID_REVIEW_DECISION" };
  const key = reviewKey(sender, messageId);
  const recordPath = path.join(replayStoreDir, key + ".json");
  if (!fs.existsSync(recordPath)) return { ok: false, code: "REVIEW_ITEM_NOT_FOUND" };
  const decisionPath = path.join(replayStoreDir, key + ".decision.json");
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  let fd;
  try {
    fd = fs.openSync(decisionPath, "wx", 0o600);
    fs.writeFileSync(fd, JSON.stringify({
      sender,
      messageId,
      digest: record.digest,
      decision,
      reason: String(reason).trim().slice(0, 500),
      reviewedAt: new Date().toISOString(),
      executionAuthorized: false
    }) + "\n", "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    const dirFd = fs.openSync(replayStoreDir, "r");
    try { fs.fsyncSync(dirFd); } finally { fs.closeSync(dirFd); }
    return { ok: true, reviewStatus: decision === "approve" ? "APPROVED_FOR_MANUAL_HANDOFF" : "REJECTED" };
  } catch (error) {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    return { ok: false, code: error.code === "EEXIST" ? "REVIEW_ALREADY_DECIDED" : "REVIEW_STORE_UNAVAILABLE" };
  }
}

function validateAICPMessage(message, options = {}) {
  const now = Number.isInteger(options.now) ? options.now : Math.floor(Date.now() / 1000);
  const allowedSenders = new Set(Array.isArray(options.allowedSenders) ? options.allowedSenders : []);
  const publicKeys = isRecord(options.publicKeys) ? options.publicKeys : {};
  const errors = [];

  if (!isRecord(message)) return { valid: false, errors: ["MESSAGE_OBJECT_REQUIRED"] };

  let encoded;
  try { encoded = Buffer.from(canonicalize(message), "utf8"); }
  catch { return { valid: false, errors: ["MESSAGE_NOT_CANONICALIZABLE"] }; }

  if (encoded.length > MAX_MESSAGE_BYTES) errors.push("MESSAGE_TOO_LARGE");
  const requiredStrings = ["version", "message_id", "from_ai", "to_ai", "message_type", "performative", "intent", "proof_of_work"];
  for (const field of requiredStrings) {
    if (typeof message[field] !== "string" || !message[field].trim()) errors.push("INVALID_" + field.toUpperCase());
  }
  if (message.version !== "1.0") errors.push("UNSUPPORTED_PROTOCOL_VERSION");
  if (!Number.isInteger(message.timestamp) || Math.abs(now - message.timestamp) > MAX_CLOCK_SKEW_SECONDS) {
    errors.push("TIMESTAMP_OUT_OF_WINDOW");
  }
  if (typeof message.message_id === "string" && (message.message_id.length > 128 || !message.message_id.trim())) errors.push("INVALID_MESSAGE_ID");
  if (typeof message.from_ai === "string" && !allowedSenders.has(message.from_ai)) errors.push("SENDER_NOT_ALLOWLISTED");
  if (message.to_ai !== (options.target || "samuraios")) errors.push("RECIPIENT_NOT_SAMURAI");
  if (!isRecord(message.payload)) errors.push("PAYLOAD_OBJECT_REQUIRED");

  const definition = INTENTS[message.intent];
  if (!definition) {
    errors.push("INTENT_NOT_ALLOWED");
  } else {
    if (message.message_type !== definition.messageType) errors.push("MESSAGE_TYPE_MISMATCH");
    if (message.performative !== definition.performative) errors.push("PERFORMATIVE_MISMATCH");
    if (isRecord(message.payload)) {
      for (const field of definition.required) {
        if (!(field in message.payload)) errors.push("PAYLOAD_FIELD_REQUIRED:" + field);
      }
    }
  }

  if (isRecord(message.payload)) {
    if (typeof message.payload.signature !== "string" || !message.payload.signature.trim()) {
      errors.push("SIGNATURE_FIELD_REQUIRED");
    }
    if ("privacy_preserved" in message.payload && typeof message.payload.privacy_preserved !== "boolean") {
      errors.push("PRIVACY_FLAG_MUST_BE_BOOLEAN");
    }
  }

  if (errors.length) return { valid: false, errors: [...new Set(errors)] };

  const publicKeyPem = publicKeys[message.from_ai];
  if (typeof publicKeyPem !== "string" || !publicKeyPem.trim()) {
    return { valid: false, errors: ["SIGNATURE_KEY_NOT_CONFIGURED"] };
  }

  let signature;
  let signatureValid = false;
  try {
    const raw = message.payload.signature;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) throw new Error("Invalid base64");
    signature = Buffer.from(raw, "base64");
    if (signature.length !== 64 || signature.toString("base64") !== raw) throw new Error("Invalid Ed25519 signature length or encoding");
    const publicKey = crypto.createPublicKey(publicKeyPem);
    if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("Expected Ed25519 public key");
    signatureValid = crypto.verify(null, signaturePayload(message), publicKey, signature);
  } catch {
    return { valid: false, errors: ["SIGNATURE_INVALID"] };
  }
  if (!signatureValid) return { valid: false, errors: ["SIGNATURE_INVALID"] };

  const digest = crypto.createHash("sha256").update(encoded).digest("hex");
  const replay = reserveMessage(options.replayStoreDir, message.from_ai, message.message_id, {
    sender: message.from_ai,
    messageId: message.message_id,
    digest,
    receivedAt: new Date(now * 1000).toISOString(),
    intent: message.intent,
    outcome: "SIGNATURE_VERIFIED_REVIEW_ONLY",
    reviewStatus: "PENDING_HUMAN_REVIEW",
    killCritic: {
      decision: "PASS_TO_HUMAN_REVIEW",
      signatureVerified: true,
      senderAllowlisted: true,
      intentAllowlisted: true,
      replayProtected: true,
      privacyClaimVerified: false,
      proofOfWorkVerified: false,
      executionAuthorized: false
    }
  });
  if (!replay.ok) return { valid: false, errors: [replay.code] };

  return {
    valid: true,
    digest,
    normalizedIntent: message.intent,
    messageId: message.message_id,
    sender: message.from_ai,
    trust: "SIGNATURE_VERIFIED_REVIEW_ONLY",
    acceptedFor: "HUMAN_REVIEW_ONLY",
    verified: {
      envelopeShape: true,
      senderAllowlist: true,
      timestampWindow: true,
      contentDigest: true,
      cryptographicSignature: true,
      signatureAlgorithm: "Ed25519",
      proofOfWork: false,
      privacyClaim: false,
      modelUpdate: false,
      blockchainAction: false,
      replayProtection: true
    }
  };
}

module.exports = {
  MAX_MESSAGE_BYTES,
  MAX_CLOCK_SKEW_SECONDS,
  configuredAllowedSenders,
  configuredPublicKeys,
  canonicalize,
  validateAICPMessage,
  listReviewItems,
  decideReviewItem
};
