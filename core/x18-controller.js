"use strict";

const { processNext } = require("./github-agent-worker");
const { processRepair } = require("./github-agent-repair-worker");
const { verifyNext } = require("./github-agent-pr-verifier");

const MAX_STEPS = Math.max(
  1,
  Math.min(Number(process.env.X18_CONTROLLER_MAX_STEPS || 3), 10)
);

async function runCycle() {
  const results = [];

  for (let step = 0; step < MAX_STEPS; step += 1) {
    const diagnosis = await processNext();
    results.push({ stage: "diagnosis", ...diagnosis });

    if (diagnosis.processed) {
      if (diagnosis.state !== "diagnosed") continue;
      const repair = await processRepair();
      results.push({ stage: "repair", ...repair });
      if (repair.processed) {
        const verification = await verifyNext();
        results.push({ stage: "verification", ...verification });
      }
      continue;
    }

    const repair = await processRepair();
    results.push({ stage: "repair", ...repair });

    if (repair.processed) {
      const verification = await verifyNext();
      results.push({ stage: "verification", ...verification });
      continue;
    }

    const verification = await verifyNext();
    results.push({ stage: "verification", ...verification });

    if (!verification.processed) break;
  }

  return {
    ok: true,
    steps: results.length,
    results
  };
}

if (require.main === module) {
  runCycle()
    .then(result => {
      console.log(JSON.stringify(result, null, 2));
      process.exitCode = 0;
    })
    .catch(error => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}

module.exports = { runCycle, MAX_STEPS };
