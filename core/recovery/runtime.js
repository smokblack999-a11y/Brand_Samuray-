"use strict";

const path = require("path");
const { createRecoveryScheduler } = require("./scheduler");

function loadExecutor() {
  const spec = String(process.env.RECOVERY_EXECUTOR_MODULE || "").trim();
  if (!spec) return null;
  const target = path.isAbsolute(spec) ? spec : path.resolve(process.cwd(), spec);
  const loaded = require(target);
  const executor = typeof loaded === "function" ? loaded : loaded.executor;
  if (typeof executor !== "function") throw new Error("RECOVERY_EXECUTOR_MODULE must export a function or { executor }");
  return executor;
}

function startRecoveryRuntime(options = {}) {
  const executor = options.executor || loadExecutor();
  if (!executor) return { scheduler: null, enabled: false, reason: "recovery_executor_not_configured" };

  const scheduler = createRecoveryScheduler({
    executor,
    intervalMs: options.intervalMs || process.env.RECOVERY_SCHEDULER_INTERVAL_MS || 1000,
    concurrency: options.concurrency || process.env.RECOVERY_WORKER_CONCURRENCY || 1,
    sourceDir: options.sourceDir || process.env.RECOVERY_SOURCE_DIR,
    testCommand: options.testCommand || process.env.RECOVERY_TEST_COMMAND,
    testArgs: options.testArgs,
    testTimeoutMs: options.testTimeoutMs || process.env.RECOVERY_TEST_TIMEOUT_MS
  });
  scheduler.start();
  return { scheduler, enabled: true };
}

module.exports = { loadExecutor, startRecoveryRuntime };
