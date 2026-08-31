"use strict";

const OpenAI = require("openai");

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is missing");
  }

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const response = await client.responses.create({
    model: "gpt-5.6-luna",
    input: "Ответь одним словом: работает?"
  });

  console.log("");
  console.log("================================");
  console.log("       SAMURAIOS OPENAI");
  console.log("================================");
  console.log(response.output_text);
  console.log("================================");
  console.log("");
}

main().catch((error) => {
  console.error("");
  console.error("OPENAI ERROR:");
  console.error(error.message);
  console.error("");
  process.exit(1);
});
