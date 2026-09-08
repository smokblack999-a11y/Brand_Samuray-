"use strict";

const OpenAI = require("openai");

const OPENAI_TIMEOUT_MS = Math.max(1000, Number(process.env.OPENAI_TIMEOUT_MS || 20000));

function getClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: OPENAI_TIMEOUT_MS,
    maxRetries: 2
  });
}

function publicOpenAIError(error) {
  const status = Number(error?.status || 0);
  if (status === 401) return new Error("OpenAI authentication failed");
  if (status === 429) return new Error("OpenAI rate limit reached");
  if (status >= 500) return new Error("OpenAI service temporarily unavailable");
  if (error?.name === "APIConnectionTimeoutError" || error?.code === "ETIMEDOUT") {
    return new Error("OpenAI request timed out");
  }
  return new Error("OpenAI request failed");
}

async function checkOpenAI() {
  const client = getClient();
  try {
    await client.models.list();
    return { ok: true };
  } catch (error) {
    throw publicOpenAIError(error);
  }
}

async function generateReply({ business, customerMessage, lead }) {
  const client = getClient();
  try {
    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      instructions: [
        "Ты AI-оператор бизнеса в Telegram.",
        "Отвечай кратко, естественно и по делу.",
        "Не выдумывай цены, наличие, сроки, скидки или условия.",
        "Если данных недостаточно, задай один конкретный уточняющий вопрос.",
        "Не утверждай, что действие выполнено, если оно не было выполнено системой.",
        `Бизнес: ${business || "не указан"}`,
        `Lead score: ${lead?.score ?? 0}`
      ].join("\n"),
      input: customerMessage
    });

    return response.output_text.trim();
  } catch (error) {
    throw publicOpenAIError(error);
  }
}

module.exports = { generateReply, checkOpenAI };
