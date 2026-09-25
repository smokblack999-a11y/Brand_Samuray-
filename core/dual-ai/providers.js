"use strict";

const OpenAI = require("openai");

const DEFAULT_TIMEOUT = Math.max(5000, Number(process.env.DUAL_AI_TIMEOUT_MS || 30000));

function clip(value, max = 12000) {
  return String(value || "").slice(0, max);
}

async function withTimeout(promise, ms = DEFAULT_TIMEOUT) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("provider_timeout")), ms);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function openaiText({ model, instructions, input, jsonSchema }) {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_NOT_CONFIGURED");
  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: DEFAULT_TIMEOUT,
    maxRetries: 2
  });
  const payload = {
    model,
    instructions,
    input
  };
  if (jsonSchema) {
    payload.text = {
      format: {
        type: "json_schema",
        name: jsonSchema.name,
        strict: true,
        schema: jsonSchema.schema
      }
    };
  }
  const response = await withTimeout(client.responses.create(payload));
  return clip(response.output_text, 16000);
}

async function anthropicText({ model, instructions, input, jsonSchema }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_NOT_CONFIGURED");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
  try {
    const system = jsonSchema
      ? instructions + "\nВерни JSON строго по схеме: " + JSON.stringify(jsonSchema.schema)
      : instructions;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model,
        max_tokens: Number(process.env.ANTHROPIC_MAX_TOKENS || 4096),
        system,
        messages: [{ role: "user", content: clip(input, 20000) }]
      })
    });
    if (!response.ok) throw new Error("ANTHROPIC_HTTP_" + response.status);
    const body = await response.json();
    return clip((body.content || []).filter(x => x.type === "text").map(x => x.text).join("\n"), 16000);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("provider_timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function ollamaText({ model, instructions, input, jsonSchema }) {
  const base = String(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);
  try {
    const response = await fetch(base + "/api/chat", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: jsonSchema ? "json" : undefined,
        messages: [
          { role: "system", content: instructions },
          { role: "user", content: clip(input, 20000) }
        ]
      })
    });
    if (!response.ok) throw new Error("OLLAMA_HTTP_" + response.status);
    const body = await response.json();
    return clip(body?.message?.content, 16000);
  } catch (error) {
    if (error.name === "AbortError") throw new Error("provider_timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function complete({ provider, model, instructions, input, jsonSchema }) {
  const p = String(provider || "openai").toLowerCase();
  if (p === "openai") return openaiText({ model, instructions, input, jsonSchema });
  if (p === "anthropic") return anthropicText({ model, instructions, input, jsonSchema });
  if (p === "ollama") return ollamaText({ model, instructions, input, jsonSchema });
  throw new Error("UNSUPPORTED_PROVIDER");
}

function configured(provider) {
  const p = String(provider || "openai").toLowerCase();
  if (p === "openai") return Boolean(process.env.OPENAI_API_KEY);
  if (p === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
  if (p === "ollama") return true;
  return false;
}

module.exports = { complete, configured };
