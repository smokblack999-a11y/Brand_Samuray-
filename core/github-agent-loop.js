"use strict";

const { processNext } = require("./github-agent-worker");
const { processRepair } = require("./github-agent-repair-worker");
const { verifyOpenRepairs } = require("./github-agent-verifier");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runOnce({
  diagnosis = processNext,
  repair = processRepair,
  verify = verifyOpenRepairs
} = {}) {
  const result = { diagnosis: null, repair: null, verification: null };

  try {
    result.diagnosis = await diagnosis();
  } catch (error) {
    result.diagnosis = { processed: false, error: error.message };
  }

  try {
    if (result.diagnosis?.processed && result.diagnosis?.safeToPatch) {
      result.repair = await repair();
    } else {
      result.repair = { processed: false, reason: "repair_not_ready" };
    }
  } catch (error) {
    result.repair = { processed: false, error: error.message };
  }

  try {
    result.verification = await verify();
  } catch (error) {
    result.verification = [{ verified: false, reason: "verification_error", error: error.message }];
  }

  return result;
}

async function runLoop({
  intervalMs = Math.max(10000, Number(process.env.GITHUB_AGENT_LOOP_INTERVAL_MS || 60000)),
  once = false,
  maxCycles = once ? 1 : Infinity,
  ...deps
} = {}) {
  const results = [];
  for (let cycle = 0; cycle < maxCycles; cycle += 1) {
    results.push(await runOnce(deps));
    if (once) break;
    await sleep(intervalMs);
  }
  return results;
}

if (require.main === module) {
  runLoop()
    .then(results => console.log(JSON.stringify({ ok: true, cycles: results.length, results: results.slice(-1)[0] }, null, 2)))
    .catch(error => {
      console.error(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}

module.exports = { runOnce, runLoop };
