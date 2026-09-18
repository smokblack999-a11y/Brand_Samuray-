"use strict";

const OpenAI = require("openai");

function createOpenAIRepairCandidateProvider({
  apiKey = process.env.OPENAI_API_KEY,
  model = process.env.OPENAI_REPAIR_MODEL || process.env.OPENAI_MODEL || "gpt-5.6-luna",
  timeoutMs = Number(process.env.OPENAI_REPAIR_TIMEOUT_MS || 30000),
  client: injectedClient
} = {}) {
  if (!apiKey && !injectedClient) throw new TypeError("OPENAI_API_KEY is required");

  const client = injectedClient || new OpenAI({ apiKey, timeout: timeoutMs, maxRetries: 1 });

  return async function candidateProvider({ mission, plan }) {
    const sourceContext = mission?.input?.sourceContext;
    if (!Array.isArray(sourceContext) || !sourceContext.length) return null;

    const response = await client.responses.create({
      model,
      instructions: [
        "You are a bounded CI repair candidate generator.",
        "Return only a proposed patch candidate. Never claim that code is fixed.",
        "Use only files present in sourceContext.",
        "Never modify .env, credentials, GitHub Actions security settings, or deployment configuration.",
        "Keep the patch small and directly tied to the diagnosed failure.",
        "Provide exact complete file contents for every changed file.",
        "test_commands must be safe, deterministic, and suitable for the repository Core CI allowlist.",
        "If the evidence is insufficient, set can_repair=false and return no files."
      ].join("\n"),
      input: JSON.stringify({
        mission,
        plan,
        sourceContext
      }),
      text: {
        format: {
          type: "json_schema",
          name: "repair_candidate",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              can_repair: { type: "boolean" },
              title: { type: "string" },
              rationale: { type: "string" },
              branch: { type: "string" },
              commit_message: { type: "string" },
              changed_files: { type: "array", items: { type: "string" } },
              changed_lines: { type: "integer" },
              test_commands: { type: "array", items: { type: "string" } },
              files: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    path: { type: "string" },
                    content: { type: "string" }
                  },
                  required: ["path", "content"]
                }
              }
            },
            required: [
              "can_repair","title","rationale","branch","commit_message",
              "changed_files","changed_lines","test_commands","files"
            ]
          }
        }
      }
    });

    let candidate;
    try {
      candidate = JSON.parse(String(response.output_text || ""));
    } catch {
      return null;
    }

    if (!candidate.can_repair) return null;
    if (!candidate.files.length || !candidate.changed_files.length) return null;
    if (candidate.files.some(file => !candidate.changed_files.includes(file.path))) return null;
    if (candidate.changed_lines < 0 || candidate.changed_files.length > 8 || candidate.changed_lines > 400) return null;
    const unsafePath = path => !path || path.startsWith("/") || path.includes("\\") || path.split("/").includes("..");
    if (candidate.changed_files.some(unsafePath)) return null;
    if (candidate.files.some(file => unsafePath(file.path))) return null;
    if (candidate.changed_files.some(path => path === ".env" || path.startsWith(".github/workflows/"))) return null;
    if (!/^x29\\/[a-z0-9._-]+$/.test(candidate.branch)) return null;

    return candidate;
  };
}

module.exports = { createOpenAIRepairCandidateProvider };
