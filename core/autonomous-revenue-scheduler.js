"use strict";

const orchestrator = require("./autonomous-revenue-orchestrator");

let timer = null;
let busy = false;
let stopped = false;

function enabled() {
  return String(process.env.REVENUE_AUTONOMOUS_SCHEDULER_ENABLED || "false").toLowerCase() === "true";
}

function intervalMs() {
  const n = Number(process.env.REVENUE_AUTONOMOUS_INTERVAL_MS || 30 * 60 * 1000);
  return Math.max(5 * 60 * 1000, Number.isFinite(n) ? n : 30 * 60 * 1000);
}

function schedulerConfig() {
  return {
    enabled: enabled(),
    intervalMs: intervalMs(),
    immediate: String(process.env.REVENUE_AUTONOMOUS_RUN_ON_START || "true").toLowerCase() !== "false"
  };
}

async function runOnce({ tenantId = "default" } = {}) {
  if (busy) return { skipped: true, reason: "SCHEDULER_BUSY" };
  busy = true;
  try {
    const filters = (() => {
      try {
        const parsed = JSON.parse(process.env.APOLLO_DISCOVERY_FILTERS_JSON || "{}");
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch (_) {
        return {};
      }
    })();

    const result = await orchestrator.runCycle({
      tenantId,
      filters,
      maxProspects: Number(process.env.REVENUE_AUTONOMOUS_MAX_PROSPECTS || 5),
      enrich: true
    });
    console.log(JSON.stringify({
      event: "autonomous_revenue_cycle",
      source: result.source || null,
      discovered: result.discovered || 0,
      qualified: result.qualified || 0,
      plans: result.plans?.length || 0
    }));
    return result;
  } catch (error) {
    console.error(JSON.stringify({
      event: "autonomous_revenue_cycle_failed",
      code: error.code || null,
      error: error.message
    }));
    return { ok: false, error: error.message, code: error.code || null };
  } finally {
    busy = false;
  }
}

function start({ tenantId = "default" } = {}) {
  if (!enabled()) return { ...schedulerConfig(), started: false, reason: "REVENUE_AUTONOMOUS_SCHEDULER_DISABLED" };
  if (timer) return { ...schedulerConfig(), started: true, reused: true };

  stopped = false;
  const run = () => runOnce({ tenantId }).catch(() => {});
  if (schedulerConfig().immediate) setImmediate(run);

  timer = setInterval(run, intervalMs());
  timer.unref();

  return { ...schedulerConfig(), started: true };
}

function stop() {
  stopped = true;
  if (timer) clearInterval(timer);
  timer = null;
  return { stopped: true };
}

function isRunning() {
  return Boolean(timer) && !stopped;
}

module.exports = { schedulerConfig, runOnce, start, stop, isRunning };
