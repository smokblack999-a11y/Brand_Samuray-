"use strict";

const OpenAI = require("openai");

function getClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured");
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

async function generateReply({ business, customerMessage, lead }) {
  const client = getClient();
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
}

module.exports = { generateReply };
