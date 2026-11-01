"use strict";

const crypto = require("node:crypto");

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
  return JSON.stringify(value);
}

function validateAICPMessage(message, options = {}) {
  const now = Number.isInteger(options.now) ? options.now : Math.floor(Date.now() / 1000);
  const allowedSenders = new Set(Array.isArray(options.allowedSenders) ? options.allowedSenders : []);
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
  if (typeof message.message_id === "string" && message.message_id.length > 128) errors.push("MESSAGE_ID_TOO_LONG");
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

  const digest = crypto.createHash("sha256").update(encoded).digest("hex");
  return {
    valid: true,
    digest,
    normalizedIntent: message.intent,
    messageId: message.message_id,
    sender: message.from_ai,
    trust: "UNVERIFIED_EXTERNAL_INPUT",
    acceptedFor: "HUMAN_REVIEW_ONLY",
    verified: {
      envelopeShape: true,
      senderAllowlist: true,
      timestampWindow: true,
      contentDigest: true,
      cryptographicSignature: false,
      proofOfWork: false,
      privacyClaim: false,
      modelUpdate: false,
      blockchainAction: false
    }
  };
}

function configuredAllowedSenders(value = process.env.COVENANT_AICP_ALLOWED_SENDERS || "") {
  return String(value).split(",").map(item => item.trim()).filter(Boolean);
}

module.exports = {
  MAX_MESSAGE_BYTES,
  MAX_CLOCK_SKEW_SECONDS,
  configuredAllowedSenders,
  validateAICPMessage
};
