"use strict";

/**
 * X29 Architect Core
 *
 * LLM/planners propose work; deterministic gates decide what may execute.
 * A job is VERIFIED only when the verifier supplies evidence.
 *
 * This module deliberately has no direct network, shell, GitHub, Telegram,
 * browser, or self-modifying capabilities. Those belong behind adapters.
 */

const STATUS = Object.freeze({
  QUEUED: "queued",
  PLANNING: "planning",
  CRITIC: "critic",
  EXECUTING: "executing",
  VERIFYING: "verifying",
  PROVEN: "proven",
  REJECTED: "rejected",
  ESCALATED: "escalated",
});

const DECISION = Object.freeze({
  ALLOW: "ALLOW",
  REJECT: "REJECT",
  ESCALATE: "ESCALATE",
});

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function now() {
  return new Date().toISOString();
}

class ArchitectCore {
  constructor({ planner, critic, executor, verifier, store, maxAttempts = 2 }) {
    for (const [name, value] of Object.entries({
      planner,
      critic,
      executor,
      verifier,
      store,
    })) {
      if (!value || typeof value !== "object") {
        throw new TypeError(`${name} adapter is required`);
      }
    }

    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) {
      throw new RangeError("maxAttempts must be an integer from 1 to 10");
    }

    this.planner = planner;
    this.critic = critic;
    this.executor = executor;
    this.verifier = verifier;
    this.store = store;
    this.maxAttempts = maxAttempts;
  }

  async run(mission) {
    if (!mission || !mission.id || !mission.type) {
      throw new TypeError("mission.id and mission.type are required");
    }

    const job = {
      id: mission.id,
      type: mission.type,
      status: STATUS.QUEUED,
      attempts: 0,
      maxAttempts: this.maxAttempts,
      input: clone(mission.input),
      evidence: [],
      events: [],
      createdAt: now(),
      updatedAt: now(),
    };

    await this.persist(job);

    try {
      job.status = STATUS.PLANNING;
      this.record(job, "PLANNING_STARTED");

      job.plan = clone(await this.planner.plan({
        mission: clone(mission),
        previousEvidence: clone(job.evidence),
      }));

      if (!job.plan || typeof job.plan !== "object") {
        throw new TypeError("planner must return a plan object");
      }
      job.plan.actions = Array.isArray(job.plan.actions) ? job.plan.actions : [];
      job.plan.tests = Array.isArray(job.plan.tests) ? job.plan.tests : [];
      job.plan.constraints = Array.isArray(job.plan.constraints) ? job.plan.constraints : [];
      this.record(job, "PLAN_CREATED");

      job.status = STATUS.CRITIC;
      this.record(job, "CRITIC_STARTED");

      job.critic = clone(await this.critic.evaluate({
        mission: clone(mission),
        plan: clone(job.plan),
        attempts: job.attempts,
        evidence: clone(job.evidence),
      }));

      const decision = job.critic && job.critic.decision;
      if (decision === DECISION.REJECT) {
        job.status = STATUS.REJECTED;
        job.failure = "critic_rejected";
        this.record(job, "CRITIC_REJECTED");
        return this.finish(job);
      }

      if (decision !== DECISION.ALLOW) {
        job.status = STATUS.ESCALATED;
        job.failure = "critic_escalated";
        this.record(job, "CRITIC_ESCALATED");
        return this.finish(job);
      }

      job.status = STATUS.EXECUTING;
      job.attempts += 1;
      this.record(job, "EXECUTION_STARTED");

      job.execution = clone(await this.executor.execute({
        mission: clone(mission),
        plan: clone(job.plan),
      }));
      this.record(job, "EXECUTION_FINISHED");

      job.status = STATUS.VERIFYING;
      this.record(job, "VERIFICATION_STARTED");

      job.proof = clone(await this.verifier.verify({
        mission: clone(mission),
        plan: clone(job.plan),
        execution: clone(job.execution),
      }));

      if (Array.isArray(job.proof && job.proof.evidence)) {
        job.evidence.push(...clone(job.proof.evidence));
      }

      if (!job.proof || job.proof.verified !== true) {
        job.failure = (job.proof && job.proof.reason) || "verification_failed";
        this.record(job, "VERIFICATION_FAILED");

        if (job.attempts < job.maxAttempts) {
          job.status = STATUS.QUEUED;
          job.retry = true;
          this.record(job, "RETRY_QUEUED");
          return this.finish(job);
        }

        job.status = STATUS.ESCALATED;
        this.record(job, "RETRY_LIMIT_REACHED");
        return this.finish(job);
      }

      job.status = STATUS.PROVEN;
      this.record(job, "PROOF_ACCEPTED");
      return this.finish(job);
    } catch (error) {
      job.status = STATUS.ESCALATED;
      job.error = {
        name: error.name,
        message: error.message,
      };
      this.record(job, "UNHANDLED_FAILURE");
      return this.finish(job);
    }
  }

  record(job, event) {
    job.events.push({
      event,
      at: now(),
      status: job.status,
      attempts: job.attempts,
    });
    job.updatedAt = now();
  }

  async persist(job) {
    job.updatedAt = now();
    await this.store.save(clone(job));
  }

  async finish(job) {
    job.updatedAt = now();
    await this.store.save(clone(job));
    return clone(job);
  }
}

module.exports = {
  ArchitectCore,
  STATUS,
  DECISION,
};
