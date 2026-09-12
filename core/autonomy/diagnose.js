const OpenAI = require('openai');

const MAX_LOG_CHARS = 50000;

function extractJson(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('MODEL_OUTPUT_NOT_JSON');
  return JSON.parse(match[0]);
}

async function diagnose({ log, workflow, sha, model = process.env.OPENAI_MODEL || 'gpt-5.6-luna' }) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY_MISSING');
  if (!log) throw new Error('CI_LOG_MISSING');

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 20000, maxRetries: 1 });
  const clipped = String(log).slice(-MAX_LOG_CHARS);
  const response = await client.responses.create({
    model,
    input: [
      {
        role: 'system',
        content: `You are the diagnosis layer of a software reliability system. Analyze CI evidence only. Do not invent files, commands, stack traces, or fixes. Return JSON only with keys: root_cause, confidence, evidence, minimal_fix, verification, stop_reason. confidence must be 0..1. If evidence is insufficient, set stop_reason to "INSUFFICIENT_EVIDENCE" and minimal_fix to null. Never propose secrets, workflow permission escalation, auto-merge, or deployment.`,
      },
      {
        role: 'user',
        content: JSON.stringify({ workflow, sha, log: clipped }),
      },
    ],
  });

  return extractJson(response.output_text);
}

if (require.main === module) {
  const input = process.env.CI_LOG || '';
  diagnose({ log: input, workflow: process.env.WORKFLOW || 'unknown', sha: process.env.GIT_SHA || 'unknown' })
    .then(result => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
    .catch(error => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = { diagnose, extractJson };
