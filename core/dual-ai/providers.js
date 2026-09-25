"use strict";

const OpenAI = require("openai");

const DEFAULT_TIMEOUT_MS = Math.max(5000, Number(process.env.DUAL_AI_TIMEOUT_MS || 25000));
const DEFAULT_MAX_OUTPUT = Math.max(256, Math.min(Number(process.env.DUAL_AI_MAX_OUTPUT_TOKENS || 4096), 16384));

function cleanText(value) {
  return String(value || "").trim();
}

function publicError(provider, error) {
  const status = Number(error?.status || 0);
  if (status === 401) return new Error(`${provider} authentication failed`);
  if (status === 403) return new Error(`${provider} permission denied`);
  if (status === 429) return new Error(`${provider} rate limit reached`);
  if (status >= 500) return new Error(`${provider} service temporarily unavailable`);
  if (error?.name === "AbortError" || error?.name === "APIConnectionTimeoutError" || error?.code === "ETIMEDOUT") {
    return new Error(`${provider} request timed out`);
  }
  return new Error(`${provider} request failed`);
}

async function fetchJson(url, options, provider, retries = 2) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      const text = await response.text();
      let body = {};
      try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }

      if (!response.ok) {
        const error = new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      return body;
    } catch (error) {
      last = error;
      const retryable = Number(error?.status || 0) === 429 || Number(error?.status || 0) >= 500 || error?.name === "AbortError";
      if (!retryable || attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
    }
  }
  throw publicError(provider, last);
}

class OpenAIProvider {
  constructor({ model, timeoutMs = DEFAULT_TIMEOUT_MS }) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
    this.name = "openai";
    this.model = model;
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: Math.max(1000, Number(timeoutMs)),
      maxRetries: 2
    });
  }

  async generate({ system, input, jsonSchema, maxOutputTokens = DEFAULT_MAX_OUTPUT }) {
    try {
      const request = {
        model: this.model,
        input: [
          { role: "system", content: cleanText(system) },
          { role: "user", content: cleanText(input) }
        ],
        max_output_tokens: maxOutputTokens
      };

      if (jsonSchema) {
        request.text = {
          format: {
            type: "json_schema",
            name: jsonSchema.name,
            strict: true,
            schema: jsonSchema.schema
          }
        };
      }

      const response = await this.client.responses.create(request);
      const text = cleanText(response.output_text);
      if (!text) throw new Error("empty model response");

      return {
        text,
        usage: response.usage || null,
        provider: this.name,
        model: this.model,
        responseId: response.id || null
      };
    } catch (error) {
      if (error?.message === "empty model response") throw error;
      throw publicError(this.name, error);
    }
  }
}

class AnthropicProvider {
  constructor({ model }) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not configured");
    this.name = "anthropic";
    this.model = model;
  }

  async generate({ system, input, jsonSchema, maxOutputTokens = DEFAULT_MAX_OUTPUT }) {
    const schemaHint = jsonSchema
      ? `\nReturn JSON only matching this schema:\n${JSON.stringify(jsonSchema.schema)}\n`
      : "";
    const body = await fetchJson(
      "https://api.anthropic.com/v1/messages",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: maxOutputTokens,
          system: cleanText(system) + schemaHint,
          messages: [{ role: "user", content: cleanText(input) }]
        })
      },
      this.name
    );

    const text = cleanText((body.content || [])
      .filter((x) => x?.type === "text")
      .map((x) => x.text)
      .join("\n"));

    if (!text) throw new Error("empty model response");
    return {
      text,
      usage: body.usage || null,
      provider: this.name,
      model: this.model,
      responseId: body.id || null
    };
  }
}

class OllamaProvider {
  constructor({ model }) {
    this.name = "ollama";
    this.model = model;
    this.baseUrl = String(process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
  }

  async generate({ system, input, jsonSchema }) {
    const body = await fetchJson(
      `${this.baseUrl}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages: [
            { role: "system", content: cleanText(system) + (jsonSchema ? `\nJSON schema: ${JSON.stringify(jsonSchema.schema)}` : "") },
            { role: "user", content: cleanText(input) }
          ],
          format: jsonSchema ? "json" : undefined
        })
      },
      this.name
    );

    const text = cleanText(body?.message?.content);
    if (!text) throw new Error("empty model response");

    return {
      text,
      usage: {
        input_tokens: body.prompt_eval_count ?? null,
        output_tokens: body.eval_count ?? null
      },
      provider: this.name,
      model: this.model,
      responseId: null
    };
  }
}

class MockProvider {
  constructor({ model }) {
    this.name = "mock";
    this.model = model;
  }
  async generate({ system }) {
    if (system.includes("Final Kill Critic")) {
      return { text: JSON.stringify({
        decision: "PASS",
        confidence: 0.96,
        strengths: ["complete"],
        issues: [],
        verdict: "ready"
      }), usage: null, provider: this.name, model: this.model, responseId: "mock-final" };
    }
    if (system.includes("Kill Critic")) {
      return { text: JSON.stringify({
        decision: "REVISE",
        confidence: 0.91,
        strengths: ["useful"],
        issues: [{ severity:"medium", claim:"needs more detail", evidence:"mock", fix:"add detail" }],
        verdict: "revise once"
      }), usage: null, provider: this.name, model: this.model, responseId: "mock-critic" };
    }
    if (system.includes("Revision Engineer")) {
      return { text: "Revised candidate with the requested implementation details and bounded assumptions.", usage:null, provider:this.name, model:this.model, responseId:"mock-revision" };
    }
    return { text: "Initial candidate with a concrete solution and explicit assumptions.", usage:null, provider:this.name, model:this.model, responseId:"mock-draft" };
  }
}

function createProvider({ provider, model }) {
  const name = String(provider || "openai").toLowerCase();
  if (!model) throw new Error("model is required");
  if (name === "openai") return new OpenAIProvider({ model });
  if (name === "anthropic") return new AnthropicProvider({ model });
  if (name === "ollama") return new OllamaProvider({ model });
  if (name === "mock" && process.env.NODE_ENV === "test") return new MockProvider({ model });
  throw new Error(`unsupported provider: ${name}`);
}

function providerStatus({ provider, model }) {
  const name = String(provider || "").toLowerCase();
  const configured =
    (name === "openai" && Boolean(process.env.OPENAI_API_KEY)) ||
    (name === "anthropic" && Boolean(process.env.ANTHROPIC_API_KEY)) ||
    (name === "ollama") || (name === "mock" && process.env.NODE_ENV === "test");

  return { provider: name, model, configured };
}

module.exports = {
  createProvider,
  providerStatus
};
