"use strict";

const orchestrator = require("./autonomous-revenue-orchestrator");
const outreachExecutor = require("./apollo-outreach-executor");

let timer = null;
let busy = false;
let stopped = false;
let consecutiveFailures = 0;
let lastRunAt = null;
let lastSuccessAt = null;
let nextRunAt = null;

function boolEnv(name, fallback = false) {
  const v = String(process.env[name] ?? fallback).toLowerCase();
  return v === "true" || v === "1";
}

function enabled() {
  return boolEnv("REVENUE_AUTONOMOUS_SCHEDULER_ENABLED", false);
}

function baseIntervalMs() {
  const n = Number(process.env.REVENUE_AUTONOMOUS_INTERVAL_MS || 30 * 60 * 1000);
  return Math.max(5 * 60 * 1000, Number.isFinite(n) ? n : 30 * 60 * 1000);
}

function backoffMs() {
  const base = baseIntervalMs();
  const max = Math.max(base, Number(process.env.REVENUE_AUTONOMOUS_MAX_BACKOFF_MS || 6 * 60 * 60 * 1000));
  const exponent = Math.min(Math.max(consecutiveFailures, 0), 6);
  const raw = Math.min(max, base * (2 ** exponent));
  const jitterPct = Math.min(Math.max(Number(process.env.REVENUE_AUTONOMOUS_JITTER_PCT || 0.15), 0), 0.5);
  const jitter = raw * jitterPct * (Math.random() * 2 - 1);
  return Math.max(60 * 1000, Math.round(raw + jitter));
}

function schedulerConfig() {
  return {
    enabled: enabled(),
    intervalMs: baseIntervalMs(),
    immediate: !boolEnv("REVENUE_AUTONOMOUS_RUN_ON_START", true) ? false : true,
    executionEnabled: outreachExecutor.enabled(),
    maxBackoffMs: Math.max(baseIntervalMs(), Number(process.env.REVENUE_AUTONOMOUS_MAX_BACKOFF_MS || 6 * 60 * 60 * 1000)),
    consecutiveFailures,
    lastRunAt,
    lastSuccessAt,
    nextRunAt
  };
}

async function executeApprovedPlans(result) {
  if (!outreachExecutor.enabled()) return [];
  const executions = [];
  for (const plan of result?.plans || []) {
    if (plan?.actionPlan?.status !== "READY_FOR_EXECUTION") continue;
    try {
      const execution = await outreachExecutor.executePlan(plan);
      executions.push({
        leadId: plan.lead?.email || plan.lead?.apolloPersonId || null,
        ...execution
      });
    } catch (error) {
      executions.push({
        leadId: plan.lead?.email || plan.lead?.apolloPersonId || null,
        executed: false,
        status: "FAILED",
        code: error.code || "OUTREACH_EXECUTION_FAILED",
        error: error.message
      });
    }
  }
  return executions;
}

async function runOnce({ tenantId = "default" } = {}) {
  if (busy) return { skipped: true, reason: "SCHEDULER_BUSY" };
  busy = true;
  lastRunAt = new Date().toISOString();

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

    const executions = await executeApprovedPlans(result);
    consecutiveFailures = 0;
    lastSuccessAt = new Date().toISOString();

    console.log(JSON.stringify({
      event: "autonomous_revenue_cycle",
      source: result.source || null,
      discovered: result.discovered || 0,
      qualified: result.qualified || 0,
      plans: result.plans?.length || 0,
      executed: executions.filter(x => x.executed).length,
      executionFailures: executions.filter(x => x.status === "FAILED").length
    }));

    return { ...result, executions };
  } catch (error) {
    consecutiveFailures += 1;
    console.error(JSON.stringify({
      event: "autonomous_revenue_cycle_failed",
      code: error.code || null,
      error: error.message,
      consecutiveFailures
    }));
    return { ok: false, error: error.message, code: error.code || null };
  } finally {
    busy = false;
  }
}

function scheduleNext(tenantId) {
  if (timer) clearTimeout(timer);
  const delay = backoffMs();
  nextRunAt = new Date(Date.now() + delay).toISOString();
  timer = setTimeout(async () => {
    timer = null;
    if (stopped) return;
    await runOnce({ tenantId });
    if (!stopped) scheduleNext(tenantId);
  }, delay);
  timer.unref();
}

function start({ tenantId = "default" } = {}) {
  if (!enabled()) {
    return { ...schedulerConfig(), started: false, reason: "REVENUE_AUTONOMOUS_SCHEDULER_DISABLED" };
  }
  if (timer) return { ...schedulerConfig(), started: true, reused: true };

  stopped = false;
  const run = async () => {
    if (schedulerConfig().immediate) await runOnce({ tenantId });
    if (!stopped) scheduleNext(tenantId);
  };
  setImmediate(() => run().catch(error => {
    console.error(JSON.stringify({ event: "scheduler_start_failed", error: error.message }));
    if (!stopped) scheduleNext(tenantId);
  }));

  return { ...schedulerConfig(), started: true };
}

function stop() {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
  nextRunAt = null;
  return { stopped: true };
}

function isRunning() {
  return Boolean(timer) && !stopped;
}

module.exports = { schedulerConfig, runOnce, start, stop, isRunning };
