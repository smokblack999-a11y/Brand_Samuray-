"use strict";

const GATES = Object.freeze([
  { id: "G01", name: "Input integrity", fail: ctx => !ctx.diff || !String(ctx.diff).trim(), decision: "REJECT" },
  { id: "G02", name: "Change-size budget", fail: ctx => Number(ctx.changedLines || 0) > Number(ctx.maxChangedLines || 2500), decision: "ESCALATE" },
  { id: "G03", name: "Critical-path protection", fail: ctx => Boolean(ctx.criticalPathChanged && !ctx.criticalPathApproved), decision: "KILL" },
  { id: "G04", name: "Secret exposure", fail: ctx => Boolean(ctx.secretExposure), decision: "KILL" },
  { id: "G05", name: "Privilege boundary", fail: ctx => Boolean(ctx.privilegeEscalation), decision: "KILL" },
  { id: "G06", name: "TLS / crypto invariant", fail: ctx => Boolean(ctx.cryptoInvariantBroken), decision: "KILL" },
  { id: "G07", name: "Workflow trust boundary", fail: ctx => Boolean(ctx.workflowPrivilegeIncrease), decision: "KILL" },
  { id: "G08", name: "Dependency integrity", fail: ctx => Boolean(ctx.unreviewedDependencyChange), decision: "ESCALATE" },
  { id: "G09", name: "Sandbox isolation", fail: ctx => ctx.sandboxPassed !== true, decision: "REJECT" },
  { id: "G10", name: "Unit / integration verification", fail: ctx => ctx.testsPassed !== true, decision: "REJECT" },
  { id: "G11", name: "Adversarial verification", fail: ctx => ctx.adversarialPassed !== true, decision: "REJECT" },
  { id: "G12", name: "Behavioral drift", fail: ctx => Boolean(ctx.behaviorDrift), decision: "ESCALATE" },
  { id: "G13", name: "CI verification", fail: ctx => ctx.ciPassed !== true, decision: "REJECT" },
  { id: "G14", name: "Evidence completeness", fail: ctx => ctx.evidenceComplete !== true, decision: "ESCALATE" },
  { id: "G15", name: "Recovery budget / rollback", fail: ctx => Boolean(ctx.budgetExhausted || ctx.rollbackRequired), decision: "FREEZE" }
]);

const PRIORITY = Object.freeze({
  KILL: 5,
  FREEZE: 4,
  REJECT: 3,
  ESCALATE: 2,
  WARN: 1,
  ALLOW: 0
});

function evaluateRealLifeGates(context = {}) {
  const results = GATES.map(gate => ({
    id: gate.id,
    name: gate.name,
    status: gate.fail(context) ? "fail" : "pass",
    decision: gate.fail(context) ? gate.decision : "ALLOW"
  }));
  const failed = results.filter(x => x.status === "fail");
  const decision = failed.reduce(
    (current, item) => PRIORITY[item.decision] > PRIORITY[current] ? item.decision : current,
    "ALLOW"
  );
  return {
    passed: failed.length === 0,
    decision,
    failed,
    results
  };
}

function canTransitionToRecovered(context = {}) {
  const gates = evaluateRealLifeGates(context);
  return gates.passed &&
    context.patchApplied === true &&
    context.sandboxPassed === true &&
    context.testsPassed === true &&
    context.adversarialPassed === true &&
    context.ciPassed === true &&
    context.evidenceComplete === true;
}

module.exports = { GATES, evaluateRealLifeGates, canTransitionToRecovered };
